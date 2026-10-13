import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { requireSessionUser } from './auth';
import { getSql, isDatabaseConfigured } from './db';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED', public retryAfter?: number) { super(message); }
}
export function fail(res: VercelResponse, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'The request is incomplete or invalid.', code: 'INVALID_REQUEST' });
  const e = error instanceof ApiError ? error : new ApiError(502, 'The provider could not complete this request. Try again.', 'PROVIDER_ERROR');
  if (e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter));
  return res.status(e.status).json({ error: e.message, code: e.code, retryAfter: e.retryAfter });
}
export function postOnly(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'Use POST.', code: 'METHOD_NOT_ALLOWED' }); return false; }
  try { requireSameOrigin(req); } catch (error) { fail(res, error); return false; }
  return true;
}
export function requireSameOrigin(req: VercelRequest): void {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (req.headers['sec-fetch-site'] === 'cross-site' || typeof origin !== 'string' || typeof host !== 'string') {
    throw new ApiError(403, 'Open the studio in this browser to make changes.', 'INVALID_ORIGIN');
  }
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new ApiError(403, 'The request origin is invalid.', 'INVALID_ORIGIN'); }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  if (parsed.host.toLowerCase() !== host.toLowerCase() || parsed.username || parsed.password || (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:'))) {
    throw new ApiError(403, 'This request must come from the studio itself.', 'INVALID_ORIGIN');
  }
}
export function body(req: VercelRequest, maxSize = 160000): unknown {
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  if (Buffer.byteLength(raw, 'utf8') > maxSize) throw new ApiError(413, 'This request is too large.', 'INPUT_TOO_LARGE');
  try { return JSON.parse(raw); } catch { throw new ApiError(400, 'Send a valid JSON body.', 'INVALID_JSON'); }
}
export async function jsonFetch(url: string, init: RequestInit = {}, timeout = 22000, retry = true): Promise<any> {
  const deadline = Date.now() + timeout;
  for (let attempt = 0; attempt < (retry ? 2 : 1); attempt++) {
    let response: Response;
    try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) }); }
    catch { throw new ApiError(504, 'The provider took too long. Your work is still saved.', 'PROVIDER_TIMEOUT'); }
    const retrySeconds = Math.max(1, Math.min(120, Number(response.headers.get('retry-after')) || 2));
    if ((response.status === 429 || response.status === 503) && attempt === 0 && retry && retrySeconds <= 3 && deadline - Date.now() > retrySeconds * 1000 + 1000) {
      await new Promise(resolve => setTimeout(resolve, retrySeconds * 1000)); continue;
    }
    if (!response.ok) {
      if (response.status === 429) throw new ApiError(429, 'The provider is busy or its quota has been reached. Try again later.', 'PROVIDER_RATE_LIMIT', retrySeconds);
      if (response.status === 401 || response.status === 403) throw new ApiError(503, 'The server provider credential was rejected. Check its configuration.', 'PROVIDER_CONFIGURATION');
      throw new ApiError(response.status === 404 ? 404 : 502, 'This provider request is unavailable. You can paste lyrics instead.', 'PROVIDER_UNAVAILABLE');
    }
    try { return await response.json(); } catch { throw new ApiError(502, 'The provider returned an unreadable response.', 'INVALID_PROVIDER_RESPONSE'); }
  }
  throw new ApiError(502, 'The provider is unavailable.');
}
export async function requireUser(req: VercelRequest): Promise<string> {
  return (await requireSessionUser(req)).id;
}
const limits = new Map<string, { started: number; count: number }>();
export function rateLimit(userId: string, category: string, max = 20) {
  const key = `${category}:${userId}`;
  const now = Date.now();
  let bucket = limits.get(key);
  if (!bucket || now - bucket.started >= 60000) { bucket = { started: now, count: 0 }; limits.set(key, bucket); }
  if (++bucket.count > max) throw new ApiError(429, 'You have made several requests. Give it a minute.', 'LOCAL_RATE_LIMIT', 60);
  if (limits.size > 10000) for (const [key, value] of limits) if (now - value.started > 60000) limits.delete(key);
}
export async function consumeQuota(req: VercelRequest, category: 'source'|'ai', cost = 1) {
  if (!isDatabaseConfigured()) throw new ApiError(503, 'Live usage budgets need Neon configured. The local studio still works.', 'DATABASE_NOT_CONFIGURED');
  const owner = await requireUser(req);
  // A non-secret fingerprint isolates budgets when an EverySong credential changes.
  const providerScope = category === 'source' ? createHash('sha256').update(process.env.EVERYSONG_API_KEY || '').digest('hex').slice(0, 24) : 'ai';
  let allowed: boolean | undefined;
  try {
    const sql = getSql();
    const result = await sql`select public.consume_loki_quota(${owner}, ${category}, ${cost}, ${providerScope}) as allowed`;
    allowed = result[0]?.allowed;
  } catch { throw new ApiError(503, 'Live usage budgets are unavailable. Run the included Neon migration before enabling providers.', 'QUOTA_NOT_CONFIGURED'); }
  if (allowed !== true) throw new ApiError(429, 'Your live usage budget has been reached. You can keep editing your draft locally.', 'BUDGET_REACHED', 60);
}
