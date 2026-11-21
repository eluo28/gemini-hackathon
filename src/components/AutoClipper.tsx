import { shopClipTitle } from '../utils/clipShopping';
import { useEffect, useRef, useState } from 'react';
import { Scissors, SlidersHorizontal, X, ScanLine, Download, Trash2, Code2, Activity, Film, ChevronDown, LoaderCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { type useAutoClipper } from '../hooks/useAutoClipper';
import { DEFAULT_RULES, probability, type ClipAnswers, type ClipThresholds, type SavedClip } from '../shared/clipping';

type Clipper = ReturnType<typeof useAutoClipper>;
const labels: Record<keyof ClipThresholds, string> = { trigger: 'Trigger detected' };
function ClipProcessingStatus({ clipper: c }: { clipper: Clipper }) {
  if (!c.busy) return null;
  return <div role="status" className="flex items-center gap-3 rounded-xl border border-rose-100 bg-rose-50 p-4 mb-4 text-rose-950">
    <LoaderCircle size={22} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    <div><p className="text-sm font-semibold">{c.phase === 'Probing' ? 'Checking for highlights…' : 'Processing your clip…'}</p>
      <p className="text-xs text-rose-800 mt-1">{c.phase === 'Probing' ? 'Analyzing the latest moments from your stream.' : `${c.phase}. Your clip will appear here when it’s ready.`}</p></div>
  </div>;
}
function save(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function ChoiceBars({ answers }: { answers: ClipAnswers }) {
  return <div className="ac-distributions">{Object.entries(answers).filter(([, a]) => a.type !== 'noul').map(([key, answer]) => <details key={key}><summary>{key.replaceAll('_', ' ')} <span>{answer.type === 'choice' ? answer.choice : answer.type === 'score' ? `${answer.score.toFixed(2)} / 4` : ''}</span></summary>{answer.type !== 'noul' && Object.entries(answer.probabilities).map(([option, value]) => <div className="ac-distribution" key={option}><span>{option}</span><meter min={0} max={1} value={value} aria-label={`${key}: ${option}`} /><code>{Math.round(value * 100)}%</code></div>)}</details>)}</div>;
}
function ClipCard({ clip, clipper, onShopClip }: { clip: SavedClip; clipper: Clipper; onShopClip?: (clip: SavedClip) => void }) {
  const [deleting, setDeleting] = useState(false);
  const title = shopClipTitle(clip);
  const description = clip.description?.trim() || clip.brief?.description?.trim() || clip.brief?.summary?.trim() || 'No description is available for this older clip.';
  return <article className="ac-clip">
    <video src={clip.url} controls preload="metadata" playsInline />
    <div className="ac-clip-body"><div className="ac-row"><h3 className="ac-clip-title">{title}</h3><span className="ac-tag ac-good">Saved</span></div>
      <p className="ac-clip-description">{description}</p>
      <p className="ac-meta">{new Date(clip.capturedAt).toLocaleString()} · {clip.source} · {clip.roomId}</p>
      <p className="ac-meta font-mono">{clip.durationSec.toFixed(1)}s clip · source {clip.trim.start.toFixed(1)}–{clip.trim.end.toFixed(1)}s</p>
      <details><summary className="ac-meta">Why this moment</summary>{clip.brief && <p className="ac-meta">{clip.brief.summary}</p>}{clip.edit && <p className="ac-meta">{clip.edit.reason}</p>}<div className="ac-mini-scores">{probability(clip.answers, 'trigger_detected') !== null && <span>Initial trigger <b>{Math.round(probability(clip.answers, 'trigger_detected')! * 100)}%</b></span>}</div></details>
      <div className="ac-actions">{onShopClip && <button type="button" onClick={() => onShopClip(clip)}>Shop this clip</button>}<a className="ac-download" href={clip.downloadUrl} download><Download size={14} />Download WebM</a><button disabled={deleting} onClick={async () => { setDeleting(true); await clipper.remove(clip.id); setDeleting(false); }} aria-label="Delete clip"><Trash2 size={14} /></button></div>
    </div>
  </article>;
}
function PreviousClips({ clipper: c }: { clipper: Clipper }) {
  const [importing, setImporting] = useState(false);
  if (!c.imports.length) return null;
  return <details className="ac-previous"><summary>Previous video clips</summary>{c.imports.map(entry => <div key={`${entry.runId}:${entry.clipId}`}><p className="ac-meta">{entry.title} · {entry.start}–{entry.end}s</p><button disabled={importing || !c.libraryLoaded} onClick={async () => { setImporting(true); await c.importClip(entry); setImporting(false); }}>{importing ? 'Saving…' : 'Add to My Clips'}</button></div>)}</details>;
}
export function MyClipsPage({ clipper: c, onBack, onShopClip }: { clipper: Clipper; onBack: () => void; onShopClip?: (clip: SavedClip) => void }) {
  return <main className="ac-library-page"><header><span className="ac-eyebrow">CLIPTHAT</span><h1>My Clips</h1><p>Your finished highlights, saved automatically.</p><button onClick={onBack}>Back to studio</button></header>
    {c.error && <p className="ac-error" role="alert">{c.error}</p>}
    <p className="ac-meta">{c.libraryLoaded ? `${c.queue.length} saved clip${c.queue.length === 1 ? '' : 's'}` : 'Loading My Clips…'}</p>
    <ClipProcessingStatus clipper={c} />
    <div className="ac-clips">{c.queue.map(clip => <ClipCard key={clip.id} clip={clip} clipper={c} onShopClip={onShopClip} />)}</div>
    {c.libraryLoaded && !c.queue.length && !c.busy && <p>No clips yet. Go live or add a previous video clip below.</p>}
    <PreviousClips clipper={c} />
    <p className="ac-footnote">Saved on this server for this browser. Your clips survive reloads and server restarts.</p>
  </main>;
}
export function LiveClipsPanel({ clipper: c, enabled, onShopClip }: { clipper: Clipper; enabled: boolean; onShopClip?: (clip: SavedClip) => void }) {
  const lastProbe = c.history.find(item => item.stage === 'probe' || item.stage === 'instant');
  const trigger = lastProbe ? probability(lastProbe.result.answers, 'trigger_detected') : null;
  const status = !enabled ? 'Ready when you go live' : !c.ready ? 'Clipping unavailable' : c.busy ? c.phase : c.autoProbe ? 'Watching for highlights' : 'Auto-clipping paused';
  return <section className="ac-live-panel" aria-label="My Clips">
    <div className="ac-live-status">
      <span className="ac-eyebrow">MY CLIPS</span>
      <h2>{c.busy ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Activity size={16} aria-hidden="true" />}{status}</h2>
      <p>{c.autoProbe ? `Checks your live stage every ${c.intervalSec}s. Promising moments become playable clips here.` : 'Turn on Auto-clip below, or use Clip That to capture a moment.'}</p>
      {!enabled && c.autoProbe && <p>Going live sends recorded windows to Gemini for analysis.</p>}
      {c.latest?.selection === 'below-threshold' && <p>The initial trigger was below your threshold.</p>}
      {trigger !== null && <p className="ac-last-probe">{lastProbe?.result.triggerSource === 'soundboard' ? 'Soundboard event:' : 'Last check:'} {Math.round(trigger * 100)}% highlight signal · {Math.round(c.thresholds.trigger * 100)}% to trigger</p>}
    </div>
    {!c.status && <p className="ac-meta">Checking clipping setup…</p>}
    {c.status && !c.ready && <div className="ac-notice"><strong>Clipping needs setup</strong><p>{!c.status.configured && 'Add GEMINI_API_KEY to .env.local and restart the server. '}{!c.status.mediaReady && 'The server’s media tools are unavailable. Redeploy with FFmpeg and ffprobe dependencies installed. '}Reload after setup.</p></div>}
    {c.error && <div role="alert" className="ac-error">{c.error}</div>}
    <p className="ac-meta" role="status">{c.queue.length ? `${c.queue.length} clip${c.queue.length === 1 ? '' : 's'} captured` : c.busy ? 'Your latest moments are being processed.' : enabled ? 'No highlights yet. Keep streaming, or press Clip That.' : 'Use your camera or Share Screen, then Go Live.'}</p>
    <ClipProcessingStatus clipper={c} />
    <div className="ac-live-clips">{c.queue.map(clip => <ClipCard key={clip.id} clip={clip} clipper={c} onShopClip={onShopClip} />)}</div>
    <p className="ac-footnote">Finished clips are saved automatically and survive reloads. No review needed.</p>
  </section>;
}

export function AutoClipper({ clipper: c, enabled }: { clipper: Clipper; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'queue' | 'controls' | 'rules' | 'inspector'>('queue');
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const available = enabled && c.recording && c.ready;
  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key !== 'Tab' || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, textarea, summary, video')).filter(el => el.getClientRects().length);
      const first = focusable[0]; const last = focusable.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; opener.current?.focus(); };
  }, [open]);
  const exportCuts = (format: 'json' | 'csv') => {
    const cuts = c.queue.map(q => ({ id: q.id, room: q.roomId, source: q.source, recordingStartedAt: new Date(q.startedAt).toISOString(), startSec: +q.trim.start.toFixed(3), endSec: +q.trim.end.toFixed(3), status: 'saved', ...Object.fromEntries(Object.keys(labels).map(k => [k, probability(q.answers, 'trigger_detected')])) }));
    const quote = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const text = format === 'json' ? JSON.stringify(cuts, null, 2) : [Object.keys(cuts[0]).map(quote).join(','), ...cuts.map(cut => Object.values(cut).map(quote).join(','))].join('\r\n');
    save(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }), `clipthat-cuts.${format}`);
  };
  return <>
    <section className="ac-bar" aria-label="Auto-clipper">
      <div className="ac-brand"><span className="ac-icon">{c.busy ? <LoaderCircle size={19} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Scissors size={19} />}</span><div><strong>Auto-clipper</strong><span>{c.error ? 'Needs attention' : !c.ready ? 'Checking setup' : !enabled ? 'Starts when you go live' : !c.autoProbe && !c.busy ? 'Auto-clipping paused' : c.phase} <span aria-hidden="true">·</span> {c.bufferedSeconds}s / 60s buffer</span></div></div>
      <label className="ac-switch"><input type="checkbox" role="switch" checked={c.autoProbe} disabled={!c.ready} onChange={e => c.setAutoProbe(e.target.checked)} /><span>Auto-clip <span className="ac-muted">{c.intervalSec}s</span></span></label>
      <div className="ac-bar-actions"><span className="ac-queue-count" aria-live="polite">{c.queue.length} saved clips</span><button disabled={!available || c.busy || c.bufferedSeconds < 1} onClick={() => void c.probe()}><ScanLine size={16} />Probe now</button><button ref={opener} className="ac-dark" onClick={() => setOpen(true)}><SlidersHorizontal size={16} />Clipping studio</button></div>
    </section>
    {open && createPortal(<div className="ac-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}><div className="ac-drawer" role="dialog" aria-modal="true" aria-labelledby="ac-title" tabIndex={-1} ref={dialog}>
      <header className="ac-drawer-header"><div><span className="ac-eyebrow">CLIPTHAT / CLIPPING STUDIO</span><h2 id="ac-title">Find the moments that matter.</h2><p>Live context in. Your next highlight out.</p></div><button className="ac-close" onClick={() => setOpen(false)} aria-label="Close clipping studio"><X size={22} /></button></header>
      <div className="ac-status-strip"><span role="status">{c.busy ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Activity size={15} aria-hidden="true" />}{c.phase}</span><span>{c.bufferedSeconds}s buffered</span><span>{c.latest?.usage ? `${c.latest.usage.total_output_tokens} annotation output tokens` : 'Awaiting first decision'}</span></div>
      <nav className="ac-tabs" aria-label="Clipping panels">{([['queue', 'My Clips', Film], ['controls', 'Controls', SlidersHorizontal], ['rules', 'Rules', Scissors], ['inspector', 'API inspector', Code2]] as const).map(([id, label, Icon]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={16} />{label}{id === 'queue' && <span>{c.queue.length}</span>}</button>)}</nav>
      <div className="ac-content">
        {c.status && (!c.status.configured || !c.status.mediaReady) && <div className="ac-notice"><strong>Finish local setup</strong><p>{!c.status.configured && <>Add <code>GEMINI_API_KEY</code> to <code>.env.local</code> and restart the server. </>}{!c.status.mediaReady && <>The server’s media tools are unavailable. Redeploy with FFmpeg and ffprobe dependencies installed. </>}Recording stays local until you run a probe or judge.</p></div>}
        {c.error && <div role="alert" className="ac-error">{c.error}<button aria-label="Dismiss error" onClick={() => c.setError('')}><X size={16} /></button></div>}
        {tab === 'queue' && <><div className="ac-section-heading"><div><h3>My Clips</h3><p>{c.queue.length} saved automatically · no review needed</p></div><div className="ac-actions"><button disabled={!c.queue.length} onClick={() => exportCuts('json')}>JSON</button><button disabled={!c.queue.length} onClick={() => exportCuts('csv')}>CSV</button></div></div>
          <ClipProcessingStatus clipper={c} />
          {!c.queue.length ? !c.busy && <div className="ac-empty"><span><Film size={30} strokeWidth={1.4} /></span><h3>Let the good moments come to you.</h3><p>Go live, enable auto-probe, and keep creating. Or capture a moment with “clip that.”</p><button className="ac-dark" onClick={() => setTab('controls')}>Set up auto-clipping</button></div> : <div className="ac-clips">{c.queue.map(clip => <ClipCard key={clip.id} clip={clip} clipper={c} />)}</div>}
          <PreviousClips clipper={c} /><p className="ac-footnote">Finished WebM clips are saved on the server for this browser, up to 2 GB. Playback and downloads use the saved cut. Exports include all saved clips.</p></>}
        {tab === 'controls' && <>
          <div className="ac-section-heading"><div><h3>A little context. A better cut.</h3><p>One trigger decides. Selected moments go straight to editing and saving.</p></div></div>
          <div className="ac-control-grid"><div className="ac-control-card"><label className="ac-toggle-row"><span><strong>Auto-probe</strong><small>Check the latest 15s while live</small></span><input type="checkbox" role="switch" checked={c.autoProbe} disabled={!available} onChange={e => c.setAutoProbe(e.target.checked)} /></label><label className="ac-select-row">Check every<select value={c.intervalSec} onChange={e => c.setIntervalSec(Number(e.target.value))}>{[10, 15, 20].map(s => <option key={s} value={s}>{s} seconds</option>)}</select></label></div>
          <div className="ac-control-card"><label className="ac-toggle-row"><span><strong>Include live chat</strong><small>Send matching chat with the video</small></span><input type="checkbox" role="switch" checked={c.includeChat} onChange={e => c.setIncludeChat(e.target.checked)} /></label><p>Off by default. Messages are aligned to the recorded window.</p></div>
          <div className="ac-control-card"><label className="ac-toggle-row"><span><strong>Full-context editing</strong><small>Full context + 10 seconds of post-roll</small></span><input type="checkbox" role="switch" checked={c.deepJudge} onChange={e => c.setDeepJudge(e.target.checked)} /></label><p>{c.deepJudge ? 'After the trigger passes, edit the latest 45–60s with post-roll. No second quality check.' : 'Edit the 15s window immediately when its trigger passes. Manual captures edit the full buffer immediately.'}</p></div>
          </div>
          <div className="ac-control-card"><label htmlFor="clip-query"><strong>What should this clip be about?</strong></label><textarea id="clip-query" rows={3} maxLength={2000} value={c.query} onChange={e => c.setQuery(e.target.value)} placeholder="e.g. The failed comeback and everyone’s reaction" /><p>Applies to manual and voice captures. Leave blank to find the strongest moment.</p></div>
          <div className="ac-actions ac-capture-actions"><button disabled={!available || c.busy || c.bufferedSeconds < 1} onClick={() => void c.probe()}><ScanLine size={16} />Probe now</button><button className="ac-rose" disabled={!available || c.busy || c.bufferedSeconds < 1} onClick={() => c.flush('manual-flush')}><Scissors size={16} />Flush 60s clip</button><span>{c.busy ? c.phase : 'Shorter windows are used during warm-up.'}</span></div>
          <div className="ac-section-heading"><div><h3>Initial trigger threshold</h3><p>This is the only automatic selection check. The threshold is fixed at 50%.</p></div></div>
          <div className="ac-thresholds">{(Object.entries(labels) as [keyof ClipThresholds, string][]).map(([key, label]) => { const value = c.latest ? probability(c.latest.answers, key === 'trigger' ? 'trigger_detected' : key) : null; return <div key={key} className="ac-threshold"><label>{label}<span>{value === null ? 'No result' : `${Math.round(value * 100)}%`}</span></label><div className="ac-probability"><div style={{ width: `${(value ?? 0) * 100}%` }} /><i style={{ left: `${c.thresholds[key] * 100}%` }} /></div><div className="ac-range-row"><code>≥ {Math.round(c.thresholds[key] * 100)}%</code></div></div>; })}</div>
          <p className="ac-footnote">At or above the trigger threshold, the clip goes straight to editing and saving. Manual captures bypass the trigger.</p>
          {c.latest && <ChoiceBars answers={c.latest.answers} />}
        </>}
        {tab === 'rules' && <><div className="ac-section-heading"><div><h3>Tell it what matters.</h3><p>These questions apply to the next API call. Existing scores stay unchanged.</p></div><button onClick={() => c.setRules(DEFAULT_RULES)}>Reset rules</button></div><div className="ac-rules">{(Object.keys(DEFAULT_RULES) as (keyof typeof DEFAULT_RULES)[]).map(key => <label key={key}>Initial trigger<textarea maxLength={2000} rows={4} value={c.rules[key]} onChange={e => c.setRules(old => ({ ...old, [key]: e.target.value }))} /></label>)}</div></>}
        {tab === 'inspector' && <><div className="ac-section-heading"><div><h3>Nothing behind the curtain.</h3><p>Actual requests and responses. Video bytes are omitted from this display.</p></div></div>{!c.history.length ? <div className="ac-empty"><Code2 size={30} /><h3>No requests yet.</h3><p>Run a probe while live to inspect annotations, the editing brief, and editing agent calls.</p></div> : c.history.map(item => <details className="ac-inspection" key={item.id}><summary><span>{item.stage} · {item.result.inspection.elapsedMs}ms</span><code>{item.result.usage?.total_input_tokens ?? '—'} in / {item.result.usage?.total_output_tokens ?? '—'} out</code><ChevronDown size={16} /></summary><pre>{JSON.stringify(item.result.inspection, null, 2)}</pre></details>)}</>}
      </div>
    </div></div>, document.body)}
  </>;
}
