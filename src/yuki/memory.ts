import type { ConsolidatedSummary, Domain, MemoryItem } from './types.js';

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

/** Tokenize text into a lowercase keyword set for naive semantic scoring. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+]+/i)
      .filter((t) => t.length > 1),
  );
}

/** Jaccard overlap between two keyword sets, in [0, 1]. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Hybrid memory architecture (YUKI spec section 14):
 *  - Working memory: bounded, most-recent context.
 *  - Semantic memory: long-lived items with similarity retrieval (vector-DB stub).
 *  - Consolidated memory: summaries that reference (never replace) their sources.
 *
 * Retrieval results are surfaced as candidates only; callers must validate them
 * against the current context before treating them as true.
 */
export class HybridMemory {
  private working: MemoryItem[] = [];
  private semantic: MemoryItem[] = [];
  private consolidated: ConsolidatedSummary[] = [];

  constructor(private readonly workingLimit = 20) {}

  /** Add an item to working memory and mirror it into semantic memory. */
  remember(item: Omit<MemoryItem, 'id' | 'createdAt'>): MemoryItem {
    const full: MemoryItem = {
      ...item,
      id: nextId('mem'),
      createdAt: Date.now(),
    };
    this.working.push(full);
    if (this.working.length > this.workingLimit) {
      this.working.shift();
    }
    this.semantic.push(full);
    return full;
  }

  /** Most-recent working-memory items (newest last). */
  recent(limit = this.workingLimit): MemoryItem[] {
    return this.working.slice(-limit);
  }

  /**
   * Retrieve the top-k semantic items for a query within a domain.
   * Domain isolation is enforced: only same-domain (or `general`) items match.
   */
  retrieve(query: string, domain: Domain, k = 5): MemoryItem[] {
    const q = tokenize(query);
    return this.semantic
      .filter((m) => m.domain === domain || m.domain === 'general')
      .map((m) => {
        const text = `${m.content} ${(m.tags ?? []).join(' ')}`;
        return { m, score: overlap(q, tokenize(text)) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.m);
  }

  /**
   * Consolidate several memory items into a summary. The summary keeps the
   * source ids; it augments retrieval but never replaces the originals.
   */
  consolidate(
    domain: Domain,
    summary: string,
    sourceIds: string[],
  ): ConsolidatedSummary {
    const entry: ConsolidatedSummary = {
      id: nextId('sum'),
      domain,
      summary,
      sourceIds,
      createdAt: Date.now(),
    };
    this.consolidated.push(entry);
    return entry;
  }

  summaries(domain?: Domain): ConsolidatedSummary[] {
    return domain
      ? this.consolidated.filter((s) => s.domain === domain)
      : [...this.consolidated];
  }

  /** Resolve the source items referenced by a consolidated summary. */
  sourcesOf(summaryId: string): MemoryItem[] {
    const summary = this.consolidated.find((s) => s.id === summaryId);
    if (!summary) return [];
    const ids = new Set(summary.sourceIds);
    return this.semantic.filter((m) => ids.has(m.id));
  }

  stats() {
    return {
      working: this.working.length,
      semantic: this.semantic.length,
      consolidated: this.consolidated.length,
    };
  }
}
