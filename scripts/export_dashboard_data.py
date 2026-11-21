#!/usr/bin/env python3
"""Export the athlete's dashboard.json (v3) from their cached data/<name>/ pulls.

Writes athletes/<name>/dashboard.json — the data the daily brief is rendered from, and the only
version-controlled record of the athlete's health history (data/ is gitignored). The React
dashboard that also read it was deleted on 2026-10-08; the app (docs/DESIGN.md (the app)) reads it through scripts.

Reads health, activities + per-activity sets, body composition, and scheduled
workouts (all from the cache, no Garmin calls — run the pull scripts first) and
computes everything the dashboard renders:

  hero rings (recovery/sleep/strain), today's scheduled plan, body-weight vs
  target, a TrainingPeaks-style CTL/ATL/TSB fitness model (with sparklines),
  30d recovery + sleep trends, the current-week day-by-day breakdown, executed
  weekly sets per muscle vs target, weekly tonnage, recent e1RM PRs, per-lift
  progression, and a browsable workout history with per-exercise set detail.

Usage: python scripts/export_dashboard_data.py [--end YYYY-MM-DD] [--out PATH]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402
import formulas  # noqa: E402

A = athlete.current()
DATA = A.data_dir
_PROFILE = A.profile

# Fallbacks only — build() derives live values from the data (rolling 30d mean;
# band from Garmin's own hrvSummary.baseline). Summer heat shifts the real
# baseline, so hardcoded cool-weather numbers must not drive the deltas.
# The athlete's own values live in athletes/<name>/athlete.json -> profile.
# The athlete's own numbers, or None. Never a constant: a default band is somebody else's normal, and
# a new athlete's watch has none yet (Garmin calibrates for ~3 weeks). Missing → the UI says so.
HRV_BAND = tuple(_PROFILE["hrv_band"]) if _PROFILE.get("hrv_band") else None
HRV_BASELINE = _PROFILE.get("hrv_baseline")
RHR_BASELINE = _PROFILE.get("rhr_baseline")
STRAIN_REF = _PROFILE.get("strain_ref") or 250.0
WEIGHT_TARGET = tuple(_PROFILE.get("weight_target_kg") or (None, None))
BODY_SERIES_DAYS = 120   # the weight series' window, the same as the app's Body view (app_data.v_body)


def body_series(dwl: list, today_d: dt.date) -> list:
    """The weight sparkline's points: the last 20 weigh-ins inside BODY_SERIES_DAYS. The label has no
    year, so a point from outside the window would read as this season's (2026-11-10 audit: 2025-11-30
    and 2025-12-20 printed as "11-30, 12-20" beside 2026-10-11). `dwl` is sorted by calendarDate."""
    start = (today_d - dt.timedelta(days=BODY_SERIES_DAYS)).isoformat()
    return [{"date": e["calendarDate"][5:10], "kg": round((e.get("weight") or 0) / 1000, 1)}
            for e in dwl[-20:] if e["calendarDate"][:10] >= start]
CTL_TAU, ATL_TAU = 42, 7  # EWMA time-constants (days)

# e1RM progression lifts, per athlete. Machine lifts logged as added-disc load only
# (machine_added_load_only in LOGGING_RULES.json) must stay OUT: e1RM on a disc number is
# meaningless. One athlete's list deliberately excludes the hip thrust for that reason.
def _key_lifts(profile: dict) -> tuple[dict, list]:
    """(label -> (category, exerciseName), problems). Two forms, both in athlete.json -> profile:

        "key_lifts": {"Bench": ["BENCH_PRESS", "BARBELL_BENCH_PRESS"]}   label -> catalog pair
        "key_lifts": {"d1/D1E1": "Hip thrust"}                           prescription -> label

    The second names a PRESCRIPTION (day/exerciseId), so a pair prescribed on two days can never
    blur into one series; its pair comes from the program. 2026-10-08: the engine knew only the
    first form, tuple() split the second's labels into letters, and the export died on the first set
    with "too many values to unpack" — taking refresh.sh down with it. Anything else is now named,
    and build() refuses to run on it (test_key_lifts_are_catalog_pairs)."""
    out, problems = {}, []
    program = None
    for key, val in (profile.get("key_lifts") or {}).items():
        if isinstance(val, (list, tuple)) and len(val) == 2 and all(isinstance(x, str) for x in val):
            out[key] = tuple(val)
            continue
        if isinstance(val, str) and key.count("/") == 1:
            if program is None:
                try:
                    from build_workouts import PROGRAM as program
                except Exception:  # noqa: BLE001 — reported below, by entry
                    program = {}
            day, exid = key.split("/")
            ex = next((e for e in (program.get(day) or {}).get("exercises", []) if e[0] == exid), None)
            if ex is not None:
                out[val] = (ex[2], ex[3])
                continue
            problems.append(f"profile.key_lifts[{key!r}] names no prescription in the program (no {exid} on {day})")
            continue
        problems.append(f"profile.key_lifts[{key!r}] must be a [category, exerciseName] catalog pair, or "
                        f"a \"day/exerciseId\" key with a label (got a {type(val).__name__})")
    return out, problems


KEY_LIFTS, KEY_LIFT_PROBLEMS = _key_lifts(_PROFILE)

# The sport map lives in sports.py — one map for the export, the app and the puller.
from sports import SPORT_GROUP, badge as sports_badge  # noqa: E402

# --- muscle attribution -------------------------------------------------------
# Garmin's exercise CATEGORIES do not partition by muscle, so a category-only map
# silently misfiles whole exercises. The 2026-08-14 audit measured the damage:
# 232 of 1731 sets (13.4%) miscounted or dropped, in the very chart used to justify
# programming changes — including 51 dip sets that never counted toward chest, the
# muscle the v6 redesign exists to fix.
#
# Not a muscle: the bucket for speed, power and conditioning work done inside a gym session.
ATHLETIC = "Athletic"

# MUSCLE_PAIR is checked FIRST and wins; MUSCLE is the category fallback.
MUSCLE_PAIR = {
    # Dips are a chest movement here (D1E6), but Garmin files every variant under
    # TRICEPS_EXTENSION. They still train triceps — attribution has to pick one owner,
    # and in this program dips are prescribed as the chest slot.
    ("TRICEPS_EXTENSION", "BENCH_DIP"): "Chest",
    ("TRICEPS_EXTENSION", "BODY_WEIGHT_DIP"): "Chest",
    ("TRICEPS_EXTENSION", "WEIGHTED_DIP"): "Chest",
    ("SUSPENSION", "DIP"): "Chest",
    # Face pull is categorised ROW but is prescribed as rear-delt work (D4E6).
    ("ROW", "FACE_PULL"): "Delts",
    # Reverse flyes sit in Garmin's FLYE category, whose fallback is Chest, but they train the rear
    # delts: the opposite side of the shoulder (2026-11-06, when one replaced a face pull).
    ("FLYE", "FACE_DOWN_INCLINE_REVERSE_FLYE"): "Delts",
    ("FLYE", "INCLINE_REVERSE_FLYE"): "Delts",
    ("FLYE", "SINGLE_ARM_STANDING_CABLE_REVERSE_FLYE"): "Delts",
    # Renegade row sits in Garmin's ROW category but is prescribed in the CORE BLOCK as an
    # anti-rotation exercise (2026-09-01). It does load the lats, but 2x12 in a core block is
    # not meaningful back volume, and counting it as Back would inflate a band already well
    # served (17 sets) while leaving Core reading low. Attributed by intent.
    ("ROW", "RENEGADE_ROW"): "Core",
    # HIP_STABILITY is a whole category the muscle map never knew about — dead bug landed in
    # Unattributed on its first outing (2026-09-01), which is exactly the silent-drop failure
    # the 2026-08-14 audit built that bucket to expose. It worked.
    ("HIP_STABILITY", "DEAD_BUG"): "Core",
    ("HIP_STABILITY", "WEIGHTED_DEAD_BUG"): "Core",
    ("CORE", "ARM_AND_LEG_EXTENSION_ON_KNEES"): "Core",
    # Garmin genuinely files machine leg extensions under CRUNCH. They are quads.
    ("CRUNCH", "LEG_EXTENSIONS"): "Quads",
    ("CRUNCH", "WEIGHTED_LEG_EXTENSIONS"): "Quads",
    # A med-ball chest pass sits in PUSH_UP, but it is a throw for speed (a push day's power
    # opener, 2026-10-11) — counting it as chest volume would inflate the band it does not train.
    ("PUSH_UP", "MEDICINE_BALL_CHEST_PASS"): ATHLETIC,
    ("PUSH_UP", "EXPLOSIVE_PUSH_UP"): ATHLETIC,
    # Suspension-trainer work is filed under one SUSPENSION category whatever it trains.
    ("SUSPENSION", "PUSH_UP"): "Chest",
    ("SUSPENSION", "ROW"): "Back",
    ("SUSPENSION", "INVERTED_ROW"): "Back",
    # Core-block work filed under equipment categories (v8.4, 2026-10-18). Without these the
    # TRX fallout and the sandbag pull-through would land in Unattributed - SUSPENSION and SANDBAG
    # have no category fallback because they train whatever the exercise trains.
    ("SUSPENSION", "ROLLOUT"): "Core",
    ("SANDBAG", "PLANK_PULL_THROUGH"): "Core",
    # A waiter carry holds one dumbbell overhead: shoulder stability, not the traps' shrug job.
    ("CARRY", "DUMBBELL_WAITER_CARRY"): "Delts",
    # A light hang power clean is taught and done for speed (2026-10-25): power work,
    # counted with the jumps rather than as hamstring volume.
    ("OLYMPIC_LIFT", "BARBELL_HANG_POWER_CLEAN"): ATHLETIC,
    ("TOTAL_BODY", "BURPEE"): ATHLETIC,
}

# exercise category -> muscle group (approximate; deadlift counted as posterior chain)
MUSCLE = {
    "BENCH_PRESS": "Chest", "FLYE": "Chest", "PUSH_UP": "Chest",
    "ROW": "Back", "PULL_UP": "Back", "HYPEREXTENSION": "Back",
    "SHOULDER_PRESS": "Delts", "LATERAL_RAISE": "Delts",
    "CURL": "Biceps", "TRICEPS_EXTENSION": "Triceps",
    "SQUAT": "Quads", "LUNGE": "Quads",
    "DEADLIFT": "Hams/Glutes", "LEG_CURL": "Hams/Glutes", "HIP_RAISE": "Hams/Glutes",
    "CALF_RAISE": "Calves", "SHRUG": "Traps",
    "CORE": "Core", "CRUNCH": "Core", "PLANK": "Core", "LEG_RAISE": "Core", "CHOP": "Core", "SIT_UP": "Core",
    # Loaded carries hold the traps and grip isometrically, dumbbells at the sides — the same
    # mechanism as a shrug, which is the slot they replaced in one athlete's program (2026-10-11).
    "CARRY": "Traps",
    # Speed, jumps, sleds and conditioning inside a gym session (2026-10-11). Real work, but not
    # hypertrophy volume: it is counted in its own bucket, with no target band, so it neither
    # vanishes into Unattributed nor inflates a muscle's working sets.
    "PLYO": ATHLETIC, "RUN": ATHLETIC, "SLED": ATHLETIC, "CARDIO": ATHLETIC, "BATTLE_ROPE": ATHLETIC,
}

# Sets the watch could not auto-detect (category "UNKNOWN") were previously discarded
# without a trace — 150 sets, 9% of all history. They now land in this bucket so a
# rising number is visible instead of quietly shrinking every muscle's total.
UNATTRIBUTED = "Unattributed"


def muscle_of(category, name):
    """Muscle group for a logged set. Pair match wins; category is the fallback.

    Returns UNATTRIBUTED for anything unrecognised (incl. the watch's auto-detect failures)
    so it can be shown rather than dropped.
    """
    return MUSCLE_PAIR.get((category, name)) or MUSCLE.get(category) or UNATTRIBUTED
# Weekly working-set target range per muscle. The athlete's own bands live in their profile;
# these defaults are placeholders until the intake sets them.
_DEFAULT_TARGET = {
    "Chest": (10, 20), "Back": (10, 20), "Delts": (8, 20), "Biceps": (6, 14),
    "Triceps": (6, 14), "Quads": (10, 18), "Hams/Glutes": (10, 18),
    "Calves": (4, 12), "Traps": (4, 10), "Core": (6, 16),
}
TARGET = {**_DEFAULT_TARGET,
          **{m: tuple(v) for m, v in (_PROFILE.get("muscle_targets") or {}).items()}}
MUSCLE_ORDER = ["Chest", "Back", "Delts", "Biceps", "Triceps", "Quads", "Hams/Glutes", "Calves", "Traps", "Core"]


# --- warm-up exclusion --------------------------------------------------------
# Garmin logs prescribed warm-up sets with setType "ACTIVE", identical to working
# sets, so every bench / deadlift / front-squat session used to report +2 phantom
# working sets. Volume counts exclude them; TONNAGE deliberately still includes
# them, because the work was really performed.
def _warmup_specs():
    """(category, exerciseName) -> [(weight_kg, reps), ...] from the program itself."""
    try:
        from build_workouts import PROGRAM, WARMUPS
    except Exception:
        return {}
    out = {}
    for day in PROGRAM.values():
        for ex in day["exercises"]:
            exid, _, cat, name, *_ = ex
            if exid in WARMUPS:
                out[(cat, name)] = list(WARMUPS[exid])
    return out


WARMUP_SPECS = _warmup_specs()


# A SET THAT WAS TAPPED THROUGH IS NOT A SET (2026-11-08 audit, P1-1). On 11-03 an athlete pressed the
# lap button through hip thrust (no reps, 17 s) and leg curl (no reps, 9 s) to reach the calves, and
# the weekly volume counted both: Hams/Glutes read 2 when the truth was 0. A pair the program asks
# for in REPS needs a rep count to be a set; a hold, a timed step or a pair the program does not
# prescribe keeps the old rule (reps or a duration). Tonnage is untouched: a tap moves no weight.
def _rep_only_pairs():
    try:
        from build_workouts import prescriptions
    except Exception:
        return set()
    kinds = defaultdict(set)
    for _day, ex, _block in prescriptions():
        kinds[(ex[2], ex[3])].add(ex[8])
    return {k for k, ks in kinds.items() if not any(x.startswith("time") for x in ks)}


REP_ONLY = _rep_only_pairs()


def is_logged_work(s) -> bool:
    if s.get("repetitionCount"):
        return True
    ex = (s.get("exercises") or [{}])[0]
    return (ex.get("category"), ex.get("name")) not in REP_ONLY and bool(s.get("duration"))


def strip_warmups(sets):
    """Drop leading sets of each exercise block that match a programmed warm-up.

    Only the RUN AT THE START of a block is considered — a light set after the working
    sets is a genuine back-off set, not a warm-up, and must keep counting.
    """
    kept, i, n = [], 0, len(sets)
    while i < n:
        ex = (sets[i].get("exercises") or [{}])[0]
        key = (ex.get("category"), ex.get("name"))
        j = i
        while j < n:
            e2 = (sets[j].get("exercises") or [{}])[0]
            if (e2.get("category"), e2.get("name")) != key:
                break
            j += 1
        block, specs = sets[i:j], list(WARMUP_SPECS.get(key, []))
        k = 0
        while k < len(block) and specs:
            w = round((block[k].get("weight") or 0) / 1000, 2)
            r = block[k].get("repetitionCount") or 0
            hit = next((s for s in specs if abs(s[0] - w) < 0.01 and s[1] == r), None)
            if hit is None:
                break
            specs.remove(hit)
            k += 1
        kept.extend(block[k:])
        i = j
    return kept


def load(name: str):
    f = DATA / name
    return json.loads(f.read_text()) if f.exists() else None


def daterange(start: dt.date, end: dt.date):
    for i in range((end - start).days + 1):
        yield start + dt.timedelta(days=i)


def rhr_of(day):
    j = load(f"{day}_rhr.json")
    try:
        return j["allMetrics"]["metricsMap"]["WELLNESS_RESTING_HEART_RATE"][0]["value"]
    except (KeyError, IndexError, TypeError):
        return None


def readiness_of(day):
    """The canonical overnight-recovery score is the AFTER_WAKEUP_RESET entry.
    Other resets (AFTER_POST_EXERCISE_RESET after a session, realtime UPDATE
    entries) also carry validSleep=True and a later timestamp, but they reflect
    intraday state, not how he woke up — so prefer the wake-up reset explicitly,
    only falling back to validSleep / latest when no wake-up entry exists."""
    j = load(f"{day}_readiness.json")
    if not (isinstance(j, list) and j):
        return None
    by_time = lambda xs: sorted(xs, key=lambda x: x.get("timestamp") or "")[-1]
    wake = [x for x in j if x.get("inputContext") == "AFTER_WAKEUP_RESET"]
    if wake:
        return by_time(wake)
    valid = [x for x in j if x.get("validSleep")]
    return by_time(valid or j)


def e1rm(weight, reps):
    return round(formulas.e1rm(weight, reps), 1)


def pretty(cat, name):
    return (name or cat or "Exercise").replace("_", " ").title()


def strain_from_load(v):
    return round(min(21.0, 21.0 * (v or 0) / STRAIN_REF), 1)


def all_activities():
    out, seen = [], set()
    for af in sorted(DATA.glob("activities_*.json")):
        for a in json.loads(af.read_text()):
            if a.get("activityId") not in seen:
                seen.add(a["activityId"])
                out.append(a)
    out.sort(key=lambda a: a.get("startTimeLocal", ""), reverse=True)
    return out


# Set-logging normalization rules — single source of truth shared with
# progression_report.py (see the athlete's workouts/LOGGING_RULES.json for semantics).
_RULES = A.logging_rules
TWO_DB = {tuple(x) for x in _RULES["two_db_weight_summed"]}
UNILATERAL = {tuple(x) for x in _RULES["unilateral_reps_summed"]}
MACHINE = {tuple(x) for x in _RULES.get("machine_added_load_only", [])}  # disc-load only: never e1RM


def sets_of(aid):
    j = load(f"activity_{aid}_sets.json")
    return [s for s in (j.get("exerciseSets") if j else []) or [] if s.get("setType") == "ACTIVE"]


def session_blocks(aid):
    blocks, cur = [], None
    for s in sets_of(aid):
        ex = (s.get("exercises") or [{}])[0]
        key = (ex.get("category"), ex.get("name"))
        w = round((s.get("weight") or 0) / 1000, 1)
        reps = s.get("repetitionCount") or 0
        if key != cur:
            blocks.append({"name": pretty(*key), "perSide": key in TWO_DB, "perSideReps": key in UNILATERAL,
                           "machine": key in MACHINE, "sets": []})
            cur = key
        blocks[-1]["sets"].append({"w": w, "reps": reps})  # raw logged (w summed if perSide; reps summed if perSideReps)
    for b in blocks:
        wt = [x for x in b["sets"] if x["w"]]
        machine = b.pop("machine")
        if b["perSide"]:
            b["top"] = round(max((x["w"] for x in wt), default=0) / 2, 1)  # per-side weight
            b["e1rm"] = 0
        elif machine:  # added-disc load only: show top weight, never e1RM
            b["top"] = max((x["w"] for x in wt), default=0)
            b["e1rm"] = 0
        elif b["perSideReps"]:
            b["top"] = max((x["w"] for x in wt), default=0)  # single-implement weight
            b["e1rm"] = 0
        else:
            b["top"] = max((x["w"] for x in wt), default=0)
            b["e1rm"] = max((e1rm(x["w"], x["reps"]) for x in wt), default=0)
    return blocks


def tonnage_of(aid):
    return round(sum((round((s.get("weight") or 0) / 1000, 1)) * (s.get("repetitionCount") or 0) for s in sets_of(aid)))


def fitness_model(acts: list, load_by_day: dict, end: dt.date) -> list[dict]:
    """Fitness (CTL), fatigue (ATL) and form (TSB): exponentially weighted Garmin load over the whole
    activity history, one point per day up to `end`. Read by build() and by the app's load view."""
    act_dates = [dt.date.fromisoformat(a["startTimeLocal"][:10]) for a in acts]
    first = min(act_dates) if act_dates else end - dt.timedelta(days=60)
    ctl = atl = 0.0
    series = []
    for d in daterange(first, end):
        L = load_by_day.get(d.isoformat(), 0.0)
        ctl += (L - ctl) / CTL_TAU
        atl += (L - atl) / ATL_TAU
        series.append({"date": d.isoformat()[5:], "iso": d.isoformat(), "ctl": round(ctl, 1), "atl": round(atl, 1),
                       "tsb": round(ctl - atl, 1), "ctl_raw": ctl, "atl_raw": atl})
    return series


# Custom recovery composite — transparent weights, cross-check on Garmin's black-box readiness.
# (label, weight) in display order. Read by build() and by the app (definitions and past days).
RECOVERY_WEIGHTS = (("HRV vs 30d", 40), ("RHR vs 30d", 20), ("Sleep perf", 25), ("Respiration", 10), ("Skin temp", 5))


def sleep_metrics(s: dict) -> dict:
    """One night's sleep numbers from Garmin's dailySleepDTO — the ONE definition the brief (last
    night) and the app (any night) share. Performance = asleep ÷ Garmin's sleep need; restorative =
    (deep + REM) ÷ asleep; efficiency = asleep ÷ time from falling asleep to waking."""
    need = (s.get("sleepNeed") or {}).get("actual")
    total_s = s.get("sleepTimeSeconds") or 0
    asleep = total_s / 60
    perf = max(0.0, min(100.0, 100 * asleep / need)) if need and asleep else None
    deep_s, rem_s = s.get("deepSleepSeconds") or 0, s.get("remSleepSeconds") or 0
    in_bed_s = ((s["sleepEndTimestampLocal"] - s["sleepStartTimestampLocal"]) / 1000
                if s.get("sleepStartTimestampLocal") and s.get("sleepEndTimestampLocal") else None)
    return {"asleep_min": round(asleep) if asleep else None, "need_min": need,
            "performance_pct": round(perf) if perf is not None else None,
            "restorative_pct": round(100 * (deep_s + rem_s) / total_s) if total_s else None,
            "efficiency_pct": round(100 * total_s / in_bed_s) if in_bed_s else None,
            "in_bed_min": round(in_bed_s / 60) if in_bed_s else None}


def component_state(label: str, score: int) -> str:
    """One signal's reading in words, from its 0–100 score. HRV and resting HR score 50 at your
    30-day usual (±5 % HRV or ±1.3 bpm reads as usual: 37–63); sleep scores its percent of need;
    respiration and skin temperature score 100 at or under usual and lose points as they rise."""
    if label in ("HRV vs 30d", "RHR vs 30d"):
        return "better" if score >= 63 else "usual" if score >= 37 else "below" if score >= 23 else "well_below"
    if label == "Sleep perf":
        return "met" if score >= 90 else "short" if score >= 75 else "well_short"
    return "usual" if score >= 80 else "raised" if score > 50 else "high"


def recovery_composite(hv, hrv_baseline, rv, rhr_baseline, perf, actual_min, need_min,
                       resp_today, resp_dev, skin_dev) -> tuple[list, int | None]:
    """(components, score). HRV log-scaled vs ROLLING baseline, RHR deviation, sleep performance,
    respiration deviation, skin temperature; a missing signal drops out and the weights rescale.
    Each component: label, score (0–100), weight, detail, and for the app — value, normal, unit,
    state (component_state) and points (its share of the score)."""
    import math

    def clamp(v, lo=0.0, hi=100.0):
        return max(lo, min(hi, v))
    w = dict(RECOVERY_WEIGHTS)
    comp = []

    def add(label, score, detail, value, normal, unit):
        score = round(score)
        comp.append({"label": label, "score": score, "weight": w[label], "detail": detail, "value": value,
                     "normal": normal, "unit": unit, "state": component_state(label, score)})
    if hv and hrv_baseline:
        add("HRV vs 30d", clamp(50 + math.log(hv / hrv_baseline) * 260), f"{hv} vs {hrv_baseline} ms", hv, hrv_baseline, "ms")
    if rv and rhr_baseline:
        add("RHR vs 30d", clamp(50 + (rhr_baseline - rv) * 10), f"{rv} vs {rhr_baseline} bpm", rv, rhr_baseline, "bpm")
    if perf is not None:
        add("Sleep perf", perf, f"{actual_min / 60:.1f} of {need_min / 60:.1f} h needed",
            round(actual_min / 60, 1), round(need_min / 60, 1), "h")
    if resp_dev is not None:
        add("Respiration", clamp(100 - max(0.0, resp_dev) * 50), f"{resp_today} brpm ({'+' if resp_dev >= 0 else ''}{resp_dev})",
            resp_today, round(resp_today - resp_dev, 1), "brpm")
    if skin_dev is not None:
        add("Skin temp", clamp(100 - max(0.0, skin_dev) * 50), f"{'+' if skin_dev >= 0 else ''}{skin_dev}°C dev", skin_dev, 0, "°C")
    wsum = sum(c["weight"] for c in comp)
    for c in comp:
        c["points"] = round(c["score"] * c["weight"] / wsum, 1)
    return comp, (round(sum(c["score"] * c["weight"] for c in comp) / wsum) if wsum else None)


def recovery_on(day: str) -> dict:
    """The recovery score for any past day, from that day's own rolling 30-day window — the same
    composite build() reports for today (tests hold the two equal). For the app's recovery calendar."""
    end = dt.date.fromisoformat(day)
    days = [d.isoformat() for d in daterange(end - dt.timedelta(days=29), end)]
    hrv = {d: (load(f"{d}_hrv.json") or {}).get("hrvSummary", {}) for d in days}
    sleep_raw = {d: load(f"{d}_sleep.json") or {} for d in days}
    sleep = {d: sleep_raw[d].get("dailySleepDTO") or {} for d in days}
    hrv_vals = [hrv[d].get("lastNightAvg") for d in days if hrv[d].get("lastNightAvg")]
    hrv_baseline = round(sum(hrv_vals) / len(hrv_vals), 1) if hrv_vals else HRV_BASELINE
    rhr_vals = [v for v in (rhr_of(d) for d in days) if v]
    rhr_baseline = round(sum(rhr_vals) / len(rhr_vals), 1) if rhr_vals else RHR_BASELINE
    s_day = sleep[day]
    need_min = (s_day.get("sleepNeed") or {}).get("actual")
    actual_min = (s_day.get("sleepTimeSeconds") or 0) / 60
    perf = max(0.0, min(100.0, 100 * actual_min / need_min)) if need_min and actual_min else None
    resp_today = s_day.get("averageRespirationValue")
    resp_hist = [v for v in (sleep[d].get("averageRespirationValue") for d in days[:-1]) if v]
    resp_base = round(sum(resp_hist) / len(resp_hist), 1) if resp_hist else None
    resp_dev = round(resp_today - resp_base, 1) if resp_today and resp_base else None
    comp, score = recovery_composite(hrv[day].get("lastNightAvg"), hrv_baseline, rhr_of(day), rhr_baseline,
                                     perf, actual_min, need_min, resp_today, resp_dev,
                                     sleep_raw[day].get("avgSkinTempDeviationC"))
    return {"date": day, "score": score, "signals": len(comp),
            "components": comp}


def build(end: dt.date) -> dict:
    if KEY_LIFT_PROBLEMS:
        sys.exit(f"{A.name}'s athlete.json: " + "; ".join(KEY_LIFT_PROBLEMS))
    start30 = end - dt.timedelta(days=29)
    days = [d.isoformat() for d in daterange(start30, end)]
    hrv = {d: (load(f"{d}_hrv.json") or {}).get("hrvSummary", {}) for d in days}
    sleep_raw = {d: load(f"{d}_sleep.json") or {} for d in days}
    sleep = {d: sleep_raw[d].get("dailySleepDTO") or {} for d in days}
    ready = {d: readiness_of(d) for d in days}
    bb = {d: load(f"{d}_body_battery.json") or {} for d in days}
    today = next((d for d in reversed(days) if ready.get(d)), days[-1])
    today_d = dt.date.fromisoformat(today)

    # Live baselines from the 30d window (fallback to cool-weather constants)
    hrv_vals = [hrv[d].get("lastNightAvg") for d in days if hrv[d].get("lastNightAvg")]
    hrv_baseline = round(sum(hrv_vals) / len(hrv_vals), 1) if hrv_vals else HRV_BASELINE
    rhr_vals = [rhr_of(d) for d in days]
    rhr_vals = [v for v in rhr_vals if v]
    rhr_baseline = round(sum(rhr_vals) / len(rhr_vals), 1) if rhr_vals else RHR_BASELINE
    gb = (hrv[today].get("baseline") or {})
    band_low = gb.get("balancedLow") or (HRV_BAND[0] if HRV_BAND else None)
    band_high = gb.get("balancedUpper") or (HRV_BAND[1] if HRV_BAND else None)

    ts = load(f"{today}_training_status.json") or {}
    tsdev = next(iter(((ts.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData") or {}).values()), {})
    atl_g = tsdev.get("acuteTrainingLoadDTO") or {}
    vo2 = ts.get("mostRecentVO2Max") or {}

    sscore = lambda d: ((sleep[d].get("sleepScores") or {}).get("overall") or {}).get("value")
    shours = lambda d: round(sleep[d]["sleepTimeSeconds"] / 3600, 2) if sleep[d].get("sleepTimeSeconds") else None

    acts = all_activities()
    load_by_day = defaultdict(float)
    for a in acts:
        load_by_day[a["startTimeLocal"][:10]] += a.get("activityTrainingLoad") or 0

    # ---- CTL / ATL / TSB (EWMA over the full activity history) ----
    series = fitness_model(acts, load_by_day, end)
    fitness, fatigue = series[-1]["ctl"], series[-1]["atl"]
    form = round(series[-1]["ctl_raw"] - series[-1]["atl_raw"], 1)
    for p_ in series:
        p_.pop("ctl_raw"), p_.pop("atl_raw"), p_.pop("iso")
    load_series = series[-42:]
    spark = {
        "fitness": [p["ctl"] for p in series[-30:]],
        "fatigue": [p["atl"] for p in series[-30:]],
        "form": [p["tsb"] for p in series[-30:]],
        "hrv": [hrv[d].get("lastNightAvg") for d in days],
        "rhr": [rhr_of(d) for d in days],
    }

    # ---- today's scheduled plan ----
    sched = load("scheduled.json") or []
    plan_item = next((i for i in sched if i.get("date") == today), None)
    plan = {"name": plan_item.get("title") if plan_item else None,
            "scheduled": bool(plan_item),
            "done": bool(plan_item and plan_item.get("associatedActivityId"))}

    # ---- body weight ----
    bc = load("bodycomp.json") or {}
    dwl = sorted((bc.get("dateWeightList") or []), key=lambda x: x.get("calendarDate") or "")
    body = None
    if dwl:
        last = dwl[-1]
        kg = round((last.get("weight") or 0) / 1000, 1)
        ld = last.get("calendarDate", "")[:10]
        body = {"latestKg": kg, "latestDate": ld,
                "daysSince": (today_d - dt.date.fromisoformat(ld)).days if ld else None,
                "targetLow": WEIGHT_TARGET[0], "targetHigh": WEIGHT_TARGET[1],
                "series": body_series(dwl, today_d)}

    # ---- Whoop-style night module (P1, 2026-07-16) ----
    # All from cached sleep pulls; baselines are ROLLING 30d, so the composite
    # inherently absorbs seasonal shifts (the summer-heat HRV problem).
    def clamp(v, lo=0.0, hi=100.0):
        return max(lo, min(hi, v))

    def bedwake_minutes(ts_ms):
        # epoch-ms already shifted to local wall time; minutes since 18:00 to
        # avoid the midnight wrap when measuring bed/wake-time regularity
        t = dt.datetime.fromtimestamp(ts_ms / 1000, dt.timezone.utc)
        return ((t.hour - 18) % 24) * 60 + t.minute, t.strftime("%H:%M")

    s_today = sleep[today]
    sm = sleep_metrics(s_today)
    need_min = sm["need_min"]
    actual_min = (s_today.get("sleepTimeSeconds") or 0) / 60
    perf = clamp(100 * actual_min / need_min) if need_min and actual_min else None   # unrounded, for the composite

    debt7 = 0.0
    for d in days[-7:]:
        n = (sleep[d].get("sleepNeed") or {}).get("actual")
        a = (sleep[d].get("sleepTimeSeconds") or 0) / 60
        if n and a:
            debt7 += max(0.0, n - a)
    debt7_h = round(debt7 / 60, 1)

    beds, wakes, bt_label, wk_label = [], [], None, None
    for d in days[-5:]:
        st, en = sleep[d].get("sleepStartTimestampLocal"), sleep[d].get("sleepEndTimestampLocal")
        if st and en:
            bm, bl = bedwake_minutes(st)
            wm, wl = bedwake_minutes(en)
            beds.append(bm), wakes.append(wm)
            if d == today:
                bt_label, wk_label = bl, wl
    consistency = None
    if len(beds) >= 3:
        sd = lambda xs: (sum((x - sum(xs) / len(xs)) ** 2 for x in xs) / len(xs)) ** 0.5
        consistency = round(clamp(100 - (sd(beds) + sd(wakes)) / 2 * (2 / 3)))

    deep_s, rem_s = s_today.get("deepSleepSeconds") or 0, s_today.get("remSleepSeconds") or 0
    restorative, efficiency = sm["restorative_pct"], sm["efficiency_pct"]

    resp_today = s_today.get("averageRespirationValue")
    resp_hist = [sleep[d].get("averageRespirationValue") for d in days[:-1]]
    resp_hist = [v for v in resp_hist if v]
    resp_base = round(sum(resp_hist) / len(resp_hist), 1) if resp_hist else None
    resp_dev = round(resp_today - resp_base, 1) if resp_today and resp_base else None
    skin_dev = sleep_raw[today].get("avgSkinTempDeviationC")
    spo2 = s_today.get("averageSpO2Value")

    flags = []
    if resp_dev is not None and resp_dev >= 1.0:
        flags.append(f"Respiration +{resp_dev} brpm above your 30d baseline ({resp_base}) — classic early illness signal. Watch it.")
    if skin_dev is not None and skin_dev >= 1.0:
        flags.append(f"Skin temp +{skin_dev}°C above baseline overnight — possible illness/overreaching. Cross-check resp + HRV.")
    if spo2 is not None and spo2 < 94:
        flags.append(f"Overnight SpO2 {spo2}% (<94) — poor night or airway issue; recheck tomorrow.")
    if debt7_h >= 5:
        flags.append(f"Sleep debt {debt7_h} h over 7 nights — recovery ceiling is capped until you repay it.")

    # Custom recovery composite — recovery_composite(), shared with the app's past days.
    comp, recovery_score = recovery_composite(hrv[today].get("lastNightAvg"), hrv_baseline, rhr_of(today),
                                              rhr_baseline, perf, actual_min, need_min, resp_today,
                                              resp_dev, skin_dev)

    night = {
        "date": today,
        "recoveryScore": recovery_score,
        "garminReadiness": (ready[today] or {}).get("score"),
        "components": comp,
        "sleep": {"performancePct": round(perf) if perf is not None else None,
                  "needH": round(need_min / 60, 2) if need_min else None,
                  "actualH": round(actual_min / 60, 2) if actual_min else None,   # 2 places: 6.8 h reads 6:48 for a 6:50 night
                  "debt7dH": debt7_h, "consistencyPct": consistency,
                  "restorativePct": restorative, "efficiencyPct": efficiency,
                  "deepMin": round(deep_s / 60), "remMin": round(rem_s / 60),
                  "lightMin": round((s_today.get("lightSleepSeconds") or 0) / 60),
                  "awakeMin": round((s_today.get("awakeSleepSeconds") or 0) / 60),
                  "bedtime": bt_label, "waketime": wk_label},
        "vitals": {"respiration": {"value": resp_today, "baseline": resp_base, "deviation": resp_dev},
                   "skinTempDevC": skin_dev, "spo2": spo2},
        "flags": flags,
    }

    snapshot = {
        "date": today,
        "readiness": {"score": (ready[today] or {}).get("score"), "level": (ready[today] or {}).get("level"),
                      "feedback": (ready[today] or {}).get("feedbackShort")},
        "hrv": {"value": hrv[today].get("lastNightAvg"), "weekly": hrv[today].get("weeklyAvg"),
                "status": hrv[today].get("status"), "baseline": hrv_baseline, "bandLow": band_low, "bandHigh": band_high},
        "rhr": {"value": rhr_of(today), "baseline": rhr_baseline},
        "sleep": {"score": sscore(today), "hours": shours(today)},
        "bodyBattery": {"charged": bb[today].get("charged"), "drained": bb[today].get("drained")},
        "strain": {"value": strain_from_load(load_by_day.get(today, 0)), "load": round(load_by_day.get(today, 0))},
        "fitness": fitness, "fatigue": fatigue, "form": form,
        "acwr": atl_g.get("acwrPercent"), "loadStatus": tsdev.get("trainingStatusFeedbackPhrase"),
        "vo2": {"run": (vo2.get("generic") or {}).get("vo2MaxPreciseValue"), "bike": (vo2.get("cycling") or {}).get("vo2MaxPreciseValue")},
        "plan": plan,
    }

    trends = {
        "recovery": [{"date": d[5:], "hrv": hrv[d].get("lastNightAvg"), "rhr": rhr_of(d), "readiness": (ready[d] or {}).get("score")} for d in days],
        "sleep": [{"date": d[5:], "score": sscore(d), "hours": shours(d)} for d in days[-14:]],
        "band": {"low": band_low, "high": band_high},
        "loadSeries": load_series,
    }

    # ---- current week ----
    monday = end - dt.timedelta(days=end.weekday())
    acts_by_day = defaultdict(list)
    for a in acts:
        acts_by_day[a["startTimeLocal"][:10]].append(a)
    week_days = []
    for d in daterange(monday, monday + dt.timedelta(days=6)):
        ds = d.isoformat()
        items = []
        for a in sorted(acts_by_day.get(ds, []), key=lambda x: x.get("startTimeLocal", "")):
            tk = (a.get("activityType") or {}).get("typeKey", "")
            grp = SPORT_GROUP.get(tk, "other")
            items.append({"group": grp, **sports_badge(tk), "id": a.get("activityId"), "name": a.get("activityName") or "",
                          "durationMin": round((a.get("duration") or 0) / 60),
                          "distanceKm": round((a.get("distance") or 0) / 1000, 1) or None,
                          "load": round(a.get("activityTrainingLoad") or 0)})
        week_days.append({"date": ds, "dow": d.strftime("%a"), "dom": d.day,
                          # The calendar's today, not `today` (the last day with a readiness reading,
                          # which is yesterday until the morning reading syncs) — docs/DESIGN.md (app audit) M2.
                          "isToday": d == end, "isFuture": d > end,
                          "totalLoad": round(load_by_day.get(ds, 0)), "strain": strain_from_load(load_by_day.get(ds, 0)),
                          "readiness": (ready.get(ds) or {}).get("score") if ds in ready else None, "items": items})
    active_days = sum(1 for w in week_days if w["items"] and not w["isFuture"])
    week_cardio_load = week_strength_load = 0.0
    for wd in week_days:
        for it in wd["items"]:
            if it["group"] == "strength":
                week_strength_load += it["load"]
            else:
                week_cardio_load += it["load"]
    week = {"label": f"{monday.strftime('%b %d')} – {(monday + dt.timedelta(days=6)).strftime('%b %d')}",
            "weekLoad": round(sum(w["totalLoad"] for w in week_days)), "activeDays": active_days,
            # SPLIT (2026-08-30 audit, finding 1). Garmin's activityTrainingLoad is
            # EPOC-derived, so it tracks heart rate — and his lifting sits around 100 bpm.
            # In the week of 08-24, three gym sessions totalling 179 min contributed 29 of
            # 403 (7%). Reporting one number made every load statement a statement about
            # his cardio while sounding like a statement about his training. Never present
            # weekLoad alone again: cardioLoad is the one that moves, strength belongs on
            # the tonnage/sets axis.
            "cardioLoad": round(week_cardio_load), "strengthLoad": round(week_strength_load),
            "days": week_days}

    # ---- executed weekly sets per muscle (last 7d) ----
    wk_start = today_d - dt.timedelta(days=6)
    muscle_sets = defaultdict(int)
    for a in acts:
        if SPORT_GROUP.get((a.get("activityType") or {}).get("typeKey", "")) != "strength":
            continue
        if not (wk_start <= dt.date.fromisoformat(a["startTimeLocal"][:10]) <= today_d):
            continue
        for s in strip_warmups(sets_of(a["activityId"])):
            if not is_logged_work(s):
                continue
            ex = (s.get("exercises") or [{}])[0]
            muscle_sets[muscle_of(ex.get("category"), ex.get("name"))] += 1
    # CORE IS TRACKED AGAIN from 2026-08-30. The band was suppressed that morning because
    # his abs block was 15 min of freeform work logged in only 12 of 28 sessions. He then
    # asked for a prescribed routine built from the Garmin catalog, so the work is now
    # measurable and the target means something again. See CORE_BLOCK in build_workouts.py.
    executed_volume = [
        {"muscle": m, "sets": muscle_sets.get(m, 0), "lo": TARGET[m][0], "hi": TARGET[m][1]}
        for m in MUSCLE_ORDER]
    # Show auto-detect failures instead of hiding them. lo/hi 0 = no target band.
    for bucket in (ATHLETIC, UNATTRIBUTED):
        if muscle_sets.get(bucket):
            executed_volume.append({"muscle": bucket, "sets": muscle_sets[bucket], "lo": 0, "hi": 0, "noTarget": True})

    # ---- weekly tonnage (last 10 ISO weeks) ----
    wk_ton = defaultdict(int)
    for a in acts:
        if SPORT_GROUP.get((a.get("activityType") or {}).get("typeKey", "")) != "strength":
            continue
        iso = dt.date.fromisoformat(a["startTimeLocal"][:10]).isocalendar()
        wk_ton[f"{iso[0]}-W{iso[1]:02d}"] += tonnage_of(a["activityId"])
    tonnage_trend = [{"week": w.split("-W")[1], "tonnage": wk_ton[w]} for w in sorted(wk_ton)[-10:]]

    # ---- weekly hours split ----
    weekly = defaultdict(lambda: defaultdict(float))
    for a in acts:
        grp = SPORT_GROUP.get((a.get("activityType") or {}).get("typeKey", ""))
        if grp:
            iso = dt.date.fromisoformat(a["startTimeLocal"][:10]).isocalendar()
            weekly[f"{iso[0]}-W{iso[1]:02d}"][grp] += (a.get("duration") or 0) / 3600
    weekly_load = [{"week": w.split("-W")[1], **{k: round(weekly[w].get(k, 0), 1) for k in ("strength", "bike", "run", "swim", "race")}} for w in sorted(weekly)[-10:]]
    trends["weeklyLoad"] = weekly_load

    # ---- workout history ----
    workouts = []
    for a in acts:
        grp = SPORT_GROUP.get((a.get("activityType") or {}).get("typeKey", ""), "other")
        dd = dt.date.fromisoformat(a["startTimeLocal"][:10])
        base = {"id": a["activityId"], "date": a["startTimeLocal"][:10], "start": a["startTimeLocal"][11:16], "dow": dd.strftime("%a"),
                "title": a.get("activityName") or grp, "durationMin": round((a.get("duration") or 0) / 60),
                "load": round(a.get("activityTrainingLoad") or 0), "avgHR": a.get("averageHR")}
        if grp == "strength":
            ex = session_blocks(a["activityId"])
            workouts.append({**base, "kind": "strength", "exercises": ex,
                             "sets": sum(len(b["sets"]) for b in ex), "reps": sum(s["reps"] for b in ex for s in b["sets"]),
                             "tonnage": round(sum(s["w"] * s["reps"] for b in ex for s in b["sets"]))})
        elif grp in ("bike", "run", "swim", "race"):
            spd = a.get("averageSpeed") or 0
            workouts.append({**base, "kind": "endurance", "group": grp, "type": (a.get("activityType") or {}).get("typeKey", ""),
                             "distanceKm": round((a.get("distance") or 0) / 1000, 1) or None, "maxHR": a.get("maxHR"),
                             "elevationGain": round(a.get("elevationGain") or 0) or None, "speedKmh": round(spd * 3.6, 1) if spd else None})
    workouts = workouts[:60]

    # ---- progression + PRs ----
    prog = defaultdict(dict)
    for sf in DATA.glob("activity_*_sets.json"):
        for s in (json.loads(sf.read_text()).get("exerciseSets") or []):
            if s.get("setType") != "ACTIVE":
                continue
            ex = (s.get("exercises") or [{}])[0]
            w = (s.get("weight") or 0) / 1000
            reps = s.get("repetitionCount") or 0
            if not w or not reps:
                continue
            d = str(s.get("startTime"))[:10]
            for label, (kc, kn) in KEY_LIFTS.items():
                if ex.get("category") == kc and ex.get("name") == kn:
                    prog[label][d] = max(prog[label].get(d, 0), e1rm(w, reps))
    progression = {l: [{"date": d, "e1rm": v} for d, v in sorted(p.items())] for l, p in prog.items() if p}
    prs = []
    for lift, pts in progression.items():
        best = max(pts, key=lambda x: x["e1rm"])
        prs.append({"lift": lift, "e1rm": best["e1rm"], "date": best["date"],
                    "isRecent": (today_d - dt.date.fromisoformat(best["date"])).days <= 21})
    prs.sort(key=lambda x: (not x["isRecent"], -x["e1rm"]))

    # The window is a rolling 7 days, NOT the Monday-Sunday `week` (2026-11-08 audit, P2-3): on any day
    # but Sunday the two differ, and a recap that called this "the week" mixed two weeks. Say which.
    strength = {"progression": progression, "executedVolume": executed_volume,
                "executedVolumeWindow": {"from": wk_start.isoformat(), "to": today_d.isoformat(),
                                         "label": "last 7 days"},
                "tonnageTrend": tonnage_trend, "prs": prs}

    # ---- verdict ----
    verdict = list(flags)  # illness/debt warnings lead
    r = snapshot["readiness"]["score"]
    if r is not None:
        verdict.append(f"Readiness {r} — green light, push working sets toward failure." if r >= 80
                       else f"Readiness {r} — moderate; train but cap top-set intensity." if r >= 50
                       else f"Readiness {r} — low; prioritise recovery or technique work.")
    verdict.append(f"Form {'+' if form >= 0 else ''}{form} (fitness {fitness} − fatigue {fatigue}) — "
                   + ("fresh, room to add load." if form > 3 else "balanced." if form >= -8 else "fatigued, hold volume."))
    if body and body["daysSince"] is not None and body["daysSince"] > 14:
        verdict.append(f"No weigh-in for {body['daysSince']} days — can't track recomp without it. Step on the scale 2–3×/week.")
    else:
        sh = snapshot["sleep"]["hours"]
        if sh is not None:
            verdict.append(f"Slept {sh} h. Consistent 7.5 h+ is the lever for lean recomp at maintenance.")

    return {
        "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "window": {"start": start30.isoformat(), "end": end.isoformat()},
        "athlete": {"name": A.display, "goal": _PROFILE.get("goal"), "weightKg": _PROFILE.get("weight_kg")},
        "today": snapshot, "spark": spark, "body": body, "night": night,
        "trends": trends, "week": week, "workouts": workouts, "strength": strength, "verdict": verdict,
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", default=str(A.dashboard_path))
    p.add_argument("--end")
    a = p.parse_args()
    end = dt.date.fromisoformat(a.end) if a.end else dt.date.today()
    payload = build(end)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2) + "\n")
    t = payload["today"]
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
    print(f"  today={t['date']} recovery={t['readiness']['score']} | CTL {t['fitness']} ATL {t['fatigue']} TSB {t['form']}")
    print(f"  plan={t['plan']['name']} | body={payload['body']}")
    print(f"  executed sets: {[(v['muscle'], v['sets']) for v in payload['strength']['executedVolume'] if v['sets']]}")
    print(f"  PRs={[(p['lift'], p['e1rm'], p['isRecent']) for p in payload['strength']['prs']]}")


if __name__ == "__main__":
    main()
