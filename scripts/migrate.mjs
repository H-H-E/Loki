import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { loadEnv } from 'vite';
import { tsImport } from 'tsx/esm/api';
import { getMigrations } from 'better-auth/db/migration';

for (const [key, value] of Object.entries(loadEnv('development', process.cwd(), ''))) {
  if (process.env[key] === undefined) process.env[key] = value;
}
const { getAuth, closeAuthPool } = await tsImport('../server/lib/auth.ts', import.meta.url);
const runtimeDatabaseUrl = process.env.DATABASE_URL;
let pool;
let client;
let locked = false;
try {
  const migrationUrl = process.env.DATABASE_URL_UNPOOLED || runtimeDatabaseUrl;
  if (!migrationUrl) throw new Error('Configure DATABASE_URL before migrating.');
  let parsed;
  try { parsed = new URL(migrationUrl); } catch { throw new Error('Configure a valid Postgres database URL before migrating.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('Configure a valid Postgres database URL before migrating.');
  if (parsed.hostname.includes('-pooler')) throw new Error('Configure DATABASE_URL_UNPOOLED with the direct Neon connection URL before migrating. Migration locks require one persistent connection.');
  // Schema inspection and both migration paths share the direct endpoint.
  // Runtime requests continue to use the pooled DATABASE_URL outside this process.
  process.env.DATABASE_URL = migrationUrl;
  const auth = getAuth();
  if (!auth) throw new Error('Configure DATABASE_URL, BETTER_AUTH_SECRET and BETTER_AUTH_URL before migrating.');
  pool = new Pool({ connectionString: migrationUrl, max: 1, connectionTimeoutMillis: 15000 });
  client = await pool.connect();
  // Serialize deploy/manual migration scripts before any schema inspection.
  await client.query("select pg_advisory_lock(hashtext('loki-schema-migrations'))");
  locked = true;
  const authMigration = await getMigrations(auth.options);
  await authMigration.runMigrations();
  const migrationDirectory = fileURLToPath(new URL('../db/migrations/', import.meta.url));
  await client.query('begin');
  await client.query('create table if not exists public.loki_schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())');
  const files = (await readdir(migrationDirectory)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of files) {
    const sql = await readFile(`${migrationDirectory}/${name}`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const prior = await client.query('select checksum from public.loki_schema_migrations where name=$1', [name]);
    if (prior.rows.length) {
      if (prior.rows[0].checksum !== checksum) throw new Error(`Previously applied migration ${name} changed. Add a new migration instead.`);
      continue;
    }
    await client.query(sql);
    await client.query('insert into public.loki_schema_migrations (name,checksum) values ($1,$2)', [name, checksum]);
    process.stdout.write(`Applied ${name}\n`);
  }
  await client.query('commit');
  process.stdout.write('Better Auth and Loki schema are ready.\n');
} catch (error) {
  if (client) await client.query('rollback').catch(() => {});
  // Never print a connection string or provider credential in deployment logs.
  const known = error instanceof Error && (error.message.startsWith('Configure ') || error.message.startsWith('Previously applied migration'));
  process.stderr.write(`${known ? error.message : 'Migration failed. Check database connectivity, permissions and the migration SQL.'}\n`);
  process.exitCode = 1;
} finally {
  if (client && locked) await client.query("select pg_advisory_unlock(hashtext('loki-schema-migrations'))").catch(() => {});
  client?.release();
  await pool?.end();
  await closeAuthPool();
  if (runtimeDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = runtimeDatabaseUrl;
}
