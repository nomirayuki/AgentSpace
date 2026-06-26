# YUKI Brain — Training Pipeline

Turns the five source datasets into one fine-tuning mixture and trains the YUKI
brain (a LoRA/QLoRA SFT of an open-weights base model). The trained model is then
served behind an OpenAI-compatible endpoint and plugged into the agent runtime
via `OpenAICompatibleProvider` — no runtime code changes.

See the architecture overview in [`../docs/YUKI_BRAIN.md`](../docs/YUKI_BRAIN.md).

## Layout

| File                      | Purpose                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `normalize.py`            | Pure functions: each dataset record → unified chat schema. Unit-tested, no I/O.  |
| `build_mixture.py`        | CLI: streams the 5 datasets via `datasets`, normalizes, writes a weighted JSONL. |
| `configs/lora_sft.yaml`   | QLoRA SFT hyperparameters.                                                       |
| `requirements.txt`        | Python deps (datasets + fine-tuning stack).                                      |
| `tests/test_normalize.py` | Network-free tests for the normalizers.                                          |

## Unified schema

```json
{
  "messages": [{ "role": "system|user|assistant|tool", "content": "..." }],
  "tools": [{ "name": "...", "description": "...", "parameters": {} }],
  "source": "xlam_function_calling",
  "category": "coding"
}
```

## Datasets → capabilities

| Source id                | HF dataset                                      | Trains                                    |
| ------------------------ | ----------------------------------------------- | ----------------------------------------- |
| `reasoning_opus`         | angrygiraffe/claude-opus-4.6-4.7-reasoning-8.7k | Long-form `<think>` reasoning             |
| `swe_bench_verified`     | SWE-bench/SWE-bench_Verified                    | Issue → root-cause patch                  |
| `toolace`                | Team-ACE/ToolACE                                | Multi-turn tool composition + abstention  |
| `xlam_function_calling`  | Salesforce/xlam-function-calling-60k            | Execution-verified function calls (gated) |
| `openhands_trajectories` | nebius/SWE-rebench-openhands-trajectories       | Full agent rollouts (plan→act→observe)    |

## Run

```bash
# 1. (tests only — no network/GPU needed)
PYENV_VERSION=3.11 python -m pytest tests/ -q

# 2. Build the mixture (needs network + accepted licenses; xLAM is gated)
pip install -r requirements.txt
huggingface-cli login
python build_mixture.py --out mixture.jsonl --max-per-source 20000 --seed 7

# 3. Fine-tune on a GPU host using configs/lora_sft.yaml with your launcher
#    (TRL SFTTrainer / LLaMA-Factory / axolotl).

# 4. Serve the merged model behind an OpenAI-compatible API (vLLM/TGI), then:
#    new YukiAgent({ brain: new OpenAICompatibleProvider({ model, baseUrl }) })
```

## Why training is not in CI

Fine-tuning needs accelerators and large (partly gated) downloads. CI only runs
the pure-Python normalizer tests; the heavy `datasets`/training imports in
`build_mixture.py` are loaded lazily so they never block the unit tests.
