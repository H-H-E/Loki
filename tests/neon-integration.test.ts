import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getMigrations } from 'better-auth/db/migration';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import authHandler from '../api/auth';
import projectHandler from '../api/projects';
import { closeAuthPool, getAuth, requireSessionUser } from '../server/lib/auth';
import { createDemoProject } from '../src/lib/demo';

const runtime = vi.hoisted(() => ({db:null as PGlite|null}));
// Substitute transport only: Better Auth, Kysely, cookies and SQL run unchanged
// against a real PostgreSQL engine, without touching a remote user database.
vi.mock('pg', () => {
  const query = async (text:string, parameters:unknown[] = []) => {
    const result=await runtime.db!.query(text,parameters);
    return {rows:result.rows,rowCount:result.affectedRows??result.rows.length,command:/^\s*([A-Z]+)/i.exec(text)?.[1].toUpperCase()};
  };
  return {Pool:class {
    on(){return this;}
    async connect(){return {query,release(){},processID:1};}
    query=query;
    async end(){}
  }};
});
vi.mock('../server/lib/db',()=>({
  isDatabaseConfigured:()=>true,
  getSql:()=>async (strings:TemplateStringsArray,...parameters:unknown[])=>{
    const text=strings.reduce((sql,segment,index)=>sql+(index?`$${index}`:'')+segment,'');
    return (await runtime.db!.query(text,parameters)).rows;
  },
}));
function request(url:string,body?:unknown,cookie?:string):VercelRequest {
  return {method:body===undefined?'GET':'POST',url,query:{},body,
    headers:{host:'studio.example.test',origin:'https://studio.example.test','content-type':'application/json','x-real-ip':'127.0.0.1',...(cookie?{cookie}:{})}} as unknown as VercelRequest;
}
function response(){
  const state={status:200,body:undefined as unknown,headers:{} as Record<string,string|string[]>};
  const res={
    setHeader(name:string,value:string|string[]){state.headers[name.toLowerCase()]=value;return this;},
    status(code:number){state.status=code;return this;},
    json(body:unknown){state.body=body;return this;},
    end(body:string){state.body=body?JSON.parse(body):undefined;return this;},
  } as unknown as VercelResponse;
  return {state,res};
}
async function auth(url:string,body?:unknown,cookie?:string){const {state,res}=response();await authHandler(request(`/api/auth/${url}`,body,cookie),res);return state;}
function sessionCookie(state:Awaited<ReturnType<typeof auth>>):string {
  const cookies=state.headers['set-cookie'];
  expect(Array.isArray(cookies)).toBe(true);
  return (cookies as string[]).map(cookie=>cookie.split(';')[0]).join('; ');
}
async function projects(body:unknown|undefined,cookie:string){const {state,res}=response();await projectHandler(request('/api/projects',body,cookie),res);return state;}

beforeAll(async()=>{
  vi.stubEnv('DATABASE_URL','postgresql://test:test@localhost/loki_test');
  vi.stubEnv('BETTER_AUTH_SECRET','integration-only-secret-that-is-at-least-32-characters');
  vi.stubEnv('BETTER_AUTH_URL','https://studio.example.test');
  vi.stubEnv('VERCEL','');vi.stubEnv('VERCEL_ENV','');
  runtime.db=new PGlite();
  const migration=await getMigrations(getAuth()!.options);
  await migration.runMigrations();
  await runtime.db.exec(await readFile(new URL('../db/migrations/001_loki.sql',import.meta.url),'utf8'));
},30_000);
afterAll(async()=>{await closeAuthPool();await runtime.db?.close();vi.unstubAllEnvs();});

describe('Neon authentication and private persistence integration',()=>{
  it('creates two real cookie sessions, isolates private projects and rejects stale saves',async()=>{
    const first=await auth('sign-up/email',{email:'first@example.test',password:'Strong-test-password-1',name:'First author'});
    const second=await auth('sign-up/email',{email:'second@example.test',password:'Strong-test-password-2',name:'Second author'});
    expect(first.status).toBe(200);expect(second.status).toBe(200);
    const firstCookie=sessionCookie(first),secondCookie=sessionCookie(second);
    expect(first.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('HttpOnly')]));
    expect((first.headers['set-cookie'] as string[]).join(' ')).toContain('Secure');
    const firstUser=await requireSessionUser(request('/api/projects',undefined,firstCookie));
    const secondUser=await requireSessionUser(request('/api/projects',undefined,secondCookie));
    expect(firstUser.id).not.toBe(secondUser.id);
    const project={...createDemoProject(),ownerId:firstUser.id};
    const saved=await projects({action:'save',project,expectedVersion:0},firstCookie);
    expect(saved.status).toBe(200);expect(saved.body).toMatchObject({cloud_version:1});
    const own=await projects(undefined,firstCookie);expect(own.body).toMatchObject({projects:[{id:project.id}]});
    const other=await projects(undefined,secondCookie);expect(other.status).toBe(200);expect(other.body).toEqual({projects:[]});
    const explicitAttack=await projects({action:'save',project,expectedVersion:1},secondCookie);
    expect(explicitAttack.status).toBe(403);
    const hiddenOwnerAttack=await projects({action:'save',project:{...project,ownerId:null},expectedVersion:1},secondCookie);
    expect(hiddenOwnerAttack.status).toBe(404);
    const stale=await projects({action:'save',project,expectedVersion:0},firstCookie);
    expect(stale.status).toBe(409);expect(stale.body).toMatchObject({code:'LOKI_VERSION_CONFLICT'});
  },30_000);

});
