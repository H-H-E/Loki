import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createBlankProject, createDemoProject } from '../src/lib/demo';
import type { Project } from '../src/types';

const boundary = vi.hoisted(() => ({ user: vi.fn(), query: vi.fn(), configured: vi.fn(() => true) }));
vi.mock('../server/lib/auth', () => ({ requireSessionUser: boundary.user }));
vi.mock('../server/lib/db', () => ({ getSql: () => boundary.query, isDatabaseConfigured: boundary.configured }));
import projectsHandler from '../api/projects';
import { consumeQuota } from '../server/lib/http';
import { saveJobResult } from '../server/lib/jobs';

function request(method = 'POST', value: unknown = {}): VercelRequest {
  return { method, body: value, headers: { host: 'studio.example.test', origin: 'https://studio.example.test', cookie: 'signed-session' } } as unknown as VercelRequest;
}
function response() {
  const state = { status: 200, body: undefined as any, headers: {} as Record<string, string> };
  const res = { status(value: number) { state.status = value; return this; }, json(value: unknown) { state.body = value; return this; }, setHeader(key: string, value: string) { state.headers[key] = value; } } as unknown as VercelResponse;
  return { state, res };
}

describe('authenticated Neon API boundary', () => {
  beforeEach(() => {
    boundary.user.mockReset().mockResolvedValue({ id: 'owner-a', email: 'a@example.test', name: 'Writer' });
    boundary.query.mockReset();
    boundary.configured.mockReset().mockReturnValue(true);
  });
  it('lists only the verified cookie owner using a bound SQL parameter', async () => {
    boundary.query.mockResolvedValue([{ id: 'private-project', cloud_version: '2' }]);
    const { state, res } = response();
    await projectsHandler(request('GET'), res);
    expect(state.status).toBe(200);
    expect(state.body.projects).toHaveLength(1);
    expect(state.body.projects[0].cloud_version).toBe(2);
    expect(boundary.query.mock.calls[0][0].join('')).toContain('where owner_id = ');
    expect(boundary.query.mock.calls[0][1]).toBe('owner-a');
    expect(state.headers['Cache-Control']).toBe('no-store');
  });
  it('passes a server-derived owner to the atomic save function', async () => {
    boundary.query.mockResolvedValue([{ result: { cloud_version: 1 } }]);
    const { state, res } = response();
    await projectsHandler(request('POST', { action: 'save', project: createDemoProject(), expectedVersion: 0 }), res);
    expect(state.status).toBe(200);
    expect(boundary.query.mock.calls[0][1]).toBe('owner-a');
    expect(JSON.parse(boundary.query.mock.calls[0][2]).ownerId).toBe('owner-a');
    expect(state.body.cloud_version).toBe(1);
  });
  it('saves a new empty manuscript without requiring an AI-valid source', async () => {
    boundary.query.mockResolvedValue([{ result: { cloud_version: 1 } }]);
    const { state, res } = response();
    await projectsHandler(request('POST', { action: 'save', project: createBlankProject(), expectedVersion: 0 }), res);
    expect(state.status).toBe(200);
  });
  it('rejects a supplied owner for another account before a database query', async () => {
    const { state, res } = response();
    await projectsHandler(request('POST', { action: 'save', project: { ...createDemoProject(), ownerId: 'owner-b' }, expectedVersion: 0 }), res);
    expect(state.status).toBe(403);
    expect(boundary.query).not.toHaveBeenCalled();
  });
  it('returns a recoverable conflict without leaking database detail', async () => {
    boundary.query.mockRejectedValue(new Error('Neon detail and LOKI_VERSION_CONFLICT private data'));
    const { state, res } = response();
    await projectsHandler(request('POST', { action: 'save', project: createDemoProject(), expectedVersion: 2 }), res);
    expect(state.status).toBe(409);
    expect(state.body.code).toBe('LOKI_VERSION_CONFLICT');
    expect(JSON.stringify(state.body)).not.toContain('private data');
  });
  it('rejects cross-site cookie writes before session lookup', async () => {
    const req = request('POST', { action: 'save', project: createDemoProject(), expectedVersion: 0 });
    req.headers.origin = 'https://evil.example.test';
    const { state, res } = response();
    await projectsHandler(req, res);
    expect(state.status).toBe(403);
    expect(boundary.user).not.toHaveBeenCalled();
    expect(boundary.query).not.toHaveBeenCalled();
  });
  it('fails closed when the shared provider quota is unavailable', async () => {
    boundary.query.mockRejectedValue(new Error('database unavailable'));
    await expect(consumeQuota(request(), 'source')).rejects.toMatchObject({ status: 503, code: 'QUOTA_NOT_CONFIGURED' });
  });
  it('refuses a forged owner when persisting an AI job', async () => {
    await expect(saveJobResult(request(), 'owner-b', randomUUID(), 0, randomUUID(), {})).rejects.toMatchObject({ status: 403 });
    expect(boundary.query).not.toHaveBeenCalled();
  });
});

describe('real PostgreSQL manuscript transactions', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec('create table public."user" (id text primary key); insert into public."user" values (\'owner-a\'),(\'owner-b\'),(\'owner-c\');');
    await db.exec(await readFile(new URL('../db/migrations/001_loki.sql', import.meta.url), 'utf8'));
  }, 20000);
  beforeEach(async () => { await db.exec('truncate public.loki_revisions,public.loki_projects,public.loki_jobs,public.loki_request_buckets restart identity cascade'); });
  afterAll(async () => { await db.close(); });
  async function save(project: Project, version: number, owner = 'owner-a', structure = false) {
    const result = await db.query<{ result: { cloud_version: number; project: Project } }>('select public.save_loki_project($1,$2::jsonb,$3,$4) as result', [owner, JSON.stringify(project), version, structure]);
    return result.rows[0].result;
  }
  async function patch(project: Project, version: number, patches: unknown[], scope: string[], owner = 'owner-a') {
    return db.query('select public.commit_loki_patches($1,$2::uuid,$3,$4::jsonb,$5::uuid,$6::text[])', [owner, project.id, version, JSON.stringify(patches), randomUUID(), scope]);
  }
  async function quota(owner: string, category = 'ai', cost = 1, provider = 'test-catalogue') {
    const result = await db.query<{ allowed: boolean }>('select public.consume_loki_quota($1,$2,$3,$4) as allowed', [owner, category, cost, provider]);
    return result.rows[0].allowed;
  }
  it('creates private projects with Better Auth text IDs and monotonically increasing cloud versions', async () => {
    const project = createDemoProject();
    expect((await save(project, 0)).project.ownerId).toBe('owner-a');
    expect((await save({ ...project, title: 'Second save' }, 1)).cloud_version).toBe(2);
    const revisions = await db.query('select cloud_version,owner_id from loki_revisions');
    expect(revisions.rows).toEqual([{ cloud_version: 1, owner_id: 'owner-a' }]);
  });
  it('rejects competing first saves instead of overwriting the winner', async () => {
    const project = createDemoProject();
    const results = await Promise.allSettled([save(project, 0), save({ ...project, title: 'Competing tab' }, 0)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: expect.objectContaining({ message: 'LOKI_VERSION_CONFLICT' }) });
    const rows = await db.query('select cloud_version from loki_projects');
    expect(rows.rows).toEqual([{ cloud_version: 1 }]);
  });
  it('does not reveal or overwrite a different account project', async () => {
    const project = createDemoProject(); await save(project, 0);
    await expect(save(project, 1, 'owner-b')).rejects.toThrow('LOKI_PROJECT_NOT_FOUND');
    await expect(save({ ...project, ownerId: 'owner-b' }, 1)).rejects.toThrow('LOKI_OWNER_MISMATCH');
  });
  it('preserves protected Unicode text exactly, including normalization differences', async () => {
    const project = createDemoProject(); project.lines[0].text = 'Café 👩🏽‍🎤'; project.lines[0].protected = true;
    await save(project, 0);
    const edited = structuredClone(project); edited.lines[0].text = 'Cafe\u0301 👩🏽‍🎤';
    await expect(save(edited, 1)).rejects.toThrow('LOKI_PROTECTED_LINE');
    edited.lines[0].protected = false;
    await expect(save(edited, 1)).rejects.toThrow('LOKI_PROTECTED_LINE');
    const unlocked = structuredClone(project); unlocked.lines[0].protected = false;
    await save(unlocked, 1);
    expect((await save(edited, 2)).cloud_version).toBe(3);
  });
  it('requires a real source-structure checkpoint before reshaping lines', async () => {
    const project = createDemoProject(); await save(project, 0);
    const edited = structuredClone(project); edited.lines[0].sourceText = 'A replacement source';
    await expect(save(edited, 1, 'owner-a', true)).rejects.toThrow('LOKI_STRUCTURE_CHECKPOINT');
    const { snapshots: _snapshots, ...data } = project;
    edited.snapshots = [{ id: randomUUID(), label: 'Before source change', createdAt: new Date().toISOString(), data }];
    await expect(save(edited, 1)).rejects.toThrow('LOKI_STRUCTURE_CHECKPOINT');
    expect((await save(edited, 1, 'owner-a', true)).cloud_version).toBe(2);
  });
  it('rejects a linked-hook mismatch in a full save', async () => {
    const project = createDemoProject(); await save(project, 0);
    const line = project.lines.find(item => item.repeatKey)!; line.text = 'Only one chorus changed';
    await expect(save(project, 1)).rejects.toThrow('LOKI_LINKED_HOOK');
  });
  it('rejects protected, stale and out-of-scope AI patches atomically', async () => {
    const project = createDemoProject(); project.lines[0].protected = true; await save(project, 0);
    const first = project.lines[0]; const second = project.lines[1];
    await expect(patch(project, 1, [{ lineId: first.id, expectedRevision: 0, newText: 'Changed' }], [first.id])).rejects.toThrow('LOKI_PROTECTED_LINE');
    await expect(patch(project, 1, [{ lineId: second.id, expectedRevision: 3, newText: 'Changed' }], [second.id])).rejects.toThrow('LOKI_STALE_LINE');
    await expect(patch(project, 1, [{ lineId: second.id, expectedRevision: 0, newText: 'Changed' }], [first.id])).rejects.toThrow('LOKI_PATCH_SCOPE');
    const rows = await db.query<{ cloud_version: number }>('select cloud_version from loki_projects'); expect(rows.rows[0].cloud_version).toBe(1);
  });
  it('rejects incomplete hook patches but permits identical scoped hook updates', async () => {
    const project = createDemoProject(); await save(project, 0);
    const hook = project.lines.filter(item => item.repeatKey === 'demo-hook-0');
    await expect(patch(project, 1, [{ lineId: hook[0].id, expectedRevision: 0, newText: 'An identical new hook' }], hook.map(item => item.id))).rejects.toThrow('LOKI_LINKED_HOOK');
    await patch(project, 1, hook.map(item => ({ lineId: item.id, expectedRevision: 0, newText: 'An identical new hook' })), hook.map(item => item.id));
    const rows = await db.query<{ project: Project }>('select project from loki_projects');
    expect(rows.rows[0].project.lines.filter(item => item.repeatKey === 'demo-hook-0').map(item => item.text)).toEqual(['An identical new hook', 'An identical new hook']);
  });
  it('stores a recoverable AI result before a local manuscript has ever been cloud-saved', async () => {
    await db.query("insert into loki_jobs (id,owner_id,project_id,base_version,status,result) values ($1,'owner-a',$2,0,'proposed',$3::jsonb)", [randomUUID(), randomUUID(), JSON.stringify({ alternatives: [] })]);
    const rows = await db.query('select owner_id,status from loki_jobs');
    expect(rows.rows).toEqual([{ owner_id: 'owner-a', status: 'proposed' }]);
  });
  it('reserves durable AI budgets atomically under competing requests', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => quota('owner-a')));
    expect(results.filter(Boolean)).toHaveLength(8);
    const rows = await db.query<{ requests: number }>('select requests from loki_request_buckets');
    expect(rows.rows.map(item => item.requests)).toEqual([8, 8]);
  });
  it('enforces the catalogue ceiling across accounts sharing a server credential', async () => {
    for (const owner of ['owner-a', 'owner-b']) for (let i = 0; i < 3; i++) expect(await quota(owner, 'source', 10)).toBe(true);
    expect(await quota('owner-c', 'source')).toBe(false);
    expect(await quota('owner-c', 'source', 1, 'different-catalogue')).toBe(true);
  });
  it('does not partially spend a minute budget when its daily budget rejects a reservation', async () => {
    expect(await quota('owner-a')).toBe(true);
    await db.query("update loki_request_buckets set requests=40 where bucket_key like 'owner-a:ai:d:%'");
    expect(await quota('owner-a')).toBe(false);
    const rows = await db.query<{ requests: number }>("select requests from loki_request_buckets where bucket_key like 'owner-a:ai:m:%'");
    expect(rows.rows[0].requests).toBe(1);
  });
  it('rejects multiline content even if a caller bypasses the browser editor', async () => {
    const project = createDemoProject(); project.lines[0].text = 'First line\nSecond line';
    await expect(save(project, 0)).rejects.toThrow('LOKI_INVALID_LINE');
  });
});
