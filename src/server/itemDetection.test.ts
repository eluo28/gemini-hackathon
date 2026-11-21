import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createItemDetector, ItemDetectionError, parseItemFrames, type ItemFrame } from './itemDetection';
import { createStreamMatchRouter } from './streamMatchRoutes';
import { createItemDetectionRouter } from './itemDetectionRoutes';

const frame: ItemFrame = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5uoAAAAASUVORK5CYII=', timestampSec: 12.5 };
const item = { frameIndex: 0, name: 'Mug', description: 'A blue ceramic mug', brand: null, model: null, evidence: 'Visible handle and blue glaze; no readable brand', searchQuery: 'blue ceramic mug', box: [100, 200, 500, 700] };

test('frame input rejects URLs, MIME mismatches, oversized payloads, invalid timestamps and unbounded batches', () => {
  assert.deepEqual(parseItemFrames({ frames: [frame] }), [frame]);
  for (const frames of [[], [frame, frame, frame, frame], [{ ...frame, data: 'https://private.example/frame' }], [{ ...frame, mimeType: 'image/jpeg' }], [{ ...frame, data: 'a'.repeat(500004) }], [{ ...frame, timestampSec: -1 }]]) {
    assert.throws(() => parseItemFrames({ frames }), ItemDetectionError);
  }
});

test('Gemini request contains image bytes and schema; response uses caller timestamp and stays a similar-item discovery', async () => {
  let calls = 0;
  const detect = createItemDetector({ model: 'gemini-4-hydrogen', generate: async request => {
    calls++;
    assert.equal(request.model, 'gemini-4-hydrogen');
    assert.equal(request.config?.responseMimeType, 'application/json');
    assert.ok(request.config?.responseJsonSchema);
    assert.match(String(request.config?.systemInstruction), /untrusted scene data/);
    assert.match(JSON.stringify(request.contents), /inlineData/);
    assert.match(JSON.stringify(request.contents), /mug in the background/);
    return { text: JSON.stringify({ items: [{ ...item, timestampSec: 999, productId: 'invented', price: 1 }] }) };
  } });
  const result = await detect([frame], 'What is that mug in the background?');
  assert.equal(calls, 1);
  assert.equal(result.items[0].timestampSec, 12.5);
  assert.equal(result.items[0].matchType, 'similar');
  assert.equal('productId' in result.items[0], false);
  assert.equal('price' in result.items[0], false);
  assert.equal(result.items[0].brand, null);
});

test('empty scenes succeed, invalid model output fails, and upstream errors are sanitized without retries', async () => {
  assert.deepEqual((await createItemDetector({ generate: async () => ({ text: '{"items":[]}' }) })([frame])).items, []);
  for (const value of ['not json', JSON.stringify({ items: [{ ...item, frameIndex: 3 }] }), JSON.stringify({ items: [{ ...item, box: [500, 0, 100, 300] }] }), JSON.stringify({ items: [{ ...item, searchQuery: '' }] })]) {
    await assert.rejects(createItemDetector({ generate: async () => ({ text: value }) })([frame]), { code: 'gemini_invalid_response' });
  }
  let calls = 0;
  await assert.rejects(createItemDetector({ generate: async () => { calls++; throw Object.assign(new Error('private key detail'), { status: 429 }); } })([frame]), error => {
    assert.ok(error instanceof ItemDetectionError);
    assert.equal(error.code, 'gemini_rate_limited');
    assert.doesNotMatch(error.message, /private key/);
    return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(createItemDetector({ apiKey: '' })([frame]), { code: 'gemini_not_configured', status: 503 });
});

test('detection endpoint validates before inference, returns no-store data, and limits paid calls', async t => {
  let calls = 0;
  const app = express();
  app.use('/api/shop', createItemDetectionRouter(async () => { calls++; return { items: [], model: 'test-model' }; }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/shop/detect-items`;
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ frames: [] })).status, 400);
  assert.equal(calls, 0);
  for (let index = 0; index < 5; index++) {
    const response = await post({ frames: [frame] });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const limited = await post({ frames: [frame] });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal(calls, 5);
});


test('on-demand stream question selects objects before a cropped-image Shop lookup', async t => {
  let analyses = 0, searches = 0;
  const app = express();
  app.use('/api/shop', createItemDetectionRouter(async (frames, question) => {
    analyses++;
    assert.equal(question, 'What is that mug in the background?');
    assert.equal(frames.length, 1);
    return { items: [{ ...item, matchType: 'similar' }], model: 'gemini-4-hydrogen' };
  }));
  app.use('/api/shop', createStreamMatchRouter({ async call(tool, args) {
    searches++;
    assert.equal(tool, 'search_catalog');
    assert.deepEqual(args.catalog, { query: item.searchQuery, like: [{ image: { content_type: frame.mimeType, data: frame.data } }], pagination: { limit: 3 } });
    return { products: [], messages: [{ content: 'No matching products', type: 'info' }] };
  } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(base + '/api/shop/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
  assert.equal(analyses, 0); assert.equal(searches, 0);
  assert.equal((await post('ask-stream', { frames: [frame], question: '' })).status, 400);
  assert.equal(analyses, 0);
  const answer = await post('ask-stream', { frames: [frame], question: 'What is that mug in the background?' });
  assert.equal(answer.status, 200);
  assert.equal((await answer.json()).items[0].searchQuery, item.searchQuery);
  assert.equal(analyses, 1); assert.equal(searches, 0);
  const matches = await post('match-stream-item', { query: item.searchQuery, image: frame });
  assert.equal(matches.status, 200); assert.equal(matches.headers.get('cache-control'), 'no-store');
  assert.equal((await matches.json()).messages[0].content, 'No matching products');
  assert.equal(analyses, 1); assert.equal(searches, 1);
});


test('clip questions retain the chosen frame index and timestamp for matching the same sampled frame', async t => {
  const app = express();
  app.use('/api/shop', createItemDetectionRouter(async (frames, question) => {
    assert.equal(question, 'find me that mug');
    assert.deepEqual(frames.map(frame => frame.timestampSec), [2, 10, 18]);
    return { items: [{ ...item, frameIndex: 2, timestampSec: frames[2].timestampSec, matchType: 'similar' }], model: 'gemini-4-hydrogen' };
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await fetch(base + '/api/shop/ask-stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ question: 'find me that mug', frames: [2, 10, 18].map(timestampSec => ({ ...frame, timestampSec })) }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.items[0].frameIndex, 2);
  assert.equal(result.items[0].timestampSec, 18);
});
