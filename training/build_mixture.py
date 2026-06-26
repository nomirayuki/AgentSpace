"""Build a weighted JSONL SFT mixture from the five YUKI datasets.

Requires network access and accepted dataset licenses (xLAM is gated), so this
runs on training infrastructure, not in CI. The mapping logic it relies on lives
in ``normalize.py`` and is unit-tested independently.

Usage::

    python build_mixture.py --out mixture.jsonl --max-per-source 20000 --seed 7
"""

from __future__ import annotations

import argparse
import json
import random
from typing import Callable

from normalize import DATASET_WEIGHTS, NORMALIZERS, Record

# Canonical source id -> (HuggingFace dataset id, split).
SOURCES: dict[str, tuple[str, str]] = {
    "reasoning_opus": ("angrygiraffe/claude-opus-4.6-4.7-reasoning-8.7k", "train"),
    "swe_bench_verified": ("SWE-bench/SWE-bench_Verified", "test"),
    "toolace": ("Team-ACE/ToolACE", "train"),
    "xlam_function_calling": ("Salesforce/xlam-function-calling-60k", "train"),
    "openhands_trajectories": ("nebius/SWE-rebench-openhands-trajectories", "train"),
}


def _normalize_safe(fn: Callable[[Record], Record], row: Record) -> Record | None:
    """Apply a normalizer, skipping malformed rows rather than aborting a run."""
    try:
        return fn(dict(row))
    except (KeyError, ValueError, TypeError):
        return None


def build(out_path: str, max_per_source: int, seed: int) -> dict[str, int]:
    # Imported lazily so unit tests don't require the heavy `datasets` package.
    from datasets import load_dataset  # type: ignore

    rng = random.Random(seed)
    written: dict[str, int] = {}

    with open(out_path, "w", encoding="utf-8") as out:
        for source, (hf_id, split) in SOURCES.items():
            normalize = NORMALIZERS[source]
            weight = DATASET_WEIGHTS.get(source, 0.0)
            cap = max(1, int(max_per_source * weight / max(DATASET_WEIGHTS.values())))

            ds = load_dataset(hf_id, split=split, streaming=True)
            count = 0
            for row in ds:
                if count >= cap:
                    break
                record = _normalize_safe(normalize, row)
                if record is None:
                    continue
                # Light shuffling of write order across sources.
                record["_jitter"] = rng.random()
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                count += 1
            written[source] = count

    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Build YUKI SFT mixture (JSONL).")
    parser.add_argument("--out", default="mixture.jsonl")
    parser.add_argument("--max-per-source", type=int, default=20000)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    counts = build(args.out, args.max_per_source, args.seed)
    total = sum(counts.values())
    print(f"Wrote {total} examples to {args.out}")
    for source, n in counts.items():
        print(f"  {source}: {n}")


if __name__ == "__main__":
    main()
