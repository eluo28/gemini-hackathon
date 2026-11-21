import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { getFallbackAnimalAvatar } from '../utils/streamUtils';
import type { RoomParticipant } from '../utils/types';

export interface VideoTileProps {
  participant: RoomParticipant;
  stream: MediaStream | null;
  relayFrame?: string;
  isSelf: boolean;
  isPeerMuted: boolean;
  audioUnlockSeq: number;
  onTogglePeerMute: () => void;
  onAudioBlocked: () => void;
}

export function ParticipantVideoTile({
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
