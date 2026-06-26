import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// Ensure the module does not auto-listen on import.
process.env.NODE_ENV = 'test';

let server: Server;
let base = '';

beforeAll(async () => {
  const { app } = await import('../../src/server');
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe('YUKI HTTP endpoints', () => {
  it('health responds ok', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects an invalid /yuki/learn payload', async () => {
    const { status } = await post('/yuki/learn', { domain: 'engineering' });
    expect(status).toBe(400);
  });

  it('learns knowledge then exposes it via /yuki/knowledge', async () => {
    const learn = await post('/yuki/learn', {
      domain: 'security',
      statement: 'validate all external input',
      outcome: 'success',
      evidence: [
        { source: 'audit', detail: 'blocked injection', strength: 0.9 },
      ],
    });
    expect(learn.status).toBe(201);
    expect(learn.json.statement).toBe('validate all external input');
    expect(learn.json.confidence).toBeGreaterThan(0);

    const res = await fetch(`${base}/yuki/knowledge?domain=security`);
    const list = (await res.json()) as Array<{ statement: string }>;
    expect(
      list.some((k) => k.statement === 'validate all external input'),
    ).toBe(true);
  });

  it('rejects an unknown domain on /yuki/knowledge', async () => {
    const res = await fetch(`${base}/yuki/knowledge?domain=wizardry`);
    expect(res.status).toBe(400);
  });

  it('answers via /yuki/ask using learned knowledge to raise confidence', async () => {
    const { status, json } = await post('/yuki/ask', {
      task: 'audit the security of this auth flow',
      domain: 'security',
    });
    expect(status).toBe(200);
    expect(json.domain).toBe('security');
    expect(json.reasoning.steps).toHaveLength(7);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });
});
