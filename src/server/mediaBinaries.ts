import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Resolve at call time so dotenv and explicit host overrides take precedence.
// Production hosts need no global FFmpeg installation: npm installs the binaries.
export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const binary = require('ffmpeg-static') as string | null;
  if (!binary) throw new Error('FFmpeg is not packaged for this platform. Set FFMPEG_PATH.');
  return binary;
}

export function ffprobePath(): string {
  return process.env.FFPROBE_PATH || (require('@ffprobe-installer/ffprobe') as { path: string }).path;
}
