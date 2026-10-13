import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAuthConfigured } from '../server/lib/auth';
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Use GET.' }); }
  const cloud = isAuthConfigured();
  const everySong = cloud && Boolean(process.env.EVERYSONG_API_KEY);
  const ai = cloud && Boolean((process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY) && process.env.LLM_MODEL);
  return res.status(200).json({ everySong, ai, cloud, demo: !everySong && !ai });
}
