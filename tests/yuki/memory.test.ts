import { describe, it, expect } from 'vitest';
import { HybridMemory } from '../../src/yuki/memory';

describe('HybridMemory', () => {
  it('caps working memory at the configured limit', () => {
    const mem = new HybridMemory(3);
    for (let i = 0; i < 5; i += 1) {
      mem.remember({ domain: 'engineering', content: `item ${i}` });
    }
    expect(mem.recent().length).toBe(3);
    expect(mem.stats().semantic).toBe(5);
  });

  it('retrieves semantically similar items within the same domain', () => {
    const mem = new HybridMemory();
    mem.remember({
      domain: 'engineering',
      content: 'fix the build pipeline',
      tags: ['ci'],
    });
    mem.remember({
      domain: 'trading',
      content: 'support and resistance levels',
    });
    const hits = mem.retrieve('build pipeline failing', 'engineering');
    expect(hits.length).toBe(1);
    expect(hits[0].content).toContain('build pipeline');
  });

  it('enforces domain isolation on retrieval', () => {
    const mem = new HybridMemory();
    mem.remember({ domain: 'trading', content: 'market structure analysis' });
    expect(mem.retrieve('market structure', 'engineering')).toEqual([]);
  });

  it('keeps source references for consolidated summaries', () => {
    const mem = new HybridMemory();
    const a = mem.remember({ domain: 'security', content: 'finding A' });
    const b = mem.remember({ domain: 'security', content: 'finding B' });
    const summary = mem.consolidate('security', 'two findings', [a.id, b.id]);
    const sources = mem.sourcesOf(summary.id);
    expect(sources.map((s) => s.content).sort()).toEqual([
      'finding A',
      'finding B',
    ]);
  });
});
