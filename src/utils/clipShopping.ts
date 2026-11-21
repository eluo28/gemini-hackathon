import type { SavedClip } from '../shared/clipping';

export type ShopClip = Pick<SavedClip, 'id' | 'url' | 'durationSec' | 'query' | 'roomId' | 'title' | 'brief'>;
export const hasClipReference = (question: string) =>
  /^(?:look\s+)?in\s*\{/i.test(question.trim()) ||
  /^(?:look\s+)?in\s+.+\s+clip\b/i.test(question.trim()) ||
  /^(?:look\s+)?in\s+(?:this|that)\s+clip\b/i.test(question.trim());

const normalizeTitle = (title: string) => title.normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const clipShopCommand = (clip: ShopClip) => `@shop look in {clip:${clip.id}}, `;

/** Resolve only clips already returned by this browser's private library. */
export function resolveClipQuestion(question: string, clips: ShopClip[], selectedClipId?: string) {
  if (!hasClipReference(question)) return null;
  const idMatch = question.trim().match(/^(?:look\s+)?in\s*\{([^{}]+)\}\s*[,;:]?\s*(.*)$/i);
  const titleMatch = question.trim().match(/^(?:look\s+)?in\s+(.+?)\s+clip\s*[,;:]\s*(.*)$/i);
  const match = idMatch || titleMatch;
  if (!match) throw new Error('Use @shop in the CLIP TITLE clip, followed by your question, or choose “Shop this clip”.');
  const reference = match[1].trim();
  let clip: ShopClip | undefined;
  if (idMatch && /^this clip$/i.test(reference)) {
    clip = selectedClipId ? clips.find(item => item.id === selectedClipId) : clips.length === 1 ? clips[0] : undefined;
    if (!clip) throw new Error('Choose “Shop this clip” on a saved clip first, or use its clip:ID reference.');
  } else if (idMatch) {
    const id = reference.replace(/^clip:/i, '').trim();
    clip = clips.find(item => item.id === id);
  } else {
    // Match the displayed title exactly after punctuation/case normalization.
    // Try the literal title first so titles beginning with “The” remain valid.
    const titleOf = (item: ShopClip) => normalizeTitle(item.title?.trim() || item.brief?.title?.trim() || '');
    const title = normalizeTitle(reference);
    let matches = clips.filter(item => titleOf(item) === title);
    if (!matches.length) matches = clips.filter(item => titleOf(item) === title.replace(/^the /, ''));
    if (matches.length > 1) throw new Error('More than one saved clip has that title. Choose “Shop this clip” on the one you mean.');
    clip = matches[0];
  }
  if (!clip) throw new Error('That clip is not in your saved clips. Choose “Shop this clip” from My Clips.');
  const text = match[2].trim();
  if (!text) throw new Error('Add a question after the clip reference, such as “find me that mug”.');
  return { clip, question: text };
}

export function clipSampleTimes(durationSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error('This clip has no usable duration.');
  return [0.1, 0.5, 0.9].map(fraction => Math.max(0, Math.min(durationSec - 0.01, durationSec * fraction)));
}
