import {
  AnthropicProvider,
  MockBrain,
  OpenAICompatibleProvider,
  type LLMProvider,
} from './llm.js';

/** Environment inputs that select and configure the brain. */
export interface BrainEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  [key: string]: string | undefined;
}

/**
 * Select a brain from the environment, preferring an explicitly configured
 * provider and falling back to the offline {@link MockBrain}:
 *
 *  1. `ANTHROPIC_API_KEY`            -> {@link AnthropicProvider}
 *  2. `LLM_BASE_URL` (+ optional key) -> {@link OpenAICompatibleProvider}
 *  3. otherwise                      -> {@link MockBrain}
 *
 * This keeps secrets in the environment (never hardcoded) and lets the same
 * runtime target Claude or a self-hosted fine-tuned model without code changes.
 */
export function createBrainFromEnv(env: BrainEnv = process.env): LLMProvider {
  if (env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL ?? 'claude-opus-4-6',
    });
  }

  if (env.LLM_BASE_URL) {
    return new OpenAICompatibleProvider({
      apiKey: env.LLM_API_KEY ?? '',
      model: env.LLM_MODEL ?? 'yuki-sft',
      baseUrl: env.LLM_BASE_URL,
    });
  }

  return new MockBrain();
}
