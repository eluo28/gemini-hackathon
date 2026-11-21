import type { SavedClip } from '../shared/clipping';

export type ShopClip = Pick<SavedClip, 'id' | 'url' | 'durationSec' | 'query' | 'roomId'>;
export const hasClipReference = (question: string) => /^look\s+in\s*\{/i.test(question.trim());
export const clipShopCommand = (clip: ShopClip) => `@shop look in {clip:${clip.id}}, `;

/** Resolve only clips already returned by this browser's private library. */
export function resolveClipQuestion(question: string, clips: ShopClip[], selectedClipId?: string) {
  if (!hasClipReference(question)) return null;
  const match = question.trim().match(/^look\s+in\s*\{([^{}]+)\}\s*[,;:]?\s*(.*)$/i);
  if (!match) throw new Error('Use @shop look in {clip:ID}, followed by your question.');
  const reference = match[1].trim();
  let clip: ShopClip | undefined;
  if (/^this clip$/i.test(reference)) {
    clip = selectedClipId ? clips.find(item => item.id === selectedClipId) : clips.length === 1 ? clips[0] : undefined;
    if (!clip) throw new Error('Choose “Shop this clip” on a saved clip first, or use its clip:ID reference.');
  } else {
    const id = reference.replace(/^clip:/i, '').trim();
    clip = clips.find(item => item.id === id);
    if (!clip) throw new Error('That clip is not in your saved clips. Choose “Shop this clip” from My Clips.');
  }
  const text = match[2].trim();
  if (!text) throw new Error('Add a question after the clip reference, such as “find me that mug”.');
  return { clip, question: text };
}

export function clipSampleTimes(durationSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error('This clip has no usable duration.');
  return [0.1, 0.5, 0.9].map(fraction => Math.max(0, Math.min(durationSec - 0.01, durationSec * fraction)));
}
