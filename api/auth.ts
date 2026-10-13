import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fromNodeHeaders } from 'better-auth/node';
import { assertTrustedRequestOrigin, getAuth, getAuthConfiguration } from '../server/lib/auth';
import { ApiError, fail } from '../server/lib/http';

/** Vercel may consume JSON bodies before this function, so reconstruct a Web Request. */
export function toAuthRequest(req: VercelRequest): Request {
  const config = getAuthConfiguration();
  if (!config) throw new ApiError(503, 'Cloud authentication is not configured. The local studio still works.', 'AUTH_NOT_CONFIGURED');
  const url = new URL(req.url || '/api/auth', config.baseUrl);
  // The explicit rewrite query survives platforms that replace req.url with /api/auth.
  const rewrittenPath = req.query?.path;
  if (url.pathname === '/api/auth' && rewrittenPath) {
    const path = Array.isArray(rewrittenPath) ? rewrittenPath.join('/') : rewrittenPath;
    if (!/^[a-zA-Z0-9_/-]+$/.test(path) || path.includes('..')) throw new ApiError(400, 'Invalid authentication route.', 'INVALID_REQUEST');
    url.pathname = `/api/auth/${path.replace(/^\/+/, '')}`;
    url.searchParams.delete('path');
  }
  if (!url.pathname.startsWith('/api/auth/')) throw new ApiError(404, 'Unknown authentication route.', 'NOT_FOUND');
  // No URL or host supplied by the client can change the auth server origin.
  const trustedUrl = new URL(`${url.pathname}${url.search}`, config.baseUrl);
  const method = req.method || 'GET';
  const headers = fromNodeHeaders(req.headers);
  headers.delete('content-length');
  headers.set('host', new URL(config.baseUrl).host);
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    if (Buffer.isBuffer(req.body)) body = req.body.toString('utf8');
    else if (typeof req.body === 'string') body = req.body;
    else body = JSON.stringify(req.body ?? {});
    if (Buffer.byteLength(body) > 16_384) throw new ApiError(413, 'This authentication request is too large.', 'INPUT_TOO_LARGE');
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }
  return new Request(trustedUrl, { method, headers, body });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET or POST.', code: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const auth = getAuth();
    if (!auth) throw new ApiError(503, 'Cloud authentication is not configured. The local studio still works.', 'AUTH_NOT_CONFIGURED');
    assertTrustedRequestOrigin(req);
    const response = await auth.handler(toAuthRequest(req));
    response.headers.forEach((value, name) => {
      if (name !== 'set-cookie' && name !== 'cache-control') res.setHeader(name, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    res.status(response.status);
    return res.end(await response.text());
  } catch (error) { return fail(res, error); }
}
