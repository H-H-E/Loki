import {create} from 'zustand';
import {persist,createJSONStorage} from 'zustand/middleware';
import type {Project,LyricLine,Mode,Premise,Source,GenerationResult} from '../types';
import {createBlankProject,createDemoProject,uuid} from './demo';
import {applyGenerationResult,createSnapshot,editLine,replaceProjectSource,restoreProjectSnapshot,validateProject,type RepeatScope} from './engine';

export type LineFlags=Partial<Pick<LyricLine,'protected'|'approved'|'startMs'|'endMs'|'timingMethod'|'notes'|'language'|'dialect'>>;
interface StudioState {
 project:Project;projects:Project[];selectedLineId:string|null;mode:Mode;notice:string|null;saveStatus:string;undoStack:Project[];
 selectLine:(id:string|null)=>void;setMode:(mode:Mode)=>void;setNotice:(notice:string|null)=>void;
 updateLine:(id:string,text:string,scope?:RepeatScope)=>void;setLineFlags:(id:string,flags:LineFlags)=>void;
 updatePremise:(partial:Partial<Premise>)=>void;setTitle:(title:string)=>void;newProject:()=>void;
 openProject:(id:string)=>void;duplicateProject:(id:string)=>void;archiveProject:(id:string)=>void;
 undo:()=>void;restoreSnapshot:(id:string)=>void;applyPatches:(result:GenerationResult,selectedIds?:string[])=>void;
 replaceSource:(source:Source)=>void;updateSourceMetadata:(patch:Partial<Source>)=>void;saveSnapshot:(label:string)=>void;importProject:(project:Project)=>void;
}
const demo=createDemoProject();
const KEY='loki-studio-private-v1';
let storageFailed=false;
const storage={
 getItem:(name:string):string|null=>{if(typeof localStorage==='undefined')return null;try{const raw=localStorage.getItem(name);if(raw){JSON.parse(raw);return raw;}return localStorage.getItem(`${name}:recovery`);}catch{try{const fallback=localStorage.getItem(`${name}:recovery`);if(fallback)JSON.parse(fallback);return fallback;}catch{return null;}}},
 setItem:(name:string,value:string):void=>{if(typeof localStorage==='undefined')return;try{localStorage.setItem(`${name}:recovery`,value);localStorage.setItem(name,value);storageFailed=false;}catch{if(!storageFailed){storageFailed=true;queueMicrotask(()=>useStudioStore.setState({saveStatus:'Save interrupted. Export a recovery copy.',notice:'Browser storage is full or unavailable. Your open draft remains available; export it to keep a copy.'}));}}},
 removeItem:(name:string):void=>{if(typeof localStorage==='undefined')return;localStorage.removeItem(name);localStorage.removeItem(`${name}:recovery`);},
};
export const useStudioStore=create<StudioState>()(persist((set,get)=>{
 const commit=(transform:(project:Project)=>Project,history=true)=>{try{const before=get().project;const next=transform(before);if(next===before)return;validateProject(next);set(s=>({project:next,projects:[...s.projects.filter(p=>p.id!==next.id),next],undoStack:history?[...s.undoStack,before].slice(-30):s.undoStack,notice:null,saveStatus:storageFailed?'Save interrupted. Export a recovery copy.':'Saved locally'}));}catch(e){set({notice:e instanceof Error?e.message:'The change could not be applied. Your draft has been preserved.'});}};
 const changed=(p:Project):Project=>({...p,version:p.version+1,updatedAt:new Date().toISOString()});
 return {project:demo,projects:[demo],selectedLineId:demo.lines[2]?.id??null,mode:'spin',notice:null,saveStatus:'Saved locally',undoStack:[],
 selectLine:id=>set({selectedLineId:id}),setMode:mode=>set({mode}),setNotice:notice=>set({notice}),
 updateLine:(id,text,scope='this')=>commit(p=>editLine(p,id,text,scope)),
 setLineFlags:(id,flags)=>commit(p=>{const line=p.lines.find(l=>l.id===id);if(!line)throw new Error('This line no longer exists.');if(flags.startMs!==undefined&&flags.startMs!==null&&(!Number.isFinite(flags.startMs)||flags.startMs<0))throw new Error('Timing must be zero or a positive number of milliseconds.');if(flags.endMs!==undefined&&flags.endMs!==null&&(!Number.isFinite(flags.endMs)||flags.endMs<0))throw new Error('Invalid end timing.');return changed({...p,lines:p.lines.map(l=>l.id===id?{...l,...flags,revision:l.revision+1}:l)});}),
 updatePremise:partial=>commit(p=>changed({...p,premise:{...p.premise,...partial},snapshots:[...p.snapshots,createSnapshot(p,'Before premise change')].slice(-60)})),
 setTitle:title=>commit(p=>changed({...p,title:title||'Untitled spin'})),
 newProject:()=>{const project=createBlankProject();set(s=>({project,projects:[...s.projects,project],selectedLineId:null,mode:'source',undoStack:[],notice:null}));},
 openProject:id=>{const project=get().projects.find(p=>p.id===id);if(project)set({project,selectedLineId:null,undoStack:[],notice:null});else set({notice:'This project could not be found.'});},
 duplicateProject:id=>{const original=get().projects.find(p=>p.id===id);if(!original)return;const project=structuredClone(original);project.id=uuid();project.ownerId=null;project.archivedAt=null;project.title=`${project.title} (copy)`;project.createdAt=new Date().toISOString();project.updatedAt=project.createdAt;project.version=0;project.snapshots=[];set(s=>({project,projects:[...s.projects,project],selectedLineId:null,undoStack:[],notice:null}));},
 archiveProject:id=>{const s=get();const prior=s.projects.find(p=>p.id===id);if(!prior)return;const archived={...prior,archivedAt:prior.archivedAt?null:new Date().toISOString(),version:prior.version+1,updatedAt:new Date().toISOString()};set({project:s.project.id===id?archived:s.project,projects:s.projects.map(p=>p.id===id?archived:p),notice:archived.archivedAt?'Project archived. Open the archived library to restore it.':'Project restored to the active library.'});},
 undo:()=>{const s=get();const previous=s.undoStack.at(-1);if(!previous){set({notice:'Nothing to undo yet.'});return;}const snapshot=createSnapshot(previous,'Undo target');const current={...s.project,snapshots:[...s.project.snapshots,snapshot]};const restored=restoreProjectSnapshot(current,snapshot.id);set({project:restored,projects:[...s.projects.filter(p=>p.id!==restored.id),restored],undoStack:s.undoStack.slice(0,-1),notice:'Previous edit restored as a new revision.'});},
 restoreSnapshot:id=>commit(p=>restoreProjectSnapshot(p,id)),
 applyPatches:(result,selectedIds)=>commit(p=>applyGenerationResult(p,result,selectedIds)),
 replaceSource:source=>commit(p=>replaceProjectSource(p,source)),
 updateSourceMetadata:patch=>commit(p=>replaceProjectSource(p,{...p.source,...patch})),
 saveSnapshot:label=>commit(p=>({...p,snapshots:[...p.snapshots,createSnapshot(p,label||'Saved version')].slice(-60)}),false),
 importProject:project=>{try{validateProject(project);const safe=structuredClone(project);set(s=>({project:safe,projects:[...s.projects.filter(p=>p.id!==safe.id),safe],selectedLineId:null,undoStack:[],notice:null,saveStatus:'Saved locally'}));}catch(e){set({notice:e instanceof Error?e.message:'Invalid project backup.'});}},
 };
},{name:KEY,storage:createJSONStorage(()=>storage),version:1,partialize:s=>({project:s.project,projects:s.projects,selectedLineId:s.selectedLineId,mode:s.mode,undoStack:s.undoStack}),merge:(saved,current)=>{if(!saved||typeof saved!=='object')return current;try{const value=saved as Partial<StudioState>;if(value.project)validateProject(value.project);if(value.projects)value.projects.forEach(validateProject);return {...current,...value,notice:null,saveStatus:'Saved locally'};}catch{return {...current,notice:'A damaged saved document was ignored. Import a recovery backup to restore your work.'};}}}));
