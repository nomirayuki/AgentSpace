import type { LLMCompletion, LLMMessage, ToolCall } from './types.js';
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

// ---------------------------------------------------------------------------
// Anthropic mapping (pure, unit-tested helpers)
// ---------------------------------------------------------------------------

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicBlock[];
}

/** Map tool specs to Anthropic's `tools` schema. */
export function toAnthropicTools(tools: ToolSpec[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/**
 * Translate the flat YUKI message list into Anthropic's system string plus the
 * block-structured message array. Consecutive `tool` results are merged into a
 * single `user` turn of `tool_result` blocks, as the API requires.
 */
export function toAnthropicMessages(messages: LLMMessage[]): {
  system: string;
  messages: AnthropicMessage[];
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');

  const out: AnthropicMessage[] = [];
  let pendingToolResults: AnthropicBlock[] = [];

  const flush = () => {
    if (pendingToolResults.length) {
      out.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const m of messages) {
    if (m.role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: m.toolCallId ?? '',
        content: m.content,
      });
      continue;
    }
    flush();
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      if (m.toolCalls && m.toolCalls.length) {
        const blocks: AnthropicBlock[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.args,
          });
        }
        out.push({ role: 'assistant', content: blocks });
      } else {
        out.push({ role: 'assistant', content: m.content });
      }
    }
    // system messages are folded into `system` above
  }
  flush();
  return { system, messages: out };
}

/** Parse Anthropic response content blocks into a normalized completion. */
export function parseAnthropicContent(
  blocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>,
): LLMCompletion {
  const text = blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
  const toolCalls: ToolCall[] = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id ?? '', name: b.name ?? '', args: b.input ?? {} }));
  return { content: text, toolCalls };
}

/**
 * Anthropic Messages API adapter with native tool calling. Uses the global
 * `fetch` (Node 18+), so no extra dependency is required.
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
    tools: ToolSpec[],
  ): Promise<LLMCompletion> {
    const { system, messages: mapped } = toAnthropicMessages(messages);

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
        ...(tools.length ? { tools: toAnthropicTools(tools) } : {}),
        messages: mapped,
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      content?: Parameters<typeof parseAnthropicContent>[0];
    };
    return parseAnthropicContent(data.content ?? []);
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible mapping (pure, unit-tested helpers)
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

/** Map tool specs to OpenAI's `tools` (function) schema. */
export function toOpenAITools(tools: ToolSpec[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Translate the flat YUKI message list into OpenAI chat messages. */
export function toOpenAIMessages(messages: LLMMessage[]): OpenAIMessage[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId ?? '',
        content: m.content,
      };
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

/** Parse an OpenAI chat choice into a normalized completion. */
export function parseOpenAIChoice(choice: {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
}): LLMCompletion {
  const message = choice.message ?? {};
  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((tc) => {
    let args: unknown = {};
    try {
      args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      args = { _raw: tc.function?.arguments };
    }
    return { id: tc.id ?? '', name: tc.function?.name ?? '', args };
  });
  return { content: message.content ?? '', toolCalls };
}

/**
 * OpenAI-compatible Chat Completions adapter with native tool calling. Point
 * `baseUrl` at any compatible server (vLLM, TGI, Ollama, llama.cpp) hosting a
 * model fine-tuned on the YUKI datasets; the same runtime drives it unchanged.
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
    tools: ToolSpec[],
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
        ...(tools.length ? { tools: toOpenAITools(tools) } : {}),
        messages: toOpenAIMessages(messages),
      }),
    });

    if (!res.ok) {
      throw new Error(`LLM API error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      choices?: Array<Parameters<typeof parseOpenAIChoice>[0]>;
    };
    return parseOpenAIChoice(data.choices?.[0] ?? {});
  }
}
