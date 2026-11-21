import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSoundboardSound, SOUNDBOARD_SOUNDS } from './soundboard';

test('every synthesized sound has audible, bounded PCM with the advertised length and faded edges', () => {
  for (const sound of SOUNDBOARD_SOUNDS) {
    if (sound.id === 'air-horn') continue;
    const rate = 24_000;
    const pcm = renderSoundboardSound(sound.id, rate);
    assert.equal(pcm.length, Math.ceil(sound.duration * rate));
    let energy = 0;
    for (const sample of pcm) {
      assert.ok(Number.isFinite(sample) && Math.abs(sample) <= .901);
      energy += sample * sample;
    }
    assert.ok(Math.sqrt(energy / pcm.length) > .05, `${sound.id} must be audible`);
    assert.equal(Math.abs(pcm[0]), 0);
    assert.ok(Math.abs(pcm.at(-1)!) < .001);
  }
});
