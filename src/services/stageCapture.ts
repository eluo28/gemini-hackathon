/** A stable canvas + audio destination records the local stage and WebRTC guests. */
export function createStageCapture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const context = canvas.getContext('2d')!;
  const audio = new AudioContext();
  const destination = audio.createMediaStreamDestination();
  // Keep the audio clock running even for video-only guests or muted microphones.
  // A destination with no input can otherwise stall MediaRecorder's multiplexing.
  const silence = audio.createConstantSource();
  silence.offset.value = 0;
  silence.connect(destination);
  silence.start();
  let sources: { video: HTMLVideoElement; name: string; node?: MediaStreamAudioSourceNode; gain?: GainNode }[] = [];
  const output = canvas.captureStream(20);
  destination.stream.getAudioTracks().forEach(track => output.addTrack(track));
  const draw = () => {
    context.fillStyle = '#0f172a'; context.fillRect(0, 0, 1280, 720);
    const cols = sources.length > 1 ? 2 : 1;
    const rows = Math.max(1, Math.ceil(sources.length / cols));
    sources.forEach(({ video, name }, index) => {
      const w = 1280 / cols; const h = 720 / rows; const x = index % cols * w; const y = Math.floor(index / cols) * h;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        try {
          const ratio = Math.min(w / video.videoWidth, h / video.videoHeight);
          const dw = video.videoWidth * ratio; const dh = video.videoHeight * ratio;
          context.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
        } catch {
          // Ignore transient frame draw errors while a remote stream is reinitializing
        }
      }
      context.fillStyle = '#0f172acc'; context.fillRect(x + 12, y + h - 45, Math.min(w - 24, name.length * 11 + 24), 32);
      context.fillStyle = '#ffffff'; context.font = '18px sans-serif'; context.fillText(name, x + 24, y + h - 23, w - 48);
    });
  };
  const timer = setInterval(draw, 50);
  let stopped = false;
  const clear = () => {
    sources.forEach(s => {
      try { s.node?.disconnect(); } catch { /* ignore */ }
      try { s.gain?.disconnect(); } catch { /* ignore */ }
      try { s.video.pause(); s.video.srcObject = null; } catch { /* ignore */ }
    });
    sources = [];
  };
  return {
    stream: output,
    update(streams: { stream: MediaStream; name: string }[]) {
      if (stopped) return;
      clear();
      const selected = streams.filter(s => s && s.stream).slice(0, 6);
      sources = selected.map(({ stream, name }) => {
        const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = stream; void video.play()?.catch?.(() => {});
        let node: MediaStreamAudioSourceNode | undefined; let gain: GainNode | undefined;
        const liveAudioTracks = typeof stream.getAudioTracks === 'function'
          ? stream.getAudioTracks().filter(t => t.readyState !== 'ended')
          : [];
        if (liveAudioTracks.length > 0 && audio.state !== 'closed') {
          try {
            node = audio.createMediaStreamSource(new MediaStream(liveAudioTracks));
            gain = audio.createGain();
            gain.gain.value = .8 / Math.sqrt(selected.length);
            node.connect(gain);
            gain.connect(destination);
          } catch {
            node = undefined;
            gain = undefined;
          }
        }
        return { video, name: name || 'Guest', node, gain };
      });
      if (audio.state === 'suspended') void audio.resume().catch(() => {});
      draw();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      try { silence.stop(); } catch { /* already stopped */ }
      try { silence.disconnect(); } catch { /* ignore */ }
      clear();
      output.getTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } });
      if (audio.state !== 'closed') void audio.close().catch(() => {});
    },
  };
}
