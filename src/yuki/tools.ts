import { z } from 'zod';
import type { ToolCall } from './types.js';

/** A registered, function-callable tool. */
export interface Tool<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  /** Zod schema used to validate arguments produced by the brain. */
  schema: z.ZodType<TArgs>;
  /** Executes the tool with already-validated arguments. */
  handler: (args: TArgs) => Promise<TResult> | TResult;
}

/** Outcome of executing a single tool call. */
export interface ToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  /** Present when ok === true. */
  result?: unknown;
  /** Present when ok === false. */
  error?: string;
}

/** A serializable description of a tool, suitable for sending to the brain. */
export interface ToolSpec {
  name: string;
  description: string;
}

/**
 * Registry for the agent's tools (function-calling). Arguments are always
 * validated with the tool's schema before the handler runs — defense in depth
 * against malformed or unsafe model output.
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register<TArgs, TResult>(tool: Tool<TArgs, TResult>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as unknown as Tool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Specs for all tools, used to inform the brain what it may call. */
  specs(): ToolSpec[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
    }));
  }

  /** Validate and execute a single tool call, never throwing on failure. */
  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        toolCallId: call.id,
        name: call.name,
        ok: false,
        error: `unknown tool: ${call.name}`,
      };
    }

    const parsed = tool.schema.safeParse(call.args);
    if (!parsed.success) {
      return {
        toolCallId: call.id,
        name: call.name,
        ok: false,
        error: `invalid arguments: ${parsed.error.message}`,
      };
    }

    try {
      const result = await tool.handler(parsed.data);
      return { toolCallId: call.id, name: call.name, ok: true, result };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      return { toolCallId: call.id, name: call.name, ok: false, error };
    }
  }

  /** Execute many calls sequentially, preserving order. */
  async executeAll(calls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      results.push(await this.execute(call));
    }
    return results;
  }
}
