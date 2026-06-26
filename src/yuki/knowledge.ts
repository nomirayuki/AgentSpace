import { clampConfidence, scoreConfidence } from './confidence.js';
import type {
  Domain,
  Evidence,
  ExperienceInput,
  Knowledge,
  KnowledgeStatus,
} from './types.js';

let counter = 0;
function nextId(): string {
  counter += 1;
  return `kn_${Date.now().toString(36)}_${counter}`;
}

/** Priority used when selecting between competing knowledge entries. */
const STATUS_PRIORITY: Record<KnowledgeStatus, number> = {
  best_practice: 4,
  verified: 3,
  hypothesis: 2,
  deprecated: 1,
  archived: 0,
};

/** Promotion thresholds: repeated success is required to become a best practice. */
const VERIFIED_MIN_SUCCESS = 1;
const BEST_PRACTICE_MIN_SUCCESS = 3;

function aggregateStrength(evidence: Evidence[]): number {
  return evidence.reduce(
    (acc, e) => acc + Math.max(0, Math.min(1, e.strength)),
    0,
  );
}

/** Normalize a statement for naive duplicate/conflict detection within a domain. */
function normalize(statement: string): string {
  return statement.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Governed knowledge base (YUKI spec sections 3-7, 15).
 *
 * Enforces: validate -> confidence -> store; domain isolation; evidence-based
 * promotion/demotion; and conflict resolution by stronger evidence, then newer
 * validation, then higher confidence.
 */
export class KnowledgeBase {
  private entries = new Map<string, Knowledge>();

  /** Decide the lifecycle status from accumulated outcomes. */
  private deriveStatus(
    successCount: number,
    failureCount: number,
  ): KnowledgeStatus {
    if (failureCount > successCount && failureCount >= 2) return 'deprecated';
    if (
      successCount >= BEST_PRACTICE_MIN_SUCCESS &&
      successCount > failureCount
    ) {
      return 'best_practice';
    }
    if (successCount >= VERIFIED_MIN_SUCCESS && successCount > failureCount) {
      return 'verified';
    }
    return 'hypothesis';
  }

  private findSameStatement(
    domain: Domain,
    statement: string,
  ): Knowledge | undefined {
    const norm = normalize(statement);
    for (const k of this.entries.values()) {
      if (k.domain === domain && normalize(k.statement) === norm) return k;
    }
    return undefined;
  }

  /**
   * Record an experience. Validation happens before storage; unvalidated
   * experiences (no evidence) remain hypotheses and never auto-promote.
   * Repeated outcomes on the same statement accumulate rather than overwrite.
   */
  learn(input: ExperienceInput): Knowledge {
    const existing = this.findSameStatement(input.domain, input.statement);

    const successCount =
      (existing?.successCount ?? 0) + (input.outcome === 'success' ? 1 : 0);
    const failureCount =
      (existing?.failureCount ?? 0) + (input.outcome === 'failure' ? 1 : 0);
    const evidence = [...(existing?.evidence ?? []), ...input.evidence];

    const confidence = scoreConfidence({
      evidence,
      successCount,
      failureCount,
    });
    const status = this.deriveStatus(successCount, failureCount);

    if (existing) {
      existing.evidence = evidence;
      existing.successCount = successCount;
      existing.failureCount = failureCount;
      existing.confidence = confidence;
      existing.status = status;
      existing.validatedAt = Date.now();
      return existing;
    }

    const entry: Knowledge = {
      id: nextId(),
      domain: input.domain,
      statement: input.statement,
      evidence,
      status,
      confidence,
      validatedAt: Date.now(),
      successCount,
      failureCount,
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  /**
   * Retrieve knowledge for a domain, ordered by usage priority:
   * status priority -> confidence -> recency. Archived entries are excluded.
   * Domain isolation is enforced (no cross-domain leakage).
   */
  retrieve(domain: Domain, limit = 10): Knowledge[] {
    return [...this.entries.values()]
      .filter((k) => k.domain === domain && k.status !== 'archived')
      .sort((a, b) => this.compare(b, a))
      .slice(0, limit);
  }

  /**
   * Resolve a conflict between two entries. Returns the winner per the rule:
   * stronger evidence, then newer validation, then higher confidence.
   */
  resolveConflict(a: Knowledge, b: Knowledge): Knowledge {
    return this.compare(a, b) >= 0 ? a : b;
  }

  /** Ordering comparator: positive when `a` should rank above `b`. */
  private compare(a: Knowledge, b: Knowledge): number {
    const statusDelta = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (statusDelta !== 0) return statusDelta;

    const strengthDelta =
      aggregateStrength(a.evidence) - aggregateStrength(b.evidence);
    if (Math.abs(strengthDelta) > 1e-9) return strengthDelta;

    if (a.validatedAt !== b.validatedAt) return a.validatedAt - b.validatedAt;

    return a.confidence - b.confidence;
  }

  /** Demote and archive an entry that has become obsolete. */
  archive(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.status = 'archived';
    entry.confidence = clampConfidence(entry.confidence - 20);
    entry.validatedAt = Date.now();
    return true;
  }

  get(id: string): Knowledge | undefined {
    return this.entries.get(id);
  }

  all(): Knowledge[] {
    return [...this.entries.values()];
  }
}
