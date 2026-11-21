import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_ROOM_GRACE_MS,
  filterAndSortDirectoryRooms,
  formatRelativeTime,
  generateFriendlyRoomSlug,
  isRoomDeprecated,
  isRoomVisibleInDirectory,
  parseRecentRoomHistory,
  removeRecentRoomHistory,
  upsertRecentRoomHistory,
} from './roomLifecycle';
import type { RecentRoomEntry, RoomSummary } from './types';

function makeSummary(overrides: Partial<RoomSummary> = {}): RoomSummary {
  return {
    roomId: 'room-a',
    title: 'Room A',
    category: 'Just Chatting',
    isLive: false,
    streamStartedAt: null,
    broadcasterCount: 1,
    viewerCount: 0,
    hostName: 'Maya',
    createdAt: 1000,
    lastActivityAt: 2000,
    ...overrides,
  };
}

test('isRoomDeprecated only marks unoccupied rooms past the grace period', () => {
  const now = 500_000;
  assert.equal(isRoomDeprecated({ participantCount: 1, lastEmptyAt: null }, now), false);
  assert.equal(
    isRoomDeprecated({ participantCount: 0, lastEmptyAt: now - 30_000 }, now, EMPTY_ROOM_GRACE_MS),
    false
  );
  assert.equal(
    isRoomDeprecated(
      { participantCount: 0, lastEmptyAt: now - EMPTY_ROOM_GRACE_MS },
      now,
      EMPTY_ROOM_GRACE_MS
    ),
    true
  );
});

test('filterAndSortDirectoryRooms hides empty ghost rooms and ranks LIVE + larger rooms first', () => {
  const ghost = makeSummary({ roomId: 'ghost', broadcasterCount: 0, viewerCount: 0 });
  const backstage = makeSummary({ roomId: 'backstage', isLive: false, broadcasterCount: 2, viewerCount: 3 });
  const smallLive = makeSummary({ roomId: 'small-live', isLive: true, broadcasterCount: 1, viewerCount: 1, category: 'Gaming' });
  const bigLive = makeSummary({ roomId: 'big-live', title: 'Big Coding Stream', isLive: true, broadcasterCount: 2, viewerCount: 8, category: 'Live Coding' });

  assert.equal(isRoomVisibleInDirectory(ghost), false);

  const ranked = filterAndSortDirectoryRooms([ghost, backstage, smallLive, bigLive]);
  assert.deepEqual(
    ranked.map((r) => r.roomId),
    ['big-live', 'small-live', 'backstage']
  );

  const codingOnly = filterAndSortDirectoryRooms([ghost, backstage, smallLive, bigLive], 'coding', 'Live Coding');
  assert.deepEqual(
    codingOnly.map((r) => r.roomId),
    ['big-live']
  );
});

test('upsertRecentRoomHistory deduplicates, moves latest to top, and respects cap', () => {
  const base: RecentRoomEntry[] = [
    { roomId: 'room-1', title: 'Room 1', category: 'Gaming', lastRole: 'viewer', lastVisitedAt: 100 },
    { roomId: 'room-2', title: 'Room 2', category: 'Just Chatting', lastRole: 'host', lastVisitedAt: 200 },
  ];
  const updated = upsertRecentRoomHistory(
    base,
    { roomId: 'room-1', title: 'Room 1 Updated', category: 'Gaming', lastRole: 'cohost', lastVisitedAt: 300 },
    2
  );
  assert.equal(updated.length, 2);
  assert.equal(updated[0].roomId, 'room-1');
  assert.equal(updated[0].title, 'Room 1 Updated');
  assert.equal(updated[0].lastRole, 'cohost');

  const removed = removeRecentRoomHistory(updated, 'room-1');
  assert.deepEqual(
    removed.map((r) => r.roomId),
    ['room-2']
  );
});

test('generateFriendlyRoomSlug and formatRelativeTime produce clean labels', () => {
  assert.equal(generateFriendlyRoomSlug('Late Night Coding!'), 'late-night-coding');
  assert.equal(generateFriendlyRoomSlug('', 'ab12'), 'studio-ab12');
  assert.equal(formatRelativeTime(100_000, 120_000), 'Just now');
  assert.equal(formatRelativeTime(100_000, 100_000 + 5 * 60 * 1000), '5m ago');
  assert.equal(formatRelativeTime(100_000, 100_000 + 3 * 3600 * 1000), '3h ago');
});

test('parseRecentRoomHistory discards corrupted localStorage entries and normalizes partial ones', () => {
  assert.deepEqual(parseRecentRoomHistory(null), []);
  assert.deepEqual(parseRecentRoomHistory('{bad json'), []);
  assert.deepEqual(parseRecentRoomHistory(JSON.stringify({ notAnArray: true })), []);

  const mixed = JSON.stringify([
    null,
    42,
    { title: 'Missing roomId' },
    { roomId: '  My Room! ', title: '', category: 'Unknown', lastRole: 'admin', lastVisitedAt: 'bad' },
    { roomId: 'live-coding', title: 'Build Night', category: 'Live Coding', lastRole: 'cohost', lastVisitedAt: 12345 },
  ]);
  const parsed = parseRecentRoomHistory(mixed);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].roomId, 'my-room');
  assert.equal(parsed[0].title, 'my-room');
  assert.equal(parsed[0].category, 'Just Chatting');
  assert.equal(parsed[0].lastRole, 'host');
  assert.equal(parsed[1].roomId, 'live-coding');
  assert.equal(parsed[1].title, 'Build Night');
  assert.equal(parsed[1].category, 'Live Coding');
  assert.equal(parsed[1].lastRole, 'cohost');
  assert.equal(parsed[1].lastVisitedAt, 12345);
});

test('filterAndSortDirectoryRooms tolerates malformed room entries without throwing', () => {
  const valid = makeSummary({ roomId: 'ok-room', title: 'Valid Room', isLive: true });
  const malformed = [null, undefined, { roomId: 123 }, valid] as unknown as RoomSummary[];
  const result = filterAndSortDirectoryRooms(malformed, 'valid');
  assert.deepEqual(result.map((r) => r.roomId), ['ok-room']);
  assert.deepEqual(filterAndSortDirectoryRooms(null as unknown as RoomSummary[]), []);
});
