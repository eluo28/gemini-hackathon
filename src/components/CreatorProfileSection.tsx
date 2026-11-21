import { useEffect, useState } from 'react';
import { Lock, Pencil, UserRound, X } from 'lucide-react';
import type { RoomStreamerResponse, StreamerProfile } from '../shared/protocol';
import type { ParticipantRole } from '../utils/types';

interface CreatorProfileSectionProps {
  roomId: string;
  selfName: string;
  selfRole: ParticipantRole;
  hostAvatarUrl?: string;
  onProfileChange?: (profile: StreamerProfile | null) => void;
}

const EMPTY_ADDRESS = {
  recipient: '',
  lastName: '',
  phone: '',
  street: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
};

const ADDRESS_FIELDS = [
  ['recipient', 'Recipient first name'],
  ['lastName', 'Recipient last name'],
  ['phone', 'Delivery phone (with country code)'],
  ['street', 'Street address'],
  ['city', 'City'],
  ['region', 'State / region'],
  ['postalCode', 'Postal code'],
  ['country', 'Country code (e.g. US)'],
] as const;

export function CreatorProfileSection({
  roomId,
  selfName,
  selfRole,
  hostAvatarUrl,
  onProfileChange,
}: CreatorProfileSectionProps) {
  const [streamer, setStreamer] = useState<StreamerProfile | null>(null);
  const [recipientDetailsSupported, setRecipientDetailsSupported] = useState(false);
  useEffect(() => { onProfileChange?.(streamer); }, [streamer, onProfileChange]);
  const [canEditProfile, setCanEditProfile] = useState(false);
  const [profileFormOpen, setProfileFormOpen] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState({
    displayName: '',
    handle: '',
    bio: '',
    giftingEnabled: false,
    shippingAddress: { ...EMPTY_ADDRESS },
  });

  useEffect(() => {
    const controller = new AbortController();
    setStreamer(null);
    setCanEditProfile(false);
    setProfileFormOpen(false);
    setProfileError('');
    void fetch(`/api/rooms/${encodeURIComponent(roomId)}/streamer`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load streamer');
        const data: RoomStreamerResponse = await response.json();
        if (!controller.signal.aborted) {
          setStreamer(data.streamer);
          setRecipientDetailsSupported(data.recipientDetailsSupported === true);
          setCanEditProfile(data.canEdit);
        }
      })
      .catch(() => {
        // Stage remains fully usable if creator metadata cannot be loaded.
      });
    return () => controller.abort();
  }, [roomId]);

  useEffect(() => {
    if (!profileFormOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingProfile) {
        setProfileFormOpen(false);
        setProfileError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [profileFormOpen, savingProfile]);

  const openProfileForm = async () => {
    setProfileError('');
    setProfileDraft({
      displayName: streamer?.displayName || selfName,
      handle: streamer?.handle || '',
      bio: streamer?.bio || '',
      giftingEnabled: streamer?.giftingEnabled || false,
      shippingAddress: { ...EMPTY_ADDRESS },
    });
    if (streamer) {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/streamer/settings`);
        if (!response.ok) throw new Error('Could not load your profile settings.');
        const data = await response.json();
        setProfileDraft((draft) => ({
          ...draft,
          shippingAddress: { ...EMPTY_ADDRESS, ...data.shippingAddress },
        }));
      } catch {
        setProfileError('Could not load your profile settings. Try again.');
        return;
      }
    }
    setProfileFormOpen(true);
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    const targetRoom = roomId;
    setSavingProfile(true);
    setProfileError('');
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(targetRoom)}/streamer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileDraft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save profile.');
      setStreamer(data.streamer);
      setCanEditProfile(data.canEdit);
      setProfileFormOpen(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const showProfileCard = Boolean(streamer && streamer.roomId === roomId);
  const showSetupBanner = !streamer && selfRole === 'host' && canEditProfile;

  if (!showProfileCard && !showSetupBanner && !profileError && !profileFormOpen) {
    return null;
  }

  return (
    <>
      <div className="max-w-4xl mx-auto w-full space-y-2.5" data-testid="creator-profile-section">
        {profileError && !profileFormOpen && (
          <p role="alert" className="text-xs font-medium text-rose-600 px-1">
            {profileError}
          </p>
        )}

        {showProfileCard && streamer && (
          <section
            aria-label="About the creator"
            className="bg-white border border-slate-200/90 rounded-2xl px-4 py-3.5 shadow-xs"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {hostAvatarUrl ? (
                  <img
                    src={hostAvatarUrl}
                    alt={`${streamer.displayName} avatar`}
                    className="w-10 h-10 rounded-full object-cover ring-2 ring-slate-100 shrink-0"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="w-10 h-10 rounded-full bg-slate-900 text-white text-xs font-display font-semibold flex items-center justify-center shrink-0"
                  >
                    {streamer.initials}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <h2 className="font-display text-sm font-semibold text-slate-950 truncate">
                      {streamer.displayName}
                    </h2>
                    <span className="text-xs font-mono text-slate-500 truncate">
                      {streamer.handle}
                    </span>
                  </div>
                  {streamer.bio && (
                    <p className="mt-1 text-xs text-slate-600 leading-relaxed">{streamer.bio}</p>
                  )}
                </div>
              </div>

              {selfRole === 'host' && canEditProfile && (
                <button
                  type="button"
                  onClick={() => void openProfileForm()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-950 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors shrink-0"
                >
                  <Pencil className="w-3 h-3" aria-hidden="true" />
                  <span>Edit profile</span>
                </button>
              )}
            </div>
          </section>
        )}

        {showSetupBanner && (
          <div className="bg-white border border-slate-200/90 rounded-2xl px-4 py-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                <UserRound className="w-4 h-4" aria-hidden="true" />
              </div>
              <p className="text-xs text-slate-600">
                Add a creator bio and optional private delivery address for this room.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void openProfileForm()}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-950 hover:text-white rounded-xl transition-colors whitespace-nowrap"
            >
              Set up creator profile
            </button>
          </div>
        )}
      </div>

      {/* Modal Creator Profile Editor (never pushes the live video stage off-screen) */}
      {profileFormOpen && selfRole === 'host' && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingProfile) {
              setProfileFormOpen(false);
              setProfileError('');
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="creator-profile-dialog-title"
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-xl p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2
                  id="creator-profile-dialog-title"
                  className="font-display text-base font-semibold text-slate-950"
                >
                  Creator Profile
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Shown cleanly below your stream stage.
                </p>
              </div>
              <button
                type="button"
                disabled={savingProfile}
                onClick={() => {
                  setProfileFormOpen(false);
                  setProfileError('');
                }}
                aria-label="Close creator profile dialog"
                className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {profileError && (
              <p
                role="alert"
                className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700"
              >
                {profileError}
              </p>
            )}

            <form onSubmit={saveProfile} aria-label="Creator profile" className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Display name
                  <input
                    required
                    maxLength={60}
                    value={profileDraft.displayName}
                    onChange={(e) =>
                      setProfileDraft({ ...profileDraft, displayName: e.target.value })
                    }
                    className="mt-1.5 block w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-normal text-slate-950 focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-700">
                  Handle
                  <input
                    required
                    maxLength={31}
                    placeholder="@yourname"
                    value={profileDraft.handle}
                    onChange={(e) => setProfileDraft({ ...profileDraft, handle: e.target.value })}
                    className="mt-1.5 block w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono font-normal text-slate-950 focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
                  />
                </label>
              </div>

              <label className="block text-xs font-semibold text-slate-700">
                Bio
                <textarea
                  rows={2}
                  maxLength={500}
                  value={profileDraft.bio}
                  onChange={(e) => setProfileDraft({ ...profileDraft, bio: e.target.value })}
                  placeholder="Tell viewers what you stream..."
                  className="mt-1.5 block w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-normal text-slate-950 focus:bg-white focus:outline-none focus:border-slate-900 transition-colors resize-none"
                />
              </label>

              <fieldset className="pt-3 border-t border-slate-100 space-y-3">
                <legend className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <Lock className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  <span>Private delivery address (optional)</span>
                </legend>
                <p className="text-[11px] text-slate-500">
                  Stored privately on the server and never exposed in public room responses.
                </p>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {ADDRESS_FIELDS.filter(([key]) => recipientDetailsSupported || (key !== 'lastName' && key !== 'phone')).map(([key, label]) => (
                    <label key={key} className="block text-xs font-medium text-slate-600">
                      {label}
                      <input
                        maxLength={key === 'country' ? 2 : 200}
                        value={profileDraft.shippingAddress[key]}
                        onChange={(e) =>
                          setProfileDraft({
                            ...profileDraft,
                            shippingAddress: {
                              ...profileDraft.shippingAddress,
                              [key]:
                                key === 'country' ? e.target.value.toUpperCase() : e.target.value,
                            },
                          })
                        }
                        className="mt-1 block w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-950 focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
                      />
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="flex gap-2 text-xs text-slate-600"><input type="checkbox" checked={profileDraft.giftingEnabled} onChange={e => setProfileDraft({ ...profileDraft, giftingEnabled: e.target.checked })} />Enable product gifts to this address. Delivery details may appear in merchant checkout and order records.</label>
              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  disabled={savingProfile}
                  type="button"
                  onClick={() => {
                    setProfileFormOpen(false);
                    setProfileError('');
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  disabled={savingProfile}
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-xl transition-colors disabled:opacity-50"
                >
                  {savingProfile ? 'Saving…' : 'Save profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
