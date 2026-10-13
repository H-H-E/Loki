import {describe,it,expect} from 'vitest';
import type {Project} from '../src/types';
import {exportText,printableHtml,exportLrc,timingExportStatus} from '../src/lib/export';
const project={id:'p',title:'A new story <script>alert(1)</script>',source:{title:'Original song',artist:'Singer',recordingId:'r',provenance:'manual'},sections:[{id:'s',label:'Chorus',position:0}],lines:[{id:'l',sectionId:'s',position:0,sourceText:'PRIVATE SOURCE',text:'غني معايا & keep going',startMs:12340,endMs:null,timingMethod:'manual'}]} as Project;
describe('clean exports',()=>{
 it('preserves mixed-language draft and attribution without leaking original lines',()=>{const out=exportText(project);expect(out).toContain('غني معايا & keep going');expect(out).toContain('Original song by Singer');expect(out).not.toContain('PRIVATE SOURCE');});
 it('includes source only with explicit comparison opt-in',()=>{expect(exportText(project,{includeSource:true})).toContain('PRIVATE SOURCE');});
 it('prints untrusted lyric and project text as inert content',()=>{const html=printableHtml(project);expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain('dir="auto"');expect(html).not.toContain('PRIVATE SOURCE');});
 it('exports actual manual onsets and never turns estimates into LRC',()=>{expect(exportLrc(project)).toContain('[00:12.34]غني معايا');const estimated={...project,lines:[{...project.lines[0],timingMethod:'estimated' as const}]};expect(timingExportStatus(estimated).valid).toBe(false);expect(()=>exportLrc(estimated)).toThrow();});
 it('rejects missing, backwards and incomplete timing',()=>{expect(timingExportStatus({...project,lines:[{...project.lines[0],text:''}]}).valid).toBe(false);const missing={...project,lines:[{...project.lines[0],startMs:null}]};expect(timingExportStatus(missing).valid).toBe(false);const backwards={...project,lines:[{...project.lines[0],position:0,startMs:9000},{...project.lines[0],id:'l2',position:1,startMs:8000}]};expect(timingExportStatus(backwards).valid).toBe(false);});
});
