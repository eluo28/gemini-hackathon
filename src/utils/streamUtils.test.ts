import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANIMAL_AVATARS,
  appendChatUnique,
  detectClipTriggerPhrase,
  formatClockDuration,
  getFallbackAnimalAvatar,
  isPolitePeer,
  normalizeHandle,
  partitionParticipants,
  pickRandomAnimalAvatar,
  sanitizeAvatarUrl,
  sanitizeRoomSlug,
  shouldTriggerClipMark,
  validateChatSend,
  validateDisplayName,
} from './streamUtils';
import { ClipRingBuffer } from '../services/clipSink';
import type { ChatMessage, RoomParticipant } from './types';

test('validateDisplayName requires a non-empty name and trims whitespace', () => {
  assert.deepEqual(validateDisplayName('   '), {
    ok: false,
    reason: 'Please enter your display name to join.',
  });
  assert.deepEqual(validateDisplayName('  Maya   Lin  '), {
    ok: true,
    name: 'Maya Lin',
  });
  assert.equal(validateDisplayName('a'.repeat(33)).ok, false);
});

test('pickRandomAnimalAvatar and getFallbackAnimalAvatar return valid animal assets', () => {
  const first = pickRandomAnimalAvatar();
  assert.ok(ANIMAL_AVATARS.some((a) => a.url === first.url));
  const second = pickRandomAnimalAvatar(first.url);
  assert.notEqual(second.url, first.url);
  assert.equal(
    getFallbackAnimalAvatar('user_abc123').url,
    getFallbackAnimalAvatar('user_abc123').url
  );
});

test('sanitizeRoomSlug normalizes arbitrary room titles and pasted invite URLs into URL-safe slugs', () => {
  assert.equal(sanitizeRoomSlug('  Late Night Coding!!  '), 'late-night-coding');
  assert.equal(sanitizeRoomSlug('---'), 'main-stage');
  assert.equal(sanitizeRoomSlug('Team_Alpha_01'), 'team_alpha_01');
  assert.equal(
    sanitizeRoomSlug('https://clipthat.example.com/?room=happy-path-stream'),
    'happy-path-stream'
  );
  assert.equal(sanitizeRoomSlug('/friday-build'), 'friday-build');
});

test('normalizeHandle creates consistent lowercase @handles', () => {
  assert.equal(normalizeHandle('Maya Lin'), '@mayalin');
  assert.equal(normalizeHandle('Maya', '@@Maya_Pro!'), '@maya_pro');
});

test('sanitizeAvatarUrl allows safe studio paths and https URLs while rejecting unsafe schemes', () => {
  assert.equal(sanitizeAvatarUrl(ANIMAL_AVATARS[0].url), ANIMAL_AVATARS[0].url);
  assert.equal(sanitizeAvatarUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png');
  assert.equal(sanitizeAvatarUrl('javascript:alert(1)'), undefined);
  assert.equal(sanitizeAvatarUrl('/src/assets/images/../../etc/passwd'), undefined);
});

test('ClipRingBuffer maintains a bounded rolling window of latest chunks', () => {
  const buf = new ClipRingBuffer<string>(3);
  buf.push('s1');
  buf.push('s2');
  buf.push('s3');
  buf.push('s4');
  assert.equal(buf.length, 3);
  assert.deepEqual(buf.snapshot(), ['s2', 's3', 's4']);
  buf.clear();
  assert.equal(buf.length, 0);
});

test('isPolitePeer breaks ties asymmetrically for any two distinct peer IDs', () => {
  const a = 'user_alpha';
  const b = 'user_beta';
  assert.notEqual(isPolitePeer(a, b), isPolitePeer(b, a));
});

test('formatClockDuration formats broadcast timers cleanly', () => {
  assert.equal(formatClockDuration(0), '00:00');
  assert.equal(formatClockDuration(125), '02:05');
  assert.equal(formatClockDuration(3665), '1:01:05');
});

test('detectClipTriggerPhrase matches natural voice triggers and ignores regular speech', () => {
  assert.equal(detectClipTriggerPhrase('Yo clip that!'), true);
  assert.equal(detectClipTriggerPhrase('Wait, CLIP THIS right now'), true);
  assert.equal(detectClipTriggerPhrase('Can someone clip it?'), true);
  assert.equal(detectClipTriggerPhrase('We are shipping the release tonight'), false);
  assert.equal(detectClipTriggerPhrase('paperclip on the desk'), false);
});

test('shouldTriggerClipMark enforces debounce cooldown between triggers', () => {
  assert.equal(shouldTriggerClipMark(0, 1000), true);
  assert.equal(shouldTriggerClipMark(1000, 2500, 3500), false);
  assert.equal(shouldTriggerClipMark(1000, 5000, 3500), true);
});

test('validateChatSend enforces non-empty text and viewer slow mode without blocking hosts', () => {
  assert.deepEqual(validateChatSend('   ', 'viewer', 0, 1000, 0), {
    ok: false,
    reason: 'Message cannot be empty.',
  });
  assert.deepEqual(validateChatSend('Hype!', 'viewer', 10000, 12000, 5), {
    ok: false,
    reason: 'Slow mode active — wait 3s before sending.',
  });
  assert.deepEqual(validateChatSend('Host bypasses slow mode', 'host', 10000, 12000, 5), {
    ok: true,
    text: 'Host bypasses slow mode',
  });
});

test('partitionParticipants separates on-stage broadcasters from audience viewers', () => {
  const list: RoomParticipant[] = [
    {
      id: '1',
      name: 'Maya',
      handle: '@maya',
      role: 'host',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      joinedAt: 1,
    },
    {
      id: '2',
      name: 'Viewer Sam',
      handle: '@sam',
      role: 'viewer',
      audioEnabled: false,
      videoEnabled: false,
      screenSharing: false,
      joinedAt: 2,
    },
  ];
  const { broadcasters, viewers } = partitionParticipants(list);
  assert.equal(broadcasters.length, 1);
  assert.equal(viewers.length, 1);
});

test('appendChatUnique deduplicates replayed WebSocket messages', () => {
  const msg: ChatMessage = {
    id: 'm1',
    roomId: 'main-stage',
    senderId: 'u1',
    senderName: 'Maya',
    senderHandle: '@maya',
    role: 'host',
    text: 'Welcome!',
    timestamp: 1000,
    streamTimeSec: 0,
  };
  const first = appendChatUnique([], msg);
  const second = appendChatUnique(first, msg);
  assert.equal(second.length, 1);
});
