"""Normalize the five YUKI fine-tuning datasets into one chat schema.

Unified record schema (one JSON object per training example)::

    {
      "messages": [{"role": "system|user|assistant|tool", "content": str}, ...],
      "tools":    [{"name": str, "description": str, "parameters": dict}, ...],  # optional
      "source":   str,    # dataset identifier
      "category": str     # optional, free-form
    }

The pure ``normalize_*`` functions contain no I/O and are fully unit-tested with
inline samples (see ``tests/test_normalize.py``), so the mapping logic is
verifiable without downloading any (possibly gated) dataset.

The ``build_mixture`` CLI wires these into ``datasets.load_dataset`` and writes a
weighted JSONL mixture; it requires network access and accepted dataset
licenses, so it runs on training infrastructure rather than in CI.
"""

from __future__ import annotations

import json
from typing import Any, Iterable

Message = dict[str, str]
Record = dict[str, Any]

VALID_ROLES = {"system", "user", "assistant", "tool"}

# Canonical source identifiers and their default sampling weights.
DATASET_WEIGHTS: dict[str, float] = {
    "reasoning_opus": 0.25,
    "swe_bench_verified": 0.15,
    "openhands_trajectories": 0.20,
    "xlam_function_calling": 0.25,
    "toolace": 0.15,
}


def _coerce_role(raw: str) -> str:
    """Map dataset-specific role labels onto the canonical role set."""
    role = (raw or "").strip().lower()
    aliases = {
        "human": "user",
        "gpt": "assistant",
        "ai": "assistant",
        "function": "tool",
        "observation": "tool",
        "tool_response": "tool",
    }
    role = aliases.get(role, role)
    if role not in VALID_ROLES:
        raise ValueError(f"unsupported role: {raw!r}")
    return role


def _as_obj(value: Any) -> Any:
    """Parse a value that may be a JSON string into a Python object."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _make(messages: list[Message], source: str, *, tools: Any = None,
          category: str | None = None) -> Record:
    if not messages:
        raise ValueError("a training record must contain at least one message")
    for m in messages:
        if m["role"] not in VALID_ROLES:
            raise ValueError(f"invalid role in message: {m['role']!r}")
    record: Record = {"messages": messages, "source": source}
    if tools:
        record["tools"] = tools
    if category:
        record["category"] = category
    return record


def normalize_reasoning_opus(record: Record) -> Record:
    """angrygiraffe/claude-opus-4.6-4.7-reasoning-8.7k.

    Already chat-formatted as ``messages: [{role, content}]`` with ``<think>``
    blocks preserved in assistant turns.
    """
    messages = [
        {"role": _coerce_role(m["role"]), "content": str(m["content"])}
        for m in record["messages"]
    ]
    return _make(messages, "reasoning_opus", category=record.get("category"))


def normalize_swe_bench(record: Record) -> Record:
    """SWE-bench Verified: issue -> gold patch.

    Builds a single-turn SFT example: the problem statement becomes the user
    turn; the human-validated patch becomes the assistant turn.
    """
    repo = record.get("repo", "")
    problem = record.get("problem_statement", "")
    patch = record.get("patch", "")
    hints = record.get("hints_text", "")

    user = f"Repository: {repo}\n\nIssue:\n{problem}"
    if hints:
        user += f"\n\nHints:\n{hints}"

    messages = [
        {
            "role": "system",
            "content": (
                "You are a senior software engineer. Resolve the issue by "
                "producing a correct unified-diff patch. Fix the root cause."
            ),
        },
        {"role": "user", "content": user},
        {"role": "assistant", "content": patch},
    ]
    return _make(messages, "swe_bench_verified",
                 category=record.get("instance_id"))


def normalize_toolace(record: Record) -> Record:
    """Team-ACE/ToolACE: ``system`` string + ``conversations: [{from, value}]``."""
    messages: list[Message] = []
    system = record.get("system")
    if system:
        messages.append({"role": "system", "content": str(system)})
    for turn in record["conversations"]:
        messages.append(
            {"role": _coerce_role(turn["from"]), "content": str(turn["value"])}
        )
    return _make(messages, "toolace")


def normalize_xlam(record: Record) -> Record:
    """Salesforce/xlam-function-calling-60k: ``query`` / ``tools`` / ``answers``.

    ``tools`` and ``answers`` may arrive as JSON strings; both are parsed. The
    available tools are attached to the record and the gold tool calls become
    the assistant turn so the model learns to emit valid calls.
    """
    query = str(record.get("query", ""))
    tools = _as_obj(record.get("tools", [])) or []
    answers = _as_obj(record.get("answers", []))

    answer_text = (
        json.dumps(answers, ensure_ascii=False)
        if not isinstance(answers, str)
        else answers
    )

    messages = [
        {
            "role": "system",
            "content": (
                "You are an expert at composing function calls. Given the user "
                "request and available tools, emit the correct tool calls. If no "
                "tool fits, say so."
            ),
        },
        {"role": "user", "content": query},
        {"role": "assistant", "content": answer_text},
    ]
    return _make(messages, "xlam_function_calling", tools=tools)


def normalize_openhands(record: Record) -> Record:
    """nebius/SWE-rebench-openhands-trajectories: agent rollouts.

    The schema varies across releases, so this normalizer is defensive: it
    accepts either a ready ``messages`` list or a ``trajectory``/``history`` of
    steps with role-ish and content-ish keys.
    """
    if isinstance(record.get("messages"), list):
        steps: Iterable[Record] = record["messages"]
    elif isinstance(record.get("trajectory"), list):
        steps = record["trajectory"]
    elif isinstance(record.get("history"), list):
        steps = record["history"]
    else:
        raise ValueError("openhands record has no messages/trajectory/history")

    role_keys = ("role", "from", "source", "actor")
    content_keys = ("content", "value", "text", "observation", "thought", "action")

    messages: list[Message] = []
    for step in steps:
        raw_role = next((step[k] for k in role_keys if k in step), None)
        raw_content = next((step[k] for k in content_keys if k in step), None)
        if raw_role is None or raw_content is None:
            continue
        content = (
            raw_content if isinstance(raw_content, str)
            else json.dumps(raw_content, ensure_ascii=False)
        )
        messages.append({"role": _coerce_role(str(raw_role)), "content": content})

    return _make(messages, "openhands_trajectories")


NORMALIZERS = {
    "reasoning_opus": normalize_reasoning_opus,
    "swe_bench_verified": normalize_swe_bench,
    "toolace": normalize_toolace,
    "xlam_function_calling": normalize_xlam,
    "openhands_trajectories": normalize_openhands,
}
