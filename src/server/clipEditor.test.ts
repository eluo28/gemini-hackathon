import test from 'node:test';
import assert from 'node:assert/strict';
import { FinishReason, FunctionCallingConfigMode } from '@google/genai';
import { createClipBriefer } from './clipBrief';
import { createClipAnalyzer, createClipEditor, validateEdit } from './clipEditor';
import { DEFAULT_RULES, DEFAULT_THRESHOLDS, type ClipRequest, type ClipResult } from '../shared/clipping';

const media = Buffer.from('test video bytes');
const request: ClipRequest = { stage: 'judge', resolution: 'medium', durationSec: 60, targetSeconds: 60, media: '', rules: DEFAULT_RULES, chat: [
  { name: 'A', text: 'outside', offsetSec: 2 }, { name: 'B', text: 'reaction', offsetSec: 20 },
] };
const result: ClipResult = { answers: {}, durationSec: 45, sourceOffsetSec: 15, trim: { start: 10, end: 30 }, inspection: { request: {}, response: {}, elapsedMs: 1 } };
const briefData = { title: 'The comeback falls short', description: 'A comeback attempt fails, followed by an immediate reaction.', summary: 'An attempted comeback fails.', intent: 'Show the failure and reaction.', relevant: true, beats: [{ start: 4, end: 32, description: 'Setup, failed attempt, and reaction.' }] };
const briefer = createClipBriefer({ generate: async () => ({ candidates: [{ finishReason: FinishReason.STOP }], text: JSON.stringify(briefData) }) });
const response = () => ({ candidates: [{ finishReason: FinishReason.STOP }], functionCalls: [{ name: 'trim_clip', args: { start: 4.25, end: 31.75, reason: 'Keep the setup through the reaction.' } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } });

test('editor sends normalized video and aligned chat, requests one tool, and redacts inspector media', async () => {
  const edited = await createClipEditor({ generate: async payload => {
    assert.equal(payload.config?.toolConfig?.functionCallingConfig?.mode, FunctionCallingConfigMode.ANY);
    assert.deepEqual(payload.config?.toolConfig?.functionCallingConfig?.allowedFunctionNames, ['trim_clip', 'review_cut']);
    assert.equal(payload.model, 'gemini-4-neon');
    const parts = (payload.contents as any)[0].parts;
    assert.equal(parts[0].inlineData.data, media.toString('base64'));
    const context = JSON.parse(parts[1].text);
    assert.equal(context.durationSec, 45);
    assert.deepEqual(context.chat, [{ name: 'B', text: 'reaction', offsetSec: 5 }]);
    return response();
  } })(request, media, result);
  assert.equal(edited.edit.start, 4.25);
  assert.equal(edited.edit.usage?.candidatesTokenCount, 20);
  assert.equal(JSON.stringify(edited.inspection).includes(media.toString('base64')), false);
});

test('invalid bounds and extra tool arguments are rejected rather than clamped', () => {
  const good = { start: 0, end: 4, reason: 'Complete action.' };
  for (const change of [{ start: -1 }, { end: 46 }, { end: 0 }, { end: .01 }, { start: '0' }, { end: NaN }, { reason: '' }, { reason: 'x'.repeat(1001) }, { command: 'anything' }]) {
    assert.throws(() => validateEdit({ ...good, ...change }, 45));
  }
  assert.deepEqual(validateEdit({ ...good, end: .5 }, .5), { ...good, end: .5 });
});

test('blocked, incomplete, multiple or unknown tool calls cannot become edits', async () => {
  for (const change of [
    { candidates: [] }, { candidates: [{ finishReason: FinishReason.MAX_TOKENS }] },
    { promptFeedback: { blockReason: 'SAFETY' } }, { functionCalls: [] },
    { functionCalls: [...response().functionCalls, ...response().functionCalls] },
    { functionCalls: [{ name: 'run_command', args: {} }] },
  ]) {
    await assert.rejects(createClipEditor({ generate: async () => ({ ...response(), ...change } as any) })(request, media, result));
  }
});

test('missing key, upstream errors and rate limits fail without retries or credential disclosure', async () => {
  await assert.rejects(createClipEditor({ apiKey: '' })(request, media, result), { status: 503 });
  let calls = 0;
  await assert.rejects(createClipEditor({ generate: async () => { calls++; throw new Error('secret-key'); } })(request, media, result), e => {
    assert.doesNotMatch((e as Error).message, /secret-key/); return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(createClipEditor({ generate: async () => { throw { status: 429 }; } })(request, media, result), { status: 429 });
});

test('pipeline edits manual and qualifying captures, skips probes and rejects, and fails closed', async () => {
  let calls = 0, decisionCalls = 0;
  let positive = false;
  const trigger = () => ({ trigger_detected: { type: 'noul' as const, noul: positive ? .63 : .49, confidence: .8 } });
  const judge = async (): Promise<ClipResult> => { decisionCalls++; return { ...result, answers: trigger() }; };
  const editor = createClipEditor({ generate: async () => { calls++; return response(); } });
  const analyze = createClipAnalyzer(judge, editor, briefer);
  const capture = { id: 'id', source: 'auto-trigger' as const, startedAt: 0, roomId: 'room', thresholds: DEFAULT_THRESHOLDS };
  const run = (r: ClipRequest) => analyze({ ...r, trigger: trigger() }, media, 45, 15);
  await run({ ...request, stage: 'probe' });
  await run({ ...request, capture });
  assert.equal(calls, 0);
  for (const source of ['manual', 'voice', 'manual-flush'] as const) {
    const edited = await run({ ...request, capture: { ...capture, source } });
    assert.deepEqual(edited.trim, { start: 4.25, end: 31.75 });
    assert.ok(edited.inspection.editor);
  }
  positive = true;
  await run({ ...request, capture });
  await run({ ...request, stage: 'instant', capture });
  await run(request); // Analysis-only and offline clients also receive edited boundaries.
  assert.equal(calls, 6);
  assert.equal(decisionCalls, 2, 'only probe and instant stages call Decisions; full-context editing never rescores');
  await assert.rejects(createClipAnalyzer(judge, createClipEditor({ generate: async () => ({ ...response(), functionCalls: [] }) }), briefer)(request, media, 45, 15));
});

test('explicit queries bypass the trigger; Hydrogen runs before Neon and its brief reaches the editor', async () => {
  const order: string[] = [];
  const analyze = createClipAnalyzer(async () => { order.push('decisions'); return result; },
    createClipEditor({ generate: async payload => {
      order.push('neon');
      const context = JSON.parse((payload.contents as any)[0].parts[1].text);
      assert.equal(context.query, 'the failed comeback');
      assert.equal(context.brief.summary, briefData.summary);
      return response();
    } }), createClipBriefer({ generate: async () => { order.push('hydrogen'); return { candidates: [{ finishReason: FinishReason.STOP }], text: JSON.stringify(briefData) }; } }));
  const output = await analyze({ ...request, query: 'the failed comeback', capture: { id: 'id', source: 'auto-trigger', startedAt: 0, roomId: 'room', thresholds: DEFAULT_THRESHOLDS } }, media, 45, 15);
  assert.deepEqual(order, ['hydrogen', 'neon']);
  assert.equal(output.brief?.summary, briefData.summary);
  assert.ok(output.inspection.brief);
});

test('completed soundboard events exceed 50% and enter editing without an AI trigger score', async () => {
  let edits = 0;
  const analyze = createClipAnalyzer(async () => { throw new Error('Soundboard should not call Decisions'); },
    createClipEditor({ generate: async () => { edits++; return response(); } }), briefer);
  const output = await analyze({ ...request, capture: {
    id: 'soundboard', source: 'soundboard', startedAt: 0, roomId: 'room', thresholds: { trigger: 1 },
  } }, media, 45, 15);
  assert.equal(output.triggerSource, 'soundboard');
  assert.deepEqual(output.answers.trigger_detected, { type: 'noul', noul: 1, confidence: 1 });
  assert.equal(edits, 1);
  assert.ok(output.inspection.editor);
  assert.deepEqual(output.inspection.request, { source: 'soundboard', event: 'playback-completed' });
});

function toolResponse(name: string) {
  const call = { name, id: 'review-1', args: { start: 4, end: 32, reason: 'Check the reaction.' } };
  return { ...response(), functionCalls: [call], candidates: [{ finishReason: FinishReason.STOP, content: { role: 'model', parts: [{ thoughtSignature: 'signature', functionCall: call }] } }] };
}

test('Neon delegates reviews, receives feedback with original thought signatures, and finalizes a revised cut', async () => {
  let turns = 0;
  const edit = createClipEditor({
    reviewer: async (_req, bytes, _result, cut) => {
      assert.equal(bytes, media);
      return { review: { ...cut, model: 'gemini-4-hydrogen', approved: false, feedback: 'Keep the reaction through 34s.', usage: { candidatesTokenCount: 10 } }, inspection: { request: {}, response: {}, elapsedMs: 5 } };
    },
    generate: async payload => {
      turns++;
      if (turns === 1) return toolResponse('review_cut');
      const contents = payload.contents as any[];
      assert.equal(contents[1].parts[0].thoughtSignature, 'signature');
      assert.equal(contents[2].parts[0].functionResponse.id, 'review-1');
      assert.equal(contents[2].parts[0].functionResponse.response.approved, false);
      return { ...response(), functionCalls: [{ name: 'trim_clip', args: { start: 4, end: 34, reason: 'Preserve the full reaction.' } }] };
    },
  });
  const output = await edit(request, media, result);
  assert.equal(turns, 2);
  assert.equal(output.edit.end, 34);
  assert.equal(output.edit.usage?.candidatesTokenCount, 40);
  assert.equal(output.edit.reviews?.[0].usage?.candidatesTokenCount, 10);
  assert.deepEqual(output.inspection.steps.map(s => s.agent), ['neon', 'hydrogen-review', 'neon']);
  assert.equal(JSON.stringify(output.inspection).includes(media.toString('base64')), false);
});

test('delegation is capped and a failing specialist cannot produce a saved edit', async () => {
  let turns = 0, reviews = 0;
  const reviewer = async (_request: ClipRequest, _media: Buffer, _result: ClipResult, cut: any) => {
    reviews++;
    return { review: { ...cut, model: 'gemini-4-hydrogen', approved: true, feedback: 'Complete.' }, inspection: { request: {}, response: {}, elapsedMs: 1 } };
  };
  await assert.rejects(createClipEditor({ reviewer, generate: async payload => {
    turns++;
    if (turns === 3) assert.deepEqual(payload.config?.toolConfig?.functionCallingConfig?.allowedFunctionNames, ['trim_clip']);
    return toolResponse('review_cut');
  } })(request, media, result), { status: 502 });
  assert.equal(turns, 3); assert.equal(reviews, 2);
  await assert.rejects(createClipEditor({ reviewer: async () => { throw new Error('review unavailable'); }, generate: async () => toolResponse('review_cut') })(request, media, result), /review unavailable/);
  let editorCalls = 0;
  await assert.rejects(createClipAnalyzer(async () => result, createClipEditor({ generate: async () => { editorCalls++; return response(); } }), createClipBriefer({ generate: async () => ({ candidates: [{ finishReason: FinishReason.STOP }], text: '{}' }) }))(request, media, 45, 15));
  assert.equal(editorCalls, 0);
});
