import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getMigrations } from 'better-auth/db/migration';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Run the real PostgreSQL dialect, generated Better Auth migrations, password
// hashing, and cookie sessions without a hosted test database or network access.
const boundary = vi.hoisted(() => ({ database: null as PGlite | null }));
vi.mock('pg', () => ({ Pool: class {
  on() {}
  async end() {}
  async connect() {
    return {
      async query(sql: string, parameters?: unknown[]) {
        const result = await boundary.database!.query(sql, parameters);
        return { ...result, rowCount: result.affectedRows ?? result.rows.length };
      },
      release() {},
    };
  }
} }));

import { closeAuthPool, getAuth } from '../server/lib/auth';
import authHandler from '../api/auth';

let auth: NonNullable<ReturnType<typeof getAuth>>;
beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:pass@localhost/test');
  vi.stubEnv('BETTER_AUTH_SECRET', 'auth-integration-test-secret-longer-than-32-chars');
  vi.stubEnv('BETTER_AUTH_URL', 'https://loki.example.test');
  boundary.database = new PGlite();
  auth = getAuth()!;
  const migration = await getMigrations(auth.options);
  await migration.runMigrations();
}, 30_000);
afterAll(async () => { await closeAuthPool(); await boundary.database?.close(); vi.unstubAllEnvs(); });

function call(path: string, body?: unknown, cookie?: string) {
  return auth.handler(new Request(`https://loki.example.test/api/auth${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: 'https://loki.example.test', 'content-type': 'application/json', 'x-real-ip': '203.0.113.23', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}
function cookieFrom(response: Response): string {
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
}

describe('Better Auth with PostgreSQL persistence', () => {
  it('signs up, persists hashed credentials, validates and revokes a session, then signs in again', async () => {
    const signup = await call('/sign-up/email', { email: 'writer@example.test', password: 'never-store-plaintext', name: 'Test writer' });
    expect(signup.status).toBe(200);
    const user = await signup.json();
    expect(user.user.email).toBe('writer@example.test');
    const cookie = cookieFrom(signup);
    expect(cookie).toContain('__Secure-better-auth.session_token=');
    expect(signup.headers.getSetCookie().join(';')).toContain('HttpOnly');
    const credentials = await boundary.database!.query<{ password: string }>('select password from account');
    expect(credentials.rows[0].password).not.toBe('never-store-plaintext');
    expect(credentials.rows[0].password.length).toBeGreaterThan(32);
    const sessionResponse = await call('/get-session', undefined, cookie);
    expect((await sessionResponse.json()).user.id).toBe(user.user.id);
    expect((await call('/sign-out', {}, cookie)).status).toBe(200);
    expect(await (await call('/get-session', undefined, cookie)).json()).toBeNull();
    const signin = await call('/sign-in/email', { email: 'writer@example.test', password: 'never-store-plaintext' });
    expect(signin.status).toBe(200);
    expect((await (await call('/get-session', undefined, cookieFrom(signin))).json()).user.id).toBe(user.user.id);
  });

  it('creates the persistent authentication rate-limit table and rejects untrusted origins', async () => {
    const tables = await boundary.database!.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
    expect(tables.rows.map(row => row.tablename)).toContain('rateLimit');
    const state = { status: 200 };
    const res = { setHeader() {}, status(value: number) { state.status = value; return this; }, json() { return this; } } as unknown as VercelResponse;
    await authHandler({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: 'https://attacker.example.test', 'content-type': 'application/json' },
      body: { email: 'writer@example.test', password: 'never-store-plaintext' }, query: {} } as unknown as VercelRequest, res);
    expect(state.status).toBe(403);
  });

  it('keeps authentication throttles across new function instances', async () => {
    const attempts: number[] = [];
    for (let index = 0; index < 6; index++) {
      const response = await call('/sign-in/email', { email: 'writer@example.test', password: 'incorrect-password' });
      attempts.push(response.status);
    }
    expect(attempts).toContain(429);
    await closeAuthPool();
    auth = getAuth()!;
    const nextInstance = await call('/sign-in/email', { email: 'writer@example.test', password: 'never-store-plaintext' });
    expect(nextInstance.status).toBe(429);
    const buckets = await boundary.database!.query<{ count: number }>('select count from "rateLimit"');
    expect(buckets.rows.some(bucket => bucket.count >= 5)).toBe(true);
  });
});
