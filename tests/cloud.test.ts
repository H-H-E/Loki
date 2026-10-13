import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/auth-client', () => ({ authClient: { getSession: vi.fn() } }));
import { applyCloudSession, cloudErrorMessage, loadCloudProject, projectFingerprint, refreshCloudProjects, refreshCloudSession, saveToCloud, useCloudStore, type CloudProject } from '../src/lib/cloud';
import { authClient } from '../src/lib/auth-client';
import { createDemoProject } from '../src/lib/demo';
import { useStudioStore } from '../src/lib/store';
import type { Project } from '../src/types';

const user = { user: { id: 'writer-one', email: 'writer@example.com', name: 'Writer' } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const row = (project: Project, version = 1): CloudProject => ({ id: project.id, title: project.title, updated_at: project.updatedAt, cloud_version: version, project: { ...project, ownerId: user.user.id } });
beforeEach(() => {
  applyCloudSession(null);
  useCloudStore.setState({ configured: true });
  const project = createDemoProject();
  useStudioStore.setState({ project, projects: [project], undoStack: [] });
  applyCloudSession(user);
});
afterEach(() => { applyCloudSession(null); vi.unstubAllGlobals(); });

describe('cloud conflict recovery', () => {
  it('compares manuscript content independently from the signed-in owner', () => {
    const project = createDemoProject();
    expect(projectFingerprint(project)).toBe(projectFingerprint({ ...project, ownerId: 'new-owner' }));
    expect(projectFingerprint(project)).not.toBe(projectFingerprint({ ...project, title: 'Edited manuscript' }));
  });
  it('gives recoverable actions for structured server errors', () => {
    expect(cloudErrorMessage({ code: 'LOKI_VERSION_CONFLICT' })).toContain('local recovery copy');
    expect(cloudErrorMessage({ code: 'LOKI_PROTECTED_LINE' })).toContain('unlock');
    expect(cloudErrorMessage({ code: 'LOKI_STRUCTURE_CHECKPOINT' })).toContain('checkpoint');
    expect(cloudErrorMessage(null)).toContain('remains on this device');
  });
  it('explicitly enrolls a local draft through the cookie-authenticated server', async () => {
    const project = useStudioStore.getState().project;
    const outbound = vi.fn(async (_path: string, options: RequestInit) => options.method === 'POST' ? json({ cloud_version: 1 }) : json({ projects: [row(project)] }));
    vi.stubGlobal('fetch', outbound);
    await saveToCloud(project);
    expect(outbound).toHaveBeenCalledTimes(2);
    const [path, options] = outbound.mock.calls[0];
    expect(path).toBe('/api/projects');
    expect(options.credentials).toBe('same-origin');
    expect(options.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(options.body as string)).toMatchObject({ action: 'save', expectedVersion: 0, project: { ownerId: user.user.id } });
    expect(useStudioStore.getState().project.ownerId).toBe(user.user.id);
    expect(useCloudStore.getState().status).toContain('revision 1');
  });
  it('does not overwrite a different cloud revision on a first save after signing in', async () => {
    const project = useStudioStore.getState().project;
    const remote = row({ ...project, title: 'Cloud has edits' }, 8);
    useCloudStore.setState({ projects: [remote] });
    const outbound = vi.fn(); vi.stubGlobal('fetch', outbound);
    await saveToCloud(project);
    expect(outbound).not.toHaveBeenCalled();
    expect(useCloudStore.getState().error).toContain('local recovery copy');
    expect(useStudioStore.getState().project.title).toBe(project.title);
  });
  it('retains an unsaved local recovery copy before loading a newer same-id manuscript', () => {
    const project = useStudioStore.getState().project;
    loadCloudProject(row({ ...project, title: 'Cloud revision' }, 9));
    const recovery = useStudioStore.getState().projects.find(p => p.title === `${project.title} (local recovery)`);
    expect(recovery?.id).not.toBe(project.id);
    expect(recovery?.ownerId).toBeNull();
    expect(recovery?.lines).toEqual(project.lines);
    expect(useStudioStore.getState().project.title).toBe('Cloud revision');
  });
  it('saves an explicit unlock before changing protected cloud text', async () => {
    const project = useStudioStore.getState().project;
    const cloud = row({ ...project, lines: project.lines.map((line, index) => index === 0 ? { ...line, protected: true } : line) }, 3);
    loadCloudProject(cloud);
    const edited = { ...cloud.project, version: cloud.project.version + 2, lines: cloud.project.lines.map((line, index) => index === 0 ? { ...line, protected: false, text: 'The newly unlocked words', revision: line.revision + 2 } : line) };
    useCloudStore.setState({ projects: [cloud] });
    const writes: { expectedVersion: number; project: Project }[] = [];
    const outbound = vi.fn(async (_path: string, options: RequestInit) => {
      if (options.method === 'POST') { writes.push(JSON.parse(options.body as string)); return json({ cloud_version: 3 + writes.length }); }
      return json({ projects: [row(edited, 5)] });
    });
    vi.stubGlobal('fetch', outbound);
    await saveToCloud(edited);
    expect(writes).toHaveLength(2);
    expect(writes[0].expectedVersion).toBe(3);
    expect(writes[0].project.lines[0]).toMatchObject({ protected: false, text: cloud.project.lines[0].text });
    expect(writes[1].expectedVersion).toBe(4);
    expect(writes[1].project.lines[0].text).toBe('The newly unlocked words');
  });
  it('keeps a failed second write recoverable after the unlock was accepted', async () => {
    const project = useStudioStore.getState().project;
    const cloud = row({ ...project, lines: project.lines.map((line, index) => index === 0 ? { ...line, protected: true } : line) }, 3);
    loadCloudProject(cloud); useCloudStore.setState({ projects: [cloud] });
    const edited = { ...cloud.project, lines: cloud.project.lines.map((line, index) => index === 0 ? { ...line, protected: false, text: 'New words' } : line) };
    let count = 0;
    const outbound = vi.fn(async () => ++count === 1 ? json({ cloud_version: 4 }) : json({ error: 'Network interrupted', code: 'UPSTREAM_ERROR' }, 503));
    vi.stubGlobal('fetch', outbound);
    await saveToCloud(edited);
    expect(useCloudStore.getState().projects[0].cloud_version).toBe(4);
    expect(useCloudStore.getState().projects[0].project.lines[0]).toMatchObject({ protected: false, text: cloud.project.lines[0].text });
    expect(useCloudStore.getState().error).toContain('remains on this device');
    expect(useCloudStore.getState().busy).toBe(false);
  });
  it('discards a delayed response from a signed-out account and preserves local drafts', async () => {
    const project = useStudioStore.getState().project;
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveResponse = resolve; })));
    const saving = saveToCloud(project);
    applyCloudSession(null);
    resolveResponse(json({ cloud_version: 1 }));
    await saving;
    expect(useCloudStore.getState().session).toBeNull();
    expect(useCloudStore.getState().projects).toEqual([]);
    expect(useCloudStore.getState().busy).toBe(false);
    expect(useStudioStore.getState().project).toEqual(project);
  });
  it('does not save an account-bound local manuscript under a different account', async () => {
    const project = { ...useStudioStore.getState().project, ownerId: 'another-writer' };
    const outbound = vi.fn(); vi.stubGlobal('fetch', outbound);
    await saveToCloud(project);
    expect(outbound).not.toHaveBeenCalled();
    expect(useCloudStore.getState().error).toContain('Duplicate');
  });
  it('ignores a session refresh that completes after sign-out', async () => {
    let resolveSession!: (value: unknown) => void;
    vi.mocked(authClient.getSession).mockImplementationOnce(() => new Promise(resolve => { resolveSession = resolve as (value: unknown) => void; }));
    const refreshing = refreshCloudSession();
    applyCloudSession(null);
    resolveSession({ data: user, error: null });
    await refreshing;
    expect(useCloudStore.getState().session).toBeNull();
  });
  it('clears expired session state after a server authentication failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Please sign in', code: 'AUTH_REQUIRED' }, 401)));
    await refreshCloudProjects();
    expect(useCloudStore.getState().session).toBeNull();
    expect(useCloudStore.getState().error).toContain('Sign in again');
  });
});
