import { clipEvent, clipErrorDetails, clipSpan } from './clipTelemetry';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { ClipError, MAX_MEDIA_BYTES } from './clipDecisions';

const exec = promisify(execFile);

export interface MediaProbeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}

export interface MediaProbeResult {
  streams: MediaProbeStream[];
  format: { duration?: string };
}

/** Resolve binary candidates in priority order: explicit env override -> bundled static binary -> system PATH. */
export function resolveMediaBinaryCandidates(
  envPath: string | undefined,
  bundledPath: string | null | undefined,
  systemFallback: string,
  pathExists: (candidate: string) => boolean = existsSync,
): string[] {
  const trimmedEnv = envPath?.trim();
  if (trimmedEnv) return [trimmedEnv];
  const candidates: string[] = [];
  if (bundledPath && pathExists(bundledPath)) candidates.push(bundledPath);
  if (!candidates.includes(systemFallback)) candidates.push(systemFallback);
  return candidates;
}

export function getFfmpegPath(): string {
  return resolveMediaBinaryCandidates(process.env.FFMPEG_PATH, ffmpegStatic, 'ffmpeg')[0];
}

export function getFfprobePath(): string {
  return resolveMediaBinaryCandidates(process.env.FFPROBE_PATH, null, 'ffprobe')[0];
}

function parseTimestampSec(hours: string, mins: string, secs: string): number {
  return Number(hours) * 3600 + Number(mins) * 60 + Number(secs);
}

/** Parse `ffmpeg -hide_banner -i <file>` stderr into ffprobe-compatible stream & format metadata. */
export function parseFfmpegProbeOutput(stderr: string): MediaProbeResult | null {
  if (!stderr || !/Input #0,/.test(stderr)) return null;

  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSec = durationMatch
    ? parseTimestampSec(durationMatch[1], durationMatch[2], durationMatch[3])
    : undefined;

  const streams: MediaProbeStream[] = [];
  const videoMatch = stderr.match(/Stream #\d+:\d+[^\n]*?:\s*Video:\s*([a-zA-Z0-9_]+)([^\n]*)/);
  if (videoMatch) {
    const codecName = videoMatch[1].toLowerCase();
    // Remove parenthesized codec/color profiles so dimensions like "720x1280" match unambiguously.
    const cleaned = videoMatch[2].replace(/\([^)]*\)/g, ' ');
    const dimMatch = cleaned.match(/,\s*(\d{2,5})x(\d{2,5})(?=[\s,\[$]|$)/);
    const width = dimMatch ? Number(dimMatch[1]) : undefined;
    const height = dimMatch ? Number(dimMatch[2]) : undefined;

    const stream: MediaProbeStream = {
      codec_type: 'video',
      codec_name: codecName,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(durationSec !== undefined ? { duration: durationSec.toFixed(6) } : {}),
    };

    const rotateTag = stderr.match(/\brotate\s*:\s*(-?\d+(?:\.\d+)?)/i);
    if (rotateTag) {
      stream.tags = { rotate: rotateTag[1] };
    }
    const displayMatrix = stderr.match(/displaymatrix:\s*rotation of\s*(-?\d+(?:\.\d+)?)\s*degrees/i);
    if (displayMatrix) {
      stream.side_data_list = [{ rotation: Number(displayMatrix[1]) }];
    }
    streams.push(stream);
  }

  return {
    streams,
    format: durationSec !== undefined ? { duration: durationSec.toFixed(6) } : {},
  };
}

let cachedResolved: { envKey: string; ffmpeg: string; ffprobe: string | null } | null = null;

async function findExecutable(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await exec(candidate, ['-version'], { timeout: 3000 });
      return candidate;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

async function resolveWorkingBinaries(): Promise<{ ffmpeg: string; ffprobe: string | null } | null> {
  const envKey = `${process.env.FFMPEG_PATH ?? ''}|${process.env.FFPROBE_PATH ?? ''}`;
  if (cachedResolved && cachedResolved.envKey === envKey) {
    return { ffmpeg: cachedResolved.ffmpeg, ffprobe: cachedResolved.ffprobe };
  }
  const explicitFfprobe = Boolean(process.env.FFPROBE_PATH?.trim());
  const [ffmpeg, ffprobe] = await Promise.all([
    findExecutable(resolveMediaBinaryCandidates(process.env.FFMPEG_PATH, ffmpegStatic, 'ffmpeg')),
    findExecutable(resolveMediaBinaryCandidates(process.env.FFPROBE_PATH, null, 'ffprobe')),
  ]);
  if (!ffmpeg) return null;
  if (explicitFfprobe && !ffprobe) return null;
  cachedResolved = { envKey, ffmpeg, ffprobe };
  return { ffmpeg, ffprobe };
}

export async function mediaAvailable() {
  return (await resolveWorkingBinaries()) !== null;
}

async function measureDurationWithFfmpeg(ffmpegBin: string, file: string): Promise<number | undefined> {
  try {
    const { stderr } = await exec(
      ffmpegBin,
      ['-hide_banner', '-nostdin', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'],
      { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const matches = [...(stderr || '').matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    const last = matches.at(-1);
    return last ? parseTimestampSec(last[1], last[2], last[3]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Probe media metadata. Uses FFPROBE_PATH (if configured) or system ffprobe when available,
 * and falls back to `ffmpeg -i` when ffprobe is absent (avoiding a 336 MB ffprobe-static bundle).
 */
export async function probeMedia(file: string, timeoutMs = 30_000): Promise<MediaProbeResult> {
  const explicitFfprobe = process.env.FFPROBE_PATH?.trim();
  if (explicitFfprobe) {
    const { stdout } = await exec(
      explicitFfprobe,
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
      { timeout: timeoutMs },
    );
    return JSON.parse(stdout) as MediaProbeResult;
  }

  const binaries = await resolveWorkingBinaries();
  if (binaries?.ffprobe) {
    const { stdout } = await exec(
      binaries.ffprobe,
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
      { timeout: timeoutMs },
    );
    return JSON.parse(stdout) as MediaProbeResult;
  }

  const ffmpegBin = binaries?.ffmpeg ?? getFfmpegPath();
  let stderr = '';
  try {
    const res = await exec(ffmpegBin, ['-hide_banner', '-nostdin', '-i', file], { timeout: timeoutMs });
    stderr = res.stderr || '';
  } catch (error) {
    const execErr = error as NodeJS.ErrnoException & { stderr?: string };
    if (execErr.code === 'ENOENT') throw execErr;
    stderr = execErr.stderr || '';
  }

  const parsed = parseFfmpegProbeOutput(stderr);
  if (!parsed) {
    throw new Error('Could not parse media metadata from ffmpeg output');
  }
  if (!parsed.format.duration && parsed.streams.some(s => s.codec_type === 'video')) {
    const measured = await measureDurationWithFfmpeg(ffmpegBin, file);
    if (measured !== undefined && Number.isFinite(measured)) {
      parsed.format.duration = measured.toFixed(6);
      const video = parsed.streams.find(s => s.codec_type === 'video');
      if (video) video.duration = measured.toFixed(6);
    }
  }
  return parsed;
}

/** Remux whole recordings; decode and re-encode cuts for accurate boundaries. */
export async function normalizeMedia(bytes: Buffer, duration: number, window: { tail?: number; start?: number; end?: number }) {
  const binaries = await resolveWorkingBinaries();
  const ffmpegBin = binaries?.ffmpeg ?? getFfmpegPath();
  const dir = await mkdtemp(path.join(tmpdir(), 'clipthat-'));
  try {
    const input = path.join(dir, 'input.webm');
    const output = path.join(dir, 'clip.webm');
    await writeFile(input, bytes);
    // MediaRecorder WebM often has no duration. FFmpeg decodes the complete header-bearing
    // recording; wall-clock timestamps bound the requested window until the output is probed.
    const start = window.tail !== undefined ? Math.max(0, duration - window.tail) : window.start || 0;
    const length = Math.min(60, (window.end ?? duration) - start);
    if (length <= 0) throw new ClipError('The selected clip is empty.');
    // A complete MediaRecorder window already has VP8/VP9 + Opus. Rewriting the
    // container makes it seekable without encoding a minute of live video again.
    // Actual cuts still re-encode so their boundaries do not depend on keyframes.
    const wholeRecording = window.tail !== undefined && window.tail >= duration && duration <= 60;
    await clipSpan('ffmpeg', { inputBytes: bytes.length, durationSec: duration, start, length, mode: wholeRecording ? 'remux' : 'encode' }, () => exec(ffmpegBin, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', input,
      '-ss', String(start), '-t', String(length), '-map', '0:v:0', '-map', '0:a:0?',
      ...(wholeRecording ? ['-c', 'copy'] : [
      '-vf', 'scale=960:540:force_original_aspect_ratio=decrease:force_divisible_by=2',
      '-r', '20', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1000k',
      '-c:a', 'libopus', '-b:a', '64k', '-threads', '2']), '-y', output,
    ], { timeout: 45_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }));
    const media = await readFile(output);
    if (media.length > MAX_MEDIA_BYTES) throw new ClipError('Encoded clip exceeds 16 MB.');
    const probed = await clipSpan('ffprobe', {}, () => probeMedia(output, 5000));
    const actual = Number(probed.format?.duration);
    if (!Number.isFinite(actual) || actual < .1 || actual > 61) throw new ClipError('Recording contained no usable video.');
    clipEvent('media.ready', { outputBytes: media.length, durationSec: actual, sourceOffsetSec: start });
    return { media, durationSec: actual, sourceOffsetSec: start };
  } catch (error) {
    clipEvent('media.failed', { error: clipErrorDetails(error) }, 'error');
    if (error instanceof ClipError) throw error;
    const execErr = error as NodeJS.ErrnoException & { stderr?: string };
    if (execErr.code === 'ENOENT') throw new ClipError('Install ffmpeg locally to prepare playable clips.', 503);
    const detail = (execErr.stderr || execErr.message || '').trim().slice(-300);
    if (detail) console.error(`[clipMedia] FFmpeg probe/encode failed (${ffmpegBin}): ${detail}`);
    throw new ClipError('Could not decode this recording. Restart the buffer and try again.', 422);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
