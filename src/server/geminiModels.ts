export class GeminiModelConfigError extends Error {
  readonly status = 503;
}

/** Analysis and editing never silently fall back to a previous-generation model. */
export function gemini4Model(variable: string, fallback: string, override?: string) {
  const model = (override ?? process.env[variable] ?? fallback).trim();
  if (!/^gemini-4-(hydrogen|neon|argon|carbon)(?:-[a-z0-9.-]+)?$/.test(model)) {
    throw new GeminiModelConfigError(`${variable} must name a Gemini 4 model. Update the setting and restart the server.`);
  }
  return model;
}

export const clipBriefModel = () => gemini4Model('GEMINI_CLIP_BRIEF_MODEL', 'gemini-4-hydrogen');
export const clipEditorModel = () => gemini4Model('GEMINI_CLIP_EDITOR_MODEL', 'gemini-4-neon');
export const clipReviewModel = () => gemini4Model('GEMINI_CLIP_REVIEW_MODEL', 'gemini-4-hydrogen');
