import type { Alternative, GenerationResult, PremiseDirection, Project, SongResult, Source } from '../types';
export class ApiClientError extends Error {
  constructor(message: string, public status: number, public code: string, public retryAfter?: number) { super(message); }
}
export async function request<T>(path: string, payload?: unknown): Promise<T> {
  const headers: Record<string,string> = { Accept: 'application/json' };
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try { response = await fetch(`/api/${path}`, { method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(path === 'generate' ? 125000 : 90000) }); }
  catch { throw new ApiClientError('The connection timed out. Your draft is still saved locally.', 0, 'NETWORK_ERROR'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiClientError(result.error || 'This request is unavailable. Try again later.', response.status, result.code || 'REQUEST_FAILED', result.retryAfter);
  return result as T;
}
function writingContext(project: Project) {
  return { id: project.id, ownerId: project.ownerId, title: project.title, version: project.version, source: { title: project.source.title, artist: project.source.artist, confirmed: project.source.confirmed }, premise: project.premise, sections: project.sections, lines: project.lines.map(({ id, sectionId, position, sourceText, text, revision, protected: locked, repeatKey, language, dialect }) => ({ id, sectionId, position, sourceText, text, revision, protected: locked, repeatKey, language, dialect })) };
}
const searches = new Map<string,{ expires: number; promise: Promise<SongResult[]> }>();
export function searchSongs(query: string, kind: 'title'|'lyric'|'artist' = 'title'): Promise<SongResult[]> {
  const trimmed = query.trim(); if (trimmed.length < 3) return Promise.resolve([]);
  const key = `${kind}:${trimmed.toLowerCase()}`;
  const cached = searches.get(key); if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = request<{results:SongResult[]}>('songs', { action:'search', query:trimmed, kind }).then(result => result.results);
  searches.set(key, {expires:Date.now()+20000,promise});
  promise.catch(() => searches.delete(key));
  if (searches.size > 100) for (const [key,item] of searches) if (item.expires < Date.now()) searches.delete(key);
  return promise;
}
export async function importSong(song:SongResult):Promise<Source> { return (await request<{source:Source}>('songs',{action:'import',song})).source; }
export async function getPremiseDirections(project:Project):Promise<PremiseDirection[]> { return (await request<{directions:PremiseDirection[]}>('generate',{action:'directions',project:writingContext(project)})).directions; }
export function generateDraft(project:Project,scope:'chorus'|'song'|'section',lineIds?:string[]):Promise<GenerationResult> { return request('generate',{action:'draft',project:writingContext(project),scope,lineIds}); }
export async function getAlternatives(project:Project,lineId:string,intent?:string):Promise<Alternative[]> { return (await request<{alternatives:Alternative[]}>('generate',{action:'alternatives',project:writingContext(project),lineId,intent})).alternatives; }
export async function reviewProject(project:Project):Promise<{lineId:string;status:string;note:string}[]> { return (await request<{notes:{lineId:string;status:string;note:string}[]}>('generate',{action:'review',project:writingContext(project)})).notes; }
export function generatePolish(project:Project,lineIds?:string[]):Promise<GenerationResult> { return request('generate',{action:'polish',project:writingContext(project),lineIds}); }
export function getProviderStatus():Promise<{everySong:boolean;ai:boolean;cloud:boolean;demo:boolean}> { return request('status'); }
