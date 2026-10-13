import type {Project, LyricLine} from '../types';

export function orderedLines(project:Project):LyricLine[] {
  return [...project.sections].sort((a,b)=>a.position-b.position).flatMap(section=>project.lines.filter(line=>line.sectionId===section.id).sort((a,b)=>a.position-b.position));
}
export function sourceAttribution(project:Project):string {
  const {title,artist}=project.source;
  return `A new version of ${title || 'Untitled source'}${artist ? ` by ${artist}` : ''}`;
}
export function exportText(project:Project, {markdown=false, includeSource=false}:{markdown?:boolean;includeSource?:boolean}={}):string {
  const heading=markdown ? '# ' : '';
  const body=[`${heading}${project.title}`, sourceAttribution(project), ''];
  for(const section of [...project.sections].sort((a,b)=>a.position-b.position)) {
    body.push(`${markdown?'## ':''}${section.label}`);
    for(const line of orderedLines(project).filter(line=>line.sectionId===section.id)) {
      if(includeSource) body.push(`${markdown?'Original: ':'Original: '}${line.sourceText}`);
      body.push(includeSource ? `Your version: ${line.text}` : line.text);
    }
    body.push('');
  }
  return body.join('\n').trimEnd()+'\n';
}
export function escapeHtml(value:string):string {
  return value.replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
}
export function printableHtml(project:Project, {includeSource=false,largeText=false}:{includeSource?:boolean;largeText?:boolean}={}):string {
  const sections=[...project.sections].sort((a,b)=>a.position-b.position).map(section=>`<section><h2>${escapeHtml(section.label)}</h2>${orderedLines(project).filter(line=>line.sectionId===section.id).map(line=>`<div class="line">${includeSource?`<p class="source" dir="auto">${escapeHtml(line.sourceText)}</p>`:''}<p dir="auto">${escapeHtml(line.text)}</p></div>`).join('')}</section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(project.title)}</title><style>body{font-family:Arial,sans-serif;color:#242824;max-width:760px;margin:40px auto;padding:0 24px;font-size:${largeText?'24':'17'}px;line-height:1.6}h1{font-family:Georgia,serif;font-weight:normal;font-size:2.2em;line-height:1.15}h2{font-size:.75em;letter-spacing:.1em;text-transform:uppercase;margin-top:2em;break-after:avoid}.attribution{color:#555;font-size:.7em}.line{break-inside:avoid}p{white-space:pre-wrap;margin:0 0 .5em}.source{color:#666;font-size:.8em}.print-controls{font-size:14px;margin-bottom:32px}.print-controls button{padding:12px 18px;border:1px solid #277a65;background:#f6f3eb;cursor:pointer}@media print{@page{margin:18mm}body{margin:0;padding:0;max-width:none}.print-controls{display:none}section{break-inside:auto}h1{margin-top:0}}</style></head><body><div class="print-controls"><button onclick="window.print()">Print or save as PDF</button></div><h1>${escapeHtml(project.title)}</h1><p class="attribution">${escapeHtml(sourceAttribution(project))}</p>${sections}</body></html>`;
}
export function timingExportStatus(project:Project):{valid:boolean;reason:string} {
  const lines=orderedLines(project);
  if(lines.some(line=>!line.text.trim())) return {valid:false,reason:'Finish every draft line before exporting a complete LRC timing file.'};
  if(!lines.length) return {valid:false,reason:'Write lyrics before exporting timing.'};
  let previous=-1;
  for(const line of lines) {
    if(!['manual','imported','aligned'].includes(line.timingMethod)) return {valid:false,reason:'Every written line needs manual, imported or aligned timing. Estimates are excluded.'};
    if(line.startMs===null || !Number.isFinite(line.startMs) || line.startMs<0 || Math.round(line.startMs/10)<=previous) return {valid:false,reason:'Line onsets must be valid, non-negative and follow the manuscript order.'};
    previous=Math.round(line.startMs/10);
  }
  return {valid:true,reason:'Timing comes from supplied or manually marked line onsets.'};
}
export function exportLrc(project:Project):string {
  const status=timingExportStatus(project);
  if(!status.valid) throw new Error(status.reason);
  return orderedLines(project).filter(line=>line.text.trim()).map(line=>{
    const centiseconds=Math.round(line.startMs!/10);
    const minutes=Math.floor(centiseconds/6000),seconds=Math.floor(centiseconds/100)%60,fraction=centiseconds%100;
    return `[${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}.${String(fraction).padStart(2,'0')}]${line.text.replace(/[\r\n]+/g,' ')}`;
  }).join('\n')+'\n';
}
export function timingProvenance(project:Project):string {
  return JSON.stringify({format:'loki-timing-provenance-v1',projectId:project.id,recordingId:project.source.recordingId,sourceProvenance:project.source.provenance,exportedAt:new Date().toISOString(),lyrics:'parody',lines:orderedLines(project).filter(line=>line.text.trim()).map(({id,startMs,endMs,timingMethod})=>({lineId:id,startMs,endMs,method:timingMethod}))},null,2);
}
export function downloadFile(filename:string,content:string,type='text/plain;charset=utf-8'):void {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function exportFilename(project:Project):string {
  return project.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'').trim().slice(0,100)||'loki-lyrics';
}
