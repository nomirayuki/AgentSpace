import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { YukiAgent, evidence } from '../../src/yuki/agent';
import { classifyDomain } from '../../src/yuki/reasoning';

describe('reasoning.classifyDomain', () => {
  it('classifies by keywords', () => {
    expect(classifyDomain('please refactor this code and fix the api')).toBe(
      'engineering',
    );
    expect(classifyDomain('analyze the security vuln and run an audit')).toBe(
      'security',
    );
    expect(classifyDomain('what is the market support and resistance')).toBe(
      'trading',
    );
    expect(classifyDomain('hello there')).toBe('general');
  });
});

describe('YukiAgent', () => {
  it('answers a task with a full reasoning trace', async () => {
    const agent = new YukiAgent();
    const res = await agent.ask('jelaskan struktur pasar');
    expect(res.domain).toBe('trading');
    expect(res.reasoning.steps).toHaveLength(7);
    expect(res.answer.length).toBeGreaterThan(0);
  });

  it('raises confidence after learning verified knowledge', async () => {
    const agent = new YukiAgent();
    const before = (await agent.ask('refactor the build code')).reasoning
      .confidence;
    for (let i = 0; i < 3; i += 1) {
      agent.learn({
        domain: 'engineering',
        statement: 'multi-stage docker build keeps images small',
        evidence: [evidence('ci', 'image size reduced', 0.9)],
        outcome: 'success',
      });
    }
    const after = (await agent.ask('refactor the build code')).reasoning
      .confidence;
    expect(after).toBeGreaterThan(before);
  });

  it('invokes a registered tool through the brain loop', async () => {
    const agent = new YukiAgent();
    agent.tools.register({
      name: 'ping',
      description: 'returns pong',
      schema: z.object({ input: z.string() }),
      handler: () => 'pong',
    });
    const res = await agent.ask('please ping the service');
    expect(res.toolsUsed).toContain('ping');
    expect(res.answer.toLowerCase()).toContain('pong');
  });

  it('reports low confidence with no prior knowledge', async () => {
    const agent = new YukiAgent();
    const res = await agent.ask('sesuatu yang belum pernah dipelajari');
    expect(res.reasoning.needsMoreEvidence).toBe(true);
  });
});
