#!/usr/bin/env python3
"""Validation gate for workout JSON — MANDATORY before any push.

Usage:
  python scripts/validate_workout.py athletes/<name>/workouts/<file>.json

Dispatches on the workout's sportTypeKey to the rules for each PROVEN payload format
(workouts/FORMAT.md): strength_training, swimming (pool) and cardio_training. A sport with no
proven format FAILS — an unproven payload is exactly what this gate exists to stop.

Every format: workoutName, segments whose sport matches the workout's, repeat groups with
iterations and children, known end conditions whose id agrees with their key (Garmin resolves by
id), positive values on every counted/timed/measured end condition, numeric weights, and any
category/exerciseName pair present must be in workouts/EXERCISE_CATALOG.json (unknown keys upload
fine but render "Unknown exercise" on the watch).

Per format:
  strength_training  at least one catalog exercise; work ends on reps or time.
  swimming           poolLength + unit; work ends on distance/time/lap.button; distances are
                     whole pool lengths; every work step carries a valid strokeType and
                     equipmentType ID (the Connect workout enum — ids, never names).
  cardio_training    work ends on time/distance/reps/lap.button.
  running            work ends on time/distance/lap.button; a target is no.target or a custom
                     heart-rate range in bpm (60 <= low < high <= 220). Format added 2026-10-11.

Every step: stepTypeId must agree with its stepTypeKey, and targetType id with its key — Garmin
reads the ids and re-resolves the names, so a wrong id comes back looking plausible.

Prints a per-step report; exits non-zero on ANY failure.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = REPO_ROOT / "workouts" / "EXERCISE_CATALOG.json"

# conditionTypeKey -> conditionTypeId. Garmin keys off the id, so a mismatched pair is a bug.
CONDITION_IDS = {"lap.button": 1, "time": 2, "distance": 3, "iterations": 7, "fixed.rest": 8, "reps": 10}
NEEDS_VALUE = {"time", "distance", "fixed.rest", "reps"}
REST_STEP_TYPES = {"rest", "recovery"}
REST_END = {"lap.button", "time", "fixed.rest"}

# Connect WORKOUT enum, not FIT's (FORMAT.md, "Pool swims"): kick 0, any 1 … mixed 8;
# equipment none 0 … snorkel 5.
SWIM_STROKE_IDS = range(0, 9)
SWIM_EQUIPMENT_IDS = range(0, 6)

WORK_END = {
    "strength_training": {"reps", "time"},
    "swimming": {"distance", "time", "lap.button"},
    "cardio_training": {"time", "distance", "reps", "lap.button"},
    "running": {"time", "distance", "lap.button"},
    "mobility": {"time", "lap.button"},
}

# stepTypeKey -> stepTypeId, as proven across the formats above (FORMAT.md). "main" is the swim
# work step; "recovery" is the running between-reps step.
STEP_TYPE_IDS = {"warmup": 1, "cooldown": 2, "interval": 3, "recovery": 4, "rest": 5,
                 "repeat": 6, "main": 8}

# workoutTargetTypeKey -> workoutTargetTypeId, and the sports each target is allowed on. Only
# targets this repo generates are listed: anything else fails until it is proven by a round trip.
TARGET_TYPE_IDS = {"no.target": 1, "heart.rate.zone": 4}
TARGET_SPORTS = {"heart.rate.zone": {"running"}}
HR_BPM = (60, 220)


def iter_steps(steps):
    """Yield leaf (executable) steps, recursing into repeat groups."""
    for step in steps or []:
        nested = step.get("workoutSteps")
        if nested:
            yield from iter_steps(nested)
        else:
            yield step


def iter_groups(steps):
    """Yield every repeat group, however deeply nested."""
    for step in steps or []:
        if step.get("type") == "RepeatGroupDTO" or (step.get("stepType") or {}).get("stepTypeKey") == "repeat":
            yield step
        yield from iter_groups(step.get("workoutSteps"))


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def target_error(step: dict, sport: str) -> str | None:
    """What is wrong with a step's target, or None. A missing targetType means no target."""
    t = step.get("targetType")
    if not t:
        return None
    key, tid = t.get("workoutTargetTypeKey"), t.get("workoutTargetTypeId")
    if key not in TARGET_TYPE_IDS:
        return f"targetType {key!r} has no proven format (expected one of {sorted(TARGET_TYPE_IDS)})"
    if tid is not None and tid != TARGET_TYPE_IDS[key]:
        return f"targetType {key!r} carries id {tid}, expected {TARGET_TYPE_IDS[key]}"
    if key == "no.target":
        return None
    if sport not in TARGET_SPORTS.get(key, set()):
        return f"targetType {key!r} is not proven on {sport}"
    lo, hi = step.get("targetValueOne"), step.get("targetValueTwo")
    if key == "heart.rate.zone":
        if step.get("zoneNumber") is not None:
            return "heart-rate target by zone number is unproven; give a bpm range"
        if not (_num(lo) and _num(hi) and HR_BPM[0] <= lo < hi <= HR_BPM[1]):
            return f"heart-rate range {lo!r}-{hi!r} must be bpm with {HR_BPM[0]} <= low < high <= {HR_BPM[1]}"
    return None


def validate(path: Path) -> tuple[bool, list[str]]:
    report: list[str] = []
    ok = True

    def fail(msg: str) -> None:
        nonlocal ok
        ok = False
        report.append(f"[FAIL] {msg}")

    if not CATALOG_PATH.exists():
        return False, [f"[FAIL] missing {CATALOG_PATH} — build the exercise catalog first (bootstrap step 6)"]
    catalog: dict[str, list[str]] = json.loads(CATALOG_PATH.read_text()).get("categories", {})

    try:
        wk = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        return False, [f"[FAIL] cannot read workout JSON: {e}"]

    if not wk.get("workoutName"):
        fail("workoutName missing")
    sport = (wk.get("sportType") or {}).get("sportTypeKey")
    if sport not in WORK_END:
        fail(f"sportTypeKey {sport!r} has no proven payload format (expected one of {sorted(WORK_END)})")
        return ok, report
    report.append(f"[OK]   sport: {sport}")

    pool = wk.get("poolLength")
    if sport == "swimming":
        if not _num(pool) or pool <= 0:
            fail(f"swimming: poolLength {pool!r} must be a positive number")
            pool = None
        if not (wk.get("poolLengthUnit") or {}).get("unitKey"):
            fail("swimming: poolLengthUnit missing")

    segments = wk.get("workoutSegments") or []
    if not segments:
        fail("no workoutSegments")

    n_work = n_exercises = 0
    for seg in segments:
        seg_sport = (seg.get("sportType") or {}).get("sportTypeKey")
        if seg_sport is not None and seg_sport != sport:
            fail(f"segment {seg.get('segmentOrder', '?')}: sportTypeKey {seg_sport!r} != workout's {sport!r}")

        for group in iter_groups(seg.get("workoutSteps")):
            glabel = f"repeat group {group.get('stepOrder', '?')}"
            n = group.get("numberOfIterations")
            if not _num(n) or n < 1 or n != int(n):
                fail(f"{glabel}: numberOfIterations {n!r} must be a whole number >= 1")
            if not group.get("workoutSteps"):
                fail(f"{glabel}: no child steps")
            gend = (group.get("endCondition") or {}).get("conditionTypeKey")
            if gend != "iterations":
                fail(f"{glabel}: endCondition {gend!r}, expected 'iterations'")

        for step in iter_steps(seg.get("workoutSteps")):
            stype = (step.get("stepType") or {}).get("stepTypeKey", "?")
            order = step.get("stepOrder", "?")
            label = f"step {order} ({stype})"

            stype_id = (step.get("stepType") or {}).get("stepTypeId")
            if stype not in STEP_TYPE_IDS:
                fail(f"{label}: unknown stepType {stype!r}")
                continue
            if stype_id is not None and stype_id != STEP_TYPE_IDS[stype]:
                fail(f"{label}: stepType {stype!r} carries id {stype_id}, expected {STEP_TYPE_IDS[stype]}")
                continue
            terr = target_error(step, sport)
            if terr:
                fail(f"{label}: {terr}")
                continue

            cond = step.get("endCondition") or {}
            end, end_id = cond.get("conditionTypeKey"), cond.get("conditionTypeId")
            value = step.get("endConditionValue")
            if end not in CONDITION_IDS or end == "iterations":
                fail(f"{label}: unknown endCondition {end!r}")
                continue
            if end_id is not None and end_id != CONDITION_IDS[end]:
                fail(f"{label}: endCondition {end!r} carries id {end_id}, expected {CONDITION_IDS[end]}")
            if end in NEEDS_VALUE and (not _num(value) or value <= 0):
                fail(f"{label}: endCondition {end} needs a positive endConditionValue, got {value!r}")
                continue

            if stype in REST_STEP_TYPES:
                if end not in REST_END:
                    fail(f"{label}: rest ends on {end!r} (expected one of {sorted(REST_END)})")
                continue

            n_work += 1
            if end not in WORK_END[sport]:
                fail(f"{label}: {sport} step ends on {end!r} (expected one of {sorted(WORK_END[sport])})")
                continue

            w = step.get("weightValue")
            if w is not None and (not _num(w) or w < 0):
                fail(f"{label}: bad weightValue {w!r}")
                continue

            cat = step.get("exerciseCategory") or step.get("category")
            name = step.get("exerciseName")
            if cat is not None or name is not None:
                if cat not in catalog:
                    fail(f"{label}: unknown category {cat!r}")
                    continue
                if name not in catalog[cat]:
                    fail(f"{label}: {cat}/{name} not in catalog — would show 'Unknown exercise' on watch")
                    continue
                n_exercises += 1

            if sport == "swimming":
                stroke = (step.get("strokeType") or {}).get("strokeTypeId")
                equip = (step.get("equipmentType") or {}).get("equipmentTypeId")
                if stroke not in SWIM_STROKE_IDS:
                    fail(f"{label}: strokeTypeId {stroke!r} not in the Connect workout enum 0-8")
                    continue
                if equip not in SWIM_EQUIPMENT_IDS:
                    fail(f"{label}: equipmentTypeId {equip!r} not in the Connect workout enum 0-5")
                    continue
                if end == "distance" and pool and (value / pool) != int(value / pool):
                    fail(f"{label}: {value} m is not a whole number of {pool} m lengths")
                    continue
                report.append(f"[OK]   {label}: {end} {value} stroke={stroke} equipment={equip}")
            elif sport == "running":
                t = step.get("targetType") or {}
                tgt = t.get("workoutTargetTypeKey") or "no.target"
                rng = "" if tgt == "no.target" else f" {step.get('targetValueOne'):g}-{step.get('targetValueTwo'):g}"
                report.append(f"[OK]   {label}: {end} {value} target={tgt}{rng}")
            elif cat is None and name is None:
                report.append(f"[WARN] {label}: no exercise key (renders as generic step)")
            else:
                report.append(f"[OK]   {label}: {cat}/{name} {end} {value} weight={w}")

    if n_work == 0:
        fail("no work steps found")
    if sport == "strength_training" and n_exercises == 0:
        fail("no exercise steps found")
    return ok, report


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("file", type=Path)
    args = p.parse_args()
    ok, report = validate(args.file)
    print(f"== validation: {args.file} ==")
    for line in report:
        print(line)
    print("== PASS ==" if ok else "== FAIL — DO NOT PUSH ==")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
