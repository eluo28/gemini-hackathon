import { base64ToFloat32 } from '../utils/audioRelay';

export interface StageSource {
  id: string;
  name: string;
  stream?: MediaStream | null;
  videoEnabled?: boolean;
}
export type RelayAudioListener = (peerId: string, pcm16: string, sampleRate: number) => void;
export type SubscribeRelayAudio = (listener: RelayAudioListener) => () => void;

/** Fit every broadcaster into the recording, without cropping their feed. */
export function stageGrid(count: number) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  return { cols, rows: Math.max(1, Math.ceil(count / cols)) };
}

/** A stable canvas + audio destination records both WebRTC and relay guests. */
export function createStageCapture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const context = canvas.getContext('2d')!;
  const audio = new AudioContext();
  const destination = audio.createMediaStreamDestination();
  const limiter = audio.createDynamicsCompressor();
  limiter.connect(destination);
  // Keep the audio clock running with muted microphones and video-only guests.
  const silence = audio.createConstantSource();
  silence.offset.value = 0; silence.connect(destination); silence.start();
  interface Source {
    info: StageSource;
    video: HTMLVideoElement;
    tracks: MediaStreamTrack[];
    nodes: Map<MediaStreamTrack, MediaStreamAudioSourceNode>;
    directGain: GainNode;
    relayGain: GainNode;
    relayImage: HTMLImageElement;
    relayFrame?: string;
    relayUntil: number;
    relayCursor: number;
    pendingAudio: Set<AudioBufferSourceNode>;
    unlisten?: () => void;
  }
  let sources = new Map<string, Source>();
  let stopped = false;
  const output = canvas.captureStream(20);
  destination.stream.getAudioTracks().forEach(track => output.addTrack(track));
  const syncTracks = (source: Source) => {
    const tracks = source.info.stream?.getTracks().filter(t => t.readyState !== 'ended') || [];
    const videos = tracks.filter(t => t.kind === 'video');
    const previousVideos = source.tracks.filter(t => t.kind === 'video');
    if (videos.length !== previousVideos.length || videos.some((t, i) => t !== previousVideos[i])) {
      source.video.srcObject = videos.length ? new MediaStream(videos) : null;
      if (videos.length) void source.video.play().catch(() => {});
    }
    for (const [track, node] of source.nodes) {
      if (!tracks.includes(track)) { node.disconnect(); source.nodes.delete(track); }
    }
    for (const track of tracks.filter(t => t.kind === 'audio')) {
      if (!source.nodes.has(track) && audio.state !== 'closed') {
        try {
          const node = audio.createMediaStreamSource(new MediaStream([track]));
          node.connect(source.directGain); source.nodes.set(track, node);
        } catch { /* A remote audio track may end while being attached. */ }
      }
    }
    source.tracks = tracks;
  };
  const dispose = (source: Source) => {
    source.unlisten?.();
    source.nodes.forEach(node => { try { node.disconnect(); } catch {} });
    source.pendingAudio.forEach(node => { try { node.stop(); node.disconnect(); } catch {} });
    source.directGain.disconnect(); source.relayGain.disconnect();
    source.video.pause(); source.video.srcObject = null;
    source.relayImage.src = '';
  };
  const draw = () => {
    context.fillStyle = '#0f172a'; context.fillRect(0, 0, 1280, 720);
    const { cols, rows } = stageGrid(sources.size);
    [...sources.values()].forEach((source, index) => {
      const { video, info, relayImage } = source;
      // Only one transport contributes audio at a time. Relay is queued slightly
      // ahead, so keep direct audio suppressed until the last chunk finishes.
      source.directGain.gain.value = audio.currentTime < source.relayUntil ? 0 : .8;
      const w = 1280 / cols; const h = 720 / rows; const x = index % cols * w; const y = Math.floor(index / cols) * h;
      const liveVideo = source.tracks.some(t => t.kind === 'video' && t.readyState === 'live' && t.enabled && !t.muted);
      const frame = info.videoEnabled === false ? null
        : liveVideo && video.readyState >= 2 && video.videoWidth > 0 ? video
        : relayImage.complete && relayImage.naturalWidth > 0 ? relayImage : null;
      if (frame) {
        const fw = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.naturalWidth;
        const fh = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.naturalHeight;
        const ratio = Math.min(w / fw, h / fh);
        try {
          context.drawImage(frame, x + (w - fw * ratio) / 2, y + (h - fh * ratio) / 2, fw * ratio, fh * ratio);
        } catch { /* Ignore transient frames while a remote stream reconnects. */ }
      } else {
        context.fillStyle = '#94a3b8'; context.font = '18px sans-serif';
        context.fillText(info.videoEnabled === false ? 'Camera off' : 'Connecting…', x + 24, y + h / 2, Math.max(1, w - 48));
      }
      context.fillStyle = '#0f172acc'; context.fillRect(x + 12, y + h - 45, Math.max(1, Math.min(w - 24, info.name.length * 11 + 24)), 32);
      context.fillStyle = '#ffffff'; context.font = '18px sans-serif'; context.fillText(info.name, x + 24, y + h - 23, Math.max(1, w - 48));
    });
  };
  const timer = setInterval(draw, 50);
  const resume = () => { if (!stopped) void audio.resume().catch(() => {}); };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);
  return {
    stream: output,
    update(streams: StageSource[]) {
      if (stopped) return;
      const next = new Map<string, Source>();
      for (const info of streams) {
        if (next.has(info.id)) continue;
        let source = sources.get(info.id);
        if (!source) {
          const video = document.createElement('video'); video.muted = true; video.playsInline = true;
          const directGain = audio.createGain(); directGain.gain.value = .8; directGain.connect(limiter);
          const relayGain = audio.createGain(); relayGain.gain.value = .8; relayGain.connect(limiter);
          source = { info, video, tracks: [], nodes: new Map(), directGain, relayGain, relayImage: new Image(), relayUntil: 0, relayCursor: 0, pendingAudio: new Set() };
        }
        if (source.info.stream !== info.stream || !source.unlisten) {
          source.unlisten?.();
          const entry = source;
          const sync = () => syncTracks(entry);
          info.stream?.addEventListener('addtrack', sync);
          info.stream?.addEventListener('removetrack', sync);
          source.unlisten = () => {
            info.stream?.removeEventListener('addtrack', sync);
            info.stream?.removeEventListener('removetrack', sync);
          };
        }
        source.info = info; syncTracks(source); next.set(info.id, source);
      }
      for (const [id, source] of sources) if (!next.has(id)) dispose(source);
      sources = next;
      resume(); draw();
    },
    updateRelayFrames(frames: Record<string, string>) {
      for (const [id, source] of sources) {
        const frame = frames[id];
        if (frame === source.relayFrame) continue;
        source.relayFrame = frame;
        source.relayImage.src = frame || '';
      }
    },
    addRelayAudio(peerId: string, pcm16: string, sampleRate: number) {
      const source = sources.get(peerId);
      if (stopped || !source || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) return;
      try {
        const samples = base64ToFloat32(pcm16);
        if (!samples.length) return;
        const buffer = audio.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(samples, 0);
        const node = audio.createBufferSource(); node.buffer = buffer; node.connect(source.relayGain);
        const now = audio.currentTime;
        if (source.relayCursor < now + .015 || source.relayCursor > now + .55) source.relayCursor = now + .06;
        node.start(source.relayCursor);
        source.relayCursor += buffer.duration; source.relayUntil = source.relayCursor;
        source.directGain.gain.value = 0;
        source.pendingAudio.add(node);
        node.onended = () => { source.pendingAudio.delete(node); node.disconnect(); };
        resume();
      } catch { /* Ignore malformed relay packets, as live playback does. */ }
    },
    stop() {
      if (stopped) return;
      stopped = true; clearInterval(timer);
      window.removeEventListener('pointerdown', resume); window.removeEventListener('keydown', resume);
      try { silence.stop(); silence.disconnect(); } catch {}
      sources.forEach(dispose); sources.clear(); limiter.disconnect();
      output.getTracks().forEach(t => { try { t.stop(); } catch {} });
      if (audio.state !== 'closed') void audio.close().catch(() => {});
    },
  };
}
