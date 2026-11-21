import test from 'node:test';
import assert from 'node:assert/strict';
import { clipSampleTimes, clipShopCommand, hasClipReference, resolveClipQuestion, type ShopClip } from './clipShopping';

const first: ShopClip = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', roomId: 'room', url: '/api/clips/library/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/media', durationSec: 20 };
const second: ShopClip = { ...first, id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb' };

test('clip commands resolve a stable saved ID and preserve the object question; plain questions stay live', () => {
  const command = clipShopCommand(first) + 'find me that mug';
  assert.equal(command, `@shop look in {clip:${first.id}}, find me that mug`);
  assert.deepEqual(resolveClipQuestion(command.slice(6), [second, first]), { clip: first, question: 'find me that mug' });
  assert.equal(resolveClipQuestion('What is that mug?', [first]), null);
  assert.equal(hasClipReference('Look in {this clip}, find the mug'), true);
});

test('this clip requires an explicit selection or one unambiguous saved clip; foreign URLs and deleted IDs cannot resolve', () => {
  assert.equal(resolveClipQuestion('look in {this clip}, find the mug', [first])!.clip.id, first.id);
  assert.equal(resolveClipQuestion('look in {this clip}, find the mug', [first, second], second.id)!.clip.id, second.id);
  assert.throws(() => resolveClipQuestion('look in {this clip}, find the mug', [first, second]), /Choose/);
  assert.throws(() => resolveClipQuestion('look in {this clip}, find the mug', [second], first.id), /Choose/);
  assert.throws(() => resolveClipQuestion('look in {https://example.com/private.webm}, find the mug', [first]), /not in your saved clips/);
  assert.throws(() => resolveClipQuestion(`look in {clip:${first.id}}, find the mug`, []), /not in your saved clips/);
  assert.throws(() => resolveClipQuestion(`look in {clip:${first.id}}`, [first]), /Add a question/);
  assert.throws(() => resolveClipQuestion('look in {broken', [first]), /Use @shop/);
});

test('clip sampling stays within the saved video and rejects unusable duration', () => {
  assert.deepEqual(clipSampleTimes(20), [2, 10, 18]);
  assert.ok(clipSampleTimes(0.005).every(time => time >= 0 && time < 0.005));
  for (const invalid of [0, -1, NaN, Infinity]) assert.throws(() => clipSampleTimes(invalid), /duration/);
});
