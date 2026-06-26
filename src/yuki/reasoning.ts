import type { ConfidenceLevel, Domain, Knowledge } from './types.js';
import { confidenceLevel } from './confidence.js';

/** One recorded step of the reasoning framework (YUKI spec section 2). */
export interface ReasoningStep {
  step:
    | 'understand_goal'
    | 'identify_constraints'
    | 'retrieve_knowledge'
    | 'evaluate_evidence'
    | 'build_options'
    | 'select_option'
    | 'verify';
  detail: string;
}

/** A full reasoning trace produced for a task. */
export interface ReasoningTrace {
  domain: Domain;
  steps: ReasoningStep[];
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  /** True when the agent should gather more evidence before concluding. */
  needsMoreEvidence: boolean;
}

const DOMAIN_KEYWORDS: Record<Exclude<Domain, 'general'>, string[]> = {
  engineering: [
    'code',
    'kode',
    'bug',
    'refactor',
    'api',
    'build',
    'test',
    'function',
  ],
  security: [
    'security',
    'keamanan',
    'vuln',
    'exploit',
    'cve',
    'audit',
    'auth',
    'ctf',
  ],
  trading: [
    'price',
    'harga',
    'market',
    'pasar',
    'support',
    'resistance',
    'trade',
    'candle',
  ],
  infrastructure: [
    'docker',
    'kube',
    'deploy',
    'server',
    'infra',
    'ci',
    'cd',
    'network',
  ],
  automation: [
    'automation',
    'otomasi',
    'workflow',
    'pipeline',
    'cron',
    'schedule',
    'script',
  ],
};

/** Classify a task into a domain via keyword heuristics (defaults to general). */
export function classifyDomain(task: string): Domain {
  const t = task.toLowerCase();
  let best: Domain = 'general';
  let bestScore = 0;
  for (const [domain, words] of Object.entries(DOMAIN_KEYWORDS)) {
    const score = words.reduce((acc, w) => acc + (t.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = domain as Domain;
    }
  }
  return best;
}

/**
 * Aggregate confidence for a task from the retrieved knowledge. With no prior
 * knowledge, confidence is low by design — the agent should seek evidence
 * before concluding (YUKI spec section 13).
 */
export function aggregateConfidence(knowledge: Knowledge[]): number {
  if (knowledge.length === 0) return 35; // very_low: no verified basis yet
  // Weight toward the strongest entry while rewarding corroboration.
  const top = Math.max(...knowledge.map((k) => k.confidence));
  const corroboration = Math.min(10, (knowledge.length - 1) * 3);
  return Math.min(100, top + corroboration);
}

/**
 * Build the reasoning trace for a task following the seven-step framework.
 * Pure and deterministic, so it is fully testable.
 */
export function buildReasoningTrace(params: {
  task: string;
  domain: Domain;
  constraints: string[];
  knowledge: Knowledge[];
  optionCount: number;
}): ReasoningTrace {
  const { task, domain, constraints, knowledge, optionCount } = params;
  const confidence = aggregateConfidence(knowledge);
  const level = confidenceLevel(confidence);
  const needsMoreEvidence = level === 'low' || level === 'very_low';

  const steps: ReasoningStep[] = [
    { step: 'understand_goal', detail: `Tujuan: ${task}` },
    {
      step: 'identify_constraints',
      detail: constraints.length
        ? constraints.join('; ')
        : 'tidak ada batasan eksplisit',
    },
    {
      step: 'retrieve_knowledge',
      detail: `${knowledge.length} pengetahuan domain "${domain}" diambil`,
    },
    {
      step: 'evaluate_evidence',
      detail: `confidence ${confidence} (${level})`,
    },
    { step: 'build_options', detail: `${optionCount} opsi dipertimbangkan` },
    {
      step: 'select_option',
      detail: needsMoreEvidence
        ? 'keyakinan rendah: cari bukti tambahan sebelum menyimpulkan'
        : 'opsi terbaik dipilih berdasarkan bukti terkuat',
    },
    {
      step: 'verify',
      detail: needsMoreEvidence
        ? 'verifikasi tertunda hingga bukti cukup'
        : 'hasil diverifikasi terhadap konteks saat ini',
    },
  ];

  return {
    domain,
    steps,
    confidence,
    confidenceLevel: level,
    needsMoreEvidence,
  };
}
