import { describe, it, expect } from 'vitest';
import { createBrainFromEnv } from '../../src/yuki/brain';

describe('createBrainFromEnv', () => {
  it('defaults to the offline MockBrain', () => {
    expect(createBrainFromEnv({}).name).toBe('mock');
  });

  it('selects Anthropic when an API key is present', () => {
    expect(createBrainFromEnv({ ANTHROPIC_API_KEY: 'sk-test' }).name).toBe(
      'anthropic',
    );
  });

  it('selects an OpenAI-compatible provider when a base URL is set', () => {
    const brain = createBrainFromEnv({ LLM_BASE_URL: 'http://localhost:8000' });
    expect(brain.name).toBe('openai-compatible');
  });

  it('prefers Anthropic over a self-hosted base URL', () => {
    const brain = createBrainFromEnv({
      ANTHROPIC_API_KEY: 'sk-test',
      LLM_BASE_URL: 'http://localhost:8000',
    });
    expect(brain.name).toBe('anthropic');
  });
});
