import { describe, it, expect } from 'vitest';
import {
  clampConfidence,
  confidenceLevel,
  isLowConfidence,
  scoreConfidence,
} from '../../src/yuki/confidence';

describe('confidence', () => {
  it('clamps out-of-range scores', () => {
    expect(clampConfidence(-10)).toBe(0);
    expect(clampConfidence(150)).toBe(100);
    expect(clampConfidence(Number.NaN)).toBe(0);
  });

  it('maps scores to bands', () => {
    expect(confidenceLevel(95)).toBe('very_high');
    expect(confidenceLevel(80)).toBe('high');
    expect(confidenceLevel(65)).toBe('medium');
    expect(confidenceLevel(45)).toBe('low');
    expect(confidenceLevel(10)).toBe('very_low');
  });

  it('flags low confidence', () => {
    expect(isLowConfidence(30)).toBe(true);
    expect(isLowConfidence(80)).toBe(false);
  });

  it('caps a single observation below very_high', () => {
    const score = scoreConfidence({
      evidence: [{ source: 's', detail: 'd', strength: 1, observedAt: 0 }],
      successCount: 1,
      failureCount: 0,
    });
    expect(score).toBeLessThanOrEqual(89);
  });

  it('rewards repeated success and penalizes failure', () => {
    const good = scoreConfidence({
      evidence: [{ source: 's', detail: 'd', strength: 1, observedAt: 0 }],
      successCount: 4,
      failureCount: 0,
    });
    const bad = scoreConfidence({
      evidence: [{ source: 's', detail: 'd', strength: 1, observedAt: 0 }],
      successCount: 0,
      failureCount: 4,
    });
    expect(good).toBeGreaterThan(bad);
  });
});
