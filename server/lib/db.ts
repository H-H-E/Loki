import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let connection: { url: string; sql: NeonQueryFunction<false, false> } | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/** The connection string stays on Vercel. Browser requests use authenticated API routes. */
export function getSql(): NeonQueryFunction<false, false> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('LOKI_DATABASE_NOT_CONFIGURED');
  if (connection?.url !== url) connection = { url, sql: neon(url) };
  return connection.sql;
}
