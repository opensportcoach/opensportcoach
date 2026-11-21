#!/usr/bin/env python3
"""What the bound athlete's cached rides and runs actually record — key NAMES and counts, never values.

WHY (docs/DESIGN.md (rides and runs) §2.1, 2026-10-09): the endurance screens and the review are built on fields
Garmin may or may not send — power needs a power meter, run dynamics a chest strap or pod, a Zwift
ride has fictional coordinates, a cadence key differs between the summary and the laps. Building on
a guess is how a lookup silently defaults (CLAUDE.md, "When something looks wrong" #1). So: count
first, per athlete, in their own session.

Usage: python scripts/activity_fields.py [--days 120] [--json]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

A = athlete.current()
import export_dashboard_data as ed  # noqa: E402

ENDURANCE = ("bike", "run")
EXTRAS = ("full", "hrzones", "powerzones", "weather")   # pull_activities.py, per ride and run
# The summary fields the plan relies on — reported present/absent even when no activity has them.
WATCH = ("avgPower", "maxPower", "normPower", "max20MinPower", "trainingStressScore", "intensityFactor",
         "averageBikingCadenceInRevPerMinute", "averageRunningCadenceInStepsPerMinute", "avgStrideLength",
         "avgGroundContactTime", "avgVerticalOscillation", "elevationGain",
         "powerTimeInZone_1", "hrTimeInZone_1")


def inventory(days: int = 120) -> dict:
    since = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    acts = [a for a in ed.all_activities()
            if a.get("startTimeLocal", "")[:10] >= since
            and ed.SPORT_GROUP.get((a.get("activityType") or {}).get("typeKey", ""), "other") in ENDURANCE]
    out: dict = {"athlete": A.display, "since": since, "activities": len(acts), "by_type": Counter(),
                 "virtual": 0, "summary_keys": Counter(), "with_splits": 0, "lap_keys": Counter(),
                 "with_details": 0, "detail_channels": Counter(), "with_route": 0,
                 "extras": Counter({k: 0 for k in EXTRAS})}
    for a in acts:
        typ = (a.get("activityType") or {}).get("typeKey", "")
        out["by_type"][typ] += 1
        out["virtual"] += "virtual" in typ
        out["summary_keys"].update(k for k in WATCH if a.get(k) is not None)
        aid = a["activityId"]
        splits = ed.load(f"activity_{aid}_splits.json")
        if splits:
            out["with_splits"] += 1
            keys = set()
            for lap in splits.get("lapDTOs") or []:
                keys |= {k for k, v in lap.items() if v is not None}
            out["lap_keys"].update(keys)
        out["extras"].update(k for k in EXTRAS if (A.data_dir / f"activity_{aid}_{k}.json").exists())
        details = ed.load(f"activity_{aid}_details.json")
        if details:
            out["with_details"] += 1
            out["detail_channels"].update(d.get("key") for d in details.get("metricDescriptors") or [])
            poly = (details.get("geoPolylineDTO") or {}).get("polyline") or []
            out["with_route"] += bool(poly)
    out["thresholds"] = (A.data_dir / "thresholds.json").exists()
    for k in ("by_type", "summary_keys", "lap_keys", "detail_channels", "extras"):
        out[k] = dict(sorted(out[k].items(), key=lambda kv: (-kv[1], kv[0])))
    out["summary_missing"] = [k for k in WATCH if k not in out["summary_keys"]]
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--days", type=int, default=120)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    inv = inventory(args.days)
    if args.json:
        print(json.dumps(inv, indent=1))
        return
    n = inv["activities"]
    print(f"{inv['athlete']} — {n} rides and runs since {inv['since']} ({inv['virtual']} virtual)")
    print("  types:          " + ", ".join(f"{k} {v}" for k, v in inv["by_type"].items()))
    print("  summary has:    " + ", ".join(f"{k} {v}/{n}" for k, v in inv["summary_keys"].items()))
    print("  summary never:  " + (", ".join(inv["summary_missing"]) or "—"))
    print(f"  laps:           {inv['with_splits']}/{n} — keys: " + ", ".join(f"{k} {v}" for k, v in inv["lap_keys"].items()))
    print(f"  details:        {inv['with_details']}/{n} — channels: " + ", ".join(f"{k} {v}" for k, v in inv["detail_channels"].items()))
    print(f"  route polyline: {inv['with_route']}/{inv['with_details']} of those with details")
    print("  extras:         " + ", ".join(f"{k} {v}/{n}" for k, v in inv["extras"].items())
          + f" · thresholds {'cached' if inv['thresholds'] else 'not pulled yet'}")


if __name__ == "__main__":
    main()
