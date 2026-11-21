import type { Decisions, GenerateContentResponseUsageMetadata } from '@google/genai';

export type ClipStage = 'probe' | 'judge' | 'instant';
export type Resolution = 'low' | 'medium' | 'high';
export type ClipAnswers = Record<string, Decisions.Answer>;
export interface ClipRules { trigger: string }
export const DEFAULT_RULES: ClipRules = {
  trigger: 'Does this window contain a distinct sound effect (such as an air horn, applause, victory fanfare, or drum sting), a sudden or pronounced visual movement or gesture, a notable reaction, surprising event, impressive skill, funny moment, or useful insight worth examining as a highlight? Brief soundboard reactions and visible movement count even without speech or a complete story. Ordinary background noise and idle motion do not count.',
};
export interface ClipThresholds { trigger: number }
export const DEFAULT_THRESHOLDS: ClipThresholds = { trigger: .5 };
export interface ClipChat { name: string; text: string; offsetSec: number }
export interface ClipRequest {
  /** Original probe answers carried into full-context editing, never rescored. */
  trigger?: ClipAnswers;
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
  if (request.stage === 'probe') return false;
  if (request.query?.trim() || !request.capture || ['manual', 'voice', 'manual-flush', 'soundboard'].includes(request.capture.source)) return true;
  return qualifies(request.stage === 'judge' ? request.trigger || {} : answers, request.capture.thresholds);
}
export function probability(answers: ClipAnswers, key: string): number | null {
  const answer = answers[key];
  if (answer?.type === 'noul') return answer.noul;
  if (answer?.type === 'score') return answer.score / 4;
  return null;
}
export function qualifies(answers: ClipAnswers, thresholds: ClipThresholds): boolean {
  const value = probability(answers, 'trigger_detected');
  return value !== null && value >= thresholds.trigger;
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
