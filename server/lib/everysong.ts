import type { SongResult, Source } from '../../src/types.js';
import { ApiError, jsonFetch } from './http.js';

export function normalizedIdentity(value: unknown): string {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
export function identityMatches(a: { title?: unknown; artist?: unknown }, b: { title?: unknown; artist?: unknown }) {
  return !!a.title && !!a.artist && normalizedIdentity(a.title) === normalizedIdentity(b.title) && normalizedIdentity(a.artist) === normalizedIdentity(b.artist);
}
function str(value: unknown): string | null { return value === null || value === undefined || value === '' ? null : String(value); }
function number(value: unknown): number | null { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
export async function everySong(route: string, params: Record<string, string>): Promise<any> {
  const key = process.env.EVERYSONG_API_KEY;
  if (!key) throw new ApiError(503, 'EverySong is not connected yet. Paste your lyrics to start writing.', 'EVERYSONG_NOT_CONFIGURED');
  const url = new URL(`https://everysong.site/api/v2${route}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return jsonFetch(url.toString(), { headers: { 'x-api-key': key, Accept: 'application/json' } }, 23000);
}
export function normalizeSongResults(data: any, fallbackArtist = ''): SongResult[] {
  const results: SongResult[] = [];
  const visit = (value: any, inheritedArtist = fallbackArtist, depth = 0) => {
    if (depth > 5 || !value) return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, inheritedArtist, depth + 1)); return; }
    if (typeof value !== 'object') return;
    const rid = str(value.rid ?? value.recording_id);
    const title = str(value.title ?? value.name);
    const artist = str(value.artist ?? value.artist_name ?? inheritedArtist);
    if (rid && title && artist) results.push({ recordingId: rid, title, artist, streamingId: str(value.streaming_id), year: number(value.year) });
    for (const key of ['results', 'songs', 'tracks', 'albums', 'items']) if (value[key]) visit(value[key], str(value.artist) ?? inheritedArtist, depth + 1);
  };
  visit(data);
  return Array.from(new Map(results.map(song => [song.recordingId, song])).values()).slice(0, 12);
}
const queryCache = new Map<string, { expires: number; promise: Promise<SongResult[]> }>();
export async function searchSongsServer(query: string, kind: 'title'|'lyric'|'artist', userId: string): Promise<SongResult[]> {
  const key = `${userId}:${kind}:${query.toLowerCase()}`;
  const cached = queryCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = (async () => {
    if (kind === 'title') return normalizeSongResults(await everySong('/spine/search', { q: query, limit: '12' }));
    if (kind === 'lyric') return normalizeSongResults(await everySong('/lyrics/search', { q: query, limit: '12' }));
    const raw = await everySong('/spine/artists', { q: query, limit: '1' });
    const artists = Array.isArray(raw) ? raw : raw.results ?? raw.artists ?? raw.items ?? [];
    const first = artists[0];
    if (!first) return [];
    const artistName = str(first.name ?? first.artist) ?? query;
    return normalizeSongResults(await everySong('/spine/artist_songs', first.an ? { a_norm: String(first.an), limit: '12' } : { name: artistName, limit: '12' }), artistName);
  })();
  queryCache.set(key, { expires: Date.now() + 20000, promise });
  if (queryCache.size > 200) for (const [key, item] of queryCache) if (item.expires < Date.now()) queryCache.delete(key);
  try { return await promise; } catch (error) { queryCache.delete(key); throw error; }
}
export async function importSongServer(selected: SongResult): Promise<Source> {
  const [songRaw, idsRaw] = await Promise.all([
    everySong('/spine/song', { rid: selected.recordingId }),
    everySong('/spine/ids', { rids: selected.recordingId }),
  ]);
  const song = songRaw.song ?? songRaw;
  if (str(song.rid) !== selected.recordingId || !identityMatches(selected, song)) throw new ApiError(409, 'This recording does not match the song you selected. Choose another result.', 'RECORDING_MISMATCH');
  const ids = idsRaw.ids?.[selected.recordingId] ?? {};
  const lyricsId = str(ids.lyrics_id);
  const streamingId = str(song.streaming_id);
  const [lyricsRaw, featuresRaw, trackRaw] = await Promise.all([
    lyricsId ? everySong('/lyrics/text', { lyrics_id: lyricsId }).catch(error => { if (error instanceof ApiError && error.status === 404) return null; throw error; }) : null,
    streamingId ? everySong('/songs/features', { streaming_id: streamingId }).catch(() => null) : null,
    streamingId ? everySong('/spine/track', { streaming_id: streamingId }).catch(() => null) : null,
  ]);
  const lyrics = lyricsRaw?.lyrics && typeof lyricsRaw.lyrics === 'object' ? lyricsRaw.lyrics : lyricsRaw;
  if (lyrics && (!identityMatches(song, lyrics) || str(lyrics.lyrics_id) !== lyricsId)) throw new ApiError(409, 'The returned lyrics belong to a different recording. Paste and confirm the right lyrics instead.', 'LYRICS_MISMATCH');
  const features = featuresRaw?.features ?? null;
  const track = trackRaw?.track ?? trackRaw;
  return {
    title: String(song.title), artist: String(song.artist), recordingId: selected.recordingId,
    lyricsId, streamingId, year: number(song.year), album: str(track?.album?.name),
    key: str(features?.key_name), bpm: number(features?.tempo), timeSignature: number(features?.time_signature), durationMs: number(track?.duration_ms),
    language: str(lyrics?.language), provenance: 'EverySong API v2: recording identity and lyrics crosswalk', confirmed: false,
    originalText: typeof lyrics?.lyrics === 'string' ? lyrics.lyrics : '',
  };
}
