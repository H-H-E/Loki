import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let compiled;
before(async()=>{
  // Compile without a bundler or custom loader: Vercel's Node runtime must be
  // able to resolve every emitted relative JavaScript import by itself.
  compiled=await mkdtemp(path.join(root,'.server-runtime-'));
  async function emit(directory){
    for(const entry of await readdir(path.join(root,directory),{withFileTypes:true})){
      const relative=path.join(directory,entry.name);
      if(entry.isDirectory()) await emit(relative);
      else if(entry.name.endsWith('.ts')){
        const source=await readFile(path.join(root,relative),'utf8');
        const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,esModuleInterop:true}});
        const destination=path.join(compiled,relative.replace(/\.ts$/,'.js'));
        await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,outputText);
      }
    }
  }
  await emit('api');await emit('server');
});
after(async()=>{if(compiled) await rm(compiled,{recursive:true,force:true});});

for(const [endpoint,method,body,status] of [
  ['status','GET',undefined,200],
  ['auth','GET',undefined,503],
  ['projects','GET',undefined,503],
  ['songs','POST',{action:'invalid'},400],
  ['generate','POST',{action:'invalid'},400],
]) test(`plain Node cold import and request: /api/${endpoint}`,()=>{
  const moduleUrl=pathToFileURL(path.join(compiled,'api',`${endpoint}.js`)).href;
  const url=endpoint==='auth'?'/api/auth/get-session':`/api/${endpoint}`;
  const request={method,url,query:{},headers:{host:'studio.example.test',origin:'https://studio.example.test'},...(body===undefined?{}:{body})};
  const code=`
    const {default:handler}=await import(${JSON.stringify(moduleUrl)});
    if(typeof handler!=='function') throw new Error('Missing API handler export');
    const state={status:200,headers:{}};
    const res={setHeader(key,value){state.headers[key]=value;return this;},status(value){state.status=value;return this;},json(value){state.body=value;return this;},end(value){state.body=value;return this;}};
    await handler(${JSON.stringify(request)},res);
    process.stdout.write(JSON.stringify(state));
  `;
  const env={...process.env};
  for(const key of ['DATABASE_URL','DATABASE_URL_UNPOOLED','BETTER_AUTH_SECRET','BETTER_AUTH_URL','EVERYSONG_API_KEY','LLM_API_KEY','LLM_MODEL','OPENAI_API_KEY','AI_GATEWAY_API_KEY']) delete env[key];
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:root,env,encoding:'utf8',timeout:20_000});
  assert.equal(result.error,undefined);
  assert.equal(result.status,0,`Native ESM cold start failed: ${result.stderr}`);
  const state=JSON.parse(result.stdout);
  assert.equal(state.status,status);
  if(endpoint==='status') assert.deepEqual(state.body,{everySong:false,ai:false,cloud:false,demo:true});
  if(endpoint==='auth'||endpoint==='projects') assert.equal(state.body.code,'AUTH_NOT_CONFIGURED');
});
