import { z } from 'zod';
import type { ToolCall } from './types.js';

/** Convert a zod schema to a JSON Schema object for tool advertisement. */
function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    // zod v4 ships a native JSON Schema converter.
    const fn = (z as unknown as { toJSONSchema?: (s: z.ZodType) => unknown })
      .toJSONSchema;
    if (typeof fn === 'function') {
      return fn(schema) as Record<string, unknown>;
    }
  } catch {
    // fall through to a permissive default
  }
  return { type: 'object', additionalProperties: true };
}

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
  /** JSON Schema of the tool arguments, derived from the zod schema. */
  parameters: Record<string, unknown>;
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
      parameters: toJsonSchema(t.schema),
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
