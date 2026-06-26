import { describe, it, expect } from 'vitest';
import { selectAgents } from '../src/selector';
import type { Agent } from '../src/types';

const agents: Agent[] = [
  { url: 'https://x/u1', name: 'a', tags: [1, 4] },
  { url: 'https://x/u2', name: 'b', tags: [2] },
  { url: 'https://x/u3', name: 'c', tags: ['1+4'] },
];

describe('selectAgents', () => {
  it('picks the agent with the most matching tags', () => {
    const chosen = selectAgents(agents, [1, 4]);
    expect(chosen.map((a) => a.name)).toEqual(['a']);
  });

  it('matches mixed number/string tags by normalized value', () => {
    const chosen = selectAgents(agents, ['1+4']);
    expect(chosen.map((a) => a.name)).toEqual(['c']);
  });

  it('returns all agents tied for the top score', () => {
    const chosen = selectAgents(agents, [2, '1+4']);
    expect(chosen.map((a) => a.name).sort()).toEqual(['b', 'c']);
  });

  it('returns an empty array when no agent matches', () => {
    expect(selectAgents(agents, [99])).toEqual([]);
  });

  it('returns an empty array when there are no required tags', () => {
    expect(selectAgents(agents, [])).toEqual([]);
  });
});
