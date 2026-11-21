#!/usr/bin/env python3
"""A click in the app, recorded: the only confirm an app-attached session accepts for a Garmin write.

    .venv/bin/python scripts/app_confirm.py record --session <sid> --plan <plan hash>

SERVER-ONLY. The app's channel server runs this when the athlete presses Send to watch on the page.
Claude never runs it: scripts/hooks/confirm_gate.py refuses any Claude command that names it.

WHY (2026-10-08, docs/DESIGN.md (the app) → "Garmin writes: the confirm gate"). In the app, the confirm stops
being a sentence in the chat and becomes a click. The coach session may run in auto mode, where no
permission prompt ever reaches the page, so the click has to be checkable by a hook: this writes
athletes' app state  <app_dir>/confirms/<sid>--<hash>.json , and the hook lets a write through only
when the command names that hash (--expect-plan) and the record is fresh. A record stays valid for
its hash for 15 minutes, so a retry after a ConnectionResetError needs no second click, while a
changed plan (a new hash) does.

Limits, stated as guard_paths.py states its own: this stops accidents, not intent.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

HASH_RE = re.compile(r"^[A-Za-z0-9_-]{4,128}$")
VALID_FOR = dt.timedelta(minutes=15)


def _file(a: athlete.Athlete, sid: str, plan_hash: str) -> Path:
    return a.app_dir / "confirms" / f"{sid}--{plan_hash}.json"


def is_attached(a: athlete.Athlete, sid: str) -> bool:
    return (a.app_dir / "sessions" / f"{sid}.json").is_file()


def valid_confirm(a: athlete.Athlete, sid: str, plan_hash: str, now: dt.datetime | None = None) -> bool:
    if not (athlete.SESSION_RE.match(sid or "") and HASH_RE.match(plan_hash or "")):
        return False
    path = _file(a, sid, plan_hash)
    if not path.is_file():
        return False
    try:
        at = dt.datetime.fromisoformat(json.loads(path.read_text())["confirmed_at"])
    except (ValueError, KeyError, TypeError):
        return False
    return (now or dt.datetime.now()) - at <= VALID_FOR


def record(sid: str, plan_hash: str) -> Path:
    if not athlete.SESSION_RE.match(sid or ""):
        sys.exit(f"refused: {sid!r} is not a Claude session id.")
    if not HASH_RE.match(plan_hash or ""):
        sys.exit(f"refused: {plan_hash!r} is not a plan hash.")
    name = athlete.bound_name(sid)
    if not name:
        sys.exit("refused: that session is not bound to an athlete.")
    a = athlete.load(name)
    if not is_attached(a, sid):
        sys.exit("refused: that session has not attached the app.")
    path = _file(a, sid, plan_hash)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"confirmed_at": dt.datetime.now().isoformat(timespec="seconds"),
                                "plan": plan_hash}) + "\n")
    return path


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record")
    r.add_argument("--session", required=True)
    r.add_argument("--plan", required=True)
    args = p.parse_args()
    record(args.session, args.plan)
    print(json.dumps({"recorded": args.plan}))


if __name__ == "__main__":
    main()
