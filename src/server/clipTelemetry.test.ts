import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { clipEvent, clipRequestTrace, clipSpan, withClipTrace } from './clipTelemetry';

test('telemetry correlates concurrent work, preserves errors, redacts secrets, and reports HTTP failures', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clip-telemetry-'));
  const file = path.join(dir, 'events.jsonl');
  const previous = { enabled: process.env.CLIP_TELEMETRY, file: process.env.CLIP_TELEMETRY_FILE, key: process.env.GEMINI_API_KEY };
  process.env.CLIP_TELEMETRY = '1';
  process.env.CLIP_TELEMETRY_FILE = file;
  process.env.GEMINI_API_KEY = 'secret-test-key';
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.after(async () => {
    for (const [key, value] of Object.entries({ CLIP_TELEMETRY: previous.enabled, CLIP_TELEMETRY_FILE: previous.file, GEMINI_API_KEY: previous.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });
  await Promise.all(['trace-one', 'trace-two'].map(traceId => withClipTrace({ traceId }, () => clipSpan('analysis', {}, async () => {
    await new Promise(resolve => setTimeout(resolve, traceId === 'trace-one' ? 10 : 1));
    await clipSpan('model', {}, async () => clipEvent('test.marker', { expectedTrace: traceId }));
  }))));
  const failure = Object.assign(new Error('Provider rejected secret-test-key https://example.test?key=hidden-key'), { status: 429, stderr: 'FFmpeg detail' });
  await assert.rejects(clipSpan('failure', {}, async () => { throw failure; }), error => error === failure);

  const app = express();
  app.use(clipRequestTrace);
  app.get('/test', async (_req, res) => {
    await clipSpan('route', {}, async () => clipEvent('route.marker'));
    res.status(422).json({ error: 'test failure' });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/test`, { headers: { 'X-Request-ID': 'browser-trace' } });
  assert.equal(response.headers.get('X-Request-ID'), 'browser-trace');
  await response.json();
  const raw = await readFile(file, 'utf8');
  const events = raw.trim().split('\n').map(line => JSON.parse(line));
  for (const marker of events.filter(e => e.event === 'test.marker')) assert.equal(marker.traceId, marker.expectedTrace);
  for (const event of events.filter(e => e.event === 'stage.started' && e.stage === 'model')) {
    assert.ok(events.some(parent => parent.spanId === event.parentSpanId && parent.traceId === event.traceId && parent.stage === 'analysis'));
  }
  const failed = events.find(e => e.event === 'stage.failed');
  assert.equal(failed.error.status, 429);
  assert.equal(failed.error.stderr, 'FFmpeg detail');
  assert.ok(failed.elapsedMs >= 0);
  assert.ok(!raw.includes('secret-test-key'));
  assert.ok(!raw.includes('hidden-key'));
  assert.ok(events.some(e => e.event === 'request.completed' && e.traceId === 'browser-trace' && e.status === 422));
  assert.ok(events.some(e => e.event === 'route.marker' && e.traceId === 'browser-trace'));

  // A broken log destination must not change pipeline behavior.
  process.env.CLIP_TELEMETRY_FILE = dir;
  assert.equal(await clipSpan('unwritable', {}, async () => 42), 42);
  process.env.CLIP_TELEMETRY = '0';
  process.env.CLIP_TELEMETRY_FILE = file;
  clipEvent('disabled');
  assert.equal(await readFile(file, 'utf8'), raw);
});

test('long stages emit heartbeats and stop them when work settles', async t => {
  const previous = process.env.CLIP_TELEMETRY;
  const previousFile = process.env.CLIP_TELEMETRY_FILE;
  const dir = await mkdtemp(path.join(tmpdir(), 'clip-heartbeat-'));
  process.env.CLIP_TELEMETRY = '1';
  process.env.CLIP_TELEMETRY_FILE = path.join(dir, 'events.jsonl');
  const logs: string[] = [];
  t.mock.method(console, 'log', (line: string) => logs.push(line));
  t.mock.timers.enable({ apis: ['setInterval'] });
  try {
    let finish!: () => void;
    const running = clipSpan('slow-model', {}, () => new Promise<void>(resolve => { finish = resolve; }));
    t.mock.timers.tick(10_000);
    assert.equal(logs.filter(line => JSON.parse(line).event === 'stage.running').length, 1);
    finish();
    await running;
    const count = logs.length;
    t.mock.timers.tick(20_000);
    assert.equal(logs.length, count);
  } finally {
    if (previous === undefined) delete process.env.CLIP_TELEMETRY; else process.env.CLIP_TELEMETRY = previous;
    if (previousFile === undefined) delete process.env.CLIP_TELEMETRY_FILE; else process.env.CLIP_TELEMETRY_FILE = previousFile;
    await rm(dir, { recursive: true, force: true });
  }
});
