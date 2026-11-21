#!/usr/bin/env python3
"""Prune the local `data/` pull cache. DRY RUN unless --yes is given.

POLICY (2026-08-14 audit, P3-11). `data/` is a **cache, not an archive**: every file
is re-pullable from Garmin with `pull_health.py` / `pull_activities.py` over any date
range. It was 33 MB / 943 files and growing ~20 files a day with no policy at all.

What is safe to prune, and what is not:

  * PER-DAY HEALTH files (`YYYY-MM-DD_<type>.json`) age out cleanly. The rolling
    baselines only look back 30 days, and anything older is already condensed into
    HEALTH_BASELINE.md and the committed dashboard.json.
  * PER-ACTIVITY files (`activity_<id>_sets.json` / `_splits.json`) are the substrate
    for MULTI-SESSION progression trends, which is the whole basis of how lifts are
    judged (CLAUDE.md workflow 2). They are small and irreplaceable in aggregate.
    **Kept by default** — pass --include-activities only if you truly mean it.

Default retention is 120 days, comfortably longer than the 30-day baseline window and
the ~8 weeks of history the volume analyses reach back over.

Usage:
  python scripts/prune_data.py                      # dry run, 120d
  python scripts/prune_data.py --days 90 --yes
  python scripts/prune_data.py --days 365 --include-activities --yes
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

# Only the current athlete's cache is ever pruned.
DATA = athlete.current().data_dir
DATED = re.compile(r"^(\d{4}-\d{2}-\d{2})_")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=120, help="keep files newer than this (default 120)")
    ap.add_argument("--include-activities", action="store_true",
                    help="ALSO prune per-activity files — these feed multi-session progression trends")
    ap.add_argument("--yes", action="store_true", help="actually delete (otherwise dry run)")
    args = ap.parse_args()

    cutoff = dt.date.today() - dt.timedelta(days=args.days)
    victims, kept_activities = [], 0

    for f in sorted(DATA.glob("*.json")):
        m = DATED.match(f.name)
        if m:
            if dt.date.fromisoformat(m.group(1)) < cutoff:
                victims.append(f)
        elif f.name.startswith("activity_"):
            if args.include_activities:
                # activity files carry no date in the name; fall back to mtime
                if dt.date.fromtimestamp(f.stat().st_mtime) < cutoff:
                    victims.append(f)
            else:
                kept_activities += 1
        # everything else (bodycomp.json, scheduled.json, workouts_list.json) is a
        # live snapshot that gets overwritten, never accumulated — leave it alone.

    freed = sum(f.stat().st_size for f in victims)
    print(f"cutoff {cutoff} ({args.days}d)")
    print(f"  {len(victims)} files to remove, {freed / 1e6:.1f} MB")
    if kept_activities:
        print(f"  {kept_activities} per-activity files KEPT (progression trends) — --include-activities to prune")

    if not args.yes:
        print("\nDRY RUN — nothing deleted. Re-run with --yes to apply.")
        for f in victims[:10]:
            print(f"    would remove {f.name}")
        if len(victims) > 10:
            print(f"    ... and {len(victims) - 10} more")
        return

    for f in victims:
        f.unlink()
    remaining = sum(x.stat().st_size for x in DATA.glob("*.json"))
    print(f"\nremoved {len(victims)} files; data/ now {remaining / 1e6:.1f} MB")
    print("Anything pruned is re-pullable: pull_health.py / pull_activities.py --start … --end …")


if __name__ == "__main__":
    main()
