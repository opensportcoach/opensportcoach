#!/usr/bin/env python3
"""Split-day rotation status — which D1–D5 days are starving?

Classifies every cached strength session by matching its executed exercises
against each program day's exercise signature (build_workouts.PROGRAM), then
reports days-since-last per split day. Run as part of the daily loop BEFORE
picking today's session: a starved day (>7 days) should win over the next-in-
rotation default unless readiness/injury says otherwise.

Context: found 2026-07-16 — D4 Upper had gone 32 days and D5 Arms 22 days
untrained while D1–D3 kept cycling, silently deleting direct arm volume.

Usage: python scripts/rotation_status.py [--since 2026-06-13]
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402
import strength_sessions as ss  # noqa: E402

A = athlete.current()

STARVED_DAYS = 7  # a split day untouched this long gets flagged

# How each split day is named — the athlete's program may define DAY_LABEL; otherwise the day's
# own workout name is used.
DAY_LABEL = getattr(A.program, "DAY_LABEL", None) or {
    k: v["name"] for k, v in A.program.PROGRAM.items()}


def classify_sessions(since: str):
    """(date, day, signature matches, name) per strength session. Attribution — workout name
    first, then best signature overlap — lives in strength_sessions, shared with the audit."""
    sigs = ss.signatures()
    return [(x.date, x.day, len(x.keys() & sigs[x.day]) if x.day else 0, x.name)
            for x in ss.sessions(since)]


def rotation(since: str = "2026-06-13", today: dt.date | None = None) -> dict:
    """Days since each split day was trained — the data behind main()'s table, also read by the
    app (scripts/app_data.py)."""
    sessions = classify_sessions(since)
    last = {}
    for d, day, _, _ in sessions:
        if day:
            last[day] = d
    today = today or dt.date.today()
    days = []
    for day, label in DAY_LABEL.items():
        d = last.get(day)
        age = (today - dt.date.fromisoformat(d)).days if d else None
        days.append({"day": day, "label": label, "last": d, "age": age,
                     "starved": age is None or age > STARVED_DAYS})
    starved = sorted(((999 if x["age"] is None else x["age"], x["label"]) for x in days if x["starved"]),
                     reverse=True)
    return {"today": today.isoformat(), "starved_after_days": STARVED_DAYS, "days": days,
            "unclassified": [{"date": d, "name": name} for d, day, _, name in sessions if day is None],
            "next": [lbl for _, lbl in starved]}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--since", default="2026-06-13", help="reliable-data start date")
    args = p.parse_args()

    # 2026-10-04: this said "D3 STARVED, next: D3" the day after he trained legs, because the
    # cache predated the session. Say how old the data is, and shout when the calendar disagrees.
    ss.print_cache_status()
    r = rotation(args.since)

    print(f"=== Split-day rotation status ({r['today']}) ===\n")
    for x in r["days"]:
        if x["last"]:
            flag = "  <-- STARVED" if x["starved"] else ""
            print(f"  {x['label']:9s} last {x['last']}  ({x['age']:2d} days ago){flag}")
        else:
            print(f"  {x['label']:9s} never (in window)  <-- STARVED")

    if r["unclassified"]:
        print("\n  unclassified strength sessions (improv / <2 signature matches):")
        for u in r["unclassified"][-5:]:
            print(f"    {u['date']}  {u['name']}")

    if r["next"]:
        order = " -> ".join(r["next"])
        print(f"\n  NEXT GYM DAYS SHOULD BE: {order} (most starved first)")


if __name__ == "__main__":
    main()
