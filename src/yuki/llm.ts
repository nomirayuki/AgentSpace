import type { LLMCompletion, LLMMessage } from './types.js';
import type { ToolSpec } from './tools.js';

/**
 * The "brain" contract. YUKI is model-agnostic: any provider implementing this
 * interface can drive the agent — a deterministic mock, Anthropic Claude, or a
 * self-hosted model fine-tuned on the reasoning/SWE/tool-use datasets.
 */
export interface LLMProvider {
  readonly name: string;
  complete(messages: LLMMessage[], tools: ToolSpec[]): Promise<LLMCompletion>;
}

/**
 * Offline, deterministic brain for local development and tests. It performs no
 * network I/O and emits simple, inspectable behavior:
 *  - If a tool whose name appears in the latest user message is registered,
 *    it requests that tool with the message text as `input`.
 *  - Otherwise it echoes a concise acknowledgement.
 * This lets the full agent loop run and be tested without API keys.
 */
export class MockBrain implements LLMProvider {
  readonly name = 'mock';

  async complete(
    messages: LLMMessage[],
    tools: ToolSpec[],
  ): Promise<LLMCompletion> {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const text = lastUser?.content ?? '';

    // If a prior tool result is present, synthesize a final answer from it.
    const toolMsg = [...messages].reverse().find((m) => m.role === 'tool');
    if (toolMsg) {
      return {
        content: `Berdasarkan hasil tool (${toolMsg.name}): ${toolMsg.content}`,
        toolCalls: [],
      };
    }

    const requested = tools.find((t) =>
      text.toLowerCase().includes(t.name.toLowerCase()),
    );
    if (requested) {
      return {
        content: '',
        toolCalls: [
          {
            id: `call_${requested.name}`,
            name: requested.name,
            args: { input: text },
          },
        ],
      };
    }

    return { content: `Diterima: ${text}`.trim(), toolCalls: [] };
  }
}

/** Shared options for HTTP-backed providers. */
export interface HttpProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Upper bound on generated tokens. */
  maxTokens?: number;
}

/**
 * Anthropic Messages API adapter. Uses the global `fetch` (Node 18+), so no
 * extra dependency is required. Tool-calling wiring is intentionally minimal;
 * extend `complete` to map Anthropic `tool_use` blocks to {@link ToolCall}s.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private readonly baseUrl: string;
  private readonly maxTokens: number;

  constructor(private readonly opts: HttpProviderOptions) {
    if (!opts.apiKey) throw new Error('AnthropicProvider requires an apiKey');
    this.baseUrl = opts.baseUrl ?? 'https://api.anthropic.com';
    this.maxTokens = opts.maxTokens ?? 1024;
  }

  async complete(
    messages: LLMMessage[],
    _tools: ToolSpec[],
  ): Promise<LLMCompletion> {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const turns = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.opts.model,
        max_tokens: this.maxTokens,
        ...(system ? { system } : {}),
        messages: turns,
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const content = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');

    return { content, toolCalls: [] };
  }
}

/**
 * OpenAI-compatible Chat Completions adapter. Point `baseUrl` at any compatible
 * server (vLLM, TGI, Ollama, llama.cpp) hosting a model fine-tuned on the YUKI
 * datasets, and the same agent runtime drives it unchanged.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = 'openai-compatible';
  private readonly baseUrl: string;
  private readonly maxTokens: number;

  constructor(private readonly opts: HttpProviderOptions) {
    this.baseUrl = opts.baseUrl ?? 'https://api.openai.com';
    this.maxTokens = opts.maxTokens ?? 1024;
  }

  async complete(
    messages: LLMMessage[],
    _tools: ToolSpec[],
  ): Promise<LLMCompletion> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.opts.apiKey
          ? { authorization: `Bearer ${this.opts.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: this.opts.model,
        max_tokens: this.maxTokens,
        messages: messages
          .filter((m) => m.role !== 'tool')
          .map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      throw new Error(`LLM API error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    return { content, toolCalls: [] };
  }
}
