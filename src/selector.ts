import type { Agent } from './types.js';

/** Compare tags by normalizing to string (works for number|string). */
const hasTag = (a: Agent, t: number | string) =>
  a.tags.some((tag) => String(tag) === String(t));

/** Pick agents with the most matching tags. */
export function selectAgents(
  agents: Agent[],
  needTags: Array<number | string>,
) {
  const score = (a: Agent): number =>
    needTags.reduce<number>(
      (acc: number, t: number | string) => acc + (hasTag(a, t) ? 1 : 0),
      0,
    );

  const withScore = agents.map((a) => ({ a, s: score(a) }));
  const max = Math.max(0, ...withScore.map((x) => x.s));
  return withScore.filter((x) => x.s === max && max > 0).map((x) => x.a);
}
