import type { Agent } from './types.js';
import { AgentSchema } from './types.js';

const REGISTRY: Agent[] = [
  { url: 'https://example.com/agent-a', name: 'Agent A', tags: [1, 3, 4] },
  { url: 'https://example.com/agent-b', name: 'Agent B', tags: [2] },
  { url: 'https://example.com/agent-c', name: 'Agent C', tags: ['1+4'] },
];

export function listAgents() {
  return REGISTRY;
}

export function registerAgent(agent: unknown) {
  const parsed = AgentSchema.parse(agent);
  REGISTRY.push(parsed);
  return parsed;
}
