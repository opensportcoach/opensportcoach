#!/usr/bin/env python3
"""Grow EXERCISE_CATALOG.json from real Garmin data instead of guesswork.

WHY (2026-08-30 audit, finding 6). The catalog holds 77 validated category/exerciseName
pairs; his Connect exercise picker lists 1,548. There is no taxonomy endpoint — seven
candidates were probed and all returned 404 or 500 — and none ships with the library. So
new keys cannot be looked up, and they must not be guessed: an unvalidated key uploads
cleanly and then renders as "Unknown exercise" on the watch, which is worse than no name.

That gap is what currently blocks naming the Hyrox stations (SkiErg, sled, rower, carry).

Two sources of ground truth, both real Garmin output:
  1. EVERY WORKOUT IN THE ACCOUNT. If he picks an exercise in the Connect editor and
     saves, Garmin stores the canonical pair — reading it back is exact. This is the
     intended workflow: he selects it once, we keep it forever.
  2. EVERY LOGGED ACTIVITY. Cached strength-set files name the exercise Garmin actually
     recorded, including ones his watch auto-detected that the program never prescribed.

Anything already in the catalog is left alone. Discovered pairs are appended and reported
so the mapping decision can be recorded in the athlete's workouts/EXERCISE_MAPPING.md.

Usage:
    .venv/bin/python scripts/harvest_exercises.py            # report only
    .venv/bin/python scripts/harvest_exercises.py --write    # append to the catalog
"""
from __future__ import annotations

import argparse
import glob
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402
from garmin_client import get_client  # noqa: E402

A = athlete.current()
# The catalog is SHARED — a FIT-SDK taxonomy, not anyone's data. Discoveries come from the
# current athlete's account and cache and are appended for everyone.
CATALOG = athlete.CATALOG_PATH


def from_account(client) -> dict:
    found = defaultdict(set)
    for w in client.get_workouts(0, 60):
        full = client.get_workout_by_id(w["workoutId"])
        time.sleep(0.5)
        stack = list(full.get("workoutSegments") or [])
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                cat, name = node.get("category"), node.get("exerciseName")
                if cat and name:
                    found[cat].add(name)
                stack.extend(v for v in node.values() if isinstance(v, (dict, list)))
            elif isinstance(node, list):
                stack.extend(node)
    return found


def from_activities() -> dict:
    found = defaultdict(set)
    for path in glob.glob(str(A.data_dir / "activity_*_sets.json")):
        for s in json.loads(Path(path).read_text()).get("exerciseSets") or []:
            for ex in s.get("exercises") or []:
                cat, name = ex.get("category"), ex.get("name")
                if cat and name and name != "UNKNOWN":
                    found[cat].add(name)
    return found


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true", help="append discoveries to the catalog")
    ap.add_argument("--skip-account", action="store_true", help="use cached activities only")
    args = ap.parse_args()

    catalog = json.loads(CATALOG.read_text())
    known = catalog["categories"]

    found = defaultdict(set)
    for src in ([] if args.skip_account else [from_account(get_client())]) + [from_activities()]:
        for cat, names in src.items():
            found[cat] |= names

    new = {cat: sorted(n for n in names if n not in known.get(cat, []))
           for cat, names in found.items()}
    new = {c: n for c, n in new.items() if n}

    total_known = sum(len(v) for v in known.values())
    print(f"catalog: {len(known)} categories, {total_known} pairs")
    if not new:
        print("no new exercise keys found.")
        return

    print(f"\n{sum(len(v) for v in new.values())} NEW pair(s) discovered:")
    for cat, names in sorted(new.items()):
        mark = "" if cat in known else "   [NEW CATEGORY]"
        print(f"  {cat}{mark}")
        for n in names:
            print(f"      {n}")

    if not args.write:
        print("\nReport only. Re-run with --write to append them.")
        return

    for cat, names in new.items():
        known.setdefault(cat, [])
        known[cat].extend(names)
        known[cat] = sorted(set(known[cat]))
    catalog["categories"] = dict(sorted(known.items()))
    CATALOG.write_text(json.dumps(catalog, indent=1) + "\n")
    print(f"\nappended. catalog now {sum(len(v) for v in known.values())} pairs.")
    print("Record the mapping decision for each new key in athletes/<name>/workouts/EXERCISE_MAPPING.md.")


if __name__ == "__main__":
    main()
