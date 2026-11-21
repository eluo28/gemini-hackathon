import { clipEvent, clipErrorDetails, clipSpan } from './clipTelemetry';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { ClipError, MAX_MEDIA_BYTES } from './clipDecisions';

const exec = promisify(execFile);

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
  return resolveMediaBinaryCandidates(process.env.FFPROBE_PATH, ffprobeStatic?.path, 'ffprobe')[0];
}

let cachedResolved: { envKey: string; ffmpeg: string; ffprobe: string } | null = null;

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

async function resolveWorkingBinaries(): Promise<{ ffmpeg: string; ffprobe: string } | null> {
  const envKey = `${process.env.FFMPEG_PATH ?? ''}|${process.env.FFPROBE_PATH ?? ''}`;
  if (cachedResolved && cachedResolved.envKey === envKey) {
    return { ffmpeg: cachedResolved.ffmpeg, ffprobe: cachedResolved.ffprobe };
  }
  const [ffmpeg, ffprobe] = await Promise.all([
    findExecutable(resolveMediaBinaryCandidates(process.env.FFMPEG_PATH, ffmpegStatic, 'ffmpeg')),
    findExecutable(resolveMediaBinaryCandidates(process.env.FFPROBE_PATH, ffprobeStatic?.path, 'ffprobe')),
  ]);
  if (!ffmpeg || !ffprobe) return null;
  cachedResolved = { envKey, ffmpeg, ffprobe };
  return { ffmpeg, ffprobe };
}

export async function mediaAvailable() {
  return (await resolveWorkingBinaries()) !== null;
}

/** Remux whole recordings; decode and re-encode cuts for accurate boundaries. */
export async function normalizeMedia(bytes: Buffer, duration: number, window: { tail?: number; start?: number; end?: number }) {
  const binaries = await resolveWorkingBinaries();
  const ffmpegBin = binaries?.ffmpeg ?? getFfmpegPath();
  const ffprobeBin = binaries?.ffprobe ?? getFfprobePath();
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
    const { stdout } = await clipSpan('ffprobe', {}, () => exec(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', output], { timeout: 5000 }));
    const actual = Number(JSON.parse(stdout).format?.duration);
    if (!Number.isFinite(actual) || actual < .1 || actual > 61) throw new ClipError('Recording contained no usable video.');
    clipEvent('media.ready', { outputBytes: media.length, durationSec: actual, sourceOffsetSec: start });
    return { media, durationSec: actual, sourceOffsetSec: start };
  } catch (error) {
    clipEvent('media.failed', { error: clipErrorDetails(error) }, 'error');
    if (error instanceof ClipError) throw error;
    const execErr = error as NodeJS.ErrnoException & { stderr?: string };
    if (execErr.code === 'ENOENT') throw new ClipError('Install ffmpeg and ffprobe locally to prepare playable clips.', 503);
    const detail = (execErr.stderr || execErr.message || '').trim().slice(-300);
    if (detail) console.error(`[clipMedia] FFmpeg/ffprobe failed (${ffmpegBin}): ${detail}`);
    throw new ClipError('Could not decode this recording. Restart the buffer and try again.', 422);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
