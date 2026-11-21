import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MyClipsPage } from '../src/components/AutoClipper';
import type { useAutoClipper } from '../src/hooks/useAutoClipper';
import { createStageCapture, stageGrid, type StageSource } from '../src/services/stageCapture';
import { RollingRecorder } from '../src/services/rollingRecorder';
import { int16ToBase64 } from '../src/utils/audioRelay';
import type { SavedClip } from '../src/shared/clipping';
import '../src/index.css';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#ff8000'];
const frequencies = colors.map((_, i) => 220 * (i + 1));

function Harness() {
  const [status, setStatus] = useState('Ready');
  const [clip, setClip] = useState<SavedClip | null>(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true); setStatus('Recording seven broadcasters, including a relay-only guest and a late microphone…');
    const audio = new AudioContext(); await audio.resume();
    const stage = createStageCapture();
    const canvases = colors.map(color => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const paint = canvas.getContext('2d')!; paint.fillStyle = color; paint.fillRect(0, 0, 320, 180);
      return canvas;
    });
    const streams = canvases.slice(0, 6).map(canvas => canvas.captureStream(20));
    const microphones = frequencies.slice(0, 6).map((frequency, i) => {
      const oscillator = audio.createOscillator(); oscillator.frequency.value = frequency;
      const gain = audio.createGain(); gain.gain.value = .06;
      const destination = audio.createMediaStreamDestination(); oscillator.connect(gain); gain.connect(destination); oscillator.start();
      if (i !== 1) streams[i].addTrack(destination.stream.getAudioTracks()[0]);
      return destination.stream.getAudioTracks()[0];
    });
    const sources: StageSource[] = colors.map((_, i) => ({ id: String(i), name: `Streamer ${i + 1}`, stream: streams[i] }));
    stage.update(sources);
    stage.updateRelayFrames({ '6': canvases[6].toDataURL() });
    let relayOffset = 0;
    const relay = setInterval(() => {
      const pcm = new Int16Array(1600);
      for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * frequencies[6] * (relayOffset + i) / 16000) * .06 * 32767;
      relayOffset += pcm.length;
      stage.addRelayAudio('6', int16ToBase64(pcm), 16000);
    }, 100);
    // Frequent participant snapshots must not restart every video or audio source.
    const updates = setInterval(() => stage.update(sources.map(s => ({ ...s }))), 130);
    const paintTimer = setInterval(() => canvases.forEach((canvas, i) => {
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = colors[i]; ctx.fillRect(0, 0, 320, 180);
    }), 50);
    const recorder = new RollingRecorder(stage.stream);
    try {
      await wait(600);
      // Exercise addtrack on the same MediaStream, without publishing a new object.
      streams[1].addTrack(microphones[1]);
      await wait(2600);
      const recording = await recorder.snapshot(60);
      const url = URL.createObjectURL(recording.blob);
      const video = document.createElement('video'); video.src = url; video.muted = true;
      await video.play(); await wait(1500); video.pause();
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(video, 0, 0, 1280, 720);
      const { cols, rows } = stageGrid(7);
      colors.forEach((color, i) => {
        const x = (i % cols + .5) * 1280 / cols; const y = (Math.floor(i / cols) + .4) * 720 / rows;
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        const expected = color.slice(1).match(/../g)!.map(v => parseInt(v, 16));
        if (expected.some((value, c) => Math.abs(value - pixel[c]) > 35)) throw new Error(`Streamer ${i + 1} video missing: ${[...pixel]}`);
      });
      const decoded = await audio.decodeAudioData(await recording.blob.arrayBuffer());
      const samples = decoded.getChannelData(0);
      const start = Math.floor(decoded.sampleRate * 1.2); const length = Math.floor(decoded.sampleRate * .5);
      const amplitudes = frequencies.map(frequency => {
        let real = 0, imaginary = 0;
        for (let i = 0; i < length; i++) {
          const angle = 2 * Math.PI * frequency * i / decoded.sampleRate;
          real += samples[start + i] * Math.cos(angle); imaginary += samples[start + i] * Math.sin(angle);
        }
        return 2 * Math.hypot(real, imaginary) / length;
      });
      amplitudes.forEach((value, i) => { if (value < .008) throw new Error(`Streamer ${i + 1} audio missing: ${value}`); });
      setClip({ id: 'test', title: 'All seven streamers', description: 'Six direct feeds and one relay guest, with every microphone mixed into this recording.', url, downloadUrl: url, capturedAt: Date.now(), roomId: 'capture-regression', source: 'manual', startedAt: recording.startedAt, durationSec: recording.durationSec, originalDurationSec: recording.durationSec, trim: { start: 0, end: recording.durationSec }, answers: {}, bytes: recording.blob.size });
      setStatus(`PASS: all 7 videos and all 7 distinct audio tones decoded from the recorded WebM. Tone amplitudes: ${amplitudes.map(v => v.toFixed(3)).join(', ')}. Late microphone and frequent updates retained.`);
    } catch (error) { setStatus(`FAIL: ${(error as Error).message}`); }
    finally {
      clearInterval(relay); clearInterval(updates); clearInterval(paintTimer);
      recorder.stop(); stage.stop(); streams.forEach(s => s.getTracks().forEach(t => t.stop())); microphones.forEach(t => t.stop()); await audio.close(); setRunning(false);
    }
  };
  return <><div style={{ padding: 32 }}><h1>Multi-person clip regression</h1><button disabled={running} onClick={() => void run()}>Run recording check</button><p role="status">{status}</p></div>{clip && <MyClipsPage clipper={{ queue: [clip], libraryLoaded: true, imports: [], error: '', remove: async () => setClip(null) } as unknown as ReturnType<typeof useAutoClipper>} onBack={() => {}} />}</>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
