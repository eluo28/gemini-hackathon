import { createRoot } from 'react-dom/client';
import App from '../src/App';
import '../src/index.css';

// This development-only entry exercises the real studio with generated media,
// including WebRTC/mic mute and soundboard wiring, without requesting devices.
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
  const paint = canvas.getContext('2d')!;
  const timer = setInterval(() => {
    paint.fillStyle = '#0f172a'; paint.fillRect(0, 0, 640, 360);
    paint.fillStyle = '#fb7185'; paint.fillRect(Date.now() / 10 % 560, 100, 80, 80);
    paint.fillStyle = 'white'; paint.font = '22px sans-serif'; paint.fillText('Generated soundboard test', 30, 45);
  }, 50);
  const audio = new AudioContext(); await audio.resume();
  const output = audio.createMediaStreamDestination();
  const silence = audio.createConstantSource(); silence.offset.value = 0; silence.connect(output); silence.start();
  const stream = new MediaStream([...canvas.captureStream(20).getVideoTracks(), ...output.stream.getAudioTracks()]);
  const video = stream.getVideoTracks()[0];
  const stop = video.stop.bind(video);
  video.stop = () => { clearInterval(timer); silence.stop(); void audio.close().catch(() => {}); stop(); };
  return stream;
} });
Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [] });
createRoot(document.querySelector('#root')!).render(<App />);
