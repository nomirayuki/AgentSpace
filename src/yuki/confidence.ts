import type { ConfidenceBand, ConfidenceLevel, Evidence } from './types.js';

/**
 * Confidence bands per YUKI spec (section 13). Ordered high -> low so the first
 * band whose `min` is satisfied is the match.
 */
export const CONFIDENCE_BANDS: readonly ConfidenceBand[] = [
  { level: 'very_high', min: 90 },
  { level: 'high', min: 75 },
  { level: 'medium', min: 60 },
  { level: 'low', min: 40 },
  { level: 'very_low', min: 0 },
];

/** Clamp a raw number into the valid confidence range [0, 100]. */
export function clampConfidence(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

/** Map a 0-100 score to its confidence band. */
export function confidenceLevel(score: number): ConfidenceLevel {
  const s = clampConfidence(score);
  for (const band of CONFIDENCE_BANDS) {
    if (s >= band.min) return band.level;
  }
  /* istanbul ignore next - unreachable: the 0 band always matches */
  return 'very_low';
}

/** True when confidence is low enough that the agent should seek more evidence. */
export function isLowConfidence(score: number): boolean {
  const level = confidenceLevel(score);
  return level === 'low' || level === 'very_low';
}

/**
 * Derive a confidence score from evidence and observed outcomes.
 *
 * The model is intentionally simple and explainable:
 *  - Base 50.
 *  - Aggregated evidence strength contributes up to +35.
 *  - Each net verified success adds weight; failures subtract.
 * A single experience can reach "high" but never "very_high" on its own,
 * matching the rule that one experience must not become a best practice.
 */
export function scoreConfidence(params: {
  evidence: Evidence[];
  successCount: number;
  failureCount: number;
}): number {
  const { evidence, successCount, failureCount } = params;

  const evidenceStrength = evidence.reduce(
    (acc, e) => acc + Math.max(0, Math.min(1, e.strength)),
    0,
  );
  // Saturating contribution from evidence (diminishing returns).
  const evidenceBoost = 35 * (1 - Math.exp(-evidenceStrength));

  const net = successCount - failureCount;
  const outcomeBoost = 6 * net;

  const raw = 50 + evidenceBoost + outcomeBoost;

  // A lone data point is capped below "very_high".
  const totalObservations = successCount + failureCount;
  const cap = totalObservations <= 1 ? 89 : 100;

  return clampConfidence(Math.min(raw, cap));
}
