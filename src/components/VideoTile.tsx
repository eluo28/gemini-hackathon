import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { getFallbackAnimalAvatar } from '../utils/streamUtils';
import {
  getVideoTrackSignature,
  shouldShowRelayOverlay,
  type PeerRtcState,
} from '../utils/videoPlayback';
import type { RoomParticipant } from '../utils/types';

export interface VideoTileProps {
  participant: RoomParticipant;
  stream: MediaStream | null;
  relayFrame?: string;
  peerConnectionState?: PeerRtcState;
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
  peerConnectionState,
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
  const videoTrackSig = getVideoTrackSignature(stream);

  // Only reset hasLiveVideoFrame when video turns off or the underlying video track actually changes
  useEffect(() => {
    if (!stream || !isVideoActive || !videoTrackSig) {
      setHasLiveVideoFrame(false);
      return;
    }
    const el = videoRef.current;
    if (el && el.readyState >= 2 && el.videoWidth > 0 && !el.paused) {
      setHasLiveVideoFrame(true);
    } else {
      setHasLiveVideoFrame(false);
    }
  }, [isVideoActive, stream, videoTrackSig]);

  // Attach MediaStream to <video> without needlessly resetting srcObject (which can freeze decoding).
  // Remote audio plays through the dedicated <audio> element below so camera-off never cuts audio.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream && isVideoActive) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      el.muted = true;
      const tryPlay = () => {
        if (el.readyState >= 2 && el.videoWidth > 0) {
          setHasLiveVideoFrame(true);
        }
        el.play().catch(() => {});
      };
      tryPlay();

      const videoTracks = stream.getVideoTracks();
      const handleTrackUnmute = () => {
        tryPlay();
      };
      const handleTrackMute = () => {
        // Keep checking; if WebRTC drops, peerConnectionState will trigger relay overlay
      };
      videoTracks.forEach((track) => {
        track.addEventListener('unmute', handleTrackUnmute);
        track.addEventListener('mute', handleTrackMute);
      });
      const handleAddTrack = () => {
        tryPlay();
      };
      stream.addEventListener('addtrack', handleAddTrack);

      return () => {
        videoTracks.forEach((track) => {
          track.removeEventListener('unmute', handleTrackUnmute);
          track.removeEventListener('mute', handleTrackMute);
        });
        stream.removeEventListener('addtrack', handleAddTrack);
      };
    } else {
      if (el.srcObject !== null) {
        el.srcObject = null;
      }
      setHasLiveVideoFrame(false);
    }
  }, [stream, isVideoActive, videoTrackSig]);

  // Dedicated always-mounted remote audio playback element (independent of camera on/off)
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl || isSelf) return;
    if (stream) {
      if (audioEl.srcObject !== stream) {
        audioEl.srcObject = stream;
      }
      audioEl.muted = isPeerMuted;
      audioEl.volume = 1;
      if (!isPeerMuted) {
        audioEl.play().catch(() => {
          onAudioBlocked();
        });
      }
    } else if (audioEl.srcObject !== null) {
      audioEl.srcObject = null;
    }
  }, [stream, isSelf, isPeerMuted, audioUnlockSeq, onAudioBlocked]);

  const fallbackAvatar =
    participant.avatarUrl || getFallbackAnimalAvatar(participant.id).url;

  const showRelayImage = shouldShowRelayOverlay({
    isSelf,
    isVideoActive,
    hasLiveVideoFrame,
    hasRelayFrame: Boolean(relayFrame),
    peerConnectionState,
  });

  const markFrameLive = () => {
    const el = videoRef.current;
    if (el && el.videoWidth > 0 && el.readyState >= 2) {
      setHasLiveVideoFrame(true);
    }
  };

  return (
    <div
      data-testid={`video-tile-${participant.id}`}
      data-participant-id={participant.id}
      className="relative aspect-video rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/90 shadow-xs"
    >
      {/* Always-mounted hidden audio element for remote participants */}
      {!isSelf && stream && (
        <audio ref={audioRef} autoPlay playsInline muted={isPeerMuted} className="hidden" />
      )}

      {/* Keep <video> rendered (never display:none) so Chrome/Safari keep decoding WebRTC frames */}
      {stream && isVideoActive && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={markFrameLive}
          onLoadedData={markFrameLive}
          onCanPlay={markFrameLive}
          onPlaying={markFrameLive}
          onResize={markFrameLive}
          onPause={() => {
            const el = videoRef.current;
            if (el && isVideoActive && el.srcObject) {
              el.play().catch(() => {});
            }
          }}
          className="w-full h-full object-cover"
        />
      )}

      {showRelayImage ? (
        <img
          data-live-relay="true"
          src={relayFrame}
          alt={`${participant.name} live stream`}
          className="absolute inset-0 w-full h-full object-cover"
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
