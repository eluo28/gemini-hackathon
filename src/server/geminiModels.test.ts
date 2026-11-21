import test from 'node:test';
import assert from 'node:assert/strict';
import { gemini4Model } from './geminiModels';
import { createItemDetector } from './itemDetection';

test('analysis model overrides allow Gemini 4 and reject Flash or older families without fallback', async () => {
  for (const model of ['gemini-4-hydrogen', 'gemini-4-neon', 'gemini-4-carbon', 'gemini-4-argon']) assert.equal(gemini4Model('TEST_MODEL', 'gemini-4-hydrogen', model), model);
  for (const model of ['gemini-3.8-flash', 'gemini-omni-1.2-flash', 'gemini-3-pro', '', 'unknown']) assert.throws(() => gemini4Model('TEST_MODEL', 'gemini-4-hydrogen', model), { status: 503 });
  let calls = 0;
  await assert.rejects(createItemDetector({ model: 'gemini-3.8-flash', generate: async () => { calls++; return { text: '{"items":[]}' }; } })([]), { status: 503, code: 'gemini_model_config' });
  assert.equal(calls, 0);
});
