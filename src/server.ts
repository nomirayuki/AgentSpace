import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { z } from 'zod';
import { TaskSchema } from './types.js';
import { listAgents, registerAgent } from './registry.js';
import { selectAgents } from './selector.js';
import { scoreTag } from './wasm.js';
import { YukiAgent, createBrainFromEnv } from './yuki/index.js';

const app = express();

// Limit request body size to mitigate memory-exhaustion DoS.
app.use(express.json({ limit: '100kb' }));

// A single YUKI agent instance. The brain is selected from the environment:
// ANTHROPIC_API_KEY -> Claude, LLM_BASE_URL -> self-hosted model, else MockBrain.
const yuki = new YukiAgent({ brain: createBrainFromEnv() });
console.log(`YUKI brain: ${yuki.brain.name}`);
// Expose the WASM tag scorer as a callable tool for the agent.
yuki.tools.register({
  name: 'score_tag',
  description: 'Skor relevansi sebuah tag numerik via plugin WASM.',
  schema: z.object({ tag: z.coerce.number() }),
  handler: async ({ tag }) => ({ tag, score: await scoreTag(tag) }),
});

const DomainEnum = z.enum([
  'engineering',
  'security',
  'trading',
  'infrastructure',
  'automation',
  'general',
]);

const AskSchema = z.object({
  task: z.string().min(1),
  domain: DomainEnum.optional(),
  constraints: z.array(z.string()).optional(),
});

const LearnSchema = z.object({
  domain: DomainEnum,
  statement: z.string().min(1),
  outcome: z.enum(['success', 'failure']),
  evidence: z
    .array(
      z.object({
        source: z.string().min(1),
        detail: z.string().default(''),
        strength: z.number().min(0).max(1),
        observedAt: z.number().optional(),
      }),
    )
    .default([]),
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.post('/agents', (req: Request, res: Response) => {
  try {
    const agent = registerAgent(req.body);
    res.status(201).json(agent);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

app.get('/agents', (_req: Request, res: Response) => {
  res.json(listAgents());
});

app.post('/run', (req: Request, res: Response) => {
  const parsed = TaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.format() });
    return;
  }
  const chosen = selectAgents(listAgents(), parsed.data.needTags);
  res.json({ chosen, note: 'stub: call chosen agent URLs here' });
});

app.post('/score', async (req: Request, res: Response) => {
  try {
    const { tag } = req.body ?? {};
    const numericTag = Number(tag);
    if (typeof tag === 'undefined' || Number.isNaN(numericTag)) {
      res.status(400).json({ error: 'tag is required and must be a number' });
      return;
    }
    const score = await scoreTag(numericTag);
    res.json({ tag: numericTag, score });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.post('/yuki/ask', async (req: Request, res: Response) => {
  const parsed = AskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.format() });
    return;
  }
  try {
    const { task, domain, constraints } = parsed.data;
    const result = await yuki.ask(task, { domain, constraints });
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// Record a verified (or failed) experience as governed knowledge.
app.post('/yuki/learn', (req: Request, res: Response) => {
  const parsed = LearnSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.format() });
    return;
  }
  const { domain, statement, outcome, evidence } = parsed.data;
  const knowledge = yuki.learn({
    domain,
    statement,
    outcome,
    evidence: evidence.map((e) => ({
      ...e,
      observedAt: e.observedAt ?? Date.now(),
    })),
  });
  res.status(201).json(knowledge);
});

// Inspect governed knowledge, optionally filtered by domain.
app.get('/yuki/knowledge', (req: Request, res: Response) => {
  const domain = req.query.domain;
  if (typeof domain === 'string') {
    const parsed = DomainEnum.safeParse(domain);
    if (!parsed.success) {
      res.status(400).json({ error: `invalid domain: ${domain}` });
      return;
    }
    res.json(yuki.knowledge.retrieve(parsed.data));
    return;
  }
  res.json(yuki.knowledge.all());
});

// 404 for unknown routes.
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not found' });
});

// Centralized error handler (e.g. malformed JSON, oversized bodies).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : 'internal server error';
  res.status(400).json({ error: msg });
});

const PORT = Number(process.env.PORT) || 3000;

// Only start listening when run directly, not when imported (e.g. in tests).
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`AgentSpace running on :${PORT}`));
}

export { app };
