import test from 'node:test';
import assert from 'node:assert/strict';
import { clipSampleTimes, clipShopCommand, hasClipReference, resolveClipQuestion, shopClipTitle, type ShopClip } from './clipShopping';

const first: ShopClip = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', roomId: 'room', url: '/api/clips/library/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/media', durationSec: 20, title: 'Air Horn Interrupts Clip Farming Practice' };
const second: ShopClip = { ...first, id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', title: 'Garden Tour' };

test('Shop this clip populates its displayed name and resolves without a hidden selected ID', () => {
  const command = clipShopCommand(first) + 'find me that mug';
  assert.equal(command, '@shop look in "Air Horn Interrupts Clip Farming Practice", find me that mug');
  assert.ok(!command.includes(first.id));
  assert.deepEqual(resolveClipQuestion(command.slice(6), [second, first]), { clip: first, question: 'find me that mug' });
  const fallback = { ...first, title: '', answers: { category: { type: 'choice' as const, choice: 'Garden Tour', probabilities: {}, confidence: 1 } } };
  assert.equal(shopClipTitle(fallback), 'Garden Tour');
});

test('partial titles work without the word clip or a separate object question', () => {
  assert.equal(hasClipReference('look in air horn interrupts'), true);
  assert.deepEqual(resolveClipQuestion('look in air horn interrupts', [second, first]), { clip: first, question: 'Find products visible in this clip.' });
  assert.deepEqual(resolveClipQuestion('look in air horn interrupts, find me the mug', [first]), { clip: first, question: 'find me the mug' });
  assert.equal(resolveClipQuestion('look in air horn interupts, find the mug', [first])!.clip, first);
  assert.equal(resolveClipQuestion('look in farming horn air, find the mug', [first])!.clip, first);
});

test('natural clip titles preserve quoted words and generated titles safely contain commas and quotes', () => {
  const clip = { ...first, title: "Laughing Video Call Moment With 'Clip It' Reaction" };
  const question = "in the Laughing Video Call Moment With 'Clip It' Reaction clip, find me the plant";
  assert.equal(hasClipReference(question), true);
  assert.deepEqual(resolveClipQuestion(question, [second, clip]), { clip, question: 'find me the plant' });
  assert.equal(resolveClipQuestion('look in laughing video call moment with “Clip It” reaction clip, find the plant', [clip])!.clip, clip);
  const quoted = { ...first, title: 'Air horn, then "Clip It"' };
  assert.equal(resolveClipQuestion((clipShopCommand(quoted) + 'find the mug').slice(6), [quoted])!.clip, quoted);
});

test('exact names win over partial matches while ambiguous names ask for clarification', () => {
  const similar = { ...second, title: 'Air Horn Interrupts The Garden Tour' };
  assert.throws(() => resolveClipQuestion('look in air horn interrupts', [first, similar]), /More than one/);
  assert.equal(resolveClipQuestion('look in "Air Horn Interrupts Clip Farming Practice"', [first, similar])!.clip, first);
  assert.throws(() => resolveClipQuestion('look in "Garden Tour"', [second, { ...first, title: 'Garden Tour' }]), /More than one/);
});

test('unknown names and old ID commands never fall back to the stream', () => {
  assert.throws(() => resolveClipQuestion('look in missing title, find the plant', [first]), /No saved clip/);
  assert.throws(() => resolveClipQuestion('look in air horn interrupts', []), /No saved clip/);
  for (const reference of [`{clip:${first.id}}`, '{this clip}', 'clip:' + first.id, '{broken']) {
    assert.throws(() => resolveClipQuestion(`look in ${reference}, find the mug`, [first]), /Use a clip name/);
  }
  assert.throws(() => resolveClipQuestion('look in "unfinished', [first]), /Use @shop/);
});

test('normal live questions stay live, including questions about hair clips', () => {
  for (const question of ['What is that mug?', 'find that hair clip', 'look at that drink']) {
    assert.equal(hasClipReference(question), false);
    assert.equal(resolveClipQuestion(question, [first]), null);
  }
});

test('clip sampling stays within the saved video and rejects unusable duration', () => {
  assert.deepEqual(clipSampleTimes(20), [2, 10, 18]);
  assert.ok(clipSampleTimes(0.005).every(time => time >= 0 && time < 0.005));
  for (const invalid of [0, -1, NaN, Infinity]) assert.throws(() => clipSampleTimes(invalid), /duration/);
});
