import type { SavedClip } from '../shared/clipping';

export type ShopClip = Pick<SavedClip, 'id' | 'url' | 'durationSec' | 'query' | 'roomId' | 'title' | 'brief'> & Partial<Pick<SavedClip, 'answers'>>;
export const hasClipReference = (question: string) =>
  /^look\s+in\b/i.test(question.trim()) || /^(?:in\s*\{|in\s+.+\bclip\b)/i.test(question.trim());

export function shopClipTitle(clip: ShopClip) {
  const category = clip.answers?.trigger_type || clip.answers?.category;
  return clip.title?.trim() || clip.brief?.title?.trim() || (category?.type === 'choice' ? category.choice : 'Highlight');
}

const normalizeTitle = (title: string) => title.normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const clipShopCommand = (clip: ShopClip) => `@shop look in ${JSON.stringify(shopClipTitle(clip))}, `;

function oneEditApart(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length] <= 1;
}

function titleScore(reference: string, title: string) {
  if (reference === title) return 1;
  if (reference.length < 3) return 0;
  if (` ${title} `.includes(` ${reference} `)) return 0.95;
  const words = [...new Set(reference.split(' '))];
  if (words.length < 2) return 0;
  const titleWords = title.split(' ');
  const coverage = words.reduce((sum, word) => sum + (titleWords.includes(word) ? 1 :
    word.length >= 5 && titleWords.some(candidate => oneEditApart(word, candidate)) ? 0.8 : 0), 0) / words.length;
  return coverage >= 0.8 ? coverage * 0.85 : 0;
}

/** Resolve names only within this browser's private library; never fall back to live on a clip command. */
export function resolveClipQuestion(question: string, clips: ShopClip[]) {
  if (!hasClipReference(question)) return null;
  const body = question.trim().replace(/^(?:look\s+)?in\s*/i, '');
  if (!body || /^(?:\{|clip:)/i.test(body)) throw new Error('Use a clip name, such as @shop look in air horn interrupts, find the mug.');
  const quoted = body.match(/^("(?:\\.|[^"\\])*")(?:\s+clip)?\s*(?:[,;:]\s*(.*))?$/i);
  const plain = body.match(/^([^,;:]+)(?:[,;:]\s*(.*))?$/);
  if (!quoted && (!plain || body.startsWith('"'))) throw new Error('Use @shop look in "clip name", followed by your question.');
  const reference = quoted ? JSON.parse(quoted[1]) as string : plain![1].trim().replace(/\s+clip$/i, '');
  const name = normalizeTitle(reference);
  if (!name) throw new Error('Enter the name of a saved clip.');
  const ranked = clips.map(clip => {
    const title = normalizeTitle(shopClipTitle(clip));
    return { clip, score: Math.max(titleScore(name, title), titleScore(name.replace(/^the /, ''), title)) };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  if (!ranked.length) throw new Error('No saved clip matches that name. Check My Clips and try a more specific title.');
  if (ranked[1] && (ranked[0].score < 1 || ranked[1].score === 1) && ranked[0].score - ranked[1].score < 0.12) {
    throw new Error(`More than one saved clip matches. Use a more specific name: ${ranked.slice(0, 3).map(item => JSON.stringify(shopClipTitle(item.clip))).join(' or ')}.`);
  }
  return { clip: ranked[0].clip, question: (quoted?.[2] ?? plain?.[2])?.trim() || 'Find products visible in this clip.' };
}

export function clipSampleTimes(durationSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error('This clip has no usable duration.');
  return [0.1, 0.5, 0.9].map(fraction => Math.max(0, Math.min(durationSec - 0.01, durationSec * fraction)));
}
