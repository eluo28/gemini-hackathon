import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createItemDetector, ItemDetectionError, parseItemFrames, type ItemFrame } from './itemDetection';
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
    return { text: JSON.stringify({ items: [{ ...item, timestampSec: 999, productId: 'invented', price: 1 }] }) };
  } });
  const result = await detect([frame]);
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
