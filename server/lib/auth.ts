import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import { Pool } from 'pg';
import type { VercelRequest } from '@vercel/node';
import { ApiError } from './http';

export interface AuthConfiguration {
  databaseUrl: string;
  secret: string;
  baseUrl: string;
  trustedOrigins: string[];
}

function configuredOrigin(value: string | undefined, allowLocalHttp: boolean): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
    if (url.protocol !== 'https:' && !(allowLocalHttp && local && url.protocol === 'http:')) return null;
    return url.origin;
  } catch { return null; }
}

function vercelOrigin(value: string | undefined): string | null {
  if (!value || !/^[a-z0-9-]+\.vercel\.app$/i.test(value)) return null;
  return `https://${value.toLowerCase()}`;
}

/** Resolve trusted origins only from server configuration, never request Host headers. */
export function getAuthConfiguration(): AuthConfiguration | null {
  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  const onVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
  const production = process.env.NODE_ENV === 'production' || onVercel;
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl) || !secret || secret.length < 32) return null;
  let baseUrl = configuredOrigin(process.env.BETTER_AUTH_URL, !production);
  // Every preview trusts only its own platform-provided deployment and branch URLs.
  if (!baseUrl && !process.env.BETTER_AUTH_URL && process.env.VERCEL_ENV === 'preview') baseUrl = vercelOrigin(process.env.VERCEL_URL);
  if (!baseUrl && !process.env.BETTER_AUTH_URL && !production) baseUrl = 'http://localhost:4173';
  if (!baseUrl) return null;
  const trustedOrigins = new Set([baseUrl]);
  if (onVercel) {
    for (const value of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) {
      const origin = vercelOrigin(value);
      if (origin) trustedOrigins.add(origin);
    }
  }
  return { databaseUrl, secret, baseUrl, trustedOrigins: [...trustedOrigins] };
}

export function isAuthConfigured(): boolean { return getAuthConfiguration() !== null; }

type StudioAuth = ReturnType<typeof betterAuth>;
let cached: { key: string; auth: StudioAuth; pool: Pool } | null = null;

/** Lazily create the Node/Postgres auth adapter so an unconfigured local build still works. */
export function getAuth(): StudioAuth | null {
  const config = getAuthConfiguration();
  if (!config) return null;
  const key = JSON.stringify(config);
  if (cached?.key === key) return cached.auth;
  const previousPool = cached?.pool;
  if (previousPool) void previousPool.end().catch(() => {});
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 3,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  // Idle connection errors should fail the next request safely, not terminate the function.
  pool.on('error', () => {});
  const options: BetterAuthOptions = {
    appName: 'Loki Studio',
    baseURL: config.baseUrl,
    basePath: '/api/auth',
    secret: config.secret,
    database: pool,
    trustedOrigins: config.trustedOrigins,
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-up/email': { window: 60, max: 3 },
        '/sign-in/email': { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: config.baseUrl.startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      // Vercel overwrites this header with the direct connecting address.
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
    },
    logger: { level: 'error' },
  };
  const auth = betterAuth(options);
  cached = { key, auth, pool };
  return auth;
}

export async function closeAuthPool(): Promise<void> {
  const previous = cached;
  cached = null;
  await previous?.pool.end();
}

export function assertTrustedRequestOrigin(req: VercelRequest): void {
  const config = getAuthConfiguration();
  if (!config) throw new ApiError(503, 'Cloud saving needs Neon and authentication configured. The local studio still works.', 'AUTH_NOT_CONFIGURED');
  const origin = req.headers.origin;
  if (req.headers['sec-fetch-site'] === 'cross-site' || (req.method === 'POST' && typeof origin !== 'string') || (origin !== undefined && (typeof origin !== 'string' || !config.trustedOrigins.includes(origin)))) {
    throw new ApiError(403, 'Open Loki on its configured domain to continue.', 'UNTRUSTED_ORIGIN');
  }
}

export async function requireSessionUser(req: VercelRequest): Promise<{ id: string; email: string; name: string }> {
  const auth = getAuth();
  if (!auth) throw new ApiError(503, 'Cloud saving needs Neon and authentication configured. The local studio still works.', 'AUTH_NOT_CONFIGURED');
  assertTrustedRequestOrigin(req);
  if (!req.headers.cookie) throw new ApiError(401, 'Sign in to use cloud saving, live song search and AI.', 'SIGN_IN_REQUIRED');
  let session;
  try { session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true } }); }
  catch { throw new ApiError(503, 'Cloud sessions are temporarily unavailable. Your local draft is safe.', 'SESSION_UNAVAILABLE'); }
  if (!session?.user?.id) throw new ApiError(401, 'Your session expired. Sign in again.', 'INVALID_SESSION');
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}
