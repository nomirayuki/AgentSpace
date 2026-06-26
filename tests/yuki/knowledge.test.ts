import { describe, it, expect } from 'vitest';
import { KnowledgeBase } from '../../src/yuki/knowledge';
import type { Evidence } from '../../src/yuki/types';

const ev = (strength: number): Evidence => ({
  source: 'test',
  detail: 'observed',
  strength,
  observedAt: Date.now(),
});

describe('KnowledgeBase governance', () => {
  it('keeps a single success as verified, not best practice', () => {
    const kb = new KnowledgeBase();
    const k = kb.learn({
      domain: 'engineering',
      statement: 'use multi-stage docker builds',
      evidence: [ev(0.8)],
      outcome: 'success',
    });
    expect(k.status).toBe('verified');
  });

  it('promotes to best practice only after repeated success', () => {
    const kb = new KnowledgeBase();
    let k = kb.learn({
      domain: 'engineering',
      statement: 'pin dependency versions',
      evidence: [ev(0.6)],
      outcome: 'success',
    });
    for (let i = 0; i < 2; i += 1) {
      k = kb.learn({
        domain: 'engineering',
        statement: 'pin dependency versions',
        evidence: [ev(0.6)],
        outcome: 'success',
      });
    }
    expect(k.successCount).toBe(3);
    expect(k.status).toBe('best_practice');
  });

  it('deprecates knowledge after repeated failure', () => {
    const kb = new KnowledgeBase();
    kb.learn({
      domain: 'security',
      statement: 'trust client input',
      evidence: [ev(0.3)],
      outcome: 'failure',
    });
    const k = kb.learn({
      domain: 'security',
      statement: 'trust client input',
      evidence: [ev(0.3)],
      outcome: 'failure',
    });
    expect(k.status).toBe('deprecated');
  });

  it('enforces domain isolation on retrieval', () => {
    const kb = new KnowledgeBase();
    kb.learn({
      domain: 'trading',
      statement: 'respect market structure',
      evidence: [ev(0.9)],
      outcome: 'success',
    });
    expect(kb.retrieve('engineering')).toEqual([]);
    expect(kb.retrieve('trading').length).toBe(1);
  });

  it('resolves conflicts in favor of stronger evidence', () => {
    const kb = new KnowledgeBase();
    const weak = kb.learn({
      domain: 'engineering',
      statement: 'A',
      evidence: [ev(0.2)],
      outcome: 'success',
    });
    const strong = kb.learn({
      domain: 'engineering',
      statement: 'B',
      evidence: [ev(0.95)],
      outcome: 'success',
    });
    expect(kb.resolveConflict(weak, strong).id).toBe(strong.id);
  });

  it('archives obsolete knowledge and lowers its confidence', () => {
    const kb = new KnowledgeBase();
    const k = kb.learn({
      domain: 'engineering',
      statement: 'old',
      evidence: [ev(0.5)],
      outcome: 'success',
    });
    const before = k.confidence;
    expect(kb.archive(k.id)).toBe(true);
    expect(kb.get(k.id)?.status).toBe('archived');
    expect(kb.get(k.id)?.confidence).toBeLessThan(before);
    expect(kb.retrieve('engineering')).toEqual([]);
  });
});
