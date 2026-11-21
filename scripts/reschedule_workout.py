#!/usr/bin/env python3
"""Move an already-uploaded workout from one calendar date to another. CALENDAR ONLY.

WHY THIS EXISTS (2026-09-03). `sync_workouts.py` is the only way to write workout
CONTENT, and it re-points a calendar entry only as a side effect of a content change.
It has no way to say "the session I skipped on Wednesday happens on Friday instead".
The two alternatives were both wrong:

  * `push_workout.py --schedule` (retired 2026-09-24) UPLOADED. Garmin has no update verb, so that would have
    created a second `D1 · Push` under the same name and left him choosing between two
    identical entries on the watch. This is the single most common push bug in the
    project's history.
  * A throwaway heredoc against the client. That is how the cycle got hand-rolled six
    times before `sync_workouts.py` existed, and it is what the 08-30 audit killed.

So: one reviewable script, doing one thing, that can never upload and can never delete
a workout.

SAFETY
  * DRY RUN by default. Nothing is written without --yes.
  * NEVER uploads and NEVER calls delete_workout. The only two verbs it can reach are
    unschedule_workout and schedule_workout.
  * The athlete's PROTECTED workouts (athlete.json) are refused by id, by assertion, as
    everywhere else.
  * Refuses to schedule onto a date that already carries that same workout.
  * Re-reads the calendar afterwards and prints it, so the move is verified, not assumed.

Usage:
    .venv/bin/python scripts/reschedule_workout.py <workout-id> --to 2026-09-04
    .venv/bin/python scripts/reschedule_workout.py <workout-id> --to 2026-09-04 --from 2026-09-02 --yes
"""
from __future__ import annotations

import argparse
import json
import datetime as dt
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402
from garmin_client import calendar_window, get_client, read_scheduled_workouts  # noqa: E402

A = athlete.current()
# NEVER TOUCH. The athlete's protected ids (athlete.json), the same set sync and delete assert.
HIS_OWN = A.protected_ids

# The calendar is read through read_scheduled_workouts: a window derived from today,
# deduped by SCHEDULE id. It was a hardcoded `2026, months 8-10` until 2026-09-24.
read_calendar = read_scheduled_workouts


def window_label() -> str:
    (y0, m0), (y1, m1) = calendar_window()[0], calendar_window()[-1]
    return f"{y0}-{m0:02d}..{y1}-{m1:02d}"


def move_hash(workout_id: int, to: str | None, from_date: str | None, schedule_id) -> str:
    """The move the athlete confirms, as a hash (docs/DESIGN.md (the app) → confirm gate): this workout, from
    this schedule entry, to this date. --yes --expect-plan refuses anything else."""
    import hashlib
    body = json.dumps([workout_id, to, from_date, schedule_id])
    return hashlib.sha256(body.encode()).hexdigest()[:16]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("workout_id", type=int, help="the EXISTING workout id (see WORKOUT_IDS.json)")
    p.add_argument("--to", help="YYYY-MM-DD to schedule it on (omit to only remove)")
    p.add_argument("--from", dest="from_date",
                   help="YYYY-MM-DD whose entry to remove first (omit to only add)")
    p.add_argument("--yes", action="store_true",
                   help="actually write (only after the athlete's explicit confirmation)")
    p.add_argument("--plan-json", metavar="FILE", help="also write the move as JSON — the app's confirm card")
    p.add_argument("--expect-plan", metavar="HASH",
                   help="with --yes: refuse unless the move's hash is exactly this (the move the athlete confirmed)")
    args = p.parse_args()
    if args.expect_plan and not args.yes:
        p.error("--expect-plan only means something with --yes")

    assert args.workout_id not in HIS_OWN, "refusing to touch a protected workout (athlete.json)"
    # 2026-09-07: --to alone adds, --from alone removes, both together move. A run with
    # neither is a no-op and almost certainly a typo, so it fails rather than doing nothing.
    if not args.to and not args.from_date:
        sys.exit("give --to (schedule), --from (unschedule), or both (move).")
    if args.to:
        dt.date.fromisoformat(args.to)
    if args.from_date:
        dt.date.fromisoformat(args.from_date)

    client = get_client()
    calendar = read_calendar(client)
    mine = [i for i in calendar if i["workoutId"] == args.workout_id]
    # Not being on the calendar is only an error when --from asks to REMOVE an entry.
    # A plain --to is "put this on the calendar", which is the normal case for a day that
    # has never been scheduled (2026-09-06: D4 had no entry at all).
    if not mine and args.from_date:
        sys.exit(f"workout {args.workout_id} is not scheduled anywhere in {window_label()}, "
                 f"so there is nothing to remove from {args.from_date}. "
                 f"Check the id against {A.workouts_dir / 'WORKOUT_IDS.json'}.")
    name = mine[0].get("title") if mine else str(args.workout_id)

    drop = None
    if args.from_date:
        hits = [i for i in mine if i["date"] == args.from_date]
        if not hits:
            sys.exit(f"'{name}' is not scheduled on {args.from_date}; it sits on "
                     f"{', '.join(i['date'] for i in mine)}. Nothing removed.")
        drop = hits[0]
    if args.to and any(i["date"] == args.to for i in mine):
        sys.exit(f"'{name}' is ALREADY scheduled on {args.to}. Refusing to duplicate it.")

    print(f"workout {args.workout_id}  '{name}'")
    print(f"  currently on: {', '.join(i['date'] for i in mine) if mine else '(not scheduled)'}")
    if drop:
        print(f"  UNSCHEDULE   {drop['date']}  (schedule id {drop['id']})")
    if args.to:
        print(f"  SCHEDULE     {args.to}")
        for i in [x for x in calendar if x["date"] == args.to]:
            print(f"  note: {args.to} already carries '{i.get('title')}'")

    mhash = move_hash(args.workout_id, args.to, args.from_date, drop["id"] if drop else None)
    print(f"  plan hash: {mhash}")
    if args.plan_json:
        Path(args.plan_json).write_text(json.dumps({
            "athlete": A.name, "display": A.display, "garmin_account": A.garmin.get("full_name"),
            "actions": [{"verb": "move" if drop and args.to else "unschedule" if drop else "schedule",
                         "workout": name, "workout_id": args.workout_id,
                         "from": drop["date"] if drop else None, "to": args.to}],
            "plan_hash": mhash}, indent=1) + "\n")

    if not args.yes:
        print("\nDRY RUN — nothing written. Re-run with --yes after the athlete's explicit confirmation.")
        return
    if args.expect_plan and args.expect_plan != mhash:
        sys.exit(f"REFUSED: the move is now {mhash}, not the {args.expect_plan} that was confirmed. "
                 "Nothing was written. Dry-run again and get a new confirm.")

    if drop:
        client.unschedule_workout(drop["id"])
        print(f"\nunscheduled {drop['date']} (schedule id {drop['id']})")
        time.sleep(1.0)
    if args.to:
        client.schedule_workout(args.workout_id, args.to)
        print(f"scheduled on {args.to}")
    time.sleep(1.5)

    print("\n== calendar re-read from Garmin ==")
    for i in read_calendar(client):
        if i["date"] >= dt.date.today().isoformat():
            flag = "  <--" if i["workoutId"] == args.workout_id else ""
            print(f"  {i['date']}  {str(i.get('title'))[:26]:26} sched={i['id']}{flag}")


if __name__ == "__main__":
    main()
