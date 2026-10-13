import { afterEach, describe, expect, it, vi } from 'vitest';
import { identityMatches, importSongServer, normalizeSongResults } from '../server/lib/everysong';
import { targetLines, validatePatches } from '../server/lib/generation';
import type { InputProject } from '../server/lib/generation';
const line = (id:string, protectedLine=false, repeatKey:string|null=null) => ({id,sectionId:'chorus',position:0,sourceText:'One small line',text:'A new short line',revision:3,protected:protectedLine,repeatKey,language:'English',dialect:''});
const project = { sections:[{id:'chorus',label:'Chorus',position:0,repeatGroup:null}], lines:[line('a'),line('b',true)] } as unknown as InputProject;
describe('EverySong identities',()=>{
 it('keeps recording and streaming identifiers separate',()=>{expect(normalizeSongResults({results:[{rid:42,streaming_id:'track-77',title:'Song',artist:'Singer',year:'2020'}]})).toEqual([{recordingId:'42',streamingId:'track-77',title:'Song',artist:'Singer',year:2020}]);});
 it('rejects a different artist even when the title matches',()=>{expect(identityMatches({title:'Song',artist:'Singer'},{title:'Song',artist:'Another singer'})).toBe(false);});
 it('does not guess recording IDs from lyric IDs',()=>{expect(normalizeSongResults({results:[{lyrics_id:4,title:'Song',artist:'Singer'}]})).toEqual([]);});
});
describe('AI patch boundaries',()=>{
 it('excludes protected lines',()=>{expect(targetLines(project,'chorus').map(line=>line.id)).toEqual(['a']);});
 it('rejects a patch with a stale revision',()=>{expect(()=>validatePatches({patches:[{lineId:'a',expectedRevision:2,newText:'New words'}]},[line('a')])).toThrow();});
 it('rejects changes to a non-target line',()=>{expect(()=>validatePatches({patches:[{lineId:'b',expectedRevision:3,newText:'New words'}]},[line('a')])).toThrow();});
 it('rejects structurally invalid multiline content',()=>{expect(()=>validatePatches({patches:[{lineId:'a',expectedRevision:3,newText:'New\nwords'}]},[line('a')])).toThrow();});
 it('rejects inconsistent repeated hooks',()=>{expect(()=>validatePatches({patches:[{lineId:'a',expectedRevision:3,newText:'First hook'},{lineId:'c',expectedRevision:3,newText:'Second hook'}]},[line('a',false,'hook'),line('c',false,'hook')])).toThrow();});
 it('requires explicit section targets',()=>{expect(()=>targetLines(project,'section')).toThrow();});
});

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('recording import crosswalk',()=>{
 const chosen={recordingId:'42',title:'Night song',artist:'Local singer',year:2020,streamingId:'track-77'};
 function catalogue(lyrics:unknown,features:unknown=null){
  vi.stubEnv('EVERYSONG_API_KEY','server-test-secret');
  const outbound=vi.fn(async(url:string,init:RequestInit)=>{
   const parsed=new URL(url);
   expect(parsed.searchParams.has('api_key')).toBe(false);
   expect((init.headers as Record<string,string>)['x-api-key']).toBe('server-test-secret');
   const payload=parsed.pathname.endsWith('/spine/song')?{rid:42,title:'Night song',artist:'Local singer',streaming_id:'track-77',year:2020}:parsed.pathname.endsWith('/spine/ids')?{ids:{'42':{lyrics_id:900}}}:parsed.pathname.endsWith('/lyrics/text')?lyrics:parsed.pathname.endsWith('/songs/features')?{features}:parsed.pathname.endsWith('/spine/track')?{duration_ms:120000,album:{name:'Own album'}}:{};
   return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
  });
  vi.stubGlobal('fetch',outbound);return outbound;
 }
 it('follows recording to lyrics ID without collapsing the IDs',async()=>{
  const outbound=catalogue({lyrics_id:900,title:'Night song',artist:'Local singer',lyrics:'[Verse]\nA wholly invented test song'},null);
  const source=await importSongServer(chosen);
  expect(source.recordingId).toBe('42');expect(source.lyricsId).toBe('900');expect(source.streamingId).toBe('track-77');
  expect(source.key).toBeNull();expect(source.bpm).toBeNull();expect(source.confirmed).toBe(false);
  const lyricCall=outbound.mock.calls.find(([url])=>url.includes('/lyrics/text'));
  expect(new URL(lyricCall![0]).searchParams.get('lyrics_id')).toBe('900');
 });
 it('refuses crosswalk lyrics belonging to another artist',async()=>{catalogue({lyrics_id:900,title:'Night song',artist:'Wrong singer',lyrics:'Wrong source'});await expect(importSongServer(chosen)).rejects.toMatchObject({status:409,code:'LYRICS_MISMATCH'});});
 it('preserves missing lyrics as an empty manual recovery state',async()=>{catalogue({lyrics_id:900,title:'Night song',artist:'Local singer',lyrics:null});const source=await importSongServer(chosen);expect(source.originalText).toBe('');expect(source.durationMs).toBe(120000);});
});
