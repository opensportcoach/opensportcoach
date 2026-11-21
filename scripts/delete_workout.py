#!/usr/bin/env python3
"""Delete Garmin workouts by id — ONLY ids the athlete explicitly named + confirmed.

Safety contract (CLAUDE.md): never delete anything the athlete didn't name; every run
requires --yes (their confirmation must already exist in the conversation). Protected
workouts (athlete.json) are refused before connecting.
Prints the remaining workout list afterwards for verification.

Usage: python scripts/delete_workout.py --yes <workoutId> [<workoutId> ...]
"""
from __future__ import annotations

import argparse
import sys

import athlete
from garmin_client import get_client

# Resolved at import, before argparse runs: `--athlete` is consumed here, and nothing below
# can act for anyone else.
A = athlete.current()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("ids", nargs="+", type=int, help="workout ids to delete")
    p.add_argument("--yes", action="store_true", help="confirm (required)")
    args = p.parse_args()
    if not args.yes:
        p.error("refusing to delete without --yes (explicit confirmation required)")
    # Checked BEFORE connecting (2026-09-24). sync_workouts and reschedule_workout have
    # asserted this since August; the one script whose whole job is deleting never did.
    protected = sorted(set(args.ids) & A.protected_ids)
    if protected:
        sys.exit(f"refusing to delete {protected}: protected workouts (athlete.json) are never deleted.")

    c = get_client()
    for wid in args.ids:
        c.delete_workout(str(wid))
        print(f"deleted {wid}")

    print("\nworkouts remaining in account:")
    for w in c.get_workouts(0, 50):
        print(f"  {w['workoutId']}  {w['workoutName']}")


if __name__ == "__main__":
    main()
