#!/usr/bin/env python3
"""Claude Code SessionStart hook: give the session an identity, then say who it is coaching.

1. Exports OSC_SESSION=<session id> through CLAUDE_ENV_FILE, so every Bash command in the
   session carries it and athlete.current() can find the session's binding.
2. Prints a banner that lands in the model's context:
     bound (a resumed session) -> "Athlete: X · Garmin: <full name>" plus athletes/X/ATHLETE.md
     not bound                 -> the instruction to ask who it is coaching, then run use.py
Never fails the session: any error is swallowed and reported as text. If this hook does not run
at all, nothing is exported and every athlete script refuses to start — failing closed.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}
    import athlete
    from whoami import banner

    sid = payload.get("session_id") or ""
    if not athlete.SESSION_RE.match(sid):
        print("OSC: no usable session id — athlete scripts will refuse to run in this session.")
        return
    env_file = os.environ.get("CLAUDE_ENV_FILE")
    if env_file:
        with open(env_file, "a") as fh:
            fh.write(f"export OSC_SESSION={sid}\n")
    else:
        print("OSC: CLAUDE_ENV_FILE is not available, so this session cannot be bound. Every "
              "athlete script needs an explicit --athlete <name> instead.")

    name = athlete.bound_name(sid)
    if name:
        print(banner(athlete.load(name), full=True))
        return
    names = [athlete.load(n).display for n in athlete.known()]
    if not names:
        # A fresh clone: nobody is set up yet. Everything starts with the setup conversation.
        print("OSC · Welcome — nobody is set up on this computer yet.\n"
              "Whatever the person's first message is (\"hi\", \"set me up\", a training question), "
              "start the setup with the /osc-setup skill: it asks their name, does the safety step "
              "first, creates their folder and binds this session. Do not plan, pull data or create "
              "anything before it. If they'd rather just look around first, the demo app runs with "
              "synthetic data: (cd app/channel && npm ci) && cd app/web && npm ci && npm run dev")
        return
    print("OSC · No athlete is bound to this session.\n"
          f"Athletes: {', '.join(names)}.\n"
          "Before anything athlete-specific — reading their files, running a script, planning — "
          "find out who you are coaching. If the first message names them, use that; otherwise "
          "ask. Then bind the session, once:\n"
          "    .venv/bin/python scripts/use.py <name>\n"
          "Someone NEW — not one of the athletes above — is set up with the /osc-setup skill "
          "instead, never with use.py.\n"
          "A session is never rebound. Until it is bound, every athlete script refuses to run.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — a hook must never break session start
        print(f"OSC: session_start hook failed ({type(exc).__name__}: {exc}). Athlete scripts "
              "will refuse to run until an athlete is bound.")
    sys.exit(0)
