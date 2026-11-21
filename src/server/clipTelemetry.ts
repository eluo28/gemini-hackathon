import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from 'express';

type Fields = Record<string, unknown>;
const context = new AsyncLocalStorage<Fields>();
export const clipTelemetryEnabled = () => process.env.CLIP_TELEMETRY === '1';
export const clipTelemetryFile = () => path.resolve(process.env.CLIP_TELEMETRY_FILE || '.data/telemetry/clips.jsonl');

// Never serialize SDK request bodies, media, prompts, cookies, or credentials.
function safeText(value: unknown) {
  let text = String(value ?? '');
  for (const key of [process.env.GEMINI_API_KEY].filter(Boolean)) text = text.split(key!).join('[redacted]');
  return text.replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/[A-Za-z0-9+/=_-]{100,}/g, '[long data omitted]').slice(0, 4000);
}
export function clipErrorDetails(error: unknown) {
  const e = error as Error & { status?: number; code?: string; signal?: string; stderr?: string; cause?: Error };
  return { name: e?.name, message: safeText(e?.message ?? error), status: e?.status, code: e?.code,
    signal: e?.signal, stderr: e?.stderr ? safeText(e.stderr) : undefined,
    stack: e?.stack ? safeText(e.stack) : undefined, cause: e?.cause ? safeText(e.cause.message) : undefined };
}
export function clipEvent(event: string, fields: Fields = {}, level = 'info') {
  if (!clipTelemetryEnabled()) return;
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, component: 'clipping', pid: process.pid, ...context.getStore(), ...fields, event });
    console.log(line);
    const file = clipTelemetryFile();
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${line}\n`, { mode: 0o600 });
  } catch (error) {
    // Diagnostics must never prevent generation or turn a saved clip into a failure.
    console.warn('Could not write clip telemetry:', safeText((error as Error).message));
  }
}
export function withClipTrace<T>(fields: Fields, work: () => T): T {
  return context.run({ traceId: randomUUID(), ...context.getStore(), ...fields }, work);
}
export async function clipSpan<T>(stage: string, fields: Fields, work: () => Promise<T>): Promise<T> {
  if (!clipTelemetryEnabled()) return work();
  return withClipTrace({ parentSpanId: context.getStore()?.spanId, spanId: randomUUID() }, async () => {
    const started = performance.now();
    const elapsedMs = () => Math.round(performance.now() - started);
    clipEvent('stage.started', { ...fields, stage });
    const timer = setInterval(() => clipEvent('stage.running', { stage, elapsedMs: elapsedMs() }), 10_000);
    timer.unref();
    try {
      const result = await work();
      clipEvent('stage.completed', { stage, elapsedMs: elapsedMs() });
      return result;
    } catch (error) {
      clipEvent('stage.failed', { stage, elapsedMs: elapsedMs(), error: clipErrorDetails(error) }, 'error');
      throw error;
    } finally { clearInterval(timer); }
  });
}

export const clipRequestTrace: RequestHandler = (req, res, next) => {
  if (!clipTelemetryEnabled()) { next(); return; }
  const supplied = req.get('X-Request-ID');
  const traceId = supplied && /^[a-zA-Z0-9_-]{8,80}$/.test(supplied) ? supplied : randomUUID();
  res.setHeader('X-Request-ID', traceId);
  withClipTrace({ traceId }, () => {
    const started = performance.now();
    const fields = { method: req.method, path: req.originalUrl.split('?')[0] };
    clipEvent('request.started', fields);
    res.on('finish', () => withClipTrace({ traceId }, () => clipEvent('request.completed', { ...fields, status: res.statusCode, elapsedMs: Math.round(performance.now() - started) })));
    res.on('close', () => {
      if (!res.writableFinished) withClipTrace({ traceId }, () => clipEvent('request.disconnected', { ...fields, elapsedMs: Math.round(performance.now() - started) }, 'warn'));
    });
    next();
  });
};
