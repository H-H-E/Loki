import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { ApiError, body, consumeQuota, fail, postOnly, rateLimit, requireUser } from '../server/lib/http';
import { importSongServer, searchSongsServer } from '../server/lib/everysong';
import { songSchema } from '../server/lib/schemas';
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('search'), query: z.string().trim().min(3).max(120), kind: z.enum(['title','lyric','artist']).default('title') }),
  z.object({ action: z.literal('import'), song: songSchema }),
]);
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!postOnly(req, res)) return;
  try {
    const request = requestSchema.parse(body(req));
    if (!process.env.EVERYSONG_API_KEY) throw new ApiError(503, 'EverySong is not connected yet. Paste your lyrics to start writing.', 'EVERYSONG_NOT_CONFIGURED');
    const user = await requireUser(req); rateLimit(user, 'songs', 25);
    // Reserve each upstream read plus its one bounded retry conservatively.
    await consumeQuota(req, 'source', request.action === 'import' ? 10 : request.kind === 'artist' ? 4 : 2);
    if (request.action === 'search') return res.status(200).json({ results: await searchSongsServer(request.query, request.kind, user) });
    return res.status(200).json({ source: await importSongServer(request.song) });
  } catch (error) { return fail(res, error); }
}
