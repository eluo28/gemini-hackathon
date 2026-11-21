import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { GiftMessage, GiftProduct, PendingPurchase } from '../shared/gifting';
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

const NO_EXCLUDED_SHOPS: string[] = [];

export interface ShopChatHandle { ask: (question: string) => void }

export function StreamShopChat({ isLive, sources, capture, canGift, onGift, onBuy, purchaseBusy = false, excludedShopDomains = NO_EXCLUDED_SHOPS, purchaseBlockReason = '', onReviewCart, pendingPurchase, embedded = false, controllerRef, onBusyChange, compact = false }: {
  embedded?: boolean;
  compact?: boolean;
  controllerRef?: Ref<ShopChatHandle>;
  onBusyChange?: (busy: boolean) => void;
  isLive: boolean;
  sources: { id: string; name: string }[];
  capture: (sourceId: string) => HTMLCanvasElement;
  canGift: boolean;
  purchaseBusy?: boolean;
  excludedShopDomains?: string[];
  purchaseBlockReason?: string;
  onReviewCart?: () => void;
  pendingPurchase?: PendingPurchase | null;
  onBuy: (product: GiftProduct) => void;
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
  const questionInput = useRef<HTMLInputElement | null>(null);
  const inputDisabled = busy || !isLive;
  useEffect(() => {
    if (inputDisabled) questionInput.current?.blur();
  }, [inputDisabled]);
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
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
  useImperativeHandle(controllerRef, () => ({ ask: text => { void ask(text); } }));
  async function ask(value = question) {
    const text = value.trim();
    if (!isLive || !activeSource || !text || pending.current) return;
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
      const allowed = found.filter(product => !excludedShopDomains.includes(product.shop));
      setProducts(allowed.slice(0, 3)); setNotices(warnings);
      if (failures.length) setError([...new Set(failures)].join(' '));
      else if (found.length && !allowed.length) setError('The matching stores have already required merchant checkout, so their products are hidden. No alternative matches were returned.');
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
  const visibleProducts = products.filter(product => !excludedShopDomains.includes(product.shop));
  const adding = (product: GiftProduct, mode: 'gift' | 'self') => pendingPurchase?.mode === mode && pendingPurchase.shop === product.shop && pendingPurchase.variantId === product.variantId;
  return <section aria-label="Ask about this stream" className={embedded ? 'space-y-3' : 'w-full max-w-4xl mx-auto rounded-2xl border border-violet-200 bg-white p-4 space-y-3'}>
    {!compact && <div>{!embedded && <h2 className="font-semibold text-slate-950">Ask about this stream</h2>}<p className="mt-1 text-xs text-slate-500">“What’s that mug in the background?” We look at a snapshot only when you ask.</p></div>}
    {compact && turns.length === 0 && <p className="text-xs text-slate-500">Ask <span className="font-semibold text-violet-700">@shop</span> about something in the stream.</p>}
    {sources.length > 1 && <label className="block text-xs text-slate-600">Look at <select aria-label="Stream to inspect" disabled={busy} value={activeSource} onChange={e => setSourceId(e.target.value)} className="ml-2 rounded-lg border p-1.5">{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>}
    {(compact ? turns.slice(-1) : turns).map((turn, index) => <div key={index} className="space-y-2 text-sm"><p className="rounded-xl bg-violet-50 p-3 text-violet-950">{turn.question}</p><p className="rounded-xl bg-slate-50 p-3 text-slate-700">{turn.answer}</p></div>)}
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
    {notices.map((notice, index) => <div key={index} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-950"><p>{notice.content}</p>{notice.links.map(link => <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="mr-2 underline">{link.label}</a>)}{notice.images.map(image => <img key={image.url} src={image.url} alt={image.alt} className="mt-2 max-h-32" />)}</div>)}
    {visibleProducts.length > 0 && purchaseBlockReason && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"><p>{purchaseBlockReason}</p>{onReviewCart && <button type="button" onClick={onReviewCart} className="mt-1 font-semibold underline">Open cart</button>}</div>}
    <div className={compact ? "space-y-2" : "grid gap-3 sm:grid-cols-3"}>{visibleProducts.map(product => <article key={`${product.shop}:${product.variantId}`} className={compact ? "grid grid-cols-[56px_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-xl border border-slate-200 p-2 text-xs" : "rounded-xl border border-slate-200 p-3 space-y-2"}>
      {!compact && <span className="text-xs font-semibold text-violet-700">Similar find on Shop</span>}
      {product.image && <img src={product.image} alt={product.title} loading="lazy" className={compact ? "col-start-1 row-span-5 h-14 w-14 object-contain" : "h-28 w-full object-contain"} />}
      <h3 className={compact ? "col-start-2 line-clamp-2 text-xs font-semibold leading-4" : "text-sm font-semibold"}>{product.title}</h3><p className="col-start-2 text-xs text-slate-500 break-words">{product.seller}</p>
      <p className="col-start-2 text-xs text-slate-500">{product.selected.map(option => `${option.name}: ${option.label}`).join(' · ')}</p>
      <p className="col-start-2 text-xs font-semibold">{formatMoney(product.amount, product.currency)}</p>
      <a href={product.url} target="_blank" rel="noreferrer" className="col-start-2 block text-xs underline">View product details</a>
      <button type="button" aria-busy={adding(product, 'gift')} disabled={purchaseBusy || !canGift || !product.available} onClick={() => onGift(product)} className={`col-span-2 w-full rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed ${purchaseBusy && !adding(product, 'gift') ? 'bg-slate-100 text-slate-400' : !canGift || !product.available ? 'bg-violet-700 text-white opacity-40' : 'bg-violet-700 text-white'}`} >{adding(product, 'gift') ? 'Adding gift…' : !product.available ? 'Unavailable' : canGift ? 'Gift to streamer' : 'Creator gifting unavailable'}</button>
      <button type="button" aria-busy={adding(product, 'self')} disabled={purchaseBusy || !product.available} onClick={() => onBuy(product)} className={`col-span-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed ${purchaseBusy && !adding(product, 'self') ? 'bg-slate-100 text-slate-400' : 'text-slate-900'}`}>{adding(product, 'self') ? 'Adding for you…' : 'Buy for myself'}</button>
    </article>)}</div>
    {visibleProducts.length > 0 && <p className="text-xs text-slate-500">These are similar products, not verified exact matches. Price and availability are rechecked before adding to your cart.</p>}
    {products.length > 0 && visibleProducts.length === 0 && <p role="status" className="text-xs text-slate-500">These matches were hidden because their stores require merchant checkout.</p>}
    {busy && <p role="status" className="text-sm text-violet-700">{status}</p>}
    {!compact && <form onSubmit={e => { e.preventDefault(); void ask(); }} className="flex gap-2">
      <label className="flex-1"><span className="sr-only">Question about an object in the stream</span><input ref={questionInput} aria-label="Question about an object in the stream" value={question} onChange={e => setQuestion(e.target.value)} maxLength={500} required disabled={inputDisabled} placeholder={isLive ? 'Ask about something you can see…' : 'Questions are available when the stream is live'} className="w-full rounded-xl border border-slate-300 p-3 text-sm disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed disabled:caret-transparent" /></label>
      <button disabled={busy || !isLive || !activeSource || !question.trim()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Ask</button>
    </form>}
    {!compact && <p className="text-[11px] text-slate-400">Your question and a stream snapshot go to Gemini Hydrogen. Object crops go to Shop to find products. No background scanning.</p>}
  </section>;
}
