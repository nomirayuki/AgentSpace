import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  MockBrain,
  parseAnthropicContent,
  parseOpenAIChoice,
  toAnthropicMessages,
  toAnthropicTools,
  toOpenAIMessages,
  toOpenAITools,
} from '../../src/yuki/llm';
import { ToolRegistry } from '../../src/yuki/tools';
import type { LLMMessage } from '../../src/yuki/types';

const specs = [
  { name: 'add', description: 'add', parameters: { type: 'object' } },
];

const conversation: LLMMessage[] = [
  { role: 'system', content: 'be helpful' },
  { role: 'user', content: 'ping it' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'c1', name: 'ping', args: { input: 'ping it' } }],
  },
  { role: 'tool', name: 'ping', toolCallId: 'c1', content: '"pong"' },
];

describe('Anthropic mapping', () => {
  it('maps tool specs to input_schema', () => {
    expect(toAnthropicTools(specs)).toEqual([
      { name: 'add', description: 'add', input_schema: { type: 'object' } },
    ]);
  });

  it('folds system and builds tool_use / tool_result blocks', () => {
    const { system, messages } = toAnthropicMessages(conversation);
    expect(system).toBe('be helpful');
    // user, assistant(tool_use), user(tool_result)
    expect(messages).toHaveLength(3);
    expect(messages[1].role).toBe('assistant');
    expect(Array.isArray(messages[1].content)).toBe(true);
    const block = (messages[1].content as Array<{ type: string }>)[0];
    expect(block.type).toBe('tool_use');
    const result = (messages[2].content as Array<{ type: string }>)[0];
    expect(result.type).toBe('tool_result');
  });

  it('parses text and tool_use blocks from a response', () => {
    const completion = parseAnthropicContent([
      { type: 'text', text: 'hello ' },
      { type: 'tool_use', id: 'x', name: 'score_tag', input: { tag: 3 } },
    ]);
    expect(completion.content).toBe('hello ');
    expect(completion.toolCalls).toEqual([
      { id: 'x', name: 'score_tag', args: { tag: 3 } },
    ]);
  });
});

describe('OpenAI-compatible mapping', () => {
  it('maps tool specs to function schema', () => {
    expect(toOpenAITools(specs)[0]).toEqual({
      type: 'function',
      function: {
        name: 'add',
        description: 'add',
        parameters: { type: 'object' },
      },
    });
  });

  it('maps assistant tool calls and tool results', () => {
    const mapped = toOpenAIMessages(conversation);
    const assistant = mapped[2];
    expect(assistant.tool_calls?.[0].function.name).toBe('ping');
    expect(assistant.tool_calls?.[0].function.arguments).toContain('input');
    const toolMsg = mapped[3];
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.tool_call_id).toBe('c1');
  });

  it('parses tool_calls with JSON arguments', () => {
    const completion = parseOpenAIChoice({
      message: {
        content: 'done',
        tool_calls: [
          { id: 'a', function: { name: 'add', arguments: '{"a":1,"b":2}' } },
        ],
      },
    });
    expect(completion.content).toBe('done');
    expect(completion.toolCalls[0]).toEqual({
      id: 'a',
      name: 'add',
      args: { a: 1, b: 2 },
    });
  });

  it('tolerates malformed tool arguments without throwing', () => {
    const completion = parseOpenAIChoice({
      message: {
        tool_calls: [{ id: 'a', function: { name: 'x', arguments: '{bad' } }],
      },
    });
    expect(completion.toolCalls[0].name).toBe('x');
    expect(completion.toolCalls[0].args).toHaveProperty('_raw');
  });
});

describe('ToolRegistry.specs JSON schema', () => {
  it('derives a JSON schema with properties from the zod schema', () => {
    const r = new ToolRegistry();
    r.register({
      name: 'add',
      description: 'add two numbers',
      schema: z.object({ a: z.number(), b: z.number() }),
      handler: ({ a, b }) => a + b,
    });
    const spec = r.specs()[0];
    expect(spec.name).toBe('add');
    expect(spec.parameters).toMatchObject({ type: 'object' });
    expect(spec.parameters).toHaveProperty('properties');
  });
});

describe('MockBrain still drives the loop', () => {
  it('requests a tool whose name is mentioned', async () => {
    const brain = new MockBrain();
    const completion = await brain.complete(
      [{ role: 'user', content: 'please ping now' }],
      [{ name: 'ping', description: 'p', parameters: { type: 'object' } }],
    );
    expect(completion.toolCalls[0]?.name).toBe('ping');
  });
});
