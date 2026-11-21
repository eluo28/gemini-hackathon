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
import { createShopMcpClient, type ShopMcpClient } from './shopMcp';

const recipient: Recipient = { profile: { id: 'creator-test', displayName: 'Test Creator', giftingEnabled: true }, shippingAddress: { recipient: 'Test Recipient', street: '123 Test Street', city: 'Test City', region: 'CA', postalCode: '90001', country: 'US' } };
function fixture() {
  const calls: { tool: string; args: Doc; options: unknown }[] = [];
  const marked = new Set<string>(); const alerts: unknown[] = [];
  let cart: Doc, checkout: Doc;
  const instrument = { id: 'offered-card', handler_id: 'shop_pay', type: 'shop_pay', display: { label: 'Test card' }, credential: { type: 'shop_token', token: 'private-test-credential' }, extension: { preserve: true } };
  let completeTimeout = false, dropRecipient = false, failCreate = false;
  const mcp: ShopMcpClient = { async call(tool, args, options) {
    const a = args as Doc; calls.push({ tool, args: a, options });
    if (tool === 'get_account') return {};
    if (tool === 'search_catalog' || tool === 'get_product') {
      const p = { id: 'product', title: 'Test mug', variants: [{ id: 'variant', url: 'https://merchant.example/products/mug?variant=1&ref=shop', options: [{ name: 'Color', label: 'Blue' }], availability: { available: true }, price: { amount: 2000, currency: 'USD' }, seller: { domain: 'merchant.example', name: 'Test merchant' } }] };
      return tool === 'search_catalog' ? { products: [p] } : { product: p };
    }
    if (tool === 'create_cart') {
      if (failCreate) throw new Error('network timeout');
      cart = { id: 'cart-secret', currency: 'USD', line_items: [{ id: 'line1', item: { id: 'variant', title: 'Test mug', options: [{ name: 'Color', label: 'Blue' }] }, quantity: 1 }], totals: [{ type: 'total', amount: 2000 }], unknownExtension: { keep: true }, next: ['response only'], signals: { private: true }, attribution: {} };
      return structuredClone(cart);
    }
    if (tool === 'get_cart') return structuredClone(cart);
    if (tool === 'update_cart') { cart = a.cart; return structuredClone(cart); }
    if (tool === 'create_checkout') {
      checkout = { id: 'checkout-secret', status: 'ready_for_complete', line_items: structuredClone(cart.line_items), currency: 'USD', totals: [{ type: 'total', display_text: 'Total', amount: 2500 }], fulfillment: structuredClone(a.checkout.fulfillment), payment: { instruments: [instrument] }, links: [{ type: 'terms', url: 'https://merchant.example/terms' }], messages: [], continue_url: 'https://merchant.example/checkouts/private-key' };
      checkout.fulfillment.methods[0].line_item_ids = ['line1'];
      if (dropRecipient) checkout.fulfillment.methods[0].destinations[0].street_address = 'Wrong Destination';
      return structuredClone(checkout);
    }
    if (tool === 'get_checkout') return structuredClone(checkout);
    if (tool === 'update_checkout') { checkout = a.checkout; return structuredClone(checkout); }
    if (tool === 'complete_checkout') {
      checkout.status = 'completed'; checkout.order = { id: 'real-observed-order' };
      if (completeTimeout) throw new Error('uncertain completion');
      return structuredClone(checkout);
    }
    throw new Error(`Unexpected tool ${tool}`);
  } };
  const service = createGiftingService({ mcp, recipient: () => structuredClone(recipient), ledger: { has: key => marked.has(key), mark: key => { marked.add(key); } }, confirmed: alert => alerts.push(alert) });
  const session: ViewerSession = { id: 'test', expiresAt: Date.now() + 100000, busy: false, token: 'private-test-token', tokenExpiresAt: Date.now() + 100000 };
  const add = () => service.add(session, 'room', 'product', 'variant', [{ name: 'Color', label: 'Blue' }]);
  return { service, session, calls, marked, alerts, instrument, add, checkout: () => checkout, setTimeout: () => { completeTimeout = true; }, dropRecipient: () => { dropRecipient = true; }, failCreate: () => { failCreate = true; } };
}

test('gift flow preserves cart state, uses server recipient, projects secrets out, and completes once with exact offered instrument', async () => {
  const f = fixture();
  await f.add();
  await f.service.quantity(f.session, 'line1', 2);
  const update = f.calls.find(call => call.tool === 'update_cart')!.args.cart;
  assert.deepEqual(update.unknownExtension, { keep: true });
  assert.equal(update.line_items[0].quantity, 2);
  for (const key of ['next', 'signals', 'attribution']) assert.equal(key in update, false);
  const view = await f.service.checkout(f.session);
  assert.equal(view.checkout!.recipientVerified, true);
  const serialized = JSON.stringify(view);
  for (const secret of ['123 Test Street', 'private-test-token', 'private-test-credential', 'checkout-secret']) assert.equal(serialized.includes(secret), false);
  const request = f.calls.find(call => call.tool === 'create_checkout')!;
  assert.equal(request.args.checkout.fulfillment.methods[0].destinations[0].street_address, '123 Test Street');
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
