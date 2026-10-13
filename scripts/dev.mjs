import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import { loadEnv } from 'vite';
for (const [key,value] of Object.entries(loadEnv('development',process.cwd(),''))) if (process.env[key] === undefined) process.env[key] = value;
const require = createRequire(import.meta.url);
const { tsImport } = require('tsx/esm/api');
const routes = { '/api/songs':'../api/songs.ts', '/api/generate':'../api/generate.ts', '/api/status':'../api/status.ts', '/api/projects':'../api/projects.ts', '/api/auth':'../api/auth.ts' };
const handlers = Object.fromEntries(await Promise.all(Object.entries(routes).map(async ([path,file]) => [path,(await tsImport(file,import.meta.url)).default])));
const api = http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost:3001');
  const path = url.pathname;
  const authRoute = path === '/api/auth' || path.startsWith('/api/auth/');
  const handler = handlers[authRoute ? '/api/auth' : path];
  const send = (status,payload) => { res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(payload)); };
  if (!handler) return send(404,{error:'Unknown API route.'});
  req.query = Object.fromEntries(url.searchParams.entries());
  // Match Vercel's parsed body adapter, retaining original URL and native
  // response so nested auth routes and multiple cookies behave locally too.
  let raw = '';
  const limit = path === '/api/projects' ? 2 * 1024 * 1024 : 160000;
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw)>limit) return send(413,{error:'Request too large.'});
  }
  const isJson = String(req.headers['content-type'] ?? '').includes('application/json');
  if (authRoute && !isJson) req.body = raw || undefined;
  else try { req.body = raw ? JSON.parse(raw) : {}; } catch { return send(400,{error:'Invalid JSON.'}); }
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(value)); return res; };
  try { await handler(req,res); } catch { if (!res.writableEnded) send(500,{error:'The local API encountered an error.'}); }
});
api.listen(3001,'127.0.0.1',()=>process.stdout.write('Loki API listening on http://127.0.0.1:3001\n'));
const frontend = spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4173','--strictPort'],{stdio:'inherit',env:process.env});
let startupFailed = false;
api.once('error', error => {
  startupFailed = true;
  process.stderr.write(error.code === 'EADDRINUSE' ? 'Loki API port 3001 is already in use. Stop the previous local instance before starting another.\n' : `Loki API could not start: ${error.message}\n`);
  frontend.kill('SIGTERM');
  process.exitCode = 1;
});
frontend.once('error', error => {
  startupFailed = true;
  process.stderr.write(`Loki frontend could not start: ${error.message}\n`);
  api.close();
  process.exitCode = 1;
});
function stop() { frontend.kill('SIGTERM'); api.close(); }
process.once('SIGINT',stop); process.once('SIGTERM',stop);
frontend.once('exit',code=>{api.close();process.exitCode=startupFailed?1:code??0;});
