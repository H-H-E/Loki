import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { ApiError, body, fail, postOnly, requireUser } from '../server/lib/http.js';
import { getSql, isDatabaseConfigured } from '../server/lib/db.js';
import { lineSchema, projectSchema } from '../server/lib/schemas.js';

const saveSchema = z.object({
  action: z.literal('save'),
  project: projectSchema.extend({
    lines: z.array(lineSchema).max(400),
    snapshots: z.array(z.object({ id: z.string(), label: z.string().max(500), createdAt: z.string(), data: z.record(z.unknown()) })).max(100),
  }),
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  allowStructure: z.boolean().default(false),
});

function databaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  const code = /LOKI_[A-Z_]+/.exec(message)?.[0];
  if (code === 'LOKI_VERSION_CONFLICT' || code === 'LOKI_STALE_LINE') throw new ApiError(409, code, code);
  if (code === 'LOKI_PROJECT_NOT_FOUND') throw new ApiError(404, 'That private project is unavailable.', code);
  if (code === 'LOKI_OWNER_MISMATCH') throw new ApiError(403, 'This project belongs to a different account.', code);
  if (code && ['LOKI_PROTECTED_LINE', 'LOKI_STRUCTURE_CHECKPOINT', 'LOKI_LINKED_HOOK', 'LOKI_INVALID_PROJECT', 'LOKI_INVALID_LINE', 'LOKI_DUPLICATE_LINE'].includes(code)) throw new ApiError(409, code, code);
  throw new ApiError(503, 'Private saving is unavailable. Your draft remains on this device. Check the Neon migration and try again.', 'DATABASE_UNAVAILABLE');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && !postOnly(req, res)) return;
  try {
    // Validate writes before authentication, preserving the bounded public request boundary.
    const input = req.method === 'POST' ? saveSchema.parse(body(req, 2 * 1024 * 1024)) : null;
    const owner = await requireUser(req);
    if (!isDatabaseConfigured()) throw new ApiError(503, 'Private saving needs Neon configured. Your draft remains on this device.', 'DATABASE_NOT_CONFIGURED');
    const sql = getSql();
    if (!input) {
      try {
        const rows = await sql`select id, title, updated_at, cloud_version, project from public.loki_projects
          where owner_id = ${owner} order by updated_at desc limit 100`;
        // Postgres int8 values can be strings in HTTP/pg drivers. The browser's
        // next CAS request must keep a numeric expectedVersion.
        const projects = rows.map(row => ({ ...row, cloud_version: Number(row.cloud_version) }));
        if (projects.some(row => !Number.isSafeInteger(row.cloud_version) || row.cloud_version < 0)) throw new Error('Invalid cloud revision');
        return res.status(200).json({ projects });
      } catch (error) { databaseError(error); }
    }
    if (input.project.ownerId !== null && input.project.ownerId !== owner) throw new ApiError(403, 'This project belongs to a different account.', 'LOKI_OWNER_MISMATCH');
    const normalized = { ...input.project, ownerId: owner };
    try {
      const rows = await sql`select public.save_loki_project(${owner}, ${JSON.stringify(normalized)}::jsonb, ${input.expectedVersion}, ${input.allowStructure}) as result`;
      const result = rows[0]?.result;
      if (!result || !Number.isSafeInteger(Number(result.cloud_version))) throw new Error('Private save was not confirmed');
      return res.status(200).json({ cloud_version: Number(result.cloud_version), project: result.project });
    } catch (error) { databaseError(error); }
  } catch (error) { return fail(res, error); }
}
