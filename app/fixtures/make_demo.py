#!/usr/bin/env python3
"""Build the synthetic Demo athlete ("Rocky") and write the app's fixtures FROM THE REAL ENGINE.

    .venv/bin/python app/fixtures/make_demo.py            # writes app/fixtures/demo/
    .venv/bin/python app/fixtures/make_demo.py --keep /tmp/demo-root   # also keep the athlete tree

WHY (2026-10-08, docs/DESIGN.md (the app) → Phase 2). The design session and the UI work must never see a real
athlete's data, and hand-written fixtures drift from what the app really receives. So this scaffolds a
fake athlete with the real tools (new_athlete.py, build_workouts.py), writes a synthetic Garmin cache
in the real file formats, runs the real export and the real views (app_data.py) over it, and saves
what they return. Coach results — which the coach writes, not the engine — are written here and
checked against app/contracts/ like any real one.

Everything happens in a temp folder through OSC_ATHLETES_ROOT / OSC_DATA_ROOT: the real
athletes are never read or touched. Seeded, so the same day gives the same data.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PY = str(REPO / ".venv" / "bin" / "python")
NAME, DISPLAY = "demo", "Rocky"
# Real Zwift workouts, read off their pages with scripts/zwift_workouts.py (2026-11-05): every planned
# Zwift ride names one (memory/convention/zwift-workout-named.md), the demo's too.
ZWIFT = {
    "vo2": {"name": "VO2 Max 3x3", "url": "https://whatsonzwift.com/workouts/vo2-max/vo2-max-3x3", "collection": "VO2 Max",
            "duration_min": 38, "stress_points": 47, "adjust": "Add two more 3′ reps after the third, with 3′ easy between."},
    "long": {"name": "Cadence Kicks XL", "url": "https://whatsonzwift.com/workouts/endurance/cadence-kicks-xl", "collection": "Endurance",
             "duration_min": 110, "stress_points": 73},
}
TODAY = dt.date.today()
# --sparse: a NEW athlete — twelve days of data, three sessions, HRV still calibrating, no weigh-ins,
# no daily yet. The design's Today-NewAthlete board; one of the two real athletes is new.
SPARSE = False

# --- the program -----------------------------------------------------------------------------
PROGRAM_PY = '''"""Rocky's program — SYNTHETIC, for the app's fixtures (app/fixtures/make_demo.py)."""
from __future__ import annotations

BLOCK = {{"name": "Hypertrophy", "start": "{block_start}", "weeks": 16}}

PROGRAM: dict[str, dict] = {{
    "d1": {{"name": "D1 · Push", "desc": "Chest, shoulders, triceps", "exercises": [
        ("D1E1", "Bench press", "BENCH_PRESS", "BARBELL_BENCH_PRESS", 4, 8, 80.0, 150, "reps"),
        ("D1E2", "Incline DB press", "BENCH_PRESS", "INCLINE_DUMBBELL_BENCH_PRESS", 3, 10, 26.0, 120, "reps"),
        ("D1E3", "Seated DB press", "SHOULDER_PRESS", "SEATED_DUMBBELL_SHOULDER_PRESS", 3, 10, 20.0, 120, "reps"),
        ("D1E4", "Lateral raise", "LATERAL_RAISE", "DUMBBELL_LATERAL_RAISE", 3, 15, 10.0, 75, "reps"),
        ("D1E5", "Cable crossover", "FLYE", "CABLE_CROSSOVER", 3, 12, 15.0, 75, "reps"),
        ("D1E6", "Rope pressdown", "TRICEPS_EXTENSION", "ROPE_PRESSDOWN", 3, 12, 32.0, 75, "reps"),
    ]}},
    "d2": {{"name": "D2 · Pull", "desc": "Back, biceps", "exercises": [
        ("D2E1", "Lat pulldown", "PULL_UP", "CLOSE_GRIP_LAT_PULLDOWN", 4, 10, 65.0, 120, "reps"),
        ("D2E2", "Barbell row", "ROW", "BARBELL_ROW", 4, 8, 70.0, 150, "reps"),
        ("D2E3", "One-arm DB row", "ROW", "DUMBBELL_ROW", 3, 10, 30.0, 90, "reps"),
        ("D2E4", "DB curl", "CURL", "DUMBBELL_BICEPS_CURL", 3, 12, 14.0, 75, "reps"),
    ]}},
    "d3": {{"name": "D3 · Legs", "desc": "Quads, hamstrings, calves", "exercises": [
        ("D3E1", "Back squat", "SQUAT", "BARBELL_BACK_SQUAT", 4, 8, 100.0, 180, "reps"),
        ("D3E2", "Romanian deadlift", "DEADLIFT", "ROMANIAN_DEADLIFT", 3, 10, 90.0, 150, "reps"),
        ("D3E3", "Leg press", "SQUAT", "LEG_PRESS", 3, 12, 120.0, 120, "reps"),
        ("D3E4", "Leg curl", "LEG_CURL", "LEG_CURL", 3, 12, 45.0, 90, "reps"),
        ("D3E5", "Standing calf raise", "CALF_RAISE", "STANDING_CALF_RAISE", 4, 15, 60.0, 60, "reps"),
    ]}},
}}
'''
# What the Program screen explains (scripts/app_data.py, "program (board Program v2)"): every name
# optional, so the sparse athlete leaves them all out and the screen must still make sense.
PROGRAM_EXTRAS_PY = '''
SESSION_CAP_MIN = 75
LEAD = {{
    "d1": {{"minutes": 8, "block": [
        ("C1", "Plank", "PLANK", "PLANK", 3, 45, None, 45, "time"),
        ("C2", "Dead bug", "HIP_STABILITY", "DEAD_BUG", 2, 12, None, 45, "reps"),
    ]}},
    "d3": {{"minutes": 6, "block": [
        ("C3", "Ab wheel", "CORE", "KNEELING_AB_WHEEL", 3, 10, None, 45, "reps"),
    ]}},
}}
STEP_NOTES = {{"D1E1": "Warm up 60x8, 70x4 first"}}
WARMUPS = {{"D1E1": [(60.0, 8), (70.0, 4)]}}
WHY = {{
    "D1E1": "The day's main press — the strength anchor of the upper body.",
    "D1E4": "Side delts for shoulder width — isolation, last.",
    "D2E2": "Horizontal pull for the mid-back.",
    "D3E1": "First main lift: heavy quads and hips.",
    "D3E5": "Calves — isolation, last.",
    "C1": "Static brace; no spinal flexion.",
}}
REMOVED = [
    {{"name": "Behind-the-neck press", "day": "d1", "after": "D1E2", "removed_in": "medical",
      "reason": "Shoulder impingement — pressing stays in front of the head.", "replaced_by": ["Seated DB press"]}},
    {{"name": "Pec deck", "day": "d1", "after": "D1E4", "removed_in": "v2", "reason": "Cable crossover covers it."}},
]
VERSIONS = [
    {{"id": "v1", "date": "{v1}", "title": "Hypertrophy split", "rationale": "Three days, push · pull · legs.",
      "changes": [{{"kind": "structural", "text": "Three-day split", "why": "fits three gym days a week"}}]}},
    {{"id": "v2", "date": "{v2}", "title": "Core block on two days", "rationale": "A short anti-movement block opens D1 and D3.",
      "changes": [{{"kind": "added", "text": "Plank, dead bug, ab wheel", "why": "trunk stiffness for the big lifts"}},
                  {{"kind": "removed", "text": "Pec deck", "why": "cable crossover covers it"}}]}},
]
WEEK = {{
    "mon": [{{"day": "d1"}}],
    "tue": [{{"sport": "running", "title": "Run · easy", "detail": "Z2 · 40 min", "duration": "40 min"}}],
    "wed": [],
    "thu": [{{"day": "d2"}}],
    "fri": [{{"sport": "lap_swimming", "title": "Swim · technique", "detail": "1,500 m", "duration": "≈ 40 min"}}],
    "sat": [{{"day": "d3", "slot": "AM"}}, {{"sport": "virtual_ride", "platform": "zwift", "title": "Zwift · recovery spin", "slot": "PM", "duration": "30 min"}}],
    "sun": [{{"sport": "road_biking", "title": "Long ride", "detail": "60–75% FTP", "duration": "2:00"}}],
}}
WEEK_TARGETS = {{"minutes": [300, 420], "sets": [55, 75]}}
WEEK_FLOOR = {{"strength_training": {{"min": 3, "label": "Gym"}}, "running": 1, "lap_swimming": 1, "road_biking": {{"min": 1, "label": "Long ride"}}}}
RULES = [
    {{"key": "48 h", "label": "Legs never the day before the long ride", "detail": "Sat legs are AM; the long ride is Sunday.",
      "span": ["sat", "sun"], "mark": "48 h", "sport": "road_biking"}},
]
CARDIO = {{"start": "{arc_start}", "weeks": 4, "tracks": [
    {{"name": "Run", "sport": "running", "when": "Tue", "cells": [
        {{"title": "Easy 40′", "rx": "Z2"}}, {{"title": "Easy 45′", "rx": "Z2 + strides"}},
        {{"title": "Easy 50′", "rx": "Z2"}}, {{"title": "5 km time trial", "rx": "flat out", "benchmark": "5k"}}]}},
    {{"name": "Swim", "sport": "lap_swimming", "when": "Fri", "cells": [
        {{"title": "Technique 1,500", "rx": "drills"}}, {{"title": "CSS test", "rx": "400 + 200 TT", "benchmark": "css"}},
        {{"title": "Threshold 1,800", "rx": "at CSS"}}, {{"title": "Aerobic 2,000", "rx": "easy"}}]}},
], "notes": ["Long rides stay Z2 until the 5 km retest."]}}
BENCHMARKS = [
    {{"id": "css", "name": "Swim CSS", "sport": "lap_swimming", "due": "{css_due}", "unit": "/100 m", "results": []}},
    {{"id": "5k", "name": "5 km time trial", "sport": "running", "due": "{k5_due}", "unit": "min",
      "results": [{{"date": "{k5_last}", "value": "24:10"}}]}},
]
UNDER_ON_PURPOSE = {{"Calves": "two runs and a long ride load them"}}
'''
TWO_DB = [["BENCH_PRESS", "INCLINE_DUMBBELL_BENCH_PRESS"], ["SHOULDER_PRESS", "SEATED_DUMBBELL_SHOULDER_PRESS"],
          ["LATERAL_RAISE", "DUMBBELL_LATERAL_RAISE"], ["CURL", "DUMBBELL_BICEPS_CURL"]]
MACHINE = [["SQUAT", "LEG_PRESS"]]
PROGRESS_EVERY = {"D1E1": 1, "D2E1": 1, "D3E1": 2, "D1E4": None}   # weeks per load step; None = stuck
REGRESS_LATEST = {"D3E2"}
WEEKDAY_PLAN = {0: "d1", 1: "run", 3: "d2", 4: "swim", 5: "d3", 6: "ride"}   # Mon, Tue, Thu, Fri, Sat, Sun
# The season (docs/DESIGN.md (races) §6): a half run five or six weeks ago with its result, a 70.3 run since with
# its splits and a reference, a gravel race whose date a check found different (`differs`), and the A
# race the SEASON builds to. The events are synthetic, so none has a mark: the page draws the fallback.
# The sparse athlete has no races.
RACE_AID = 21_000_009_001   # the half's activity, apart from the day-by-day ids
# A 70.3 run three weeks ago (docs/DESIGN.md (races) phase 6): its multisport activity, and its legs as Garmin
# records them — sport, timer seconds, metres. The result's splits are read from these, never typed in.
TRI_AID = 21_000_009_002    # its legs take the ids after it
TRI_LEGS = (("open_water_swimming", 2085.4, 1900.0), ("transition_v2", 238.2, 310.0), ("road_biking", 9310.0, 90000.0),
            ("transition_v2", 161.8, 280.0), ("running", 7304.6, 21100.0))
SEASON_PY = '''
# The season to its A race (docs/DESIGN.md (races) §4): BLOCK is its first block.
SEASON = {{"race": "coastline-703", "blocks": [
    {{"name": "Hypertrophy", "start": "{b1}", "weeks": 16, "emphasis": "Upper-body size on an endurance base"}},
    {{"name": "Endurance base", "start": "{b2}", "weeks": 6, "emphasis": "Aerobic volume; the gravel race in week 2"}},
    {{"name": "Race build", "start": "{b3}", "weeks": 6, "emphasis": "Bricks, open water, then the taper"}},
]}}
'''


# The Demo athlete's swim and circuit, declared as any athlete's are (scripts/workout_dsl.py). The latest
# swim and the circuit below follow them, so their workout pages carry a review (scripts/session_review.py).
SESSIONS_PY = '''"""Rocky's swim and conditioning circuit — synthetic, for the app's fixtures."""
from workout_dsl import Repeat, Rest, Station, Swim, circuit_workout, swim_workout

WORKOUTS = {
    "swim_aerobic_1800": swim_workout("Swim · Aerobic 1800", "25 m pool. Even 100s, then a steady 400.", [
        Swim(300, "free", "Easy, long strokes", kind="warmup"), Rest(),
        Repeat(8, [Swim(100, "free", "Steady, same time each"), Rest(20)], skip_last_rest=True), Rest(),
        Swim(400, "free", "Steady, negative split"), Rest(),
        Swim(300, "backstroke", "Easy", kind="cooldown")], expect_m=1800),
    "circuit_conditioning": circuit_workout("Circuit · Conditioning", "Run, station, repeat. Lap to move on.", [
        Station("interval", "Run 1 km", ("RUN", "RUN_OR_WALK")),
        Station("interval", "Sled push 50 m", ("SLED", "PUSH"), kg=102),
        Station("interval", "Run 1 km", ("RUN", "RUN_OR_WALK")),
        Station("interval", "Row 1000 m", ("ROW", "INDOOR_ROW")),
        Station("interval", "Farmers carry 200 m", ("CARRY", "FARMERS_CARRY"), kg=48),
        Station("interval", "Run 1 km", ("RUN", "RUN_OR_WALK"))]),
}
'''
SWIM_WID, CIRCUIT_WID = 4201, 4301


def env_for(root: Path) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("OSC_")}
    env.update(OSC_ATHLETES_ROOT=str(root / "athletes"), OSC_DATA_ROOT=str(root / "data"), OSC_ATHLETE=NAME)
    return env


def run(args: list[str], env: dict) -> str:
    p = subprocess.run([PY, *args], cwd=REPO, env=env, capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit(f"{' '.join(args)} failed:\n{p.stdout}\n{p.stderr}")
    return p.stdout


def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")


def ms(day: dt.date, hh: int, mm: int) -> int:
    """Garmin's *Local epoch-ms: the local wall clock written as if it were UTC."""
    return int(dt.datetime(day.year, day.month, day.day, hh, mm, tzinfo=dt.timezone.utc).timestamp() * 1000)


# --- the athlete -------------------------------------------------------------------------------
def scaffold(root: Path, env: dict) -> Path:
    run(["scripts/new_athlete.py", NAME, "--display", DISPLAY], env)
    a = root / "athletes" / NAME
    cfg = json.loads((a / "athlete.json").read_text())
    cfg["garmin"] = {"display_name": f"demo-{DISPLAY.lower()}", "full_name": f"{DISPLAY} B."}
    cfg["managed_workouts"] = ["d1", "d2", "d3"]
    cfg["protected_workout_ids"] = [111, 112, 113]
    cfg["app"] = {"accent": "#9DC4EE"}
    cfg["profile"].update({
        "goal": "Hypertrophy with an endurance base", "weight_kg": 78.4, "weight_target_kg": [76, 78],
        "dumbbell_cap_kg": 40, "hrv_band": [54, 72], "hrv_baseline": 63, "rhr_baseline": 53,
        "key_lifts": {"Bench press": ["BENCH_PRESS", "BARBELL_BENCH_PRESS"],
                      "Back squat": ["SQUAT", "BARBELL_BACK_SQUAT"],
                      "d2/D2E2": "Barbell row", "d3/D3E2": "Romanian deadlift"},
        "cardio_targets": {"runs": 2, "swims": 1, "rides": 1, "cardio_load": [150, 250]},
    })
    if SPARSE:   # nothing calibrated yet
        for k in ("hrv_band", "hrv_baseline", "rhr_baseline", "weight_kg"):
            cfg["profile"].pop(k, None)
    dump(a / "athlete.json", cfg)
    (a / "sessions.py").write_text(SESSIONS_PY)
    block_start = (TODAY - dt.timedelta(weeks=0 if SPARSE else 13, days=TODAY.weekday())).isoformat()
    extras = "" if SPARSE else PROGRAM_EXTRAS_PY.format(
        v1=block_start, v2=(TODAY - dt.timedelta(days=20)).isoformat(),
        arc_start=(TODAY - dt.timedelta(days=TODAY.weekday() + 7)).isoformat(),
        css_due=(TODAY + dt.timedelta(days=4 - TODAY.weekday() % 7 + 7)).isoformat(),
        k5_due=(TODAY + dt.timedelta(days=15)).isoformat(), k5_last=(TODAY - dt.timedelta(days=40)).isoformat())
    (a / "program.py").write_text(PROGRAM_PY.format(block_start=block_start) + extras)
    if not SPARSE:   # 16 + 6 + 6 weeks: the A race is the last block's last day (race_dates)
        b1 = dt.date.fromisoformat(block_start)
        with (a / "program.py").open("a") as f:
            f.write(SEASON_PY.format(b1=b1, b2=b1 + dt.timedelta(weeks=16), b3=b1 + dt.timedelta(weeks=22)))
    rules = json.loads((a / "workouts" / "LOGGING_RULES.json").read_text())
    rules.update(two_db_weight_summed=TWO_DB, machine_added_load_only=MACHINE)
    dump(a / "workouts" / "LOGGING_RULES.json", rules)
    return a


def program_spec() -> dict:
    ns: dict = {}
    exec(PROGRAM_PY.format(block_start="2026-01-01"), ns)  # noqa: S102 — our own constant
    return ns["PROGRAM"]


# --- the cache ---------------------------------------------------------------------------------
def make_cache(data: Path, a: Path, rnd: random.Random) -> dict:
    start = TODAY - dt.timedelta(days=12 if SPARSE else 130)
    days = [start + dt.timedelta(days=i) for i in range((TODAY - start).days + 1)]
    prog = program_spec()
    acts, aid, scheduled_today = [], 21_000_000_000, []
    deload = {TODAY - dt.timedelta(weeks=5, days=TODAY.weekday() - d) for d in (0, 3, 5)}
    two_db = {tuple(x) for x in TWO_DB}
    annotations = {}

    hrv_hist: list = []
    for day in days:
        d = day.isoformat()
        # ---- health ----
        hrv = round(63 + rnd.gauss(0, 5) - (4 if day in deload else 0))
        hrv_hist.append(hrv)
        weekly = round(sum(hrv_hist[-7:]) / len(hrv_hist[-7:]))   # Garmin's weeklyAvg: the last 7 nights
        if not SPARSE or (TODAY - day).days < 4:
          # Garmin needs ~3 weeks before it gives a status or a balanced band: a new watch has neither.
          dump(data / f"{d}_hrv.json", {"hrvSummary": {"lastNightAvg": hrv, "weeklyAvg": None if SPARSE else weekly,
                                                    "status": "NONE" if SPARSE else "BALANCED",
                                                    "baseline": None if SPARSE else {"balancedLow": 54, "balancedUpper": 72}}})
        dump(data / f"{d}_rhr.json", {"allMetrics": {"metricsMap": {"WELLNESS_RESTING_HEART_RATE": [
            {"value": round(52 + rnd.gauss(0, 1.5))}]}}})
        sleep_s = int(max(5.2, min(8.8, 7.2 + rnd.gauss(0, 0.6))) * 3600)
        bed = rnd.randint(-40, 30)
        prev = day - dt.timedelta(days=1)
        start_ms = ms(prev, 23, 30) + bed * 60_000
        # The night as the watch stages it: sleepLevels (ISO GMT, codes 0 deep · 1 light · 2 REM ·
        # 3 awake) and heart rate (epoch ms), in UTC+2 — and the DTO's totals FROM that timeline, as
        # Garmin's are (tests prove the code table against them on real nights too).
        start_gmt = start_ms - 2 * 3600_000
        segs = _sleep_night(int(sleep_s * 1.06), rnd)
        totals = {0: 0, 1: 0, 2: 0, 3: 0}
        levels, t_ = [], start_gmt
        for code, secs in segs:
            iso = lambda m: dt.datetime.fromtimestamp(m / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.0")  # noqa: E731
            levels.append({"startGMT": iso(t_), "endGMT": iso(t_ + secs * 1000), "activityLevel": float(code)})
            totals[code] += secs
            t_ += secs * 1000
        hr_pts, t_ = [], start_gmt
        for code, secs in segs:
            for k in range(0, secs, 120):
                hr_pts.append({"startGMT": t_ + k * 1000, "value": round(52 + {0: -5, 1: 0, 2: 4, 3: 9}[code] + rnd.gauss(0, 1.5))})
            t_ += secs * 1000
        dump(data / f"{d}_sleep.json", {"dailySleepDTO": {
            "sleepTimeSeconds": totals[0] + totals[1] + totals[2], "sleepNeed": {"actual": 500},
            "sleepScores": {"overall": {"value": max(40, min(97, round(78 + (sleep_s / 3600 - 7.2) * 9 + rnd.gauss(0, 4))))}},
            "deepSleepSeconds": totals[0], "lightSleepSeconds": totals[1], "remSleepSeconds": totals[2],
            "awakeSleepSeconds": totals[3],
            "sleepStartTimestampLocal": start_ms, "sleepEndTimestampLocal": start_ms + (t_ - start_gmt),
            "sleepStartTimestampGMT": start_gmt, "sleepEndTimestampGMT": t_,
            "averageRespirationValue": round(14.4 + rnd.gauss(0, 0.3), 1), "averageSpO2Value": 96},
            "sleepLevels": levels, "sleepHeartRate": hr_pts, "avgOvernightHrv": hrv,
            "bodyBatteryChange": 40 + rnd.randint(0, 30), "restingHeartRate": min(p["value"] for p in hr_pts),
            "avgSkinTempDeviationC": round(rnd.gauss(0, 0.25), 1)})
        score = max(20, min(98, round(72 + (hrv - 63) * 1.6 + rnd.gauss(0, 6))))
        if not (SPARSE and day == TODAY):   # the new athlete's morning reading hasn't synced yet
          dump(data / f"{d}_readiness.json", [{"inputContext": "AFTER_WAKEUP_RESET", "timestamp": f"{d}T06:58:00.0",
                                            "score": score, "level": "HIGH" if score >= 75 else "MODERATE",
                                            "feedbackShort": "WELL_RECOVERED" if score >= 75 else "RECOVERING"}])
        dump(data / f"{d}_body_battery.json", {"charged": 55 + rnd.randint(0, 20), "drained": 30 + rnd.randint(0, 20)})
        if (TODAY - day).days < 7 and not SPARSE:
            dump(data / f"{d}_training_status.json", {
                "mostRecentTrainingStatus": {"latestTrainingStatusData": {"demo-device": {
                    "acuteTrainingLoadDTO": {"acwrPercent": 112}, "trainingStatusFeedbackPhrase": "PRODUCTIVE_6"}}},
                "mostRecentVO2Max": {"generic": {"vo2MaxPreciseValue": 49.2}, "cycling": {"vo2MaxPreciseValue": 51.4}}})

        # ---- training ----
        what = WEEKDAY_PLAN.get(day.weekday())
        if SPARSE and day == TODAY:
            what = "d1"   # the new athlete has already trained today: Today shows DONE, not the morning call
        elif day >= TODAY:
            continue
        if what is None or (what == "ride" and day.isocalendar()[1] % 2):
            continue
        aid += 1
        weeks_ago = (TODAY - day).days // 7
        if what in prog:
            spec = prog[what]
            sets, t = [], dt.datetime(day.year, day.month, day.day, 18, 4)
            for e in spec["exercises"]:
                exid, _, cat, name, n, top, w_now, rest, _ = e
                step = 2.0 if (cat, name) in two_db else 2.5
                # Give each class of trend something to show: some lifts climb weekly, laterals
                # stall, the RDL dips in its latest session, the rest step every three weeks.
                every = PROGRESS_EVERY.get(exid, 3)
                w = w_now if every is None else max(w_now * 0.7, w_now - step * (weeks_ago // every))
                if exid in REGRESS_LATEST and weeks_ago == 0:
                    w = w_now * 0.88
                w = round(w * (0.85 if day in deload else 1) / step) * step
                for i in range(n):
                    reps = top if (weeks_ago % 3 == 0 or i < n - 1) else top - 1 - rnd.randint(0, 1)
                    logged = w * 2 if (cat, name) in two_db else w
                    dur = round(reps * 3.2 + rnd.uniform(4, 10), 1)
                    prob = 64.0 if (weeks_ago == 0 and exid == "D1E6" and i == 2) else 100.0
                    sets.append({"setType": "ACTIVE", "startTime": t.isoformat() + ".0", "duration": dur,
                                 "repetitionCount": reps, "weight": logged * 1000,
                                 "exercises": [{"category": cat, "name": name, "probability": prob}]})
                    t += dt.timedelta(seconds=dur)
                    r = rest + rnd.randint(-15, 25)
                    sets.append({"setType": "REST", "startTime": t.isoformat() + ".0", "duration": r,
                                 "repetitionCount": None, "weight": None, "exercises": []})
                    t += dt.timedelta(seconds=r)
            dump(data / f"activity_{aid}_sets.json", {"activityId": aid, "exerciseSets": sets})
            if day in deload:
                annotations[day.isoformat()] = {"type": "deload", "note": "planned deload week"}
            dur_s = (t - dt.datetime(day.year, day.month, day.day, 18, 4)).total_seconds()
            acts.append({"activityId": aid, "activityName": spec["name"], "startTimeLocal": f"{d} 18:04:00",
                         "activityType": {"typeKey": "strength_training"}, "duration": dur_s,
                         "averageHR": 108 + rnd.randint(-4, 6), "maxHR": 151 + rnd.randint(-6, 8),
                         "activityTrainingLoad": 19 + rnd.randint(-5, 8), "calories": 420 + rnd.randint(-40, 60),
                         "aerobicTrainingEffect": 1.8, "anaerobicTrainingEffect": 1.2})
            if weeks_ago == 0:
                _details(data, aid, dur_s, 108, 151, rnd)
        elif what == "run":
            km = round(5.1 + rnd.gauss(0, 0.6), 2)
            pace = 337 + rnd.randint(-15, 20)
            acts.append({"activityId": aid, "activityName": "Easy run", "startTimeLocal": f"{d} 07:12:00",
                         "activityType": {"typeKey": "running"}, "duration": km * pace, "distance": km * 1000,
                         "averageSpeed": 1000 / pace, "averageHR": 148, "maxHR": 171, "elevationGain": 38,
                         "activityTrainingLoad": 61 + rnd.randint(-8, 10), "calories": 380,
                         "aerobicTrainingEffect": 3.2, "anaerobicTrainingEffect": 0.4,
                         "hrTimeInZone_1": 120, "hrTimeInZone_2": 640, "hrTimeInZone_3": 820,
                         "hrTimeInZone_4": 140, "hrTimeInZone_5": 0})
            if weeks_ago == 0:
                _details(data, aid, km * pace, 148, 171, rnd, sport="run", km=km)
                # Whole kilometres, then the remainder: laps of unequal length, as a real run has.
                cuts = [1000.0] * int(km) + ([round((km - int(km)) * 1000, 1)] if km % 1 > 0.05 else [])
                laps = []
                for i, dist in enumerate(cuts):
                    secs = (pace + rnd.randint(-8, 8) - (6 if i == len(cuts) - 1 else 0)) * dist / 1000
                    laps.append({"distance": dist, "duration": round(secs, 1), "averageHR": 140 + i * 3,
                                 "maxHR": 150 + i * 4, "averageSpeed": dist / secs, "averageRunCadence": 168 + rnd.randint(-3, 4),
                                 "elevationGain": rnd.randint(2, 14), "elevationLoss": rnd.randint(2, 14)})
                dump(data / f"activity_{aid}_splits.json", {"lapDTOs": laps})
        elif what == "swim":
            latest = weeks_ago == 0
            acts.append({"activityId": aid, "activityName": "Pool swim", "startTimeLocal": f"{d} 09:30:00",
                         "activityType": {"typeKey": "lap_swimming"}, "duration": 2520.0 if latest else 2160.0,
                         "movingDuration": 2290.0 if latest else None, "distance": 1700.0 if latest else 1500.0,
                         "averageSpeed": 1500 / 2160, "averageHR": 132, "maxHR": 158, "poolLength": 25.0,
                         "activeLengths": 68 if latest else 60, "averageSwolf": 41, "avgStrokes": 17.5,
                         "activityTrainingLoad": 38, "calories": 340, **({"workoutId": SWIM_WID} if latest else {})})
            if latest:   # Swim · Aerobic 1800, done: one 100 skipped, the last reps fading
                def swim_lap(m_, secs, hr):
                    n = int(m_ // 25)
                    return {"distance": float(m_), "duration": float(secs), "movingDuration": float(secs), "averageHR": hr,
                            "averageSWOLF": round(secs / n + 17), "swimStroke": "FREESTYLE",
                            "lengthDTOs": [{"distance": 25.0, "duration": round(secs / n, 1), "totalNumberOfStrokes": 17}
                                           for _ in range(n)]}
                rest = lambda s: {"distance": 0.0, "duration": float(s), "movingDuration": 0.0}  # noqa: E731
                laps = [swim_lap(300, 405, 124), rest(30)]
                for i, secs in enumerate((128, 127, 129, 128, 131, 134, 138)):
                    laps += [swim_lap(100, secs + rnd.randint(-1, 1), 132 + i), rest(20)]
                laps += [rest(40), swim_lap(400, 532, 140), rest(45), swim_lap(300, 450, 126)]
                dump(data / f"activity_{aid}_splits.json", {"lapDTOs": laps})
        elif what == "ride":
            acts.append({"activityId": aid, "activityName": "Zone 2 ride", "startTimeLocal": f"{d} 10:00:00",
                         "activityType": {"typeKey": "road_biking"}, "duration": 5400.0, "distance": 45000.0,
                         "averageSpeed": 45000 / 5400, "averageHR": 128, "maxHR": 152, "elevationGain": 420,
                         "activityTrainingLoad": 95, "calories": 980, "avgPower": 182, "normPower": 196,
                         "averageBikingCadenceInRevPerMinute": 86})
            if weeks_ago <= 1:   # rides are fortnightly: the latest has streams and laps whatever today is
                _details(data, aid, 5400.0, 128, 152, rnd, sport="bike", km=45.0)
                # Auto-lap every 10 km, the last one short; a climb in lap 3.
                laps, left = [], 45000.0
                for i in range(5):
                    dist = min(10000.0, left)
                    left -= dist
                    w = 230 if i == 2 else 175 + rnd.randint(-8, 8)
                    kmh = 23.5 if i == 2 else 31 + rnd.uniform(-1.5, 1.5)
                    laps.append({"distance": dist, "duration": round(dist / (kmh / 3.6), 1), "averageSpeed": kmh / 3.6,
                                 "averageHR": 141 if i == 2 else 124 + i * 2, "maxHR": 158 if i == 2 else 136 + i * 2,
                                 "averagePower": w, "normalizedPower": w + 9, "maxPower": w + 260,
                                 "averageBikeCadence": 78 if i == 2 else 88, "elevationGain": 260 if i == 2 else 30 + rnd.randint(0, 20)})
                dump(data / f"activity_{aid}_splits.json", {"lapDTOs": laps})
    # A conditioning circuit a month ago.
    aid += 1
    circ = TODAY - dt.timedelta(days=10 if SPARSE else 26)   # inside the sparse athlete's twelve days
    acts.append({"activityId": aid, "activityName": "Conditioning circuit", "startTimeLocal": f"{circ} 09:00:00",
                 "activityType": {"typeKey": "indoor_cardio"}, "duration": 2820.0, "averageHR": 141, "maxHR": 164,
                 "activityTrainingLoad": 74, "calories": 610, "workoutId": CIRCUIT_WID})
    # Hyrox-style stations, each a real Garmin exercise pair, one guessed by the watch (probability < 100).
    t_ = dt.datetime(circ.year, circ.month, circ.day, 9, 0)
    st_ = []
    for cat, name, secs, reps, kg_, prob in (("RUN", "RUN_OR_WALK", 300, None, None, 100), ("SLED", "PUSH", 150, None, 102, 100),
                                             ("RUN", "RUN_OR_WALK", 300, None, None, 100), ("ROW", "INDOOR_ROW", 270, None, None, 100),
                                             ("CARRY", "FARMERS_CARRY", 120, None, 48, 72), ("RUN", "RUN_OR_WALK", 300, None, None, 100)):
        step = len([s for s in st_ if s.get("duration", 0) >= 10])
        st_.append({"setType": "ACTIVE", "startTime": t_.isoformat() + ".0", "duration": float(secs), "repetitionCount": reps,
                    "weight": kg_ * 1000 if kg_ else None, "wktStepIndex": step,
                    "exercises": [{"category": cat, "name": name, "probability": float(prob)}]})
        if step == 2:   # the lap button pressed twice, mid-circuit: a 4-second "row"
            st_.append({"setType": "ACTIVE", "startTime": t_.isoformat() + ".0", "duration": 4.0, "repetitionCount": None,
                        "weight": None, "wktStepIndex": 3, "exercises": [{"category": "ROW", "name": "INDOOR_ROW"}]})
        t_ += dt.timedelta(seconds=secs + 45)
    dump(data / f"activity_{aid}_sets.json", {"activityId": aid, "exerciseSets": st_})

    # Tennis, yesterday and ten days ago: a sport that is neither lifting nor endurance, and never a
    # circuit (docs/DESIGN.md (app audit) R5 — the app once called it "Activity" on Today and "Circuit" on Workouts).
    if not SPARSE:
        for ago, mins_, load_ in ((1, 75, 64), (10, 90, 71)):
            aid += 1
            acts.append({"activityId": aid, "activityName": "Tennis", "startTimeLocal": f"{TODAY - dt.timedelta(days=ago)} 19:30:00",
                         "activityType": {"typeKey": "tennis_v2"}, "duration": mins_ * 60.0, "averageHR": 132, "maxHR": 168,
                         "activityTrainingLoad": load_, "calories": 9 * mins_, "aerobicTrainingEffect": 2.9})
    if not SPARSE:   # the season's done race: a half on its Sunday, the result races.json reads from it
        acts.append({"activityId": RACE_AID, "activityName": "Riverside Half", "startTimeLocal": f"{race_dates()['done']} 09:00:00",
                     "activityType": {"typeKey": "running"}, "duration": 6572.0, "distance": 21097.0,
                     "averageSpeed": 21097 / 6572, "averageHR": 168, "maxHR": 184, "elevationGain": 64,
                     "activityTrainingLoad": 212, "calories": 1480, "aerobicTrainingEffect": 4.6,
                     "anaerobicTrainingEffect": 1.8})
    if not SPARSE:   # the 70.3: one parent in the list; its legs only in the parent's own record (sports.legs)
        tri, legs = race_dates()["tri"], [TRI_AID + 1 + i for i in range(len(TRI_LEGS))]
        t_ = dt.datetime(tri.year, tri.month, tri.day, 5, 30)   # GMT: 07:30 at UTC+2
        total = sum(secs for _, secs, _ in TRI_LEGS)
        acts.append({"activityId": TRI_AID, "activityName": "Lakeshore 70.3", "startTimeLocal": f"{tri} 07:30:00",
                     "activityType": {"typeKey": "multi_sport"}, "duration": total, "distance": 113590.0, "parent": True,
                     "averageHR": 151, "maxHR": 178, "activityTrainingLoad": 338, "calories": 4120,
                     "aerobicTrainingEffect": 5.0, "anaerobicTrainingEffect": 1.9})
        gmt = lambda t: t.strftime("%Y-%m-%dT%H:%M:%S.0")  # noqa: E731
        dump(data / f"activity_{TRI_AID}_full.json", {
            "activityId": TRI_AID, "isMultiSportParent": True, "activityTypeDTO": {"typeKey": "multi_sport"},
            "metadataDTO": {"childIds": legs, "childActivityTypes": [tk for tk, _, _ in TRI_LEGS]},
            "summaryDTO": {"startTimeGMT": gmt(t_), "duration": total, "elapsedDuration": total, "distance": 113590.0}})
        laps = []
        for leg, (tk, secs, metres) in zip(legs, TRI_LEGS):
            lap = {"startTimeGMT": gmt(t_), "duration": secs, "elapsedDuration": secs, "distance": metres,
                   "averageSpeed": metres / secs}
            dump(data / f"activity_{leg}_full.json", {"activityId": leg, "parentId": TRI_AID, "isMultiSportParent": False,
                                                      "activityTypeDTO": {"typeKey": tk},
                                                      "summaryDTO": {"startTimeGMT": gmt(t_), "duration": secs,
                                                                     "elapsedDuration": secs, "distance": metres}})
            dump(data / f"activity_{leg}_splits.json", {"activityId": leg, "lapDTOs": [lap]})
            laps.append(lap)
            t_ += dt.timedelta(seconds=secs)
        dump(data / f"activity_{TRI_AID}_splits.json", {"activityId": TRI_AID, "lapDTOs": laps})
    dump(data / f"activities_{start}_{TODAY}.json", sorted(acts, key=lambda x: x["startTimeLocal"], reverse=True))
    if not SPARSE:   # Garmin's thresholds (the new athlete has none yet: the screens must say so)
        dump(data / "thresholds.json", {"pulled": TODAY.isoformat(), "ftp": {"functionalThresholdPower": 250},
                                        "lactate": {"speed_and_heart_rate": {"heartRate": 166}}})
    if not SPARSE:
      dump(data / "bodycomp.json", {"dateWeightList": [
        {"calendarDate": (TODAY - dt.timedelta(days=i)).isoformat(),
         "weight": round((78.4 + i * 0.012 + rnd.gauss(0, 0.25)) * 1000)} for i in range(0, 128, 3)]})
    monday = TODAY - dt.timedelta(days=TODAY.weekday())
    last_d1 = next((x["activityId"] for x in acts if x["activityName"] == "D1 · Push"
                    and x["startTimeLocal"][:10] == monday.isoformat()), None)
    week = [(monday, "D1 · Push", 4101, "strength_training", last_d1),
            (monday + dt.timedelta(days=3), "D2 · Pull", 4102, "strength_training", None),
            (monday + dt.timedelta(days=4), "Swim 1,800 m", 4201, "lap_swimming", None),
            (monday + dt.timedelta(days=5), "D3 · Legs", 4103, "strength_training", None),
            # Sunday and next Monday too: generated late in the week, the demo still has a next session
            # (Today's Next reads this week; Plan's next week) — a Saturday run left nothing after today.
            (monday + dt.timedelta(days=6), "Swim 1,800 m", 4201, "lap_swimming", None),
            (monday + dt.timedelta(days=7), "D1 · Push", 4101, "strength_training", None)]
    dump(data / "scheduled.json", [{"itemType": "workout", "date": d_.isoformat(), "title": t_, "workoutId": w_,
                                    "sportTypeKey": s_, "associatedActivityId": a_} for d_, t_, w_, s_, a_ in week
                                   if d_ >= monday])
    return annotations


def _sleep_night(total_s: int, rnd: random.Random) -> list:
    """(stage code, seconds) through one night: ~90-minute cycles of light → deep → light → REM, deep
    sleep front-loaded and REM growing towards morning, a few brief wakings."""
    out, t, cycle = [], 0, 0
    while t < total_s:
        late = cycle / 5
        for code, mins in ((1, rnd.randint(12, 22)), (0, max(4, round(rnd.randint(30, 45) * (1 - late)))),
                           (1, rnd.randint(15, 25)), (2, round(rnd.randint(8, 14) + 22 * late))):
            secs = min(mins * 60, total_s - t)
            if secs <= 0:
                break
            out.append((code, secs))
            t += secs
        if t < total_s and rnd.random() < 0.6:
            secs = min(rnd.randint(2, 6) * 60, total_s - t)
            out.append((3, secs))
            t += secs
        cycle += 1
    return out


def _details(data: Path, aid: int, dur_s: float, avg: int, mx: int, rnd: random.Random, sport: str | None = None,
             km: float = 0.0) -> None:
    """A details payload. Strength: time and HR. A ride or run (`sport`) also gets speed, distance,
    elevation, cadence, power on the ride, and a route — a synthetic loop on open sea west of
    Iceland, so no fixture route is ever anyone's street."""
    keys = ["directTimestamp", "directHeartRate"]
    if sport:
        keys += ["directSpeed", "sumDistance", "directElevation", "directLatitude", "directLongitude",
                 "directBikeCadence" if sport == "bike" else "directRunCadence"] + (["directPower"] if sport == "bike" else [])
    pts, poly, t0, dist = [], [], 1_760_000_000_000, 0.0
    step = 5
    for i in range(0, int(dur_s), step):
        phase = i / max(dur_s, 1)
        hr = avg - 18 + 30 * phase + 10 * rnd.random() if phase < 0.95 else mx - 6
        row = [t0 + i * 1000, round(min(mx, hr))]
        if sport:
            climb = sport == "bike" and 0.45 < phase < 0.6
            spd = (km * 1000 / dur_s) * (0.75 if climb else 1.05) * (1 + rnd.uniform(-0.05, 0.05))
            dist += spd * step
            ang = 2 * math.pi * phase
            lat, lon = 64.0 + 0.08 * math.sin(ang), -27.0 + 0.16 * math.cos(ang)
            row += [round(spd, 2), round(dist, 1), round(40 + 120 * math.sin(math.pi * min(1, max(0, (phase - 0.45) / 0.15))) if climb else 40 + 5 * rnd.random(), 1),
                    lat, lon, (78 if climb else 88) + rnd.randint(-3, 3) if sport == "bike" else 84 + rnd.randint(-2, 2)]
            if sport == "bike":
                row.append(round((235 if climb else 175) + rnd.gauss(0, 18)))
            poly.append({"lat": lat, "lon": lon})
        pts.append({"metrics": row})
    payload = {"metricDescriptors": [{"metricsIndex": i, "key": k} for i, k in enumerate(keys)], "activityDetailMetrics": pts}
    if poly:
        payload["geoPolylineDTO"] = {"polyline": poly}
    dump(data / f"activity_{aid}_details.json", payload)
    if sport:   # Garmin's weather payload: temperatures in Fahrenheit, no unit field; a station position
        dump(data / f"activity_{aid}_weather.json", {"temp": 63, "apparentTemp": 63, "dewPoint": 48, "relativeHumidity": 62,
                                                     "latitude": 64.0, "longitude": -27.0, "weatherTypeDTO": {"desc": "Partly Cloudy"}})
        z = [round(dur_s * x) for x in (0.08, 0.52, 0.28, 0.1, 0.02)]
        dump(data / f"activity_{aid}_hrzones.json", [{"zoneNumber": i + 1, "secsInZone": z[i], "zoneLowBoundary": b}
                                                     for i, b in enumerate((98, 118, 138, 155, 170))])
        if sport == "bike":
            dump(data / f"activity_{aid}_powerzones.json", [{"zoneNumber": i + 1, "secsInZone": z[i], "zoneLowBoundary": b}
                                                            for i, b in enumerate((0, 138, 188, 225, 263))])


# --- the athlete's own files ---------------------------------------------------------------------
FACTS = {
    "athlete/goal.md": ("athlete", "Goal: hypertrophy on an endurance base",
                        "Build upper-body size while keeping two runs, a swim and a ride a week."),
    "equipment/gym.md": ("equipment", "Gym: commercial, dumbbells to 40 kg",
                         "Leg press is plate-loaded — logged as the plates added."),
    "medical/shoulder.md": ("medical", "No behind-the-neck pressing",
                            "An old shoulder irritation. Pressing stays in front of the head; reinstating it is a "
                            "medical decision."),
    "preference/brief.md": ("preference", "Brief: short, recommendation first", "Visual over prose."),
}


def race_dates() -> dict:
    """The season's dates, from today: the half on a Sunday five or six weeks back with no ride that
    day (rides are fortnightly, in even ISO weeks), the 70.3 on a ride-free Sunday two or three weeks
    back (its recovery over before today), the gravel race four Sundays ahead and the Saturday the
    organiser's page names instead, and the A race on the season's last day (SEASON_PY)."""
    monday = TODAY - dt.timedelta(days=TODAY.weekday())
    done = monday - dt.timedelta(days=36)
    if done.isocalendar()[1] % 2 == 0:
        done -= dt.timedelta(weeks=1)
    tri = monday - dt.timedelta(days=15)
    if tri.isocalendar()[1] % 2 == 0:
        tri -= dt.timedelta(weeks=1)
    gravel = monday + dt.timedelta(days=34)
    block_start = monday - dt.timedelta(weeks=13)
    return {"done": done, "tri": tri, "gravel": gravel, "gravel_found": gravel - dt.timedelta(days=1),
            "a": block_start + dt.timedelta(weeks=28, days=-1)}


def demo_races() -> dict:
    d = race_dates()
    iso = lambda day: day.isoformat()  # noqa: E731
    return {"_why": "SYNTHETIC — app/fixtures/make_demo.py. Four races: a half done with its result, a 70.3 done "
                    "with its splits and a reference, one a check found on another date (differs), and the A race "
                    "the SEASON builds to.", "races": [
        {"id": "riverside-half", "name": "Riverside Half", "official_name": "Riverside Half Marathon", "series": None,
         "kind": "half_marathon", "priority": "B", "entry": "done", "date": iso(d["done"]), "start": "09:00",
         "where": {"city": "Riverside", "venue": "Old Bridge"}, "format": {"distance_km": 21.097},
         "target": {"under": "1:50:00"},
         "verified": {"status": "confirmed", "checked": iso(d["done"] - dt.timedelta(days=5)), "source_kind": "official",
                      "source": "https://example.com/riverside-half", "found": {"date": iso(d["done"]), "start": "09:00"},
                      "history": []},
         "result": {"time": "1:49:32", "activity_id": RACE_AID, "note": "Even splits; the last 3 km were the fastest."}},
        # Its splits come from the multisport activity's legs (make_cache), its reference is last year's
        # edition, typed in from the results page: the page holds each discipline against it.
        {"id": "lakeshore-703", "name": "Lakeshore 70.3", "official_name": "Lakeshore 70.3", "series": None,
         "kind": "triathlon_70_3", "priority": "B", "entry": "done", "date": iso(d["tri"]), "start": "07:30",
         "where": {"city": "Lakeshore", "venue": "North beach"}, "format": {"swim_km": 1.9, "bike_km": 90, "run_km": 21.1},
         "windows": {"easy_before": 3, "recovery_after": 7},   # races.py has no default for a B 70.3
         "target": {"under": "5:20:00"},
         "verified": {"status": "confirmed", "checked": iso(d["tri"] - dt.timedelta(days=6)), "source_kind": "official",
                      "source": "https://example.com/lakeshore-703", "found": {"date": iso(d["tri"]), "start": "07:30"},
                      "history": []},
         "result": {"time": "5:18:20", "activity_id": TRI_AID, "note": "A cool morning; the run held together."},
         "reference": {"name": "Lakeshore 70.3 2025", "date": iso(d["tri"] - dt.timedelta(weeks=52)), "time": "5:27:30",
                       "splits": {"Swim": "35:40", "T1": "4:20", "Bike": "2:38:10", "T2": "2:50", "Run": "2:06:30"},
                       "note": "Last year's edition, from the results page."}},
        {"id": "hill-country-gravel", "name": "Hill Country Gravel", "official_name": "Hill Country Gravel 100",
         "series": None, "kind": "gravel", "priority": "B", "entry": "entered", "date": iso(d["gravel"]), "start": "08:00",
         "where": {"city": "Hill Country", "venue": "Market square"},
         "format": {"distance_km": 100, "elevation_gain_m": 1600}, "target": {"under": "4:45:00"},
         "verified": {"status": "differs", "checked": iso(TODAY - dt.timedelta(days=2)), "source_kind": "official",
                      "source": "https://example.com/hill-country-gravel",
                      "found": {"date": iso(d["gravel_found"]), "start": "08:00"},
                      "note": "The organiser's page lists the Saturday; the entry says Sunday.", "history": []},
         "result": None},
        {"id": "coastline-703", "name": "Coastline 70.3", "official_name": "Coastline 70.3", "series": None,
         "kind": "triathlon_70_3", "priority": "A", "entry": "entered", "date": iso(d["a"]), "start": "07:00",
         "where": {"city": "Coastline", "venue": "Harbour"}, "format": {"swim_km": 1.9, "bike_km": 90, "run_km": 21.1},
         "target": {"under": "5:15:00"},
         "verified": {"status": "confirmed", "checked": iso(TODAY - dt.timedelta(days=9)), "source_kind": "entry",
                      "source": "the entry confirmation", "found": {"date": iso(d["a"]), "start": "07:00"}, "history": []},
         "result": None},
    ]}


# Trips (docs/DESIGN.md (trips)): two synthetic places. The first starts next Monday, on the day the watch has
# D1 · Push — a clash the Plan screen shows — and its bike is a maybe due an answer, which Today asks; the
# second, three weeks out, has a pool, the bike and courts, and travel days with a home part.
def demo_trips() -> dict:
    monday = TODAY - dt.timedelta(days=TODAY.weekday())
    d = lambda n: (monday + dt.timedelta(days=n)).isoformat()  # noqa: E731
    away = {"gym": "no", "pool": "no", "bike": "maybe", "trainer": "no", "run": "yes", "courts": "no"}
    return {"_why": "SYNTHETIC — app/fixtures/make_demo.py.", "home": {"where": "Rivertown"}, "trips": [
        {"id": "lakeside", "where": "Lakeside", "from": d(7), "to": d(10), "access": away, "time": "limited",
         "note": "Runs if time allows."},
        {"id": "hill-town", "where": "Hill Town", "from": d(21), "to": d(27),
         "access": {**away, "pool": "yes", "bike": "yes", "courts": "yes"}, "leave": "evening", "back": "morning"}]}


def write_own_files(a: Path, annotations: dict) -> None:
    if SPARSE:   # a new athlete: the intake's goal, nothing else yet
        # ...and no races.json at all: the views without one (docs/DESIGN.md (races) §8). The scaffold's empty
        # file is the other case, held by tests/run_tests.py's scaffold test.
        (a / "races.json").unlink(missing_ok=True)
        rel, (typ, title, body) = next(iter(FACTS.items()))
        (a / "memory" / rel).parent.mkdir(parents=True, exist_ok=True)
        (a / "memory" / rel).write_text(f"---\ntype: {typ}\nstatus: active\nsince: {TODAY}\nsource: intake (synthetic)\n---\n\n# {title}\n\n{body}\n")
        return
    for rel, (typ, title, body) in FACTS.items():
        enforced = "athletes/demo/tests.py::test_no_behind_the_neck_pressing" if typ == "medical" else ""
        (a / "memory" / rel).parent.mkdir(parents=True, exist_ok=True)
        (a / "memory" / rel).write_text(
            f"---\ntype: {typ}\nstatus: active\nsince: 2026-06-01\nsource: intake (synthetic)\n"
            + (f"enforced_by: {enforced}\n" if enforced else "") + f"---\n\n# {title}\n\n{body}\n")
    ann = json.loads((a / "workouts" / "SESSION_ANNOTATIONS.json").read_text())
    ann.update(annotations)
    dump(a / "workouts" / "SESSION_ANNOTATIONS.json", ann)
    hist_path = a / "workouts" / "PRESCRIPTION_HISTORY.json"
    hist = json.loads(hist_path.read_text())
    bench = hist.get("d1/D1E1")
    if bench:
        three_weeks = (TODAY - dt.timedelta(weeks=3)).isoformat()
        bench.update(since=three_weeks, since_ts=f"{three_weeks} 20:10:00",
                     changes=[{"date": three_weeks, "from": 77.5, "to": 80.0, "reps": 8}])
        dump(hist_path, hist)
    # A session planned off the watch (Zwift runs it): Plan and Today show it beside the calendar.
    wednesday = TODAY - dt.timedelta(days=TODAY.weekday()) + dt.timedelta(days=2)
    # Each ride names its intent: its fuel plan reads it (docs/DESIGN.md (fuelling and score) §4.3) — the VO2 ride needs
    # none, the long ride gets bottles and gels.
    sunday = TODAY - dt.timedelta(days=TODAY.weekday()) + dt.timedelta(days=6)
    dump(a / "plan.json", {"_why": "synthetic", "sessions": [
        {"date": wednesday.isoformat(), "title": "Zwift · VO2 45 min", "sport": "virtual_ride", "platform": "zwift", "duration_min": 45,
         "intent": "vo2", "detail": "10 min warm-up · 5 × 3 min hard, 3 min easy · 5 min cool-down.", "why": "The week's VO2 work, on the bike.",
         "zwift_workout": ZWIFT["vo2"]},
        {"date": sunday.isoformat(), "title": "Long ride · Z2", "sport": "road_biking", "duration_min": 150, "intent": "endurance",
         "detail": "Zone 2 throughout, 60–75 % FTP.", "why": "The week's long ride."}]})
    dump(a / "races.json", demo_races())
    dump(a / "trips.json", demo_trips())
    logs = a / "logs"
    (logs / f"{TODAY}.md").write_text(f"# Daily · {TODAY}\n\nTRAIN · D2 Pull — recovered, and Pull is 8 days old.\n")
    monday = TODAY - dt.timedelta(days=TODAY.weekday())
    (logs / f"{monday}-review.md").write_text(f"# Session review · D1 Push · {monday}\n\nSolid. Bench is ready to move.\n")
    dump(logs / f"{TODAY}.json", daily_result())


# --- coach results (the coach writes these; they must pass app/contracts/) ------------------------
def endurance_review(env: dict, a: Path) -> dict | None:
    """The latest ride's review, built from the metrics engine's own output — so its evidence is
    real — and put through the full validator, evidence check included, as the coach's would be.
    Also gives today's daily its one-line ride verdict (docs/DESIGN.md (rides and runs) §4)."""
    sessions = json.loads(run(["scripts/app_data.py", "sessions"], env))["sessions"]
    ride = next((x for x in sessions if x["group"] == "bike"), None)
    if not ride:
        return None
    an = json.loads(run(["scripts/endurance_metrics.py", str(ride["id"]), "--json"], env))
    mt = an["metrics"]
    ev = lambda path, label: (lambda v: {"metric": path, "value": v, "label": label} if v is not None else None)(  # noqa: E731
        __import__("app_contracts").resolve(an, path))
    dc = mt.get("decoupling", {}).get("value")
    findings = [
        {"severity": "good", "claim": "Paced like an endurance ride: steady power, most of the time in zone 2.",
         "evidence": [e for e in (ev("metrics.vi", "Variability"), ev("zones.power.2", "Power zone 2, % of time")) if e]},
        {"severity": "watch" if dc and dc > 5 else "good",
         "claim": f"Heart rate drifted {'more than it should' if dc and dc > 5 else 'little'} against power in the second half.",
         "evidence": [e for e in (ev("metrics.decoupling", "Decoupling, %"), ev("metrics.ef", "Efficiency")) if e]},
        {"severity": "info", "claim": "The climb was the hardest 20 minutes, near tempo.",
         "evidence": [e for e in (ev("bests.1200s", "Best 20 min, W"), ev("thresholds.ftp", "FTP, W")) if e]},
    ]
    payload = {
        "kind": "endurance_review", "request_id": "r9", "activity_id": ride["id"], "date": ride["date"], "sport": "bike",
        "verdict": "A solid zone-2 ride with one honest climb — the fade at the end is worth fixing with food, not fitness.",
        "intent": {"value": "endurance", "source": "inferred", "why": "No ride was scheduled; 90 minutes mostly in zone 2 reads as an endurance ride."},
        "execution": {"rating": "partly", "summary": "Steady and well paced until the last half hour, when heart rate rose at the same power."},
        "findings": [f for f in findings if f["evidence"]],
        "context": [{"text": "Slept 7 h 12 the night before, recovery 72 %.", "source": "Garmin sleep, OpenSportCoach recovery"}],
        "next_time": "Eat 60 g of carbohydrate an hour from the first 30 minutes, and keep the climb at 90 % of FTP.",
        "questions": ["Did you eat during the ride?"],
        "markdown_file": None, "generated_at": dt.datetime.now().replace(microsecond=0).isoformat(),
    }
    # Its markdown copy, named with the activity — it belongs on the ride's page only (docs/DESIGN.md (app audit) M4).
    (a / "logs" / f"{ride['date']}-{ride['id']}-review.md").write_text(f"# Ride review · {ride['title']} · {ride['date']}\n\n{payload['verdict']}\n")
    tmp = a / "logs" / "endurance_review.fixture.json"
    dump(tmp, payload)
    run(["scripts/app_contracts.py", "validate", "endurance_review", str(tmp)], env)   # exits on a bad number
    tmp.unlink()
    daily_path = a / "logs" / f"{TODAY}.json"
    if daily_path.exists():
        daily = json.loads(daily_path.read_text())
        daily["endurance"] = [{"activity_id": ride["id"], "title": ride["title"], "sport": "bike", "flag": bool(an["flags"]),
                               "line": f"Zone-2 ride as intended; decoupling {dc} %{' — fading late' if dc and dc > 5 else ''}." if dc is not None
                               else "Zone-2 ride as intended."}]
        dump(daily_path, daily)
    return payload



def write_fuel(a: Path, data: Path) -> None:
    """Rocky's fuel (docs/DESIGN.md (fuelling and score)): real products from the shared catalog, a bottle recipe, a gut
    trained to 60 g/h — set up a month ago — and the latest ride logged; the one before it is left
    unlogged, so it asks to be logged (the Workouts filter). The new athlete has no setup."""
    if SPARSE:
        return
    since = (TODAY - dt.timedelta(days=30)).isoformat()
    dump(a / "fuel.json", {"_why": "synthetic", "products": ["maurten-gel-160", "mnstry-fast-carb-mango"],
                           "recipes": [{"id": "bottle", "label": "Bottle", "product": "mnstry-fast-carb-mango", "powder_g": 43, "water_ml": 500}],
                           "gut": {"g_per_h": 60, "since": since, "how": "setup: what they take on a 2–3 h ride"},
                           "caffeine": "races", "notes": None,
                           "setup": {"products": since, "recipes": since, "gut": since, "caffeine": since}})
    acts = json.loads(next(data.glob("activities_*.json")).read_text())
    rides = sorted((x for x in acts if x["activityType"]["typeKey"] == "road_biking" and x["startTimeLocal"][:10] >= since),
                   key=lambda x: x["startTimeLocal"], reverse=True)
    if rides:
        r = rides[0]
        dump(a / "logs" / "fuel.json", {"records": [
            {"activity_id": r["activityId"], "date": r["startTimeLocal"][:10], "source": "you", "as_planned": False,
             "items": [{"kind": "recipe", "id": "bottle", "n": 1, "g_each": 40}, {"kind": "product", "id": "maurten-gel-160", "n": 1, "g_each": 40}],
             "note": "Second bottle stayed in the cage — too cold to drink.", "logged_at": f"{r['startTimeLocal'][:10]}T13:20:00"}]})


def daily_result() -> dict:
    now = dt.datetime.now().replace(microsecond=0)
    monday = TODAY - dt.timedelta(days=TODAY.weekday())
    return {
        "kind": "daily", "date": TODAY.isoformat(), "generated_at": now.isoformat(),
        "data_as_of": (now - dt.timedelta(minutes=2)).isoformat(),
        "recommendation": {"verb": "TRAIN", "workout_key": "d2", "title": "D2 · Pull",
                           "why": "Recovered, and Pull is 8 days old.",
                           "reasoning": "Recovery 72 % and HRV inside its band; resting HR at baseline. D2 Pull was last done 8 days ago — the oldest day in the rotation — and grip faded on the final rows set in the last two pulls, hence the cut.",
                           "cut": "the last set of rows if grip fades",
                           "signals": [{"label": "Recovery", "value": "72 %", "tone": "good"},
                                       {"label": "Pull", "value": "8 days", "tone": "warn"},
                                       {"label": "Sleep", "value": "7 h 12", "tone": "neutral"}]},
        "feel": {"asked": True, "answer": 4, "note": None},
        "review": {"session_date": monday.isoformat(), "day_key": "d1",
                   "lines": [{"exercise": "Bench press", "planned": "4×8 @ 80", "executed": "4×8 @ 80", "verdict": "bump"},
                             {"exercise": "Incline DB press", "planned": "3×10 @ 26/hand", "executed": "10, 10, 9 @ 26", "verdict": "hold"}],
                   "bumps": ["Bench press 80 → 82.5 kg"], "misses": []},
        "pending": [{"id": "p1", "kind": "bump", "text": "Bench press 80 → 82.5 kg — 4×8 at 80 on Monday",
                     "bump": {"exercise": "Bench press", "from": 80, "to": 82.5, "evidence_dates": [monday.isoformat()]}},
                    {"id": "p2", "kind": "question", "text": "Tuesday's run drifted +9 bpm in the last km at the same pace. Hot, or were you pushing?",
                     "options": ["It was hot", "I pushed", "Neither"]},
                    {"id": "p3", "kind": "unsynced", "text": "D3 · Legs changed and is not on the watch yet."}],
        "notes": ["Laterals have sat at 10 kg for three sessions — watch them."],
    }


def results() -> dict:
    monday = TODAY - dt.timedelta(days=TODAY.weekday())
    nxt = monday + dt.timedelta(days=7)
    y, w, _ = TODAY.isocalendar()
    return {
        "daily": daily_result(),
        "answer": {"kind": "answer", "request_id": "r1",
                   "markdown": "It didn't stall — reps came back once sleep did. No change to the program.",
                   "facts": [{"label": "Reps @ 80 kg, 3 weeks ago", "value": "28 / 32", "source": "garmin"},
                             {"label": "Sleep, the week before", "value": "6 h 41", "source": "garmin"}],
                   "sources": [{"kind": "garmin", "text": "bench sets, 5 sessions"},
                               {"kind": "computed", "text": "e1RM per session"}]},
        # Every field the review draws (board Plan-Proposal, 2026-10-16): each kind of change with its
        # reason and evidence, a benchmark, the week's impact, the rule checks (one with a bracket).
        "plan_proposal": {"kind": "plan_proposal", "request_id": "r2", "id": "plan-next-week",
                          "title": f"Next week {nxt:%d %b}",
                          "headline": "Bench and quads up, a CSS test, and a long ride.",
                          "version": {"n": 2, "of": 2, "note": "Proposal 1 kept the circuit on Sunday."},
                          "based_on_data_as_of": f"{TODAY.isoformat()}T07:40:00",
                          "days": [{"date": (nxt + dt.timedelta(days=i)).isoformat(), "type": t, "workout_key": k, "sport": sp,
                                    "title": title, "notes": None, "change": ch, "from": fr, "to": to,
                                    "from_date": (nxt + dt.timedelta(days=fd)).isoformat() if fd is not None else None,
                                    "reason": why, "evidence": ev, "benchmark": star,
                                    **({"zwift_workout": ZWIFT["long"]} if sp == "zwift" else {})}
                                   for (i, t, k, sp, title, ch, fr, to, fd, why, ev, star) in [
                                       (0, "session", "d1", "strength", "D1 · Push", "changed", None, None, None,
                                        "Bench goes up a step — Monday met the prescription.",
                                        [{"source": "computed", "text": "4 × 8 met at 80 kg", "detail": "Prescription check: every planned set met at this load. Computed from Garmin sets."}], False),
                                       (1, "cardio", None, "run", "Easy run 5 km", "changed", "4 km", "5 km", None,
                                        "Week 2 of the run arc: +1 km.",
                                        [{"source": "coach", "text": "run arc · wk 2", "detail": "4 → 6 km over four weeks. Source: coach."}], False),
                                       (2, "rest", None, None, "Rest", "unchanged", None, None, None, "Unchanged.", [], False),
                                       (3, "session", "d2", "strength", "D2 · Pull", "moved", "Fri", "Thu", 4,
                                        "Moves up a day so the CSS test gets Friday after a rest day.", [], False),
                                       (4, "cardio", None, "swim", "Swim · CSS test 1,800 m", "changed", "Swim 1,800 m easy", "CSS test", None,
                                        "The block’s first benchmark: pool zones from a real CSS, not a six-week-old one.",
                                        [{"source": "garmin", "text": "last CSS · 6 weeks ago", "detail": "The last CSS swim on file. Source: Garmin."}], True),
                                       (5, "session", "d3", "strength", "D3 · Legs", "changed", None, None, None,
                                        "Quads get a fourth set of leg press.",
                                        [{"source": "computed", "text": "quads 8 of 10–14 sets", "detail": "Planned working sets for quads against their weekly band. Computed."}], False),
                                       (6, "cardio", None, "zwift", "Zwift · Long ride", "added", None, "1:50 · Z2", None,
                                        "Sunday was free: the aerobic base the 70.3 needs.",
                                        [{"source": "you", "text": "“a long ride on Sundays”", "detail": "Your request, this morning."}], False),
                                       (6, "session", None, "circuit", "Circuit · 5 rounds", "removed", None, None, None,
                                        "Two hard days back to back with Saturday’s legs — the long ride takes its place.", [], False)]],
                          "program_changes": [
                              {"workout_key": "d1", "exercise": "Bench press", "field": "weight", "from": 80, "to": 82.5,
                               "reason": "4×8 at 80 on Monday — the bump rule fired."},
                              {"workout_key": "d3", "exercise": "Leg press", "field": "sets", "from": 3, "to": 4,
                               "reason": "Quads are below their weekly band."}],
                          "impact": [
                              {"metric": "cardio_load", "now": 310, "proposed": 355, "note": "Planned Garmin load for the cardio sessions — an estimate. Source: coach."},
                              {"metric": "strength_sets", "now": 64, "proposed": 66, "note": None},
                              {"metric": "hours", "now": 6.5, "proposed": 8.25, "note": None},
                              {"metric": "hard_days", "now": 2, "proposed": 2, "note": None},
                              {"metric": "benchmarks", "now": 0, "proposed": 1, "note": "The CSS test on Friday. Source: coach."}],
                          "checks": [
                              {"status": "holds", "rule": "Three gym days.", "detail": "Push Mon, Pull Thu, Legs Sat."},
                              {"status": "holds", "rule": "No test inside a race window.", "detail": "The next race’s easy days start later."},
                              {"status": "holds", "rule": "Weekly floor.", "detail": "3 gym days, 1 swim, 1 run, a long ride."},
                              {"status": "near_limit", "rule": "Two hard days back to back.", "detail": "CSS test Fri, Legs Sat — different systems, allowed.",
                               "from": (nxt + dt.timedelta(days=4)).isoformat(), "to": (nxt + dt.timedelta(days=5)).isoformat()}],
                          "needs_push": True},
        "push_plan": {"kind": "push_plan", "request_id": "r3", "athlete": NAME, "display": DISPLAY,
                      "garmin_account": "Rocky B.", "protected": 3, "script": "sync",
                      "actions": [{"verb": "replace", "workout": "D1 · Push", "key": "d1", "old_id": 4101,
                                   "dates": [nxt.isoformat()]},
                                  {"verb": "replace", "workout": "D3 · Legs", "key": "d3", "old_id": 4103,
                                   "dates": [(nxt + dt.timedelta(days=5)).isoformat()]},
                                  {"verb": "in_sync", "workout": "D2 · Pull", "key": "d2", "old_id": 4102, "dates": []}],
                      "plan_hash": "3f9a1c0d7e52b6a4"},
        "push_result": {"kind": "push_result", "request_id": "r3", "plan_hash": "3f9a1c0d7e52b6a4", "ok": True,
                        "in_sync": True, "message": "2 of 2 changes verified on Rocky B.",
                        "actions": [{"verb": "replace", "workout": "D1 · Push", "date": nxt.isoformat(), "status": "verified"},
                                    {"verb": "replace", "workout": "D3 · Legs", "date": (nxt + dt.timedelta(days=5)).isoformat(),
                                     "status": "verified"}]},
        "push_result_failed": {"kind": "push_result", "request_id": "r4", "plan_hash": "3f9a1c0d7e52b6a4", "ok": False,
                               "in_sync": False, "message": "1 change not verified. Nothing was deleted; retrying sends only it.",
                               "actions": [{"verb": "replace", "workout": "D1 · Push", "date": nxt.isoformat(), "status": "verified"},
                                           {"verb": "replace", "workout": "D3 · Legs", "date": None, "status": "failed",
                                            "error": "ConnectionResetError on the upload response"}]},
        "review": {"kind": "review", "request_id": "r5", "date": monday.isoformat(), "subject": "session",
                   "activity_id": None, "markdown": "D1 Push — solid. Bench is ready to move.",
                   "findings": [{"kind": "up", "text": "Bench 80 → 82.5"}, {"kind": "warn", "text": "Lateral raise stalled"},
                                {"kind": "question", "text": "Triceps set 3 was named by the watch — rope or overhead?"}]},
        "recap": {"kind": "recap", "request_id": None, "week": f"{y}-W{w - 1:02d}", "findings": [], "markdown": None,
                  "checks": [{"name": n, "ok": True} for n in ("Load in band", "ACWR 0.8–1.3", "HRV in band", "Rotation ≤ 7 d",
                                                               "No stale lifts", "Sleep debt < 4 h", "Weight in range",
                                                               "Watch in sync", "Constraints held")]},
        "race_check": race_check_result(),
    }


def race_check_result() -> dict:
    """What "Check dates" publishes, built from the race it checked so the two cannot disagree: the gravel
    race, whose organiser's page names another day (`differs` — the page asks which date stands)."""
    r = next(r for r in demo_races()["races"] if r["id"] == "hill-country-gravel")
    v = r["verified"]
    return {"kind": "race_check", "request_id": "r9", "checked": v["checked"],
            "races": [{"id": r["id"], "status": v["status"], "source_kind": v["source_kind"], "source": v["source"],
                       "found": v["found"], "note": v["note"]}],
            "markdown": "Hill Country Gravel: the organiser's page names the Saturday, your entry the Sunday. "
                        "Nothing changed — which date stands?"}


# --- main -----------------------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(REPO / "app" / "fixtures" / "demo"))
    ap.add_argument("--keep", help="also copy the synthetic athlete tree here")
    ap.add_argument("--sparse", action="store_true", help="a new athlete (writes app/fixtures/demo-new/ by default)")
    args = ap.parse_args()
    global SPARSE, DISPLAY
    if args.sparse:
        SPARSE, DISPLAY = True, "Sam"
        if args.out == str(REPO / "app" / "fixtures" / "demo"):
            args.out = str(REPO / "app" / "fixtures" / "demo-new")
    sys.path.insert(0, str(REPO / "scripts"))
    import app_contracts

    rnd = random.Random(f"osc-demo-{TODAY}")
    with tempfile.TemporaryDirectory(prefix="osc-demo-") as tmp:
        root = Path(tmp)
        env = env_for(root)
        a = scaffold(root, env)
        run(["scripts/build_workouts.py"], env)
        annotations = make_cache(root / "data" / NAME, a, rnd)
        write_own_files(a, annotations)
        write_fuel(a, root / "data" / NAME)
        # The watch: D1 and D2 verified in sync, D3 changed since — "1 change not on the watch".
        hashes = json.loads(run(["-c", "import sys, json; sys.path.insert(0, 'scripts'); import sync_workouts as s; "
                                       "print(json.dumps({k: s.content_hash(json.load(open(s.WORKOUTS / f'{k}.json'))) "
                                       "for k in ('d1', 'd2')}))"], env))
        dump(a / "workouts" / "WORKOUT_IDS.json", {"_meta": {"purpose": "synthetic"},
                                                    "workouts": {"D1 · Push": 4101, "D2 · Pull": 4102, "D3 · Legs": 4103,
                                                                 "Swim · Aerobic 1800": SWIM_WID,
                                                                 "Circuit · Conditioning": CIRCUIT_WID},
                                                    "hashes": {"D1 · Push": hashes["d1"], "D2 · Pull": hashes["d2"],
                                                               "D3 · Legs": "0000000000000000"}})
        run(["scripts/export_dashboard_data.py"], env)
        review = endurance_review(env, a)

        out = Path(args.out)
        if out.exists():
            shutil.rmtree(out)
        views = json.loads(run(["scripts/app_data.py", "sessions"], env))["sessions"]
        calls = [(v, None) for v in ("today", "recovery", "load", "strength", "sessions", "program", "calendar",
                                     "races", "trips", "body", "journal", "memory", "system", "fuel")]
        # The latest of each group, the circuit (stations), and another sport (tennis — never a circuit).
        picks = [lambda s, g=g: s["group"] == g for g in ("strength", "run", "swim", "bike")]
        picks += [lambda s: s["kind"] == "circuit", lambda s: s["kind"] == "sport"]
        for pick in picks:
            hit = next((s for s in views if pick(s)), None)
            if hit:
                calls.append(("workout", str(hit["id"])))
        if not SPARSE:   # the done races' activities, which their results link to
            calls += [("workout", str(RACE_AID)), ("workout", str(TRI_AID))]
        calls += [("exercise", "BENCH_PRESS/BARBELL_BENCH_PRESS"), ("exercise", "BENCH_PRESS/INCLINE_DUMBBELL_BENCH_PRESS"),
                  ("exercise", "SQUAT/LEG_PRESS")]
        if not SPARSE:
            calls += [("journal-entry", f"{TODAY}.md"),
                      ("journal-entry", f"{TODAY - dt.timedelta(days=TODAY.weekday())}-review.md")]
        if review:   # the ride's review markdown, which its workout page opens
            calls.append(("journal-entry", f"{review['date']}-{review['activity_id']}-review.md"))
        index = {}
        for name, arg in calls:
            payload = json.loads(run(["scripts/app_data.py", name] + ([arg] if arg else []), env))
            fname = name if arg is None else f"{name}--{arg.replace('/', '--')}"
            dump(out / "views" / f"{fname}.json", payload)
            index.setdefault(name, []).append({"arg": arg, "file": f"views/{fname}.json"})
        res = results() | ({"endurance_review": review} if review else {})
        for kind, payload in res.items():
            problems = app_contracts.validate(payload["kind"], payload)
            if problems:
                sys.exit(f"fixture {kind} breaks its contract: {problems}")
            dump(out / "results" / f"{kind}.json", payload)
        dump(out / "index.json", {"athlete": NAME, "display": DISPLAY, "generated_on": TODAY.isoformat(),
                                  "views": index, "results": sorted(res)})
        if args.keep:
            shutil.copytree(root, args.keep, dirs_exist_ok=True)
    print(f"wrote {out.relative_to(REPO) if out.is_relative_to(REPO) else out}: "
          f"{sum(len(v) for v in index.values())} views, {len(res)} results")


if __name__ == "__main__":
    main()
