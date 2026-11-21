#!/usr/bin/env python3
"""Shared Garmin Connect client factory + helpers.

Auth model (multi-athlete, 2026-09-24). Each athlete has their OWN token store,
~/.garminconnect-<name>, created once by `scripts/login.py --athlete <name>` — interactive, typed
by that person. The path is derived from the athlete's name in athlete.py and never configured;
nothing lives at the library's default path, so a stray default fails instead of reaching
someone's account. Credentials never touch this repo. garminconnect >= 0.3.x refreshes tokens
itself.

EVERY LOGIN ASSERTS WHOSE ACCOUNT IT IS. The tokens' Garmin display name must equal the one
recorded in athletes/<name>/athlete.json when that athlete was bound. That holds for reads too: a
read under the wrong account would drop one athlete's health data into the other's cache, which
is exactly the mixing this project promises cannot happen.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
import time
from pathlib import Path

from garminconnect import Garmin

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

# Unofficial API — keep a polite gap between calls in any loop.
THROTTLE_SECONDS = 0.4


def assert_identity(client, a) -> None:
    """Exit unless the logged-in account is the one bound to athlete `a`."""
    expected = a.garmin.get("display_name")
    got = getattr(client, "display_name", None)
    if not expected or got != expected:
        who = getattr(client, "full_name", None) or got or "an unknown account"
        sys.exit(f"REFUSED: this is {a.display}'s session, but the tokens in {a.token_dir} "
                 f"belong to {who}. Nothing was read or written.")


def get_client() -> Garmin:
    """A logged-in client for the CURRENT athlete, identity-checked. Exits with instructions
    otherwise — before a single call is made."""
    a = athlete.current()
    import sources
    if not sources.uses(a, "garmin"):
        sys.exit(f"{a.display} does not use Garmin (athlete.json → sources: {', '.join(sources.of(a))}). "
                 "Nothing was read or written.")
    how = f"    .venv/bin/python scripts/login.py --athlete {a.name}"
    if not a.garmin.get("display_name"):
        sys.exit(f"{a.display} has no Garmin account bound yet. In their own terminal:\n{how}")
    if not a.token_dir.is_dir():
        sys.exit(f"No Garmin token store for {a.display} at {a.token_dir}.\n"
                 f"Run the one-time interactive login, in their own terminal:\n{how}")
    try:
        client = Garmin()
        client.login(str(a.token_dir))
    except Exception as e:
        sys.exit(f"Token login failed for {a.display} ({type(e).__name__}: {e}).\n"
                 f"Tokens may be expired or poisoned — re-run:\n{how}")
    assert_identity(client, a)
    return client


def throttled(fn, /, *args, **kwargs):
    """Call an API method, then sleep briefly. Use in loops over many days/activities."""
    out = fn(*args, **kwargs)
    time.sleep(THROTTLE_SECONDS)
    return out


def calendar_window(today: dt.date | None = None, before: int = 1,
                    after: int = 2) -> list[tuple[int, int]]:
    """(year, month) pairs from `before` months back to `after` months ahead of today.

    WHY (2026-09-24). sync_workouts and reschedule_workout both read the calendar from a
    hardcoded `2026, months 8-10`. From 1 November that window stops covering the dates he
    schedules: sync would delete a superseded workout without re-pointing its November
    calendar entry, so the session silently vanished from the watch, and reschedule could
    neither find a November entry nor catch a duplicate there. The window is now derived
    from today and rolls over the year. One month back so yesterday's skipped session can
    still be moved on the 1st.
    """
    today = today or dt.date.today()
    base = today.year * 12 + today.month - 1
    return [(i // 12, i % 12 + 1) for i in range(base - before, base + after + 1)]


def read_scheduled_workouts(client, today: dt.date | None = None, before: int = 1,
                            after: int = 2) -> list[dict]:
    """Every scheduled WORKOUT in the calendar window, deduped by SCHEDULE id, by date.

    The month view spills across boundaries, so querying consecutive months hands the same
    entry back more than once. 2026-08-30: that made sync_workouts unschedule an id it had
    already removed, and the run died on a 404 *after* every upload and delete had
    succeeded. So every caller gets the deduped list from here. The window is
    calendar_window's: sync and reschedule read the default, pull_activities this month and next.
    """
    seen: set = set()
    out = []
    for year, month in calendar_window(today, before, after):
        items = (throttled(client.get_scheduled_workouts, year, month) or {}).get("calendarItems", [])
        for item in items:
            if item.get("itemType") != "workout" or item["id"] in seen:
                continue
            seen.add(item["id"])
            out.append(item)
    return sorted(out, key=lambda i: i["date"])


def save_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str) + "\n")
