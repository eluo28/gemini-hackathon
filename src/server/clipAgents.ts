import { clipEvent, clipSpan } from './clipTelemetry';
import { GoogleGenAI, type Content, type GenerateContentParameters, type GenerateContentResponse, type GenerateContentResponseUsageMetadata } from '@google/genai';
import type { AgentInspection, ClipRequest, ClipResult } from '../shared/clipping';
import { ClipError } from './clipDecisions';

export type AgentResponse = Partial<Pick<GenerateContentResponse, 'text' | 'functionCalls' | 'promptFeedback' | 'candidates' | 'usageMetadata'>>;
export type GenerateAgent = (request: GenerateContentParameters) => Promise<AgentResponse>;
export interface AgentOptions { apiKey?: string; model?: string; generate?: GenerateAgent }

export function videoContext(request: ClipRequest, media: Buffer, result: ClipResult, context: Record<string, unknown> = {}): Content[] {
  return [{ role: 'user', parts: [
    { inlineData: { mimeType: 'video/webm', data: media.toString('base64') } },
    { text: JSON.stringify({
      durationSec: result.durationSec, query: request.query || null, annotations: result.answers,
      chat: request.chat.filter(c => c.offsetSec >= result.sourceOffsetSec && c.offsetSec <= result.sourceOffsetSec + result.durationSec)
        .map(c => ({ ...c, offsetSec: c.offsetSec - result.sourceOffsetSec })),
      ...context,
    }) },
  ] }];
}

export async function runAgent(label: string, payload: GenerateContentParameters, options: AgentOptions) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!options.generate && (!apiKey || apiKey === 'MY_GEMINI_API_KEY')) {
    throw new ClipError(`Set GEMINI_API_KEY in .env.local and restart the server to enable ${label}.`, 503);
  }
  const generate = options.generate || ((p: GenerateContentParameters) => new GoogleGenAI({ apiKey, httpOptions: { timeout: 45_000, retryOptions: { attempts: 1 } } }).models.generateContent(p));
  const started = Date.now();
  let response: AgentResponse;
  try { response = await clipSpan('gemini.agent', { agent: label, model: payload.model }, () => generate(payload)); }
  catch (error) {
    if ((error as { status?: number })?.status === 429) throw new ClipError(`${label} is rate limited. Retry manually.`, 429);
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new ClipError(`${label} timed out. Retry manually.`, 504);
    throw new ClipError(`${label} failed. Check model access and quota; retry manually.`, 502);
  }
  clipEvent('agent.response', { agent: label, model: payload.model, usage: response.usageMetadata, blockReason: response.promptFeedback?.blockReason, finishReasons: response.candidates?.map(c => c.finishReason), tools: response.functionCalls?.map(c => ({ name: c.name, start: c.args?.start, end: c.args?.end })) });
  if (response.candidates?.some(c => c.finishReason === 'MAX_TOKENS')) {
    throw new ClipError(`${label} reached its output limit before completing. No clip was saved. Retry manually.`, 502);
  }
  if (response.promptFeedback?.blockReason || response.candidates?.length !== 1 || response.candidates[0].finishReason !== 'STOP') {
    throw new ClipError(`${label} did not complete. No clip was saved.`, 502);
  }
  const functionCalls = response.functionCalls;
  const inspection: AgentInspection = {
    request: { ...payload, contents: (payload.contents as Content[]).map(c => ({ ...c, parts: c.parts?.map(p => p.inlineData ? { ...p, inlineData: { ...p.inlineData, data: '[video bytes omitted from inspector]' } } : p) })), config: { ...payload.config, abortSignal: undefined } },
    response: { text: functionCalls?.length ? undefined : response.text, functionCalls, usageMetadata: response.usageMetadata, finishReason: response.candidates[0].finishReason },
    elapsedMs: Date.now() - started,
  };
  return { response, inspection };
}

export function sumUsage(usages: (GenerateContentResponseUsageMetadata | undefined)[]): GenerateContentResponseUsageMetadata {
  const total: Record<string, number> = {};
  for (const usage of usages) for (const [key, value] of Object.entries(usage || {})) {
    if (typeof value === 'number' && key.endsWith('TokenCount')) total[key] = (total[key] || 0) + value;
  }
  return total;
}
