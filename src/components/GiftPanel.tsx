import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GiftMessage, GiftProduct, GiftView, ShopConnection, PurchaseMode, PendingPurchase } from '../shared/gifting';

import { formatMoney as giftMoney } from '../utils/money';
function Notices({ messages }: { messages: GiftMessage[] }) {
  // Compatibility with the running backend, which included the same checkout
  // notices twice. Collapse only a repeated whole list, preserving its contents.
  const midpoint = messages.length / 2;
  const visible = messages.length > 0 && messages.length % 2 === 0
    && JSON.stringify(messages.slice(0, midpoint)) === JSON.stringify(messages.slice(midpoint))
    ? messages.slice(0, midpoint) : messages;
  return <>{visible.map((message, i) => {
    const content = message.content;
    const translated = /^Metodo di contatto valido mancante/i.test(content)
      ? 'A valid contact method is missing. Add your email address or phone number on the merchant’s checkout page.'
      : /non possono essere spediti al tuo indirizzo/i.test(content)
        ? 'The merchant reports that the items cannot ship to the selected address. Remove these items or choose a valid delivery address on the merchant’s checkout page.'
        : message.code === 'checkout_completion_ineligible' || content.startsWith('This checkout is ineligible for completion via API.') || /interazione con l.estensione/i.test(content) || content === 'An extension interaction is required to complete the checkout.'
          ? 'This store requires an additional step on its checkout page before you can buy.'
          : content;
    return <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <p>{translated}</p>
      {translated !== content && <details className="mt-2 text-xs"><summary className="cursor-pointer underline">Original merchant notice</summary><p className="mt-1">{content}</p></details>}
      {message.links.map(link => <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="mr-3 underline">{link.label}</a>)}
      {message.images.map(image => <img key={image.url} src={image.url} alt={image.alt} className="mt-2 max-h-40" />)}
    </div>;
  })}</>;
}

const EMPTY_PRODUCTS: GiftProduct[] = [];
type ShoppingActions = { add: (product: GiftProduct, mode: PurchaseMode) => void; busy: boolean; pending: PendingPurchase | null; blockedReason: string; reviewCart: () => void };

export function GiftPanel({ roomId, recipient, initialProducts = EMPTY_PRODUCTS, chat, onClose, compact = false, onConnectionChange }: { roomId: string; recipient: string; initialProducts?: GiftProduct[]; chat?: ReactNode | ((actions: ShoppingActions) => ReactNode); onClose?: () => void; compact?: boolean; onConnectionChange?: (connected: boolean) => void }) {
  useEffect(() => () => { onConnectionChange?.(false); }, [onConnectionChange]);
  const [cartOpen, setCartOpen] = useState(!chat);
  const [state, setState] = useState<GiftView | null>(null);
  useEffect(() => { onConnectionChange?.(Boolean(state?.connected)); }, [state?.connected, onConnectionChange]);
  const [products, setProducts] = useState<GiftProduct[]>(initialProducts);
  const [searchNotices, setSearchNotices] = useState<GiftMessage[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [connection, setConnection] = useState<ShopConnection | null>(null);
  const [error, setError] = useState('');
  const [added, setAdded] = useState('');
  const [pendingPurchase, setPendingPurchase] = useState<PendingPurchase | null>(null);
  const [busy, setBusy] = useState(false);
  const [instrument, setInstrument] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [handoffOpened, setHandoffOpened] = useState(false);
  const mounted = useRef(true);
  const panelRef = useRef<HTMLElement>(null);
  const cartRef = useRef<HTMLDivElement>(null);
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
    if (!chat) panelRef.current?.focus();
    const controller = new AbortController();
    void api<GiftView>('/session', {}, controller.signal).then(view => { if (mounted.current) { setState(view); if (view.cart) setCartOpen(true); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { mounted.current = false; controller.abort(); openerRef.current?.focus(); };
  }, []);
  useEffect(() => {
    setProducts(initialProducts);
    if (initialProducts.length) setCartOpen(true);
  }, [initialProducts]);
  useEffect(() => { setInstrument(''); setConfirmed(false); }, [state?.checkout?.reviewId]);
  useEffect(() => {
    if (!connection) return;
    let active = true;
    let polling = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!active || polling) return;
      clearTimeout(timer);
      if (Date.now() >= connection.expiresAt) { setConnection(null); setError('Shop sign-in expired. Connect again when ready.'); return; }
      if (busyRef.current) { timer = setTimeout(poll, connection.interval * 1000); return; }
      polling = true;
      try {
        const result = await api<{status: string; interval: number}>('/connection/poll', {});
        if (!active) return;
        if (result.status === 'connected') {
          const view = await api<GiftView>('/state');
          if (!active) return;
          // Clearing connection tears this effect down. Publish the connected
          // state first so cleanup cannot discard the awaited response.
          setState(view);
          setConnection(null);
        }
        else timer = setTimeout(poll, result.interval * 1000);
      } catch (e) { if (active) { setConnection(null); setError(e instanceof Error ? e.message : 'Shop sign-in failed.'); } }
      finally { polling = false; }
    };
    const onReturn = () => { if (!document.hidden) void poll(); };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    timer = setTimeout(poll, connection.interval * 1000);
    return () => {
      active = false; clearTimeout(timer);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [connection]);

  const update = (path: string, body: unknown = {}) => run(async () => { const view = await api<GiftView>(path, body); if (mounted.current) { setState(view); setHandoffOpened(Boolean(view.checkout?.handoffOpened)); if (!view.cart) setAdded(''); if (view.cart) setCartOpen(true); } });
  const addProduct = (product: GiftProduct, mode: PurchaseMode) => {
    if (busyRef.current) return;
    setCartOpen(true); setAdded('');
    setPendingPurchase({ shop: product.shop, variantId: product.variantId, mode });
    void run(async () => {
      try {
      const view = await api<GiftView>('/cart/add', { roomId, mode, productId: product.id, variantId: product.variantId, selected: product.selected });
      if (mounted.current) { setState(view); setProducts([]); reviewCart(); setAdded(`${product.title} added ${mode === 'self' ? 'for you' : 'as a streamer gift'}.`); }
      } catch (error) {
        if (mounted.current) reviewCart();
        throw error;
      } finally { if (mounted.current) setPendingPurchase(null); }
    });
  };
  const selfPurchase = state?.mode === 'self';
  const checkout = state?.checkout;
  const hosted = handoffOpened || Boolean(checkout?.handoffOpened);
  const checkoutResolved = Boolean(checkout?.orderConfirmed || checkout?.status === 'canceled');
  const lockCartEdits = busy || Boolean(state?.uncertainWrite) || Boolean(checkout?.completionAttempted) || hosted || ['completed', 'complete_in_progress'].includes(checkout?.status || '');
  const lockCart = busy || Boolean(checkout) || Boolean(state?.uncertainWrite);
  const blockedReason = state?.uncertainWrite ? 'Shop has not confirmed your last request. Open the cart and refresh its status before adding more items.'
    : checkout?.orderConfirmed || checkout?.status === 'canceled' ? 'This checkout is finished. Open the cart and start another purchase.'
    : checkout ? 'A checkout is already in progress. Open the cart to finish it or clear it before adding more items.' : '';
  const reviewCart = () => {
    setCartOpen(true);
    requestAnimationFrame(() => { cartRef.current?.focus(); cartRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  };
  const cartCount = state?.cart?.lines.reduce((sum, line) => sum + line.quantity, 0) || 0;
  return <section ref={panelRef} tabIndex={-1} aria-label={chat ? 'Shop this stream' : `Gift to ${recipient}`} className={compact ? 'min-w-0 bg-white p-3 outline-none space-y-2 text-xs' : `${chat ? 'w-full max-w-4xl mx-auto' : 'mx-5 md:mx-7 mb-5'} rounded-2xl border border-violet-200 bg-white p-5 shadow-sm outline-none space-y-4`}>
    <div className={compact ? "sticky top-0 z-10 flex flex-wrap justify-between items-center gap-3 bg-white py-2" : "flex flex-wrap justify-between items-center gap-3"}>
      <div><h2 className={compact ? "font-semibold text-sm text-violet-700" : "font-semibold text-lg"}>{compact ? '@shop' : chat ? 'Shop this stream' : `Gift to ${recipient}`}</h2>{!compact && <p className="text-sm text-slate-500">{chat ? 'Ask about what you see, find a product, and send a gift.' : 'Choose a product. Review delivery and payment before buying.'}</p>}</div>
      {chat && state?.connected ? <button type="button" aria-expanded={cartOpen} aria-controls="stream-gift-cart" onClick={() => cartOpen ? setCartOpen(false) : reviewCart()} className="rounded-lg border px-3 py-2 text-sm">Cart ({cartCount}) <span aria-hidden="true">{cartOpen ? '▴' : '▾'}</span></button> : onClose ? <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm">Close gifts</button> : null}
    </div>
    {state?.simulated && <p role="status" className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 font-semibold text-amber-950">LOCAL DEMO — simulated products, sign-in, and orders. No payment or delivery occurs.</p>}
    {error && (!cartOpen || !state) && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {!state && !error && <p role="status">Opening gift cart…</p>}
    {state && <>
      {state.connected && <div ref={cartRef} tabIndex={-1} aria-label="Your shopping cart" id="stream-gift-cart" hidden={!cartOpen} className={compact ? "max-h-56 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3" : "space-y-4 border-t border-slate-100 pt-4"}>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {!checkout && <>
        <Notices messages={searchNotices} />
        {!error && !products.length && !state.cart?.lines.length && <p className="text-sm text-slate-500">Your cart is empty. Ask @shop about something in the stream to find products.</p>}
        <div className={compact ? "grid gap-2" : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"}>{products.map(product => <article key={product.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
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
        <h3 className="font-semibold">{selfPurchase ? 'Your cart · Buy for myself' : `Gift cart for ${state.recipient}`}</h3><p className="text-xs text-slate-500">Store: {state.cart.shop}</p>
        {checkout && !lockCartEdits && <p className="text-xs text-slate-500">Changing items clears this checkout review. Review the updated total before paying.</p>}
        {state.cart.lines.map(line => <div key={line.id} className="flex flex-wrap items-center gap-3 text-sm">
          {line.image && <img src={line.image} alt="" className="h-12 w-12 object-contain" />}
          <div className="flex-1"><p>{line.title}</p><p className="text-xs text-slate-500">{line.options}</p></div>
          <button disabled={lockCartEdits} aria-label={`Decrease quantity of ${line.title}`} onClick={() => void update('/cart/quantity', { lineId: line.id, quantity: line.quantity - 1 })} className="rounded border px-3 py-1 disabled:opacity-40">−</button>
          <span>Quantity: {line.quantity}</span>
          <button disabled={lockCartEdits || line.quantity >= 20} aria-label={`Increase quantity of ${line.title}`} onClick={() => void update('/cart/quantity', { lineId: line.id, quantity: line.quantity + 1 })} className="rounded border px-3 py-1 disabled:opacity-40">+</button>
          <button disabled={lockCartEdits} onClick={() => void update('/cart/quantity', { lineId: line.id, quantity: 0 })} className="underline disabled:opacity-40">Remove</button>
        </div>)}
        {!checkout && <>{state.cart.totals.map((total, i) => <p key={i} className="text-sm">{total.label}: {giftMoney(total.amount, state.cart!.currency)}</p>)}
          <p className="text-xs text-slate-500">Shipping and tax are confirmed at checkout. Each cart is for one store.</p>
          <button disabled={busy || !state.connected || !state.cart.lines.length || state.uncertainWrite} onClick={() => void update('/checkout')} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Review checkout</button>
        </>}
      </div>}
      {checkout && !checkout.orderConfirmed && !['ready_for_complete', 'complete_in_progress'].includes(checkout.status) && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950">Checkout needs attention. Review the merchant’s requirements below before continuing.</p>}
      <Notices messages={state.messages} />
      {checkout && <div className="rounded-xl border border-slate-200 p-4 space-y-3">
        <h3 className="font-semibold">{checkout.orderConfirmed ? (selfPurchase ? 'Your order is confirmed' : checkout.giftConfirmed ? 'Gift purchase confirmed' : 'Order placed — verify recipient') : selfPurchase ? 'Review your purchase' : 'Review your gift purchase'}</h3>
        <p className="text-sm">Recipient: <strong>{state.recipient}</strong>. You pay with your own Shop account.</p>
        <p className="text-xs text-slate-500">Delivery details may be visible in merchant checkout and order records.</p>
        {checkout.delivery.map(group => <label key={`${group.methodKey}-${group.groupKey}`} className="block text-sm">Delivery option<select disabled={busy || checkout.completionAttempted || hosted} value={group.selected || ''} onChange={e => void update('/delivery', { methodKey: group.methodKey, groupKey: group.groupKey, optionKey: e.target.value })} className="ml-2 rounded border p-2"><option value="" disabled>Choose delivery</option>{group.options.map(option => <option key={option.key} value={option.key}>{option.label}{option.amount !== undefined ? ` · ${giftMoney(option.amount, checkout.currency)}` : ''}</option>)}</select></label>)}
        {checkout.totals.map((total, i) => <p key={i} className="text-sm font-medium">{total.label}: {giftMoney(total.amount, checkout.currency)}</p>)}
        <div className="flex flex-wrap gap-3 text-xs">{checkout.links.map(link => <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="underline">{link.label}</a>)}</div>
        {!checkout.recipientVerified && !checkout.giftConfirmed && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{selfPurchase ? 'Review your delivery address on the merchant’s checkout page.' : 'We couldn’t verify that checkout kept the streamer’s saved address.'} Before paying on the merchant’s checkout page, check that the recipient and delivery address are correct.</p>}
        {checkout.status === 'ready_for_complete' && checkout.recipientVerified && !checkout.completionAttempted && !hosted && <>
          <label className="block text-sm">Payment method<select value={instrument} onChange={e => { setInstrument(e.target.value); setConfirmed(false); }} disabled={busy} className="ml-2 rounded border p-2"><option value="">Choose payment method</option>{checkout.instruments.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} />I confirm this store, the items and quantities, the displayed total, the recipient, and my chosen payment method.</label>
          <button disabled={busy || !state.connected || !instrument || !confirmed || state.uncertainWrite} onClick={() => void update('/complete', { confirm: true, reviewId: checkout.reviewId, instrumentKey: instrument })} className="rounded-xl bg-violet-700 px-4 py-3 font-semibold text-white disabled:opacity-40">{state.simulated ? 'Place simulated gift order' : selfPurchase ? 'Confirm and pay' : 'Confirm and pay for gift'}</button>
        </>}
        {!checkout.orderConfirmed && (checkout.completionAttempted || checkout.status === 'complete_in_progress') ? <p role="status" className="text-sm font-medium">Payment may be processing. Refresh status; do not submit another payment.</p> : hosted && !checkoutResolved ? <p role="status" className="text-sm font-medium">Merchant checkout was opened in another tab. Opening it does not mean you paid. Finish or cancel checkout there, then refresh its status here.</p> : null}
        {checkout.giftConfirmed && <p role="status" className="text-sm font-semibold text-emerald-800">{state.simulated ? 'Simulated gift alert sent. No charge was made.' : 'Your gift order is confirmed. The streamer has been notified.'}</p>}
        {checkout.continueUrl && !checkout.orderConfirmed && !checkout.completionAttempted && !state.uncertainWrite && <button disabled={busy} onClick={() => {
          const popup = window.open('about:blank', '_blank');
          void run(async () => {
            try { const result = await api<{url:string}>('/handoff', {}); setHandoffOpened(true); if (popup) { popup.opener = null; popup.location.href = result.url; } else window.location.assign(result.url); }
            catch (e) { popup?.close(); throw e; }
          });
        }} className="block text-sm font-semibold underline">{checkout.status === 'requires_escalation' ? 'Continue to merchant checkout' : 'Review and pay on merchant checkout instead'}</button>}
      </div>}
      {hosted && !checkoutResolved && <div className="space-y-2 text-xs text-slate-500"><p>Cart changes are locked while checkout is open on the merchant’s page. If you declined or canceled there, close that tab and return to your cart below.</p>
        {!checkout?.completionAttempted && checkout?.status !== 'complete_in_progress' && <button disabled={busy || state.uncertainWrite} onClick={() => void update('/return-from-merchant', { confirmClosed: true })} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-900 disabled:opacity-40">I declined—clear local cart</button>}
      </div>}
      {(state.cart || checkout || state.uncertainWrite) && <div className="flex flex-wrap gap-4 text-sm">
        <button disabled={busy} onClick={() => void update('/refresh')} className="rounded-lg border px-3 py-2 disabled:opacity-40">Refresh status</button>
        <button disabled={busy || state.uncertainWrite || Boolean(checkout?.completionAttempted && !checkoutResolved) || hosted && !checkoutResolved} onClick={() => void run(async () => { setState(await api<GiftView>('/clear', {})); setHandoffOpened(false); setAdded(''); })} className="underline disabled:opacity-40">{checkout?.orderConfirmed ? 'Start another purchase' : 'Clear cart'}</button>
      </div>}
      {state.uncertainWrite && <p role="alert" className="text-sm text-amber-900">The previous request has an uncertain outcome. Refresh status before trying anything else.</p>}
      </div>}
        <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-2" role={connecting || connection ? 'status' : undefined}>{(connecting || connection) && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin text-violet-700 motion-reduce:animate-none" />}{state.connected ? (state.simulated ? 'Demo buyer connected' : 'Shop connected') : connecting ? 'Connecting to Shop…' : connection ? 'Waiting for Shop sign-in…' : 'Shop isn’t connected. Connect Shop to use @shop.'}</span>
        {!state.connected && !connection && <button disabled={busy} onClick={() => void run(async () => {
          setConnecting(true);
          try {
            const result = await api<ShopConnection & {simulated?: boolean}>('/connect', {});
            if (result.simulated) setState(await api<GiftView>('/state')); else setConnection(result);
          } finally { if (mounted.current) setConnecting(false); }
        })} className="rounded-xl bg-slate-950 px-4 py-2 font-semibold text-white disabled:opacity-50">{connecting ? 'Connecting…' : state.simulated ? 'Connect demo buyer' : 'Connect Shop'}</button>}
        {(state.connected || connection) && <button disabled={busy} onClick={() => void run(async () => { const view = await api<GiftView>('/disconnect', {}); setConnection(null); setState(view); })} className="underline">{connection ? 'Cancel sign-in' : 'Disconnect'}</button>}
      </div>
      {connection && <div role="status" className="rounded-lg bg-violet-50 p-3 text-sm space-y-2">
        <a href={connection.url} target="_blank" rel="noreferrer" className="font-semibold underline">Sign in and approve on Shop</a>
        <p>Code: <strong>{connection.code}</strong>. Waiting for your approval…</p>
      </div>}
      {state.connected && (typeof chat === 'function' ? chat({ add: addProduct, busy: lockCart, pending: pendingPurchase, blockedReason, reviewCart }) : chat)}
      {state.notice && <p role="status" className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{state.notice}</p>}
      {state.connected && added && <p role="status" className="text-xs font-medium text-emerald-700">{added}</p>}
    </>}
    {busy && <p role="status" className="text-sm text-slate-500">Working with {state?.simulated ? 'local demo' : 'Shop'}…</p>}
  </section>;
}
