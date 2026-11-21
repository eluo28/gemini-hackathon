import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createShopMcpClient, ShopMcpError } from './shopMcp';
import { createShopRouter } from './shopRoutes';

const success = (document: unknown) => Response.json({ jsonrpc: '2.0', result: { structuredContent: document } });

test('MCP transport uses the fixed endpoint and required protocol metadata; preserves product evidence', async () => {
  const document = { products: [{ id: 'gid://shopify/p/example', variants: [{ url: 'https://store.example/products/mug?variant=123&ref=shop', price: { amount: 2500, currency: 'CAD' } }] }], messages: [{ type: 'warning', content: 'Delivery unconfirmed' }], pagination: { cursor: 'opaque-cursor' } };
  const args = { catalog: { query: 'ceramic mug' } };
  let calls = 0;
  const client = createShopMcpClient(async (url, init) => {
    calls++;
    assert.equal(url, 'https://mcp.shop.com/');
    assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('MCP-Protocol-Version'), '2026-07-28');
    assert.equal(headers.get('Mcp-Method'), 'tools/call');
    assert.equal(headers.get('Mcp-Name'), 'search_catalog');
    assert.equal(headers.get('Authorization'), null);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.params.arguments, args);
    assert.equal(body.params.name, 'search_catalog');
    assert.equal(body.params._meta['io.modelcontextprotocol/clientInfo'].name, 'clipthat');
    return success(document);
  });
  assert.deepEqual(await client.call('search_catalog', args), document);
  assert.equal(calls, 1);
});

test('HTTP, JSON-RPC, tool, malformed response, network and timeout failures are sanitized and never retried', async () => {
  const cases: [() => Promise<Response>, string][] = [
    [async () => new Response('private upstream detail', { status: 401 }), 'shop_access_denied'],
    [async () => new Response('', { status: 403 }), 'shop_access_denied'],
    [async () => new Response('', { status: 429 }), 'shop_rate_limited'],
    [async () => new Response('', { status: 500 }), 'shop_unavailable'],
    [async () => Response.json({ error: { message: 'private detail' } }), 'shop_tool_error'],
    [async () => Response.json({ result: { isError: true, content: [{ text: 'private detail' }] } }), 'shop_tool_error'],
    [async () => new Response('not json'), 'shop_invalid_response'],
    [async () => success([]), 'shop_invalid_response'],
    [async () => Response.json({ result: { isError: true, content: [{ type: 'text', text: `Shopify Catalog: 'context.address_country' is not a recognized country code: \"AS\".` }] } }), 'shop_invalid_country'],
    [async () => { throw new Error('private network detail'); }, 'shop_unavailable'],
    [async () => { throw new DOMException('private timeout detail', 'TimeoutError'); }, 'shop_timeout'],
  ];
  for (const [response, code] of cases) {
    let calls = 0;
    const client = createShopMcpClient(async () => { calls++; return response(); });
    await assert.rejects(client.call('search_catalog', { catalog: { query: 'mug' } }), error => {
      assert.ok(error instanceof ShopMcpError);
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('catalog routes forward supported requests, reject invalid/private inputs before Shop, and disable caching', async t => {
  const calls: { tool: string; args: unknown }[] = [];
  const app = express(); app.use(express.json());
  app.use('/api/shop', createShopRouter({ async call(tool, args) { calls.push({ tool, args }); return { products: [], messages: [] }; } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/shop`;
  const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const valid = [
    ['/search', { catalog: { query: 'mug', context: { currency: 'USD', address_country: 'US' }, filters: { price: { max: 3000 } }, pagination: { limit: 3 } } }],
    ['/lookup', { catalog: { ids: ['https://store.example/products/mug?variant=123'] } }],
    ['/product', { catalog: { id: 'gid://shopify/p/1', selected: [{ name: 'Color', label: 'Blue' }] } }],
  ] as const;
  for (const [route, body] of valid) {
    const response = await post(route, body);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.deepEqual(calls.map(call => call.tool), ['search_catalog', 'lookup_catalog', 'get_product']);
  const invalid = [
    ['/search', { catalog: { query: '' } }],
    ['/search', { catalog: { query: 'mug', pagination: { limit: 51 } } }],
    ['/search', { catalog: { query: 'mug', filters: { price: { max: 10 } } } }],
    ['/search', { catalog: { query: 'mug', context: { currency: 'usd' } } }],
    ['/search', { catalog: { query: 'mug', endpoint: 'http://localhost' } }],
    ['/lookup', { catalog: { ids: ['https://store.example/checkouts/private'] } }],
    ['/lookup', { catalog: { ids: ['https://store.example/products/mug?token=secret'] } }],
    ['/lookup', { catalog: { ids: [] } }],
    ['/product', { catalog: { id: 'id', selected: [{ name: 'Size' }] } }],
  ] as const;
  for (const [route, body] of invalid) assert.equal((await post(route, body)).status, 400);
  assert.equal(calls.length, 3);
  assert.equal((await post('/complete-checkout', {})).status, 404);
});
