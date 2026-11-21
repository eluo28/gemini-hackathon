import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createShopMcpClient, type ShopMcpClient, type ShopTool } from './shopMcp';
import { createShopOAuth, type ShopOAuth } from './shopOAuth';
import { getStreamer } from './streamerProfiles';
import type { GiftAlert, GiftMessage, GiftProduct, GiftView } from '../shared/gifting';

// Merchant documents are extensible UCP objects. Keep originals server-side and
// project explicit public views instead of passing credentials/addresses to UI.
export type Doc = Record<string, any>;
export class GiftError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const digest = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cloneForUpdate = (document: Doc) => {
  const copy = structuredClone(document);
  delete copy.next; delete copy.signals; delete copy.attribution;
  return copy;
};
const secureUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return;
  try { const u = new URL(value); if (u.protocol === 'https:' && !u.username && !u.password) return value; } catch { /* invalid URL */ }
};
function links(raw: unknown): { href: string; label: string }[] {
  return Array.isArray(raw) ? raw.flatMap(value => secureUrl(value?.href || value?.url) ? [{ href: (value.href || value.url) as string, label: String(value.title || value.label || value.type || 'View details') }] : []) : [];
}
export function messagesFrom(document: Doc): GiftMessage[] {
  return (Array.isArray(document.messages) ? document.messages : []).map((message: Doc) => ({
    content: String(message.content || message.message || message.code || 'Checkout notice'), severity: message.severity,
    code: message.code, links: links(message.links),
    images: (Array.isArray(message.images) ? message.images : []).flatMap((image: Doc) => secureUrl(image.url) ? [{ url: image.url, alt: String(image.alt || image.alt_text || 'Merchant disclosure') }] : []),
  }));
}
function moneyTotals(document: Doc) {
  return (Array.isArray(document.totals) ? document.totals : []).map((total: Doc) => ({ label: String(total.display_text || total.type || 'Total'), amount: Number(total.amount) }));
}
export function productsFrom(document: Doc): GiftProduct[] {
  const products = document.product ? [document.product] : document.products || [];
  return products.flatMap((product: Doc) => (product.variants || []).slice(0, 1).flatMap((variant: Doc) => {
    const url = secureUrl(variant.url);
    if (!url || !variant.seller?.domain || !Number.isSafeInteger(variant.price?.amount) || !/^[A-Z]{3}$/.test(variant.price?.currency || '')) return [];
    return [{ id: product.id, title: product.title, image: secureUrl(variant.media?.[0]?.url || product.media?.[0]?.url), url,
      shop: variant.seller.domain, seller: variant.seller.name || variant.seller.domain,
      variantId: variant.id, options: (product.options || []).map((option: Doc) => ({ name: option.name, values: (option.values || []).map((v: Doc) => v.label) })),
      selected: variant.options || product.selected || [], amount: variant.price.amount, currency: variant.price.currency, available: variant.availability?.available === true,
    }];
  }));
}
export interface Recipient { profile: { id: string; displayName: string; giftingEnabled: boolean }; shippingAddress: null | { recipient: string; lastName?: string; phone?: string; street: string; city: string; region: string; postalCode: string; country: string } }
interface GiftFlow {
  roomId: string; recipient: Recipient; recipientDigest: string; shop: string; cart?: Doc; checkout?: Doc;
  uncertainWrite: boolean; review?: { id: string; fingerprint: string; instrumentKeys: string[] }; completionAttempted: boolean;
  handoffOpened?: boolean; verifiedBeforePayment?: boolean; announced?: boolean;
}
export interface ViewerSession {
  id: string; expiresAt: number; busy: boolean;
  token?: string; tokenExpiresAt?: number;
  connection?: { deviceCode: string; url: string; code: string; interval: number; expiresAt: number; nextPoll: number };
  flow?: GiftFlow;
}
export class CompletionLedger {
  private attempts: Set<string>;
  constructor(private file = path.resolve(process.env.PROFILE_DATA_DIR || '.data', 'gift-payment-attempts.json')) {
    this.attempts = new Set(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);
  }
  has(key: string) { return this.attempts.has(key); }
  mark(key: string) {
    const entries = new Set(this.attempts); entries.add(key);
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify([...entries]), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
    this.attempts = entries;
  }
}
const normalize = (s: unknown) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
export function recipientMatches(checkout: Doc, recipient: Recipient): boolean {
  const address = recipient.shippingAddress;
  if (!address) return false;
  const methods = checkout.fulfillment?.methods || [];
  const shipping = methods.filter((method: Doc) => method.type === 'shipping');
  if (!shipping.length || methods.some((method: Doc) => method.type !== 'shipping')) return false;
  const covered = new Set(shipping.flatMap((method: Doc) => method.line_item_ids || []));
  if (!(checkout.line_items || []).length || checkout.line_items.some((line: Doc) => !covered.has(line.id))) return false;
  return shipping.every((method: Doc) => {
    const destination = method.destinations?.find((dest: Doc) => dest.id === method.selected_destination_id);
    return destination && normalize(destination.street_address) === normalize(address.street)
      && normalize(destination.address_locality) === normalize(address.city)
      && normalize(destination.address_region) === normalize(address.region)
      && normalize(destination.postal_code) === normalize(address.postalCode)
      && normalize(destination.address_country) === normalize(address.country)
      && normalize([destination.first_name, destination.last_name].filter(Boolean).join(' ')) === normalize([address.recipient, address.lastName].filter(Boolean).join(' '));
  });
}
const fingerprint = (checkout: Doc) => digest({ line_items: checkout.line_items, totals: checkout.totals, currency: checkout.currency, payment: checkout.payment ? { ...checkout.payment, instruments: (checkout.payment.instruments || []).map((instrument: Doc) => { const { credential: _credential, ...identity } = instrument; return identity; }) } : undefined, fulfillment: checkout.fulfillment, messages: checkout.messages, links: checkout.links, status: checkout.status });
export function createGiftingService(options: {
  mcp?: ShopMcpClient; oauth?: ShopOAuth; recipient?: (roomId: string) => Recipient | null;
  simulated?: boolean;
  ledger?: Pick<CompletionLedger, 'has' | 'mark'>; confirmed?: (alert: GiftAlert) => void;
} = {}) {
  const mcp = options.mcp || createShopMcpClient();
  const oauth = options.oauth || createShopOAuth();
  const getRecipient = options.recipient || getStreamer;
  const ledger = options.ledger || new CompletionLedger();
  function recipient(roomId: string) {
    const value = getRecipient(roomId);
    if (!value?.profile.giftingEnabled || !value.shippingAddress) throw new GiftError('The streamer has not enabled gift delivery.', 409);
    return value;
  }
  function flow(session: ViewerSession) {
    if (!session.flow) throw new GiftError('Your gift cart is empty.', 409);
    const current = recipient(session.flow.roomId);
    if (digest(current.shippingAddress) !== session.flow.recipientDigest || current.profile.id !== session.flow.recipient.profile.id) throw new GiftError('The streamer changed their delivery details. Clear this cart and choose your gift again.', 409);
    return session.flow;
  }
  function token(session: ViewerSession, required = false) {
    if (session.token && Number(session.tokenExpiresAt) <= Date.now()) { delete session.token; delete session.tokenExpiresAt; }
    if (required && !session.token) throw new GiftError('Connect Shop before preparing payment.', 401);
    return session.token;
  }
  async function call(session: ViewerSession, tool: ShopTool, args: Doc, key?: string): Promise<Doc> {
    try {
      const result = await mcp.call(tool, args, { accessToken: token(session), idempotencyKey: key });
      if (tool !== 'get_account' && !['search_catalog', 'lookup_catalog', 'get_product'].includes(tool) && (typeof result.id !== 'string' || !result.id)) throw new GiftError('Shop returned an incomplete cart or checkout. Refresh its status.', 502);
      return result;
    }
    catch (error) {
      if ((error as {code?: string}).code === 'shop_access_denied') { delete session.token; delete session.tokenExpiresAt; }
      throw error;
    }
  }
  function review(f: GiftFlow) {
    const c = f.checkout;
    f.review = c ? { id: crypto.randomUUID(), fingerprint: fingerprint(c), instrumentKeys: (c.payment?.instruments || []).map(() => crypto.randomUUID()) } : undefined;
  }
  function observe(f: GiftFlow) {
    const c = f.checkout;
    if (c?.status === 'completed' && typeof c.order?.id === 'string' && c.order.id && (c.fulfillment ? recipientMatches(c, f.recipient) : f.verifiedBeforePayment) && !f.announced) {
      f.announced = true;
      options.confirmed?.({ simulated: Boolean(options.simulated), id: crypto.randomUUID(), roomId: f.roomId, recipient: f.recipient.profile.displayName, createdAt: Date.now() });
    }
  }
  const service = {
    view(session: ViewerSession): GiftView {
      const f = session.flow, checkout = f?.checkout, cart = checkout || f?.cart;
      return { simulated: Boolean(options.simulated), connected: Boolean(token(session)), recipient: f?.recipient.profile.displayName || '', uncertainWrite: Boolean(f?.uncertainWrite),
        cart: cart ? { shop: f!.shop, currency: cart.currency, totals: moneyTotals(cart), continueUrl: secureUrl(cart.continue_url), lines: (cart.line_items || []).map((line: Doc) => ({ id: line.id, title: String(line.item?.title || line.item?.id || 'Gift'), quantity: line.quantity, options: (line.item?.options || []).map((v: Doc) => `${v.name}: ${v.label}`).join(', '), image: secureUrl(line.item?.image?.url || line.item?.image || line.item?.media?.[0]?.url) })) } : null,
        checkout: checkout && f ? { status: checkout.status, handoffOpened: Boolean(f.handoffOpened), recipientVerified: recipientMatches(checkout, f.recipient), currency: checkout.currency, totals: moneyTotals(checkout), continueUrl: secureUrl(checkout.continue_url), links: links(checkout.links), completionAttempted: f.completionAttempted, orderConfirmed: checkout.status === 'completed' && typeof checkout.order?.id === 'string' && Boolean(checkout.order.id), giftConfirmed: Boolean(f.announced), reviewId: f.review?.id,
          instruments: (checkout.payment?.instruments || []).map((instrument: Doc, index: number) => ({ key: f.review?.instrumentKeys[index] || '', label: String(instrument.display?.label || instrument.display?.name || instrument.display?.description || [instrument.display?.brand, instrument.display?.last_digits].filter(Boolean).join(' ') || `Payment method ${index + 1} (${instrument.type})`) })),
          delivery: (checkout.fulfillment?.methods || []).flatMap((method: Doc, mi: number) => (method.groups || []).map((group: Doc, gi: number) => ({ methodKey: String(mi), groupKey: String(gi), selected: group.selected_option_id || null, options: (group.options || []).map((option: Doc) => ({ key: option.id, label: String(option.title || option.display_text || option.name || option.id), amount: option.totals?.find((total: Doc) => total.type === 'total')?.amount ?? option.amount })) }))),
        } : null,
        messages: checkout ? messagesFrom(checkout) : cart ? messagesFrom(cart) : [],
      };
    },
    async connect(session: ViewerSession) {
      if (options.simulated) { session.token = 'local-demo'; session.tokenExpiresAt = Date.now() + 3600_000; return { simulated: true as const }; }
      if (session.connection && session.connection.expiresAt > Date.now()) throw new GiftError('Finish or cancel your current Shop connection first.', 409);
      const connection = await oauth.start();
      session.connection = { ...connection, nextPoll: Date.now() + connection.interval * 1000 };
      return { url: connection.url, code: connection.code, interval: connection.interval, expiresAt: connection.expiresAt };
    },
    async poll(session: ViewerSession) {
      const connection = session.connection;
      if (!connection || Date.now() >= connection.expiresAt) { delete session.connection; throw new GiftError('Shop connection expired. Connect again when ready.', 410); }
      if (Date.now() < connection.nextPoll) return { status: 'pending', interval: connection.interval };
      connection.nextPoll = Date.now() + connection.interval * 1000;
      try {
        const result = await oauth.poll(connection.deviceCode);
        if (result.status === 'slow_down') { connection.interval += 5; connection.nextPoll = Date.now() + connection.interval * 1000; }
        if (result.status !== 'connected') return { status: 'pending', interval: connection.interval };
        session.token = result.token; session.tokenExpiresAt = result.expiresAt; delete session.connection;
        await call(session, 'get_account', {});
        return { status: 'connected', interval: 0 };
      } catch (error) { delete session.connection; delete session.token; delete session.tokenExpiresAt; throw error; }
    },
    async search(session: ViewerSession, roomId: string, query: string) {
      const r = recipient(roomId);
      const document = await call(session, 'search_catalog', { catalog: { query, context: { address_country: r.shippingAddress!.country }, pagination: { limit: 6 } } });
      return { products: productsFrom(document), messages: messagesFrom(document) };
    },
    async product(session: ViewerSession, roomId: string, productId: string, selected: {name: string; label: string}[]) {
      const r = recipient(roomId);
      const document = await call(session, 'get_product', { catalog: { id: productId, selected, context: { address_country: r.shippingAddress!.country } } });
      return { products: productsFrom(document), messages: messagesFrom(document) };
    },
    async add(session: ViewerSession, roomId: string, productId: string, variantId: string, selected: {name: string; label: string}[]) {
      const r = recipient(roomId);
      if (session.flow && session.flow.roomId !== roomId) throw new GiftError('Clear your current gift cart before gifting another streamer.', 409);
      if (session.flow?.checkout || session.flow?.uncertainWrite) throw new GiftError('Finish or resolve the current checkout before adding another gift.', 409);
      const result = await service.product(session, roomId, productId, selected);
      const product = result.products.find(p => p.variantId === variantId);
      if (!product?.available || selected.some(v => !product.selected.some(option => option.name === v.name && option.label === v.label))) throw new GiftError('That exact product option is unavailable. Choose an available size/color.', 409);
      if (!session.flow) session.flow = { roomId, recipient: structuredClone(r), recipientDigest: digest(r.shippingAddress), shop: product.shop, uncertainWrite: false, completionAttempted: false };
      const f = flow(session);
      if (f.shop !== product.shop) throw new GiftError('Each gift cart belongs to one store. Finish or clear this cart before choosing another store.', 409);
      try {
        if (!f.cart) {
          f.cart = await call(session, 'create_cart', { shop: f.shop, cart: { line_items: [{ item: { id: product.variantId }, quantity: 1 }], context: { address_country: r.shippingAddress!.country } } }, crypto.randomUUID());
        } else {
          const current = await call(session, 'get_cart', { shop: f.shop, id: f.cart.id });
          const update = cloneForUpdate(current);
          const line = update.line_items?.find((v: Doc) => v.item?.id === product.variantId);
          if (line && line.quantity >= 20) throw new GiftError('Maximum gift quantity is 20.');
          if (line) line.quantity++; else update.line_items.push({ item: { id: product.variantId }, quantity: 1 });
          f.cart = await call(session, 'update_cart', { shop: f.shop, id: current.id, cart: update }, crypto.randomUUID());
        }
      } catch (error) { f.uncertainWrite = true; throw error; }
      return service.view(session);
    },
    async quantity(session: ViewerSession, lineId: string, quantity: number) {
      const f = flow(session);
      if (!f.cart || f.checkout || f.uncertainWrite) throw new GiftError('This cart cannot be changed right now.', 409);
      const current = await call(session, 'get_cart', { shop: f.shop, id: f.cart.id });
      const update = cloneForUpdate(current);
      const line = update.line_items.find((line: Doc) => line.id === lineId);
      if (!line) throw new GiftError('Cart changed. Refresh before editing.', 409);
      if (quantity === 0) update.line_items = update.line_items.filter((line: Doc) => line.id !== lineId); else line.quantity = quantity;
      try { f.cart = await call(session, 'update_cart', { shop: f.shop, id: current.id, cart: update }, crypto.randomUUID()); }
      catch (error) { f.uncertainWrite = true; throw error; }
      return service.view(session);
    },
    async checkout(session: ViewerSession) {
      token(session, true);
      const f = flow(session);
      if (f.checkout || f.uncertainWrite || !f.cart?.line_items?.length) throw new GiftError('Refresh your existing checkout or add a gift first.', 409);
      const address = f.recipient.shippingAddress!;
      const destination = { id: `${f.recipient.profile.id}_delivery`, type: 'shipping_address', first_name: address.recipient, ...(address.lastName ? { last_name: address.lastName } : {}), ...(address.phone ? { phone_number: address.phone } : {}), street_address: address.street, address_locality: address.city, address_region: address.region, postal_code: address.postalCode, address_country: address.country };
      try {
        f.checkout = await call(session, 'create_checkout', { shop: f.shop, checkout: { cart_id: f.cart.id, line_items: [], fulfillment: { methods: [{ type: 'shipping', destinations: [destination], selected_destination_id: destination.id }] } } }, crypto.randomUUID());
        // Some merchants require assigning delivery after checkout line IDs exist.
        if (!recipientMatches(f.checkout, f.recipient) && f.checkout.status === 'incomplete') {
          const update = cloneForUpdate(f.checkout);
          const shipping = update.fulfillment?.methods?.filter((method: Doc) => method.type === 'shipping') || [];
          if (shipping.length) {
            for (const method of shipping) { method.destinations = [destination]; method.selected_destination_id = destination.id; }
            f.checkout = await call(session, 'update_checkout', { shop: f.shop, id: f.checkout.id, checkout: update }, crypto.randomUUID());
          }
        }
      } catch (error) { f.uncertainWrite = true; throw error; }
      review(f); observe(f);
      return service.view(session);
    },
    async delivery(session: ViewerSession, methodKey: string, groupKey: string, optionKey: string) {
      const f = flow(session);
      if (!f.checkout || f.completionAttempted || f.uncertainWrite) throw new GiftError('This checkout cannot be changed.', 409);
      const current = await call(session, 'get_checkout', { shop: f.shop, id: f.checkout.id });
      const update = cloneForUpdate(current);
      const group = update.fulfillment?.methods?.[Number(methodKey)]?.groups?.[Number(groupKey)];
      if (!group?.options?.some((option: Doc) => option.id === optionKey)) throw new GiftError('Choose an offered delivery option.');
      group.selected_option_id = optionKey;
      try { f.checkout = await call(session, 'update_checkout', { shop: f.shop, id: current.id, checkout: update }, crypto.randomUUID()); }
      catch (error) { f.uncertainWrite = true; throw error; }
      review(f); return service.view(session);
    },
    async refresh(session: ViewerSession) {
      const f = flow(session);
      if (f.checkout) { f.checkout = await call(session, 'get_checkout', { shop: f.shop, id: f.checkout.id }); review(f); observe(f); }
      else if (f.cart) f.cart = await call(session, 'get_cart', { shop: f.shop, id: f.cart.id });
      else throw new GiftError('The previous create request has an unknown outcome. Do not create a replacement purchase automatically.', 409);
      f.uncertainWrite = false;
      return service.view(session);
    },
    async complete(session: ViewerSession, reviewId: string, instrumentKey: string) {
      token(session, true);
      const f = flow(session);
      if (!f.checkout || !f.review || f.review.id !== reviewId || f.uncertainWrite) throw new GiftError('Review the latest checkout before confirming.', 409);
      const checkoutId = f.checkout.id;
      const attemptKey = digest([f.shop, checkoutId]);
      if (f.handoffOpened) throw new GiftError('Checkout was opened on Shop. Finish there and refresh its status here.', 409);
      if (f.completionAttempted || ledger.has(attemptKey)) throw new GiftError('Payment was already submitted. Refresh its status; do not pay again.', 409);
      const index = f.review.instrumentKeys.indexOf(instrumentKey);
      if (index < 0) throw new GiftError('Choose an offered payment method.');
      const current = await call(session, 'get_checkout', { shop: f.shop, id: checkoutId });
      if (fingerprint(current) !== f.review.fingerprint) {
        f.checkout = current; review(f); observe(f);
        throw new GiftError('Checkout changed. Review the current total and confirm again.', 409);
      }
      if (current.status !== 'ready_for_complete' || !recipientMatches(current, f.recipient)) throw new GiftError('Shop must confirm the streamer delivery address and checkout readiness before payment.', 409);
      if (!/^[A-Z]{3}$/.test(current.currency || '') || !Array.isArray(current.totals)
        || !current.totals.some((total: Doc) => total.type === 'total' && Number.isSafeInteger(total.amount) && total.amount >= 0)
        || current.totals.some((total: Doc) => !Number.isSafeInteger(total.amount))) throw new GiftError('Shop has not returned a valid final price. Finish checkout on Shop.', 409);
      const instrument = current.payment?.instruments?.[index];
      if (!instrument) throw new GiftError('The selected payment method is no longer offered.', 409);
      ledger.mark(attemptKey); f.completionAttempted = true; f.verifiedBeforePayment = true;
      try {
        f.checkout = await call(session, 'complete_checkout', { shop: f.shop, id: checkoutId, checkout: { payment: { instruments: [{ ...structuredClone(instrument), selected: true }] } } }, crypto.randomUUID());
      } catch {
        // Completion is never repeated, even after a timeout or restart.
        try { f.checkout = await call(session, 'get_checkout', { shop: f.shop, id: checkoutId }); }
        catch { f.uncertainWrite = true; }
      }
      review(f); observe(f);
      return service.view(session);
    },
    handoff(session: ViewerSession) {
      const f = flow(session);
      if (!f.checkout || f.completionAttempted) throw new GiftError('Refresh the payment status instead of submitting it again.', 409);
      const url = secureUrl(f.checkout.continue_url);
      if (!url) throw new GiftError('Shop did not return a checkout link.', 409);
      f.handoffOpened = true;
      return { url };
    },
    clear(session: ViewerSession) {
      if (session.flow?.uncertainWrite || ((session.flow?.completionAttempted || session.flow?.handoffOpened) && !['completed', 'canceled'].includes(session.flow.checkout?.status))) throw new GiftError('Payment outcome is unresolved. Refresh its status before starting another gift.', 409);
      delete session.flow;
      return service.view(session);
    },
  };
  return service;
}
export type GiftingService = ReturnType<typeof createGiftingService>;
