#!/usr/bin/env python3
"""Pull daily health metrics from Garmin Connect into data/YYYY-MM-DD_<type>.json.

Usage:
  python scripts/pull_health.py --days 14
  python scripts/pull_health.py --start 2026-05-13 --end 2026-06-12
  python scripts/pull_health.py --days 30 --types sleep,hrv,rhr
  python scripts/pull_health.py --days 7 --force

Types: sleep hrv rhr stress readiness training_status summary max_metrics body_battery bodycomp
race_predictions
(max_metrics carries VO2max; readiness returns Garmin's training-readiness list; race_predictions
is Garmin's own 5K / 10K / half / marathon prediction, one value a day, pulled only for an athlete
with a race season — athletes/<name>/races.json.)

Caching: a file already in data/ is skipped unless its date is today/yesterday
(still mutable) or --force is given. Exits non-zero if ANY pull failed — never
silently partial (CLAUDE.md rule).
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys

import athlete
from garmin_client import get_client, save_json, throttled

# The current athlete's cache — data/<name>/, never a shared data/.
A = athlete.current()
DATA_DIR = A.data_dir

PER_DAY_TYPES = {
    "sleep": "get_sleep_data",
    "hrv": "get_hrv_data",
    "rhr": "get_rhr_day",
    "stress": "get_stress_data",
    "readiness": "get_training_readiness",
    "training_status": "get_training_status",
    "summary": "get_user_summary",
    "max_metrics": "get_max_metrics",
}
BODY_BATTERY = "body_battery"
BODYCOMP = "bodycomp"  # weight / body composition (range call -> data/bodycomp.json)
RACE_PREDICTIONS = "race_predictions"  # Garmin's race predictor, daily (range call -> data/race_predictions.json)
ALL_TYPES = [*PER_DAY_TYPES, BODY_BATTERY, BODYCOMP, RACE_PREDICTIONS]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--days", type=int, help="last N days including today")
    g.add_argument("--start", help="YYYY-MM-DD (requires --end)")
    p.add_argument("--end", help="YYYY-MM-DD")
    p.add_argument("--types", default=",".join(ALL_TYPES), help=f"comma list of: {' '.join(ALL_TYPES)}")
    p.add_argument("--force", action="store_true", help="re-pull even if cached")
    a = p.parse_args()
    if a.start and not a.end:
        p.error("--start requires --end")
    return a


def main() -> None:
    args = parse_args()
    today = dt.date.today()
    if args.days:
        start, end = today - dt.timedelta(days=args.days - 1), today
    else:
        start, end = dt.date.fromisoformat(args.start), dt.date.fromisoformat(args.end)

    types = [t.strip() for t in args.types.split(",") if t.strip()]
    unknown = [t for t in types if t not in ALL_TYPES]
    if unknown:
        sys.exit(f"Unknown types {unknown}; valid: {ALL_TYPES}")

    client = get_client()
    mutable_from = today - dt.timedelta(days=1)  # today/yesterday can still change
    days = [start + dt.timedelta(days=i) for i in range((end - start).days + 1)]
    pulled = skipped = 0
    failures: list[str] = []

    for day in days:
        ds = day.isoformat()
        for t in (t for t in types if t in PER_DAY_TYPES):
            path = DATA_DIR / f"{ds}_{t}.json"
            if path.exists() and not args.force and day < mutable_from:
                skipped += 1
                continue
            try:
                save_json(path, throttled(getattr(client, PER_DAY_TYPES[t]), ds))
                pulled += 1
            except Exception as e:  # collect and keep pulling; reported at the end
                failures.append(f"{ds} {t}: {type(e).__name__}: {e}")

    if BODY_BATTERY in types:
        try:
            for item in client.get_body_battery(start.isoformat(), end.isoformat()) or []:
                d = item.get("date") or item.get("calendarDate")
                if d:
                    save_json(DATA_DIR / f"{d}_body_battery.json", item)
                    pulled += 1
        except Exception as e:
            failures.append(f"body_battery {start}..{end}: {type(e).__name__}: {e}")

    if BODYCOMP in types:
        try:
            # weigh-ins are sparse — always look back >=365d so a short daily pull
            # doesn't overwrite the cache with an empty window
            bc_start = min(start, end - dt.timedelta(days=365))
            save_json(DATA_DIR / "bodycomp.json", client.get_body_composition(bc_start.isoformat(), end.isoformat()))
            pulled += 1
        except Exception as e:
            failures.append(f"bodycomp {start}..{end}: {type(e).__name__}: {e}")

    # Garmin's own predicted 5K / 10K / half / marathon times, the number a run race's target is held
    # against (docs/DESIGN.md (races), phase 6). Only for an athlete with a race season: nobody else reads it,
    # and an account that has never run is not made to fail its refresh over it. The range call takes
    # at most a year, and a short daily pull must not shrink the history the trend is drawn from, so it
    # always asks for the full year ending at `end` — like bodycomp above.
    if RACE_PREDICTIONS in types and A.races_path.exists():
        rp_start = end - dt.timedelta(days=364)
        try:
            save_json(DATA_DIR / "race_predictions.json",
                      throttled(client.get_race_predictions, rp_start.isoformat(), end.isoformat(), "daily"))
            pulled += 1
        except Exception as e:
            failures.append(f"race_predictions {rp_start}..{end}: {type(e).__name__}: {e}")

    print(f"pulled={pulled} skipped_cached={skipped} range={start}..{end} types={','.join(types)}")
    if failures:
        print("\nFAILURES — do not analyze as if this data exists:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
