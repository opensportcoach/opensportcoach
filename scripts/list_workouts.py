#!/usr/bin/env python3
"""List workouts in the Garmin account.

Usage:
  python scripts/list_workouts.py            # human-readable table
  python scripts/list_workouts.py --json     # also dump raw list to data/workouts_list.json
"""
from __future__ import annotations

import argparse

import athlete
from garmin_client import get_client, save_json

DATA_DIR = athlete.current().data_dir


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    client = get_client()
    workouts = client.get_workouts() or []
    if args.json:
        save_json(DATA_DIR / "workouts_list.json", workouts)
        print(f"raw list -> {DATA_DIR / 'workouts_list.json'}")
    if not workouts:
        print("No workouts in account.")
        return
    for w in workouts:
        sport = (w.get("sportType") or {}).get("sportTypeKey", "?")
        print(f"{w.get('workoutId')}  [{sport:18s}]  {w.get('workoutName')}  (updated {w.get('updateDate', '?')})")


if __name__ == "__main__":
    main()
