import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  MonitorUp,
  Pencil,
  Scissors,
  SlidersHorizontal,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  formatClockDuration,
  getFallbackAnimalAvatar,
  partitionParticipants,
  STREAM_CATEGORIES,
  validateDisplayName,
} from '../utils/streamUtils';
import type {
  ClipMarkerEvent,
  ParticipantRole,
  RoomParticipant,
  RoomSummary,
  StreamCategory,
} from '../utils/types';
import type { RoomStreamerResponse, StreamerProfile } from '../shared/protocol';
import type { MediaDeviceOption, StudioProfile } from '../hooks/useStudioRoom';

interface VideoTileProps {
  participant: RoomParticipant;
  stream: MediaStream | null;
  relayFrame?: string;
  isSelf: boolean;
  isPeerMuted: boolean;
  audioUnlockSeq: number;
  onTogglePeerMute: () => void;
  onAudioBlocked: () => void;
}

function ParticipantVideoTile({
  participant,
  stream,
  relayFrame,
  isSelf,
  isPeerMuted,
  audioUnlockSeq,
  onTogglePeerMute,
  onAudioBlocked,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [hasLiveVideoFrame, setHasLiveVideoFrame] = useState(false);

  const isVideoActive = participant.videoEnabled || participant.screenSharing;

  useEffect(() => {
    setHasLiveVideoFrame(false);
  }, [stream, isVideoActive]);

  // Video element (always muted; remote audio plays through the dedicated <audio> element below
  // so turning a friend's camera off NEVER cuts off their microphone audio!)
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream && isVideoActive) {
      el.srcObject = stream;
      el.muted = true;
      if (el.readyState >= 2 && el.videoWidth > 0) {
        setHasLiveVideoFrame(true);
      }
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
      setHasLiveVideoFrame(false);
    }
  }, [stream, isVideoActive]);

  // Dedicated always-mounted remote audio playback element (independent of camera on/off)
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl || isSelf) return;
    if (stream) {
      audioEl.srcObject = stream;
      audioEl.muted = isPeerMuted;
      audioEl.volume = 1;
      if (!isPeerMuted) {
        audioEl.play().catch(() => {
          onAudioBlocked();
        });
      }
    } else {
      audioEl.srcObject = null;
    }
  }, [stream, isSelf, isPeerMuted, audioUnlockSeq, onAudioBlocked]);

  const fallbackAvatar =
    participant.avatarUrl || getFallbackAnimalAvatar(participant.id).url;

  const showRelayImage = !isSelf && isVideoActive && !hasLiveVideoFrame && Boolean(relayFrame);

  return (
    <div
      data-testid={`video-tile-${participant.id}`}
      className="relative aspect-video rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/90 shadow-xs"
    >
      {/* Always-mounted hidden audio element for remote participants */}
      {!isSelf && stream && (
        <audio ref={audioRef} autoPlay playsInline muted={isPeerMuted} className="hidden" />
      )}

      {stream && isVideoActive && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedData={() => {
            if (videoRef.current && videoRef.current.videoWidth > 0) {
              setHasLiveVideoFrame(true);
            }
          }}
          onResize={() => {
            if (videoRef.current && videoRef.current.videoWidth > 0) {
              setHasLiveVideoFrame(true);
            }
          }}
          className={showRelayImage ? 'hidden' : 'w-full h-full object-cover'}
        />
      )}

      {showRelayImage ? (
        <img
          src={relayFrame}
          alt={`${participant.name} live stream`}
          className="w-full h-full object-cover"
        />
      ) : !stream || !isVideoActive ? (
        <div className="w-full h-full bg-gradient-to-br from-slate-50 via-white to-slate-100/90 flex items-center justify-center p-4 pb-12">
          {!imgFailed ? (
            <img
              src={fallbackAvatar}
              alt={`${participant.name} profile avatar`}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-full object-cover ring-4 ring-white shadow-md"
            />
          ) : (
            <div className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-full bg-slate-200/80 ring-4 ring-white shadow-md flex items-center justify-center">
              <span className="font-display text-2xl font-bold text-slate-600">
                {participant.name.slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
        </div>
      ) : null}

      {/* Per-participant speaker mute button (always available for remote peers, even with camera off) */}
      {!isSelf && (
        <button
          type="button"
          onClick={onTogglePeerMute}
          aria-pressed={isPeerMuted}
          aria-label={isPeerMuted ? `Unmute ${participant.name}` : `Mute ${participant.name}`}
          className="absolute top-3 right-3 p-2 rounded-xl bg-white/90 hover:bg-white text-slate-900 border border-slate-200/80 shadow-xs backdrop-blur-sm transition-colors"
        >
          {isPeerMuted ? (
            <VolumeX className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
          ) : (
            <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>
      )}

      <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3 pointer-events-none">
        <div className="max-w-[85%] px-3 py-1.5 rounded-xl bg-slate-950/75 backdrop-blur-md text-white">
          <p className="text-xs font-semibold truncate">
            {participant.name} {isSelf ? '(You)' : ''}
          </p>
          <p className="text-[11px] text-slate-200 truncate">
            <span className="capitalize">{participant.role}</span> ·{' '}
            {participant.screenSharing
              ? 'Screen'
              : participant.videoEnabled
                ? 'Camera On'
                : 'Camera Off'}{' '}
            · {participant.audioEnabled ? 'Mic On' : 'Muted'}
          </p>
        </div>
      </div>
    </div>
  );
}

interface LiveStageProps {
  roomId: string;
  roomTitle: string;
  roomCategory: StreamCategory;
  isLive: boolean;
  streamStartedAt: number | null;
  isAutoRecording: boolean;
  lastClipMarker: ClipMarkerEvent | null;
  streamEndedNotice: string | null;
  audioBlocked: boolean;
  audioUnlockSeq: number;
  mutedPeerIds: Record<string, boolean>;
  selfId: string | null;
  selfName: string;
  selfRole: ParticipantRole;
  participants: RoomParticipant[];
  directoryRooms: RoomSummary[];
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  remoteRelayFrames: Record<string, string>;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  audioLevel: number;
  mediaNotice: string | null;
  audioDevices: MediaDeviceOption[];
  videoDevices: MediaDeviceOption[];
  selectedAudioId: string;
  selectedVideoId: string;
  showRoomSwitcher: boolean;
  onCloseRoomSwitcher: () => void;
  onJoinRoom: (
    roomId: string,
    profile: StudioProfile,
    meta?: { title?: string; category?: StreamCategory }
  ) => void;
  onLeaveRoom: () => void;
  onDismissStreamEndedNotice: () => void;
  onUpdateRoomMeta: (meta: { title?: string; category?: StreamCategory }) => void;
  onSwitchInputDevice: (audioId: string, videoId: string) => void;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onTogglePeerMute: (peerId: string) => void;
  onUnlockAudio: () => void;
  onReportAudioBlocked: () => void;
  onTriggerClipMark: (source?: 'manual' | 'voice') => void;
}

export function LiveStage({
  roomId,
  roomTitle,
  roomCategory,
  isLive,
  streamStartedAt,
  isAutoRecording,
  lastClipMarker,
  streamEndedNotice,
  audioBlocked,
  audioUnlockSeq,
  mutedPeerIds,
  selfId,
  selfName,
  selfRole,
  participants,
  directoryRooms,
  localStream,
  remoteStreams,
  remoteRelayFrames,
  audioEnabled,
  videoEnabled,
  screenSharing,
  audioLevel,
  mediaNotice,
  audioDevices,
  videoDevices,
  selectedAudioId,
  selectedVideoId,
  showRoomSwitcher,
  onCloseRoomSwitcher,
  onJoinRoom,
  onLeaveRoom,
  onDismissStreamEndedNotice,
  onUpdateRoomMeta,
  onSwitchInputDevice,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onTogglePeerMute,
  onUnlockAudio,
  onReportAudioBlocked,
  onTriggerClipMark,
}: LiveStageProps) {
  const [streamer, setStreamer] = useState<StreamerProfile | null>(null);

  const [canEditProfile, setCanEditProfile] = useState(false);
  const [profileFormOpen, setProfileFormOpen] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const emptyAddress = { recipient: '', street: '', city: '', region: '', postalCode: '', country: '' };
  const [profileDraft, setProfileDraft] = useState({ displayName: '', handle: '', bio: '', shippingAddress: emptyAddress });

  const openProfileForm = async () => {
    setProfileError('');
    setProfileDraft({ displayName: streamer?.displayName || selfName, handle: streamer?.handle || '', bio: streamer?.bio || '', shippingAddress: { ...emptyAddress } });
    if (streamer) {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/streamer/settings`);
        if (!response.ok) throw new Error('Could not load your profile settings.');
        const data = await response.json();
        setProfileDraft(draft => ({ ...draft, shippingAddress: data.shippingAddress || { ...emptyAddress } }));
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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profileDraft),
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
        if (!controller.signal.aborted) { setStreamer(data.streamer); setCanEditProfile(data.canEdit); }
      })
      .catch(() => {
        // The stage remains usable if creator metadata cannot be loaded.
      });
    return () => controller.abort();
  }, [roomId]);

  const [editingMeta, setEditingMeta] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [titleDraft, setTitleDraft] = useState(roomTitle);
  const [categoryDraft, setCategoryDraft] = useState<StreamCategory>(roomCategory);
  const [nameInput, setNameInput] = useState(selfName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [roomInput, setRoomInput] = useState(roomId);
  const [roleInput, setRoleInput] = useState<ParticipantRole>(selfRole);
  const [liveClockSec, setLiveClockSec] = useState(0);

  useEffect(() => {
    setTitleDraft(roomTitle);
    setCategoryDraft(roomCategory);
  }, [roomCategory, roomTitle]);

  useEffect(() => {
    setNameInput(selfName);
  }, [selfName]);

  useEffect(() => {
    setRoleInput(selfRole);
  }, [selfRole]);

  useEffect(() => {
    setRoomInput(roomId);
  }, [roomId]);

  useEffect(() => {
    if (!isLive || !streamStartedAt) {
      setLiveClockSec(0);
      return;
    }
    const interval = window.setInterval(() => {
      setLiveClockSec(Math.max(0, Math.floor((Date.now() - streamStartedAt) / 1000)));
    }, 500);
    return () => window.clearInterval(interval);
  }, [isLive, streamStartedAt]);

  const { broadcasters, viewers } = partitionParticipants(participants);

  const handleRoomSwitch = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateDisplayName(nameInput);
    if (!check.ok) {
      setNameError(check.reason);
      return;
    }
    setNameError(null);
    onJoinRoom(roomInput, {
      name: check.name,
      handle: '',
      role: roleInput,
    });
    onCloseRoomSwitcher();
  };

  const handleSaveMeta = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateRoomMeta({ title: titleDraft.trim() || roomTitle, category: categoryDraft });
    setEditingMeta(false);
  };

  const gridColsClass =
    broadcasters.length <= 1
      ? 'grid-cols-1 max-w-4xl mx-auto w-full'
      : broadcasters.length === 2
        ? 'grid-cols-1 md:grid-cols-2 w-full'
        : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3 w-full';

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-[#FAFAFB] lg:overflow-y-auto">
      {/* Inline Room Switcher Drawer */}
      {showRoomSwitcher && (
        <div className="px-5 md:px-7 py-5 bg-white border-b border-slate-200/80 space-y-4">
          <form onSubmit={handleRoomSwitch} noValidate className="flex flex-wrap items-end gap-3.5">
            <div className="min-w-[160px] flex-1">
              <label htmlFor="studio-name" className="block text-xs font-medium text-slate-600 mb-1.5">
                Display Name
              </label>
              <input
                id="studio-name"
                type="text"
                required
                maxLength={32}
                value={nameInput}
                onChange={(e) => {
                  setNameInput(e.target.value);
                  if (nameError) setNameError(null);
                }}
                placeholder="Enter your name"
                className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-sm text-slate-950 focus:bg-white focus:outline-none transition-colors ${
                  nameError
                    ? 'border-rose-400 focus:border-rose-600'
                    : 'border-slate-200 focus:border-slate-900'
                }`}
              />
            </div>
            <div className="min-w-[160px] flex-1">
              <label htmlFor="studio-room" className="block text-xs font-medium text-slate-600 mb-1.5">
                Room Slug
              </label>
              <input
                id="studio-room"
                type="text"
                required
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono text-slate-950 focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
              />
            </div>
            <div className="min-w-[180px]">
              <label htmlFor="studio-role" className="block text-xs font-medium text-slate-600 mb-1.5">
                Role
              </label>
              <select
                id="studio-role"
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value as ParticipantRole)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-950 focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
              >
                <option value="host">Host (Camera + Mic)</option>
                <option value="cohost">Co-Host (On Stage)</option>
                <option value="viewer">Viewer (Watch &amp; Chat)</option>
              </select>
            </div>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-xl transition-colors whitespace-nowrap"
            >
              Join Room
            </button>
          </form>

          {nameError && (
            <p role="alert" className="text-xs text-rose-600 font-medium">
              {nameError}
            </p>
          )}

          {directoryRooms.length > 0 && (
            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">Active rooms</span>
              {directoryRooms.slice(0, 5).map((r) => (
                <button
                  key={r.roomId}
                  type="button"
                  onClick={() => {
                    const check = validateDisplayName(nameInput || selfName);
                    if (!check.ok) {
                      setNameError(check.reason);
                      return;
                    }
                    onJoinRoom(r.roomId, {
                      name: check.name,
                      handle: '',
                      role: roleInput,
                    });
                    onCloseRoomSwitcher();
                  }}
                  className="hover:text-slate-950 transition-colors whitespace-nowrap tabular-nums"
                >
                  <span className="font-medium text-slate-800">{r.title}</span>{' '}
                  <span className="text-slate-400">
                    ({r.isLive ? 'Live · ' : ''}
                    {r.broadcasterCount} on stage)
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stream Context Header */}
      <div className="px-5 md:px-7 pt-5 pb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-xl font-semibold tracking-tight text-slate-950 truncate">
              {roomTitle}
            </h1>
            {selfRole !== 'viewer' && (
              <button
                type="button"
                onClick={() => setEditingMeta((v) => !v)}
                aria-label="Edit stream title and category"
                className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
            {isLive ? (
              <span className="inline-flex items-center gap-2 text-xs font-mono font-semibold text-rose-600 tabular-nums">
                <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse" aria-hidden="true" />
                LIVE · {formatClockDuration(liveClockSec)}
                {isAutoRecording && (
                  <span className="text-slate-500 font-normal">· Auto-buffering</span>
                )}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-400">
                <span className="w-2 h-2 rounded-full bg-slate-300" aria-hidden="true" />
                OFFLINE
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {roomCategory} · Room <span className="font-mono text-slate-700">{roomId}</span> ·{' '}
            {broadcasters.length} on stage · {viewers.length} watching
          </p>
        </div>
      </div>

      {streamer && streamer.roomId === roomId && (
        <section aria-label="About the streamer" className="mx-5 md:mx-7 mb-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-800">
              {streamer.initials}
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-slate-950">{streamer.displayName}</h2>
              <p className="text-xs text-slate-500">{streamer.handle}</p>
            </div>
            {selfRole === 'host' && canEditProfile && (
              <button type="button" onClick={() => void openProfileForm()} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold">Edit profile</button>
            )}
            <button type="button" disabled aria-describedby="gifting-status" className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-400 cursor-not-allowed">
              Gift to {streamer.displayName}
            </button>
          </div>
          <p className="mt-3 text-sm text-slate-600">{streamer.bio}</p>
          <p id="gifting-status" className="mt-2 text-xs text-slate-500">Gifting is coming soon.</p>
        </section>
      )}

      {!streamer && selfRole === 'host' && canEditProfile && !profileFormOpen && (
        <div className="mx-5 md:mx-7 mb-4 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm text-slate-600">Add your creator profile and a delivery address for future gifts.</p>
          <button type="button" onClick={() => void openProfileForm()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Set up creator profile</button>
        </div>
      )}
      {profileError && <p role="alert" className="mx-5 md:mx-7 mb-3 text-sm text-rose-700">{profileError}</p>}
      {profileFormOpen && selfRole === 'host' && (
        <form onSubmit={saveProfile} aria-label="Creator profile" className="mx-5 md:mx-7 mb-4 rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-base font-semibold">Your creator profile</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Display name<input required maxLength={60} value={profileDraft.displayName} onChange={e => setProfileDraft({ ...profileDraft, displayName: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-200 p-2" /></label>
            <label className="text-sm">Handle<input required maxLength={31} placeholder="@yourname" value={profileDraft.handle} onChange={e => setProfileDraft({ ...profileDraft, handle: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-200 p-2" /></label>
          </div>
          <label className="block text-sm">Bio<textarea maxLength={500} value={profileDraft.bio} onChange={e => setProfileDraft({ ...profileDraft, bio: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-200 p-2" /></label>
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">Gift delivery address (optional)</legend>
            <p className="text-xs text-slate-500">Saved privately for gift delivery. This does not enable gifting yet.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {([['recipient', 'Recipient name'], ['street', 'Street address'], ['city', 'City'], ['region', 'State / region'], ['postalCode', 'Postal code'], ['country', 'Country code (e.g. US)']] as const).map(([key, label]) => (
                <label key={key} className="text-sm">{label}<input maxLength={key === 'country' ? 2 : 200} value={profileDraft.shippingAddress[key]} onChange={e => setProfileDraft({ ...profileDraft, shippingAddress: { ...profileDraft.shippingAddress, [key]: key === 'country' ? e.target.value.toUpperCase() : e.target.value } })} className="mt-1 block w-full rounded-lg border border-slate-200 p-2" /></label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-3">
            <button disabled={savingProfile} type="submit" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{savingProfile ? 'Saving…' : 'Save profile'}</button>
            <button disabled={savingProfile} type="button" onClick={() => { setProfileFormOpen(false); setProfileError(''); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* Inline Stream Info Editor */}
      {editingMeta && (
        <form
          onSubmit={handleSaveMeta}
          className="mx-5 md:mx-7 mb-4 p-4 bg-white border border-slate-200/90 rounded-2xl flex flex-wrap items-end gap-3 shadow-xs"
        >
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="edit-stream-title" className="block text-xs font-medium text-slate-600 mb-1">
              Stream Title
            </label>
            <input
              id="edit-stream-title"
              type="text"
              required
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-sm text-slate-950 focus:bg-white focus:outline-none focus:border-slate-900"
            />
          </div>
          <div>
            <label htmlFor="edit-stream-category" className="block text-xs font-medium text-slate-600 mb-1">
              Category
            </label>
            <select
              id="edit-stream-category"
              value={categoryDraft}
              onChange={(e) => setCategoryDraft(e.target.value as StreamCategory)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-sm text-slate-950 focus:bg-white focus:outline-none focus:border-slate-900"
            >
              {STREAM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-xl transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditingMeta(false)}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Browser Autoplay Unlock Prompt */}
      {audioBlocked && (
        <div
          role="alert"
          className="mx-5 md:mx-7 mb-4 px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <span className="inline-flex items-center gap-2 font-medium">
            <VolumeX className="w-4 h-4 text-rose-600" aria-hidden="true" />
            <span>Your browser paused remote audio until you interact with the page.</span>
          </span>
          <button
            type="button"
            onClick={onUnlockAudio}
            className="px-3 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors whitespace-nowrap"
          >
            Enable Stream Audio
          </button>
        </div>
      )}

      {/* End Stream Confirmation Banner */}
      {streamEndedNotice && (
        <div
          role="status"
          aria-live="polite"
          className="mx-5 md:mx-7 mb-4 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs shadow-xs"
        >
          <span className="font-medium">{streamEndedNotice}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onLeaveRoom}
              className="px-2.5 py-1 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
            >
              Leave Room
            </button>
            <button
              type="button"
              onClick={onDismissStreamEndedNotice}
              aria-label="Dismiss stream ended notice"
              className="p-1 text-slate-400 hover:text-slate-900 rounded"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Momentary Clip Marker Confirmation */}
      {lastClipMarker && (
        <div
          role="status"
          aria-live="polite"
          className="mx-5 md:mx-7 mb-4 px-4 py-2.5 rounded-xl bg-slate-950 text-white flex flex-wrap items-center justify-between gap-2 text-xs shadow-xs"
        >
          <span className="inline-flex items-center gap-2 font-medium">
            <Scissors className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" />
            <span>
              Clip marked at{' '}
              <span className="font-mono tabular-nums">
                {formatClockDuration(lastClipMarker.streamTimeSec)}
              </span>{' '}
              by {lastClipMarker.triggeredBy} (
              {lastClipMarker.source === 'voice' ? 'Voice "Clip That"' : 'Manual'})
            </span>
          </span>
          <span className="text-slate-300">Ready for downstream clipping</span>
        </div>
      )}

      {/* Subtle status notice if camera unavailable */}
      {mediaNotice && (
        <div className="mx-5 md:mx-7 mb-4 px-4 py-2 rounded-xl bg-white border border-slate-200/80 text-xs text-slate-500">
          {mediaNotice}
        </div>
      )}

      {/* Main Video Stage + Sleek Control Dock */}
      <div className="px-5 md:px-7 pb-6 flex-1 flex flex-col gap-5">
        <div className="flex-1 flex items-center">
          <div className={`grid gap-4 ${gridColsClass}`} data-testid="stage-video-grid">
            {broadcasters.length === 0 ? (
              <div className="relative aspect-video rounded-2xl overflow-hidden bg-white border border-slate-200/90 shadow-xs flex items-center justify-center p-8 text-center">
                <div className="max-w-sm space-y-1.5">
                  <p className="font-display text-lg font-semibold text-slate-900">
                    {selfRole === 'viewer' ? 'Stream is offline' : 'Preparing your stage'}
                  </p>
                  <p className="text-sm text-slate-500">
                    {selfRole === 'viewer'
                      ? 'No broadcasters are currently on stage in this room.'
                      : 'Connecting media devices and room signaling...'}
                  </p>
                </div>
              </div>
            ) : (
              broadcasters.map((p) => {
                const isSelf = p.id === selfId;
                const stream = isSelf ? localStream : remoteStreams[p.id] || null;
                const relayFrame = isSelf ? undefined : remoteRelayFrames[p.id];
                return (
                  <ParticipantVideoTile
                    key={p.id}
                    participant={p}
                    stream={stream}
                    relayFrame={relayFrame}
                    isSelf={isSelf}
                    isPeerMuted={Boolean(mutedPeerIds[p.id])}
                    audioUnlockSeq={audioUnlockSeq}
                    onTogglePeerMute={() => onTogglePeerMute(p.id)}
                    onAudioBlocked={onReportAudioBlocked}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Sleek Broadcast Control Dock */}
        {selfRole !== 'viewer' ? (
          <div className="max-w-4xl mx-auto w-full bg-white border border-slate-200/90 rounded-2xl px-4 py-3 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleAudio}
                  aria-pressed={!audioEnabled}
                  aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap ${
                    audioEnabled
                      ? 'bg-slate-50 text-slate-900 border-slate-200 hover:bg-slate-100'
                      : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  {audioEnabled ? (
                    <Mic className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <MicOff className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>{audioEnabled ? 'Mic' : 'Muted'}</span>
                </button>

                <button
                  type="button"
                  onClick={onToggleVideo}
                  aria-pressed={!videoEnabled}
                  aria-label={videoEnabled ? 'Turn camera off' : 'Turn camera on'}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap ${
                    videoEnabled
                      ? 'bg-slate-50 text-slate-900 border-slate-200 hover:bg-slate-100'
                      : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  {videoEnabled ? (
                    <Video className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <VideoOff className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>{videoEnabled ? 'Camera' : 'Cam Off'}</span>
                </button>

                <button
                  type="button"
                  onClick={onToggleScreenShare}
                  aria-pressed={screenSharing}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap ${
                    screenSharing
                      ? 'bg-slate-950 text-white border-slate-950'
                      : 'bg-slate-50 text-slate-900 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <MonitorUp className="w-4 h-4" aria-hidden="true" />
                  <span>{screenSharing ? 'Stop Share' : 'Share Screen'}</span>
                </button>

                {(audioDevices.length > 0 || videoDevices.length > 0) && (
                  <button
                    type="button"
                    onClick={() => setShowDevices((v) => !v)}
                    aria-expanded={showDevices}
                    aria-label="Audio and video devices"
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap ${
                      showDevices
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Devices</span>
                  </button>
                )}

                <div
                  aria-hidden="true"
                  className="hidden md:flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/70"
                >
                  <span className="text-[11px] font-mono text-slate-500">IN</span>
                  <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 transition-all duration-75"
                      style={{ width: `${audioEnabled ? audioLevel : 0}%` }}
                    />
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onTriggerClipMark('manual')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-xl transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
              >
                <Scissors className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Clip That</span>
              </button>
            </div>

            {showDevices && (audioDevices.length > 0 || videoDevices.length > 0) && (
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs">
                {audioDevices.length > 0 && (
                  <label className="inline-flex items-center gap-2 text-slate-600">
                    <span>Microphone</span>
                    <select
                      value={selectedAudioId}
                      onChange={(e) => onSwitchInputDevice(e.target.value, selectedVideoId)}
                      className="max-w-[200px] bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-900"
                    >
                      <option value="">Default Microphone</option>
                      {audioDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {videoDevices.length > 0 && (
                  <label className="inline-flex items-center gap-2 text-slate-600">
                    <span>Camera</span>
                    <select
                      value={selectedVideoId}
                      onChange={(e) => onSwitchInputDevice(selectedAudioId, e.target.value)}
                      className="max-w-[200px] bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-900"
                    >
                      <option value="">Default Camera</option>
                      {videoDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-4xl mx-auto w-full bg-white border border-slate-200/90 rounded-2xl px-4 py-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-600">
              {isLive
                ? 'Watching live. Chat on the right or step onto the stage anytime.'
                : 'Stream is currently offline. Chat live or step onto the stage.'}
            </p>
            <button
              type="button"
              onClick={() =>
                onJoinRoom(roomId, {
                  name: selfName,
                  handle: '',
                  role: 'cohost',
                })
              }
              className="px-4 py-2 text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-xl transition-colors whitespace-nowrap"
            >
              Join Stage
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
