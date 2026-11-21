#!/usr/bin/env python3
"""Generate the bound athlete's Garmin strength-workout JSONs from their program.

THE ENGINE. The program itself lives in athletes/<name>/program.py and the output lands in
athletes/<name>/workouts/ — this file holds no athlete's data. It was split out on 2026-09-24,
when OpenSportCoach became multi-athlete, and the regenerated JSON was verified byte-identical.
The program's names are re-exported below, so `build_workouts.PROGRAM` still means "the current
athlete's program" to every script and test that reads it.

The athlete's CURRENT_ROUTINE.md stays the human-readable mirror — change both together. Format:
proven 2026-06-12 via the round-trip test (workouts/FORMAT.md).

Every (category, exerciseName) pair is verified against the FIT SDK taxonomy at build time; the
build aborts on any unknown key. Run, then validate each file with validate_workout.py before any
push.

Usage:  python scripts/build_workouts.py     (the athlete comes from the session, or --athlete)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

A = athlete.current()
OUT = A.workouts_dir

SPORT = {"sportTypeId": 5, "sportTypeKey": "strength_training", "displayOrder": 9}
STEP_WARMUP = {"stepTypeId": 1, "stepTypeKey": "warmup", "displayOrder": 1}
STEP_INTERVAL = {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3}
STEP_REST = {"stepTypeId": 5, "stepTypeKey": "rest", "displayOrder": 5}
STEP_REPEAT = {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6}
COND_REPS = {"conditionTypeId": 10, "conditionTypeKey": "reps", "displayOrder": 10, "displayable": True}
COND_TIME = {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": True}
COND_LAP = {"conditionTypeId": 1, "conditionTypeKey": "lap.button", "displayOrder": 1, "displayable": True}
COND_ITER = {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": False}
COND_FIXED_REST = {"conditionTypeId": 8, "conditionTypeKey": "fixed.rest", "displayOrder": 8, "displayable": True}
NO_TARGET = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}
KG = {"unitId": 8, "unitKey": "kilogram", "factor": 1000.0}

# --- the athlete's program ------------------------------------------------------------------
# Tuple format — (id, routine name, category, exerciseName, sets, value, weight_kg|None, rest_s,
# kind) — is documented at the top of every program.py. Everything but PROGRAM is optional and
# falls back to the defaults here, so a new athlete's program.py only has to define PROGRAM.
_P = A.program
PROGRAM: dict[str, dict] = _P.PROGRAM
VARIANTS: list = getattr(_P, "VARIANTS", [])
STEP_NOTES: dict[str, str] = getattr(_P, "STEP_NOTES", {})
WARMUPS: dict[str, list] = getattr(_P, "WARMUPS", {})
# Timed warm-ups per exercise id: list of (category, exerciseName, seconds). A warmup step that
# ends on TIME — the watch shows "5:00" — then a lap-button rest. For warm-ups that are not a
# lighter set of the lift itself (a jog before sprints), which WARMUPS' (kg, reps) cannot say.
TIMED_WARMUPS: dict[str, list] = getattr(_P, "TIMED_WARMUPS", {})
LEAD: dict[str, dict] = getattr(_P, "LEAD", {})
FIXED_INCREMENT: dict[str, float] = getattr(_P, "FIXED_INCREMENT", {})
SPLIT_SEED: dict[str, str] = getattr(_P, "SPLIT_SEED", {})
SPLIT_LOAD_ALLOWED: set = getattr(_P, "SPLIT_LOAD_ALLOWED", set())
SET_REST_SECS: int = getattr(_P, "SET_REST_SECS", 90)
# Per-exercise override of the between-series countdown, keyed by exercise id. For work whose
# rest IS the point of the prescription — a 30 s on / 30 s off finisher — where the strength
# rest would turn intervals into singles. Everything not listed keeps SET_REST_SECS.
SET_REST_BY_ID: dict[str, int] = getattr(_P, "SET_REST_BY_ID", {})
CORE_REST_SECS: int = getattr(_P, "CORE_REST_SECS", 45)
SIDE_LABELS: tuple = getattr(_P, "SIDE_LABELS", ("Right side", "Left side"))
# The step text the engine writes itself, so an athlete can have it in their own language
# (e.g. Spanish, 2026-10-04). An athlete's TEXT overrides any of these keys; the defaults are
# the exact strings every build used before, so an athlete without TEXT builds byte-identical.
TEXT: dict[str, str] = {
    "range": "Range {lo}-{hi} · all sets at {hi} -> +weight",
    "fixed": "Single-target {sets}x{value} · all clean -> +{step}kg",
    "next_exercise": "Push for the next exercise",
    **getattr(_P, "TEXT", {}),
}


def build_variant(spec: dict) -> tuple[str, dict]:
    """Derive a variant day from its base in PROGRAM. Never edit variant JSON by hand."""
    base = PROGRAM[spec["base"]]
    swap = spec.get("swap", {})
    exercises = []
    for e in base["exercises"]:
        if e[0] in spec.get("drop", set()):
            continue
        if e[0] in swap:
            src_day, src_id = swap[e[0]]
            src = next(x for x in PROGRAM[src_day]["exercises"] if x[0] == src_id)
            # Take the SOURCE's id too, not just its movement. WARMUPS is keyed by
            # exercise id, so reusing the slot id would fire the replaced lift's ramp on
            # the substitute — a front-squat 40x10 + 60x6 warm-up on a leg extension.
            exercises.append(src)
            continue
        exercises.append(e)
    if "keep" in spec:
        exercises = exercises[: spec["keep"]]
    sets = sum(e[4] for e in exercises)
    day = {
        "name": spec["name"],
        "desc": f"{spec['why']} Derived from {spec['base']} — {len(exercises)} exercises, {sets} sets.",
        "exercises": exercises,
    }
    return spec["key"], day


def verify_against_fit() -> None:
    """Abort the build if any (category, exerciseName) pair is not in the FIT taxonomy."""
    from garmin_fit_sdk import Profile

    types = Profile["types"]
    cats = {str(v).upper() for v in types["exercise_category"].values()}
    bad = []
    for day in PROGRAM.values():
        for ex in day["exercises"]:
            _, _, cat, name, *_ = ex
            enum = f"{cat.lower()}_exercise_name"
            names = {str(v).upper() for v in types.get(enum, {}).values()}
            if cat not in cats or name not in names:
                bad.append(f"{ex[0]} {cat}/{name}")
    if bad:
        sys.exit("FIT verification FAILED: " + ", ".join(bad))


def exercise_group(order: int, child_id: int, ex, set_rest_s: int = SET_REST_SECS) -> tuple[list, int]:
    """One exercise = a repeat group + a trailing lap-button rest.

    REST SCHEME (2026-08-01): inside the group, rests BETWEEN SERIES are a
    1:40 countdown (`fixed.rest`) — he is already on the equipment, so a timer keeps
    the session moving. `skipLastRestStep` is therefore True: the final set does NOT
    get a countdown. Instead a standalone lap-button rest follows the group, so the
    move to the NEXT EXERCISE still waits for him to press lap (a busy machine must
    never auto-start the next lift — his original 2026-06-16 rule, preserved).
    """
    _, _, cat, name, sets, value, weight, rest, kind = ex
    per_side = kind.endswith("_per_side")
    base_kind = kind[:-len("_per_side")] if per_side else kind

    # 2026-09-16 BUG FIX. The weight, the range note and STEP_NOTES used to be applied to a
    # single `work` dict AFTER it was built — but the per-side branch below builds its steps
    # from FRESH _work() calls, which never saw any of it. So a per-side exercise reached the
    # watch with NO PRESCRIBED WEIGHT. It stayed invisible while the only per-side movement was
    # a bodyweight side plank; the moment WEIGHTED_SIDE_PLANK was added on 09-15 its 10 kg
    # silently vanished and he picked 8 kg himself with the watch telling him nothing.
    # Everything now lives inside _work(), so every emitted step carries it.
    def _work(step_order: int, side: str | None = None) -> dict:
        w = {
            "type": "ExecutableStepDTO", "stepId": None, "stepOrder": step_order,
            "childStepId": child_id, "stepType": STEP_INTERVAL,
            "endCondition": COND_TIME if base_kind == "time" else COND_REPS,
            "endConditionValue": value, "targetType": NO_TARGET,
            "category": cat, "exerciseName": name,
        }
        parts: list[str] = []
        # "power" (2026-10-11): explosive reps — jumps, throws — counted like reps but never
        # progressed by load, so no range note and no bump. Quality is the target, not the top.
        if base_kind == "reps":
            parts.append(TEXT["range"].format(lo=value - 2, hi=value))
        note = STEP_NOTES.get(ex[0])
        if note:
            parts.insert(0, note)
        elif base_kind == "fixed":
            step_kg = FIXED_INCREMENT.get(ex[0], 2.5)
            parts.append(TEXT["fixed"].format(sets=sets, value=value, step=f"{step_kg:g}"))
        if side:
            parts.insert(0, side)
        if parts:
            w["description"] = " · ".join(parts)
        if weight is not None:
            w["weightValue"] = float(weight)
            w["weightUnit"] = KG
        return w

    work: dict = _work(order + 1)
    kind = base_kind
    set_rest = {
        "type": "ExecutableStepDTO", "stepId": None, "stepOrder": order + 2,
        "childStepId": child_id, "stepType": STEP_REST,
        "endCondition": COND_FIXED_REST, "endConditionValue": float(set_rest_s),
        "targetType": NO_TARGET,
    }
    group = {
        "type": "RepeatGroupDTO", "stepId": None, "stepOrder": order,
        "stepType": STEP_REPEAT, "childStepId": child_id,
        "numberOfIterations": sets, "smartRepeat": False,
        # True here is NOT the old "no rest before the next exercise" bug: the
        # lap-button rest below replaces it, so a rest is still guaranteed.
        "skipLastRestStep": True,
        "endCondition": COND_ITER,
        # PER-SIDE EXERCISES LIVE IN ONE GROUP, NOT TWO (his bug report, 2026-09-01).
        # Two separate blocks gave "(hold - rest) x2" twice, which lets him do all of one
        # side, rest, and only then start the other. One group holding BOTH sides plus a
        # single rest gives "(right - left - rest) x2": the sides stay paired, and the rest
        # lands where it belongs, after both.
        "workoutSteps": ([_work(order + 1, SIDE_LABELS[0]),
                          _work(order + 2, SIDE_LABELS[1]),
                          {**set_rest, "stepOrder": order + 3}]
                         if per_side else [work, set_rest]),
    }
    exercise_rest = {
        "type": "ExecutableStepDTO", "stepId": None, "stepOrder": order + 3,
        "childStepId": None, "stepType": STEP_REST,
        "endCondition": COND_LAP, "targetType": NO_TARGET,
        "description": TEXT["next_exercise"],
    }
    return [group, exercise_rest], order + 4


def lead_block(order: int, spec: dict):
    """The core block, as real prescribed exercises rather than one freeform timer."""
    steps = []
    # child_id 90+ keeps the core block's repeat ids clear of the day's own 1..n.
    for n, ex in enumerate(spec["block"], start=90):
        group, order = exercise_group(order, n, ex, CORE_REST_SECS)
        steps.extend(group)
    return steps, order


def warmup_steps(order: int, cat: str, name: str, weight: float, reps: int, rest_s: int = 90):
    work = {
        "type": "ExecutableStepDTO", "stepId": None, "stepOrder": order, "childStepId": None,
        "stepType": STEP_WARMUP, "endCondition": COND_REPS, "endConditionValue": reps,
        "targetType": NO_TARGET, "category": cat, "exerciseName": name,
        "weightValue": float(weight), "weightUnit": KG,
    }
    rest = {
        "type": "ExecutableStepDTO", "stepId": None, "stepOrder": order + 1, "childStepId": None,
        "stepType": STEP_REST, "endCondition": COND_LAP, "targetType": NO_TARGET,
    }
    return [work, rest], order + 2


def timed_warmup_steps(order: int, cat: str, name: str, seconds: int):
    work = {
        "type": "ExecutableStepDTO", "stepId": None, "stepOrder": order, "childStepId": None,
        "stepType": STEP_WARMUP, "endCondition": COND_TIME, "endConditionValue": seconds,
        "targetType": NO_TARGET, "category": cat, "exerciseName": name,
    }
    rest = {
        "type": "ExecutableStepDTO", "stepId": None, "stepOrder": order + 1, "childStepId": None,
        "stepType": STEP_REST, "endCondition": COND_LAP, "targetType": NO_TARGET,
    }
    return [work, rest], order + 2


def build_day(key: str, day: dict) -> dict:
    steps, order = [], 1
    if key in LEAD:
        lead, order = lead_block(order, LEAD[key])
        steps.extend(lead)
    for i, ex in enumerate(day["exercises"], start=1):
        exid, _, cat, name, *_ = ex
        for wcat, wname, wsecs in TIMED_WARMUPS.get(exid, []):
            wsteps, order = timed_warmup_steps(order, wcat, wname, wsecs)
            steps.extend(wsteps)
        for ww, wr in WARMUPS.get(exid, []):
            wsteps, order = warmup_steps(order, cat, name, ww, wr)
            steps.extend(wsteps)
        group, order = exercise_group(order, i, ex, SET_REST_BY_ID.get(exid, SET_REST_SECS))
        steps.extend(group)
    est = sum(s * (45 + r) for _, _, _, _, s, _, _, r, _ in day["exercises"])
    if key in LEAD:
        est += LEAD[key]["minutes"] * 60
    return {
        "workoutName": day["name"], "description": day["desc"],
        "sportType": SPORT, "subSportType": None,
        "estimatedDurationInSecs": est,
        "workoutSegments": [{"segmentOrder": 1, "sportType": SPORT, "workoutSteps": steps}],
    }


# ---------------------------------------------------------------------------
# PRESCRIPTION HISTORY
# ---------------------------------------------------------------------------
# Records, per exercise, the current asked load and the DATE it was set. Written on
# every build. prescription_audit.py needs this to tell a bump applied this morning
# (above his best by construction, and fine) from an ask that has survived several
# sessions without ever being met (a real problem).
#
# The 2026-08-30 audit found the audit itself firing 9 warnings a day of which 6 were
# fresh bumps — which is why the genuinely stale cable-overhead-triceps ask survived
# nine days after being flagged. A permanently-on alarm is not an alarm.
HISTORY_PATH = OUT / "PRESCRIPTION_HISTORY.json"


# 2026-09-21 AUDIT FIX. This file used to be keyed by f"{cat}/{name}" — one entry per catalog
# pair. That silently assumed no exercise is ever prescribed twice, which stopped being true on
# 2026-09-16 when BARBELL_BENCH_PRESS became D1E1 (heavy, 4x10 @80) AND D4E2 (volume, 4x12 @70),
# a split declared intentional in the athlete's program.py::SPLIT_LOAD_ALLOWED.
#
# The consequence was not cosmetic. Iterating PROGRAM, D1's 80 was written and then OVERWRITTEN by
# D4's 70 on every build, each overwrite logging a fabricated "change" — so PROGRESSION_LOG.md read
# as though the load flip-flopped 70->80->70 several times a day, and `since` was reset to the build
# date every time. prescription_audit.py therefore reported BOTH asks as "FRESH - not tried yet"
# forever: D1E1's 80 kg has been live since 2026-09-06 and its true staleness was unknowable.
# STALE detection, the instrument the 08-30 audit was built to repair, was defeated for both.
#
# Keyed by f"{day}/{exid}" now, which is unique by construction. SPLIT_SEED — the real
# dates for pairs that were split — is the athlete's, and lives in their program.py.


def prescriptions(prog: dict | None = None, lead: dict | None = None):
    """Every prescription in the program: (day_key, exercise_row). The CORE BLOCK first, because it
    is what opens each day (build_day), then the main lifts.

    WHY THIS EXISTS (2026-11-01). Five readers of the program all iterated
    `PROGRAM[day]["exercises"]` alone: `update_prescription_history()` below,
    `prescription_audit.audit()`, `progression_report.bump_rows()`,
    `strength_sessions.pair_days()` and `tests/run_tests.py`'s history-coverage test. The core block
    lives in `LEAD`, so NONE of them could see it. The cost was real and it ran for three weeks:
    An athlete's own core-progression rule (v8.4, from "core is getting very simple and each day is
    the same") had been met on seven slots and not one ask had ever moved, because no instrument
    could report it — PRESCRIPTION_HISTORY.json held 36 keys and not a single core id. Every daily
    marked core "met" and the rule never got a signal. One definition now, five consumers.

    The key stays `f"{day}/{exid}"`, and here that is load-bearing rather than cosmetic: **the same
    core id means a different exercise in a different block.** `C1` is the kneeling ab wheel in
    CORE_ANTI_EXTENSION and the weighted side plank in CORE_ANTI_ROTATION and CORE_LOADED.

    Anchored on PROGRAM's days, so every consumer keeps iterating the same set of days and a day
    with no core block simply yields its main lifts. The third element is "core" or "main": a
    consumer that treats the two differently (bump_rows' increments) must be TOLD which it has,
    never guess from the id prefix — guessing from an identifier is the defect this fix exists for.
    """
    prog = PROGRAM if prog is None else prog
    lead = LEAD if lead is None else lead
    for day_key, day in prog.items():
        for ex in ((lead.get(day_key) or {}).get("block") or ()):
            yield day_key, ex, "core"
        for ex in day["exercises"]:
            yield day_key, ex, "main"


def next_history_entry(prev: dict | None, day: str, ex: tuple, today: str, now: str) -> dict:
    """One prescription's PRESCRIPTION_HISTORY entry after this build.

    `since` / `since_ts` move only when the ask changes. Two 2026-10-04 audit fixes:
      * `since_ts` is the build TIMESTAMP. The audit counts sessions that started after it, so
        the session that triggered a bump is no longer counted as the first attempt at it.
      * A different exercise under the same id is a NEW prescription (P2-2). Comparing only
        weight and reps, the 09-29 EZ french press -> rope pressdown swap inherited the old
        lift's history and logged "30 -> 30"; preacher 47.5 -> 30 read as a cut across a machine
        change. A swap starts clean: no inherited `since`, no `changes` that belonged to another lift.
    """
    eid, _es, cat, name, sets, reps, w, _rest, _kind = ex
    if prev is not None and (prev.get("cat"), prev.get("name")) not in ((cat, name), (None, None)):
        prev = None
    base = {"cat": cat, "name": name, "day": day, "id": eid, "sets": sets}
    if prev is not None and prev.get("weight") == w and prev.get("reps") == reps:
        return {**prev, **base}
    changes = (prev or {}).get("changes", [])
    if prev is not None:
        changes = changes + [{"date": today, "from": prev.get("weight"), "to": w, "reps": reps}]
    return {**base, "weight": w, "reps": reps, "since": today, "since_ts": now, "changes": changes}


def update_prescription_history(today: str | None = None) -> dict:
    import datetime
    from collections import Counter
    now = datetime.datetime.now()
    today = today or now.date().isoformat()
    raw = {}
    if HISTORY_PATH.exists():
        raw = json.loads(HISTORY_PATH.read_text())
    raw.pop("_meta", None)

    # How many prescriptions share each catalog pair? Only the unique ones may inherit the old
    # pair-keyed record; a shared pair's record cannot be attributed to either of them. Counted over
    # prescriptions(), core block included — a core pair is prescribed on two or three days, so
    # counting PROGRAM alone could have called one of them unique and migrated a record to it.
    pair_uses = Counter(f"{ex[2]}/{ex[3]}" for _, ex, _ in prescriptions())

    hist: dict[str, dict] = {}
    for day, ex, _block in prescriptions():
        eid, _es, cat, name, _sets, reps, w, _rest, _kind = ex
        key = f"{day}/{eid}"
        prev = raw.get(key)
        if prev is None:
            legacy = f"{cat}/{name}"
            if key in SPLIT_SEED:
                prev = {"weight": w, "reps": reps, "since": SPLIT_SEED[key], "changes": []}
            elif pair_uses[legacy] == 1 and legacy in raw:
                prev = raw[legacy]          # unambiguous: migrate it intact
        hist[key] = next_history_entry(prev, day, ex, today, f"{today} {now:%H:%M:%S}")
    out = {"_meta": {
        "purpose": "Current asked load per PRESCRIPTION and the date it was set. Written by "
                   "build_workouts.py on every build; consumed by prescription_audit.py to "
                   "separate FRESH bumps from STALE asks.",
        "key": "day/exerciseId — NOT category/exerciseName. One catalog pair can be prescribed "
               "on two days at two loads (SPLIT_LOAD_ALLOWED); pair-keying made them overwrite "
               "each other every build and reported both as FRESH forever. Fixed 2026-09-21.",
        "rule": "An entry's `since` only moves when weight or reps change, or when a different "
                "exercise takes the id (a swap starts clean). `since_ts` is the build time: "
                "sessions that started before it are not attempts at this ask. Entries set "
                "before 2026-10-04 have no `since_ts`; the audit reads the end of `since`.",
    }}
    out.update(dict(sorted(hist.items())))
    HISTORY_PATH.write_text(json.dumps(out, indent=1) + "\n")
    return hist


def main() -> None:
    update_prescription_history()
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--variants", action="store_true",
                    help="also emit the derived situational variants (no-deadlift, short)")
    args = ap.parse_args()

    verify_against_fit()
    for key, day in PROGRAM.items():
        path = OUT / f"{key}.json"
        path.write_text(json.dumps(build_day(key, day), indent=2) + "\n")
        n = len(day["exercises"])
        sets = sum(e[4] for e in day["exercises"])
        print(f"{path.name}: {n} exercises, {sets} working sets -> OK")
    print("FIT verification passed for all pairs.")

    # The athlete's swims, runs, circuits and mobility (athlete.json → sessions, scripts/workout_dsl.py).
    import build_sessions
    build_sessions.build()

    if args.variants:
        print()
        for spec in VARIANTS:
            key, day = build_variant(spec)
            # LEAD is keyed by canonical day; a variant inherits its base's abs block.
            LEAD.setdefault(key, LEAD[spec["base"]])
            path = OUT / f"{key}.json"
            path.write_text(json.dumps(build_day(key, day), indent=2) + "\n")
            sets = sum(e[4] for e in day["exercises"])
            print(f"{path.name}: {len(day['exercises'])} exercises, {sets} sets "
                  f"(from {spec['base']}) -> OK")


if __name__ == "__main__":
    main()
