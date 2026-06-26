import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../src/yuki/tools';

function registry() {
  const r = new ToolRegistry();
  r.register({
    name: 'add',
    description: 'add two numbers',
    schema: z.object({ a: z.number(), b: z.number() }),
    handler: ({ a, b }) => a + b,
  });
  return r;
}

describe('ToolRegistry', () => {
  it('validates and executes a tool call', async () => {
    const r = registry();
    const res = await r.execute({ id: '1', name: 'add', args: { a: 2, b: 3 } });
    expect(res.ok).toBe(true);
    expect(res.result).toBe(5);
  });

  it('rejects invalid arguments before running the handler', async () => {
    const r = registry();
    const res = await r.execute({
      id: '1',
      name: 'add',
      args: { a: 'x', b: 3 },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('invalid arguments');
  });

  it('reports unknown tools', async () => {
    const r = registry();
    const res = await r.execute({ id: '1', name: 'nope', args: {} });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('unknown tool');
  });

  it('prevents duplicate registration', () => {
    const r = registry();
    expect(() =>
      r.register({
        name: 'add',
        description: 'dup',
        schema: z.object({}),
        handler: () => 0,
      }),
    ).toThrow(/already registered/);
  });

  it('captures handler errors without throwing', async () => {
    const r = new ToolRegistry();
    r.register({
      name: 'boom',
      description: 'always throws',
      schema: z.object({}),
      handler: () => {
        throw new Error('kaboom');
      },
    });
    const res = await r.execute({ id: '1', name: 'boom', args: {} });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('kaboom');
  });
});
