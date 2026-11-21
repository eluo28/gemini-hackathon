import { useEffect, useRef, useState } from 'react';
import type { GiftMessage, GiftProduct } from '../shared/gifting';
import type { StreamAnswer, StreamObject } from '../shared/streamShopping';
import { formatMoney } from '../utils/money';

type Turn = { question: string; answer: string };
function encode(canvas: HTMLCanvasElement) {
  for (const quality of [0.75, 0.5, 0.3]) {
    const data = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    if (data.length <= 500_000) return { mimeType: 'image/jpeg' as const, data };
  }
  throw new Error('This frame is too large. Try a simpler camera view.');
}
function crop(source: HTMLCanvasElement, item: StreamObject) {
  const [top, left, bottom, right] = item.box;
  const x = Math.max(0, Math.floor(left / 1000 * source.width));
  const y = Math.max(0, Math.floor(top / 1000 * source.height));
  const width = Math.max(1, Math.min(source.width - x, Math.ceil((right - left) / 1000 * source.width)));
  const height = Math.max(1, Math.min(source.height - y, Math.ceil((bottom - top) / 1000 * source.height)));
  const result = document.createElement('canvas');
  const scale = Math.min(1, 512 / Math.max(width, height));
  result.width = Math.max(1, Math.round(width * scale)); result.height = Math.max(1, Math.round(height * scale));
  const context = result.getContext('2d');
  if (!context) throw new Error('Your browser could not capture this object.');
  context.drawImage(source, x, y, width, height, 0, 0, result.width, result.height);
  return result;
}

export function StreamShopChat({ isLive, sources, capture, canGift, onGift }: {
  isLive: boolean;
  sources: { id: string; name: string }[];
  capture: (sourceId: string) => HTMLCanvasElement;
  canGift: boolean;
  onGift: (product: GiftProduct) => void;
}) {
  const [question, setQuestion] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [products, setProducts] = useState<GiftProduct[]>([]);
  const [notices, setNotices] = useState<GiftMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const activeSource = sources.some(source => source.id === sourceId) ? sourceId : sources[0]?.id || '';
  useEffect(() => () => { request.current?.abort(); }, []);
  async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
    const response = await fetch(`/api/shop/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.code === 'gemini_not_configured' ? 'The stream assistant is not configured yet. The host needs to enable Gemini recognition.' : data.error || 'Could not inspect this stream.');
    return data;
  }
  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || pending.current) return;
    pending.current = true; setBusy(true); setError(''); setProducts([]); setNotices([]);
    const controller = new AbortController(); request.current = controller;
    try {
      const frame = capture(activeSource); // Frozen at the moment the viewer asks.
      setQuestion(''); setStatus('Looking at the stream…');
      setTurns(previous => [...previous.slice(-5), { question: text, answer: 'Looking at this frame…' }]);
      const answer = await post<StreamAnswer>('ask-stream', { question: text, frames: [encode(frame)] }, controller.signal);
      if (controller.signal.aborted) return;
      setTurns(previous => previous.map((turn, index) => index === previous.length - 1 ? { ...turn, answer: answer.answer } : turn));
      if (!answer.items.length) return;
      setStatus('Finding similar products on Shop…');
      // Independent lookups, bounded to two identified objects. No auto-retries.
      const results = await Promise.allSettled(answer.items.slice(0, 2).map(item => post<{ products: GiftProduct[]; messages: GiftMessage[] }>('match-stream-item', { query: item.searchQuery, image: encode(crop(frame, item)) }, controller.signal)));
      if (controller.signal.aborted) return;
      const found: GiftProduct[] = [], warnings: GiftMessage[] = [];
      const seen = new Set<string>(); const failures: string[] = [];
      for (const result of results) {
        if (result.status === 'rejected') { failures.push(result.reason instanceof Error ? result.reason.message : 'A Shop lookup failed.'); continue; }
        warnings.push(...result.value.messages);
        for (const product of result.value.products) {
          const key = `${product.shop}:${product.variantId}`;
          if (!seen.has(key)) { seen.add(key); found.push(product); }
        }
      }
      setProducts(found); setNotices(warnings);
      if (failures.length) setError([...new Set(failures)].join(' '));
      else if (!found.length) setError('I found the object in the video, but no purchasable Shop matches were returned. Try another angle or a clearer view.');
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : 'Could not inspect this stream.');
        setTurns(previous => previous.map((turn, index) => index === previous.length - 1 && turn.answer === 'Looking at this frame…' ? { ...turn, answer: 'I couldn’t inspect this frame. See the message below.' } : turn));
      }
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) { setBusy(false); setStatus(''); }
    }
  }
  return <section aria-label="Ask about this stream" className="w-full max-w-4xl mx-auto rounded-2xl border border-violet-200 bg-white p-4 space-y-3">
    <div><h2 className="font-semibold text-slate-950">Ask about this stream</h2><p className="mt-1 text-xs text-slate-500">“What’s that mug in the background?” We look at a snapshot only when you ask.</p></div>
    {sources.length > 1 && <label className="block text-xs text-slate-600">Look at <select aria-label="Stream to inspect" disabled={busy} value={activeSource} onChange={e => setSourceId(e.target.value)} className="ml-2 rounded-lg border p-1.5">{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>}
    {turns.map((turn, index) => <div key={index} className="space-y-2 text-sm"><p className="ml-8 rounded-xl bg-violet-50 p-3 text-violet-950">{turn.question}</p><p className="mr-8 rounded-xl bg-slate-50 p-3 text-slate-700">{turn.answer}</p></div>)}
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
    {notices.map((notice, index) => <div key={index} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-950"><p>{notice.content}</p>{notice.links.map(link => <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="mr-2 underline">{link.label}</a>)}{notice.images.map(image => <img key={image.url} src={image.url} alt={image.alt} className="mt-2 max-h-32" />)}</div>)}
    <div className="grid gap-3 sm:grid-cols-3">{products.map(product => <article key={`${product.shop}:${product.variantId}`} className="rounded-xl border border-slate-200 p-3 space-y-2">
      <span className="text-xs font-semibold text-violet-700">Similar find on Shop</span>
      {product.image && <img src={product.image} alt={product.title} loading="lazy" className="h-28 w-full object-contain" />}
      <h3 className="text-sm font-semibold">{product.title}</h3><p className="text-xs text-slate-500">{product.seller}</p>
      <p className="text-xs text-slate-500">{product.selected.map(option => `${option.name}: ${option.label}`).join(' · ')}</p>
      <p className="text-sm font-semibold">{formatMoney(product.amount, product.currency)}</p>
      <a href={product.url} target="_blank" rel="noreferrer" className="block text-xs underline">View product details</a>
      <button type="button" disabled={!canGift || !product.available} onClick={() => onGift(product)} className="w-full rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{!product.available ? 'Unavailable' : canGift ? 'Gift this item' : 'Creator gifting unavailable'}</button>
    </article>)}</div>
    {products.length > 0 && <p className="text-xs text-slate-500">These are similar products, not verified exact matches. Price and availability are rechecked before adding a gift.</p>}
    {busy && <p role="status" className="text-sm text-violet-700">{status}</p>}
    <form onSubmit={e => void ask(e)} className="flex gap-2">
      <label className="flex-1"><span className="sr-only">Question about an object in the stream</span><input aria-label="Question about an object in the stream" value={question} onChange={e => setQuestion(e.target.value)} maxLength={500} required disabled={busy || !isLive} placeholder={isLive ? 'Ask about something you can see…' : 'Questions are available when the stream is live'} className="w-full rounded-xl border border-slate-300 p-3 text-sm disabled:bg-slate-50" /></label>
      <button disabled={busy || !isLive || !activeSource || !question.trim()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Ask</button>
    </form>
    <p className="text-[11px] text-slate-400">Your question and a stream snapshot go to Gemini Hydrogen. Object crops go to Shop to find products. No background scanning.</p>
  </section>;
}
