import { clipSampleTimes, type ShopClip } from './clipShopping';

export interface ShoppingFrame { canvas: HTMLCanvasElement; timestampSec?: number }

/** Browser-decoded private media only: never fetch a user-supplied remote URL. */
export async function captureClipFrames(clip: ShopClip, signal: AbortSignal): Promise<ShoppingFrame[]> {
  const url = new URL(clip.url, window.location.origin);
  if (url.origin !== window.location.origin || url.username || url.password
    || url.pathname !== `/api/clips/library/${clip.id}/media` || url.search || url.hash) {
    throw new Error('Choose a saved clip from My Clips. External video URLs are not supported.');
  }
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  const waitFor = (event: string, action: () => void) => new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, ready); video.removeEventListener('error', failed); signal.removeEventListener('abort', aborted); };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Could not load this saved clip. It may have been deleted, or your library session changed.')); };
    const aborted = () => { cleanup(); reject(new DOMException('Clip inspection canceled.', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Loading the clip timed out. Try again when the video is playable.')); }, 15_000);
    video.addEventListener(event, ready, { once: true }); video.addEventListener('error', failed, { once: true }); signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    action();
  });
  try {
    await waitFor('loadeddata', () => { video.src = url.href; video.load(); });
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(video.duration, clip.durationSec) : clip.durationSec;
    const frames: ShoppingFrame[] = [];
    for (const time of clipSampleTimes(duration)) {
      if (signal.aborted) throw new DOMException('Clip inspection canceled.', 'AbortError');
      if (Math.abs(video.currentTime - time) > 0.001) await waitFor('seeked', () => { video.currentTime = time; });
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) throw new Error('This clip has no decodable video frame.');
      const scale = Math.min(1, 960 / video.videoWidth, 540 / video.videoHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Your browser cannot inspect this clip.');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({ canvas, timestampSec: time });
    }
    return frames;
  } finally { video.removeAttribute('src'); video.load(); }
}
