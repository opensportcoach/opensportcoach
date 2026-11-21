#!/usr/bin/env python3
"""Pull activities (list + per-activity detail) from Garmin Connect into data/.

Usage:
  python scripts/pull_activities.py --days 90
  python scripts/pull_activities.py --start 2026-03-01 --end 2026-06-12 --details all
  python scripts/pull_activities.py --days 7 --details none

Saves:
  data/activities_<start>_<end>.json   activity summaries (type, duration, HR, pace, load)
  data/scheduled.json                  the calendar on the watch now, this month and next, each entry once:
                                       only a window that reaches today refreshes it, so a backfill leaves
                                       it as it was
  data/activity_<id>_sets.json         strength sets/reps/weights  (--details strength|all)
  data/activity_<id>_splits.json       laps for endurance, with swim lengths   (--details all)
  data/activity_<id>_details.json      every recorded channel + the route      (--details all)
  rides and runs also (--details all, docs/DESIGN.md (rides and runs) §2.2):
  data/activity_<id>_full.json         Garmin's own NP / IF / TSS, run dynamics, the summary in full
  data/activity_<id>_hrzones.json      THIS activity's heart-rate zone bounds (they differ per sport)
  data/activity_<id>_powerzones.json   its power zone bounds, when it has power
  data/activity_<id>_weather.json      temperature and humidity, outdoors only
  data/thresholds.json                 FTP and lactate threshold, refreshed weekly
  a multisport activity also (--details all, docs/DESIGN.md (races) phase 6):
  data/activity_<id>_full.json         the parent's record, which names its legs (child activities)
  data/activity_<leg>_full.json        each leg's summary: its sport and its time
  data/activity_<leg>_splits.json      each leg's laps
  and a circuit (indoor cardio, HIIT, cardio) its laps beside its sets: a HYROX's splits are read from them

Backfill (decided 2026-10-09): these are pulled for activities INSIDE the window only, so history
needs one long run per athlete:  python scripts/pull_activities.py --athlete <name> --days 90

Default --details all (2026-10-08, docs/DESIGN.md (the app)): the app opens every workout down to its laps and
its heart-rate trace, so they are pulled with everything else. Per-activity files are cached
forever (activities are immutable once synced) unless --force, so each costs one call, once.
Sets are core data: a failure there exits non-zero. Laps and heart-rate traces only feed the app's
detail pages: a failure there is named on stderr but does not fail the refresh.
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys

import json

import athlete
import sports
from garmin_client import get_client, read_scheduled_workouts, save_json, throttled

# The current athlete's cache — data/<name>/, never a shared data/.
DATA_DIR = athlete.current().data_dir


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--days", type=int, help="last N days including today")
    g.add_argument("--start", help="YYYY-MM-DD (requires --end)")
    p.add_argument("--end", help="YYYY-MM-DD")
    p.add_argument("--details", choices=["strength", "all", "none"], default="all")
    p.add_argument("--force", action="store_true")
    a = p.parse_args()
    if a.start and not a.end:
        p.error("--start requires --end")
    return a


SET_BEARING = sports.SET_BEARING


def _thresholds(client, misses: list[str]) -> None:
    """FTP and lactate threshold (HR, pace), cached in thresholds.json and refreshed weekly. The
    athlete's manual values in athlete.json → profile win over these (docs/DESIGN.md (rides and runs), D2)."""
    path = DATA_DIR / "thresholds.json"
    if path.exists():
        try:
            pulled = dt.date.fromisoformat(json.loads(path.read_text()).get("pulled", "1970-01-01"))
            if (dt.date.today() - pulled).days < 7:
                return
        except (ValueError, json.JSONDecodeError):
            pass
    out: dict = {"pulled": dt.date.today().isoformat()}
    for key, fn in (("ftp", client.get_cycling_ftp), ("lactate", client.get_lactate_threshold)):
        try:
            out[key] = throttled(fn)
        except Exception as e:  # noqa: BLE001 — named, never silent; a device without it is normal
            misses.append(f"thresholds {key}: {type(e).__name__}: {e}")
            out[key] = None
    save_json(path, out)


def main() -> None:
    args = parse_args()
    today = dt.date.today()
    if args.days:
        start, end = today - dt.timedelta(days=args.days - 1), today
    else:
        start, end = dt.date.fromisoformat(args.start), dt.date.fromisoformat(args.end)

    client = get_client()
    acts = client.get_activities_by_date(start.isoformat(), end.isoformat()) or []
    save_json(DATA_DIR / f"activities_{start}_{end}.json", acts)
    by_type: dict[str, int] = {}
    for a in acts:
        k = (a.get("activityType") or {}).get("typeKey", "?")
        by_type[k] = by_type.get(k, 0) + 1
    print(f"{len(acts)} activities {start}..{end}: " + ", ".join(f"{k}={v}" for k, v in sorted(by_type.items())))

    failures: list[str] = []      # core data missing: exit non-zero
    detail_misses: list[str] = []  # app-only detail missing: named, not fatal
    n_sets = n_splits = n_details = n_extra = 0

    def pull(path, fn, aid, label, core):
        # --force re-pulls set files (exercise names can be confirmed after the sync); laps and
        # heart-rate traces never change once synced, so they are pulled exactly once.
        if path.exists() and (not args.force or not core):
            return 0
        try:
            save_json(path, throttled(fn, aid))
            return 1
        except Exception as e:  # noqa: BLE001 — named below, never silent
            (failures if core else detail_misses).append(f"{aid} {label}: {type(e).__name__}: {e}")
            return 0

    if args.details != "none":
        for a in acts:
            aid = a["activityId"]
            tkey = (a.get("activityType") or {}).get("typeKey", "?")
            # 2026-08-30: NOT just strength. He logged the Hyrox as `indoor_cardio` and
            # picked a real Garmin exercise for every station — RUN/RUN_OR_WALK, SLED/PUSH,
            # ROW/INDOOR_ROW, CARRY/FARMERS_CARRY. Those keys are the only way to grow
            # EXERCISE_CATALOG, and this filter was silently throwing them away.
            if tkey in SET_BEARING:
                n_sets += pull(DATA_DIR / f"activity_{aid}_sets.json", client.get_activity_exercise_sets,
                               aid, "sets", core=True)
            # A circuit's laps too (docs/DESIGN.md (races) phase 6): a HYROX on a cardio profile is split by the lap
            # button, one lap per run and per station, and its result's splits are read from them.
            if args.details == "all" and (tkey not in SET_BEARING or tkey in sports.CIRCUIT):
                n_splits += pull(DATA_DIR / f"activity_{aid}_splits.json", client.get_activity_splits,
                                 aid, "splits", core=False)
            if args.details == "all":
                n_details += pull(DATA_DIR / f"activity_{aid}_details.json", client.get_activity_details,
                                  aid, "streams", core=False)
            if args.details == "all" and sports.group(tkey) in ("bike", "run"):
                extra = [("full", client.get_activity), ("hrzones", client.get_activity_hr_in_timezones)]
                if a.get("avgPower"):
                    extra.append(("powerzones", client.get_activity_power_in_timezones))
                if sports.outdoors(tkey):
                    extra.append(("weather", client.get_activity_weather))
                for name, fn in extra:
                    n_extra += pull(DATA_DIR / f"activity_{aid}_{name}.json", fn, aid, name, core=False)
            # A multisport activity (a triathlon; a HYROX on a repeating multisport) is only its parent in
            # the list. Its legs are child activities that the parent's own record names (sports.legs):
            # each leg's summary and laps, which a race result's splits are read from (races.py → splits).
            if args.details == "all" and tkey == sports.MULTISPORT:
                n_extra += pull(DATA_DIR / f"activity_{aid}_full.json", client.get_activity, aid, "full", core=False)
                parent = DATA_DIR / f"activity_{aid}_full.json"
                for leg in sports.legs(json.loads(parent.read_text()) if parent.exists() else None):
                    for name, fn in (("full", client.get_activity), ("splits", client.get_activity_splits)):
                        n_extra += pull(DATA_DIR / f"activity_{leg}_{name}.json", fn, leg, f"leg {name}", core=False)

    print(f"detail pulls: {n_sets} strength set files, {n_splits} split files, {n_details} streams, "
          f"{n_extra} ride/run/multisport extras")
    if args.details == "all":
        _thresholds(client, detail_misses)
    if detail_misses:
        print("app detail not pulled (laps / heart-rate traces — the rest of the data is complete):",
              file=sys.stderr)
        for m in detail_misses:
            print(f"  - {m}", file=sys.stderr)

    # scheduled workouts (today's month + next) -> data/scheduled.json: what is on the watch NOW, which the
    # app's Today card and the coach read as that. So only a window that reaches today refreshes it, and
    # from today's months, never the window's. 2026-10-15: a backfill of one race day (--end 2025-06-01)
    # replaced it with June and July's calendar, empty, until the next refresh.
    # Read through garmin_client, like every calendar read. A month's view runs a week into each neighbour
    # (2026-10-16: September's held 08-25 .. 10-07, and nine of its entries came back from October's too), so
    # an entry in the overlap comes back from both views. read_scheduled_workouts dedupes by schedule id; this
    # loop did not, and the app's week view and calendar would have shown such an entry twice.
    if end < today:
        print(f"scheduled workouts: calendar left as it was (the window ends {end}, before today)")
    else:
        try:
            sched = read_scheduled_workouts(client, today, before=0, after=1)
            save_json(DATA_DIR / "scheduled.json", sched)
            print(f"scheduled workouts cached: {len(sched)}")
        except Exception as e:
            failures.append(f"scheduled: {type(e).__name__}: {e}")

    # A session the athlete also imported from a file or read from Strava is now Garmin's (sources.py).
    import sources
    dropped = sources.reconcile(athlete.current())
    if dropped:
        print(f"duplicates: {len(dropped)} imported copy(ies) of a Garmin session removed")

    if failures:
        print("\nFAILURES — do not analyze as if this data exists:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
