#!/usr/bin/env python3
"""Claude Code PreToolUse hook (Bash): in a session attached to the app, nothing reaches Garmin
without the athlete's click.

WHY (2026-10-08, docs/DESIGN.md (the app) → "Garmin writes: the confirm gate"). In the app the confirm is a click
on the page, and the coach session may run in auto mode, where permission prompts are answered by a
classifier and never reach the page. So the rule "never write to Garmin without their explicit
confirmation, in this session" needs a mechanical check:

  * sync_workouts.py --yes and reschedule_workout.py --yes run only with --expect-plan <hash>, and
    only when scripts/app_confirm.py has recorded a click for that hash in this session within the
    last 15 minutes.
  * delete_workout.py, and one-liners that call the client's write methods, are refused: the app
    does not offer them (v1). Do them in a normal session.
  * Claude never records a click itself (app_confirm.py record), in any session: only the app's
    server does. git commands pass, since they only carry these names as text.

Sessions NOT attached to the app are untouched: their confirm stays conversational, as before.
Anything that is not a Garmin write passes straight through.

LIMITS, stated as guard_paths.py states its own: it matches the command text. It stops accidents,
not intent. For a Garmin write it fails CLOSED: if the session's state cannot be read, the write is
refused, with the reason.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

GATED = re.compile(r"\b(sync_workouts|reschedule_workout)\.py\b")
YES = re.compile(r"(?<![\w-])--yes\b")
NEVER_IN_APP = re.compile(r"\bdelete_workout\.py\b|\b(upload_workout|schedule_workout|unschedule_workout|"
                          r"delete_workout)\s*\(")
EXPECT = re.compile(r"--expect-plan[ =]([A-Za-z0-9_-]+)")
# Recording a click: running the script, or calling it from Python. Naming the file (git add, a
# commit message, reading it) records nothing.
RECORDS = re.compile(r"app_confirm\.py['\"]?\s+record\b|app_confirm\.record\s*\(")
# git commands only carry these names as text (paths, commit messages), never a Garmin call.
GIT = re.compile(r"^\s*git\s")


def decide(sid: str, command: str) -> str | None:
    """The reason to block, or None to let it run."""
    if GIT.match(command):
        return None
    if RECORDS.search(command):
        return ("only the app's server records a confirm (scripts/app_confirm.py). The athlete "
                "confirms by pressing Send to watch in the app.")
    gated = bool(GATED.search(command) and YES.search(command))
    never = bool(NEVER_IN_APP.search(command))
    if not (gated or never):
        return None
    import athlete
    import app_confirm
    if not athlete.SESSION_RE.match(sid or ""):
        return None  # no session to attach to; the athlete scripts refuse unbound runs anyway
    bound = athlete.bound_name(sid)
    if not bound:
        return None
    a = athlete.load(bound)
    if not app_confirm.is_attached(a, sid):
        return None  # a normal session: the confirm stays conversational
    if never:
        return ("the app does not offer deleting workouts or raw client writes. Do it in a normal "
                "session, where the athlete names the workout and confirms in the conversation.")
    m = EXPECT.search(command)
    if not m:
        return ("this session serves the app, so a Garmin write needs the athlete's click: publish "
                "the dry-run plan to the app, wait for the confirm event, then run the write with "
                "--expect-plan <that plan's hash>.")
    if not app_confirm.valid_confirm(a, sid, m.group(1)):
        return (f"no confirm from the app for plan {m.group(1)} in this session in the last 15 "
                "minutes. Ask the athlete to press Send to watch on that plan in the app.")
    return None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    if payload.get("tool_name") != "Bash":
        return 0
    command = str((payload.get("tool_input") or {}).get("command") or "")
    try:
        reason = decide(payload.get("session_id") or "", command)
    except SystemExit as exc:  # athlete.load() exits on a broken athlete folder
        reason = f"could not read this session's athlete ({exc}); a Garmin write is refused."
    except Exception as exc:  # noqa: BLE001 — decide() only gets here for Garmin writes
        reason = f"could not check the app confirm ({type(exc).__name__}: {exc}); the write is refused."
    if reason:
        print(f"BLOCKED by the OpenSportCoach confirm gate: {reason}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
