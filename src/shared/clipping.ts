import type { Decisions, GenerateContentResponseUsageMetadata } from '@google/genai';

export type ClipStage = 'probe' | 'judge' | 'instant';
export type Resolution = 'low' | 'medium' | 'high';
export type ClipAnswers = Record<string, Decisions.Answer>;
export interface ClipRules { trigger: string; worthy: string; arc: string }
export const DEFAULT_RULES: ClipRules = {
  trigger: 'Does this window contain a notable reaction, surprising event, impressive skill, funny moment, or useful insight worth examining as a highlight?',
  worthy: 'Does this video contain a compelling, understandable highlight worth sharing as a short standalone clip?',
  arc: 'Does this window contain enough setup, a clear payoff, and the immediate reaction to make a complete standalone story?',
};
export interface ClipThresholds { trigger: number; worthy: number; arc: number; viral: number; hook: number }
export const DEFAULT_THRESHOLDS: ClipThresholds = { trigger: .7, worthy: .7, arc: .65, viral: .6, hook: .5 };
export interface ClipChat { name: string; text: string; offsetSec: number }
export interface ClipRequest {
  stage: ClipStage;
  query?: string;
  capture?: ClipCapture;
  resolution: Resolution;
  media: string;
  durationSec: number;
  targetSeconds: number;
  chat: ClipChat[];
  rules: ClipRules;
}
export interface ClipResult {
  triggerSource?: 'soundboard';
  brief?: ClipBrief;
  edit?: ClipEdit;
  savedClip?: SavedClip;
  selection?: 'saved' | 'below-threshold';
  answers: ClipAnswers;
  usage?: Decisions.CreateDecisionResponse['usage'];
  durationSec: number;
  sourceOffsetSec: number;
  trim: { start: number; end: number };
  media?: string;
  inspection: { request: unknown; response: Decisions.CreateDecisionResponse; elapsedMs: number; brief?: AgentInspection; editor?: AgentInspection };
}
// A completed playback is an observed app event, not a model probability.
export function soundboardTrigger(durationSec: number, sourceOffsetSec = 0): ClipResult {
  return {
    triggerSource: 'soundboard',
    answers: { trigger_detected: { type: 'noul', noul: 1, confidence: 1 } },
    durationSec, sourceOffsetSec, trim: { start: 0, end: durationSec },
    inspection: { request: { source: 'soundboard', event: 'playback-completed' }, response: {}, elapsedMs: 0 },
  };
}
export interface AgentInspection { request: unknown; response: unknown; elapsedMs: number; steps?: { agent: 'neon' | 'hydrogen-review'; inspection: AgentInspection }[] }
export interface ClipBrief {
  title: string;
  description: string;
  summary: string;
  intent: string;
  relevant: boolean;
  beats: { start: number; end: number; description: string }[];
  model: string;
  usage?: GenerateContentResponseUsageMetadata;
}
export interface ClipReview {
  start: number;
  end: number;
  reason: string;
  approved: boolean;
  feedback: string;
  model: string;
  usage?: GenerateContentResponseUsageMetadata;
}
export interface ClipEdit {
  start: number;
  end: number;
  reason: string;
  model: string;
  usage?: GenerateContentResponseUsageMetadata;
  reviews?: ClipReview[];
}
export function shouldEditClip(request: ClipRequest, answers: ClipAnswers) {
  return request.stage !== 'probe' && (!!request.query?.trim() || !request.capture ||
    ['manual', 'voice', 'manual-flush', 'soundboard'].includes(request.capture.source) || qualifies(answers, request.capture.thresholds));
}
export function probability(answers: ClipAnswers | undefined, key: string): number | null {
  const answer = answers?.[key];
  if (answer?.type === 'noul') return answer.noul;
  if (answer?.type === 'score') return answer.score / 4;
  return null;
}
export function qualifies(answers: ClipAnswers, thresholds: ClipThresholds): boolean {
  return (['worthy', 'arc', 'viral', 'hook'] as const).every(key => {
    const value = probability(answers, key);
    return value !== null && value >= thresholds[key];
  });
}

export interface ClipCapture {
  id: string;
  roomId: string;
  source: 'manual' | 'voice' | 'manual-flush' | 'soundboard' | 'auto-trigger' | 'auto-probe';
  startedAt: number;
  thresholds: ClipThresholds;
}
export interface SavedClip {
  // Optional for clips saved before descriptive annotations were introduced.
  title?: string;
  description?: string;
  query?: string;
  brief?: ClipBrief;
  edit?: ClipEdit;
  id: string;
  capturedAt: number;
  roomId: string;
  source: string;
  startedAt: number;
  durationSec: number;
  originalDurationSec: number;
  trim: { start: number; end: number };
  answers: ClipAnswers;
  usage?: ClipResult['usage'];
  bytes: number;
  url: string;
  downloadUrl: string;
}
