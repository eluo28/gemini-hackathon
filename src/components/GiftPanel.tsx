import { useEffect, useRef, useState } from 'react';
import type { GiftMessage, GiftProduct, GiftView, ShopConnection } from '../shared/gifting';

export function giftMoney(amount: number, currency: string) {
  try { const format = new Intl.NumberFormat(undefined, { style: 'currency', currency }); return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2)); }
  catch { return `${amount} ${currency} (minor units)`; }
}
function Notices({ messages }: { messages: GiftMessage[] }) {
  return <>{messages.map((message, i) => <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
    <p>{message.content}</p>
    {message.links.map(link => <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="mr-3 underline">{link.label}</a>)}
    {message.images.map(image => <img key={image.url} src={image.url} alt={image.alt} className="mt-2 max-h-40" />)}
  </div>)}</>;
}

export function GiftPanel({ roomId, recipient, onClose }: { roomId: string; recipient: string; onClose: () => void }) {
  const [state, setState] = useState<GiftView | null>(null);
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<GiftProduct[]>([]);
  const [searchNotices, setSearchNotices] = useState<GiftMessage[]>([]);
  const [searched, setSearched] = useState(false);
  const [connection, setConnection] = useState<ShopConnection | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [instrument, setInstrument] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [handoffOpened, setHandoffOpened] = useState(false);
  const mounted = useRef(true);
  const panelRef = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);
  async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`/api/gifting${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
    const data = await response.json();
    if (!response.ok) {
      if (mounted.current && data.state) setState(data.state);
      throw new Error(data.error || 'Shop request failed.');
    }
    return data;
  }
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Shop is unavailable.'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    openerRef.current = document.activeElement as HTMLElement;
    panelRef.current?.focus();
    const controller = new AbortController();
    void api<GiftView>('/session', {}, controller.signal).then(view => { if (mounted.current) setState(view); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { mounted.current = false; controller.abort(); openerRef.current?.focus(); };
  }, []);
  useEffect(() => { setInstrument(''); setConfirmed(false); }, [state?.checkout?.reviewId]);
  useEffect(() => {
    if (!connection) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!active) return;
      if (Date.now() >= connection.expiresAt) { setConnection(null); setError('Shop sign-in expired. Connect again when ready.'); return; }
      if (busyRef.current) { timer = setTimeout(poll, connection.interval * 1000); return; }
      try {
        const result = await api<{status: string; interval: number}>('/connection/poll', {});
        if (!active) return;
        if (result.status === 'connected') { setConnection(null); const view = await api<GiftView>('/state'); if (active) setState(view); }
        else timer = setTimeout(poll, result.interval * 1000);
      } catch (e) { if (active) { setConnection(null); setError(e instanceof Error ? e.message : 'Shop sign-in failed.'); } }
    };
    timer = setTimeout(poll, connection.interval * 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [connection]);

  const update = (path: string, body: unknown = {}) => run(async () => { const view = await api<GiftView>(path, body); if (mounted.current) setState(view); });
  const checkout = state?.checkout;
  const hosted = handoffOpened || Boolean(checkout?.handoffOpened);
  const lockCart = busy || Boolean(checkout) || Boolean(state?.uncertainWrite);
  return <section ref={panelRef} tabIndex={-1} aria-label={`Gift to ${recipient}`} className="mx-5 md:mx-7 mb-5 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm outline-none space-y-4">
    <div className="flex flex-wrap justify-between items-center gap-3">
      <div><h2 className="font-semibold text-lg">Gift to {recipient}</h2><p className="text-sm text-slate-500">Choose a product. Review delivery and payment before buying.</p></div>
      <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm">Close gifts</button>
    </div>
    {state?.simulated && <p role="status" className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 font-semibold text-amber-950">LOCAL DEMO — simulated products, sign-in, and orders. No payment or delivery occurs.</p>}
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {!state && !error && <p role="status">Opening gift cart…</p>}
    {state && <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>{state.connected ? (state.simulated ? 'Demo buyer connected' : 'Shop connected') : 'Connect Shop to pay with your saved payment method.'}</span>
        {!state.connected && !connection && <button disabled={busy} onClick={() => void run(async () => {
          const result = await api<ShopConnection & {simulated?: boolean}>('/connect', {});
          if (result.simulated) setState(await api<GiftView>('/state')); else setConnection(result);
        })} className="rounded-xl bg-slate-950 px-4 py-2 font-semibold text-white disabled:opacity-50">{state.simulated ? 'Connect demo buyer' : 'Connect Shop'}</button>}
        {(state.connected || connection) && <button disabled={busy} onClick={() => void run(async () => { const view = await api<GiftView>('/disconnect', {}); setConnection(null); setState(view); })} className="underline">{connection ? 'Cancel sign-in' : 'Disconnect'}</button>}
      </div>
      {connection && <div role="status" className="rounded-lg bg-violet-50 p-3 text-sm space-y-2">
        <a href={connection.url} target="_blank" rel="noreferrer" className="font-semibold underline">Sign in and approve on Shop</a>
        <p>Code: <strong>{connection.code}</strong>. Waiting for your approval…</p>
      </div>}
      {!checkout && <>
        <form onSubmit={e => { e.preventDefault(); void run(async () => { const result = await api<{products: GiftProduct[]; messages: GiftMessage[]}>('/search', { roomId, query }); setProducts(result.products); setSearchNotices(result.messages); setSearched(true); }); }} className="flex flex-wrap gap-2">
          <label className="flex-1 min-w-48"><span className="sr-only">Search gifts</span><input value={query} onChange={e => setQuery(e.target.value)} required maxLength={500} placeholder="Search for a gift, e.g. ceramic mug" className="w-full rounded-xl border border-slate-300 p-3 text-sm" /></label>
          <button disabled={busy} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Search gifts</button>
        </form>
        <Notices messages={searchNotices} />
        {searched && !products.length && <p className="text-sm text-slate-500">No matching products. Try another search.</p>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{products.map(product => <article key={product.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
          {product.image && <img src={product.image} alt={product.title} loading="lazy" className="h-32 w-full object-contain" />}
          <h3 className="text-sm font-semibold">{product.title}</h3><p className="text-xs text-slate-500">{product.seller}</p>
          <p className="text-sm font-semibold">{giftMoney(product.amount, product.currency)}</p>
          {product.options.map(option => <label key={option.name} className="block text-xs">{option.name}<select disabled={busy} value={product.selected.find(v => v.name === option.name)?.label || ''} onChange={e => void run(async () => {
            const selected = [...product.selected.filter(v => v.name !== option.name), { name: option.name, label: e.target.value }];
            const result = await api<{products: GiftProduct[]; messages: GiftMessage[]}>('/product', { roomId, productId: product.id, selected });
            if (!result.products[0]) throw new Error('This option could not be verified.');
            setProducts(previous => previous.map(p => p.id === product.id ? result.products[0] : p)); setSearchNotices(result.messages);
          })} className="ml-2 rounded border p-1"><option value="" disabled>Choose {option.name}</option>{option.values.map(value => <option key={value}>{value}</option>)}</select></label>)}
          <p className="text-xs text-slate-500">{product.selected.map(option => `${option.name}: ${option.label}`).join(' · ')}{!product.available && ' · Unavailable'}</p>
          <a href={product.url} target="_blank" rel="noreferrer" className="text-xs underline">Product details</a>
          <button disabled={lockCart || !product.available} onClick={() => void update('/cart/add', { roomId, productId: product.id, variantId: product.variantId, selected: product.selected })} className="block w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Add gift to cart</button>
        </article>)}</div>
      </>}
      {state.cart && <div className="border-t pt-4 space-y-3">
        <h3 className="font-semibold">Gift cart for {state.recipient}</h3><p className="text-xs text-slate-500">Store: {state.cart.shop}</p>
        {state.cart.lines.map(line => <div key={line.id} className="flex flex-wrap items-center gap-3 text-sm">
          {line.image && <img src={line.image} alt="" className="h-12 w-12 object-contain" />}
          <div className="flex-1"><p>{line.title}</p><p className="text-xs text-slate-500">{line.options}</p></div>
          <button disabled={lockCart} aria-label={`Decrease quantity of ${line.title}`} onClick={() => void update('/cart/quantity', { lineId: line.id, quantity: line.quantity - 1 })} className="rounded border px-3 py-1 disabled:opacity-40">−</button>
          <span>Quantity: {line.quantity}</span>
          <button disabled={lockCart || line.quantity >= 20} aria-label={`Increase quantity of ${line.title}`} onClick={() => void update('/cart/quantity', { lineId: line.id, quantity: line.quantity + 1 })} className="rounded border px-3 py-1 disabled:opacity-40">+</button>
          <button disabled={lockCart} onClick={() => void update('/cart/quantity', { lineId: line.id, quantity: 0 })} className="underline disabled:opacity-40">Remove</button>
        </div>)}
        {!checkout && <>{state.cart.totals.map((total, i) => <p key={i} className="text-sm">{total.label}: {giftMoney(total.amount, state.cart!.currency)}</p>)}
          <p className="text-xs text-slate-500">Shipping and tax are confirmed at checkout. Each cart is for one store.</p>
          <button disabled={busy || !state.connected || !state.cart.lines.length || state.uncertainWrite} onClick={() => void update('/checkout')} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Review gift checkout</button>
        </>}
      </div>}
      <Notices messages={state.messages} />
      {checkout && <div className="rounded-xl border border-slate-200 p-4 space-y-3">
        <h3 className="font-semibold">{checkout.orderConfirmed ? (checkout.giftConfirmed ? 'Gift purchase confirmed' : 'Order placed — verify recipient') : 'Review your gift purchase'}</h3>
        <p className="text-sm">Recipient: <strong>{state.recipient}</strong>. You pay with your own Shop account.</p>
        <p className="text-xs text-slate-500">Delivery details may be visible in merchant checkout and order records.</p>
        {checkout.delivery.map(group => <label key={`${group.methodKey}-${group.groupKey}`} className="block text-sm">Delivery option<select disabled={busy || checkout.completionAttempted || hosted} value={group.selected || ''} onChange={e => void update('/delivery', { methodKey: group.methodKey, groupKey: group.groupKey, optionKey: e.target.value })} className="ml-2 rounded border p-2"><option value="" disabled>Choose delivery</option>{group.options.map(option => <option key={option.key} value={option.key}>{option.label}{option.amount !== undefined ? ` · ${giftMoney(option.amount, checkout.currency)}` : ''}</option>)}</select></label>)}
        {checkout.totals.map((total, i) => <p key={i} className="text-sm font-medium">{total.label}: {giftMoney(total.amount, checkout.currency)}</p>)}
        <div className="flex flex-wrap gap-3 text-xs">{checkout.links.map(link => <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="underline">{link.label}</a>)}</div>
        {!checkout.recipientVerified && !checkout.giftConfirmed && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Shop has not confirmed the streamer’s shipping destination. In-app payment is disabled. If you continue on Shop, verify the recipient before paying.</p>}
        {checkout.status === 'ready_for_complete' && checkout.recipientVerified && !checkout.completionAttempted && !hosted && <>
          <label className="block text-sm">Payment method<select value={instrument} onChange={e => { setInstrument(e.target.value); setConfirmed(false); }} disabled={busy} className="ml-2 rounded border p-2"><option value="">Choose payment method</option>{checkout.instruments.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} />I confirm this store, the items and quantities, the displayed total, the recipient, and my chosen payment method.</label>
          <button disabled={busy || !state.connected || !instrument || !confirmed || state.uncertainWrite} onClick={() => void update('/complete', { confirm: true, reviewId: checkout.reviewId, instrumentKey: instrument })} className="rounded-xl bg-violet-700 px-4 py-3 font-semibold text-white disabled:opacity-40">{state.simulated ? 'Place simulated gift order' : 'Confirm and pay for gift'}</button>
        </>}
        {(checkout.completionAttempted && !checkout.orderConfirmed || hosted || checkout.status === 'complete_in_progress') && <p role="status" className="text-sm font-medium">Payment may be processing. Refresh status; do not submit another payment.</p>}
        {checkout.giftConfirmed && <p role="status" className="text-sm font-semibold text-emerald-800">{state.simulated ? 'Simulated gift alert sent. No charge was made.' : 'Your gift order is confirmed. The streamer has been notified.'}</p>}
        {checkout.continueUrl && !checkout.orderConfirmed && !checkout.completionAttempted && !state.uncertainWrite && <button disabled={busy} onClick={() => {
          const popup = window.open('about:blank', '_blank');
          void run(async () => {
            try { const result = await api<{url:string}>('/handoff', {}); setHandoffOpened(true); if (popup) { popup.opener = null; popup.location.href = result.url; } else window.location.assign(result.url); }
            catch (e) { popup?.close(); throw e; }
          });
        }} className="block text-sm font-semibold underline">{checkout.status === 'requires_escalation' ? 'Finish required step on Shop' : 'Review and pay on Shop instead'}</button>}
      </div>}
      {(state.cart || checkout || state.uncertainWrite) && <div className="flex flex-wrap gap-4 text-sm">
        <button disabled={busy} onClick={() => void update('/refresh')} className="rounded-lg border px-3 py-2 disabled:opacity-40">Refresh gift status</button>
        <button disabled={busy || state.uncertainWrite || Boolean(checkout?.completionAttempted && !checkout.orderConfirmed) || hosted && !checkout?.orderConfirmed} onClick={() => void run(async () => { setState(await api<GiftView>('/clear', {})); setHandoffOpened(false); })} className="underline disabled:opacity-40">{checkout?.orderConfirmed ? 'Start another gift' : 'Clear gift cart'}</button>
      </div>}
      {state.uncertainWrite && <p role="alert" className="text-sm text-amber-900">The previous request has an uncertain outcome. Refresh status before trying anything else.</p>}
    </>}
    {busy && <p role="status" className="text-sm text-slate-500">Working with {state?.simulated ? 'local demo' : 'Shop'}…</p>}
  </section>;
}
