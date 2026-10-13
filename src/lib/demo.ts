import type { Project, Source, Premise, LyricLine, Section } from '../types';

export const uuid = (): string => globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n=Math.floor(Math.random()*16); return (c==='x'?n:(n&3)|8).toString(16); });
export const blankSource = (): Source => ({title:'Untitled source',artist:'',recordingId:null,lyricsId:null,streamingId:null,year:null,album:null,key:null,bpm:null,timeSignature:null,durationMs:null,language:'en',provenance:'Manually supplied lyrics',confirmed:false,originalText:''});
export const blankPremise = (): Premise => ({topic:'',tone:'Dry and specific',audience:'Friends',explicitness:'clean',soundMatch:'balanced',requiredDetails:'',avoid:'',language:'en',dialect:'',hook:'',intensity:'balanced'});
export function makeLine(sectionId:string,position:number,sourceText:string,text='',repeatKey:string|null=null):LyricLine { return {id:uuid(),sectionId,position,sourceText,text,revision:0,protected:false,approved:false,repeatKey,startMs:null,endMs:null,timingMethod:'none',language:'en',dialect:'',notes:'',versions:[]}; }
export function createBlankProject():Project { const now=new Date().toISOString(); return {id:uuid(),ownerId:null,title:'Untitled spin',createdAt:now,updatedAt:now,version:0,source:blankSource(),premise:blankPremise(),sections:[],lines:[],snapshots:[]}; }
export function createDemoProject():Project {
 const p=createBlankProject();p.title='The Supplement Scholar';
 const blocks=[
  {label:'Verse 1',source:['I keep my dreams inside a drawer.','I swear tomorrow brings me more.','The city waits, the lights are low.','I lace my shoes, then never go.'],draft:['I keep my gains inside a jar.','My shaker travels twice as far.','I read the dose, then read some more.','My gym bag guards the bedroom door.']},
  {label:'Chorus',source:['Tomorrow is my favourite day.','I watch the morning drift away.','The road is waiting at my door.','I make a plan, then plan some more.'],draft:['Pre-workout forever, that is me.','The perfect stack, no ATP.','The gym is waiting at my door.','I scoop the dream, then scoop some more.']},
  {label:'Verse 2',source:['I mark the dates upon my wall.','I wait until I hear the call.','A thousand steps beneath the sun.','I count them all before the run.'],draft:['I know the science, every stack.','My lifting shoes stay in the pack.','A thousand tabs before the sun.','I read them all before the run.']},
  {label:'Chorus',source:['Tomorrow is my favourite day.','I watch the morning drift away.','The road is waiting at my door.','I make a plan, then plan some more.'],draft:['Pre-workout forever, that is me.','The perfect stack, no ATP.','The gym is waiting at my door.','I scoop the dream, then scoop some more.']},
 ];
 p.sections=blocks.map((b,i):Section=>({id:uuid(),label:b.label,position:i,repeatGroup:b.label==='Chorus'?'demo-hook':null}));
 p.lines=blocks.flatMap((b,i)=>b.source.map((s,j)=>makeLine(p.sections[i].id,j,s,b.draft[j],b.label==='Chorus'?`demo-hook-${j}`:null)));
 p.source={...blankSource(),title:'Tomorrow at My Door',artist:'Original demonstration',confirmed:true,provenance:'Entirely invented source and draft. No AI request has been made.',originalText:blocks.map(b=>`[${b.label}]\n${b.source.join('\n')}`).join('\n\n')};
 p.premise={...blankPremise(),topic:'A supplement scholar knows the molecular structure of creatine but has never met a squat. Every purchase postpones the first workout.',hook:'Pre-workout forever',requiredDetails:'Creatine, shaker bottles, research tabs, untouched gym bag'};
 return p;
}
