import type { VercelRequest } from '@vercel/node';
import { ApiError, requireUser } from './http';
import { getSql, isDatabaseConfigured } from './db';
export async function saveJobResult(req: VercelRequest, ownerId: string, projectId: string, baseVersion: number, jobId: string, result: unknown) {
  if (!isDatabaseConfigured()) throw new ApiError(503, 'Job recovery needs Neon configured.', 'JOB_STORAGE_NOT_CONFIGURED');
  const actor = await requireUser(req);
  if (actor !== ownerId) throw new ApiError(403, 'The candidate belongs to a different account.', 'LOKI_OWNER_MISMATCH');
  try {
    const sql = getSql();
    const stored = await sql`insert into public.loki_jobs (id, owner_id, project_id, base_version, status, result)
      values (${jobId}::uuid, ${actor}, ${projectId}::uuid, ${baseVersion}, 'proposed', ${JSON.stringify(result)}::jsonb)
      on conflict (id) do nothing returning id`;
    if (stored[0]?.id !== jobId) throw new Error('Job persistence not confirmed');
  } catch { throw new ApiError(503, 'The candidate could not be saved for recovery. Nothing was applied. Check cloud storage and try again.', 'JOB_STORAGE_UNAVAILABLE'); }
}
