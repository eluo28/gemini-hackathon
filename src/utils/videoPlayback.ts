export type PeerRtcState = RTCPeerConnectionState | 'new';

export interface RelayOverlayDecisionInput {
  isSelf: boolean;
  isVideoActive: boolean;
  hasLiveVideoFrame: boolean;
  hasRelayFrame: boolean;
  peerConnectionState?: PeerRtcState;
}

/**
 * Decides whether a remote tile should layer the WebSocket relay frame on top of the
 * underlying <video> element. Note: the <video> element must remain rendered (never
 * display:none) so browsers continue decoding WebRTC frames and fire playing/loadeddata.
 */
export function shouldShowRelayOverlay({
  isSelf,
  isVideoActive,
  hasLiveVideoFrame,
  hasRelayFrame,
  peerConnectionState,
}: RelayOverlayDecisionInput): boolean {
  if (isSelf || !isVideoActive || !hasRelayFrame) return false;
  if (peerConnectionState === 'disconnected' || peerConnectionState === 'failed') {
    return true;
  }
  return !hasLiveVideoFrame;
}

export interface RenegotiationDecisionInput {
  signalingState: RTCSignalingState;
  makingOffer: boolean;
  isPolite: boolean;
  hasRemoteDescription: boolean;
}

/**
 * Determines whether a peer should send an SDP offer right now, defer it until
 * signaling returns to stable, or wait for the impolite peer's initial offer.
 */
export function getRenegotiationAction({
  signalingState,
  makingOffer,
  isPolite,
  hasRemoteDescription,
}: RenegotiationDecisionInput): 'send-now' | 'defer' | 'wait-for-remote' {
  if (isPolite && !hasRemoteDescription) {
    return 'wait-for-remote';
  }
  if (makingOffer || signalingState !== 'stable') {
    return 'defer';
  }
  return 'send-now';
}

/**
 * Returns a stable signature for the active video track IDs on a MediaStream so
 * components avoid resetting <video>.srcObject when tracks have not changed.
 */
export function getVideoTrackSignature(stream: MediaStream | null): string {
  if (!stream || typeof stream.getVideoTracks !== 'function') return '';
  return stream
    .getVideoTracks()
    .filter((t) => t.readyState !== 'ended')
    .map((t) => t.id)
    .sort()
    .join(',');
}

/**
 * Combines RTCPeerConnection.connectionState and iceConnectionState into a single
 * authoritative peer state so ICE drops (which often fire before connectionState
 * changes in Chrome/Safari/Firefox) immediately trigger relay fallback and recovery.
 */
export function deriveEffectivePeerState(
  connectionState: RTCPeerConnectionState,
  iceConnectionState: RTCIceConnectionState
): PeerRtcState {
  if (connectionState === 'closed' || iceConnectionState === 'closed') {
    return 'closed';
  }
  if (connectionState === 'failed' || iceConnectionState === 'failed') {
    return 'failed';
  }
  if (connectionState === 'disconnected' || iceConnectionState === 'disconnected') {
    return 'disconnected';
  }
  if (
    connectionState === 'connected' &&
    (iceConnectionState === 'connected' || iceConnectionState === 'completed')
  ) {
    return 'connected';
  }
  if (
    connectionState === 'connecting' ||
    iceConnectionState === 'checking' ||
    connectionState === 'connected' ||
    iceConnectionState === 'connected' ||
    iceConnectionState === 'completed'
  ) {
    return 'connecting';
  }
  return 'new';
}

export function isPeerRtcHealthy(
  connectionState: RTCPeerConnectionState | undefined,
  iceConnectionState: RTCIceConnectionState | undefined
): boolean {
  if (!connectionState || !iceConnectionState) return false;
  return deriveEffectivePeerState(connectionState, iceConnectionState) === 'connected';
}

export interface IceRestartCheckInput {
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  lastRestartAtMs: number;
  nowMs: number;
  minCooldownMs?: number;
}

/**
 * Prevents duplicate restartIce() calls when both iceconnectionstatechange and
 * connectionstatechange report degraded states within milliseconds of each other.
 */
export function shouldAttemptIceRestart({
  connectionState,
  iceConnectionState,
  lastRestartAtMs,
  nowMs,
  minCooldownMs = 4000,
}: IceRestartCheckInput): boolean {
  const effective = deriveEffectivePeerState(connectionState, iceConnectionState);
  if (effective !== 'failed' && effective !== 'disconnected') {
    return false;
  }
  return nowMs - lastRestartAtMs >= minCooldownMs;
}

/**
 * Computes aspect-ratio-preserving dimensions for WebSocket relay frames so portrait
 * phone cameras (e.g. 720x1280) are never stretched/squished into a fixed 16:9 canvas.
 */
export function computeRelayFrameSize(
  srcWidth: number,
  srcHeight: number,
  maxLongEdge = 480
): { width: number; height: number } {
  if (!Number.isFinite(srcWidth) || !Number.isFinite(srcHeight) || srcWidth <= 0 || srcHeight <= 0) {
    return { width: 480, height: 270 };
  }
  const scale = Math.min(1, maxLongEdge / Math.max(srcWidth, srcHeight));
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return {
    width: even(srcWidth),
    height: even(srcHeight),
  };
}

/**
 * Uses object-contain for portrait feeds (phone cameras) and screen shares so they
 * keep their natural proportions inside 16:9 stage tiles instead of stretching or cropping.
 */
export function shouldContainVideoFrame({
  width,
  height,
  isScreenSharing = false,
}: {
  width: number;
  height: number;
  isScreenSharing?: boolean;
}): boolean {
  if (isScreenSharing) return true;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }
  return height > width;
}

/**
 * Builds getUserMedia video constraints matching the device orientation so phones
 * capture native portrait video instead of requesting awkward landscape crops.
 */
export function buildCameraVideoConstraints(
  videoDeviceId: string | undefined,
  isPortraitViewport: boolean
): MediaTrackConstraints {
  const dims = isPortraitViewport
    ? { width: { ideal: 720 }, height: { ideal: 1280 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (videoDeviceId) {
    return { deviceId: { exact: videoDeviceId }, ...dims };
  }
  return isPortraitViewport ? { facingMode: 'user', ...dims } : dims;
}
