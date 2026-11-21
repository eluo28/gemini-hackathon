import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeMedia, mediaAvailable, getFfmpegPath, resolveMediaBinaryCandidates, parseFfmpegProbeOutput } from './clipMedia';
const exec = promisify(execFile);

test('resolveMediaBinaryCandidates prioritizes explicit env, then existing bundled binary, then system fallback', () => {
  assert.deepEqual(
    resolveMediaBinaryCandidates('/custom/ffmpeg', '/bundled/ffmpeg', 'ffmpeg', () => true),
    ['/custom/ffmpeg'],
  );
  assert.deepEqual(
    resolveMediaBinaryCandidates(undefined, '/bundled/ffmpeg', 'ffmpeg', p => p === '/bundled/ffmpeg'),
    ['/bundled/ffmpeg', 'ffmpeg'],
  );
  assert.deepEqual(
    resolveMediaBinaryCandidates('', '/missing/ffmpeg', 'ffmpeg', () => false),
    ['ffmpeg'],
  );
});

test('parseFfmpegProbeOutput parses video, rotation, image, and rejects invalid stderr', () => {
  const mp4 = parseFfmpegProbeOutput(`
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'public/dancers.mp4':
  Duration: 00:00:08.00, start: 0.000000, bitrate: 2986 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 720x1280, 2982 kb/s, 24 fps
      displaymatrix: rotation of -90.00 degrees
`);
  assert.ok(mp4);
  assert.equal(mp4.format.duration, '8.000000');
  assert.equal(mp4.streams[0]?.codec_name, 'h264');
  assert.equal(mp4.streams[0]?.width, 720);
  assert.equal(mp4.streams[0]?.height, 1280);
  assert.equal(mp4.streams[0]?.side_data_list?.[0]?.rotation, -90);

  const jpg = parseFfmpegProbeOutput(`
Input #0, image2, from 'cat.jpg':
  Duration: 00:00:00.04, start: 0.000000
  Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 256x256 [SAR 1:1 DAR 1:1], 25 fps
`);
  assert.ok(jpg);
  assert.equal(jpg.streams[0]?.codec_name, 'mjpeg');
  assert.equal(jpg.streams[0]?.width, 256);
  assert.equal(jpg.streams[0]?.height, 256);

  assert.equal(parseFfmpegProbeOutput('Invalid data found when processing input'), null);
});

test('FFmpeg produces a decodable, timestamped WebM tail and an accurately trimmed download', async t => {
  if (!await mediaAvailable()) { t.skip('FFmpeg is not installed'); return; }
  const ffmpegBin = getFfmpegPath();
  const dir = await mkdtemp(path.join(tmpdir(), 'clip-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sample.webm');
  await exec(ffmpegBin, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=20', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libvpx', '-deadline', 'realtime', '-c:a', 'libopus', file]);
  const full = await normalizeMedia(await readFile(file), 3, { tail: 60 });
  assert.equal(full.sourceOffsetSec, 0);
  assert.ok(Math.abs(full.durationSec - 3) < .15);
  const remuxed = path.join(dir, 'remuxed.webm');
  await writeFile(remuxed, full.media);
  await exec(ffmpegBin, ['-v', 'error', '-i', remuxed, '-f', 'null', '-']);
  const fullCut = await normalizeMedia(full.media, full.durationSec, { start: .5, end: 1.5 });
  assert.ok(Math.abs(fullCut.durationSec - 1) < .15);
  const normalized = await normalizeMedia(await readFile(file), 3, { tail: 2 });
  assert.equal(normalized.media.readUInt32BE(0), 0x1a45dfa3); assert.equal(normalized.sourceOffsetSec, 1);
  assert.ok(Math.abs(normalized.durationSec - 2) < .15);
  const cut = await normalizeMedia(normalized.media, normalized.durationSec, { start: .5, end: 1.5 });
  assert.ok(Math.abs(cut.durationSec - 1) < .15);
  await assert.rejects(normalizeMedia(Buffer.from('broken'), 3, { tail: 2 }), /decode/);
});
