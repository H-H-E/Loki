import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, ArrowRight, FileText, LoaderCircle } from 'lucide-react';
import { searchSongs, importSong, getProviderStatus } from '../lib/api';
import { useStudioStore } from '../lib/store';
import { previewSourceReplacement } from '../lib/engine';
import type { SongResult, Source } from '../types';
import './source.css';

export function SourcePanel({ onClose }: { onClose: () => void }) {
  const project = useStudioStore(s => s.project);
  const replaceSource = useStudioStore(s => s.replaceSource);
  const [tab, setTab] = useState<'search' | 'paste'>('search');
  const [kind, setKind] = useState<'title' | 'lyric' | 'artist'>('title');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SongResult[]>([]);
  const [source, setSource] = useState<Source>({ ...project.source, confirmed: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [preview, setPreview] = useState(false);
  const initialFocus = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  useEffect(() => { initialFocus.current?.focus(); getProviderStatus().then(s => setAvailable(s.everySong)).catch(() => setAvailable(false)); }, []);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, [onClose]);
  const count = source.originalText.split(/\r?\n/).filter(l => l.trim() && !/^\[.*\]$/.test(l.trim())).length;
  const mapping = useMemo(() => { try { return previewSourceReplacement(project, source).mapping; } catch { return []; } }, [project, source]);
  async function search() {
    if (query.trim().length < 3) { setError('Enter at least three characters.'); return; }
    const id = ++requestId.current; setBusy(true); setError('');
    try { const items = await searchSongs(query.trim(), kind); if (id === requestId.current) { setResults(items); if (!items.length) setError('No matches. Try another title or paste the source.'); } }
    catch (e) { if (id === requestId.current) setError(e instanceof Error ? e.message : 'Search is unavailable. Paste lyrics to continue.'); }
    finally { if (id === requestId.current) setBusy(false); }
  }
  async function choose(song: SongResult) {
    setBusy(true); setError('');
    try { const imported = await importSong(song); setSource({ ...imported, confirmed: false }); setPreview(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'This recording has no usable lyrics. Paste your source instead.'); }
    finally { setBusy(false); }
  }
  function commit() {
    if (!source.title.trim() || !source.originalText.trim() || !source.confirmed) { setError('Add a title and lyrics, then confirm the source version.'); return; }
    try { replaceSource(source); const notice = useStudioStore.getState().notice; if (notice) setError(notice); else onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the source. Your draft is preserved.'); }
  }
  function update(field: 'title' | 'artist' | 'originalText', value: string) { setSource(s => ({ ...s, [field]: value, confirmed: false, provenance: tab === 'paste' ? 'User supplied' : s.provenance })); }
  return <div className="source-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="source-panel" role="dialog" aria-modal="true" aria-labelledby="source-title" onKeyDown={e => {
      if (e.key !== 'Tab') return; const elements = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]')); const first = elements[0], last = elements[elements.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }}>
      <header><div><small>THE ORIGINAL</small><h2 id="source-title">Start with the song.</h2></div><button aria-label="Close source panel" onClick={onClose}><X size={20} /></button></header>
      <p>Choose the recording, check the words, then change its story.</p>
      <div className="source-tabs"><button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}><Search size={16} /> Find a song</button><button className={tab === 'paste' ? 'active' : ''} onClick={() => { setTab('paste'); setPreview(true); setSource(v => ({...v, recordingId:null, lyricsId:null, streamingId:null, year:null, album:null, key:null, bpm:null, timeSignature:null, durationMs:null, provenance:'User supplied', confirmed:false})); }}><FileText size={16} /> Paste lyrics</button></div>
      {tab === 'search' && <>
        {available === false && <p className="source-info">Song search needs the EverySong server connection. You can paste lyrics and keep writing.</p>}
        <form className="source-search" onSubmit={e => { e.preventDefault(); search(); }}><label className="sr-only" htmlFor="source-query">Search songs</label><input id="source-query" ref={initialFocus} value={query} onChange={e => setQuery(e.target.value)} placeholder="Song title or a remembered lyric" /><select aria-label="Search by" value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="title">Title</option><option value="lyric">Lyric fragment</option><option value="artist">Artist</option></select><button disabled={busy || query.trim().length < 3} type="submit">{busy ? <LoaderCircle size={18} className="loading" /> : <Search size={18} />} Search</button></form>
        <div className="source-results">{results.map(song => <button disabled={busy} key={song.recordingId} onClick={() => choose(song)}><span><strong>{song.title}</strong><small>{song.artist}{song.year ? ` / ${song.year}` : ''}</small></span><ArrowRight size={18} /></button>)}</div>
      </>}
      {(preview || tab === 'paste') && <div className="source-preview">
        <div className="source-meta"><label>Song title<input value={source.title} onChange={e => update('title', e.target.value)} /></label><label>Artist, optional<input value={source.artist} onChange={e => update('artist', e.target.value)} /></label></div>
        <label>Source lyrics<textarea dir="auto" rows={12} value={source.originalText} onChange={e => update('originalText', e.target.value)} placeholder={'[Verse 1]\nPaste the original lines here.\n\n[Chorus]\nKeep each sung phrase on its own line.'} /></label>
        <div className="source-metadata"><span>{count} source lines</span>{source.bpm !== null && <span>{source.bpm} BPM</span>}{source.key && <span>Key: {source.key}</span>}{source.timeSignature !== null && <span>Meter: {source.timeSignature}/4</span>}<span>{source.provenance || 'User supplied'}</span></div>
        <p className="source-info">Line breaks and section labels define the writing scaffold. Changes create a checkpoint; existing drafts are preserved for review and affected timing is cleared.</p>
        <details className="source-mapping"><summary>Review line mapping before applying ({mapping.length} lines)</summary><div>{mapping.map((item, index) => <p key={`${item.oldId}-${item.newId}-${index}`}><strong>{item.kind}</strong> <span dir="auto">{item.sourceText}</span>{item.draftText && <small dir="auto">Draft retained: {item.draftText}</small>}</p>)}</div></details>
        <label className="source-confirm"><input type="checkbox" checked={source.confirmed} onChange={e => setSource(s => ({ ...s, confirmed: e.target.checked }))} /> I checked that these lyrics match the recording and version I want.</label>
        <footer><button onClick={onClose}>Cancel</button><button className="primary" disabled={!source.confirmed || count === 0 || busy} onClick={commit}>Use this source <ArrowRight size={16} /></button></footer>
      </div>}
      {error && <p role="alert" className="source-error">{error}</p>}
    </section>
  </div>;
}
