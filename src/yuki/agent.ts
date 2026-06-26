import { HybridMemory } from './memory.js';
import { KnowledgeBase } from './knowledge.js';
import { ToolRegistry } from './tools.js';
import { MockBrain, type LLMProvider } from './llm.js';
import {
  buildReasoningTrace,
  classifyDomain,
  type ReasoningTrace,
} from './reasoning.js';
import type {
  Domain,
  Evidence,
  ExperienceInput,
  Knowledge,
  LLMMessage,
} from './types.js';

const YUKI_SYSTEM_PROMPT = [
  'Kamu adalah YUKI, agent rekayasa otonom.',
  'Prinsip: keandalan dulu, lalu keamanan, kemudahan pemeliharaan, skalabilitas, performa.',
  'Gunakan bukti sebelum asumsi. Verifikasi sebelum menyimpulkan. Perbaiki akar masalah.',
  'Jika keyakinan rendah, cari bukti tambahan; jangan menyimpulkan prematur.',
  'Jawab dalam Bahasa Indonesia yang ringkas, jelas, dan dapat dieksekusi.',
].join(' ');

export interface YukiAgentOptions {
  brain?: LLMProvider;
  memory?: HybridMemory;
  knowledge?: KnowledgeBase;
  tools?: ToolRegistry;
  /** Max tool-execution rounds per task (loop guard). */
  maxToolRounds?: number;
}

export interface AskOptions {
  /** Override domain classification. */
  domain?: Domain;
  /** Explicit constraints to factor into reasoning. */
  constraints?: string[];
}

export interface AskResult {
  answer: string;
  domain: Domain;
  reasoning: ReasoningTrace;
  toolsUsed: string[];
  /** Knowledge entries that informed the answer. */
  usedKnowledge: Knowledge[];
}

/**
 * YukiAgent ties together the brain, memory, knowledge governance, and tools
 * into the YUKI operating loop:
 *   retrieve -> reason -> (tool calls) -> answer -> learn.
 */
export class YukiAgent {
  readonly brain: LLMProvider;
  readonly memory: HybridMemory;
  readonly knowledge: KnowledgeBase;
  readonly tools: ToolRegistry;
  private readonly maxToolRounds: number;

  constructor(opts: YukiAgentOptions = {}) {
    this.brain = opts.brain ?? new MockBrain();
    this.memory = opts.memory ?? new HybridMemory();
    this.knowledge = opts.knowledge ?? new KnowledgeBase();
    this.tools = opts.tools ?? new ToolRegistry();
    this.maxToolRounds = opts.maxToolRounds ?? 3;
  }

  /** Record a verified (or failed) experience as governed knowledge. */
  learn(input: ExperienceInput): Knowledge {
    this.memory.remember({
      domain: input.domain,
      content: input.statement,
      tags: [input.outcome],
    });
    return this.knowledge.learn(input);
  }

  /**
   * Process a task end-to-end. The reasoning trace is built from retrieved
   * knowledge; the brain produces the natural-language answer and may call
   * tools, which are validated and executed before a final answer is formed.
   */
  async ask(task: string, options: AskOptions = {}): Promise<AskResult> {
    const domain = options.domain ?? classifyDomain(task);
    const constraints = options.constraints ?? [];

    // 1. Retrieve: governed knowledge + semantic memory (domain-isolated).
    const usedKnowledge = this.knowledge.retrieve(domain);
    const memoryHits = this.memory.retrieve(task, domain);

    // 2. Reason: deterministic, inspectable trace.
    const reasoning = buildReasoningTrace({
      task,
      domain,
      constraints,
      knowledge: usedKnowledge,
      optionCount: Math.max(1, usedKnowledge.length),
    });

    // 3. Compose context for the brain.
    const contextLines: string[] = [];
    if (usedKnowledge.length) {
      contextLines.push(
        'Pengetahuan relevan:\n' +
          usedKnowledge
            .map((k) => `- [${k.status} ${k.confidence}] ${k.statement}`)
            .join('\n'),
      );
    }
    if (memoryHits.length) {
      contextLines.push(
        'Memori relevan:\n' +
          memoryHits.map((m) => `- ${m.content}`).join('\n'),
      );
    }
    if (constraints.length) {
      contextLines.push(
        'Batasan:\n' + constraints.map((c) => `- ${c}`).join('\n'),
      );
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: YUKI_SYSTEM_PROMPT },
      ...(contextLines.length
        ? [{ role: 'system' as const, content: contextLines.join('\n\n') }]
        : []),
      { role: 'user', content: task },
    ];

    // 4. Brain loop with bounded tool execution.
    const toolsUsed: string[] = [];
    let completion = await this.brain.complete(messages, this.tools.specs());

    for (let round = 0; round < this.maxToolRounds; round += 1) {
      if (completion.toolCalls.length === 0) break;

      // Record the assistant's tool-use turn so providers can reconstruct the
      // required assistant(tool_use) -> tool(result) message sequence.
      messages.push({
        role: 'assistant',
        content: completion.content,
        toolCalls: completion.toolCalls,
      });

      const results = await this.tools.executeAll(completion.toolCalls);
      for (const r of results) {
        toolsUsed.push(r.name);
        messages.push({
          role: 'tool',
          name: r.name,
          toolCallId: r.toolCallId,
          content: r.ok ? JSON.stringify(r.result) : `error: ${r.error}`,
        });
      }
      completion = await this.brain.complete(messages, this.tools.specs());
    }

    const answer = completion.content.trim() || '(tidak ada jawaban)';

    // 5. Remember the interaction for future retrieval.
    this.memory.remember({
      domain,
      content: `Q: ${task}\nA: ${answer}`,
      tags: ['qa'],
    });

    return { answer, domain, reasoning, toolsUsed, usedKnowledge };
  }
}

/** Convenience helper to build a strength-tagged evidence record. */
export function evidence(
  source: string,
  detail: string,
  strength: number,
  observedAt: number = Date.now(),
): Evidence {
  return { source, detail, strength, observedAt };
}
