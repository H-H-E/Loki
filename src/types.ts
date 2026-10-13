export type Mode = 'source' | 'spin' | 'polish';
export type TimingMethod = 'none' | 'estimated' | 'manual' | 'imported' | 'aligned';
export interface Source { title:string; artist:string; recordingId:string|null; lyricsId:string|null; streamingId:string|null; year:number|null; album:string|null; key:string|null; bpm:number|null; timeSignature:number|null; durationMs:number|null; language:string|null; provenance:string; confirmed:boolean; originalText:string; }
export interface Premise { topic:string; tone:string; audience:string; explicitness:'clean'|'mild'|'unfiltered'; soundMatch:'loose'|'balanced'|'close'; requiredDetails:string; avoid:string; language:string; dialect:string; hook:string; intensity:'subtle'|'balanced'|'bold'; }
export interface Section { id:string; label:string; position:number; repeatGroup:string|null; }
export interface LineRevision { id:string; text:string; createdAt:string; origin:string; }
export interface LyricLine { id:string; sectionId:string; position:number; sourceText:string; text:string; revision:number; protected:boolean; approved:boolean; repeatKey:string|null; startMs:number|null; endMs:number|null; timingMethod:TimingMethod; language:string; dialect:string; notes:string; versions:LineRevision[]; }
export interface Snapshot { id:string; label:string; createdAt:string; data:Omit<Project,'snapshots'>; }
export interface Project { id:string; ownerId:string|null; title:string; createdAt:string; updatedAt:string; archivedAt?:string|null; version:number; source:Source; premise:Premise; sections:Section[]; lines:LyricLine[]; snapshots:Snapshot[]; }
export interface Alternative { id:string; lineId:string; text:string; tradeoff:'fit'|'joke'|'natural'; note:string; }
export interface Patch { lineId:string; expectedRevision:number; newText:string; }
export interface GenerationResult { jobId:string; projectId:string; baseVersion:number; patches:Patch[]; notes?:{lineId:string; status:string; note:string}[]; usage?:{inputTokens:number; outputTokens:number}; }
export interface SongResult { recordingId:string; title:string; artist:string; year:number|null; streamingId:string|null; }
export interface PremiseDirection { title:string; narrator:string; contradiction:string; escalation:string; hook:string; }

