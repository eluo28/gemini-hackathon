import type { ChatMessage, ParticipantRole, RoomParticipant, StreamCategory } from './types';

export interface AnimalAvatarOption {
  id: string;
  label: string;
  url: string;
}

export const ANIMAL_AVATARS: readonly AnimalAvatarOption[] = [
  {
    id: 'fox',
    label: 'Studio Fox',
    url: '/src/assets/images/animal_avatar_fox_1795279123499.jpg',
  },
  {
    id: 'otter',
    label: 'Studio Otter',
    url: '/src/assets/images/animal_avatar_otter_1795279125012.jpg',
  },
  {
    id: 'panda',
    label: 'Red Panda',
    url: '/src/assets/images/animal_avatar_panda_1795279125219.jpg',
  },
  {
    id: 'owl',
    label: 'Snowy Owl',
    url: '/src/assets/images/animal_avatar_owl_1795279124992.jpg',
  },
  {
    id: 'shiba',
    label: 'Studio Shiba',
    url: '/src/assets/images/animal_avatar_shiba_1795279125257.jpg',
  },
  {
    id: 'cat',
    label: 'Tuxedo Cat',
    url: '/src/assets/images/animal_avatar_cat_1795279124481.jpg',
  },
];

/**
 * Picks a random illustrated animal profile avatar, optionally excluding the current one.
 */
export function pickRandomAnimalAvatar(excludeUrl?: string): AnimalAvatarOption {
  const pool = excludeUrl
    ? ANIMAL_AVATARS.filter((avatar) => avatar.url !== excludeUrl)
    : ANIMAL_AVATARS;
  const candidates = pool.length > 0 ? pool : ANIMAL_AVATARS;
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
}

/**
 * Deterministic animal avatar fallback derived from a participant identifier.
 */
export function getFallbackAnimalAvatar(seed: string): AnimalAvatarOption {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return ANIMAL_AVATARS[hash % ANIMAL_AVATARS.length];
}

export const STREAM_CATEGORIES: StreamCategory[] = [
  'Just Chatting',
  'Live Coding',
  'Podcast & Talk',
  'Music & Audio',
  'Gaming',
];

export const QUICK_REACTIONS = ['W', 'GG', 'HYPE', 'CLAP', 'FIRE'];

/**
 * Validates a user-entered display name (never invents a random fallback name).
 */
export function validateDisplayName(
  raw: string
): { ok: true; name: string } | { ok: false; reason: string } {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return { ok: false, reason: 'Please enter your display name to join.' };
  }
  if (cleaned.length > 32) {
    return { ok: false, reason: 'Display name must be 32 characters or fewer.' };
  }
  return { ok: true, name: cleaned };
}

/**
 * Normalizes a user-provided room name, slug, or pasted invite URL into a URL-safe identifier.
 */
export function sanitizeRoomSlug(raw: string): string {
  let candidate = raw.trim();
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      const fromQuery = parsed.searchParams.get('room');
      if (fromQuery) {
        candidate = fromQuery;
      } else {
        candidate = parsed.pathname.replace(/^\/+|\/+$/g, '');
      }
    } catch {
      // Fall through to standard normalization
    }
  } else if (candidate.startsWith('?')) {
    const params = new URLSearchParams(candidate);
    const fromQuery = params.get('room');
    if (fromQuery) candidate = fromQuery;
  }

  const clean = candidate
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return clean || 'main-stage';
}

/**
 * Normalizes a creator handle (e.g. "Maya Lin" -> "@mayalin").
 */
export function normalizeHandle(name: string, rawHandle?: string): string {
  const source = (rawHandle || name).trim().replace(/^@+/, '');
  const clean = source.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
  return `@${clean || 'member'}`;
}

/**
 * Allows only local studio asset paths or valid https:// image URLs for participant avatars.
 */
export function sanitizeAvatarUrl(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.startsWith('/src/assets/images/animal_avatar_') && !trimmed.includes('..')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    // invalid URL
  }
  return undefined;
}

/**
 * Deterministic WebRTC Perfect Negotiation symmetry check:
 * Exactly one peer in any pair is "polite" and the other is the initiator,
 * preventing simultaneous offer glare collisions in multi-user rooms.
 */
export function isPolitePeer(selfId: string, remoteId: string): boolean {
  return selfId.localeCompare(remoteId) > 0;
}

/**
 * Formats seconds as MM:SS or H:MM:SS for stream timers and chat timestamps.
 */
export function formatClockDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Detects spoken voice trigger phrases such as "clip that", "clip it", or "clip this".
 */
export function detectClipTriggerPhrase(transcript: string): boolean {
  const normalized = transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  return /\bclip\s+(that|it|this)\b/.test(normalized);
}

/**
 * Prevents duplicate rapid-fire clip markers from interim + final speech recognition results.
 */
export function shouldTriggerClipMark(
  lastTriggeredMs: number,
  nowMs: number,
  cooldownMs = 3500
): boolean {
  if (lastTriggeredMs <= 0) return true;
  return nowMs - lastTriggeredMs >= cooldownMs;
}

/**
 * Validates chat messages and enforces slow-mode cooldown for viewers.
 */
export function validateChatSend(
  rawText: string,
  role: ParticipantRole,
  lastSentAtMs: number,
  nowMs: number,
  slowModeSec: number
): { ok: true; text: string } | { ok: false; reason: string } {
  const text = rawText.trim();
  if (!text) {
    return { ok: false, reason: 'Message cannot be empty.' };
  }
  if (text.length > 400) {
    return { ok: false, reason: 'Message exceeds 400 character limit.' };
  }
  if (slowModeSec > 0 && role === 'viewer' && lastSentAtMs > 0) {
    const elapsedSec = (nowMs - lastSentAtMs) / 1000;
    if (elapsedSec < slowModeSec) {
      const wait = Math.ceil(slowModeSec - elapsedSec);
      return { ok: false, reason: `Slow mode active — wait ${wait}s before sending.` };
    }
  }
  return { ok: true, text };
}

/**
 * Splits participants into on-stage broadcasters (host/cohost) vs audience viewers.
 */
export function partitionParticipants(participants: RoomParticipant[]): {
  broadcasters: RoomParticipant[];
  viewers: RoomParticipant[];
} {
  const broadcasters: RoomParticipant[] = [];
  const viewers: RoomParticipant[] = [];
  for (const p of participants) {
    if (p.role === 'viewer') {
      viewers.push(p);
    } else {
      broadcasters.push(p);
    }
  }
  return { broadcasters, viewers };
}

/**
 * Idempotently appends a chat message to history without duplicates.
 */
export function appendChatUnique(history: ChatMessage[], incoming: ChatMessage, limit = 250): ChatMessage[] {
  if (history.some((m) => m.id === incoming.id)) {
    return history;
  }
  const next = [...history, incoming];
  return next.length > limit ? next.slice(-limit) : next;
}
