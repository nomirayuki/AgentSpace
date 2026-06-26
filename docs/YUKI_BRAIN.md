# YUKI — Brain & Training Pipeline

This document explains how the **YUKI runtime** (in `src/yuki/`) connects to its
**brain** (the LLM), and how the five datasets requested are used to _fine-tune_
that brain. It is written to be honest about boundaries: the runtime here is
real, runnable, and tested; the model training is a documented recipe that runs
on separate GPU infrastructure, not inside this repository.

## 1. Architecture: runtime vs. brain

YUKI is deliberately **model-agnostic**. The runtime owns reasoning structure,
memory, knowledge governance, confidence, domain isolation, and tool execution.
The brain only has to satisfy one interface (`LLMProvider` in `src/yuki/llm.ts`):

```
ask(task) ─► retrieve (knowledge + memory, domain-isolated)
          ─► reason   (7-step trace, confidence scoring)
          ─► brain.complete(messages, tools)   ◄── the "brain"
          ─► validate + execute tool calls (zod)
          ─► answer + learn (governed knowledge)
```

Three brains ship out of the box:

| Provider                   | File     | Use                                                       |
| -------------------------- | -------- | --------------------------------------------------------- |
| `MockBrain`                | `llm.ts` | Offline, deterministic — local dev & tests, no API key    |
| `AnthropicProvider`        | `llm.ts` | Claude (e.g. Opus) via the Messages API                   |
| `OpenAICompatibleProvider` | `llm.ts` | Any vLLM/TGI/Ollama server hosting a **fine-tuned** model |

The fine-tuned YUKI brain is served behind the OpenAI-compatible endpoint, so the
exact same runtime drives it with zero code changes.

## 2. The five datasets and their role

Each dataset maps to a specific capability YUKI's spec demands. All are used for
**supervised fine-tuning (SFT)** of an open-weights base model; none replaces the
runtime's governance logic.

| #   | Dataset                                                                                                         | Capability it trains                                                    | YUKI principle served                      |
| --- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| 1   | [claude-opus reasoning 8.7k](https://huggingface.co/datasets/angrygiraffe/claude-opus-4.6-4.7-reasoning-8.7k)   | Long-form `<think>` reasoning over coding/math/devops, role-conditioned | Reasoning framework (§2), evidence-first   |
| 2   | [SWE-bench Verified](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified)                              | Real GitHub issue → patch, human-validated                              | Root-cause fixes (§11), production-ready   |
| 3   | [ToolACE](https://huggingface.co/datasets/Team-ACE/ToolACE)                                                     | Multi-turn function composition incl. "no valid tool" cases             | Tool calling (§9), safe abstention         |
| 4   | [xLAM function-calling 60k](https://huggingface.co/datasets/Salesforce/xlam-function-calling-60k)               | Execution-verified query→tool→answer JSON                               | Function-calling reliability               |
| 5   | [SWE-rebench OpenHands trajectories](https://huggingface.co/datasets/nebius/SWE-rebench-openhands-trajectories) | Full agent rollouts (plan→act→observe)                                  | Feedback cycle (§17), failure intelligence |

Notes verified from the dataset cards (rephrased for licensing compliance):

- The reasoning set contains chat-format samples with explicit thinking blocks
  across ~28 categories and two Opus model versions.
- xLAM was produced by the APIGen pipeline with three verification stages
  (format, real execution, semantic), reporting >95% human-judged correctness.
  Access requires accepting its license and citing APIGen.
- ToolACE provides ~11k system/conversation samples where the assistant emits
  bracketed tool calls and must flag when no function fits.

> Content was rephrased for compliance with licensing restrictions.

## 3. Capability → dataset → runtime mapping

- **Reasoning quality** (dataset 1) → backs the brain that fills the 7-step trace
  built deterministically in `reasoning.ts`. The runtime keeps the trace
  honest; the brain supplies the prose.
- **Engineering fixes** (datasets 2, 5) → the brain proposes patches; YUKI's
  `KnowledgeBase` only promotes an approach to _best practice_ after **repeated**
  verified success, never from a single trajectory.
- **Tool use** (datasets 3, 4) → the brain emits tool calls; `ToolRegistry`
  re-validates every argument with zod before execution (defense in depth), so a
  hallucinated call cannot reach a handler.

## 4. Training recipe (runs off this repo, on GPU infra)

1. **Base model**: pick an open-weights model with a permissive license and a
   tool-use chat template (e.g. a Qwen2.5/Llama-3.x instruct variant).
2. **Normalize** every dataset to one chat schema: `messages[] = {role, content}`
   plus an optional `tools[]` spec and `tool_calls[]`. Map ToolACE's
   `from/value` and xLAM's `query/tools/answers` into this schema.
3. **Mixture** (suggested SFT weights): reasoning 25% · SWE-bench 15% ·
   OpenHands trajectories 20% · xLAM 25% · ToolACE 15%. Tune by eval.
4. **Fine-tune**: LoRA/QLoRA SFT; keep `<think>` blocks so reasoning transfers.
5. **Evaluate**: SWE-bench Verified resolved-rate, Berkeley Function-Calling
   Leaderboard for tool accuracy, plus a held-out reasoning split.
6. **Serve**: deploy behind an OpenAI-compatible server and point
   `OpenAICompatibleProvider.baseUrl` at it.

## 5. Why training is not done here

Fine-tuning needs accelerators, large dataset downloads (xLAM is gated), and
hours of compute — outside this sandbox's scope. What this repo delivers is the
**production-ready agent runtime** the brain plugs into, fully tested with the
offline `MockBrain` so the whole loop is verifiable today.

## 6. Wiring a real brain

```ts
import { YukiAgent, AnthropicProvider } from './yuki/index.js';

const agent = new YukiAgent({
  brain: new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-opus-4-6',
  }),
});

// or a self-hosted fine-tuned model:
// brain: new OpenAICompatibleProvider({
//   apiKey: process.env.LLM_API_KEY ?? '',
//   model: 'yuki-sft',
//   baseUrl: 'http://localhost:8000',
// })
```

Secrets come from the environment only — never hardcode credentials (YUKI §9/§10).
