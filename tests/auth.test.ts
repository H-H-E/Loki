import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const boundary = vi.hoisted(() => ({ getSession: vi.fn(), handler: vi.fn(), options: undefined as any, poolEnd: vi.fn(async () => {}) }));
vi.mock('better-auth', () => ({ betterAuth: vi.fn((options: unknown) => {
  boundary.options = options;
  return { options, api: { getSession: boundary.getSession }, handler: boundary.handler };
}) }));
vi.mock('pg', () => ({ Pool: class { on() {} end() { return boundary.poolEnd(); } } }));

import { closeAuthPool, getAuth, getAuthConfiguration, isAuthConfigured, requireSessionUser } from '../server/lib/auth';
import authHandler, { toAuthRequest } from '../api/auth';

function configure() {
  vi.stubEnv('DATABASE_URL', 'postgresql://user:password@host.neon.tech/database?sslmode=require');
  vi.stubEnv('BETTER_AUTH_SECRET', 'a-test-secret-with-at-least-thirty-two-characters');
  vi.stubEnv('BETTER_AUTH_URL', 'https://loki.example.test');
  vi.stubEnv('VERCEL', ''); vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL_URL', ''); vi.stubEnv('VERCEL_BRANCH_URL', '');
}
function request(body: unknown = undefined, extra: Record<string, unknown> = {}) {
  return { method: 'POST', url: '/api/auth/sign-in/email', query: {}, body,
    headers: { host: 'loki.example.test', origin: 'https://loki.example.test', cookie: 'better-auth.session_token=opaque.signed' },
    ...extra } as unknown as VercelRequest;
}
function response() {
  const state = { status: 200, body: '', headers: {} as Record<string, string | string[]> };
  const res = {
    status(code: number) { state.status = code; return this; },
    json(value: unknown) { state.body = JSON.stringify(value); return this; },
    end(value: string) { state.body = value; return this; },
    setHeader(name: string, value: string | string[]) { state.headers[name] = value; return this; },
  } as unknown as VercelResponse;
  return { state, res };
}
beforeEach(() => { configure(); boundary.getSession.mockReset(); boundary.handler.mockReset(); });
afterEach(async () => { await closeAuthPool(); vi.unstubAllEnvs(); });

describe('Neon authentication configuration', () => {
  it('keeps the local studio available when auth is not configured', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(isAuthConfigured()).toBe(false); expect(getAuth()).toBeNull();
  });
  it('rejects short secrets and insecure remote origins', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'short'); expect(isAuthConfigured()).toBe(false);
    vi.stubEnv('BETTER_AUTH_SECRET', 'a-test-secret-with-at-least-thirty-two-characters');
    vi.stubEnv('BETTER_AUTH_URL', 'http://loki.example.test'); expect(isAuthConfigured()).toBe(false);
  });
  it('requires a canonical production URL', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('BETTER_AUTH_URL', '');
    expect(isAuthConfigured()).toBe(false);
  });
  it('trusts only exact preview domains supplied by Vercel', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('BETTER_AUTH_URL', '');
    vi.stubEnv('VERCEL_URL', 'loki-abc-team.vercel.app'); vi.stubEnv('VERCEL_BRANCH_URL', 'loki-git-test-team.vercel.app');
    expect(getAuthConfiguration()?.trustedOrigins).toEqual(['https://loki-abc-team.vercel.app', 'https://loki-git-test-team.vercel.app']);
    vi.stubEnv('VERCEL_URL', 'untrusted.example.test'); expect(isAuthConfigured()).toBe(false);
  });
  it('persists rate limits and uses secure HttpOnly session cookies', () => {
    getAuth();
    expect(boundary.options.rateLimit.storage).toBe('database');
    expect(boundary.options.advanced).toMatchObject({ useSecureCookies: true, defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' } });
    expect(boundary.options.emailAndPassword).toMatchObject({ enabled: true, minPasswordLength: 8 });
  });
});

describe('real cookie session boundary', () => {
  it('rejects missing cookies before looking up a database session', async () => {
    await expect(requireSessionUser(request(undefined, { headers: { host: 'loki.example.test', origin: 'https://loki.example.test', authorization: 'Bearer arbitrary' } })))
      .rejects.toMatchObject({ status: 401, code: 'SIGN_IN_REQUIRED' });
    expect(boundary.getSession).not.toHaveBeenCalled();
  });
  it('rejects expired signed cookies instead of granting access from their presence', async () => {
    boundary.getSession.mockResolvedValue(null);
    await expect(requireSessionUser(request())).rejects.toMatchObject({ status: 401, code: 'INVALID_SESSION' });
    expect(boundary.getSession).toHaveBeenCalledOnce();
  });
  it('uses the authenticated owner returned by Better Auth', async () => {
    boundary.getSession.mockResolvedValue({ user: { id: 'owner-from-database', email: 'writer@example.test', name: 'Writer' } });
    expect(await requireSessionUser(request({ ownerId: 'attacker-selected-owner' }))).toEqual({ id: 'owner-from-database', email: 'writer@example.test', name: 'Writer' });
    expect(boundary.getSession.mock.calls[0][0].headers.get('cookie')).toBe('better-auth.session_token=opaque.signed');
  });
  it('rejects cross-site origins before any session lookup', async () => {
    await expect(requireSessionUser(request(undefined, { headers: { origin: 'https://attacker.example.test', cookie: 'opaque' } })))
      .rejects.toMatchObject({ status: 403, code: 'UNTRUSTED_ORIGIN' });
    expect(boundary.getSession).not.toHaveBeenCalled();
  });
  it('does not leak database errors to clients', async () => {
    boundary.getSession.mockRejectedValue(new Error('postgresql://private-secret/password'));
    await expect(requireSessionUser(request())).rejects.toMatchObject({ status: 503, code: 'SESSION_UNAVAILABLE' });
  });
});

describe('Vercel auth route adapter', () => {
  it('reconstructs already parsed JSON without reading an exhausted request stream', async () => {
    const req = request({ email: 'writer@example.test', password: 'testpassword' });
    const adapted = toAuthRequest(req);
    expect(await adapted.json()).toEqual(req.body);
    expect(adapted.url).toBe('https://loki.example.test/api/auth/sign-in/email');
    expect(adapted.headers.has('content-length')).toBe(false);
  });
  it('restores the auth path from the Vercel rewrite', () => {
    const adapted = toAuthRequest(request({}, { url: '/api/auth?path=sign-up%2Femail', query: { path: 'sign-up/email' } }));
    expect(adapted.url).toBe('https://loki.example.test/api/auth/sign-up/email');
  });
  it('ignores hostile request host headers when constructing the auth URL', () => {
    expect(toAuthRequest(request({}, { url: 'https://attacker.example.test/api/auth/sign-in/email', headers: { host: 'attacker.example.test' } })).url)
      .toBe('https://loki.example.test/api/auth/sign-in/email');
  });
  it('bounds authentication request bytes', () => {
    expect(() => toAuthRequest(request({ name: 'é'.repeat(9000) }))).toThrow('too large');
  });
  it('forwards separate Set-Cookie headers and disables response caching', async () => {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.append('Set-Cookie', 'session=first; HttpOnly; Secure'); headers.append('Set-Cookie', 'cache=second; HttpOnly; Secure');
    boundary.handler.mockResolvedValue(new Response('{"user":{"id":"test"}}', { status: 200, headers }));
    const { state, res } = response(); await authHandler(request({ email: 'a@b.test', password: 'password' }), res);
    expect(state.status).toBe(200); expect(state.headers['Set-Cookie']).toHaveLength(2);
    expect(state.headers['Cache-Control']).toBe('no-store');
  });
  it('fails safely when the cloud is unconfigured', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { state, res } = response(); await authHandler(request(), res);
    expect(state.status).toBe(503); expect(boundary.handler).not.toHaveBeenCalled();
  });
});
