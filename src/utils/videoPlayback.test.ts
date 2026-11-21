import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCameraVideoConstraints,
  computeRelayFrameSize,
  deriveEffectivePeerState,
  getRenegotiationAction,
  isPeerRtcHealthy,
  shouldAttemptIceRestart,
  shouldContainVideoFrame,
  shouldShowRelayOverlay,
} from './videoPlayback';

test('shouldShowRelayOverlay hides overlay when live WebRTC video is playing and connected', () => {
  assert.equal(
    shouldShowRelayOverlay({
      isSelf: false,
      isVideoActive: true,
      hasLiveVideoFrame: true,
      hasRelayFrame: true,
      peerConnectionState: 'connected',
    }),
    false
  );
});

test('shouldShowRelayOverlay shows relay while connecting or when WebRTC drops to disconnected/failed', () => {
  assert.equal(
    shouldShowRelayOverlay({
      isSelf: false,
      isVideoActive: true,
      hasLiveVideoFrame: false,
      hasRelayFrame: true,
      peerConnectionState: 'connecting',
    }),
    true
  );
  assert.equal(
    shouldShowRelayOverlay({
      isSelf: false,
      isVideoActive: true,
      hasLiveVideoFrame: true,
      hasRelayFrame: true,
      peerConnectionState: 'disconnected',
    }),
    true
  );
  assert.equal(
    shouldShowRelayOverlay({
      isSelf: false,
      isVideoActive: true,
      hasLiveVideoFrame: true,
      hasRelayFrame: true,
      peerConnectionState: 'failed',
    }),
    true
  );
});

test('shouldShowRelayOverlay never shows for self, camera-off, or missing relay frames', () => {
  assert.equal(
    shouldShowRelayOverlay({
      isSelf: true,
      isVideoActive: true,
      hasLiveVideoFrame: false,
      hasRelayFrame: true,
      peerConnectionState: 'connecting',
    }),
    false
  );
  assert.equal(
    shouldShowRelayOverlay({
      isSelf: false,
      isVideoActive: false,
      hasLiveVideoFrame: false,
      hasRelayFrame: true,
      peerConnectionState: 'connecting',
    }),
    false
  );
  assert.equal(
    shouldShowRelayOverlay({
      isSelf: false,
      isVideoActive: true,
      hasLiveVideoFrame: false,
      hasRelayFrame: false,
      peerConnectionState: 'disconnected',
    }),
    false
  );
});

test('getRenegotiationAction defers mid-handshake renegotiation instead of dropping it', () => {
  assert.equal(
    getRenegotiationAction({
      signalingState: 'have-local-offer',
      makingOffer: false,
      isPolite: false,
      hasRemoteDescription: false,
    }),
    'defer'
  );
  assert.equal(
    getRenegotiationAction({
      signalingState: 'stable',
      makingOffer: true,
      isPolite: false,
      hasRemoteDescription: true,
    }),
    'defer'
  );
  assert.equal(
    getRenegotiationAction({
      signalingState: 'stable',
      makingOffer: false,
      isPolite: true,
      hasRemoteDescription: false,
    }),
    'wait-for-remote'
  );
  assert.equal(
    getRenegotiationAction({
      signalingState: 'stable',
      makingOffer: false,
      isPolite: true,
      hasRemoteDescription: true,
    }),
    'send-now'
  );
});

test('deriveEffectivePeerState and isPeerRtcHealthy catch ICE drops even if connectionState lags', () => {
  assert.equal(deriveEffectivePeerState('connected', 'connected'), 'connected');
  assert.equal(deriveEffectivePeerState('connected', 'completed'), 'connected');
  assert.equal(isPeerRtcHealthy('connected', 'completed'), true);

  // ICE drops to disconnected/failed before connectionState catches up
  assert.equal(deriveEffectivePeerState('connected', 'disconnected'), 'disconnected');
  assert.equal(deriveEffectivePeerState('connected', 'failed'), 'failed');
  assert.equal(isPeerRtcHealthy('connected', 'disconnected'), false);

  // DTLS/connection still handshaking while ICE just connected
  assert.equal(deriveEffectivePeerState('connecting', 'connected'), 'connecting');
  assert.equal(isPeerRtcHealthy('connecting', 'connected'), false);
});

test('shouldAttemptIceRestart deduplicates bursts across ice and connection state events', () => {
  assert.equal(
    shouldAttemptIceRestart({
      connectionState: 'failed',
      iceConnectionState: 'failed',
      lastRestartAtMs: 0,
      nowMs: 5000,
    }),
    true
  );
  assert.equal(
    shouldAttemptIceRestart({
      connectionState: 'failed',
      iceConnectionState: 'failed',
      lastRestartAtMs: 4500,
      nowMs: 5000,
      minCooldownMs: 4000,
    }),
    false
  );
  assert.equal(
    shouldAttemptIceRestart({
      connectionState: 'connected',
      iceConnectionState: 'connected',
      lastRestartAtMs: 0,
      nowMs: 10000,
    }),
    false
  );
});

test('computeRelayFrameSize preserves portrait phone and landscape webcam aspect ratios', () => {
  assert.deepEqual(computeRelayFrameSize(720, 1280, 480), { width: 270, height: 480 });
  assert.deepEqual(computeRelayFrameSize(1280, 720, 480), { width: 480, height: 270 });
  assert.deepEqual(computeRelayFrameSize(480, 640, 480), { width: 360, height: 480 });
  assert.deepEqual(computeRelayFrameSize(300, 400, 480), { width: 300, height: 400 });
  assert.deepEqual(computeRelayFrameSize(0, 0, 480), { width: 480, height: 270 });
});

test('shouldContainVideoFrame prevents portrait phone feeds and screen shares from spreading out', () => {
  assert.equal(shouldContainVideoFrame({ width: 720, height: 1280 }), true);
  assert.equal(shouldContainVideoFrame({ width: 270, height: 480 }), true);
  assert.equal(shouldContainVideoFrame({ width: 1280, height: 720 }), false);
  assert.equal(shouldContainVideoFrame({ width: 1280, height: 720, isScreenSharing: true }), true);
  assert.equal(shouldContainVideoFrame({ width: 0, height: 0 }), false);
});

test('buildCameraVideoConstraints adapts to portrait phone viewports', () => {
  assert.deepEqual(buildCameraVideoConstraints(undefined, true), {
    facingMode: 'user',
    width: { ideal: 720 },
    height: { ideal: 1280 },
  });
  assert.deepEqual(buildCameraVideoConstraints(undefined, false), {
    width: { ideal: 1280 },
    height: { ideal: 720 },
  });
  assert.deepEqual(buildCameraVideoConstraints('cam-1', true), {
    deviceId: { exact: 'cam-1' },
    width: { ideal: 720 },
    height: { ideal: 1280 },
  });
});
