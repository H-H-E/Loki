import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import songsHandler from '../api/songs';
import generateHandler from '../api/generate';
import { ApiError, fail } from '../server/lib/http';
import { requireSessionUser } from '../server/lib/auth';
import { createDemoProject } from '../src/lib/demo';

vi.mock('../server/lib/auth', () => ({
  requireSessionUser: vi.fn(),
  isAuthConfigured: vi.fn(() => true),
}));

function response() {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { state.status = code; return this; },
    json(value: unknown) { state.body = value; return this; },
    setHeader(key: string, value: string) { state.headers[key] = value; return this; },
  } as unknown as VercelResponse;
  return { state, res };
}
function request(body: unknown, cookie?: string, extraHeaders: Record<string,string> = {}) {
  return {
    method: 'POST', body,
    headers: {host:'studio.example.test', origin:'https://studio.example.test', cookie, ...extraHeaders},
  } as unknown as VercelRequest;
}
beforeEach(() => {
  vi.mocked(requireSessionUser).mockReset();
  vi.mocked(requireSessionUser).mockRejectedValue(new ApiError(401, 'Sign in to use live services.', 'SIGN_IN_REQUIRED'));
});

describe('AI account boundary', () => {
  function configureAi() {
    vi.stubEnv('LLM_API_KEY', 'server-only-test-key');
    vi.stubEnv('LLM_MODEL', 'test-model');
  }

  it('does not call an AI provider before authentication succeeds', async () => {
    configureAi();
    const outbound=vi.fn();vi.stubGlobal('fetch',outbound);
    const {state,res}=response();
    await generateHandler(request({action:'draft',project:createDemoProject()}),res);
    expect(state.status).toBe(401);
    expect(requireSessionUser).toHaveBeenCalledOnce();
    expect(outbound).not.toHaveBeenCalled();
  });

  it('rejects a project owned by a different cookie session before spending an AI request', async () => {
    configureAi();
    vi.mocked(requireSessionUser).mockResolvedValue({id:'second-author',name:'Second author',email:'second@example.test'});
    const outbound=vi.fn();vi.stubGlobal('fetch',outbound);
    const {state,res}=response();
    await generateHandler(request({action:'draft',project:{...createDemoProject(),ownerId:'first-author'}},'better-auth.session_token=second-author'),res);
    expect(state.status).toBe(403);
    expect(state.body).toMatchObject({code:'FORBIDDEN'});
    expect(outbound).not.toHaveBeenCalled();
  });

  it('rejects duplicate manuscript identifiers before any provider spending', async () => {
    configureAi();
    vi.mocked(requireSessionUser).mockResolvedValue({id:'author',name:'Author',email:'author@example.test'});
    const outbound=vi.fn();vi.stubGlobal('fetch',outbound);
    const project=createDemoProject();project.lines[1].id=project.lines[0].id;
    const {state,res}=response();
    await generateHandler(request({action:'draft',project}),res);
    expect(state.status).toBe(400);
    expect(state.body).toMatchObject({code:'DUPLICATE_LINE_IDS'});
    expect(outbound).not.toHaveBeenCalled();
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('live source boundary', () => {
  it('rejects unauthenticated searches before spending provider requests', async () => {
    vi.stubEnv('EVERYSONG_API_KEY', 'configured-server-test-key');
    const outbound = vi.fn(); vi.stubGlobal('fetch', outbound);
    const {state, res} = response();
    await songsHandler(request({action: 'search', query: 'a song title'}), res);
    expect(state.status).toBe(401);
    expect(requireSessionUser).toHaveBeenCalledOnce();
    expect(outbound).not.toHaveBeenCalled();
    expect(state.headers['Cache-Control']).toBe('no-store');
  });

  it('rejects an arbitrary proxy action before authentication or network access', async () => {
    const outbound = vi.fn(); vi.stubGlobal('fetch', outbound);
    const {state, res} = response();
    await songsHandler(request({action: 'fetch', url: 'http://169.254.169.254/'}), res);
    expect(state.status).toBe(400);
    expect(requireSessionUser).not.toHaveBeenCalled();
    expect(outbound).not.toHaveBeenCalled();
  });

  it('bounds oversized bodies before authentication or provider access', async () => {
    const outbound = vi.fn(); vi.stubGlobal('fetch', outbound);
    const {state, res} = response();
    await songsHandler(request(JSON.stringify({action: 'search', query: 'x'.repeat(170000)})), res);
    expect(state.status).toBe(413);
    expect(requireSessionUser).not.toHaveBeenCalled();
    expect(outbound).not.toHaveBeenCalled();
  });

  it('does not continue to the catalogue after session validation rejects an expired cookie', async () => {
    vi.stubEnv('EVERYSONG_API_KEY', 'configured-server-test-key');
    vi.mocked(requireSessionUser).mockRejectedValue(new ApiError(401, 'Your session expired.', 'INVALID_SESSION'));
    const outbound = vi.fn(); vi.stubGlobal('fetch', outbound);
    const {state, res} = response();
    const req = request({action:'search', query:'a song title'}, 'better-auth.session_token=expired');
    await songsHandler(req, res);
    expect(state.status).toBe(401);
    expect(requireSessionUser).toHaveBeenCalledWith(req);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('blocks cross-origin cookie writes before authentication or provider access', async () => {
    vi.stubEnv('EVERYSONG_API_KEY', 'configured-server-test-key');
    vi.mocked(requireSessionUser).mockResolvedValue({id:'user-a',name:'Author',email:'author@example.test'});
    const outbound = vi.fn(); vi.stubGlobal('fetch', outbound);
    const {state, res} = response();
    await songsHandler(request({action:'search',query:'a song title'}, 'better-auth.session_token=valid', {origin:'https://attacker.example.test'}), res);
    expect(state.status).toBe(403);
    expect(requireSessionUser).not.toHaveBeenCalled();
    expect(outbound).not.toHaveBeenCalled();
  });

  it('blocks cross-site fetch metadata even if the origin claims to match', async () => {
    vi.stubEnv('EVERYSONG_API_KEY', 'configured-server-test-key');
    const outbound = vi.fn(); vi.stubGlobal('fetch', outbound);
    const {state,res} = response();
    await songsHandler(request({action:'search',query:'a song title'}, 'better-auth.session_token=valid', {'sec-fetch-site':'cross-site'}),res);
    expect(state.status).toBe(403);
    expect(requireSessionUser).not.toHaveBeenCalled();
    expect(outbound).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods without reading auth or providers', async () => {
    const outbound=vi.fn();vi.stubGlobal('fetch',outbound);
    const {state,res}=response();
    const req=request({action:'search',query:'a song title'});req.method='GET';
    await songsHandler(req,res);
    expect(state.status).toBe(405);expect(state.headers.Allow).toBe('POST');
    expect(requireSessionUser).not.toHaveBeenCalled();expect(outbound).not.toHaveBeenCalled();
  });

  it('does not expose internal exception details through public errors', () => {
    const {state, res} = response();
    fail(res, new Error('provider secret and private lyric content'));
    expect(state.status).toBe(502);
    expect(JSON.stringify(state.body)).not.toContain('secret');
    expect(JSON.stringify(state.body)).not.toContain('private lyric content');
  });
});
