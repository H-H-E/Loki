-- Run with npm run db:migrate after Better Auth creates public."user".
-- Vercel is the only database client. Its server verifies the cookie session and
-- passes that verified user ID to each function. DATABASE_URL never reaches a
-- browser, and no public database or anonymous API permissions are granted.
create table if not exists public.loki_projects (
  id uuid primary key,
  owner_id text not null references public."user"(id) on delete cascade,
  title text not null,
  project jsonb not null,
  cloud_version bigint not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists public.loki_revisions (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.loki_projects(id) on delete cascade,
  owner_id text not null references public."user"(id) on delete cascade,
  cloud_version bigint not null,
  project jsonb not null,
  origin text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.loki_jobs (
  id uuid primary key,
  owner_id text not null references public."user"(id) on delete cascade,
  project_id uuid not null,
  base_version bigint not null,
  status text not null,
  result jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.loki_request_buckets (
  bucket_key text primary key,
  requests integer not null default 0,
  expires_at timestamptz not null
);
create index if not exists loki_projects_owner_updated on public.loki_projects(owner_id,updated_at desc);
create index if not exists loki_revisions_owner_project on public.loki_revisions(owner_id,project_id,created_at desc);
create index if not exists loki_jobs_owner_created on public.loki_jobs(owner_id,created_at desc);
create index if not exists loki_buckets_expiry on public.loki_request_buckets(expires_at);
revoke all on public.loki_projects,public.loki_revisions,public.loki_jobs,public.loki_request_buckets from public;

create or replace function public.save_loki_project(p_owner text,p_project jsonb,p_expected_version bigint,p_allow_structure boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  actor text:=p_owner; pid uuid; previous public.loki_projects; normalized jsonb;
  old_line jsonb; new_line jsonb; checkpoint boolean:=false; structural boolean:=false;
begin
  if actor is null or length(actor)=0 or not exists(select 1 from public."user" where id=actor) then raise exception 'LOKI_AUTH_REQUIRED'; end if;
  if p_expected_version is null or p_expected_version<0 then raise exception 'LOKI_VERSION_CONFLICT'; end if;
  if jsonb_typeof(p_project->'lines') is distinct from 'array' or jsonb_typeof(p_project->'sections') is distinct from 'array' or jsonb_typeof(p_project->'snapshots') is distinct from 'array' then raise exception 'LOKI_INVALID_PROJECT'; end if;
  if octet_length(p_project::text)>2097152 or jsonb_array_length(p_project->'lines')>500 or jsonb_array_length(p_project->'snapshots')>100 then raise exception 'LOKI_INVALID_PROJECT'; end if;
  if exists(select 1 from jsonb_array_elements(p_project->'lines') l where
      jsonb_typeof(l->'text') is distinct from 'string' or jsonb_typeof(l->'sourceText') is distinct from 'string' or
      jsonb_typeof(l->'protected') is distinct from 'boolean' or jsonb_typeof(l->'revision') is distinct from 'number' or
      l->>'id' is null or l->>'sectionId' is null or length(l->>'text')>4000 or l->>'text' ~ E'[\\n\\r]' or (l->>'revision')::numeric<0 or (l->>'revision')::numeric<>trunc((l->>'revision')::numeric)) then raise exception 'LOKI_INVALID_LINE'; end if;
  pid:=(p_project->>'id')::uuid;
  if p_project->>'ownerId' is not null and p_project->>'ownerId'<>actor::text then raise exception 'LOKI_OWNER_MISMATCH'; end if;
  if (select count(*) from jsonb_array_elements(p_project->'lines'))<>(select count(distinct l->>'id') from jsonb_array_elements(p_project->'lines') l) then raise exception 'LOKI_DUPLICATE_LINE'; end if;
  if exists(select 1 from jsonb_array_elements(p_project->'lines') l where not exists(select 1 from jsonb_array_elements(p_project->'sections') s where s->>'id'=l->>'sectionId')) then raise exception 'LOKI_INVALID_LINE'; end if;
  if exists(select 1 from jsonb_array_elements(p_project->'lines') l where nullif(l->>'repeatKey','') is not null group by l->>'repeatKey' having count(distinct convert_to(l->>'text','UTF8'))>1) then raise exception 'LOKI_LINKED_HOOK'; end if;
  normalized:=jsonb_set(p_project,'{ownerId}',to_jsonb(actor));
  -- Insert once, then serialize both updates and competing first saves on the row.
  if p_expected_version=0 then
    insert into public.loki_projects(id,owner_id,title,project,cloud_version) values(pid,actor,coalesce(p_project->>'title','Untitled'),normalized,0) on conflict(id) do nothing;
  end if;
  select * into previous from public.loki_projects where id=pid for update;
  if not found or previous.owner_id<>actor then raise exception 'LOKI_PROJECT_NOT_FOUND'; end if;
  if previous.cloud_version<>p_expected_version then raise exception 'LOKI_VERSION_CONFLICT'; end if;
  if previous.cloud_version>0 then
    for old_line in select value from jsonb_array_elements(previous.project->'lines') loop
      select value into new_line from jsonb_array_elements(normalized->'lines') where value->>'id'=old_line->>'id';
      if coalesce((old_line->>'protected')::boolean,false) and (new_line is null or convert_to(coalesce(new_line->>'text',''),'UTF8')<>convert_to(coalesce(old_line->>'text',''),'UTF8')) then raise exception 'LOKI_PROTECTED_LINE'; end if;
    end loop;
    structural:=previous.project->'sections'<>normalized->'sections' or
      (select jsonb_agg(jsonb_build_array(l->>'id',l->>'sectionId',l->>'position',l->>'sourceText') order by ord) from jsonb_array_elements(previous.project->'lines') with ordinality a(l,ord)) is distinct from
      (select jsonb_agg(jsonb_build_array(l->>'id',l->>'sectionId',l->>'position',l->>'sourceText') order by ord) from jsonb_array_elements(normalized->'lines') with ordinality a(l,ord));
    if structural then
      select exists(select 1 from jsonb_array_elements(normalized->'snapshots') s where s->'data'->'sections'=previous.project->'sections' and
        (select jsonb_agg(jsonb_build_array(l->>'id',l->>'sectionId',l->>'position',l->>'sourceText') order by ord) from jsonb_array_elements(s->'data'->'lines') with ordinality a(l,ord)) is not distinct from
        (select jsonb_agg(jsonb_build_array(l->>'id',l->>'sectionId',l->>'position',l->>'sourceText') order by ord) from jsonb_array_elements(previous.project->'lines') with ordinality a(l,ord))) into checkpoint;
      if not p_allow_structure or not checkpoint then raise exception 'LOKI_STRUCTURE_CHECKPOINT'; end if;
    end if;
    insert into public.loki_revisions(project_id,owner_id,cloud_version,project,origin) values(pid,actor,previous.cloud_version,previous.project,'before cloud save');
  end if;
  update public.loki_projects set project=normalized,title=coalesce(normalized->>'title','Untitled'),cloud_version=previous.cloud_version+1,updated_at=now() where id=pid;
  return jsonb_build_object('cloud_version',previous.cloud_version+1,'project',normalized);
end;
$$;
revoke all on function public.save_loki_project(text,jsonb,bigint,boolean) from public;

-- Optional server commit path. A patch cannot restructure source, bypass a lock,
-- change unknown lines, or silently replace a manually edited revision.
create or replace function public.commit_loki_patches(p_owner text,p_project_id uuid,p_expected_version bigint,p_patches jsonb,p_job_id uuid,p_scope text[])
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor text:=p_owner; row_data public.loki_projects; patch jsonb; line jsonb; lines jsonb; idx integer; next_project jsonb;
begin
  if actor is null or length(actor)=0 or not exists(select 1 from public."user" where id=actor) then raise exception 'LOKI_AUTH_REQUIRED'; end if;
  if p_expected_version is null or p_expected_version<0 then raise exception 'LOKI_VERSION_CONFLICT'; end if;
  if p_scope is null or cardinality(p_scope)=0 then raise exception 'LOKI_PATCH_SCOPE'; end if;
  if exists(select 1 from public.loki_jobs where id=p_job_id and (owner_id<>actor or project_id<>p_project_id)) then raise exception 'LOKI_OWNER_MISMATCH'; end if;
  select * into row_data from public.loki_projects where id=p_project_id for update;
  if not found or row_data.owner_id<>actor then raise exception 'LOKI_PROJECT_NOT_FOUND'; end if;
  if row_data.cloud_version<>p_expected_version then raise exception 'LOKI_VERSION_CONFLICT'; end if;
  if jsonb_typeof(p_patches) is distinct from 'array' or jsonb_array_length(p_patches)>500 then raise exception 'LOKI_INVALID_PATCH'; end if;
  if (select count(*) from jsonb_array_elements(p_patches))<>(select count(distinct p->>'lineId') from jsonb_array_elements(p_patches) p) then raise exception 'LOKI_DUPLICATE_PATCH'; end if;
  lines:=row_data.project->'lines';
  for patch in select value from jsonb_array_elements(p_patches) loop
    if jsonb_typeof(patch->'expectedRevision') is distinct from 'number' then raise exception 'LOKI_INVALID_PATCH'; end if;
    if not (patch->>'lineId'=any(p_scope)) then raise exception 'LOKI_PATCH_SCOPE'; end if;
    select ordinality-1,value into idx,line from jsonb_array_elements(lines) with ordinality where value->>'id'=patch->>'lineId';
    if line is null then raise exception 'LOKI_UNKNOWN_LINE'; end if;
    if coalesce((line->>'protected')::boolean,false) then raise exception 'LOKI_PROTECTED_LINE'; end if;
    if (line->>'revision')::bigint<>(patch->>'expectedRevision')::bigint then raise exception 'LOKI_STALE_LINE'; end if;
    if jsonb_typeof(patch->'newText') is distinct from 'string' or length(patch->>'newText')>4000 or patch->>'newText' ~ E'[\\n\\r]' then raise exception 'LOKI_INVALID_PATCH'; end if;
    line:=jsonb_set(line,'{versions}',coalesce(line->'versions','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'text',line->>'text','createdAt',now(),'origin','before AI patch')));
    line:=jsonb_set(jsonb_set(jsonb_set(line,'{text}',patch->'newText'),'{revision}',to_jsonb((line->>'revision')::bigint+1)),'{approved}','false'::jsonb);
    lines:=jsonb_set(lines,array[idx::text],line);
  end loop;
  if exists(select 1 from jsonb_array_elements(lines) l where nullif(l->>'repeatKey','') is not null group by l->>'repeatKey' having count(distinct convert_to(l->>'text','UTF8'))>1) then raise exception 'LOKI_LINKED_HOOK'; end if;
  next_project:=jsonb_set(jsonb_set(jsonb_set(row_data.project,'{lines}',lines),'{version}',to_jsonb((row_data.project->>'version')::bigint+1)),'{updatedAt}',to_jsonb(now()));
  insert into public.loki_revisions(project_id,owner_id,cloud_version,project,origin) values(p_project_id,actor,row_data.cloud_version,row_data.project,'before AI patch');
  update public.loki_projects set project=next_project,cloud_version=row_data.cloud_version+1,updated_at=now() where id=p_project_id;
  insert into public.loki_jobs(id,owner_id,project_id,base_version,status,result) values(p_job_id,actor,p_project_id,p_expected_version,'applied',jsonb_build_object('patches',p_patches))
    on conflict(id) do update set status='applied',result=excluded.result where loki_jobs.owner_id=actor and loki_jobs.project_id=p_project_id;
  return jsonb_build_object('cloud_version',row_data.cloud_version+1,'project',next_project);
end;
$$;
revoke all on function public.commit_loki_patches(text,uuid,bigint,jsonb,uuid,text[]) from public;

-- Transaction-safe per-user budgets and a shared EverySong free-tier ceiling.
-- Costs count upstream requests, so an import can reserve several credits.
create or replace function public.consume_loki_quota(p_owner text,p_category text,p_cost integer default 1,p_provider_scope text default 'shared')
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor text:=p_owner; keys text[]; caps integer[]; expiries timestamptz[]; i integer; used integer; minute_key text:=to_char(now() at time zone 'UTC','YYYYMMDDHH24MI'); day_key text:=to_char(now() at time zone 'UTC','YYYYMMDD');
begin
  if actor is null or length(actor)=0 or not exists(select 1 from public."user" where id=actor) then raise exception 'LOKI_AUTH_REQUIRED'; end if;
  if p_provider_scope is null or length(p_provider_scope)<1 or length(p_provider_scope)>128 or p_category is null or p_category not in ('source','ai') or p_cost is null or p_cost<1 or p_cost>10 then raise exception 'LOKI_INVALID_QUOTA'; end if;
  keys:=array[actor::text||':'||p_category||':m:'||minute_key,actor::text||':'||p_category||':d:'||day_key];
  caps:=case when p_category='source' then array[30,250] else array[8,40] end;
  expiries:=array[date_trunc('minute',now())+interval '1 minute',(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')+interval '1 day'];
  if p_category='source' then keys:=keys||array['global:'||p_provider_scope||':source:m:'||minute_key,'global:'||p_provider_scope||':source:d:'||day_key]; caps:=caps||array[60,1000]; expiries:=expiries||expiries; end if;
  for i in 1..array_length(keys,1) loop
    insert into public.loki_request_buckets(bucket_key,requests,expires_at) values(keys[i],0,expiries[i]) on conflict do nothing;
    select requests into used from public.loki_request_buckets where bucket_key=keys[i] for update;
    if used+p_cost>caps[i] then return false; end if;
  end loop;
  for i in 1..array_length(keys,1) loop update public.loki_request_buckets set requests=requests+p_cost where bucket_key=keys[i]; end loop;
  return true;
end;
$$;
revoke all on function public.consume_loki_quota(text,text,integer,text) from public;
