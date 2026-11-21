import { sanitizeRoomSlug } from './streamUtils';
import type { RecentRoomEntry, RoomSummary, StreamCategory } from './types';

/**
 * Grace window (2 minutes) before an empty room is permanently garbage-collected.
 * Long enough to survive a browser refresh or brief Wi-Fi reconnect, short enough
 * to prevent deprecated ghost rooms from accumulating in server memory.
 */
export const EMPTY_ROOM_GRACE_MS = 2 * 60 * 1000;

export const RECENT_ROOMS_STORAGE_KEY = 'clipthat_room_history_v1';

/**
 * Determines whether an unoccupied room has exceeded its grace period and should be swept.
 */
export function isRoomDeprecated(
  room: { participantCount: number; lastEmptyAt: number | null },
  nowMs: number,
  graceMs = EMPTY_ROOM_GRACE_MS
): boolean {
  if (room.participantCount > 0) return false;
  if (room.lastEmptyAt === null) return false;
  return nowMs - room.lastEmptyAt >= graceMs;
}

/**
 * Active directory rooms must have at least one connected participant (broadcaster or viewer).
 * Empty rooms waiting for garbage collection are hidden so users never see dead ghost rooms.
 */
export function isRoomVisibleInDirectory(summary: RoomSummary): boolean {
  return summary.broadcasterCount + summary.viewerCount > 0;
}

/**
 * Twitch-style directory filtering & ranking:
 * 1. Exclude empty/deprecated rooms
 * 2. Filter by category and search query (title, host, slug, category)
 * 3. Sort LIVE channels first, then by total people in room, then by most recent activity
 */
export function filterAndSortDirectoryRooms(
  rooms: RoomSummary[],
  query = '',
  category: StreamCategory | 'All' = 'All'
): RoomSummary[] {
  const needle = query.trim().toLowerCase();
  return rooms
    .filter((room) => {
      if (!isRoomVisibleInDirectory(room)) return false;
      if (category !== 'All' && room.category !== category) return false;
      if (!needle) return true;
      return (
        room.title.toLowerCase().includes(needle) ||
        room.roomId.toLowerCase().includes(needle) ||
        room.hostName.toLowerCase().includes(needle) ||
        room.category.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      const aTotal = a.broadcasterCount + a.viewerCount;
      const bTotal = b.broadcasterCount + b.viewerCount;
      if (aTotal !== bTotal) return bTotal - aTotal;
      return b.lastActivityAt - a.lastActivityAt;
    });
}

/**
 * Inserts or updates a room in the user's personal recent room history, newest first.
 */
export function upsertRecentRoomHistory(
  history: RecentRoomEntry[],
  entry: RecentRoomEntry,
  maxItems = 8
): RecentRoomEntry[] {
  const cleanId = sanitizeRoomSlug(entry.roomId);
  const normalized: RecentRoomEntry = {
    ...entry,
    roomId: cleanId,
    title: entry.title.trim() || cleanId,
  };
  const filtered = history.filter((item) => item.roomId !== cleanId);
  return [normalized, ...filtered].slice(0, maxItems);
}

/**
 * Removes a single room from the user's recent room history.
 */
export function removeRecentRoomHistory(
  history: RecentRoomEntry[],
  roomId: string
): RecentRoomEntry[] {
  return history.filter((item) => item.roomId !== roomId);
}

/**
 * Generates a clean URL-safe slug for a newly created stream room.
 */
export function generateFriendlyRoomSlug(rawTitle?: string, suffixSeed?: string): string {
  const trimmed = (rawTitle || '').trim();
  if (trimmed) {
    const slug = sanitizeRoomSlug(trimmed);
    if (slug && slug !== 'main-stage') {
      return slug;
    }
  }
  const suffix = (suffixSeed || Math.random().toString(36).slice(2, 6)).replace(/[^a-z0-9]/g, '').slice(0, 6);
  return `studio-${suffix || 'live'}`;
}

/**
 * Formats a past timestamp as a concise human-readable relative label.
 */
export function formatRelativeTime(timestampMs: number, nowMs = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}
