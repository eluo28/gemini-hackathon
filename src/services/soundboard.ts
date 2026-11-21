export const SOUNDBOARD_SOUNDS = [
  { id: 'air-horn', name: 'MLG airhorn', description: 'The classic gamer airhorn', duration: 3.004082 },
  { id: 'applause', name: 'Applause', description: 'A round of applause', duration: 4 },
  { id: 'victory', name: 'Victory', description: 'Celebrate the win', duration: 3.2 },
  { id: 'drum-sting', name: 'Drum sting', description: 'Land the punchline', duration: 2.8 },
] as const;
export type SoundboardSound = typeof SOUNDBOARD_SOUNDS[number]['id'];

const MLG_AIRHORN_URL = '/audio/mlg-airhorn.mp3';

/** The remaining effects are synthesized; the MLG airhorn uses its bundled recording. */
export function renderSoundboardSound(id: Exclude<SoundboardSound, 'air-horn'>, sampleRate: number): Float32Array<ArrayBuffer> {
  const sound = SOUNDBOARD_SOUNDS.find(s => s.id === id);
  if (!sound) throw new Error('Unknown soundboard sound.');
  const samples = new Float32Array(Math.ceil(sound.duration * sampleRate));
  let seed = 42;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  const tone = (t: number, hz: number) => Math.sin(2 * Math.PI * hz * t);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    let value = 0;
    if (id === 'applause') {
      const clap = Math.exp(-((t * 7) % 1) * 9) + .7 * Math.exp(-((t * 11 + .3) % 1) * 10);
      value = noise() * (.12 + clap * .45) * Math.min(1, t * 5, (sound.duration - t) / .8);
    } else if (id === 'victory') {
      const notes = [261.63, 329.63, 392, 523.25, 392, 523.25];
      const note = Math.min(notes.length - 1, Math.floor(t / .45));
      const local = t - note * .45;
      value = (tone(t, notes[note]) + .25 * tone(t, notes[note] * 2)) * .45 * Math.min(1, local / .02) * Math.exp(-local * 2);
    } else {
      for (const hit of [0, .35, .7]) {
        const local = t - hit;
        if (local >= 0) value += (tone(local, 150) * .3 + noise() * .5) * Math.exp(-local * 22);
      }
      if (t >= 1.05) value += noise() * .55 * Math.exp(-(t - 1.05) * 2.5);
    }
    samples[i] = Math.max(-.9, Math.min(.9, value)) * Math.min(1, t / .01, (sound.duration - t) / .05);
  }
  return samples;
}

/** Mix effects into the same outgoing audio track used by WebRTC and stage capture. */
export function createSoundboard(input: MediaStream) {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const effects = context.createGain();
  effects.connect(destination);
  effects.connect(context.destination); // Monitor effects locally, never the microphone.
  const inputAudioTracks = input.getAudioTracks();
  const microphone = inputAudioTracks.length ? context.createMediaStreamSource(new MediaStream(inputAudioTracks)) : null;
  microphone?.connect(destination);
  const stream = new MediaStream([...input.getVideoTracks(), ...destination.stream.getAudioTracks()]);
  let airhornBuffer: Promise<AudioBuffer> | null = null;
  const loadAirhorn = () => {
    if (!airhornBuffer) {
      airhornBuffer = fetch(MLG_AIRHORN_URL)
        .then(response => {
          if (!response.ok) throw new Error('Could not load the MLG airhorn. Try again.');
          return response.arrayBuffer();
        })
        .then(bytes => context.decodeAudioData(bytes))
        .catch(error => { airhornBuffer = null; throw error; });
    }
    return airhornBuffer;
  };
  let current: AudioBufferSourceNode | null = null;
  let cancel: (() => void) | null = null;
  let stopped = false;
  let sequence = 0;
  const stop = () => {
    sequence++;
    cancel?.(); cancel = null;
    if (current) { current.onended = null; current.stop(); current.disconnect(); current = null; }
  };
  return {
    stream, inputAudioTracks,
    async play(id: SoundboardSound, volume: number): Promise<boolean> {
      stop();
      const token = sequence;
      await context.resume();
      if (stopped || token !== sequence) return false;
      let buffer: AudioBuffer;
      if (id === 'air-horn') {
        buffer = await loadAirhorn();
      } else {
        const data = renderSoundboardSound(id, context.sampleRate);
        buffer = context.createBuffer(1, data.length, context.sampleRate);
        buffer.copyToChannel(data, 0);
      }
      // Stop, leaving the room, or another sound can happen while the MP3 loads.
      if (stopped || token !== sequence) return false;
      const source = context.createBufferSource(); source.buffer = buffer;
      effects.gain.value = Math.max(0, Math.min(1, volume));
      source.connect(effects); current = source;
      return new Promise(resolve => {
        cancel = () => resolve(false);
        source.onended = () => { source.disconnect(); current = null; cancel = null; resolve(true); };
        source.start(context.currentTime + .15); // Allow stage capture to attach to the new stream.
      });
    },
    stop,
    dispose() {
      stopped = true; stop(); microphone?.disconnect(); effects.disconnect();
      inputAudioTracks.forEach(track => track.stop());
      destination.stream.getTracks().forEach(track => track.stop());
      void context.close().catch(() => {});
    },
  };
}
