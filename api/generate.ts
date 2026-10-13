import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { ApiError, body, consumeQuota, fail, postOnly, rateLimit, requireUser } from '../server/lib/http';
import { saveJobResult } from '../server/lib/jobs';
import { projectSchema } from '../server/lib/schemas';
import { ensureAiConfigured, runGeneration } from '../server/lib/generation';
const requestSchema = z.object({ action: z.enum(['directions','draft','alternatives','review','polish']), project: projectSchema, scope: z.enum(['chorus','song','section']).default('song'), lineIds: z.array(z.string().max(500)).max(400).optional(), lineId: z.string().max(500).optional(), intent: z.string().max(2000).optional() });
export const config = { maxDuration: 120 };
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!postOnly(req, res)) return;
  try {
    const request = requestSchema.parse(body(req)); ensureAiConfigured(); const user = await requireUser(req);
    if (request.project.ownerId && request.project.ownerId !== user) return res.status(403).json({ error: 'This project belongs to another account.', code: 'FORBIDDEN' });
    if (new Set(request.project.lines.map(line => line.id)).size !== request.project.lines.length) throw new ApiError(400, 'Each lyric line needs a unique identifier.', 'DUPLICATE_LINE_IDS');
    rateLimit(user, 'ai', 8); await consumeQuota(req, 'ai');
    const result = await runGeneration(request.project, request.action, request.scope, request.lineIds, request.lineId, request.intent);
    const jobId = 'jobId' in result ? result.jobId : randomUUID();
    await saveJobResult(req, user, request.project.id, request.project.version, jobId, { ...result, action:request.action, jobId, projectId:request.project.id, baseVersion:request.project.version });
    return res.status(200).json({ ...result, jobId });
  } catch (error) { return fail(res, error); }
}
