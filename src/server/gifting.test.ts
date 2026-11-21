import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGiftingService, CompletionLedger, type Doc, type Recipient, type ViewerSession } from './gifting';
import { createGiftingRouter } from './giftingRoutes';
import { createShopOAuth } from './shopOAuth';
import { createShopMcpClient, ShopMcpError, type ShopMcpClient } from './shopMcp';

const recipient: Recipient = { profile: { id: 'creator-test', displayName: 'Test Creator', giftingEnabled: true }, shippingAddress: { recipient: 'Test Recipient', lastName: 'Tester', phone: '+12025550123', street: '123 Test Street', city: 'Test City', region: 'CA', postalCode: '90001', country: 'US' } };
function fixture(giftingEnabled = true) {
  let addresses: Doc[] = [];
  const calls: { tool: string; args: Doc; options: unknown }[] = [];
  const marked = new Set<string>(); const alerts: unknown[] = [];
  let cart: Doc, checkout: Doc;
  const instrument = { id: 'offered-card', handler_id: 'shop_pay', type: 'shop_pay', display: { label: 'Test card' }, credential: { type: 'shop_token', token: 'private-test-credential' }, extension: { preserve: true } };
  let completeTimeout = false, dropRecipient = false, failCreate = false, sparseCreate = false, rejectItem = false, failCheckoutRead = false, dropCreateContact = false;
  const mcp: ShopMcpClient = { async call(tool, args, options) {
    const a = args as Doc; calls.push({ tool, args: a, options });
    if (tool === 'get_account') return { addresses: structuredClone(addresses), preferred_address_id: addresses.at(-1)?.id };
    if (tool === 'search_catalog' || tool === 'get_product') {
      const p = { id: 'product', title: 'Test mug', variants: [{ id: 'variant', url: 'https://merchant.example/products/mug?variant=1&ref=shop', options: [{ name: 'Color', label: 'Blue' }], availability: { available: true }, price: { amount: 2000, currency: 'USD' }, seller: { domain: 'merchant.example', name: 'Test merchant' } }] };
      return tool === 'search_catalog' ? { products: [p] } : { product: p };
    }
    if (tool === 'create_cart') {
      if (failCreate) throw new Error('network timeout');
      cart = { id: 'cart-secret', currency: 'USD', line_items: [{ id: 'line1', item: { id: 'variant', title: 'Test mug', options: [{ name: 'Color', label: 'Blue' }] }, quantity: 1 }], totals: [{ type: 'total', amount: 2000 }], unknownExtension: { keep: true }, next: ['response only'], signals: { private: true }, attribution: {} };
      if (rejectItem) { cart.line_items = []; cart.messages = [{ content: 'This item cannot be added by the merchant.' }]; }
      return sparseCreate ? { ...structuredClone(cart), line_items: [] } : structuredClone(cart);
    }
    if (tool === 'get_cart') return structuredClone(cart);
    if (tool === 'update_cart') { cart = a.cart; return structuredClone(cart); }
    if (tool === 'create_checkout') {
      checkout = { id: 'checkout-secret', status: 'ready_for_complete', line_items: structuredClone(cart.line_items), currency: 'USD', totals: [{ type: 'total', display_text: 'Total', amount: 2500 }], fulfillment: structuredClone(a.checkout.fulfillment || { methods: [] }), buyer: structuredClone(a.checkout.buyer || {}), payment: { instruments: [instrument] }, links: [{ type: 'terms', url: 'https://merchant.example/terms' }], messages: [{ content: 'Delivery notice', severity: 'warning' }], continue_url: 'https://merchant.example/checkouts/private-key' };
      if (checkout.fulfillment.methods[0]) checkout.fulfillment.methods[0].line_item_ids = ['line1'];
      if (dropCreateContact) { delete checkout.buyer.email; checkout.messages = [{ code: 'buyer_identity_contact_method_required', content: 'Missing a valid contact method.' }]; }
      if (dropRecipient) checkout.fulfillment.methods[0].destinations[0].street_address = 'Wrong Destination';
      return structuredClone(checkout);
    }
    if (tool === 'get_checkout') { if (failCheckoutRead) throw new ShopMcpError('shop_tool_error', 502); return structuredClone(checkout); }
    if (tool === 'update_checkout') { checkout = a.checkout; if (dropCreateContact && checkout.buyer?.email) checkout.messages = []; return structuredClone(checkout); }
    if (tool === 'complete_checkout') {
      checkout.status = 'completed'; checkout.order = { id: 'real-observed-order' };
      if (completeTimeout) throw new Error('uncertain completion');
      return structuredClone(checkout);
    }
    throw new Error(`Unexpected tool ${tool}`);
  } };
  const service = createGiftingService({ mcp, recipient: () => giftingEnabled ? structuredClone(recipient) : null, ledger: { has: key => marked.has(key), mark: key => { marked.add(key); } }, confirmed: alert => alerts.push(alert) });
  const session: ViewerSession = { id: 'test', expiresAt: Date.now() + 100000, busy: false, token: 'private-test-token', tokenExpiresAt: Date.now() + 100000 };
  const add = () => service.add(session, 'room', 'product', 'variant', [{ name: 'Color', label: 'Blue' }]);
  return { dropCreateContact: () => { dropCreateContact = true; }, failCheckoutRead: () => { failCheckoutRead = true; }, sparseCreate: () => { sparseCreate = true; }, rejectItem: () => { rejectItem = true; }, setAddresses: (value: Doc[]) => { addresses = value; }, service, session, calls, marked, alerts, instrument, add, checkout: () => checkout, setTimeout: () => { completeTimeout = true; }, dropRecipient: () => { dropRecipient = true; }, failCreate: () => { failCreate = true; } };
}

test('gift flow preserves cart state, uses server recipient, projects secrets out, and completes once with exact offered instrument', async () => {
  const f = fixture();
  await f.add();
  assert.equal(f.calls.find(call => call.tool === 'get_product')!.args.catalog.id, 'variant');
  await f.service.quantity(f.session, 'line1', 2);
  const update = f.calls.find(call => call.tool === 'update_cart')!.args.cart;
  assert.deepEqual(update.unknownExtension, { keep: true });
  assert.equal(update.line_items[0].quantity, 2);
  for (const key of ['next', 'signals', 'attribution']) assert.equal(key in update, false);
  const view = await f.service.checkout(f.session);
  assert.equal(view.checkout!.recipientVerified, true);
  assert.equal(view.messages.length, 1);
  const serialized = JSON.stringify(view);
  for (const secret of ['123 Test Street', 'private-test-token', 'private-test-credential', 'checkout-secret']) assert.equal(serialized.includes(secret), false);
  const request = f.calls.find(call => call.tool === 'create_checkout')!;
  assert.equal(request.args.checkout.fulfillment.methods[0].destinations[0].street_address, '123 Test Street');
  assert.equal(request.args.checkout.fulfillment.methods[0].destinations[0].last_name, 'Tester');
  assert.equal(request.args.checkout.fulfillment.methods[0].destinations[0].phone_number, '+12025550123');
  const result = await f.service.complete(f.session, view.checkout!.reviewId!, view.checkout!.instruments[0].key);
  assert.equal(result.checkout!.giftConfirmed, true);
  assert.equal(f.alerts.length, 1);
  assert.deepEqual(f.calls.find(call => call.tool === 'complete_checkout')!.args.checkout.payment.instruments, [{ ...f.instrument, selected: true }]);
  await assert.rejects(f.service.complete(f.session, result.checkout!.reviewId!, result.checkout!.instruments[0].key), /already submitted/);
  assert.equal(f.calls.filter(call => call.tool === 'complete_checkout').length, 1);
  await f.service.refresh(f.session);
  assert.equal(f.alerts.length, 1);
});

test('changed total requires a fresh review and unverified recipient blocks payment', async () => {
  const f = fixture(); await f.add();
  const view = await f.service.checkout(f.session);
  f.checkout().totals[0].amount = 3000;
  await assert.rejects(f.service.complete(f.session, view.checkout!.reviewId!, view.checkout!.instruments[0].key), /Checkout changed/);
  assert.equal(f.calls.some(call => call.tool === 'complete_checkout'), false);
  const fresh = f.service.view(f.session);
  assert.equal(fresh.checkout!.totals[0].amount, 3000);
  assert.notEqual(fresh.checkout!.reviewId, view.checkout!.reviewId);
  const wrong = fixture(); wrong.dropRecipient(); await wrong.add();
  const bad = await wrong.service.checkout(wrong.session);
  assert.equal(bad.checkout!.recipientVerified, false);
  await assert.rejects(wrong.service.complete(wrong.session, bad.checkout!.reviewId!, bad.checkout!.instruments[0].key), /delivery address/);
  assert.equal(wrong.marked.size, 0);
});

test('uncertain completion reads status without paying twice; uncertain create cannot be replaced automatically', async () => {
  const f = fixture(); f.setTimeout(); await f.add();
  const view = await f.service.checkout(f.session);
  const result = await f.service.complete(f.session, view.checkout!.reviewId!, view.checkout!.instruments[0].key);
  assert.equal(result.checkout!.giftConfirmed, true);
  assert.equal(f.calls.filter(call => call.tool === 'complete_checkout').length, 1);
  assert.equal(f.calls.filter(call => call.tool === 'get_checkout').length, 2);
  const unknown = fixture(); unknown.failCreate();
  await assert.rejects(unknown.add());
  assert.equal(unknown.service.view(unknown.session).uncertainWrite, true);
  await assert.rejects(unknown.add(), /resolve/);
  assert.throws(() => unknown.service.clear(unknown.session), /unresolved/);
});

test('hosted checkout blocks parallel in-app payment and never announces an unverified gift', async () => {
  const f = fixture(); await f.add();
  const view = await f.service.checkout(f.session);
  const handoff = f.service.handoff(f.session);
  assert.equal(handoff.url, 'https://merchant.example/checkouts/private-key');
  await assert.rejects(f.service.complete(f.session, view.checkout!.reviewId!, view.checkout!.instruments[0].key), /opened on Shop/);
  assert.throws(() => f.service.clear(f.session), /unresolved/);
  f.checkout().status = 'completed'; f.checkout().order = { id: 'hosted-order' };
  f.checkout().fulfillment.methods[0].destinations[0].street_address = 'Different Recipient';
  const refreshed = await f.service.refresh(f.session);
  assert.equal(refreshed.checkout!.orderConfirmed, true);
  assert.equal(refreshed.checkout!.giftConfirmed, false);
  assert.equal(f.alerts.length, 0);
});

test('payment attempt ledger survives reconstruction without writing payment credentials', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clipthat-ledger-'));
  try {
    const file = path.join(directory, 'attempts.json');
    new CompletionLedger(file).mark('hashed-checkout-key');
    assert.equal(new CompletionLedger(file).has('hashed-checkout-key'), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), ['hashed-checkout-key']);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('OAuth device flow keeps codes/tokens private and returns pending without retrying terminal errors', async () => {
  const calls: { url: unknown; body: URLSearchParams }[] = [];
  let mode = 'device';
  const oauth = createShopOAuth(async (url, init) => {
    calls.push({ url, body: init?.body as URLSearchParams });
    if (mode === 'device') return Response.json({ device_code: 'private-device', user_code: 'USER-CODE', verification_uri: 'https://accounts.shop.app/activate', expires_in: 600, interval: 5 });
    if (mode === 'pending') return Response.json({ error: 'authorization_pending' }, { status: 400 });
    return Response.json({ error: 'access_denied' }, { status: 400 });
  });
  const start = await oauth.start();
  assert.equal(start.deviceCode, 'private-device');
  mode = 'pending'; assert.equal((await oauth.poll(start.deviceCode)).status, 'authorization_pending');
  mode = 'denied'; await assert.rejects(oauth.poll(start.deviceCode));
  assert.equal(calls.length, 3);
  assert.equal(calls[1].body.get('device_code'), 'private-device');
  assert.equal(calls[1].body.has('resource'), false);
});

test('MCP sends bearer credentials only in a fixed-endpoint header and keys mutations', async () => {
  const mcp = createShopMcpClient(async (url, init) => {
    assert.equal(url, 'https://mcp.shop.com/');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-secret');
    assert.equal(String(init?.body).includes('test-secret'), false);
    assert.equal(JSON.parse(String(init?.body)).params.arguments.meta['idempotency-key'], 'key');
    return Response.json({ result: { structuredContent: { id: 'cart' } } });
  });
  await mcp.call('create_cart', { shop: 'merchant.example', cart: { line_items: [] } }, { accessToken: 'test-secret', idempotencyKey: 'key' });
});

test('viewer sessions isolate carts; cookies are HttpOnly and unconfirmed purchase requests are rejected', async t => {
  const f = fixture();
  const app = express(); app.use(express.json()); app.use('/api/gifting', createGiftingRouter(f.service));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (route: string, body: unknown, cookie = '') => fetch(base + '/api/gifting' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie }, body: JSON.stringify(body) });
  const a = await request('/session', {}), b = await request('/session', {});
  const cookieA = a.headers.get('set-cookie')!.split(';')[0], cookieB = b.headers.get('set-cookie')!.split(';')[0];
  assert.match(a.headers.get('set-cookie')!, /HttpOnly/);
  assert.notEqual(cookieA, cookieB);
  assert.equal((await request('/cart/add', { roomId: 'room', productId: 'product', variantId: 'variant', selected: [{ name: 'Color', label: 'Blue' }] }, cookieA)).status, 200);
  const stateB = await fetch(base + '/api/gifting/state', { headers: { Cookie: cookieB } });
  assert.equal((await stateB.json()).cart, null);
  assert.equal((await request('/complete', { reviewId: 'forged', instrumentKey: 'forged' }, cookieA)).status, 400);
  assert.equal((await request('/cart/quantity', { lineId: 'line1', quantity: 2 })).status, 401);
  assert.equal((await fetch(base + '/api/gifting/complete', { method: 'POST', headers: { Origin: 'https://attacker.example', Cookie: cookieA, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});


test('self purchases count real cart quantities, preserve the preferred buyer address, and never announce a streamer gift', async () => {
  const f = fixture(false);
  const ownAddress = { id: 'own-address', type: 'shipping_address', first_name: 'Buyer', last_name: 'Person', street_address: '456 Buyer Street', address_locality: 'Buyer City', address_region: 'NY', postal_code: '10001', address_country: 'US', extension: { preserve: true } };
  f.setAddresses([{ ...ownAddress, id: 'other-address', street_address: 'Other street' }, ownAddress]);
  const view = await f.service.add(f.session, 'room', 'product', 'variant', [], 'self');
  assert.equal(view.mode, 'self');
  assert.equal(view.cart!.lines.reduce((sum, line) => sum + line.quantity, 0), 1);
  const increased = await f.service.quantity(f.session, 'line1', 2);
  assert.equal(increased.cart!.lines[0].quantity, 2);
  const checkout = await f.service.checkout(f.session);
  assert.equal(checkout.checkout!.recipientVerified, true);
  const destination = f.calls.find(call => call.tool === 'create_checkout')!.args.checkout.fulfillment.methods[0].destinations[0];
  assert.deepEqual(destination, ownAddress);
  assert.equal(JSON.stringify(checkout).includes('456 Buyer Street'), false);
  const paid = await f.service.complete(f.session, checkout.checkout!.reviewId!, checkout.checkout!.instruments[0].key);
  assert.equal(paid.checkout!.orderConfirmed, true);
  assert.equal(paid.checkout!.giftConfirmed, false);
  assert.equal(f.alerts.length, 0);
  const gift = fixture(); await gift.add();
  await assert.rejects(gift.service.add(gift.session, 'room', 'product', 'variant', [], 'self'), /switching/);
  assert.equal(gift.calls.filter(call => call.tool === 'create_cart').length, 1);
});

test('self checkout without a saved buyer address never substitutes the streamer address or enables in-app payment', async () => {
  const f = fixture();
  await f.service.add(f.session, 'room', 'product', 'variant', [], 'self');
  const checkout = await f.service.checkout(f.session);
  assert.equal(f.calls.find(call => call.tool === 'create_checkout')!.args.checkout.fulfillment, undefined);
  assert.equal(checkout.checkout!.recipientVerified, false);
  await assert.rejects(f.service.complete(f.session, checkout.checkout!.reviewId!, checkout.checkout!.instruments[0].key), /delivery address/);
  assert.equal(f.calls.some(call => call.tool === 'complete_checkout'), false);
});


test('cart removal before payment clears the old checkout review; merchant handoff and submitted payments keep edits locked', async () => {
  const f = fixture(); await f.add();
  const before = await f.service.checkout(f.session);
  const edited = await f.service.quantity(f.session, 'line1', 0);
  assert.equal(edited.cart!.lines.length, 0);
  assert.equal(edited.checkout, null);
  await assert.rejects(f.service.complete(f.session, before.checkout!.reviewId!, before.checkout!.instruments[0].key), /Review the latest/);
  assert.equal(f.calls.some(call => call.tool === 'complete_checkout'), false);
  const hosted = fixture(); await hosted.add(); await hosted.service.checkout(hosted.session); hosted.service.handoff(hosted.session);
  await assert.rejects(hosted.service.quantity(hosted.session, 'line1', 0), /processing/);
  assert.equal(hosted.calls.some(call => call.tool === 'update_cart'), false);
  const paid = fixture(); await paid.add(); const review = await paid.service.checkout(paid.session);
  await paid.service.complete(paid.session, review.checkout!.reviewId!, review.checkout!.instruments[0].key);
  await assert.rejects(paid.service.quantity(paid.session, 'line1', 0), /processing/);
});


test('add confirms the authoritative cart before reporting success and surfaces an unaccepted item', async () => {
  const f = fixture(); f.sparseCreate();
  const added = await f.add();
  assert.equal(added.cart!.lines[0].quantity, 1);
  assert.equal(f.calls.filter(call => call.tool === 'create_cart').length, 1);
  assert.equal(f.calls.filter(call => call.tool === 'get_cart').length, 1);
  const rejected = fixture(); rejected.rejectItem();
  await assert.rejects(rejected.add(), /did not confirm/);
  const view = rejected.service.view(rejected.session);
  assert.equal(view.cart!.lines.length, 0);
  assert.equal(view.uncertainWrite, false);
  assert.equal(view.messages[0].content, 'This item cannot be added by the merchant.');
  assert.equal(rejected.calls.filter(call => call.tool === 'create_cart').length, 1);
});


test('basket requests stay anonymous while account and checkout keep the buyer connection', async () => {
  const f = fixture();
  await f.add();
  await f.service.quantity(f.session, 'line1', 2);
  await f.service.refresh(f.session);
  for (const call of f.calls) assert.equal((call.options as {accessToken?: string}).accessToken, undefined);
  const checkout = await f.service.checkout(f.session);
  await f.service.complete(f.session, checkout.checkout!.reviewId!, checkout.checkout!.instruments[0].key);
  for (const call of f.calls.filter(call => call.tool.endsWith('_checkout'))) {
    assert.equal((call.options as {accessToken?: string}).accessToken, 'private-test-token');
  }
});


test('explicit declined merchant return refreshes status before unlocking cart and never permits a processing or completed purchase to restart', async () => {
  const f = fixture(); await f.add(); await f.service.checkout(f.session); f.service.handoff(f.session);
  const returned = await f.service.returnFromMerchant(f.session);
  assert.equal(returned.checkout, null);
  assert.equal(returned.cart, null);
  assert.equal(f.session.retiredCheckouts!.length, 1);
  assert.equal(f.calls.some(call => call.tool === 'complete_checkout'), false);
  assert.equal(f.service.clear(f.session).cart, null);
  for (const status of ['complete_in_progress', 'completed']) {
    const other = fixture(); await other.add(); await other.service.checkout(other.session); other.service.handoff(other.session);
    other.checkout().status = status;
    await assert.rejects(other.service.returnFromMerchant(other.session));
    assert.equal(other.service.view(other.session).checkout!.handoffOpened, true);
  }
});


test('explicit decline clears only the local cart when Shop status is unavailable and preserves the unverified checkout', async () => {
  const f = fixture(); await f.add(); await f.service.checkout(f.session); f.service.handoff(f.session);
  f.failCheckoutRead();
  const view = await f.service.returnFromMerchant(f.session);
  assert.equal(view.cart, null);
  assert.equal(view.checkout, null);
  assert.match(view.notice!, /could not verify/);
  assert.equal(f.session.retiredCheckouts![0].status, 'unverified');
  assert.equal(JSON.stringify(view).includes('checkout-secret'), false);
  assert.equal(f.calls.filter(call => call.tool === 'get_checkout').length, 1);
  assert.equal(f.calls.some(call => call.tool === 'complete_checkout'), false);
});


test('checkout supplies the configured contact email and keeps it out of the public view', async () => {
  const f = fixture(); await f.add();
  const view = await f.service.checkout(f.session);
  assert.equal(f.calls.find(call => call.tool === 'create_checkout')!.args.checkout.buyer.email, 'allenlu378@gmail.com');
  assert.equal(JSON.stringify(view).includes('allenlu378@gmail.com'), false);
  assert.equal(f.calls.some(call => call.tool === 'complete_checkout'), false);
});

test('checkout follows creation with a full update when the merchant drops the configured contact', async () => {
  const f = fixture(); await f.add(); f.dropCreateContact();
  const view = await f.service.checkout(f.session);
  assert.equal(f.checkout().buyer.email, 'allenlu378@gmail.com');
  assert.equal(view.messages.some(message => message.code === 'buyer_identity_contact_method_required'), false);
  assert.equal(f.calls.filter(call => call.tool === 'create_checkout').length, 1);
  assert.equal(f.calls.filter(call => call.tool === 'update_checkout').length, 1);
  assert.equal(f.calls.some(call => call.tool === 'complete_checkout'), false);
});
