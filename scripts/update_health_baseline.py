#!/usr/bin/env python3
"""Regenerate athletes/<name>/HEALTH_BASELINE.md from the athlete's cached pulls (no Garmin calls).

The workflow says baselines are recomputed on every sync — in practice the
manual upkeep drifted (found 2026-07-16: window still said May→June). This
script makes it mechanical: it rewrites the header + metrics table + weekly
training volume table, and PRESERVES the curated sections verbatim
("## Race recovery trace..." and "## Notes" — dated interpretation rules like
the summer-heat HRV rule live there and must never be clobbered).

Usage: python scripts/update_health_baseline.py [--end YYYY-MM-DD]
"""
from __future__ import annotations

import argparse
import datetime as dt
from collections import defaultdict
from pathlib import Path

import athlete
from export_dashboard_data import (ATL_TAU, CTL_TAU, all_activities, daterange,
                                   load, readiness_of, rhr_of)

OUT = athlete.current().root / "HEALTH_BASELINE.md"
PRESERVE = ("## Race recovery trace", "## Notes")


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 1) if xs else None


def build_tables(end: dt.date) -> str:
    days30 = [d.isoformat() for d in daterange(end - dt.timedelta(days=29), end)]
    days14 = days30[-14:]

    hrv = {d: (load(f"{d}_hrv.json") or {}).get("hrvSummary", {}) for d in days30}
    hrv_vals = [hrv[d].get("lastNightAvg") for d in days30]
    hrv_mean = mean(hrv_vals)
    latest_hrv = next((hrv[d] for d in reversed(days30) if hrv[d].get("lastNightAvg")), {})
    band = latest_hrv.get("baseline") or {}
    band_s = f"{band.get('balancedLow', '?')}–{band.get('balancedUpper', '?')}"

    rhr_mean = mean([rhr_of(d) for d in days30])

    sleep = {d: (load(f"{d}_sleep.json") or {}).get("dailySleepDTO") or {} for d in days14}
    score = mean([((sleep[d].get("sleepScores") or {}).get("overall") or {}).get("value") for d in days14])
    hours = mean([sleep[d]["sleepTimeSeconds"] / 3600 for d in days14 if sleep[d].get("sleepTimeSeconds")])

    stress = mean([(load(f"{d}_stress.json") or {}).get("avgStressLevel") for d in days30])

    ready_day = next((d for d in reversed(days30) if readiness_of(d)), None)
    ready = readiness_of(ready_day) if ready_day else {}

    ts = load(f"{days30[-1]}_training_status.json") or load(f"{ready_day}_training_status.json") or {}
    vo2 = ts.get("mostRecentVO2Max") or {}
    vo2_run = (vo2.get("generic") or {}).get("vo2MaxPreciseValue")
    vo2_bike = (vo2.get("cycling") or {}).get("vo2MaxPreciseValue")

    acts = all_activities()
    load_by_day = defaultdict(float)
    for a in acts:
        load_by_day[a["startTimeLocal"][:10]] += a.get("activityTrainingLoad") or 0
    first = min((dt.date.fromisoformat(a["startTimeLocal"][:10]) for a in acts), default=end)
    ctl = atl = 0.0
    for d in daterange(first, end):
        L = load_by_day.get(d.isoformat(), 0.0)
        ctl += (L - ctl) / CTL_TAU
        atl += (L - atl) / ATL_TAU
    tsb = ctl - atl

    today = end.isoformat()
    header = (
        "# HEALTH_BASELINE\n\n"
        f"> Rolling baselines, recomputed by `scripts/update_health_baseline.py` (run it after the\n"
        f"> daily pulls). Window: **{days30[0]} → {days30[-1]}** (30d; sleep 14d). Curated sections\n"
        f"> below the tables are preserved verbatim — edit those by hand only.\n\n"
    )
    table = (
        "| Metric | Baseline | Window | Last updated |\n|---|---|---|---|\n"
        f"| HRV (overnight avg) | **{hrv_mean} ms** (Garmin band {band_s}; weekly avg "
        f"{latest_hrv.get('weeklyAvg', '?')}; {latest_hrv.get('status', '?')} — summer values, see heat note) | 30d | {today} |\n"
        f"| Resting HR | **{rhr_mean} bpm** | 30d | {today} |\n"
        f"| Sleep score avg | **{score}** | 14d | {today} |\n"
        f"| Sleep duration avg | **{hours} h** | 14d | {today} |\n"
        f"| VO2max running | **{vo2_run}** | spot | {today} |\n"
        f"| VO2max cycling | **{vo2_bike}** | spot | {today} |\n"
        f"| Training readiness | **{ready.get('score', '?')} {ready.get('level', '')}** ({ready_day}) | spot | {today} |\n"
        f"| Avg stress | **{stress}** | 30d | {today} |\n"
        f"| Fitness model | CTL {ctl:.1f} / ATL {atl:.1f} / **TSB {tsb:+.1f}** | spot | {today} |\n\n"
    )

    weekly = defaultdict(lambda: defaultdict(float))
    grp_of = {"cycling": "bike", "virtual_ride": "bike", "gravel_cycling": "bike", "road_biking": "bike",
              "running": "run", "treadmill_running": "run", "trail_running": "run",
              "lap_swimming": "swim", "open_water_swimming": "swim",
              "strength_training": "strength", "multi_sport": "race"}
    wk_load = defaultdict(float)
    for a in acts:
        iso = dt.date.fromisoformat(a["startTimeLocal"][:10]).isocalendar()
        wk = f"{iso[0]}-W{iso[1]:02d}"
        grp = grp_of.get((a.get("activityType") or {}).get("typeKey", ""))
        if grp:
            weekly[wk][grp] += (a.get("duration") or 0) / 3600
        wk_load[wk] += a.get("activityTrainingLoad") or 0
    rows = []
    for wk in sorted(weekly)[-8:]:
        w = weekly[wk]
        total = sum(w.values())
        rows.append(f"| {wk.split('-')[1]} | {total:.1f} | {w.get('bike', 0):.1f} | {w.get('run', 0):.1f} "
                    f"| {w.get('swim', 0):.1f} | {w.get('strength', 0):.1f} | {wk_load[wk]:.0f} |")
    vol = ("## Weekly training volume (hours, last 8 ISO weeks)\n\n"
           "| Week | Total | Bike | Run | Swim | Strength | Load |\n|---|---|---|---|---|---|---|\n"
           + "\n".join(rows) + "\n\n")
    return header + table + vol


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--end")
    args = p.parse_args()
    end = dt.date.fromisoformat(args.end) if args.end else dt.date.today()

    preserved = ""
    if OUT.exists():
        text = OUT.read_text()
        idx = min((text.find(h) for h in PRESERVE if text.find(h) >= 0), default=-1)
        # keep from the FIRST curated heading onwards, minus any auto section
        # (weekly volume) that sits between curated ones
        if idx >= 0:
            tail = text[idx:]
            # drop a stale auto weekly-volume section if it slipped into the tail
            wv = tail.find("## Weekly training volume")
            if wv >= 0:
                nxt = tail.find("## ", wv + 3)
                tail = tail[:wv] + (tail[nxt:] if nxt >= 0 else "")
            preserved = tail

    OUT.write_text(build_tables(end) + preserved)
    print(f"wrote {OUT} (window ending {end}; curated sections preserved: {bool(preserved)})")


if __name__ == "__main__":
    main()
