"""Unit tests for the dataset normalizers (no network, inline samples)."""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from normalize import (  # noqa: E402
    NORMALIZERS,
    VALID_ROLES,
    normalize_openhands,
    normalize_reasoning_opus,
    normalize_swe_bench,
    normalize_toolace,
    normalize_xlam,
)


def _assert_valid(record):
    assert record["messages"], "must have messages"
    for m in record["messages"]:
        assert m["role"] in VALID_ROLES
        assert isinstance(m["content"], str)
    assert isinstance(record["source"], str)


def test_reasoning_opus_passthrough_preserves_think():
    rec = normalize_reasoning_opus(
        {
            "category": "coding",
            "messages": [
                {"role": "system", "content": "You are a tutor."},
                {"role": "user", "content": "Is 5,12,13 a right triangle?"},
                {"role": "assistant", "content": "<think>5^2+12^2=13^2</think> Yes."},
            ],
        }
    )
    _assert_valid(rec)
    assert rec["source"] == "reasoning_opus"
    assert rec["category"] == "coding"
    assert "<think>" in rec["messages"][2]["content"]


def test_swe_bench_builds_issue_to_patch():
    rec = normalize_swe_bench(
        {
            "repo": "psf/requests",
            "instance_id": "psf__requests-1234",
            "problem_statement": "Timeout not respected.",
            "patch": "--- a/x.py\n+++ b/x.py\n@@\n-old\n+new",
        }
    )
    _assert_valid(rec)
    assert rec["messages"][0]["role"] == "system"
    assert "psf/requests" in rec["messages"][1]["content"]
    assert rec["messages"][2]["content"].startswith("--- a/x.py")
    assert rec["category"] == "psf__requests-1234"


def test_toolace_maps_from_to_roles():
    rec = normalize_toolace(
        {
            "system": "You compose functions.",
            "conversations": [
                {"from": "user", "value": "Top market trends in US?"},
                {"from": "assistant", "value": '[Market Trends API(country="us")]'},
                {"from": "tool", "value": '[{"results": {}}]'},
            ],
        }
    )
    _assert_valid(rec)
    roles = [m["role"] for m in rec["messages"]]
    assert roles == ["system", "user", "assistant", "tool"]


def test_xlam_parses_json_strings_and_keeps_tools():
    rec = normalize_xlam(
        {
            "query": "weather in Palo Alto today",
            "tools": json.dumps(
                [{"name": "get_weather", "description": "w", "parameters": {}}]
            ),
            "answers": json.dumps(
                [{"name": "get_weather", "arguments": {"city": "Palo Alto"}}]
            ),
        }
    )
    _assert_valid(rec)
    assert rec["tools"][0]["name"] == "get_weather"
    assert "get_weather" in rec["messages"][2]["content"]


def test_xlam_handles_native_objects():
    rec = normalize_xlam(
        {
            "query": "q",
            "tools": [{"name": "t", "description": "d", "parameters": {}}],
            "answers": [{"name": "t", "arguments": {}}],
        }
    )
    _assert_valid(rec)
    assert rec["tools"][0]["name"] == "t"


def test_openhands_accepts_trajectory_key():
    rec = normalize_openhands(
        {
            "trajectory": [
                {"role": "user", "content": "fix the bug"},
                {"actor": "assistant", "action": {"cmd": "edit file"}},
                {"role": "observation", "observation": "tests pass"},
            ]
        }
    )
    _assert_valid(rec)
    assert rec["messages"][0]["role"] == "user"
    # dict content is JSON-encoded; observation maps to the tool role
    assert rec["messages"][-1]["role"] == "tool"


def test_openhands_accepts_plain_messages():
    rec = normalize_openhands(
        {"messages": [{"role": "user", "content": "hi"}]}
    )
    _assert_valid(rec)


def test_openhands_rejects_unknown_shape():
    with pytest.raises(ValueError):
        normalize_openhands({"nope": 1})


def test_unsupported_role_raises():
    with pytest.raises(ValueError):
        normalize_reasoning_opus({"messages": [{"role": "wizard", "content": "x"}]})


def test_registry_complete():
    assert set(NORMALIZERS) == {
        "reasoning_opus",
        "swe_bench_verified",
        "toolace",
        "xlam_function_calling",
        "openhands_trajectories",
    }
