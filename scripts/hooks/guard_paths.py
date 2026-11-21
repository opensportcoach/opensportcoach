#!/usr/bin/env python3
"""Claude Code PreToolUse hook: a session bound to one athlete may not touch another's files.

Blocks (exit 2, reason on stderr — Claude Code shows it to the model) any tool call whose input
names another athlete's folder (athletes/<other>/), cache (data/<other>/) or Garmin token store
(~/.garminconnect-<other>), and any use of the bare default token path, which nothing in this
project may use. Covers Read, Edit, Write, Grep, Glob, NotebookEdit and Bash — for Bash by
inspecting the command text.

LIMITS, stated plainly: it matches explicit paths. A broad search from the repo root can still
surface another athlete's files, and a deliberately obfuscated command can get past it. It stops
accidents, not intent — the same promise as everything else on a shared macOS user.

An UNBOUND session is not blocked here: it cannot run any athlete script (athlete.current()
refuses), and the engine work a session does before binding — or without ever binding — needs to
see the whole repo.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def strings(node) -> list[str]:
    if isinstance(node, str):
        return [node]
    if isinstance(node, dict):
        return [s for v in node.values() for s in strings(v)]
    if isinstance(node, list):
        return [s for v in node for s in strings(v)]
    return []


def violation(texts: list[str], bound: str, others: list[str]) -> str | None:
    for text in texts:
        for m in re.finditer(r"athletes/([a-z][a-z0-9_-]*)", text):
            if m.group(1) != bound:
                return f"athletes/{m.group(1)}/"
        for other in others:
            if re.search(rf"data/{re.escape(other)}(?![a-z0-9_-])", text):
                return f"data/{other}/"
        for m in re.finditer(r"\.garminconnect(?:-([a-z][a-z0-9_-]*))?", text):
            if m.group(1) != bound:
                return m.group(0)
    return None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    import athlete
    sid = payload.get("session_id") or ""
    if not athlete.SESSION_RE.match(sid):
        return 0
    bound = athlete.bound_name(sid)
    if not bound:
        return 0
    others = [n for n in athlete.known() if n != bound]
    hit = violation(strings(payload.get("tool_input") or {}), bound, others)
    if hit:
        print(f"BLOCKED by the OpenSportCoach athlete guard: this session is bound to {bound}, and this "
              f"{payload.get('tool_name', 'tool')} call touches {hit}. Another athlete's files, "
              "cache and Garmin tokens are off limits; the default token path is never used. "
              "If this is really needed, it belongs in a session bound to that athlete.",
              file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001 — a broken guard must not wedge every tool call
        sys.exit(0)
