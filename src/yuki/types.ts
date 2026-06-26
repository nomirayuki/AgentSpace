/**
 * Core type definitions for the YUKI agent runtime.
 *
 * These types encode YUKI's operating model: knowledge governance, the hybrid
 * memory architecture, confidence levels, domain isolation, and the
 * function-calling (tool) contract. They are deliberately framework-agnostic
 * so the "brain" (LLM) can be swapped freely.
 */

/** Logical knowledge domains. Knowledge never crosses domains implicitly. */
export type Domain =
  | 'engineering'
  | 'security'
  | 'trading'
  | 'infrastructure'
  | 'automation'
  | 'general';

export const DOMAINS: readonly Domain[] = [
  'engineering',
  'security',
  'trading',
  'infrastructure',
  'automation',
  'general',
];

/** Confidence band labels mapped from a 0-100 score. */
export type ConfidenceLevel =
  | 'very_high'
  | 'high'
  | 'medium'
  | 'low'
  | 'very_low';

/** Lifecycle status of a knowledge entry. */
export type KnowledgeStatus =
  | 'hypothesis'
  | 'verified'
  | 'best_practice'
  | 'deprecated'
  | 'archived';

/** A single piece of supporting evidence for a knowledge entry. */
export interface Evidence {
  /** Where the evidence came from (tool name, url, test run, log, ...). */
  source: string;
  /** Human-readable detail of what was observed. */
  detail: string;
  /** Strength of the evidence in [0, 1]; stronger evidence wins conflicts. */
  strength: number;
  /** Epoch milliseconds when the evidence was observed. */
  observedAt: number;
}

/** A governed unit of knowledge. */
export interface Knowledge {
  id: string;
  domain: Domain;
  /** The claim/insight, summarized before storage. */
  statement: string;
  evidence: Evidence[];
  status: KnowledgeStatus;
  /** Confidence score in [0, 100]. */
  confidence: number;
  /** Epoch milliseconds of the most recent validation. */
  validatedAt: number;
  /** Count of independent verified successes. */
  successCount: number;
  /** Count of observed failures. */
  failureCount: number;
}

/** Input used to record an experience that may become knowledge. */
export interface ExperienceInput {
  domain: Domain;
  statement: string;
  evidence: Evidence[];
  /** Whether the experience was a verified success or a failure. */
  outcome: 'success' | 'failure';
}

/** An item held in any memory tier. */
export interface MemoryItem {
  id: string;
  domain: Domain;
  content: string;
  createdAt: number;
  /** Free-form tags used for naive semantic retrieval. */
  tags?: string[];
}

/** A consolidated summary that references its source items (never replaces them). */
export interface ConsolidatedSummary {
  id: string;
  domain: Domain;
  summary: string;
  sourceIds: string[];
  createdAt: number;
}

/** Roles in an LLM conversation. */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface LLMMessage {
  role: Role;
  content: string;
  /** Present on `tool` messages: the tool call this result answers. */
  toolCallId?: string;
  /** Present on `tool` messages: the tool that produced this result. */
  name?: string;
  /** Present on `assistant` messages that requested tool execution. */
  toolCalls?: ToolCall[];
}

/** A request from the brain to invoke a tool. */
export interface ToolCall {
  id: string;
  name: string;
  /** Raw, unvalidated arguments as produced by the brain. */
  args: unknown;
}

/** A single brain completion: free text and/or tool calls. */
export interface LLMCompletion {
  content: string;
  toolCalls: ToolCall[];
}

/** Confidence band thresholds (lower bound, inclusive). */
export interface ConfidenceBand {
  level: ConfidenceLevel;
  min: number;
}
