import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { StreamerProfile } from '../shared/protocol';

const dataDir = path.resolve(process.env.PROFILE_DATA_DIR || '.data');
const dataFile = path.join(dataDir, 'streamers.json');
const addressFields = ['recipient', 'street', 'city', 'region', 'postalCode', 'country'] as const;
type ShippingAddress = Record<(typeof addressFields)[number], string>;
interface StoredProfile {
  owner: string;
  profile: StreamerProfile;
  shippingAddress: ShippingAddress | null;
}
const profiles: Record<string, StoredProfile> = Object.create(null);
if (fs.existsSync(dataFile)) {
  Object.assign(profiles, JSON.parse(fs.readFileSync(dataFile, 'utf8')));
}

export function getStreamer(roomId: string) {
  return Object.hasOwn(profiles, roomId) ? profiles[roomId] : null;
}

export function saveStreamer(roomId: string, owner: string, input: unknown): StreamerProfile {
  if (!input || typeof input !== 'object') throw new Error('Enter your profile details.');
  const value = input as Record<string, unknown>;
  const text = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
  const displayName = text(value.displayName, 60);
  const handle = text(value.handle, 32).replace(/^@+/, '');
  if (!displayName || !/^[a-zA-Z0-9_]{1,30}$/.test(handle)) {
    throw new Error('Enter a name and a handle using letters, numbers, or underscores.');
  }
  let shippingAddress: ShippingAddress | null = null;
  if (value.shippingAddress && typeof value.shippingAddress === 'object') {
    const raw = value.shippingAddress as Record<string, unknown>;
    const address = Object.fromEntries(addressFields.map(key => [key, text(raw[key], 200)])) as ShippingAddress;
    if (Object.values(address).some(Boolean)) {
      if (!address.recipient || !address.street || !address.city || !address.postalCode || !/^[A-Z]{2}$/.test(address.country)) {
        throw new Error('Complete the delivery address and use a two-letter country code, such as US.');
      }
      shippingAddress = address;
    }
  }
  const existing = getStreamer(roomId);
  const profile: StreamerProfile = {
    id: existing?.profile.id || `creator_${crypto.randomUUID()}`,
    roomId, displayName, handle: `@${handle}`, bio: text(value.bio, 500),
    initials: displayName.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(),
    giftingEnabled: false,
    hasShippingAddress: shippingAddress !== null,
    wishlist: existing?.profile.wishlist || [],
  };
  const entry = { owner, profile, shippingAddress };
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const temporaryFile = `${dataFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify({ ...profiles, [roomId]: entry }), { mode: 0o600 });
  fs.renameSync(temporaryFile, dataFile);
  profiles[roomId] = entry;
  return profile;
}
