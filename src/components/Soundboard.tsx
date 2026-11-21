import { useState } from 'react';
import { AudioLines, Square, X } from 'lucide-react';
import { SOUNDBOARD_SOUNDS, type SoundboardSound } from '../services/soundboard';

interface Props {
  enabled: boolean;
  busy: boolean;
  playing: SoundboardSound | null;
  error: string;
  onPlay: (sound: SoundboardSound, volume: number) => void;
  onStop: () => void;
  onClose: () => void;
}

export function Soundboard({ enabled, busy, playing, error, onPlay, onStop, onClose }: Props) {
  const [volume, setVolume] = useState(.4);
  return <section id="stream-soundboard" aria-label="Stream soundboard" className="border-t border-slate-100 pt-4 space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><AudioLines className="w-4 h-4" />Soundboard</h2>
        <p className="text-xs text-slate-500 mt-1">Play a reaction on stream. Automatic detection checks the moment after the sound.</p>
      </div>
      <button type="button" onClick={onClose} aria-label="Close soundboard" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><X className="w-4 h-4" /></button>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {SOUNDBOARD_SOUNDS.map((sound, index) => <button key={sound.id} type="button" disabled={!enabled || busy || !!playing} onClick={() => onPlay(sound.id, volume)} aria-pressed={playing === sound.id}
        className={`text-left rounded-xl border p-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${playing === sound.id ? 'bg-rose-50 border-rose-300 text-rose-800' : 'bg-slate-50 border-slate-200 text-slate-900 hover:bg-white hover:border-slate-400'}`}>
        <span aria-hidden="true" className="block text-lg mb-2">{['📣', '👏', '🏆', '🥁'][index]}</span>
        <span className="block text-xs font-semibold">{sound.name}</span>
        <span className="block text-[11px] text-slate-500 mt-1">{sound.duration}s · {playing === sound.id ? 'Playing' : sound.description}</span>
      </button>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-xs text-slate-600">Sound volume
        <input aria-label="Soundboard volume" type="range" min="10" max="100" step="5" value={Math.round(volume * 100)} disabled={!!playing} onChange={e => setVolume(Number(e.target.value) / 100)} className="w-24 accent-rose-600" />
        <span className="font-mono w-8">{Math.round(volume * 100)}%</span>
      </label>
      <button type="button" onClick={onStop} disabled={!playing} className="flex items-center gap-1.5 text-xs font-medium text-slate-600 disabled:opacity-40"><Square className="w-3 h-3" />Stop sound</button>
    </div>
    <p role="status" className="text-xs text-slate-500">{!enabled ? 'Go live and enable clip detection to use the soundboard.' : playing ? 'Playing to your stream and clip buffer. Mic mute does not mute the soundboard.' : busy ? 'Detection is working. Wait for it to finish before playing another sound.' : 'Ready. Watch the Clips tab for detection scores and saved highlights.'}</p>
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
  </section>;
}
