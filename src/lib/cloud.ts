import { useEffect } from 'react';
import { create } from 'zustand';
import type { Project } from '../types';
import { useStudioStore } from './store';
import { authClient } from './auth-client';
import { ApiClientError, getProviderStatus, request } from './api';
import { validateProject } from './engine';

export type CloudSession = { user: { id: string; email: string; name?: string } };
export type CloudProject = { id: string; title: string; updated_at: string; cloud_version: number; project: Project };
interface CloudState { configured: boolean | null; session: CloudSession | null; status: string; error: string | null; busy: boolean; projects: CloudProject[]; revision: number; }
export const useCloudStore = create<CloudState>(() => ({ configured: null, session: null, status: 'Saved on this device', error: null, busy: false, projects: [], revision: 0 }));
const versions = new Map<string, number>();
const savedHashes = new Map<string, string>();
const paused = new Set<string>();
let flight: Promise<void> | null = null;
let sessionGeneration = 0;

export function projectFingerprint(project: Project): string {
  const { ownerId: _owner, ...content } = project;
  return JSON.stringify(content);
}
export function cloudErrorMessage(error: { message?: string; code?: string } | null): string {
  if (!error) return 'Cloud saving failed. Your draft remains on this device.';
  const kind = `${error.code || ''} ${error.message || ''}`;
  if (kind.includes('LOKI_VERSION_CONFLICT')) return 'Cloud has a newer revision. Your local draft is safe. Load the cloud revision to compare; a local recovery copy will be kept.';
  if (kind.includes('LOKI_PROTECTED_LINE')) return 'A protected cloud line changed. Your local draft is safe. Load the cloud revision and unlock that line before editing.';
  if (kind.includes('LOKI_STRUCTURE_CHECKPOINT')) return 'Changing source structure needs a saved checkpoint. Your local draft is safe.';
  if (kind.includes('AUTH_REQUIRED')) return 'Sign in again to resume cloud saving. Your draft remains on this device.';
  return `${error.message || 'Cloud is unavailable'}. Your draft remains on this device.`;
}
export function applyCloudSession(next: CloudSession | null): void {
  const sameUser = next?.user.id === useCloudStore.getState().session?.user.id;
  if (!sameUser) {
    sessionGeneration++;
    versions.clear(); savedHashes.clear(); paused.clear();
  }
  useCloudStore.setState(s => ({ session: next, busy: sameUser ? s.busy : false, projects: sameUser ? s.projects : [], status: sameUser ? s.status : next ? 'Cloud ready · local drafts stay local until saved' : 'Saved on this device', error: sameUser ? s.error : null }));
}
function reportCloudError(error: unknown): void {
  if (error instanceof ApiClientError && error.status === 401) applyCloudSession(null);
  useCloudStore.setState({ busy: false, error: cloudErrorMessage(error instanceof Error ? error : null), status: 'Saved locally · cloud needs attention' });
}
export async function refreshCloudSession(): Promise<void> {
  if (!useCloudStore.getState().configured) return;
  const generation = sessionGeneration;
  try {
    const result = await authClient.getSession();
    if (generation !== sessionGeneration) return;
    if (result.error) throw new Error(result.error.message || 'Sign-in is unavailable');
    const next = result.data ? { user: { id: result.data.user.id, email: result.data.user.email, name: result.data.user.name } } : null;
    applyCloudSession(next);
    if (next) await refreshCloudProjects();
  } catch (error) { if (generation === sessionGeneration) reportCloudError(error); }
}
export async function refreshCloudProjects(): Promise<void> {
  const userId = useCloudStore.getState().session?.user.id;
  const generation = sessionGeneration;
  if (!useCloudStore.getState().configured || !userId) return;
  try {
    const result = await request<{ projects: CloudProject[] }>('projects');
    if (generation !== sessionGeneration) return;
    useCloudStore.setState(s => ({ projects: result.projects.map(row => {
      const known = s.projects.find(item => item.id === row.id);
      return known && known.cloud_version > row.cloud_version ? known : row;
    }), error: null }));
  } catch (error) { if (generation === sessionGeneration) reportCloudError(error); }
}
function structureChanged(a: Project, b: Project): boolean {
  return JSON.stringify(a.sections) !== JSON.stringify(b.sections) || JSON.stringify(a.lines.map(l => [l.id,l.sectionId,l.position,l.sourceText])) !== JSON.stringify(b.lines.map(l => [l.id,l.sectionId,l.position,l.sourceText]));
}
export async function saveToCloud(project = useStudioStore.getState().project): Promise<void> {
  while (flight) { try { await flight; } catch { /* The earlier write reports its own recoverable error. */ } }
  const userId = useCloudStore.getState().session?.user.id;
  const generation = sessionGeneration;
  if (!useCloudStore.getState().configured || !userId) return;
  if (project.ownerId && project.ownerId !== userId) {
    useCloudStore.setState({ error: 'This manuscript belongs to another signed-in account. Duplicate it in your local library before saving to this account.', status: 'Saved on this device' });
    return;
  }
  const copy: Project = structuredClone({ ...project, ownerId: userId });
  const previous = useCloudStore.getState().projects.find(p => p.id === copy.id);
  if (!versions.has(copy.id) && previous && projectFingerprint(previous.project) !== projectFingerprint(copy)) {
    paused.add(copy.id);
    useCloudStore.setState({ error: cloudErrorMessage({ code: 'LOKI_VERSION_CONFLICT' }), status: 'Saved locally · cloud comparison required' });
    return;
  }
  const expectedVersion = versions.get(copy.id) ?? previous?.cloud_version ?? 0;
  useCloudStore.setState({ busy: true, error: null, status: 'Saving to cloud…' });
  const task = (async () => {
    let expected = expectedVersion;
    // Save the explicit unlock without editing protected text. The next CAS write
    // changes the line only after the server has accepted that unlocked revision.
    const unlocks = previous?.project.lines.filter(old => old.protected && copy.lines.some(next => next.id === old.id && !next.protected && next.text !== old.text)) || [];
    if (unlocks.length) {
      const intermediate = { ...copy, lines: copy.lines.map(line => { const old = unlocks.find(item => item.id === line.id); return old ? { ...line, text: old.text } : line; }) };
      const unlock = await request<{ cloud_version: number }>('projects', { action: 'save', project: intermediate, expectedVersion: expected, allowStructure: !!previous && structureChanged(previous.project, intermediate) });
      if (generation !== sessionGeneration) return;
      expected = unlock.cloud_version;
      versions.set(copy.id, expected);
      // Keep the successfully saved unlock as our baseline even if the second
      // write fails. Retrying must not try to undo the server's accepted unlock.
      useCloudStore.setState(s => ({ projects: s.projects.map(row => row.id === copy.id ? { ...row, project: intermediate, cloud_version: expected } : row) }));
    }
    if (generation !== sessionGeneration) return;
    const result = await request<{ cloud_version: number }>('projects', { action: 'save', project: copy, expectedVersion: expected, allowStructure: !!previous && structureChanged(previous.project, copy) });
    if (generation !== sessionGeneration) return;
    versions.set(copy.id, result.cloud_version);
    savedHashes.set(copy.id, projectFingerprint(copy));
    paused.delete(copy.id);
    // Bind the accepted local manuscript to its account without replacing any
    // edits made while this request was in flight.
    useStudioStore.setState(s => ({
      project: s.project.id === copy.id ? { ...s.project, ownerId: userId } : s.project,
      projects: s.projects.map(p => p.id === copy.id ? { ...p, ownerId: userId } : p),
    }));
    // Record the accepted revision immediately so another explicit save never
    // relies on an outdated baseline while the list request is still pending.
    const row: CloudProject = { id: copy.id, title: copy.title, updated_at: copy.updatedAt, cloud_version: result.cloud_version, project: copy };
    useCloudStore.setState(s => ({ projects: [row, ...s.projects.filter(p => p.id !== copy.id)], busy: false, status: `Saved to cloud · revision ${result.cloud_version}`, error: null, revision: s.revision + 1 }));
    await refreshCloudProjects();
  })();
  flight = task;
  try { await task; } catch (error) {
    if (generation === sessionGeneration) { paused.add(copy.id); reportCloudError(error); }
  } finally { if (flight === task) flight = null; }
}
export function loadCloudProject(row: CloudProject): void {
  const userId = useCloudStore.getState().session?.user.id;
  if (!userId || row.project.ownerId !== userId) {
    useCloudStore.setState({ error: 'Sign in to the account that owns this cloud manuscript.', status: 'Saved on this device' });
    return;
  }
  try { validateProject(row.project); } catch (error) { reportCloudError(error); return; }
  const current = useStudioStore.getState().project;
  if (current.id === row.id && projectFingerprint(current) !== projectFingerprint(row.project)) {
    useStudioStore.getState().importProject({ ...current, id: crypto.randomUUID(), ownerId: null, title: `${current.title} (local recovery)`, updatedAt: new Date().toISOString() });
  }
  versions.set(row.id, row.cloud_version);
  savedHashes.set(row.id, projectFingerprint(row.project));
  paused.delete(row.id);
  useStudioStore.getState().importProject(row.project);
  useCloudStore.setState({ status: `Loaded cloud revision ${row.cloud_version}`, error: null });
}
export function useCloudSync(): void {
  const project = useStudioStore(s => s.project);
  const session = useCloudStore(s => s.session);
  const revision = useCloudStore(s => s.revision);
  useEffect(() => {
    let active = true;
    void getProviderStatus().then(async config => {
      if (!active) return;
      useCloudStore.setState({ configured: config.cloud, status: config.cloud ? 'Sign in for cloud saving' : 'Saved on this device' });
      if (config.cloud) await refreshCloudSession();
    }).catch(() => { if (active) useCloudStore.setState({ configured: false, status: 'Saved on this device', error: 'Cloud service is unavailable. Your local drafts are safe.' }); });
    // Recheck httpOnly cookie sessions after returning to the page. Passwords
    // and session tokens never enter local storage or project exports.
    const focus = () => { if (useCloudStore.getState().configured) void refreshCloudSession(); };
    window.addEventListener('focus', focus);
    return () => { active = false; window.removeEventListener('focus', focus); };
  }, []);
  useEffect(() => {
    if (!session || !versions.has(project.id) || paused.has(project.id) || savedHashes.get(project.id) === projectFingerprint(project)) return;
    useCloudStore.setState({ status: navigator.onLine ? 'Saved locally · cloud save pending' : 'Offline · saved on this device' });
    const timer = window.setTimeout(() => { if (navigator.onLine) void saveToCloud(useStudioStore.getState().project); }, 1000);
    return () => window.clearTimeout(timer);
  }, [project, session, revision]);
  useEffect(() => {
    const online = () => { const current = useStudioStore.getState().project; if (useCloudStore.getState().session && versions.has(current.id) && !paused.has(current.id)) void saveToCloud(current); };
    const offline = () => useCloudStore.setState({ status: 'Offline · saved on this device' });
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);
}
