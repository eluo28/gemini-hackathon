import test from 'node:test';
import assert from 'node:assert/strict';
import { FinishReason } from '@google/genai';
import { createClipBriefer, validateBrief } from './clipBrief';
import { createClipReviewer } from './clipReview';
import { DEFAULT_RULES, type ClipRequest, type ClipResult } from '../shared/clipping';

const media = Buffer.from('private-video-bytes');
const request: ClipRequest = { stage: 'judge', resolution: 'medium', durationSec: 60, targetSeconds: 60, media: '', rules: DEFAULT_RULES, query: 'the failed comeback', chat: [{ name: 'A', text: 'outside', offsetSec: 1 }, { name: 'B', text: 'wow', offsetSec: 20 }] };
const result: ClipResult = { answers: {}, durationSec: 45, sourceOffsetSec: 15, trim: { start: 0, end: 45 }, inspection: { request: {}, response: {}, elapsedMs: 1 } };
const brief = { summary: 'A comeback fails.', intent: 'Show the failed comeback and reaction.', relevant: true, beats: [{ start: 4, end: 32, description: 'Attempt, failure, and reaction.' }] };
const response = (value: unknown) => ({ candidates: [{ finishReason: FinishReason.STOP }], text: JSON.stringify(value), usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } });

test('Hydrogen receives the query, normalized video and aligned chat, and returns a timestamped brief', async () => {
  const output = await createClipBriefer({ generate: async payload => {
    assert.equal(payload.model, 'gemini-4-hydrogen');
    assert.equal(payload.config?.responseMimeType, 'application/json');
    const parts = (payload.contents as any)[0].parts;
    assert.equal(parts[0].inlineData.data, media.toString('base64'));
    const context = JSON.parse(parts[1].text);
    assert.equal(context.query, request.query);
    assert.deepEqual(context.chat, [{ name: 'B', text: 'wow', offsetSec: 5 }]);
    return response(brief);
  } })(request, media, result);
  assert.deepEqual(output.brief.beats, brief.beats);
  assert.equal(output.brief.usage?.candidatesTokenCount, 20);
  assert.equal(JSON.stringify(output.inspection).includes(media.toString('base64')), false);
});

test('brief validation rejects malformed or out-of-window evidence and unsupported queries', async () => {
  for (const value of [null, {}, { ...brief, summary: '' }, { ...brief, intent: 'x'.repeat(2001) }, { ...brief, relevant: 'yes' }, { ...brief, beats: [] }, { ...brief, extra: true }, ...[-1, 46, NaN, '4'].map(start => ({ ...brief, beats: [{ start, end: 32, description: 'beat' }] }))]) {
    assert.throws(() => validateBrief(value, 45));
  }
  await assert.rejects(createClipBriefer({ generate: async () => response({ ...brief, relevant: false, beats: [] }) })(request, media, result), { status: 422 });
  for (const change of [{ text: 'invalid JSON' }, { promptFeedback: { blockReason: 'SAFETY' } }, { candidates: [{ finishReason: FinishReason.MAX_TOKENS }] }]) {
    await assert.rejects(createClipBriefer({ generate: async () => ({ ...response(brief), ...change } as any) })(request, media, result), { status: 502 });
  }
});

test('review specialist gets the footage, brief, and proposed cut and validates its feedback', async () => {
  const cut = { start: 4, end: 32, reason: 'Preserve the full beat.' };
  const output = await createClipReviewer({ generate: async payload => {
    assert.equal(payload.model, 'gemini-4-hydrogen');
    const context = JSON.parse((payload.contents as any)[0].parts[1].text);
    assert.deepEqual(context.proposedCut, cut);
    assert.deepEqual(context.brief, { ...brief, model: 'gemini-4-hydrogen' });
    return response({ approved: false, feedback: 'The reaction continues until 34s.' });
  } })(request, media, { ...result, brief: { ...brief, model: 'gemini-4-hydrogen' } }, cut);
  assert.equal(output.review.approved, false);
  for (const value of [null, {}, { approved: 'yes', feedback: 'ok' }, { approved: true, feedback: '' }]) {
    await assert.rejects(createClipReviewer({ generate: async () => response(value) })(request, media, result, cut), { status: 502 });
  }
});

test('an exhausted review budget returns an actionable error and never accepts a partial verdict', async () => {
  await assert.rejects(createClipReviewer({ generate: async () => ({
    candidates: [{ finishReason: FinishReason.MAX_TOKENS }], text: '{"approved":true}',
  }) })(request, media, result, { start: 4, end: 32, reason: 'Full beat.' }), error => {
    assert.match((error as Error).message, /Hydrogen cut review reached its output limit/);
    return true;
  });
});
