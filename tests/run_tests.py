#!/usr/bin/env python3
"""Test suite for the coaching maths. Run: .venv/bin/python tests/run_tests.py

WHY THIS EXISTS. The 2026-08-14 audit found four defects in code that decides what
the athlete lifts, and every one of them would have been caught by a handful of
assertions:

  * dips were filed under TRICEPS_EXTENSION and never counted toward chest — 51 sets
    missing from the exact metric that justified the v6 redesign;
  * 150 sets in Garmin's "UNKNOWN" category were discarded with no warning;
  * prescribed warm-ups were counted as working sets;
  * the prescription auditor divided BOTH sides of a per-arm/summed comparison,
    checking every two-dumbbell lift at half its real load.

No pytest in the venv, so this is a dependency-free runner: plain asserts, plain
functions named test_*. Exit code 1 on any failure, so it can gate a commit.

MULTI-ATHLETE (2026-09-24). This file holds the ENGINE invariants — true for every athlete —
and the runner. Each athlete's own constraints (an injury's banned lifts, a core allowlist, logging
conventions) live in athletes/<name>/tests.py. The suite runs once per athlete in a child
process, so an engine change is checked against every athlete's program, every time.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))
import athlete  # noqa: E402

CHILD = os.environ.get("OSC_TEST_CHILD") == "1"
if CHILD:
    # One athlete per child process: every module below resolves THAT athlete at import.
    from harness import (A, CATALOG, RULES, _hold, _load, _set, audit, b_core, bw,  # noqa: E402,F401
                         export, frontmatter, scratch_athletes)


# --------------------------------------------------------------------------- #
# muscle attribution — the P0-1 bug
# --------------------------------------------------------------------------- #

def test_dips_count_as_chest():
    """Garmin files every dip variant under TRICEPS_EXTENSION. In this program the
    dip IS the chest slot (D1E6), so it must attribute to Chest, not Triceps."""
    for name in ("BENCH_DIP", "BODY_WEIGHT_DIP", "WEIGHTED_DIP"):
        got = export.muscle_of("TRICEPS_EXTENSION", name)
        assert got == "Chest", f"{name} attributed to {got}, expected Chest"
    assert export.muscle_of("SUSPENSION", "DIP") == "Chest"


def test_face_pull_is_delts_not_back():
    """Categorised ROW, prescribed as rear-delt work (D4E6)."""
    assert export.muscle_of("ROW", "FACE_PULL") == "Delts"
    # the category fallback must still send real rows to Back
    assert export.muscle_of("ROW", "SEATED_CABLE_ROW") == "Back"


def test_reverse_flyes_are_delts_not_chest():
    """Categorised FLYE, whose fallback is Chest, but a reverse fly trains the rear delts."""
    for name in ("FACE_DOWN_INCLINE_REVERSE_FLYE", "INCLINE_REVERSE_FLYE",
                 "SINGLE_ARM_STANDING_CABLE_REVERSE_FLYE"):
        got = export.muscle_of("FLYE", name)
        assert got == "Delts", f"{name} attributed to {got}, expected Delts"
    # the category fallback must still send real flyes to Chest
    assert export.muscle_of("FLYE", "DUMBBELL_FLYE") == "Chest"


def test_leg_extensions_are_quads_not_core():
    """Garmin genuinely files machine leg extensions under CRUNCH."""
    assert export.muscle_of("CRUNCH", "LEG_EXTENSIONS") == "Quads"
    assert export.muscle_of("CRUNCH", "WEIGHTED_LEG_EXTENSIONS") == "Quads"
    # a real crunch still counts as core
    assert export.muscle_of("CRUNCH", "CRUNCH") == "Core"


def test_nothing_is_ever_silently_dropped():
    """Unrecognised categories must land in the visible Unattributed bucket.
    Previously they vanished — 9% of all logged sets."""
    assert export.muscle_of("UNKNOWN", None) == export.UNATTRIBUTED
    assert export.muscle_of("SOME_FUTURE_CATEGORY", "WHATEVER") == export.UNATTRIBUTED
    assert export.muscle_of(None, None) == export.UNATTRIBUTED


def test_every_programmed_exercise_resolves_to_a_real_muscle():
    """No lift the program prescribes may fall through to Unattributed."""
    for day_key, day in bw.PROGRAM.items():
        for ex in day["exercises"]:
            exid, _, cat, name, *_ = ex
            got = export.muscle_of(cat, name)
            assert got != export.UNATTRIBUTED, f"{day_key}/{exid} {cat}/{name} is unattributed"


# --------------------------------------------------------------------------- #
# warm-up exclusion — the P0-3 bug
# --------------------------------------------------------------------------- #





def test_no_warmup_entry_outlives_its_exercise():
    """WARMUPS is keyed by exercise id. A ramp left behind after its lift is removed will
    fire on whatever inherits that slot — a front-squat 40x10 on a leg extension."""
    ids = {e[0] for day in bw.PROGRAM.values() for e in day["exercises"]}
    orphans = (set(bw.WARMUPS) | set(bw.TIMED_WARMUPS)) - ids
    assert not orphans, f"WARMUPS/TIMED_WARMUPS have entries for exercises no longer in PROGRAM: {orphans}"




# 2026-09-07: prescription_audit.py scanned every activity_*_sets.json, so the Hyrox
# lunge station — same catalog key as D3E9, a completely different prescription — was
# counted as an attempt at the gym lift. One genuine miss was inflated from "watch" to
# STALE, which BLOCKS PUSHES. Only strength_training sessions carry prescriptions.
def test_audit_counts_only_strength_sessions():
    import glob, json as _json
    strength, known = audit.strength_activity_ids()
    kept = set(audit.strength_set_files())

    # every file the auditor keeps must belong to a confirmed strength activity
    for path in kept:
        aid = _json.loads(Path(path).read_text()).get("activityId")
        assert aid in strength, f"{path} kept but activity {aid} is not strength_training"

    # and any set file belonging to a KNOWN non-strength activity must be excluded —
    # this is the Hyrox case that caused the bug
    for path in glob.glob(str(A.data_dir / "activity_*_sets.json")):
        aid = _json.loads(Path(path).read_text()).get("activityId")
        if aid in known and aid not in strength:
            assert path not in kept, (
                f"{path} is activity {aid}, which is in the cache but NOT strength_training "
                "— its sets must not be audited against gym prescriptions")


# 2026-09-16: the weight and the range note were applied to a single `work` dict AFTER it was
# built, but the per-side branch of exercise_group() constructs its steps from fresh _work()
# calls that never saw any of it. A per-side exercise therefore reached the watch with NO
# PRESCRIBED WEIGHT. Invisible while the only per-side movement was a bodyweight side plank —
# then WEIGHTED_SIDE_PLANK was added and its load silently vanished, and he picked a weight
# himself with the watch showing him nothing.
def test_per_side_exercises_carry_their_prescribed_weight():
    for day_key, spec in bw.LEAD.items():
        for ex in list(spec["block"]) + list(bw.PROGRAM.get(day_key, {}).get("exercises", [])):
            exid, _, cat, name, sets, value, weight, rest, kind = ex
            if not kind.endswith("_per_side") or weight is None:
                continue
            group, _ = bw.exercise_group(0, 90, ex)
            steps = [s for s in group[0]["workoutSteps"]
                     if s.get("stepType") == bw.STEP_INTERVAL]
            assert steps, f"{day_key}/{exid} produced no working steps"
            for s in steps:
                assert s.get("weightValue") == float(weight), (
                    f"{day_key}/{exid} {cat}/{name} is per-side and prescribes {weight}kg, but a "
                    f"working step reached the watch with weightValue={s.get('weightValue')!r} — "
                    "he cannot follow a load the watch never shows him")


def test_exercises_without_warmups_are_untouched():
    sets = [_set("CURL", "DUMBBELL_BICEPS_CURL", 20, 12) for _ in range(4)]
    assert len(export.strip_warmups(sets)) == 4


def test_strip_warmups_handles_empty_and_unnamed():
    assert export.strip_warmups([]) == []
    weird = [{"setType": "ACTIVE", "weight": None, "repetitionCount": None, "exercises": []}]
    assert len(export.strip_warmups(weird)) == 1


# --------------------------------------------------------------------------- #
# units: per-arm vs summed — the P0-4 bug
# --------------------------------------------------------------------------- #

def _two_db_loads():
    """(day, id, name, kg) for every weighted two-dumbbell prescription."""
    two_db = {tuple(x) for x in RULES["two_db_weight_summed"]}
    return [(day_key, ex[0], ex[3], ex[6]) for day_key, day in bw.PROGRAM.items()
            for ex in day["exercises"] if (ex[2], ex[3]) in two_db and ex[6] is not None]


def _dumbbell_cap():
    """The athlete's heaviest dumbbell (athlete.json -> profile.dumbbell_cap_kg). Required as
    soon as the program prescribes two-dumbbell loads: without it the per-arm convention cannot
    be checked, and an unchecked convention is how the wrong dumbbells get loaded."""
    cap = A.profile.get("dumbbell_cap_kg")
    assert cap or not _two_db_loads(), (
        f"{A.display}'s program prescribes two-dumbbell loads but athlete.json has no "
        "profile.dumbbell_cap_kg — ask for the gym's heaviest dumbbell and record it")
    return cap


def test_program_stores_two_db_loads_per_arm():
    """Every two-dumbbell lift in PROGRAM must be per-arm, matching CURRENT_ROUTINE's
    'kg c/u'. A summed entry here is how someone loads the wrong dumbbells — D4E2 was
    stored as 60 (summed) until v6.2 while its neighbours were per-arm."""
    cap = _dumbbell_cap()
    for day_key, exid, name, weight in _two_db_loads():
        assert weight <= cap, (
            f"{day_key}/{exid} {name} = {weight}kg exceeds the {cap}kg dumbbell cap "
            f"— almost certainly stored summed instead of per-arm")


def test_audit_does_not_halve_the_prescription():
    """The auditor must compare a per-arm prescription against per-arm executed data.
    Halving both made Arnold read as 12/arm against a 24/arm prescription."""
    src = (ROOT / "scripts" / "prescription_audit.py").read_text()
    assert "per_side = weight / 2 if key in TWO_DB else weight" not in src, \
        "prescription_audit is halving the PROGRAM weight again (P0-4 regression)"


# --------------------------------------------------------------------------- #
# e1RM and the ceiling check
# --------------------------------------------------------------------------- #

def test_epley_matches_the_deadlift_finding():
    """The arithmetic that caught the impossible prescription: 8x100 implies 126.7,
    above his 120 best; the 3x5 replacement implies 116.7, below it."""
    assert round(audit.epley(100, 8), 1) == 126.7
    assert round(audit.epley(100, 5), 1) == 116.7
    assert round(audit.epley(100, 6), 1) == 120.0


def test_one_e1rm_formula():
    """The e1RM is written once, in formulas.py. It lived in three scripts until 2026-10-08, and the
    app's design labelled it with a fourth formula (load × reps^0.10): two formulas for one number
    both look plausible. Scans the engine, every athlete's scripts and the app's own code (not
    the design handoff, which is the unchanged spec of record)."""
    import re
    formula = re.compile(r"min\(\s*[\w.\[\]\"']+\s*,\s*(?:12|E1RM_REP_CAP)\s*\)\s*/\s*30"  # Epley
                         r"|\*\*\s*0?\.10?\b|Math\.pow\([^)]*,\s*0?\.10?\s*\)"           # Lombardi
                         r"|36\s*/\s*\(\s*37")                                             # Brzycki
    files = list((ROOT / "scripts").rglob("*.py")) + list(athlete.ATHLETES_DIR.glob("*/*.py"))
    files += [p for ext in ("ts", "tsx", "js", "jsx") for p in (ROOT / "app").rglob(f"*.{ext}")
              if "node_modules" not in p.parts and "design" not in p.parts and "dist" not in p.parts]
    copies = [str(p.relative_to(ROOT)) for p in files
              if p.name != "formulas.py" and formula.search(p.read_text())]
    assert not copies, f"an e1RM formula outside scripts/formulas.py: {copies}"
    import formulas
    assert round(formulas.e1rm(82.5, 6), 1) == 99.0
    assert "Epley" in formulas.E1RM_DEFINITION and "12" in formulas.E1RM_DEFINITION


def test_epley_caps_reps_at_twelve():
    """The formula degrades badly past ~12 reps, so high-rep sets must not inflate e1RM."""
    assert audit.epley(50, 20) == audit.epley(50, 12)
    assert audit.epley(50, 13) == audit.epley(50, 12)




# --------------------------------------------------------------------------- #
# program / catalog integrity
# --------------------------------------------------------------------------- #

def test_every_programmed_pair_is_in_the_catalog():
    """The validation gate rejects unknown keys at push time; catch it at build time."""
    for day_key, day in bw.PROGRAM.items():
        for ex in day["exercises"]:
            exid, _, cat, name, *_ = ex
            assert name in CATALOG.get(cat, []), f"{day_key}/{exid} {cat}/{name} missing from EXERCISE_CATALOG"


def test_no_dumbbell_exceeds_the_gym_cap():
    """The gym's heaviest dumbbell is a hard constraint — profile.dumbbell_cap_kg in athlete.json."""
    cap = _dumbbell_cap()
    for day_key, exid, _name, weight in _two_db_loads():
        assert weight <= cap, f"{day_key}/{exid} needs {weight}kg dumbbells; the gym caps at {cap:g}"




def test_rep_ranges_stay_sane():
    """'reps' steps prescribe the range TOP and the range is top-2. A top below 3 would
    make the implied range meaningless."""
    for day_key, day in bw.PROGRAM.items():
        for ex in day["exercises"]:
            exid, _, _, _, sets, value, _, rest, kind = ex
            assert sets >= 1 and value >= 1, f"{day_key}/{exid} has non-positive sets/reps"
            assert rest >= 30, f"{day_key}/{exid} rest {rest}s is implausibly short"
            if kind == "reps":
                assert value >= 3, f"{day_key}/{exid} rep-range top {value} is too low for a range"


# --------------------------------------------------------------------------- #
# logging-rule normalization
# --------------------------------------------------------------------------- #



def test_logging_rules_reference_real_catalog_pairs():
    """A rule keyed to a typo silently never fires."""
    for bucket in ("two_db_weight_summed", "unilateral_reps_summed", "machine_added_load_only",
                   "logged_as_is"):
        for cat, name in RULES.get(bucket, []):
            assert isinstance(cat, str) and isinstance(name, str)
            assert cat.isupper() and name.isupper(), f"{bucket}: {cat}/{name} is not an enum key"


def test_same_lift_rules_name_real_pairs_and_apply_from_their_date():
    """LOGGING_RULES.same_lift reads one machine's second catalog name as its first (2026-10-23:
    the seated calf's 160x17 came back WEIGHTED_ and the audit called 160 IMPOSSIBLE). A typo
    never fires; an undated rule would merge an older machine into the trend."""
    import strength_sessions as ss
    for r in RULES.get("same_lift", []):
        for cat, name in (r["logged"], r["as"]):
            assert name in CATALOG.get(cat, {}), f"same_lift: {cat}/{name} is not a catalog pair"
        assert r["logged"] != r["as"]
        dt.date.fromisoformat(r["since"])
    saved = ss.SAME_LIFT
    try:
        ss.SAME_LIFT = {("A", "WEIGHTED_X"): (("A", "X"), "2026-08-15")}
        s = {**_set("A", "WEIGHTED_X", 100, 10), "startTime": "2026-10-20 07:10:00"}
        assert ss.pair(s) == ("A", "X")
        assert ss.pair({**s, "startTime": "2026-06-28 18:00:00"}) == ("A", "WEIGHTED_X")
        assert ss.pair(_set("A", "Y", 100, 10)) == ("A", "Y")
    finally:
        ss.SAME_LIFT = saved





# --- sport grouping -----------------------------------------------------------
# 2026-08-29: "virtual_run" was missing from SPORT_GROUP, so both of his 08-28 runs
# did not register as runs. The brief told him run 0/2 and "5 days since last run"
# the morning after he ran 5.02 km. He caught it, not the tests. These two lock the
# map: every sport he actually logs must map somewhere, and the run/bike families
# must stay complete as Garmin adds indoor and virtual variants.
# Deliberately "other": real sessions, but none of them are run/bike/swim/strength, so
# they must not land in the 2/2/2 cardio tracker. HIIT is his Tue/Thu class - it carries
# real load (98 on 08-25) and is visible in week load, just not in the sport split.
KNOWN_UNGROUPED = {
    "hiit", "walking", "other", "cardio_training", "yoga", "hiking",
    "indoor_cardio", "mobility", "paddelball", "sailing_v2", "tennis_v2", "resort_skiing",
}


def test_run_and_bike_families_are_complete():
    from export_dashboard_data import SPORT_GROUP
    for key in ("running", "treadmill_running", "trail_running", "virtual_run",
                "indoor_running", "track_running"):
        assert SPORT_GROUP.get(key) == "run", f"{key} must map to run, got {SPORT_GROUP.get(key)!r}"
    for key in ("cycling", "virtual_ride", "indoor_cycling", "gravel_cycling",
                "road_biking", "mountain_biking"):
        assert SPORT_GROUP.get(key) == "bike", f"{key} must map to bike, got {SPORT_GROUP.get(key)!r}"
    for key in ("lap_swimming", "open_water_swimming", "swimming"):
        assert SPORT_GROUP.get(key) == "swim", f"{key} must map to swim, got {SPORT_GROUP.get(key)!r}"


def test_key_lifts_are_catalog_pairs():
    """profile.key_lifts names each tracked lift as a [category, exerciseName] pair, or as a
    "day/exerciseId" prescription with a label. Labels read as pairs made the export split them
    into letters and die on the first set (2026-10-08), which took refresh.sh down."""
    import export_dashboard_data as ed
    pairs, problems = ed._key_lifts(A.profile)
    assert not problems, problems
    assert len(pairs) == len(A.profile.get("key_lifts") or {}), "two key lifts share a label"
    missing = [label for label, (cat, name) in pairs.items() if name not in (CATALOG.get(cat) or [])]
    assert not missing, f"key_lifts not in the exercise catalog: {missing}"
    both, _ = ed._key_lifts({"key_lifts": {"Bench": ["BENCH_PRESS", "BARBELL_BENCH_PRESS"]}})
    assert both == {"Bench": ("BENCH_PRESS", "BARBELL_BENCH_PRESS")}
    _, bad = ed._key_lifts({"key_lifts": {"Bench": "BARBELL_BENCH_PRESS", "zz/NOPE": "x"}})
    assert len(bad) == 2, bad


def test_confirmed_plan_hashes_bind_the_push_to_what_was_shown():
    """The app records a click against a plan hash; --yes --expect-plan refuses any other plan.
    The hash must be stable for the same plan and move with any change to what would upload."""
    import copy
    import reschedule_workout as rw
    import sync_workouts as sw
    w = {"workoutName": "D1 · Push", "sportType": {"sportTypeKey": "strength_training"},
         "workoutSegments": [{"workoutSteps": [{"stepType": {"stepTypeKey": "interval"},
                                                "endCondition": {"conditionTypeKey": "reps"},
                                                "endConditionValue": 8, "category": "BENCH_PRESS",
                                                "exerciseName": "BARBELL_BENCH_PRESS", "weightValue": 80}]}]}
    plan = [("d1", "D1 · Push", 111, "CHANGED — re-upload and delete old")]
    h = sw.plan_hash(plan, {"d1": w})
    assert h == sw.plan_hash(plan, {"d1": copy.deepcopy(w)}), "same plan, same hash"
    heavier = copy.deepcopy(w)
    heavier["workoutSegments"][0]["workoutSteps"][0]["weightValue"] = 82.5
    assert sw.plan_hash(plan, {"d1": heavier}) != h, "a changed load is a different plan"
    assert sw.plan_hash([("d1", "D1 · Push", 111, "in sync")], {"d1": heavier}) == \
        sw.plan_hash([("d1", "D1 · Push", 111, "in sync")], {"d1": w}), "in-sync content is not in the plan"
    assert sw.content_hash(w) != sw.content_hash(heavier)
    assert rw.move_hash(1, "2026-10-09", "2026-10-08", 7) != rw.move_hash(1, "2026-10-10", "2026-10-08", 7)
    for script in ("sync_workouts", "reschedule_workout"):
        args = ["--expect-plan", "abc"] + (["1", "--to", "2026-10-09"] if script == "reschedule_workout" else [])
        proc = subprocess.run([sys.executable, f"scripts/{script}.py", *args], capture_output=True, text=True,
                              cwd=ROOT, env={k: v for k, v in os.environ.items() if k != "OSC_SESSION"})
        assert proc.returncode == 2 and "only means something with --yes" in proc.stderr, script


def test_endurance_formulas_match_hand_computed_values():
    """formulas.py's endurance block (docs/DESIGN.md (rides and runs) §2.3), against values worked by hand."""
    import formulas as fm
    assert fm.normalized_power([200.0] * 3600) == 200.0                       # steady → NP = average
    assert round(fm.normalized_power([100.0] * 1800 + [300.0] * 1800)) == 253     # ((100⁴+300⁴)/2)^¼: surges cost more than the 200 W mean
    assert round(fm.tss(3600, 250, 250)) == 100 and round(fm.tss(5400, 196, 250)) == 92
    assert round(fm.intensity_factor(196, 250), 2) == 0.78
    assert round(fm.decoupling([200.0] * 3600, [140.0] * 1800 + [147.0] * 1800), 2) == 4.76   # 1 − 140/147
    assert fm.decoupling([200.0] * 300, [140.0] * 300) is None                   # too short to say
    assert fm.best_mean([100.0, 300.0, 300.0, 100.0], 2) == 300.0
    assert fm.resample_1hz([0, 2, 5], [100, 200, 200])[:3] == [100.0, 150.0, 200.0]
    # The 30-second rolling mean — NP's first step and the ride page's smoothing line — one definition.
    assert fm.rolling_seconds([10.0, 20.0, 30.0, 40.0], 2) == [None, 15.0, 25.0, 35.0]


def test_weather_is_fahrenheit_converted_and_impossible_values_dropped():
    """Garmin's activity weather is Fahrenheit with no unit field. Read as Celsius, an October ride
    showed "59 °C" (2026-10-10). Converted, and anything outside -40…50 °C is no reading."""
    import endurance_metrics as em
    w = em.weather({"temp": 59, "apparentTemp": 57, "dewPoint": 48, "relativeHumidity": 70, "weatherTypeDTO": {"desc": "Cloudy"}})
    assert w["temp_c"] == 15.0 and w["feels_like_c"] == 13.9 and w["dew_point_c"] == 8.9, w
    assert em.weather({"temp": 140}) is None and em.weather({"temp": None}) is None and em.weather(None) is None


def test_endurance_metrics_build_for_the_latest_ride_and_run():
    """scripts/endurance_metrics.py on this athlete's own latest ride and run: every metric names its
    source, a virtual session never has a route, and thresholds come from the athlete or Garmin —
    never a default."""
    import endurance_metrics as em
    import formulas as f
    import sports
    import statistics
    acts = sorted(em.ed.all_activities(), key=lambda a: a.get("startTimeLocal", ""), reverse=True)
    for grp in ("bike", "run"):
        a = next((x for x in acts if sports.group((x.get("activityType") or {}).get("typeKey")) == grp), None)
        if not a:
            continue
        out = em.analyse(a["activityId"])
        for k, v in out["metrics"].items():
            assert v["source"] in ("garmin", "computed"), (k, v)
        if out["virtual"]:
            assert out["route"] is None, "a virtual session's coordinates are fictional"
        for th in out["thresholds"].values():
            assert th is None or th["source"] in ("athlete.json", "garmin"), th
        # IF and TSS are relative to an FTP: Garmin's pair is scored against Garmin's FTP, so with
        # the athlete's own FTP in force both must be computed against it (2026-11-01: 290 vs 254).
        if (out["thresholds"]["ftp"] or {}).get("source") == "athlete.json":
            for k in ("if", "tss"):
                assert k not in out["metrics"] or out["metrics"][k]["source"] == "computed", (k, out["metrics"][k])
        # FTP is a cycling threshold: a run's wrist power scored against it read IF 1.57 / TSS 103 on
        # his 11-17 5 km. A run has no FTP, so no IF and no TSS — whatever power it recorded.
        if grp == "run":
            assert out["thresholds"]["ftp"] is None, out["thresholds"]
            assert "if" not in out["metrics"] and "tss" not in out["metrics"], out["metrics"]
        if "decoupling" in out["metrics"]:
            assert out["metrics"]["decoupling"]["basis"] in ("power", "speed")
        if out["weather"]:   # Celsius, plausible (docs/DESIGN.md (app audit) M5), and no station coordinates
            assert {"temp_c", "humidity_pct", "source"} <= set(out["weather"]) and "latitude" not in out["weather"], out["weather"]
            assert -40 <= out["weather"]["temp_c"] <= 50, out["weather"]
        st = out["streams"]
        if st.get("power"):   # the 30 s line comes from the full 1 Hz stream, and is visibly smoother
            assert len(st["power_30s"]) == len(st["power"]), "one value per drawn point"
            # Smoother = less jagged point to point (a ride's climbs and efforts stay, as they should).
            rough = lambda xs: (lambda v: sum(abs(b - a) for a, b in zip(v, v[1:])) / max(1, len(v) - 1))([x for x in xs if x is not None])  # noqa: E731
            # Point-to-point smoothing only holds while CONSECUTIVE WINDOWS OVERLAP. The page draws
            # ~600 points whatever the duration, so a 4 h ride spaces them ~26 s apart and a 4 h 24
            # one 32 s (his 10-31 group ride, the first past the line) — wider than the 30 s window,
            # so each drawn value is its own block mean and the line stops flattening. Past that the
            # rolling mean must still never be ROUGHER than the raw stream it averages.
            ts = [x for x in st["t"] if x is not None]
            spacing = statistics.median(b - a2 for a2, b in zip(ts, ts[1:])) if len(ts) > 1 else 1
            ratio = 0.6 if spacing < f.NP_WINDOW_S else 1.0
            assert rough(st["power_30s"]) < ratio * rough(st["power"]), (spacing, rough(st["power_30s"]), rough(st["power"]))


def test_a_run_is_never_scored_against_the_bike_ftp():
    """session_score.py on this athlete's latest run that recorded power: its intent is never judged by
    IF or by a power band, both of which are FTP-relative and FTP is the bike's (11-17: the 5 km test
    scored 24 "Off plan" off a bike-FTP IF of 1.57)."""
    import session_score
    import sports
    acts = sorted(session_score.ed.all_activities(), key=lambda a: a.get("startTimeLocal", ""), reverse=True)
    a = next((x for x in acts if sports.group((x.get("activityType") or {}).get("typeKey")) == "run"
              and x.get("avgPower")), None)
    if not a:
        return
    r = session_score.score(a["activityId"])
    intent = next((p for p in r.get("parts") or [] if p["key"] == "intent"), None)
    basis = (intent or {}).get("basis") or ((intent or {}).get("detail") or {}).get("basis")
    assert basis not in ("if", "power"), (a["activityId"], intent)
    # The pure core says why, instead of scoring a run zero.
    out = session_score.endurance_parts({"intent": "threshold"}, {}, p1=None, speed1=None, hr_zones=[],
                                        ftp=None, moving_s=1500, fuel_plan=None, fuel_taken=None, grp="run")
    assert "intent" not in out["scores"] and "cycling" in out["dropped"]["intent"], out


def test_an_endurance_review_cannot_cite_a_number_the_engine_did_not_compute():
    """app_contracts.check_evidence (docs/DESIGN.md (rides and runs) §4): every number a finding rests on must be
    the metrics engine's, at the path it names — the model interprets, it never invents."""
    import app_contracts
    analysis = {"id": 7, "metrics": {"np": {"value": 196}, "decoupling": {"value": 7.2}},
                "bests": {"1200s": 217}, "zones": {"hr": [{"zone": 2, "pct": 52}]}, "thresholds": {"ftp": {"value": 250}}}
    review = lambda *ev: {"activity_id": 7, "findings": [{"evidence": [{"metric": m, "value": v} for m, v in ev]}]}  # noqa: E731
    assert app_contracts.check_evidence(review(("metrics.np", 196), ("bests.1200s", 217), ("zones.hr.2", 52),
                                               ("thresholds.ftp", 250), ("metrics.decoupling", 7.2)), analysis) == []
    assert app_contracts.check_evidence(review(("metrics.np", 205)), analysis), "a misremembered number"
    assert app_contracts.check_evidence(review(("metrics.tss", 92)), analysis), "a number the engine never computed"
    assert app_contracts.check_evidence(review(("metrics.decoupling", 4.0)), analysis)
    assert app_contracts.check_evidence({"activity_id": 8, "findings": []}, analysis), "another activity's review"


def test_refresh_reruns_after_a_complete_run_resumes_a_stopped_one_and_locks():
    """scripts/refresh.sh (docs/DESIGN.md (app audit) H1, 2026-10-10). Its resume state used to live all day, so
    every refresh after the first complete one skipped all four steps — the app's Refresh button
    pulled nothing. Now: a complete run is followed by a full run, a stopped run resumes, and one
    refresh per athlete runs at a time. Real refresh.sh, a throwaway athlete, a stub for the steps."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "athletes" / "probe").mkdir(parents=True)
        (t / "athletes" / "probe" / "athlete.json").write_text(json.dumps(
            {"display": "Probe", "garmin": {"display_name": "probe", "full_name": "Probe"}}))
        log = t / "steps.log"
        stub = t / "py"
        stub.write_text('#!/bin/sh\ncase "$1:$2" in scripts/whoami.py:*|scripts/sources.py:) exec "$REAL_PY" "$@";; esac\n'
                        'echo "$1" >> "$STUB_LOG"\n'
                        'if [ -n "$STUB_FAIL" ] && [ "$1" = "$STUB_FAIL" ]; then exit 1; fi\n')
        stub.chmod(0o755)
        env = {k: v for k, v in os.environ.items() if not k.startswith("OSC_")}
        env.update(OSC_ATHLETES_ROOT=str(t / "athletes"), OSC_DATA_ROOT=str(t / "data"),
                   OSC_ATHLETE="probe", OSC_PY=str(stub), REAL_PY=sys.executable, STUB_LOG=str(log))
        run = lambda **extra: subprocess.run(["scripts/refresh.sh", "4"], cwd=ROOT, env={**env, **extra},  # noqa: E731
                                             capture_output=True, text=True)
        steps = lambda: log.read_text().split() if log.exists() else []  # noqa: E731
        four = ["scripts/pull_health.py", "scripts/pull_activities.py", "scripts/sources.py",
                "scripts/export_dashboard_data.py", "scripts/update_health_baseline.py"]
        n = len(four)
        r = run()
        assert r.returncode == 0 and steps() == four, r.stdout + r.stderr
        r = run()
        assert r.returncode == 0 and steps() == four * 2, "a refresh after a complete one must run every step"
        r = run(STUB_FAIL="scripts/pull_activities.py")
        assert r.returncode != 0 and steps()[2 * n:] == four[:2], "the run stops at the failing step"
        r = run()
        assert r.returncode == 0 and steps()[2 * n + 2:] == four[1:], "a stopped run resumes where it stopped"
        assert "resuming" in r.stdout
        lock = t / "data" / "probe" / ".refresh-lock"
        lock.mkdir()
        (lock / "pid").write_text(str(os.getpid()))         # alive: this test
        r = run(REFRESH_LOCK_WAIT="0")
        assert r.returncode == 75 and "still running" in r.stderr, r.stdout + r.stderr
        (lock / "pid").write_text("999999")                  # gone
        n = len(steps())
        r = run()
        assert r.returncode == 0 and steps()[n:] == four and "taking over" in r.stdout
        assert not lock.exists(), "the lock is released when the run ends"
        # An athlete without Garmin (sources.py): their files are imported instead, nothing pulls Garmin.
        (t / "athletes" / "probe" / "athlete.json").write_text(json.dumps(
            {"display": "Probe", "garmin": {}, "sources": ["files", "strava"]}))
        n = len(steps())
        r = run()
        assert r.returncode == 0 and steps()[n:] == [
            "scripts/import_files.py", "scripts/import_strava.py", "scripts/sources.py",
            "scripts/export_dashboard_data.py", "scripts/update_health_baseline.py"], r.stdout + r.stderr


def test_sleep_stage_codes_match_garmins_own_totals():
    """The hypnogram (Recovery) maps Garmin's sleepLevels codes to stages with app_data.SLEEP_STAGE.
    A code table is a lookup that can be silently wrong (CLAUDE.md #1), so every cached night proves
    it: the timeline's per-stage totals must match Garmin's own totals for that night."""
    import app_data
    days = sorted(f.name[:10] for f in A.data_dir.glob("*_sleep.json"))[-30:]
    checked = 0
    for d in days:
        h = app_data.hypnogram(d)
        if not h:
            continue
        checked += 1
        assert h["mismatch_min"] <= 5, f"{d}: stage totals differ from Garmin's by {h['mismatch_min']} min — wrong code table?"
        assert all(a < b for a, b, _ in h["segments"]), d
    # One definition: the brief's last night (dashboard.json) and the app's night agree.
    import export_dashboard_data as ed_
    night = (json.loads(A.dashboard_path.read_text()) if A.dashboard_path.exists() else {}).get("night") or {}
    h = app_data.hypnogram(night.get("date") or "") if night.get("date") else None
    if h and night.get("sleep"):
        assert (h["efficiency_pct"], h["restorative_pct"]) == (night["sleep"]["efficiencyPct"], night["sleep"]["restorativePct"]), (h, night["sleep"])
    assert ed_.sleep_metrics({"sleepTimeSeconds": 6 * 3600, "deepSleepSeconds": 3600, "remSleepSeconds": 5400,
                              "sleepNeed": {"actual": 480}, "sleepStartTimestampLocal": 1_760_000_000_000,
                              "sleepEndTimestampLocal": 1_760_000_000_000 + 7 * 3600 * 1000}) == {
        "asleep_min": 360, "need_min": 480, "performance_pct": 75, "restorative_pct": 42, "efficiency_pct": 86, "in_bed_min": 420}


def test_activity_inventory_reports_names_and_counts_only():
    """scripts/activity_fields.py (docs/DESIGN.md (rides and runs) §2.1) says what each athlete's rides and runs
    record, before anything is built on it — and reports key names with counts, never a value."""
    import activity_fields
    inv = activity_fields.inventory(days=120)
    assert inv["with_splits"] <= inv["activities"] and inv["with_route"] <= inv["with_details"] <= inv["activities"]
    for k in ("by_type", "summary_keys", "lap_keys", "detail_channels", "extras"):
        assert all(isinstance(v, int) for v in inv[k].values()), f"{k} must hold counts only"
    # One sport map: the puller, the export and the app agree on what a ride or a run is.
    import sports
    import export_dashboard_data as ed_
    assert ed_.SPORT_GROUP is sports.SPORT_GROUP


def test_every_app_view_builds_for_every_athlete():
    """The app's data layer (scripts/app_data.py) returns JSON for every view, on each athlete's real
    cache — a new athlete's sparse data included — with definitions for what it shows, and never the
    engine's hardcoded `verdict` text."""
    import app_data
    sessions = app_data.run_view("sessions")["sessions"]
    lifts = app_data.run_view("strength")["lifts"]
    import export_dashboard_data as ed_   # the app groups lifts by the chart's own attribution
    assert all(x["muscle"] == ed_.muscle_of(x["category"], x["name"]) for x in lifts)
    journal = app_data.run_view("journal")["entries"]
    calls = [(v, None) for v in ("today", "recovery", "load", "program", "calendar", "races", "body", "memory", "system")]
    for grp in ("strength", "run", "swim", "bike", "other"):
        hit = next((s for s in sessions if s["group"] == grp), None)
        if hit:
            calls.append(("workout", str(hit["id"])))
    import sports   # every circuit (Hyrox, HIIT) the athlete has, since their sets are shown as stations
    calls += [("workout", str(s["id"])) for s in sessions if s["type"] in sports.CIRCUIT][:5]
    if lifts:
        calls.append(("exercise", f"{lifts[0]['category']}/{lifts[0]['name']}"))
    if journal:
        calls.append(("journal-entry", journal[0]["file"]))
    for name, arg in calls:
        payload = app_data.run_view(name, arg)
        text = json.dumps(payload, default=str)
        assert payload["athlete"] == A.name, name
        assert '"verdict": [' not in text, f"{name} carries the export's hardcoded verdict text"
        # The execution score (docs/DESIGN.md (fuelling and score) §6): every workout page carries the engine's, with words.
        if name == "workout":
            sc_ = payload["score"]
            assert sc_ and not sc_.get("error") and sc_["summary"] and ("score" in payload["defs"]), (arg, sc_)
            assert sc_["excluded"] or all(p["dropped"] or (p["planned_text"] and p["done_text"]) for p in sc_["parts"]), sc_
    import formulas as f_
    bands = {k for _, k, _ in f_.SCORE_BANDS} | {f_.SCORE_UNCLEAR[0], None}
    assert all(s["score"] is None or s["score"]["band"] in bands for s in sessions), "every row's band is the engine's"
    today = app_data.run_view("today")
    assert {"recovery", "load", "tonnage"} <= set(today["defs"]), "definitions travel with the numbers"
    # `you`: what the athlete reported themself (their fuel log, their gut's rate — docs/DESIGN.md (fuelling and score) §2).
    assert all(d["source"] in ("garmin", "computed", "coach", "you") for d in today["defs"].values())
    # Fuel (docs/DESIGN.md (fuelling and score) §6): Today carries the setup still open and the rides and runs to log.
    assert set(today["fuel"]) == {"setup_open", "due"}, today["fuel"]
    fv = app_data.run_view("fuel")
    assert [q["id"] for q in fv["questions"]] == ["products", "recipes", "gut", "caffeine"], fv["questions"]
    assert all(p["id"] in {c["id"] for c in fv["catalog"]} for p in fv["pantry"] if p["kind"] == "product")
    # One definition (R6): the week comparison's tonnage is the export's to the kilogram, and its
    # working sets are the Load screen's (warm-ups stripped; the export's per-workout "sets" keep them).
    # The comparison stops at the last finished day; what today logged after it is `since`.
    week_c = today["week_compare"]
    wc, since, ws = week_c["this"]["to_date"], week_c["this"]["since"] or {"tonnage": 0, "sets": 0}, today["week_strength"]
    weeks = app_data.run_view("load")["weeks"]
    this_week = weeks[-1] if weeks and weeks[-1]["week"] == app_data._iso_week(app_data.TODAY().isoformat()) else {"tonnage": 0, "sets": 0}
    assert wc["tonnage"] + since["tonnage"] == round(ws["tonnage"]) == this_week["tonnage"], (wc, since, ws, this_week)
    assert wc["sets"] + since["sets"] == this_week["sets"], (wc, since, this_week)
    # Like for like (handoff 2026-10-25): last week is cut at the same day, and today is in the
    # comparison only once it logged something with nothing planned for it left.
    cut, ti = week_c["cut"], week_c["today_index"]
    assert week_c["last"]["to_date"]["minutes"] == sum(x["min"] for d in week_c["last"]["days"][:cut + 1] for x in d["sports"])
    td = week_c["this"]["days"][ti]
    assert cut == (ti if td["sports"] and not td["planned"] else ti - 1), (cut, ti)
    # A planned gym day's minutes are the Program screen's estimate for that day.
    est = {d["key"]: d["est_min"] for d in app_data.run_view("program")["days"]}
    for p in (p for d in week_c["this"]["days"] for p in d["planned"] if p["min_source"] == "program"):
        assert any(p["min"] == m for m in est.values()), (p, est)
    assert today["vitals"] and len(today["vitals"]) == 30
    # The Last session card (handoff 2026-10-23): the newest day anything was logged, every session
    # of it in time order — the same activities the Workouts list has for that day.
    ld = today["last_day"]
    if sessions:
        assert ld["date"] == max(s["date"] for s in sessions if s["date"] <= app_data.TODAY().isoformat())
        assert [s["id"] for s in ld["sessions"]] == [s["id"] for s in sorted(sessions, key=lambda s: s["start"]) if s["date"] == ld["date"]]
        gym = next((s for s in ld["sessions"] if s["group"] == "strength" and s["has_sets"]), None)
        if gym:   # each block says what it was for; only an unnamed one has no role
            for b in app_data.run_view("workout", str(gym["id"]))["exercises"]:
                assert (b["phase"] is None) == b["unnamed"], b["label"]
                assert b["phase"] in (None, "core", "power", "strength", "hypertrophy", "functional"), b
    # One season (docs/DESIGN.md (races) §6): Today's race line and the races view read the same phase_on().
    rv, line = app_data.run_view("races"), today["race"]
    assert ((line or {}).get("next") or {}).get("id") == (rv["next"] or {}).get("id"), (line, rv["next"])
    assert ((line or {}).get("window") or {}).get("window") == rv["today"]["window"], (line, rv["today"])


def test_every_watch_step_is_tied_to_its_exercise_row():
    """The Plan screen's session panel (board Plan, 2026-10-17) ties each row of a gym day — the core
    block first, then every exercise — to the watch steps that run it, and steps through them. The view
    reads the tie from build_workouts' layout (one Lap-ended block per warm-up and per exercise); if a
    file stops splitting that way, no step is tied and the panel silently loses the tie, so this test
    says it first. Every step tied, every row reached, in program order, and each row's steps naming
    the row's own exercise."""
    import app_data
    for d in app_data.run_view("program")["days"]:
        steps = d.get("watch")
        if not steps:
            continue
        rows = [e["exid"] for e in d["lead"] + d["exercises"]]
        tied = [s.get("row") for s in steps]
        assert all(tied), f"{d['key']}: watch steps not tied to rows — is {d['key']}.json built from this program?"
        assert list(dict.fromkeys(tied)) == rows, (d["key"], list(dict.fromkeys(tied)), rows)
        pair = {e["exid"]: f"{e['category']}/{e['name']}" for e in d["lead"] + d["exercises"]}
        for s in steps:
            if s["kind"] == "interval":
                assert s["exercise"] == pair[s["row"]], (d["key"], s["row"], s["exercise"])


def test_off_watch_plan_is_well_formed():
    """athletes/<name>/plan.json — sessions planned off the watch (Zwift, the long ride, tennis), and
    the watch sessions of an accepted week that wait to go on the watch — is what the Plan and Today
    screens show beside the Garmin calendar. Every entry needs a real date, a title and a sport the app
    can name. A watch session names its managed `workout` and carries that workout's own name and sport,
    so the app can hide it once Garmin's calendar has it (2026-10-16); any other entry may not be a
    watch workout, or the same session would show twice and a push would never be offered for it."""
    if not A.plan_path.exists():
        return
    import sports
    sessions = json.loads(A.plan_path.read_text()).get("sessions")
    assert isinstance(sessions, list), "plan.json needs a sessions list"
    watch = set(A.managed) | {json.loads(f.read_text()).get("workoutName") for f in A.workouts_dir.glob("*.json")
                              if f.name[0].islower()}
    for s in sessions:
        dt.date.fromisoformat(s["date"])
        assert s.get("title"), s
        assert s.get("sport") in sports.SPORT_LABEL, f"{s.get('sport')!r} is not a known Garmin typeKey"
        if s.get("workout"):
            assert s["workout"] in A.managed, f"{s['workout']!r} is not one of the managed workouts"
            w = json.loads((A.workouts_dir / f"{s['workout']}.json").read_text())
            assert s["title"] == w.get("workoutName"), f"{s['date']}: title {s['title']!r} must be {w.get('workoutName')!r}"
            assert s["sport"] == (w.get("sportType") or {}).get("sportTypeKey"), f"{s['date']}: sport must be the workout's"
        else:
            assert s["title"] not in watch, f"{s['title']} is a watch workout — name it as `workout`, or schedule it"
        import app_data
        assert s.get("platform") in (None, *app_data.PLATFORMS), f"{s.get('platform')!r}: the app has no mark for it"
        # Today's This week draws a planned session by its minutes; without them it uses the sport's typical time.
        assert s.get("duration_min") is None or (isinstance(s["duration_min"], int) and s["duration_min"] > 0), s
        # Its intent is what its fuel plan reads (docs/DESIGN.md (fuelling and score) §4.3): one of the rule's own, or none.
        import formulas
        assert s.get("intent") is None or s["intent"] in formulas.INTENTS, \
            f"{s['date']} {s['title']}: intent {s.get('intent')!r} is not one of {sorted(formulas.INTENTS)}"

        # Every planned Zwift ride names a workout from Zwift's library (his rule, 2026-11-05).
        import zwift_workouts
        if zwift_workouts.needs_workout(s):
            bad = zwift_workouts.problems(s.get("zwift_workout"))
            assert not bad, f"{s['date']} {s['title']}: {'; '.join(bad)}"
        elif s.get("zwift_workout") is not None:
            assert s.get("platform") == "zwift", f"{s['date']}: a zwift_workout on a session Zwift doesn't run"
            assert not zwift_workouts.problems(s["zwift_workout"]), (s["date"], zwift_workouts.problems(s["zwift_workout"]))


def test_a_planned_zwift_ride_names_a_real_workout():
    """His rule (2026-11-05): "whenever you plan a Zwift ride you must also recommend a workout from Zwift."
    The 11-05 plan said 5 × 3′ at 292–305 W and named nothing, so he rode what Zwift offered: 9′ of work
    against 15′. A Zwift session from the rule's date on needs `zwift_workout` with a name, a
    whatsonzwift.com workout link and its minutes. Earlier sessions predate the rule. The plan proposal
    contract holds the same for a Zwift day."""
    import zwift_workouts as zw
    import app_contracts
    ok = {"name": "Half an Hour in Zone 2", "url": "https://whatsonzwift.com/workouts/endurance/half-an-hour-in-zone-2",
          "collection": "Endurance", "duration_min": 45, "stress_points": 29}
    assert zw.problems(ok) == []
    assert zw.problems(None), "a Zwift ride with no workout must be refused"
    assert zw.problems({**ok, "url": "https://whatsonzwift.com/workouts/"}), "the site's index is not a workout"
    assert zw.problems({**ok, "url": "https://zwift.com/x"}), "only whatsonzwift.com pages"
    assert zw.problems({k: v for k, v in ok.items() if k != "duration_min"}), "minutes are required"
    assert zw.problems({**ok, "watts": 180}), "unknown fields are refused, not carried silently"
    assert zw.needs_workout({"date": zw.RULE_FROM, "platform": "zwift"})
    assert not zw.needs_workout({"date": "2026-11-05", "platform": "zwift"}), "planned before the rule"
    assert not zw.needs_workout({"date": "2027-01-01", "sport": "cycling"}), "an outdoor ride needs none"
    day = {"date": "2026-11-12", "type": "cardio", "workout_key": None, "sport": "zwift", "title": "Zwift · VO2",
           "change": "added", "reason": "The week's VO2 work."}
    base = json.loads((ROOT / "app" / "fixtures" / "demo" / "results" / "plan_proposal.json").read_text())
    assert app_contracts.validate("plan_proposal", {**base, "days": [day]}), "a proposed Zwift day with no workout"
    assert not app_contracts.validate("plan_proposal", {**base, "days": [{**day, "zwift_workout": ok}]})
    assert not app_contracts.validate("plan_proposal", {**base, "days": [{**day, "change": "removed"}]}), "a removed day needs none"


def test_an_accepted_watch_session_shows_until_the_watch_has_it():
    """The days of an accepted week beyond the watch's horizon live in plan.json, naming their workout:
    the Plan screen shows them as planned, and hides one once Garmin's calendar has that workout on
    that day — never both, never neither (2026-10-16: Legs on 10-20 was accepted and showed as Rest)."""
    import tempfile
    import types
    import app_data
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "d3_legs.json").write_text(json.dumps({"workoutName": "Gym · Legs + Speed", "sportType": {"sportTypeKey": "strength_training"}}))
        (tmp / "plan.json").write_text(json.dumps({"sessions": [
            {"date": "2026-10-19", "title": "Gym · Legs + Speed", "sport": "strength_training", "workout": "d3_legs"},
            {"date": "2026-10-20", "title": "Gym · Legs + Speed", "sport": "strength_training", "workout": "d3_legs"},
            {"date": "2026-10-20", "title": "Long ride", "sport": "cycling"}]}))
        fake_a = types.SimpleNamespace(plan_path=tmp / "plan.json", managed=["d3_legs"], workouts_dir=tmp,
                                       fuel_path=tmp / "fuel.json")   # no setup: planned sessions carry fuel in grams only
        cal = [{"date": "2026-10-19", "title": "Gym · Legs + Speed"}]
        fake_ed = types.SimpleNamespace(load=lambda name: cal if name == "scheduled.json" else None, all_activities=lambda: [])
        saved = app_data._ed
        app_data._ed = lambda: fake_ed
        try:
            got = [(p["date"], p["title"], p["workout"]) for p in app_data._planned(fake_a, "2026-10-17")]
        finally:
            app_data._ed = saved
    assert got == [("2026-10-20", "Gym · Legs + Speed", "d3_legs"), ("2026-10-20", "Long ride", None)], got


def test_app_fixtures_build_and_honour_their_contracts():
    """app/fixtures/make_demo.py builds the synthetic Demo athlete and runs the real engine over it:
    every view must build on that data too, and every committed coach-result fixture must pass its
    contract (app/contracts/). The fixtures are what the design session and the UI are built on."""
    import tempfile
    import app_contracts
    # --sparse is a NEW athlete (twelve days, HRV uncalibrated, no weigh-ins): the views must build there too.
    for extra in ([], ["--sparse"]):
        with tempfile.TemporaryDirectory() as tmp:
            proc = subprocess.run([sys.executable, "app/fixtures/make_demo.py", "--out", tmp, *extra], cwd=ROOT,
                                  capture_output=True, text=True,
                                  env={k: v for k, v in os.environ.items() if not k.startswith("OSC_")})
            assert proc.returncode == 0, extra + [proc.stdout + proc.stderr]
            index = json.loads((Path(tmp) / "index.json").read_text())
            assert {"today", "recovery", "load", "strength", "workout", "exercise", "program", "races"} <= set(index["views"])
            view = lambda n: json.loads((Path(tmp) / "views" / f"{n}.json").read_text())  # noqa: E731
            races_v, today_v, cal_v, prog_v = view("races"), view("today"), view("calendar"), view("program")
            if not extra:   # four races (docs/DESIGN.md (races) §6): an A race ahead, one that differs, two run with results
                rs = races_v["races"]
                ahead = [r for r in rs if r["priority"] == "A" and r["days_to"] > 0]
                assert len(rs) == 4 and ahead and races_v["season"]["race"]["id"] == ahead[0]["id"], rs
                differs = [r for r in rs if r["verified"]["status"] == "differs"]
                assert differs and differs[0]["verified"]["found"]["date"] != differs[0]["date"], differs
                done = [r for r in rs if r["entry"] == "done"]
                assert done and all(r["result"]["vs_target_s"] is not None for r in done), done
                assert {str(r["result"]["activity_id"]) for r in done} <= {e["arg"] for e in index["views"]["workout"]}
                # The 70.3's splits are read from its multisport legs and make its time; the half has none.
                tri = next(r["result"] for r in done if r["kind"] == "triathlon_70_3")
                assert tri["splits_from"] == "legs" and sum(p["seconds"] for p in tri["splits"]) == tri["seconds"], tri
                assert [v["key"] for v in tri["vs_reference"]] == ["swim", "bike", "run", "transitions"], tri
                assert all(r["result"]["splits"] is None for r in done if r["kind"] == "half_marathon")
                assert all(r["mark"] is None and r["fallback"]["monogram"] for r in rs), "synthetic events: fallbacks only"
                assert today_v["race"]["next"]["id"] == races_v["next"]["id"], today_v["race"]
                assert {x["window"] for x in cal_v["race_days"]} >= {"easy", "taper", "race", "recovery"}, cal_v["race_days"]
                assert prog_v["season"]["current"]["name"] == prog_v["block"]["name"], prog_v["season"]["current"]
            else:   # none: the views without races.json
                assert races_v["races"] == [] and races_v["next"] is None and races_v["season"] is None, races_v
                assert today_v["race"] is None and cal_v["race_days"] == [] and prog_v["season"] is None
            if not extra:   # a circuit shows its stations; a review shows on its own session only (M3, M4)
                views = {e["arg"]: json.loads((Path(tmp) / e["file"]).read_text()) for e in index["views"]["workout"]}
                circuit = next(v for v in views.values() if v["group"] == "other")
                assert [x["name"] for x in circuit["stations"]][:2] == ["RUN_OR_WALK", "PUSH"], circuit.get("stations")
                assert any(x["auto_detected"] for x in circuit["stations"]), "the watch's guess stays marked"
                entries = {e["arg"] for e in index["views"].get("journal-entry", [])}
                for v in views.values():   # every review a workout page links to is in the fixtures
                    assert set(v["reviews"]) <= entries, (v["id"], v["reviews"], entries)
                ride = next(v for v in views.values() if v["group"] == "bike")
                assert ride["reviews"] == [f"{ride['date']}-{ride['id']}-review.md"], ride["reviews"]
                # Its fuel: logged by Rocky — a bottle and a gel, 80 g — through fuel.py (make_demo.write_fuel).
                assert ride["fuel"]["taken"]["g"] == 80 and ride["fuel"]["taken"]["source"] == "you", ride["fuel"]
                assert not ride["fuel"]["due"] and ride["fuel"]["pantry"], ride["fuel"]
                for v in views.values():
                    if v["id"] != ride["id"]:
                        assert not any(str(ride["id"]) in r for r in v["reviews"]), (v["id"], v["reviews"])
            if not extra:   # a session planned off the watch reaches the calendar (2026-10-12: Zwift was invisible)
                cv = json.loads((Path(tmp) / "views" / "calendar.json").read_text())
                assert [x["title"] for x in cv["planned"]] == ["Zwift · VO2 45 min", "Long ride · Z2"], cv.get("planned")
                # Each names its intent, and its fuel comes from it (docs/DESIGN.md (fuelling and score) §4.3): the 45-minute
                # VO2 ride needs none, the 150-minute long ride is planned in Rocky's own products.
                vo2, long_ride = cv["planned"]
                assert vo2["intent"] == "vo2" and vo2["fuel"]["needed"] is False, vo2["fuel"]
                assert long_ride["fuel"]["needed"] and long_ride["fuel"]["items"], long_ride["fuel"]
                assert {i["id"] for i in long_ride["fuel"]["items"]} <= {"bottle", "maurten-gel-160"}, long_ride["fuel"]["items"]
                assert cv["planned"][0]["badge"]["icon"] == "zwift", cv["planned"][0]
                # ...naming its Zwift workout, which the panel, Today and the lite page show (2026-11-05).
                assert cv["planned"][0]["zwift_workout"]["name"] == "VO2 Max 3x3", cv["planned"][0]
            if not extra:   # the hero's program day is the CALL's, never the calendar's (docs/DESIGN.md (app audit) H2)
                tv = json.loads((Path(tmp) / "views" / "today.json").read_text())
                key = tv["daily"]["recommendation"]["workout_key"]
                assert tv["call_program"] and tv["call_program"]["key"] == key, (key, tv["call_program"])
            if extra:   # nothing is invented for someone new: no HRV band, no ratio before 28 days of history
                today = json.loads((Path(tmp) / "views" / "today.json").read_text())["today"]
                assert today["hrv"]["bandLow"] is None and today["hrv"]["bandHigh"] is None, today["hrv"]
                # They trained today without starting it from the calendar: the view still knows.
                tv = json.loads((Path(tmp) / "views" / "today.json").read_text())
                # This morning's reading hasn't synced: the overnight numbers are yesterday's, and the
                # week still knows which day is today (docs/DESIGN.md (app audit) M2).
                yesterday = (dt.date.today() - dt.timedelta(days=1)).isoformat()
                assert tv["today"]["date"] == yesterday, tv["today"]["date"]
                assert [d["date"] for d in tv["week"]["days"] if d["isToday"]] in ([dt.date.today().isoformat()], []), tv["week"]["days"]
                trained = tv["trained_today"]
                assert [w["kind"] for w in trained] == ["strength"] and trained[0]["start"], trained
                acwr = json.loads((Path(tmp) / "views" / "load.json").read_text())["acwr"]["strength"]
                assert all(w["ratio"] is None for w in acwr), acwr
    for f in sorted((ROOT / "app" / "fixtures").glob("*/results/*.json")):
        payload = json.loads(f.read_text())
        assert not app_contracts.validate(payload["kind"], payload), f"{f.name}: {app_contracts.validate(payload['kind'], payload)}"
    bad = {"kind": "daily", "date": "today"}
    assert app_contracts.validate("daily", bad), "the validator must refuse a malformed result"


def test_app_channel_server_tests_pass():
    """The app's server (app/channel) has its own tests — gating, the request book, attach, the token
    swap, publish and confirm, fixtures mode. They run here so the push gate covers the server too."""
    import shutil
    node = shutil.which("node")
    assert node, "node is needed for the app's server (Node 24+)"
    channel = ROOT / "app" / "channel"
    assert (channel / "node_modules").is_dir(), "run `npm ci` in app/channel once"
    proc = subprocess.run([node, "--test", *sorted(str(p) for p in (channel / "test").glob("*.test.ts"))],
                          cwd=channel, capture_output=True, text=True, timeout=300,
                          env={k: v for k, v in os.environ.items() if not k.startswith("OSC_")})
    assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-2000:]


def test_app_web_typechecks():
    """The app's UI (app/web) typechecks against the types generated from app/contracts/. A result
    field renamed in a contract breaks here, not on the athlete's screen."""
    import shutil
    web = ROOT / "app" / "web"
    assert (web / "node_modules").is_dir(), "run `npm ci` in app/web once"
    proc = subprocess.run([shutil.which("node") or "node", "node_modules/typescript/bin/tsc", "--noEmit"], cwd=web,
                          capture_output=True, text=True, timeout=300)
    assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-1000:]


def test_app_web_component_tests_pass():
    """app/web's component tests (docs/DESIGN.md (app audit) L2): the flows a person sees — today's call and the
    call's own workout, no stale call shown as today's, DONE, the coach's startup status, a ride's
    laps and analysis, a circuit's stations, the Send-to-watch card — on the committed fixtures."""
    import shutil
    web = ROOT / "app" / "web"
    assert (web / "node_modules").is_dir(), "run `npm ci` in app/web once"
    proc = subprocess.run([shutil.which("node") or "node", "node_modules/vitest/vitest.mjs", "run"], cwd=web,
                          capture_output=True, text=True, timeout=300)
    assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-1000:]


def test_app_settings_are_well_formed():
    """Optional, per athlete (decided 2026-10-08): a training BLOCK in program.py, cardio targets in
    athlete.json → profile, an identity accent in athlete.json → app. Each must parse if present."""
    import datetime as _dt
    b = getattr(A.program, "BLOCK", None)
    if b is not None:
        assert isinstance(b.get("name"), str) and b["name"], "BLOCK needs a name"
        _dt.date.fromisoformat(b["start"])
        assert isinstance(b.get("weeks"), int) and b["weeks"] > 0, "BLOCK needs weeks > 0"
    t = A.profile.get("cardio_targets")
    if t is not None:
        assert set(t) <= {"runs", "swims", "rides", "cardio_load"}, f"unknown cardio_targets keys: {set(t)}"
        assert all(isinstance(t[k], int) and t[k] >= 0 for k in ("runs", "swims", "rides") if k in t)
        if "cardio_load" in t:
            lo, hi = t["cardio_load"]
            assert 0 <= lo <= hi, "cardio_load is [low, high]"
    accent = (A.config.get("app") or {}).get("accent")
    if accent is not None:
        import re
        assert re.fullmatch(r"#[0-9A-Fa-f]{6}", accent), "app.accent is a #RRGGBB colour"


def test_recovery_components_read_in_words_and_points_add_up():
    """The Recovery screen reads each signal as a state against your usual and shows the score as the
    sum of the signals' points (round 3) — both from the engine, never computed on the page."""
    import export_dashboard_data as ed
    comp, score = ed.recovery_composite(60, 60, 50, 50, 100.0, 480, 480, 14.0, 0.0, 0.0)
    states = {c["label"]: c["state"] for c in comp}
    assert states == {"HRV vs 30d": "usual", "RHR vs 30d": "usual", "Sleep perf": "met", "Respiration": "usual", "Skin temp": "usual"}
    assert [c["score"] for c in comp][:2] == [50, 50], "at your usual, HRV and resting HR score half"
    assert abs(sum(c["points"] for c in comp) - score) <= 1, (comp, score)
    low, _ = ed.recovery_composite(50, 60, 53, 50, 70.0, 336, 480, 15.5, 1.5, 1.2)
    assert {c["label"]: c["state"] for c in low} == {"HRV vs 30d": "well_below", "RHR vs 30d": "well_below", "Sleep perf": "well_short",
                                                     "Respiration": "high", "Skin temp": "high"}, low
    hrv = next(c for c in low if c["label"] == "HRV vs 30d")
    assert (hrv["value"], hrv["normal"], hrv["unit"]) == (50, 60, "ms")


def test_recovery_on_matches_todays_score():
    """The app's recovery calendar scores past days with recovery_on(); today it must agree with
    the score the export reports, or the calendar and the ring would disagree."""
    import datetime as _dt
    import app_data
    import export_dashboard_data as ed
    end = _dt.date.today()
    night = ed.build(end)["night"]
    if night["date"] == end.isoformat():
        assert ed.recovery_on(night["date"])["score"] == night["recoveryScore"]
        assert ed.recovery_on(night["date"])["components"] == night["components"]   # the Recovery screen's points view (R7)
        rec = app_data.run_view("recovery")
        x = next((y for y in rec["series"] if y["date"] == night["date"]), None)
        if x and x["resp"]:   # each night's usual respiration is the brief's baseline, computed once (R10)
            assert x["resp_base"] == night["vitals"]["respiration"]["baseline"], (x["resp_base"], night["vitals"])


def test_analysis_scripts_print_their_own_data():
    """rotation_status, progression_report and prescription_audit print from the same functions
    the app reads (rotation(), lift_rows(), audit()), so the terminal and the app cannot disagree."""
    import prescription_audit as pa
    import rotation_status as rs
    env = {k: v for k, v in os.environ.items() if k != "OSC_SESSION"}
    out = {n: subprocess.run([sys.executable, f"scripts/{n}.py"], env=env, capture_output=True,
                             text=True, cwd=ROOT) for n in ("prescription_audit", "rotation_status",
                                                            "progression_report")}
    for name, proc in out.items():
        assert "Traceback" not in proc.stderr, f"{name} crashed"
    for row in pa.audit()["rows"]:
        assert row["line"] in out["prescription_audit"].stdout, row["exid"]
    for d in rs.rotation()["days"]:
        assert d["label"] in out["rotation_status"].stdout


def test_every_logged_sport_typekey_is_grouped():
    """Any typeKey in the cached activity pulls either maps, or is a known exception."""
    import glob
    from export_dashboard_data import SPORT_GROUP
    seen = set()
    for path in glob.glob(str(A.data_dir / "activities_*.json")):
        with open(path) as fh:
            acts = json.load(fh)
        if isinstance(acts, dict):
            acts = acts.get("activities", [])
        for a in acts:
            key = (a.get("activityType") or {}).get("typeKey")
            if key:
                seen.add(key)
    unmapped = {k for k in seen if k not in SPORT_GROUP} - KNOWN_UNGROUPED
    assert not unmapped, (
        f"activity types logged but not in SPORT_GROUP (they vanish into 'other' and "
        f"disappear from the cardio tracker): {sorted(unmapped)}")


def test_every_logged_sport_typekey_has_a_name_and_icon():
    """Every typeKey this athlete has logged has a label and an icon in sports.SPORT_LABEL (APP_AUDIT
    R5: tennis showed as "Activity" on Today and "Circuit" on Workouts). An unmapped key would still
    read as its own words — this keeps the icons and the Garmin names complete."""
    import glob
    import sports
    seen = set()
    for path in glob.glob(str(A.data_dir / "activities_*.json")):
        with open(path) as fh:
            acts = json.load(fh)
        if isinstance(acts, dict):
            acts = acts.get("activities", [])
        seen |= {(a.get("activityType") or {}).get("typeKey") for a in acts} - {None}
    missing = sorted(seen - set(sports.SPORT_LABEL))
    assert not missing, f"logged sports with no name or icon in sports.SPORT_LABEL: {missing}"
    assert not (set(sports.SPORT_GROUP) | KNOWN_UNGROUPED) - set(sports.SPORT_LABEL), "every known typeKey has a label"
    assert sports.badge("tennis_v2") == {"type": "tennis_v2", "sport": "Tennis", "icon": "racket", "kind": "sport"}
    assert sports.badge("indoor_cardio")["kind"] == "circuit" and sports.badge("road_biking")["kind"] == "endurance"


# --- races (docs/DESIGN.md (races), 2026-10-15) ----------------------------------------
# An athlete's season is athletes/<name>/races.json; the rules about the days around each race are
# scripts/races.py. These hold the file to its shape and the rules to their definitions, and keep the
# plan out of the windows: a date never changes silently, and no test lands where the race would
# measure it.

def _race(**kw):
    """A synthetic race for the rule tests — never an athlete's."""
    base = {"id": "r", "name": "Race", "kind": "half_marathon", "priority": "B", "entry": "entered",
            "date": "2027-02-14", "target": {"under": "1:55:00"}, "series": None, "result": None,
            "verified": {"status": "confirmed", "checked": "2026-10-15", "source_kind": "official",
                         "source": "https://example.com", "found": {"date": "2027-02-14"}, "history": []}}
    return {**base, **kw}


def test_races_are_well_formed():
    """athletes/<name>/races.json (docs/DESIGN.md (races) §1) is what the daily, the week planner and the app
    read: unique ids, real dates, a known kind, priority and entry, a target that parses, a series the
    mark registry knows (or none), a `verified` record on every race, and a result only once the race
    is run. And windows the rules accept: a race keeps its own `windows` only where they differ from
    races.py's default for its kind and priority — a copy of the default would silently pin it if the
    default ever changed — and a (kind, priority) with no default must give its own."""
    import re
    import races
    if not A.races_path.exists():
        return
    raw = json.loads(A.races_path.read_text())
    assert isinstance(raw.get("races"), list), "races.json needs a races list"
    ids = [r.get("id") for r in raw["races"]]
    assert all(ids) and len(ids) == len(set(ids)), f"race ids must be present and unique: {ids}"
    today = dt.date.today()
    for r in raw["races"]:
        rid = r["id"]
        assert r.get("name"), f"{rid}: a race needs a name"
        day = dt.date.fromisoformat(r["date"])
        if r.get("start") is not None:
            assert re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", r["start"]), f"{rid}: start {r['start']!r} is not HH:MM"
        assert r.get("kind") in races.RACE_KINDS, f"{rid}: unknown kind {r.get('kind')!r}"
        assert r.get("priority") in races.PRIORITIES, f"{rid}: priority {r.get('priority')!r} is not A or B"
        assert r.get("entry") in races.ENTRY, f"{rid}: entry {r.get('entry')!r}"
        if r.get("target") is not None:
            races.seconds(r["target"]["under"])
        assert r.get("series") is None or re.fullmatch(r"[a-z0-9][a-z0-9.-]*", r["series"]), f"{rid}: series {r['series']!r} is not a lowercase slug"
        v = r.get("verified")
        assert isinstance(v, dict) and v.get("status") in races.STATUS, f"{rid}: every race carries its verified record"
        assert isinstance(v.get("history", []), list), f"{rid}: verified.history is a list"
        if v.get("checked"):
            assert dt.date.fromisoformat(v["checked"]) <= today, f"{rid}: checked in the future"
            assert v.get("source_kind") in races.SOURCE_KINDS and v.get("source"), f"{rid}: a check names its source"
            dt.date.fromisoformat((v.get("found") or {}).get("date") or "")
        else:
            assert v["status"] == "unconfirmed", f"{rid}: never checked, so unconfirmed"
        own = r.get("windows") or {}
        assert set(own) <= set(races.WINDOW_KEYS), f"{rid}: unknown window keys {sorted(set(own) - set(races.WINDOW_KEYS))}"
        assert all(isinstance(n, int) and not isinstance(n, bool) and n >= 0 for n in own.values()), f"{rid}: whole days"
        default = races.WINDOWS.get((r["kind"], r["priority"]), {})
        same = sorted(k for k in own if default.get(k) == own[k])
        assert not same, f"{rid}: windows {same} repeat races.py's default — keep only what differs"
        w = races.windows_of(r)   # raises when neither the default nor the race gives the days around it
        assert not (w.get("taper") and r["priority"] != "A"), f"{rid}: a taper is for an A race only"
        assert w.get("no_intensity_after", 0) <= w["recovery_after"], f"{rid}: no_intensity_after > recovery_after"
        res = r.get("result")
        if res is not None:
            assert day <= today, f"{rid}: a result before the race"
            races.seconds(res["time"])
            assert res.get("activity_id") is None or isinstance(res["activity_id"], int), f"{rid}: result.activity_id"
        if r["entry"] == "done":
            assert day <= today, f"{rid}: done before its date"


def test_a_race_date_is_never_overwritten_silently():
    """A check that finds another date records it and never applies it (docs/DESIGN.md (races) §3): the
    athlete's `date` stays, the race is marked `differs`, and the daily asks which is right. So a date
    that differs from what the last check found must carry that status, a `differs` whose dates agree
    is an answered question still open, and every earlier value stays in history with its reason."""
    import races
    for r in races.load(A):
        v = r["verified"]
        found = (v.get("found") or {}).get("date")
        if found and found != r["date"]:
            assert v["status"] == "differs", f"{r['id']}: date {r['date']}, but the check found {found} — mark it differs and ask"
        if v["status"] == "differs":
            assert found and found != r["date"], f"{r['id']}: differs, yet the dates agree — record his answer"
        for h in v.get("history") or []:
            dt.date.fromisoformat(h["date"])
            assert h.get("why"), f"{r['id']}: an earlier value says why it changed"


def test_no_benchmark_falls_inside_a_race_window():
    """A max test on an easy, taper, race or recovery day measures the race, not the fitness
    (docs/DESIGN.md (races) §8): no benchmark due from today on (program.py → BENCHMARKS) falls inside any
    race's window — overlapping windows included."""
    import races
    rs = races.load(A)
    today = dt.date.today().isoformat()
    for b in getattr(A.program, "BENCHMARKS", None) or []:
        if b.get("due") and b["due"] >= today:
            p = races.phase_on(b["due"], rs)
            hits = [h for h in (p, *p["also"]) if h["window"] not in (None, "build")]
            assert not hits, f"{b['id']} is due {b['due']}, a {hits[0]['window']} day for {hits[0]['race']['name']}"


def test_season_is_contiguous_and_ends_at_its_a_race():
    """program.py → SEASON (optional, docs/DESIGN.md (races) §4): the blocks to the A race, planned backward
    from it. Each block starts the day after the one before ends — no gap, no overlap; the first has
    started and the season is not over (it runs to the end of the A race's recovery); the A race falls
    in the last block or on the day right after it; and BLOCK, the current block, is one of them."""
    import races
    season = getattr(A.program, "SEASON", None)
    if season is None:
        return
    rs = {r["id"]: r for r in races.load(A)}
    a_race = rs.get(season.get("race"))
    assert a_race and a_race["priority"] == "A", f"SEASON.race {season.get('race')!r} is not an A race in races.json"
    for b in season.get("blocks") or []:
        assert isinstance(b.get("name"), str) and b["name"] and isinstance(b.get("emphasis"), str), b
        assert isinstance(b.get("weeks"), int) and b["weeks"] > 0, b
        dt.date.fromisoformat(b["start"])
    blocks = races.season_blocks(season, list(rs.values()))
    assert blocks, "SEASON needs blocks"
    for prev, b in zip(blocks, blocks[1:]):
        nxt = (dt.date.fromisoformat(prev["end"]) + dt.timedelta(days=1)).isoformat()
        assert b["start"] == nxt, f"{b['name']} starts {b['start']}, not the day after {prev['name']} ends ({nxt})"
    rec = races.span(a_race)["recovery"]
    end = max(blocks[-1]["end"], rec["to"] if rec else a_race["date"])
    today = dt.date.today().isoformat()
    assert blocks[0]["start"] <= today <= end, f"SEASON runs {blocks[0]['start']} → {end}: the block review writes the next"
    after = (dt.date.fromisoformat(blocks[-1]["end"]) + dt.timedelta(days=1)).isoformat()
    assert blocks[-1]["start"] <= a_race["date"] <= after, (
        f"the A race ({a_race['date']}) must fall in the last block or the day after it ({blocks[-1]['start']} → {after})")
    block = getattr(A.program, "BLOCK", None)
    if block:
        assert any((b["name"], b["start"], b["weeks"]) == (block["name"], block["start"], block["weeks"]) for b in blocks), (
            f"BLOCK {block['name']} ({block['start']}, {block['weeks']} weeks) is not one of SEASON's blocks")


def test_race_kinds_and_marks_are_known_to_the_engine_and_the_app():
    """Each kind's result is found by its Garmin typeKeys, so every one must be a sport sports.py knows
    (a new HYROX typeKey goes there first); each icon is one SportIcon.tsx draws; every default window
    names a known kind and priority, with a taper only before an A race. Every mark file the registry
    names is committed in app/web/public — the app never hotlinks a logo — and each mark carries its
    label and trademark note. No races.json means no races."""
    import re
    import races
    import sports
    icons = set(re.findall(r"^\s+(\w+): '", (ROOT / "app/web/src/components/SportIcon.tsx").read_text(), re.M))
    for kind, spec in races.RACE_KINDS.items():
        assert spec["label"] and spec["icon"] in icons, f"{kind}: icon {spec['icon']!r} is not a SportIcon"
        unknown = [t for t in spec["type_keys"] if t not in sports.SPORT_LABEL]
        assert spec["type_keys"] and not unknown, f"{kind}: typeKeys {unknown} are not in sports.py"
    for (kind, prio), w in races.WINDOWS.items():
        assert kind in races.RACE_KINDS and prio in races.PRIORITIES, (kind, prio)
        assert set(w) <= set(races.WINDOW_KEYS) and not (w.get("taper") and prio != "A"), (kind, prio, w)
    for series, m in races.MARKS.items():
        assert m.get("label") and m.get("note"), f"{series}: a mark needs its label and its trademark note"
        for part in ("wordmark", "icon"):
            x = m.get(part)
            if x is not None:
                assert x.get("draw") in races.MARK_DRAW, f"{series}: {part} draw {x.get('draw')!r} is not mask or image"
                assert (races.MARKS_ROOT / x["file"]).is_file(), f"{series}: {x['file']} is not in app/web/public"
        assert all(re.fullmatch(r"#[0-9A-Fa-f]{6}", c) for c in m.get("colours") or []), f"{series}: colours are #RRGGBB"
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        assert races.load(athlete.Athlete("nobody", Path(tmp))) == []


def test_race_windows_are_keyed_on_kind_and_priority():
    """A B half gets its 3 easy and 5 recovery days and never the A race's taper: a table keyed on the
    kind alone could not tell them apart (CLAUDE.md #1). phase_on() counts calendar days next to race
    day, holds intensity back on an A race's first recovery days only, and where two races' windows
    meet it reports the race ahead first and keeps the other, which binds too, in `also`."""
    import races
    half = _race(id="half", date="2027-02-14")
    tri = _race(id="tri", kind="triathlon_70_3", priority="A", date="2027-06-27")
    assert races.windows_of(half) == {"easy_before": 3, "recovery_after": 5}
    assert races.windows_of(tri) == {"taper": 14, "recovery_after": 10, "no_intensity_after": 7}
    try:
        races.windows_of(_race(priority="A"))
        raise AssertionError("an A half with no windows of its own must not borrow another race's")
    except ValueError:
        pass
    assert races.windows_of(_race(priority="A", windows={"taper": 10, "recovery_after": 7}))["taper"] == 10

    def on(day, rs=(half, tri)):
        return races.phase_on(day, list(rs))
    days = ("2027-02-10", "2027-02-11", "2027-02-13", "2027-02-14", "2027-02-15", "2027-02-19", "2027-02-20")
    assert [on(d)["window"] for d in days] == ["build", "easy", "easy", "race", "recovery", "recovery", "build"]
    first = on("2027-02-11")
    assert (first["day"], first["of"], first["days_to"], first["from"], first["to"]) == (1, 3, 3, "2027-02-11", "2027-02-13")
    assert on("2027-02-15")["intensity"] is False and on("2027-02-15")["days_to"] == -1
    assert on("2027-02-20")["race"]["id"] == "tri" and on("2027-02-20")["days_to"] == 127
    assert [on(d)["window"] for d in ("2027-06-12", "2027-06-13", "2027-06-26")] == ["build", "taper", "taper"]
    assert [on(d)["intensity"] for d in ("2027-07-04", "2027-07-05", "2027-07-07")] == [False, True, True]
    assert on("2027-07-08")["window"] is None and on("2027-07-08")["race"] is None
    # Two races close together: the half's recovery meets the easy days before the next race.
    hyrox = _race(id="hyrox", kind="hyrox", date="2027-02-18")
    p = on("2027-02-16", (half, hyrox))
    assert (p["window"], p["race"]["id"]) == ("easy", "hyrox"), p
    assert [(h["window"], h["race"]["id"]) for h in p["also"]] == [("recovery", "half")], p["also"]
    assert on("2027-02-14", (_race(entry="dns"),))["window"] is None, "a race he will not start shapes no day"


def test_race_check_is_due_by_its_rules_only():
    """races.py check is what the daily runs, with no network, and the skill looks up only what it
    lists (docs/DESIGN.md (races) §2): a date never checked; checked over 30 days ago; within 21 days and not
    checked in 7; within 4 days and not checked since start times could appear; a past race with no
    result. Nothing else: most days it lists nothing."""
    import races
    today = dt.date(2026, 10, 15)

    def ago(n):
        return (today - dt.timedelta(days=n)).isoformat()

    def due(date, checked, **kw):
        v = {"status": "confirmed" if checked else "unconfirmed", "checked": checked}
        out = races.check([_race(date=date, verified=v, **kw)], today)
        return out[0]["due"] if out else None
    assert due(ago(-90), None) == "date"
    assert due(ago(-90), ago(30)) is None and due(ago(-90), ago(31)) == "date"
    assert due(ago(-20), ago(7)) is None and due(ago(-20), ago(8)) == "date"
    assert due(ago(-3), ago(1)) is None and due(ago(-3), ago(2)) == "date"   # start times, ~3 days out
    assert due(ago(1), ago(10)) == "result" and due(ago(1), ago(10), result={"time": "1:50:00"}) is None
    assert due(ago(1), ago(10), entry="dns") is None and due(ago(-10), None, entry="dns") is None


# --- docs/code lockstep -------------------------------------------------------
# The 2026-08-14 audit found CURRENT_ROUTINE.md carrying loads two versions stale and
# wrote "keep them in lockstep" into CLAUDE.md. Sixteen days later the 2026-08-30 audit
# found four bumped loads live in code and on Garmin but absent from the doc. An
# instruction that depends on remembering is not a control. This is.
def test_every_programmed_load_appears_in_current_routine():
    """TIGHTENED 2026-09-21 after the full audit — it used to grep the WHOLE document for the
    number, and passed while the D3 table quoted 155/67.5 for the leg press and hip thrust
    against a live 125/45. Every wrong value slipped through because the CORRECT one appeared
    somewhere else in the file: the per-machine section documents both machines on purpose, so
    a document-wide search can never distinguish "documented here" from "documented anywhere".
    Seven D3 rows were wrong, one row was dead and one live exercise was missing entirely, the
    day before a legs session. Now the load must appear on the exercise's OWN row.
    """
    import re
    if not A.routine_doc.exists():
        assert not bw.PROGRAM, f"{A.display} has a program but no CURRENT_ROUTINE.md to mirror it"
        return
    doc = A.routine_doc.read_text()
    rows = {}
    for line in doc.splitlines():
        m = re.match(r"\|\s*(D\d+E\d+[a-z]?)\s*\|", line)
        if m:
            rows.setdefault(m.group(1), []).append(line)
    missing, unrowed = [], []
    for day, spec in bw.PROGRAM.items():
        for ex in spec["exercises"]:
            exid, _es, _cat, name, _sets, _reps, w, _rest, kind = ex
            if not w or kind == "time":
                continue
            if exid not in rows:
                unrowed.append(f"{day}/{exid} {name}")
                continue
            if not any(re.search(rf"(?<![\d.]){w:g}(?![\d.])", r) for r in rows[exid]):
                missing.append(f"{day}/{exid} {name} @{w:g} — row says: {rows[exid][0][:110]}")
    assert not unrowed, (
        "prescribed exercises with NO row of their own in CURRENT_ROUTINE.md — the doc cannot "
        f"be read as the source of truth while these are absent: {unrowed}")
    assert not missing, (
        "loads live in program.py (and therefore on the watch) but NOT on that exercise's "
        f"own row in CURRENT_ROUTINE.md: {missing}")


def test_current_routine_has_no_rows_for_dead_exercises():
    """The D3 table carried a D3E7 leg-extension row, at a confidently-stated 75 kg, for an
    exercise that is not in PROGRAM at all. A dead row is worse than a missing one: it answers
    "what is his load" with a number nothing will ever put on his watch.
    """
    import re
    if not A.routine_doc.exists():
        return
    doc = A.routine_doc.read_text()
    live = {ex[0] for spec in bw.PROGRAM.values() for ex in spec["exercises"]}
    dead = []
    for line in doc.splitlines():
        m = re.match(r"\|\s*(D\d+E\d+[a-z]?)\s*\|", line)
        if m and m.group(1) not in live:
            dead.append(f"{m.group(1)}: {line[:100]}")
    assert not dead, (
        "CURRENT_ROUTINE.md has table rows for exercises no longer in PROGRAM. Strike them "
        f"through or delete them: {dead}")


def test_prescription_history_covers_every_prescription():
    """PRESCRIPTION_HISTORY.json is what lets the ceiling audit tell FRESH from STALE."""
    path = A.workouts_dir / "PRESCRIPTION_HISTORY.json"
    assert path.exists(), "PRESCRIPTION_HISTORY.json missing — run build_workouts.py"
    hist = json.loads(path.read_text())
    hist.pop("_meta", None)
    # 2026-09-21: keyed by day/exid. Pair-keying let two prescriptions of one catalog pair
    # overwrite each other on every build, resetting `since` and reporting both as FRESH
    # forever — the audit's whole FRESH/STALE distinction, silently defeated.
    # Over prescriptions(), the CORE BLOCK included (2026-11-01). Keyed on PROGRAM[day]["exercises"]
    # this test was the fourth place that could not see LEAD, so it certified a history file holding
    # 36 keys and not one core id as "covers every prescription" while his core-progression rule sat
    # dead for three weeks. `e[6]` is dropped with it: a bodyweight ask has no load and still needs a
    # since-date, or it can never be told FRESH from STALE either.
    missing = [f"{day}/{e[0]}" for day, e, _ in bw.prescriptions()
               if f"{day}/{e[0]}" not in hist]
    assert not missing, (f"prescriptions with no recorded since-date: {missing} — "
                         "run build_workouts.py for this athlete")
    for k, v in hist.items():
        assert "/" in k and not k.isupper(), (
            f"PRESCRIPTION_HISTORY key {k!r} looks pair-keyed. It must be day/exerciseId, or two "
            "prescriptions sharing one catalog pair will overwrite each other every build.")


# --------------------------------------------------------------------------- #
# attempts at a prescription — the 2026-10-04 audit, P1-1 / P1-2 / P1-3 / P2-1 / P2-2
# --------------------------------------------------------------------------- #

def _sess(day, start, sets, sid=1):
    import strength_sessions as ss
    return ss.Session(sid, start[:10], start, f"{day} workout", day, sets)


_SHARED = {("BENCH_PRESS", "BARBELL_BENCH_PRESS"): {"d1", "d4"}}


def test_audit_matches_a_shared_pair_to_its_own_day():
    """Bench is D1 @80 and D4 @70. Matched by catalog pair, D1 was credited with D4's 50 and 70
    and D4 with D1's 80s — and D5's never-trained calf raise read "ok" off D3's sessions."""
    key = ("BENCH_PRESS", "BARBELL_BENCH_PRESS")
    sessions = [_sess("d1", "2026-09-20 17:00:00", [_set(*key, 80, 8)], 1),
                _sess("d4", "2026-09-23 07:00:00", [_set(*key, 50, 12)], 2),
                _sess("d4", "2026-09-29 18:00:00", [_set(*key, 70, 12)], 3),
                _sess(None, "2026-09-30 18:00:00", [_set(*key, 75, 10)], 4)]
    d1, amb = audit.attempts("d1", key, 80, 8, "", sessions, _SHARED, annotations={})
    d4, _ = audit.attempts("d4", key, 70, 10, "", sessions, _SHARED, annotations={})
    assert [d for d, *_ in d1] == ["2026-09-20"], d1
    assert [d for d, *_ in d4] == ["2026-09-23", "2026-09-29"], d4
    assert amb == ["2026-09-30"], "an unattributable shared-pair set must be reported, not credited"


def test_audit_ignores_the_session_that_caused_the_bump():
    """The 09-29 18:41 D4 session triggered the 20:32 shrug bump. Counting it as the first attempt
    at the new ask put four lifts one miss away from a push-blocking STALE."""
    key = ("SHRUG", "DUMBBELL_SHRUG")
    owners = {key: {"d4"}}
    sessions = [_sess("d4", "2026-09-29 18:41:09", [_set(*key, 60, 15)])]
    got, _ = audit.attempts("d4", key, 32, 13, "2026-09-29 20:32:00", sessions, owners, annotations={})
    assert got == [], "a session that started before the ask was set is not an attempt at it"
    legacy = audit.since_ts({"since": "2026-09-29"})
    got, _ = audit.attempts("d4", key, 32, 13, legacy, sessions, owners, annotations={})
    assert got == [], "a date-only history entry must not count its own day's session either"


def test_audit_met_needs_reps_inside_the_range():
    """Load-only, any set at 80 'met' a 4x10 @80 ask, so bench could never go STALE. Reps inside
    the range (bottom = top-2) are met; below the bottom is a miss."""
    key = ("BENCH_PRESS", "BARBELL_BENCH_PRESS")
    owners = {key: {"d1"}}
    bottom = audit.range_bottom(10, "reps")
    assert bottom == 8 and audit.range_bottom(10, "fixed") == 10
    in_range = [_sess("d1", "2026-10-01 18:00:00", [_set(*key, 80, 8)])]
    below = [_sess("d1", "2026-10-01 18:00:00", [_set(*key, 80, 6), _set(*key, 70, 10)])]
    assert audit.attempts("d1", key, 80, bottom, "", in_range, owners, annotations={})[0][0][2]
    assert not audit.attempts("d1", key, 80, bottom, "", below, owners, annotations={})[0][0][2]


def test_audit_skips_annotated_sessions():
    """10-01's lateral raise at 10/arm was a full gym, annotated as such — not a miss at 12."""
    key = ("LATERAL_RAISE", "DUMBBELL_LATERAL_RAISE")
    sessions = [_sess("d1", "2026-10-01 18:16:00", [_set(*key, 20, 17)])]
    ann = {"2026-10-01": {"type": "backoff", "exercises": [list(key)]}}
    got, _ = audit.attempts("d1", key, 12, 15, "", sessions, {key: {"d1"}}, annotations=ann)
    assert got == []


# Rows shaped like a real 11-03 session: lap pressed through two steps to reach the calves.
_TAP_HIP = {"setType": "ACTIVE", "weight": 55000.0, "repetitionCount": None, "duration": 16.7,
            "exercises": [{"category": "HIP_RAISE", "name": "BARBELL_HIP_THRUST_WITH_BENCH"}]}
_TAP_CURL = {"setType": "ACTIVE", "weight": 40000.0, "repetitionCount": None, "duration": 8.5,
             "exercises": [{"category": "LEG_CURL", "name": "WEIGHTED_LEG_CURL"}]}


def test_audit_does_not_count_a_tapped_through_set():
    """2026-11-08 audit, P1-1. "Reps OR duration" counted 11-03's 17 s rep-less hip thrust as a failed
    attempt at 4x12 @55 — half of a push-blocking STALE on a lift he never tried. A rep ask needs reps;
    a hold needs at least half its ask."""
    key = ("HIP_RAISE", "BARBELL_HIP_THRUST_WITH_BENCH")
    tap = [_sess("d3", "2026-11-03 19:00:00", [_TAP_HIP])]
    got, _ = audit.attempts("d3", key, 55, 10, "", tap, {key: {"d3"}}, annotations={})
    assert got == [], f"a tapped-through set is not an attempt: {got}"
    real = [_sess("d3", "2026-11-03 19:00:00", [_set(*key, 55, 9)])]
    got, _ = audit.attempts("d3", key, 55, 10, "", real, {key: {"d3"}}, annotations={})
    assert got == [("2026-11-03", 55.0, False)], got
    plank = ("PLANK", "WEIGHTED_PLANK")
    blip = [_sess("d1", "2026-11-07 17:00:00", [_hold(*plank, 12, 6)])]
    held = [_sess("d1", "2026-11-07 17:00:00", [_hold(*plank, 12, 25)])]
    assert audit.attempts("d1", plank, 12, 40, "", blip, {plank: {"d1"}}, annotations={}, secs=True)[0] == []
    assert audit.attempts("d1", plank, 12, 40, "", held, {plank: {"d1"}}, annotations={}, secs=True)[0], (
        "a real hold short of the ask is a miss, and it must still count as an attempt")


def test_weekly_volume_does_not_count_a_tapped_through_set():
    """2026-11-08 audit, P1-1: the same two taps made Hams/Glutes read 2 sets when the truth was 0."""
    import export_dashboard_data as ed
    hip = ("HIP_RAISE", "BARBELL_HIP_THRUST_WITH_BENCH")
    saved = ed.REP_ONLY
    try:
        ed.REP_ONLY = {hip, ("LEG_CURL", "WEIGHTED_LEG_CURL")}
        assert not ed.is_logged_work(_TAP_HIP) and not ed.is_logged_work(_TAP_CURL)
        assert ed.is_logged_work(_set(*hip, 55, 12))
        assert ed.is_logged_work(_hold("PLANK", "WEIGHTED_PLANK", 12, 40)), "a hold has no reps by nature"
        assert ed.is_logged_work(_hold("SLED", "PUSH", 0, 20)), "a pair the program does not ask in reps keeps reps-or-time"
    finally:
        ed.REP_ONLY = saved


def test_audit_says_skipped_when_its_day_runs_without_it():
    """2026-11-08 audit, P1-2. D4E3's DB curl read FRESH ("not tried yet") from 09-29 to 11-08 while D4
    ran three times without it — the last slot, cut for time — and biceps got 7 sets in four weeks.
    Not a skip: a session annotated for it (done on another implement), a variant that drops it by
    design, a session before the ask."""
    key = ("CURL", "DUMBBELL_BICEPS_CURL")
    other = [_set("SHOULDER_PRESS", "SMITH_MACHINE_OVERHEAD_PRESS", 60, 12)]
    sessions = [_sess("d4", "2026-09-29 18:00:00", other, 1),                     # before the ask
                _sess("d4", "2026-10-09 18:00:00", other, 2),
                _sess("d4", "2026-10-18 18:00:00", other + [_set(*key, 44, 12)], 3),  # annotated
                _sess("d4", "2026-10-26 18:00:00", other, 4),
                _sess("d4", "2026-11-05 18:00:00", other + [{**_TAP_CURL, "exercises": [{"category": "CURL", "name": "DUMBBELL_BICEPS_CURL"}]}], 5),
                _sess("d1", "2026-11-07 18:00:00", other, 6)]                    # another day
    corto = ss_variant = _sess("d4", "2026-11-06 07:00:00", other, 7)
    corto.name = "Gym · Shoulders (corto)"
    ann = {"2026-10-18": {"type": "data_error", "exercises": [list(key)]}}
    got = audit.skipped_chances("d4", key, 0, "2026-09-29 20:32:00", sessions + [ss_variant],
                                annotations=ann, variant_names={"Gym · Shoulders (corto)"})
    assert got == ["2026-10-09", "2026-10-26", "2026-11-05"], got


def test_bump_signals_do_not_refire_on_an_applied_bump():
    """Incline @30 was set on 10-03 from the 10-01 session; the report kept saying "bump", which
    an agent that skipped the prose note would have turned into 32. And a shared pair is judged
    against its own day's target, never a merged one neither day prescribes."""
    import progression_report as pr
    key = ("BENCH_PRESS", "BARBELL_BENCH_PRESS")
    prog = {"d1": {"exercises": [("D1E1", "", *key, 2, 10, 80, 90, "reps")]},
            "d4": {"exercises": [("D4E2", "", *key, 2, 12, 70, 90, "reps")]}}
    d4_hit = [_sess("d4", "2026-09-29 18:00:00", [_set(*key, 70, 12), _set(*key, 70, 12)])]
    fresh = {"d4/D4E2": {"since": "2026-09-16"}}
    got = pr.bump_signals(d4_hit, fresh, _SHARED, prog)
    assert len(got) == 1 and got[0].startswith("D4E2"), got
    applied = {"d4/D4E2": {"since": "2026-09-29", "since_ts": "2026-09-29 20:32:00"}}
    assert pr.bump_signals(d4_hit, applied, _SHARED, prog) == []


# --------------------------------------------------------------------------- #
# the core block is a prescription too — found 2026-11-01
# --------------------------------------------------------------------------- #

def test_the_core_block_is_among_the_programs_prescriptions():
    """Every core-block row reaches build_workouts.prescriptions(), keyed by day, labelled "core".

    THE BUG THIS PINS SHUT. Five readers of the program iterated PROGRAM[day]["exercises"] alone —
    progression_report.bump_rows, prescription_audit.audit, strength_sessions.pair_days,
    build_workouts.update_prescription_history and two tests in this file. The core block lives in
    program.py's LEAD, so none of them could see it: an athlete's own core-progression rule (v8.4,
    from "core is getting very simple and each day is the same") was met on seven slots over three
    weeks and not one ask ever moved, because no instrument could report it. PRESCRIPTION_HISTORY
    held 36 keys and not a single core id.
    """
    # No assertion that the program is non-empty: a freshly scaffolded athlete has PROGRAM = {}
    # until their intake writes one (new_athlete.py), and every check below is then vacuously true.
    rows = list(bw.prescriptions())
    for day_key, spec in bw.LEAD.items():
        if day_key not in bw.PROGRAM:
            continue
        for ex in spec["block"]:
            assert (day_key, ex, "core") in rows, (
                f"{day_key}/{ex[0]} {ex[2]}/{ex[3]} is in LEAD but not in prescriptions() — the "
                "core block is invisible to the audit, the bump signals and the history again")
    for day_key, ex, block in rows:
        assert block in ("core", "main"), (day_key, ex[0], block)

    # Day-scoped keys, and that is load-bearing: the SAME core id means a DIFFERENT exercise in a
    # different block (C1 is the kneeling ab wheel in one and the weighted side plank in another).
    keys = [f"{d}/{e[0]}" for d, e, _ in rows]
    assert len(keys) == len(set(keys)), (
        f"duplicate day/id keys: {sorted(k for k in keys if keys.count(k) > 1)}")
    by_id: dict = {}
    for day_key, ex, block in rows:
        by_id.setdefault(ex[0], set()).add((ex[2], ex[3]))
    reused = {i: v for i, v in by_id.items() if len(v) > 1}
    assert all("/" in f"{d}/{e[0]}" for d, e, _ in rows), "keys must stay day-scoped"
    if reused:   # fine, and exactly why nothing may key on the bare id
        assert all(k.count("/") == 1 for k in keys)


def test_a_core_bump_needs_two_clean_sessions_running():
    """His core rule is "the top of its range on every set, TWO SESSIONS RUNNING" — a main lift's
    is one (memory/preference/core-must-progress.md, v8.4).

    The fixture is the real 2026-11-01 call, which is why the numbers are his: the D1 ab wheel had
    3x12 clean on 10-23 and 10-30 and earned the step, the D2 pull-through had met 3x10 @12 once,
    on 10-25, and was HELD. Fire the core rule off one session and that hold becomes a bump.
    """
    import progression_report as pr
    import strength_sessions as ss
    wheel = ("C1", "", "CORE", "KNEELING_AB_WHEEL", 3, 12, None, 45, "reps")
    pull = ("C9", "", "SANDBAG", "PLANK_PULL_THROUGH", 3, 10, 12, 45, "reps_per_side")
    prog = {"d1": {"exercises": []}, "d2": {"exercises": []}}
    lead = {"d1": {"block": [wheel]}, "d2": {"block": [pull]}}
    # pair_days over the fixture's own core blocks: it has to see LEAD too, or every shared core
    # pair looks unique and counts_for() credits one day's session to another day's prescription.
    owners = ss.pair_days(prog, lead)
    assert owners == {("CORE", "KNEELING_AB_WHEEL"): {"d1"},
                      ("SANDBAG", "PLANK_PULL_THROUGH"): {"d2"}}, owners
    hist = {"d1/C1": {"since": "2026-10-18", "since_ts": "2026-10-18 00:00:00"},
            "d2/C9": {"since": "2026-10-18", "since_ts": "2026-10-18 00:00:00"}}
    three = [_set("CORE", "KNEELING_AB_WHEEL", 0, 12) for _ in range(3)]
    # 3 rounds per side reach the watch as 6 logged sets (the 2026-09-01 per-side fix).
    six = [_set("SANDBAG", "PLANK_PULL_THROUGH", 12, 10) for _ in range(6)]
    sessions = [_sess("d1", "2026-10-23 17:00:00", three, 1),
                _sess("d2", "2026-10-25 11:00:00", six, 2),
                _sess("d1", "2026-10-30 16:52:00", three, 3)]
    got = {b["exid"]: b for b in pr.bump_rows(sessions, hist, owners, prog, lead)}
    assert "C1" in got, "two clean sessions at the top of the range earn the step"
    assert got["C1"]["increment"] == "+2 reps", got["C1"]["increment"]
    assert "C9" not in got, "one clean session is not two — this is the hold that was made by hand"
    # A second clean session and it fires, with the plate as the step, not reps.
    sessions.append(_sess("d2", "2026-11-09 11:00:00", six, 4))
    got = {b["exid"]: b for b in pr.bump_rows(sessions, hist, owners, prog, lead)}
    assert "C9" in got and got["C9"]["increment"].startswith("+2kg"), got.get("C9")
    # And a MAIN lift still needs only one, which is the rule this function was written for.
    main = {"d1": {"exercises": [("D1E1", "", "CORE", "KNEELING_AB_WHEEL", 3, 12, None, 45, "reps")]}}
    one = [_sess("d1", "2026-10-30 16:52:00", three, 3)]
    assert pr.bump_rows(one, {"d1/D1E1": {"since": "2026-10-18"}}, owners, main), "main lifts: one"


def test_a_bump_needs_every_planned_set_at_the_load():
    """The real 2026-11-02: D2E9 asked 3x12 @40 and he rowed 30, 40, 40 x12. bump_rows compared
    only the TOP set's load to the plan, so two working sets read as three and fired `+weight`.
    A lighter set in front of the full three is a warm-up and must not cost him the step."""
    import progression_report as pr
    key = ("ROW", "SEATED_CABLE_ROW")
    prog = {"d2": {"exercises": [("D2E9", "", *key, 3, 12, 40, 90, "reps")]}}
    owners = {key: {"d2"}}
    hist = {"d2/D2E9": {"since_ts": "2026-10-26 00:00:00"}}
    two = [_sess("d2", "2026-11-02 07:16:00", [_set(*key, w, 12) for w in (30, 40, 40)])]
    assert pr.bump_rows(two, hist, owners, prog) == [], "two sets at the load are not three"
    three = [_sess("d2", "2026-11-02 07:16:00", [_set(*key, w, 12) for w in (30, 40, 40, 40)])]
    got = pr.bump_rows(three, hist, owners, prog)
    assert [b["exid"] for b in got] == ["D2E9"], "a warm-up before three at the load still earns it"
    assert got[0]["sets_done"] == 4 and got[0]["weight"] == 40, got[0]


def test_a_bump_signal_reads_a_hold_in_seconds():
    """A plank's ask is a DURATION, and a per-side one logs each side as its own set.

    bump_rows only understood "reps" and "fixed" until 2026-11-01, so every timed prescription was
    invisible — the whole core block's planks, and the D2 farmers carry. Two traps live here: a
    timed set carries `duration` and NO repetitionCount, and a pure bodyweight hold carries no
    weight at all (not 0.0), which is what dropped the D3 side plank from the audit.
    """
    import progression_report as pr
    plank = ("C7", "", "PLANK", "WEIGHTED_PLANK", 3, 40, 10, 30, "time")
    side = ("C1", "", "PLANK", "SIDE_PLANK", 2, 40, None, 50, "time_per_side")
    prog = {"d1": {"exercises": []}, "d3": {"exercises": []}}
    lead = {"d1": {"block": [plank]}, "d3": {"block": [side]}}
    owners = {("PLANK", "WEIGHTED_PLANK"): {"d1"}, ("PLANK", "SIDE_PLANK"): {"d3"}}
    hist = {"d1/C7": {"since_ts": "2026-10-18 00:00:00"}, "d3/C3": {"since_ts": "2026-10-18 00:00:00"},
            "d3/C1": {"since_ts": "2026-10-18 00:00:00"}}
    held = [_hold("PLANK", "WEIGHTED_PLANK", 10, 40) for _ in range(3)]
    full = [_hold("PLANK", "SIDE_PLANK", 0, 40) for _ in range(4)]      # 2 rounds x 2 sides
    short = [_hold("PLANK", "SIDE_PLANK", 0, 40)] * 3 + [_hold("PLANK", "SIDE_PLANK", 0, 21)]
    ok = [_sess("d1", "2026-10-23 17:00:00", held, 1), _sess("d1", "2026-10-30 16:52:00", held, 2)]
    got = {b["exid"]: b for b in pr.bump_rows(ok, hist, owners, prog, lead)}
    assert "C7" in got and got["C7"]["increment"].startswith("+2kg"), got
    assert got["C7"]["sets_done"] == 3, got["C7"]["sets_done"]
    # The real 10-27: three sides at 40 s and a fourth at 21. Every set, or it is not the ask.
    cut = [_sess("d3", "2026-10-20 18:00:00", full, 3), _sess("d3", "2026-10-27 18:00:00", short, 4)]
    assert not [b for b in pr.bump_rows(cut, hist, owners, prog, lead) if b["exid"] == "C1"], (
        "a hold that fell short on the last side is not the top of the range on every set")
    both = [_sess("d3", "2026-10-20 18:00:00", full, 3), _sess("d3", "2026-10-27 18:00:00", full, 4)]
    got = {b["exid"]: b for b in pr.bump_rows(both, hist, owners, prog, lead)}
    assert "C1" in got and got["C1"]["increment"] == "+5s", got.get("C1")
    # An unloaded timed MAIN lift is a conditioning dose: a sprint that hits its clock is not a bump.
    sprint = {"d3": {"exercises": [("D3E12", "", "SPRINT", "SPRINT", 2, 10, None, 60, "time")]}}
    runs = [_sess("d3", d, [_hold("SPRINT", "SPRINT", 0, 10) for _ in range(2)], i)
            for i, d in enumerate(("2026-10-20 18:00:00", "2026-10-27 18:00:00"), 5)]
    assert pr.bump_rows(runs, {"d3/D3E12": {"since_ts": "2026-10-18 00:00:00"}},
                        {("SPRINT", "SPRINT"): {"d3"}}, sprint) == [], "sprints are not bumped"


def test_a_swapped_exercise_starts_a_clean_history():
    """09-29: the EZ french press became the rope pressdown under D4E8 at the same 30 kg and the
    rope inherited the old lift's `since` and changes. A new lift is a new prescription."""
    ex = ("D4E8", "", "TRICEPS_EXTENSION", "ROPE_PRESSDOWN", 4, 14, 30, 75, "reps")
    prev = {"cat": "TRICEPS_EXTENSION", "name": "EZ_BAR_FRENCH_PRESS", "weight": 30, "reps": 14,
            "since": "2026-08-01", "changes": [{"date": "2026-08-01", "from": 25, "to": 30}]}
    new = bw.next_history_entry(prev, "d4_upper", ex, "2026-09-29", "2026-09-29 20:35:00")
    assert new["since"] == "2026-09-29" and new["since_ts"] == "2026-09-29 20:35:00"
    assert new["changes"] == [], "a swap must not inherit another lift's history"
    same = bw.next_history_entry({**prev, "name": "ROPE_PRESSDOWN"}, "d4_upper", ex,
                                 "2026-10-04", "2026-10-04 09:00:00")
    assert same["since"] == "2026-08-01", "an unchanged ask must keep its since"


def test_a_stale_cache_is_flagged():
    """10-04: every check was green on a cache pulled at 12:31 on 10-03, before the 17:29 legs
    session — and rotation_status called D3 STARVED the day after he trained it."""
    import datetime as dt
    import strength_sessions as ss
    sched = [{"date": "2026-10-03", "title": "D3 · Legs", "sportTypeKey": "strength_training"},
             {"date": "2026-10-02", "title": "skipped", "sportTypeKey": "strength_training"}]
    got = ss.unseen_scheduled(dt.datetime(2026, 10, 3, 12, 31), {"2026-10-01"}, sched,
                              dt.date(2026, 10, 4))
    assert len(got) == 1 and "D3" in got[0], got
    assert ss.unseen_scheduled(dt.datetime(2026, 10, 4, 9, 0), {"2026-10-03"}, sched,
                               dt.date(2026, 10, 4)) == []


def test_a_backfill_does_not_make_the_cache_look_fresh():
    """cache_status took "pulled" from the newest activities_*.json by mtime, whatever window it covers. A backfill
    (--start/--end 2025-06-01, one race day) writes one too, so a backfill run the morning after a 12:31 refresh made
    the cache look pulled just then, and D3 on 10-03, trained at 17:29 and not in the cache, went unflagged: the 10-04
    check, silenced for every day the backfill never saw. Only a pull whose window reached the day it ran can say how
    fresh the cache is. Found by reading the code on 2026-10-16."""
    import tempfile
    import strength_sessions as ss
    d1 = {"activityId": 1, "startTimeLocal": "2026-10-01 18:00:00", "activityType": {"typeKey": "strength_training"}}
    d3 = {**d1, "activityId": 3, "startTimeLocal": "2026-10-03 17:29:00"}
    sched = [{"date": "2026-10-03", "title": "D3 · Legs", "sportTypeKey": "strength_training"}]

    def status(*files):
        """cache_status on 10-04 over that calendar and a cache of (name, activities, mtime) files."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "scheduled.json").write_text(json.dumps(sched))
            for name, acts, when in files:
                (tmp / name).write_text(json.dumps(acts))
                t = dt.datetime(*when).timestamp()
                os.utime(tmp / name, (t, t))
            saved, ss.DATA = ss.DATA, tmp
            try:
                return ss.cache_status(dt.date(2026, 10, 4))
            finally:
                ss.DATA = saved

    refresh = ("activities_2026-09-04_2026-10-03.json", [d1], (2026, 10, 3, 12, 31))
    backfill = ("activities_2025-06-01_2025-06-01.json", [], (2026, 10, 4, 9, 0))
    as_of, warnings = status(refresh, backfill)
    assert as_of == "cache as of 2026-10-03 12:31" and warnings and "D3" in warnings[0], (
        f"a backfill made a stale cache look fresh: {as_of!r}, {warnings}")
    refreshed = ("activities_2026-09-05_2026-10-04.json", [d3, d1], (2026, 10, 4, 9, 5))
    assert status(refresh, backfill, refreshed) == ("cache as of 2026-10-04 09:05", []), "a refresh must clear it"
    assert status(backfill)[1], "a cache of backfills alone vouches for no day"


def test_every_weighted_lift_has_a_logging_class():
    """A two-dumbbell lift missing from two_db_weight_summed is invisible to the per-arm and gym-cap
    tests, which build their list FROM that rule: D5's hammer curl (16/arm) would have been read as
    32/arm. Opt-in per athlete via LOGGING_RULES.logged_as_is; once declared, every weighted
    PROGRAM pair must sit in exactly one weight class."""
    if "logged_as_is" not in RULES:
        return
    classes = {b: {tuple(x) for x in RULES.get(b, [])}
               for b in ("two_db_weight_summed", "machine_added_load_only", "logged_as_is")}
    bad = []
    for day_key, day in bw.PROGRAM.items():
        for ex in day["exercises"]:
            if ex[6] is None:
                continue
            hits = [b for b, pairs in classes.items() if (ex[2], ex[3]) in pairs]
            if len(hits) != 1:
                bad.append(f"{day_key}/{ex[0]} {ex[2]}/{ex[3]} in {hits or 'no class'}")
    assert not bad, f"weighted lifts without exactly one logging class: {bad}"


def test_per_side_exercises_pair_both_sides_in_one_group():
    """A per-side exercise must be ONE repeat group containing both sides plus one rest.

    Reported twice by the athlete. v1 was a single SIDE_PLANK block labelled "30 s each side",
    which the watch counts once — the second side was never recorded. v2 split it into two
    separate blocks, giving "(hold - rest) x2" twice, which lets him do every set of one side
    before starting the other. What he asked for, and what this pins, is
    "(right - left - rest) x2": sides paired, one rest, after both.
    """
    import build_workouts as b
    for day_key in b.PROGRAM:
        wo = b.build_day(day_key, b.PROGRAM[day_key])
        for step in wo["workoutSegments"][0]["workoutSteps"]:
            if step.get("type") != "RepeatGroupDTO":
                continue
            work = [s for s in step["workoutSteps"]
                    if (s.get("stepType") or {}).get("stepTypeKey") == "interval"]
            rest = [s for s in step["workoutSteps"]
                    if (s.get("stepType") or {}).get("stepTypeKey") == "rest"]
            if len(work) == 1:
                continue
            assert len(work) == 2 and len(rest) == 1, (
                f"{day_key}: per-side group has {len(work)} work steps and {len(rest)} rests")
            assert work[0]["exerciseName"] == work[1]["exerciseName"], (
                f"{day_key}: paired group mixes exercises")
            sides = [(s.get("description") or "").upper() for s in work]
            right, left = (label.upper() for label in b.SIDE_LABELS)
            assert any(right in s for s in sides) and any(left in s for s in sides), (
                f"{day_key}: paired group does not label both sides — got {sides}")


def test_side_plank_is_prescribed_per_side():
    # 2026-09-15: matched only the exact name "SIDE_PLANK", so WEIGHTED_SIDE_PLANK would
    # have slipped through and counted one side. Any variant now has to be per-side — for every
    # athlete, wherever it is prescribed. (Whether a side plank is prescribed at all is an
    # athlete's own rule; it lives in that athlete's own tests.py.)
    everywhere = b_core() + [ex for day in bw.PROGRAM.values() for ex in day["exercises"]]
    for ex in everywhere:
        if "SIDE_PLANK" in ex[3]:
            assert ex[8].endswith("_per_side"), (
                f"{ex[0]} {ex[3]} must use a *_per_side kind, or only one side gets counted")






def test_same_exercise_has_the_same_load_on_every_day():
    """Caught 2026-09-01: seated calf was bumped 135 -> 140 in D3 and left at 135 in D5.

    The bump edit used a single-occurrence replace, so the second day silently kept the old
    number and he would have got two different prescriptions for one movement depending on
    which day came round. Nothing was checking.
    """
    seen: dict = {}
    for day_key, ex, block in bw.prescriptions():
        exid, _, cat, name, sets, value, weight, _, _ = ex
        key = (cat, name)
        if key in bw.SPLIT_LOAD_ALLOWED:
            continue
        if key in seen:
            prev_day, prev_id, prev_w, prev_v, prev_block = seen[key]
            # The CORE BLOCK joined this check on 2026-11-01 — it was the fifth reader that could
            # not see LEAD, and the weighted side plank is on two days, so a plate bumped on D4 and
            # forgotten on D2 was exactly the 09-01 seated-calf bug waiting to happen again.
            # For core, only the LOAD is coupled: the DOSE is each block's own and differs on
            # purpose (the side plank holds 30 s inside D2's block and 35 s inside D4's).
            core = "core" in (block, prev_block)
            got, want = ((weight,), (prev_w,)) if core else ((weight, value), (prev_w, prev_v))
            assert got == want, (
                f"{cat}/{name} is prescribed {prev_w}x{prev_v} in {prev_day}/{prev_id} but "
                f"{weight}x{value} in {day_key}/{exid} — a bump applied to one day did not "
                f"reach the other")
        else:
            seen[key] = (day_key, exid, weight, value, block)


# --- memory system ------------------------------------------------------------
# The memory/ directory is the shared substrate for agents: one durable fact per file,
# frontmatter-typed. These three tests exist because a memory system that can drift is
# worse than none — an agent would load a stale fact and act on it with full confidence.

def _memory_roots():
    """Engine memory (true for every athlete) and this athlete's own."""
    return [ROOT / "memory", A.memory_dir]


def _memory_files():
    return sorted(p for mem in _memory_roots() if mem.is_dir()
                  for p in mem.rglob("*.md") if p.name != "INDEX.md")


def _frontmatter(path):
    return frontmatter(path)


def test_memory_index_is_in_sync_with_the_files():
    """The index is generated. If it has drifted, an agent reading it is reading fiction."""
    indexes = [mem / "INDEX.md" for mem in _memory_roots() if mem.is_dir()]
    before = {i: (i.read_text() if i.exists() else "") for i in indexes}
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_memory_index.py")],
                   capture_output=True, check=True)
    stale = [str(i.relative_to(ROOT)) for i in indexes if i.read_text() != before[i]]
    assert not stale, (
        f"{stale} were stale — scripts/build_memory_index.py has now rebuilt them; commit the result")


def test_every_memory_file_is_typed_and_dated():
    valid = {"medical", "athlete", "equipment", "convention", "preference", "incident"}
    for p in _memory_files():
        fm = _frontmatter(p)
        assert fm.get("type") in valid, f"{p.name}: type must be one of {sorted(valid)}"
        assert fm.get("status"), f"{p.name}: missing status"
        assert fm.get("since"), f"{p.name}: missing since"
        assert fm.get("source"), f"{p.name}: missing source — a fact with no provenance is a rumour"


def test_active_medical_facts_name_a_real_enforcing_test():
    """A medical constraint must be backed by an assertion, and that assertion must exist.

    Prose can be missed by an agent that never opened the file. A dangling `enforced_by` is
    worse than none, because it looks like protection.
    """
    own_tests = f"athletes/{A.name}/tests.py"
    for p in _memory_files():
        fm = _frontmatter(p)
        if fm.get("type") != "medical" or fm.get("status") != "active":
            continue
        refs = [fm.get("enforced_by", "")] + list(fm.get("also_enforced_by", []) or [])
        refs = [r for r in refs if r and not str(r).startswith("none")]
        assert refs, f"{p.name}: an active medical fact must name an enforced_by"
        for ref in refs:
            if "::" not in ref:
                continue
            file, _, fn = ref.partition("::")
            src = ROOT / file
            assert src.is_file() and f"def {fn}(" in src.read_text(), (
                f"{p.name}: enforced_by names {ref}, which does not exist")
        # Multi-athlete (2026-09-24): an athlete's medical constraint is enforced by THAT
        # athlete's own tests — never by the engine's, never by someone else's.
        if p.is_relative_to(A.memory_dir):
            assert any(r.startswith(own_tests + "::") for r in refs), (
                f"{p.name}: an active medical fact about {A.display} must be enforced by a test "
                f"in {own_tests}")


def test_every_skill_and_agent_referenced_in_docs_exists():
    """A workflow that names a skill which is not there fails silently and confusingly.

    CLAUDE.md and WORKFLOW.md are the entry points; the skills cross-reference each other
    and the agents. All of it has to resolve.
    """
    import re
    skills = {p.parent.name for p in (ROOT / ".claude" / "skills").glob("*/SKILL.md")}
    agents = {p.stem for p in (ROOT / ".claude" / "agents").glob("*.md")}
    sources = [ROOT / "CLAUDE.md", ROOT / "WORKFLOW.md"]
    sources += list((ROOT / ".claude" / "skills").glob("*/SKILL.md"))
    for src in sources:
        text = src.read_text()
        for named in set(re.findall(r"[/`](osc-[a-z-]+)", text)):
            assert named in skills, f"{src.name} references skill {named}, which does not exist"
        for named in set(re.findall(r"`(execution-reviewer|insight-agent|integrity-auditor)`", text)):
            assert named in agents, f"{src.name} references agent {named}, which does not exist"


def test_every_skill_has_a_name_and_description():
    """Frontmatter drives both discovery and invocation. A skill without a description
    will not be matched from natural language."""
    for path in (ROOT / ".claude" / "skills").glob("*/SKILL.md"):
        head = path.read_text()[:800]
        assert head.startswith("---\n"), f"{path.parent.name}: missing frontmatter"
        assert "\nname:" in head, f"{path.parent.name}: missing name"
        assert "\ndescription:" in head, f"{path.parent.name}: missing description"
        name = [l for l in head.splitlines() if l.startswith("name:")][0].split(":", 1)[1].strip()
        assert name == path.parent.name, (
            f"{path.parent.name}: frontmatter name is {name!r} — must match the directory")


# --- calendar window & protected ids ------------------------------------------
# 2026-09-24: sync_workouts and reschedule_workout read the calendar from a hardcoded
# `2026, months 8-10`. From 1 November, sync would have deleted a superseded workout
# without re-pointing its November calendar entry — the session silently gone from the
# watch — and reschedule could not see November at all. delete_workout, the one script
# whose job is deleting, never checked the protected ids.

def test_calendar_window_rolls_over_the_year():
    import datetime as _dt
    from garmin_client import calendar_window
    assert calendar_window(_dt.date(2026, 10, 31)) == [(2026, 9), (2026, 10), (2026, 11), (2026, 12)]
    assert calendar_window(_dt.date(2026, 12, 15)) == [(2026, 11), (2026, 12), (2027, 1), (2027, 2)]
    assert calendar_window(_dt.date(2027, 1, 1)) == [(2026, 12), (2027, 1), (2027, 2), (2027, 3)]


def test_calendar_reads_cover_the_window_and_dedupe_by_schedule_id():
    import datetime as _dt
    import garmin_client
    calls = []

    class FakeClient:
        def get_scheduled_workouts(self, year, month):
            calls.append((year, month))
            # the same entry spills into two month views, plus one non-workout item
            return {"calendarItems": [
                {"itemType": "workout", "id": 7, "workoutId": 70, "date": "2026-11-30"},
                {"itemType": "activity", "id": 8, "workoutId": 80, "date": "2026-11-29"},
            ]}

    saved = garmin_client.THROTTLE_SECONDS
    garmin_client.THROTTLE_SECONDS = 0
    try:
        items = garmin_client.read_scheduled_workouts(FakeClient(), _dt.date(2026, 11, 2))
    finally:
        garmin_client.THROTTLE_SECONDS = saved
    assert calls == garmin_client.calendar_window(_dt.date(2026, 11, 2)), calls
    assert [i["id"] for i in items] == [7], "must dedupe by schedule id and keep workouts only"


def test_no_script_hardcodes_a_calendar_year():
    import re
    offenders = [p.name for p in (ROOT / "scripts").glob("*.py")
                 if re.search(r"get_scheduled_workouts\(\s*\d{4}", p.read_text())]
    assert not offenders, f"hardcoded calendar year in {offenders} — use read_scheduled_workouts"


def test_delete_refuses_protected_ids_before_connecting():
    import types
    delete = _load("delete_workout", ROOT / "scripts" / "delete_workout.py")

    def must_not_connect():
        raise AssertionError("delete_workout connected to Garmin before refusing a protected id")

    delete.get_client = must_not_connect
    delete.A = types.SimpleNamespace(protected_ids=frozenset({4242}))
    saved = sys.argv
    sys.argv = ["delete_workout.py", "--yes", "4242"]
    try:
        delete.main()
    except SystemExit as e:
        assert "refusing" in str(e.code), e.code
    else:
        raise AssertionError("delete_workout accepted a protected id")
    finally:
        sys.argv = saved


# --- multi-athlete isolation (2026-09-24) -------------------------------------
# Several athletes can share one repo, one Mac and one macOS user, so the operating system
# separates nothing. These tests ARE the separation: every athlete-specific path comes from
# athlete.py, every Garmin login is identity-checked, a bound session can never act as anyone
# else, a bound session is kept out of other athletes' files, and a commit never spans two
# athletes. The binding/guard tests run against throwaway athletes (scratch_athletes), never
# against the real ones.

def _env(**extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith("OSC_")}
    env.update(extra)
    return env


def _py(args, env, stdin=None):
    return subprocess.run([sys.executable, *args], env=env, input=stdin, capture_output=True,
                          text=True, cwd=ROOT)


def test_no_script_bypasses_the_athlete_resolver():
    """Only athlete.py may build a cache or token path. A script that joins "data" itself, or
    names the Garmin token store, acts on whichever athlete's files it happens to find — the
    exact mixing the multi-athlete split exists to prevent. Fails on the pre-split code, which
    had `REPO_ROOT / "data"` in eleven scripts and `getenv("GARMINTOKENS", "~/.garminconnect")`."""
    import ast
    def bad(v):
        return isinstance(v, str) and (v == "data" or v.startswith("data/")
                                       or ".garminconnect" in v or v == "GARMINTOKENS")
    files = [p for p in (ROOT / "scripts").rglob("*.py") if p.name != "athlete.py"]
    files += sorted(athlete.ATHLETES_DIR.glob("*/*.py"))
    offenders = []
    for path in files:
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
                hits = [s.value for s in (node.left, node.right) if isinstance(s, ast.Constant) and bad(s.value)]
            elif isinstance(node, ast.Call) and (getattr(node.func, "attr", None) or getattr(node.func, "id", None)) in (
                    "Path", "PurePath", "expanduser", "getenv", "get"):
                hits = [a.value for a in node.args if isinstance(a, ast.Constant) and bad(a.value)
                        and (a.value != "data" or getattr(node.func, "id", None) in ("Path", "PurePath"))]
            else:
                continue
            offenders += [f"{path.relative_to(ROOT)}:{node.lineno} {h!r}" for h in hits]
    assert not offenders, (
        f"paths built outside scripts/athlete.py: {offenders} — use athlete.current().data_dir / "
        ".token_dir / .workouts_dir instead")


def test_repo_root_holds_no_athlete_files():
    """Everything about a person lives under athletes/<name>/. A routine, a log or a medical fact
    left at the root would be read by every athlete's coach as if it were theirs."""
    stray = [n for n in ("CURRENT_ROUTINE.md", "COACH_CONTEXT.md", "HEALTH_BASELINE.md",
                         "PROGRESSION_LOG.md", "logs") if (ROOT / n).exists()]
    shared = {"EXERCISE_CATALOG.json", "FORMAT.md"}
    stray += [f"workouts/{p.name}" for p in (ROOT / "workouts").iterdir() if p.name not in shared]
    stray += [f"memory/{t}" for t in ("medical", "athlete", "equipment") if (ROOT / "memory" / t).exists()]
    assert not stray, f"athlete-specific files at the repo root: {stray} — move them to athletes/<name>/"


def test_athlete_identities_are_unique():
    """Two athletes bound to one Garmin account would read and write each other's watch."""
    seen = {}
    for name in athlete.known():
        dn = athlete.load(name).garmin.get("display_name")
        if dn:
            assert dn not in seen, f"{name} and {seen[dn]} are bound to the same Garmin account"
            seen[dn] = name


def test_managed_workouts_live_inside_the_athletes_folder():
    """sync_workouts reconciles exactly A.managed, from A.workouts_dir. Every program day must be
    managed (or it never reaches the watch), every generator must sit in the athlete's own folder,
    and managed names must be unique — sync matches the account by workoutName."""
    for key in bw.PROGRAM:
        assert key in A.managed, f"{A.name}: {key} is in the program but not in managed_workouts"
    names = {}
    for key in A.managed:
        path = A.workouts_dir / f"{key}.json"
        assert path.is_file(), f"{A.name}: managed workout {key} has no generated {path.name}"
        name = json.loads(path.read_text())["workoutName"]
        assert name not in names, f"{A.name}: {key} and {names[name]} share the name {name!r}"
        names[name] = key
    for g in A.generators:
        assert g.is_file() and g.resolve().is_relative_to(A.root.resolve()), (
            f"{A.name}: generator {g} is missing or outside the athlete's folder")


def test_exercise_ids_follow_the_day_exercise_convention():
    """The routine-doc lockstep tests find an exercise's row by its id, so ids must look like
    D1E2 (optionally D2E2b) for every athlete."""
    import re
    for day_key, day in bw.PROGRAM.items():
        for ex in day["exercises"]:
            assert re.match(r"^D\d+E\d+[a-z]?$", ex[0]), f"{day_key}/{ex[0]} is not a D<n>E<n> id"


# --------------------------------------------------------------------------- #
# the validation gate — every proven format, not just strength
# --------------------------------------------------------------------------- #
# Until 2026-10-04 validate_workout.py knew only strength: a pool swim has no catalog exercise,
# so every swim file failed the gate with "no exercise steps found" and could not be pushed by
# the book. The gate now dispatches on sportTypeKey to the formats proven in workouts/FORMAT.md.

def _cond(key):
    import validate_workout as vw
    return {"conditionTypeId": vw.CONDITION_IDS[key], "conditionTypeKey": key}


def _swim(**over):
    sport = {"sportTypeId": 4, "sportTypeKey": "swimming"}
    def lap(order, metres, stroke=6, equip=0, kind="interval"):
        return {"type": "ExecutableStepDTO", "stepOrder": order, "stepType": {"stepTypeKey": kind},
                "endCondition": _cond("distance"), "endConditionValue": metres,
                "strokeType": {"strokeTypeId": stroke}, "equipmentType": {"equipmentTypeId": equip}}
    steps = [lap(1, 200, kind="warmup"),
             {"type": "RepeatGroupDTO", "stepOrder": 2, "stepType": {"stepTypeKey": "repeat"},
              "numberOfIterations": 4, "endCondition": _cond("iterations"),
              "workoutSteps": [lap(3, 100, stroke=5),
                               {"stepOrder": 4, "stepType": {"stepTypeKey": "rest"}, "endCondition": _cond("lap.button")}]},
             lap(5, 100, stroke=0, equip=2, kind="cooldown")]
    wk = {"workoutName": "TEST · Swim", "sportType": sport, "poolLength": 25.0,
          "poolLengthUnit": {"unitId": 1, "unitKey": "meter", "factor": 100.0},
          "workoutSegments": [{"segmentOrder": 1, "sportType": sport, "workoutSteps": steps}]}
    wk.update(over)
    return wk


def _validate(wk):
    import tempfile
    import validate_workout as vw
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "wk.json"
        path.write_text(json.dumps(wk))
        return vw.validate(path)


def test_the_gate_passes_a_pool_swim():
    ok, report = _validate(_swim())
    assert ok, f"a well-formed pool swim failed the gate: {report}"


def test_the_gate_checks_what_reaches_the_watch_on_a_swim():
    """Each of these renders wrong or cannot be swum — the gate must stop it."""
    def broken(mutate):
        wk = _swim()
        mutate(wk)
        return _validate(wk)[0]
    first = lambda wk: wk["workoutSegments"][0]["workoutSteps"][0]
    assert not broken(lambda wk: wk.pop("poolLength")), "a swim without poolLength passed"
    assert not broken(lambda wk: first(wk).update(endConditionValue=60)), "60 m in a 25 m pool passed"
    assert not broken(lambda wk: first(wk).update(strokeType={"strokeTypeId": 11})), "an unknown stroke id passed"
    assert not broken(lambda wk: first(wk).pop("equipmentType")), "a swim step without equipment passed"
    assert not broken(lambda wk: first(wk).update(endCondition={"conditionTypeId": 2, "conditionTypeKey": "distance"})), (
        "a distance key carrying the time id passed — Garmin reads the id")
    assert not broken(lambda wk: first(wk).update(category="BENCH_PRESS", exerciseName="NOT_A_LIFT")), (
        "an unknown catalog pair on a swim passed")


def test_the_gate_passes_cardio_and_refuses_unproven_sports():
    sport = {"sportTypeId": 6, "sportTypeKey": "cardio_training"}
    step = {"stepOrder": 1, "stepType": {"stepTypeKey": "interval"},
            "endCondition": _cond("time"), "endConditionValue": 480}
    cardio = {"workoutName": "TEST · Cardio", "sportType": sport,
              "workoutSegments": [{"segmentOrder": 1, "sportType": sport, "workoutSteps": [step]}]}
    ok, report = _validate(cardio)
    assert ok, f"a well-formed cardio workout failed the gate: {report}"
    # Running became a format on 2026-10-11; cycling workouts are still unproven here.
    cardio["sportType"] = {"sportTypeId": 2, "sportTypeKey": "cycling"}
    assert not _validate(cardio)[0], "a sport with no proven payload format passed the gate"


# --- runs (2026-10-11) ----------------------------------------------------------
# A structured run carries the one thing no other format here does: a TARGET, which reaches the
# watch as an alert. Garmin reads the target by id and re-resolves its name, exactly as with swim
# strokes — so a wrong id comes back looking plausible. The gate checks the id against the key,
# and the sync signature carries the target so a round trip cannot silently lose it.

def _run(**over):
    sport = {"sportTypeId": 1, "sportTypeKey": "running"}
    hr = {"workoutTargetTypeId": 4, "workoutTargetTypeKey": "heart.rate.zone"}
    steps = [{"type": "ExecutableStepDTO", "stepOrder": 1, "stepType": {"stepTypeId": 1, "stepTypeKey": "warmup"},
              "endCondition": _cond("time"), "endConditionValue": 300},
             {"type": "ExecutableStepDTO", "stepOrder": 2, "stepType": {"stepTypeId": 3, "stepTypeKey": "interval"},
              "endCondition": _cond("time"), "endConditionValue": 1500,
              "targetType": hr, "targetValueOne": 118.0, "targetValueTwo": 140.0, "zoneNumber": None},
             {"type": "RepeatGroupDTO", "stepOrder": 3, "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat"},
              "numberOfIterations": 4, "endCondition": _cond("iterations"),
              "workoutSteps": [
                  {"type": "ExecutableStepDTO", "stepOrder": 4, "stepType": {"stepTypeId": 3, "stepTypeKey": "interval"},
                   "endCondition": _cond("time"), "endConditionValue": 20},
                  {"type": "ExecutableStepDTO", "stepOrder": 5, "stepType": {"stepTypeId": 4, "stepTypeKey": "recovery"},
                   "endCondition": _cond("lap.button")}]}]
    wk = {"workoutName": "TEST · Run", "sportType": sport,
          "workoutSegments": [{"segmentOrder": 1, "sportType": sport, "workoutSteps": steps}]}
    wk.update(over)
    return wk


def test_the_gate_passes_a_run_and_checks_its_targets():
    ok, report = _validate(_run())
    assert ok, f"a well-formed run failed the gate: {report}"

    def broken(mutate):
        wk = _run()
        mutate(wk["workoutSegments"][0]["workoutSteps"][1])
        return not _validate(wk)[0]
    assert broken(lambda st: st["targetType"].update(workoutTargetTypeId=6)), (
        "a heart-rate key carrying another target's id passed — Garmin reads the id")
    assert broken(lambda st: st.update(targetValueOne=150.0)), "an inverted HR range passed"
    assert broken(lambda st: st.update(targetValueTwo=None)), "an HR target without a top passed"
    assert broken(lambda st: st.update(targetValueOne=1.18, targetValueTwo=1.40)), (
        "an HR range that is not bpm passed (a zone fraction or a speed would alert at nonsense)")
    assert broken(lambda st: st.update(zoneNumber=2)), "an unproven zone-number target passed"
    assert broken(lambda st: st["targetType"].update(workoutTargetTypeKey="pace.zone")), (
        "an unproven target type passed")
    assert broken(lambda st: st.update(endCondition=_cond("reps"), endConditionValue=10)), (
        "a run step ending on reps passed")
    assert broken(lambda st: st["stepType"].update(stepTypeId=4)), (
        "an interval carrying the recovery id passed — the watch would label it Recover")
    # An HR target is proven on runs only: on a strength step it fails.
    wk = json.loads((A.workouts_dir / f"{A.managed[0]}.json").read_text()) if A.managed else None
    if wk and wk["sportType"]["sportTypeKey"] == "strength_training":
        leaf = next(x for x in __import__("validate_workout").iter_steps(wk["workoutSegments"][0]["workoutSteps"])
                    if x.get("exerciseName"))
        leaf.update(targetType={"workoutTargetTypeId": 4, "workoutTargetTypeKey": "heart.rate.zone"},
                    targetValueOne=120.0, targetValueTwo=140.0)
        assert not _validate(wk)[0], "an HR target on a strength step passed"


def test_the_sync_signature_carries_a_run_target_and_spares_every_other_step():
    """The round trip compares comparable(); a target it did not carry could be lost or changed
    on Garmin and still read "round-trip OK". And a no-target step must keep the exact signature
    it had before runs existed, or every recorded content hash would read as a change."""
    import copy
    import sync_workouts as sw
    base = _run()
    changed = copy.deepcopy(base)
    changed["workoutSegments"][0]["workoutSteps"][1]["targetValueTwo"] = 150.0
    assert sw.comparable(base) != sw.comparable(changed), "an HR target change is invisible to sync"
    # Garmin returns 140.0 for 140: that is not a change.
    echoed = copy.deepcopy(base)
    echoed["workoutSegments"][0]["workoutSteps"][1]["targetValueTwo"] = 140
    assert sw.comparable(base) == sw.comparable(echoed), "int vs float read as a change"
    rows = json.loads(sw.comparable(base))["steps"]
    assert len(rows[0]) == 10, "a no-target step's signature changed shape — every recorded hash would break"
    assert len(rows[1]) == 14 and rows[1][10:] == ["heart.rate.zone", 118.0, 140.0, None]


def test_sync_supersedes_a_renamed_workout_by_its_previous_name():
    """A rename must replace the old-name copy, not sit next to it on the watch."""
    import sync_workouts as sw
    account = {"Gym · Push + Power": 30, "D1 · Push": 10, "D2 · Pull": 20}
    prev = {"d1_push": ["D1 · Push"], "d2_pull": ["D2 · Pull"]}
    assert sw.account_match("d1_push", "Gym · Push + Power", account, prev) == (30, "Gym · Push + Power"), (
        "the current name must win over a previous one")
    assert sw.account_match("d2_pull", "Gym · Pull + Carry", account, prev) == (20, "D2 · Pull")
    assert sw.account_match("d3_legs", "Gym · Legs + Speed", account, prev) == (None, None)
    # A previous name belongs to its own key only.
    assert sw.account_match("d3_legs", "Gym · Legs + Speed", account, {"d1_push": ["D1 · Push"]}) == (None, None)


def test_previous_names_belong_to_managed_workouts_and_collide_with_nothing():
    """sync deletes the copy a previous name points at, so a previous name that is also a live
    name — or one attached to a key that is not managed — would delete the wrong workout."""
    current = {json.loads((A.workouts_dir / f"{k}.json").read_text())["workoutName"] for k in A.managed}
    seen = set()
    for key, olds in A.previous_names.items():
        assert key in A.managed, f"previous_names lists {key!r}, which is not a managed workout"
        for old in olds:
            assert old not in current, f"{old!r} is both a previous and a current workout name"
            assert old not in seen, f"{old!r} is a previous name of two workouts"
            seen.add(old)


def test_a_renamed_day_keeps_its_history():
    """Sessions logged under a day's old name must still attribute to that day."""
    import strength_sessions as ss
    names = ss.workout_names()
    for key, olds in A.previous_names.items():
        if key not in bw.PROGRAM:
            continue
        for old in olds:
            assert names.get(old) == key, f"a session named {old!r} no longer attributes to {key}"
    names = ss.workout_names({"d1": {"name": "New", "exercises": []}}, [], {"d1": ["New", "Old"]})
    assert names == {"New": "d1", "Old": "d1"}


def test_power_steps_have_no_range_and_rest_overrides_name_real_exercises():
    """'power' work (jumps, throws) is a target count: no rep range on the watch and no bump. And
    a SET_REST_BY_ID entry left behind after its exercise would silently retime its successor."""
    import build_workouts as b
    ex = ("D9E1", "test", "PLYO", "BOX_JUMP", 3, 3, None, 60, "power")
    group, _ = b.exercise_group(1, 1, ex, 60)
    work = group[0]["workoutSteps"][0]
    assert work["endCondition"]["conditionTypeKey"] == "reps" and work["endConditionValue"] == 3
    assert "Range" not in (work.get("description") or ""), "a power step carries a rep range"
    assert group[0]["workoutSteps"][1]["endConditionValue"] == 60.0
    ids = {e[0] for day in bw.PROGRAM.values() for e in day["exercises"]}
    orphans = set(b.SET_REST_BY_ID) - ids
    assert not orphans, f"SET_REST_BY_ID has entries for exercises no longer in PROGRAM: {orphans}"


def test_athletic_work_is_not_counted_as_muscle_volume():
    """Sprints, jumps, throws and sleds inside a gym session land in their own bucket — never
    Unattributed (silently lost) and never a muscle (a chest pass is not a chest set)."""
    for cat, name in [("RUN", "SPRINT"), ("PLYO", "BOX_JUMP"), ("PLYO", "LATERAL_LEAP_AND_HOP"),
                      ("PUSH_UP", "MEDICINE_BALL_CHEST_PASS"), ("PUSH_UP", "EXPLOSIVE_PUSH_UP"),
                      ("SLED", "PUSH"), ("CARDIO", "SKI_MOGULS"), ("BATTLE_ROPE", "ALTERNATING_WAVE")]:
        assert export.muscle_of(cat, name) == export.ATHLETIC, f"{cat}/{name} -> {export.muscle_of(cat, name)}"
    assert export.muscle_of("PUSH_UP", "PUSH_UP") == "Chest", "an ordinary push-up stopped being chest"


def test_every_managed_workout_passes_the_gate():
    """The gate must accept everything the athlete's generators actually emit — strength, swim
    and cardio alike — or a correct workout cannot be pushed by the book."""
    import validate_workout as vw
    failures = {}
    for key in A.managed:
        ok, report = vw.validate(A.workouts_dir / f"{key}.json")
        if not ok:
            failures[key] = [l for l in report if l.startswith("[FAIL]")]
    assert not failures, f"{A.name}: generated workouts fail validate_workout.py: {failures}"


def test_get_client_refuses_the_wrong_account():
    """The identity check is what keeps one athlete's session off another's watch —
    for reads as much as writes. Fake client, no network."""
    import tempfile
    import types
    import garmin_client

    class FakeGarmin:
        display = "someone-else"

        def __init__(self, *a, **k):
            self.display_name, self.full_name = FakeGarmin.display, "Someone Else"

        def login(self, tokenstore=None):
            return None

    saved = (garmin_client.Garmin, garmin_client.athlete.current)
    with tempfile.TemporaryDirectory() as tmp:
        fake = types.SimpleNamespace(name="x", display="X", token_dir=Path(tmp), config={},
                                     garmin={"display_name": "the-right-one"})
        garmin_client.Garmin = FakeGarmin
        garmin_client.athlete.current = lambda: fake
        try:
            # An empty token store — never logged in, or the library's logout() deleted the file — says so
            # plainly, with the command, before any login is tried.
            try:
                garmin_client.get_client()
            except SystemExit as e:
                assert "No saved Garmin login for X" in str(e.code) and "login.py --athlete x" in str(e.code), e.code
            else:
                raise AssertionError("get_client tried to log in with no saved login")
            (Path(tmp) / garmin_client.TOKEN_FILE).write_text("{}")   # a placeholder: FakeGarmin never reads it
            try:
                garmin_client.get_client()
            except SystemExit as e:
                assert "REFUSED" in str(e.code), e.code
            else:
                raise AssertionError("get_client accepted tokens that belong to another account")
            FakeGarmin.display = "the-right-one"
            assert garmin_client.get_client().display_name == "the-right-one"
            fake.garmin = {}
            try:
                garmin_client.get_client()
            except SystemExit as e:
                assert "no Garmin account bound" in str(e.code), e.code
            else:
                raise AssertionError("get_client logged in for an athlete with no bound identity")
        finally:
            garmin_client.Garmin, garmin_client.athlete.current = saved


def test_race_predictions_are_pulled_only_with_a_race_season():
    """Garmin's race predictor (the number a run race's target is held against, docs/DESIGN.md (races) phase 6)
    is pulled only for an athlete with a races.json: nobody else reads it, and an account that has
    never run must not fail its refresh over it. And always as the full year ending at the pull's last
    day, so a short daily pull never shrinks the history the trend is drawn from. Fake client, no
    network."""
    import tempfile
    import types
    import pull_health as ph

    calls = []

    class FakeClient:
        def get_race_predictions(self, startdate=None, enddate=None, _type=None):
            calls.append((startdate, enddate, _type))
            return [{"calendarDate": enddate, "timeHalfMarathon": 7013}]

    saved = (ph.get_client, ph.throttled, ph.A, ph.DATA_DIR, sys.argv)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        ph.get_client, ph.throttled, ph.DATA_DIR = FakeClient, (lambda fn, *a, **k: fn(*a, **k)), tmp
        sys.argv = ["pull_health.py", "--start", "2026-10-13", "--end", "2026-10-15", "--types", "race_predictions"]
        try:
            ph.A = types.SimpleNamespace(races_path=tmp / "races.json")
            ph.main()
            assert not calls and not (tmp / "race_predictions.json").exists(), "pulled with no race season"
            (tmp / "races.json").write_text('{"races": []}')
            ph.main()
            assert calls == [("2025-10-16", "2026-10-15", "daily")], f"not the full year to the last day: {calls}"
            assert json.loads((tmp / "race_predictions.json").read_text())[0]["timeHalfMarathon"] == 7013
        finally:
            ph.get_client, ph.throttled, ph.A, ph.DATA_DIR, sys.argv = saved


def test_a_race_prediction_comes_only_from_garmins_predictor():
    """A race's predicted time is Garmin's own predictor for its distance, read from the cache — the
    latest day, the gap to the target, the year's best and a weekly trend, oldest first. A kind Garmin
    does not predict, or an empty cache, gives None: the page reads "not tested yet", never a guess
    (docs/DESIGN.md (races) phase 6)."""
    import tempfile
    import types
    import races
    with tempfile.TemporaryDirectory() as tmp:
        A_ = types.SimpleNamespace(data_dir=Path(tmp))
        half = {"kind": "half_marathon", "target": {"under": "1:55:00"}}
        assert races.prediction(half, A_) is None, "a prediction with nothing cached"
        days = [{"calendarDate": f"2026-10-{d:02d}", "timeHalfMarathon": 7000 + d} for d in range(15, 0, -1)]
        (Path(tmp) / "race_predictions.json").write_text(json.dumps(days))
        p = races.prediction(half, A_)
        assert (p["value_s"], p["as_of"], p["source"]) == (7015, "2026-10-15", "garmin"), p
        assert p["vs_target_s"] == 7015 - 6900 and p["best"] == {"value_s": 7001, "date": "2026-10-01"}, p
        dates = [t["date"] for t in p["trend"]]
        assert dates == sorted(dates) and dates[-1] == "2026-10-15" and len(dates) == 3, dates
        assert races.prediction({"kind": "hyrox", "target": {"under": "1:15:00"}}, A_) is None


def _multisport(data: Path, parent: int, legs: list) -> list[int]:
    """A synthetic multisport activity in a cache, as Garmin records one (shaped like a real 70.3's
    record): the parent's record names its legs, and each leg's own record gives its sport, start,
    timer seconds and — when it is given as a third value — elapsed seconds. The legs take the ids after
    the parent's."""
    t = dt.datetime(2025, 6, 1, 6, 30, 0)
    ids = [parent + 1 + i for i in range(len(legs))]
    (data / f"activity_{parent}_full.json").write_text(json.dumps({
        "activityId": parent, "isMultiSportParent": True,
        "metadataDTO": {"childIds": ids, "childActivityTypes": [leg[0] for leg in legs]}}))
    for leg, (tk, secs, *elapsed) in zip(ids, legs):
        (data / f"activity_{leg}_full.json").write_text(json.dumps({
            "activityId": leg, "parentId": parent, "activityTypeDTO": {"typeKey": tk},
            "summaryDTO": {"startTimeGMT": t.strftime("%Y-%m-%dT%H:%M:%S.0"), "duration": secs,
                           **({"elapsedDuration": elapsed[0]} if elapsed else {})}}))
        t += dt.timedelta(seconds=elapsed[0] if elapsed else secs)
    return ids


# A 70.3's legs: the bike's timer stood still for 2:22 that its elapsed time — the race clock — counted.
SEVENTY_THREE_LEGS = [("open_water_swimming", 2188.4), ("transition_v2", 450.5), ("cycling", 9865.0, 10007.1),
                ("transition_v2", 378.1), ("running", 7974.4)]


def test_a_multisport_result_splits_by_its_legs():
    """A triathlon's splits (docs/DESIGN.md (races) phase 6) are its multisport activity's legs, read from the
    cache: swim, T1, bike, T2, run, each a leg's elapsed time — the race clock a result is recorded on, not
    the timer — rounded on the running total so the parts make the race's whole seconds. Part of a race is
    never shown as all of it, and a recording that is not swim, bike, run gives no splits — never a guess."""
    import tempfile
    import types
    import races
    tri = {"kind": "triathlon_70_3"}
    with tempfile.TemporaryDirectory() as tmp:
        data = Path(tmp)
        A_ = types.SimpleNamespace(data_dir=data)
        assert races.splits(tri, 9000, A_) is None, "splits with nothing cached"
        ids = _multisport(data, 9000, SEVENTY_THREE_LEGS)
        src, parts = races.splits(tri, 9000, A_)
        assert src == "legs" and [p["discipline"] for p in parts] == ["swim", "t1", "bike", "t2", "run"], parts
        assert [p["seconds"] for p in parts] == [2188, 451, 10007, 378, 7974], parts
        assert sum(p["seconds"] for p in parts) == 20998, "the parts must make the race clock's 5:49:58, not the timer's"
        full = json.loads((data / "activity_9000_full.json").read_text())
        full["metadataDTO"]["childIds"].reverse()   # named out of order: the legs' own starts put them back
        (data / "activity_9000_full.json").write_text(json.dumps(full))
        assert races.splits(tri, 9000, A_) == (src, parts)
        (data / f"activity_{ids[2]}_full.json").unlink()
        assert races.splits(tri, 9000, A_) is None, "four legs of five shown as the race"
        _multisport(data, 9100, [("running", 1200.0), ("transition_v2", 60.0), ("cycling", 3600.0),
                                 ("transition_v2", 50.0), ("running", 1500.0)])
        assert races.splits(tri, 9100, A_) is None, "a duathlon read as a triathlon"
        _multisport(data, 9200, [("open_water_swimming", 2000.0), ("road_biking", 9000.0), ("running", 7000.0)])
        assert [p["discipline"] for p in races.splits(tri, 9200, A_)[1]] == ["swim", "bike", "run"], "no transitions recorded"
        assert races.splits({"kind": "half_marathon"}, 9200, A_) is None, "a run is one discipline"
        assert races.splits(tri, None, A_) is None


def test_a_hyrox_result_splits_into_runs_stations_and_roxzone():
    """HYROX's splits (docs/DESIGN.md (races) phase 6): its eight runs, its eight stations and the roxzone between
    them — from a repeating multisport's legs, else from laps whose count fits the format exactly (a lap per
    run and per station, or a roxzone lap between each two), else from exercise sets naming each segment.
    A lap count that doesn't fit, or a lap too short to be a run or a station, gives none: a mis-press
    shifts every lap after it, runs would be summed as stations, and the number would look plausible."""
    import tempfile
    import types
    import races
    hyrox = {"kind": "hyrox", "format": {"stations": [s[0] for s in races.RACE_KINDS["hyrox"]["stations"]]}}
    write = lambda data, aid, what, obj: (data / f"activity_{aid}_{what}.json").write_text(json.dumps(obj))  # noqa: E731
    with tempfile.TemporaryDirectory() as tmp:
        data = Path(tmp)
        A_ = types.SimpleNamespace(data_dir=data)
        laps = [x for i in range(8) for x in ({"duration": 300.0 + i}, {"duration": 240.0})]
        laps[0] = {"duration": 281.0, "elapsedDuration": 300.0}   # the race clock, not the timer
        write(data, 7000, "splits", {"lapDTOs": laps})
        src, parts = races.splits(hyrox, 7000, A_)
        assert src == "laps" and [(p["discipline"], p["n"], p["seconds"]) for p in parts] == [
            ("runs", 8, 2428), ("stations", 8, 1920)], parts
        rox = [x for i in range(8) for x in ({"duration": 300.0}, {"duration": 20.0}, {"duration": 240.0})
               + (({"duration": 25.0},) if i < 7 else ())]
        write(data, 7001, "splits", {"lapDTOs": rox})
        assert [(p["discipline"], p["n"], p["seconds"]) for p in races.splits(hyrox, 7001, A_)[1]] == [
            ("runs", 8, 2400), ("stations", 8, 1920), ("roxzone", 15, 335)]
        write(data, 7002, "splits", {"lapDTOs": laps[:15]})
        assert races.splits(hyrox, 7002, A_) is None, "15 laps placed by position"
        write(data, 7003, "splits", {"lapDTOs": laps[:3] + [{"duration": 3.0}] + laps[4:]})
        assert races.splits(hyrox, 7003, A_) is None, "a 3-second lap read as a station"
        run = {"setType": "ACTIVE", "duration": 300.0, "exercises": [{"category": "RUN", "name": "RUN_OR_WALK"}]}
        sled = {"setType": "ACTIVE", "duration": 240.0, "exercises": [{"category": "SLED", "name": "PUSH"}]}
        write(data, 7100, "sets", {"exerciseSets": [x for _ in range(8) for x in (
            run, {"setType": "REST", "duration": 20.0}, sled, {"setType": "REST", "duration": 0.0})]})
        src, parts = races.splits(hyrox, 7100, A_)
        assert src == "sets" and [(p["discipline"], p["seconds"]) for p in parts] == [
            ("runs", 2400), ("stations", 1920), ("roxzone", 160)], parts
        write(data, 7101, "sets", {"exerciseSets": [run, run, sled] * 5})   # a five-round sim, not the race
        assert races.splits(hyrox, 7101, A_) is None
        _multisport(data, 7200, [x for i in range(8) for x in (("indoor_running", 300.0), ("transition_v2", 20.0),
                                                                ("indoor_cardio", 240.0))
                                 + ((("transition_v2", 25.0),) if i < 7 else ())])
        src, parts = races.splits(hyrox, 7200, A_)
        assert src == "legs" and [(p["discipline"], p["n"], p["seconds"]) for p in parts] == [
            ("runs", 8, 2400), ("stations", 8, 1920), ("roxzone", 15, 335)], parts


def test_a_result_is_held_against_its_reference_by_discipline():
    """A result's splits against the race's reference (docs/DESIGN.md (races) phase 6), group by group: a
    triathlon's swim, bike and run, and its two transitions as one, since a reference read off a summary
    often has only their sum. A split typed into races.json belongs to the discipline its first word
    names; with the reference's own activity cached, its splits are read from Garmin instead."""
    import tempfile
    import types
    import app_data
    import races
    r = {"kind": "triathlon_70_3", "target": {"under": "5:30:00"},
         "reference": {"name": "Last season's 70.3", "date": "2025-06-01", "time": "5:47:36",
                       "splits": {"Swim": "36:00", "Bike": "2:45:00", "Run": "2:12:00", "Transitions + rounding": "14:36"}}}
    assert [races.discipline_of(r, n) for n in r["reference"]["splits"]] == ["swim", "bike", "run", "transitions"]
    assert races.discipline_of(r, "Wetsuit strip") is None
    parts = [{"discipline": d, "seconds": s} for d, s in (("swim", 2188), ("t1", 451), ("bike", 10007), ("t2", 378), ("run", 7974))]
    ref = app_data._race_reference(r, 19800)
    assert ref["splits_from"] is None and ref["target_gap_s"] == 20856 - 19800, ref
    vs = races.versus(r, parts, ref["splits"])
    assert [(v["key"], v["seconds"], v["reference_s"], v["delta_s"]) for v in vs] == [
        ("swim", 2188, 2160, 28), ("bike", 10007, 9900, 107), ("run", 7974, 7920, 54), ("transitions", 829, 876, -47)], vs
    assert races.versus(r, None, ref["splits"]) is None and races.versus(r, parts, None) is None
    with tempfile.TemporaryDirectory() as tmp:
        A_ = types.SimpleNamespace(data_dir=Path(tmp))
        _multisport(Path(tmp), 9000, SEVENTY_THREE_LEGS)
        got = app_data._race_reference({**r, "reference": {**r["reference"], "activity_id": 9000}}, 19800, A_)
        assert got["splits_from"] == "legs" and [s["discipline"] for s in got["splits"]] == ["swim", "t1", "bike", "t2", "run"]
        assert got["splits"][0] == {"name": "Swim", "time": "36:28", "seconds": 2188, "discipline": "swim"}, got["splits"]
        assert [v["delta_s"] for v in races.versus(r, parts, got["splits"])] == [0, 0, 0, 0]


def test_multisport_legs_and_circuit_laps_are_pulled_once():
    """pull_activities.py (docs/DESIGN.md (races) phase 6): a multisport activity is one parent in the activity list,
    so its legs are pulled through the parent's own record — each leg's summary and laps, once — and a leg
    that fails is named but never fails the refresh. A circuit (a HYROX on a cardio profile) gets its laps
    beside its sets. Fake client, no network."""
    import contextlib
    import io
    import tempfile
    import pull_activities as pa
    calls = []

    class FakeClient:
        def get_activities_by_date(self, start, end):
            return [{"activityId": 1, "startTimeLocal": "2025-06-01 08:30:00", "activityType": {"typeKey": "multi_sport"}},
                    {"activityId": 2, "startTimeLocal": "2025-06-02 18:00:00", "activityType": {"typeKey": "indoor_cardio"}}]

        def get_activity(self, aid):
            calls.append(("full", aid))
            return {"activityId": aid, "metadataDTO": {"childIds": [11, 12] if aid == 1 else []}}

        def get_activity_splits(self, aid):
            calls.append(("splits", aid))
            if aid == 12:
                raise ConnectionError("reset by peer")
            return {"activityId": aid, "lapDTOs": []}

        def get_activity_details(self, aid):
            calls.append(("details", aid))
            return {}

        def get_activity_exercise_sets(self, aid):
            calls.append(("sets", aid))
            return {"exerciseSets": []}

        def get_cycling_ftp(self):
            return {}

        def get_lactate_threshold(self):
            return {}

        def get_scheduled_workouts(self, year, month):
            return {"calendarItems": []}

    saved = (pa.get_client, pa.throttled, pa.DATA_DIR, sys.argv)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        pa.get_client, pa.throttled, pa.DATA_DIR = FakeClient, (lambda fn, *a, **k: fn(*a, **k)), tmp
        sys.argv = ["pull_activities.py", "--start", "2025-06-01", "--end", "2025-06-02"]
        err = io.StringIO()
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                pa.main()
            assert {("full", 1), ("full", 11), ("splits", 11), ("full", 12), ("splits", 12)} <= set(calls), calls
            assert ("sets", 2) in calls and ("splits", 2) in calls, f"a circuit's laps beside its sets: {calls}"
            assert (tmp / "activity_11_splits.json").exists() and not (tmp / "activity_12_splits.json").exists()
            assert "12 leg splits: ConnectionError" in err.getvalue(), err.getvalue()
            calls.clear()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                pa.main()
            assert calls == [("splits", 12)], f"only the leg that failed is pulled again: {calls}"
        finally:
            pa.get_client, pa.throttled, pa.DATA_DIR, sys.argv = saved


def test_a_backfill_leaves_the_calendar_as_it_was():
    """pull_activities.py: scheduled.json is the calendar on the watch NOW, so only a window that reaches today
    refreshes it, and from today's month and the next. 2026-10-15: a backfill of one race day (--end 2025-06-01)
    replaced it with June and July's calendar, empty, and the app's Today card and the coach read that as what
    was on the watch. Fake client and a fixed today, no network."""
    import contextlib
    import io
    import tempfile
    import types
    import pull_activities as pa
    months = []

    class Day(dt.date):
        @classmethod
        def today(cls):
            return cls(2026, 12, 20)

    class FakeClient:
        def get_activities_by_date(self, start, end):
            return []

        def get_scheduled_workouts(self, year, month):
            months.append((year, month))
            return {"calendarItems": [{"itemType": "workout", "id": year * 100 + month, "date": f"{year}-{month:02d}-20"}]}

    def run(*argv):
        out = io.StringIO()
        sys.argv = ["pull_activities.py", *argv, "--details", "none"]
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            pa.main()
        return out.getvalue()

    saved = (pa.get_client, pa.DATA_DIR, pa.dt, sys.argv)
    with tempfile.TemporaryDirectory() as tmp:
        cal = Path(tmp) / "scheduled.json"
        cal.write_text('[\n  {"itemType": "workout", "id": 1, "date": "2026-12-20"}\n]\n')
        before = cal.read_bytes()
        pa.get_client, pa.DATA_DIR = FakeClient, Path(tmp)
        pa.dt = types.SimpleNamespace(date=Day, timedelta=dt.timedelta)
        try:
            out = run("--start", "2025-06-01", "--end", "2025-06-01")
            assert cal.read_bytes() == before and not months, f"a past window rewrote the calendar from {months}"
            assert "calendar left as it was" in out, out
            run("--days", "1")
            assert months == [(2026, 12), (2027, 1)], f"a window ending today reads today's month and the next: {months}"
            assert [i["id"] for i in json.loads(cal.read_text())] == [202612, 202701], "a window ending today must rewrite it"
            months.clear()
            run("--start", "2026-12-20", "--end", "2027-02-20")
            assert months == [(2026, 12), (2027, 1)], f"a window past today reads today's months, not its end's: {months}"
        finally:
            pa.get_client, pa.DATA_DIR, pa.dt, sys.argv = saved


def test_a_calendar_entry_in_two_month_views_is_cached_once():
    """pull_activities.py: Garmin's month views spill across their boundaries, so this month's view and the next
    both hand back an entry dated in their overlap (2026-08-30, the sync that unscheduled an id twice). Its own
    loop kept both copies in scheduled.json, and the app's week view and calendar list every entry they find. So
    the calendar is read through garmin_client.read_scheduled_workouts, which dedupes by schedule id, and no
    script reads a month view itself. Fake client and a fixed today, no network."""
    import contextlib
    import io
    import tempfile
    import types
    import garmin_client
    import pull_activities as pa
    months = []
    # 2026-11-02 comes back from October's view (its spill) and from November's, under one schedule id.
    overlap = {"itemType": "workout", "id": 9, "workoutId": 90, "date": "2026-11-02", "title": "Pull + Carry"}
    views = {(2026, 10): [{"itemType": "workout", "id": 1, "workoutId": 10, "date": "2026-10-20", "title": "Push"},
                          {"itemType": "activity", "id": 2, "date": "2026-10-15"}, overlap],
             (2026, 11): [dict(overlap), {"itemType": "workout", "id": 3, "workoutId": 30, "date": "2026-11-20",
                                          "title": "Legs"}]}

    class Day(dt.date):
        @classmethod
        def today(cls):
            return cls(2026, 10, 16)

    class FakeClient:
        def get_activities_by_date(self, start, end):
            return []

        def get_scheduled_workouts(self, year, month):
            months.append((year, month))
            return {"calendarItems": views.get((year, month), [])}

    saved = (pa.get_client, pa.DATA_DIR, pa.dt, sys.argv, garmin_client.THROTTLE_SECONDS)
    with tempfile.TemporaryDirectory() as tmp:
        pa.get_client, pa.DATA_DIR, garmin_client.THROTTLE_SECONDS = FakeClient, Path(tmp), 0
        pa.dt = types.SimpleNamespace(date=Day, timedelta=dt.timedelta)
        sys.argv = ["pull_activities.py", "--days", "1", "--details", "none"]
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                pa.main()
            cached = json.loads((Path(tmp) / "scheduled.json").read_text())
        finally:
            pa.get_client, pa.DATA_DIR, pa.dt, sys.argv, garmin_client.THROTTLE_SECONDS = saved
    assert months == [(2026, 10), (2026, 11)], f"still today's month and the next: {months}"
    assert [i["id"] for i in cached] == [1, 9, 3], f"the overlap cached once, workouts only, by date: {cached}"
    readers = sorted(p.name for p in (ROOT / "scripts").rglob("*.py")
                     if p.name != "garmin_client.py" and ".get_scheduled_workouts(" in p.read_text())
    assert not readers, f"{readers} read a month view themselves — use garmin_client.read_scheduled_workouts"


def test_a_race_check_must_match_what_races_json_records():
    """A race_check is published only after the check is recorded in races.json (docs/DESIGN.md (races) §3), and
    the page draws from the races view, never from the result. So every race it names must be there with
    exactly that check: an unknown id, a check not yet recorded, or another status, source or date found
    is refused, on the coach's side and again by the app's server."""
    import app_contracts
    races = [{"id": "x-half", "verified": {"status": "differs", "checked": "2026-10-13", "source_kind": "official",
                                           "source": "https://example.com/x",
                                           "found": {"date": "2027-02-13", "start": "08:30"}}}]
    ok = {"kind": "race_check", "request_id": "r3", "checked": "2026-10-13",
          "races": [{"id": "x-half", "status": "differs", "source_kind": "official", "source": "https://example.com/x",
                     "found": {"date": "2027-02-13", "start": "08:30"}, "note": "The Saturday, on the organiser's page."}]}
    assert not app_contracts.validate("race_check", ok) and not app_contracts.check_races(ok, races)

    def broken(edit):
        payload = json.loads(json.dumps(ok))
        edit(payload)
        return " | ".join(app_contracts.check_races(payload, races))
    assert "not a race in races.json" in broken(lambda p: p["races"][0].update(id="nope"))
    assert "record the check" in broken(lambda p: p.update(checked="2026-10-15"))
    assert "races/0/status" in broken(lambda p: p["races"][0].update(status="confirmed"))
    assert "races/0/found/date" in broken(lambda p: p["races"][0]["found"].update(date="2027-02-14"))


def test_a_bound_session_cannot_act_as_anyone_else():
    import tempfile
    code = "import sys; sys.path.insert(0, 'scripts'); import athlete; print(athlete.current().name)"
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        roots = scratch_athletes(tmp, ["ann", "bob"])
        (tmp / "data" / "sessions").mkdir(parents=True)
        (tmp / "data" / "sessions" / "sess-0001").write_text('{"athlete": "ann"}')
        base = _env(OSC_ATHLETES_ROOT=str(roots), OSC_DATA_ROOT=str(tmp / "data"))
        r = _py(["-c", code], {**base, "OSC_SESSION": "sess-0001"})
        assert r.returncode == 0 and r.stdout.strip() == "ann", r.stderr
        r = _py(["-c", code], {**base, "OSC_SESSION": "sess-0001", "OSC_ATHLETE": "bob"})
        assert r.returncode != 0 and "refusing to act as bob" in r.stderr, r.stderr
        r = _py(["-c", code], {**base, "OSC_SESSION": "sess-0002", "OSC_ATHLETE": "ann"})
        assert r.returncode != 0 and "No athlete is bound" in r.stderr, (
            "an unbound Claude session acted on an explicit --athlete without anyone binding it")
        r = _py(["-c", code], base)
        assert r.returncode != 0 and "No athlete selected" in r.stderr, r.stderr
        r = _py(["-c", code], {**base, "OSC_ATHLETE": "bob"})
        assert r.returncode == 0 and r.stdout.strip() == "bob", r.stderr


def test_a_session_is_bound_once_and_never_rebound():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        roots = scratch_athletes(tmp, ["ann", "bob"])
        base = _env(OSC_ATHLETES_ROOT=str(roots), OSC_DATA_ROOT=str(tmp / "data"),
                    OSC_SESSION="sess-0003")
        r = _py(["scripts/use.py", "ann"], base)
        assert r.returncode == 0 and "Athlete: Ann" in r.stdout, r.stderr
        r = _py(["scripts/use.py", "bob"], base)
        assert r.returncode != 0 and "already bound to ann" in r.stderr, r.stderr
        r = _py(["scripts/use.py", "ann"], base)
        assert r.returncode == 0, "re-binding to the SAME athlete must be harmless"
        r = _py(["scripts/use.py", "ann"], {k: v for k, v in base.items() if k != "OSC_SESSION"})
        assert r.returncode != 0, "use.py bound something outside a Claude session"


def test_the_guard_hook_keeps_a_bound_session_out_of_other_athletes_files():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        roots = scratch_athletes(tmp, ["ann", "bob"])
        (tmp / "data" / "sessions").mkdir(parents=True)
        (tmp / "data" / "sessions" / "sess-0004").write_text('{"athlete": "ann"}')
        base = _env(OSC_ATHLETES_ROOT=str(roots), OSC_DATA_ROOT=str(tmp / "data"))

        def code(tool_input, sid="sess-0004"):
            return _py(["scripts/hooks/guard_paths.py"], base, stdin=json.dumps(
                {"session_id": sid, "tool_name": "Read", "tool_input": tool_input})).returncode

        assert code({"file_path": "/repo/athletes/bob/ATHLETE.md"}) == 2
        assert code({"file_path": "/repo/athletes/ann/ATHLETE.md"}) == 0
        assert code({"command": "ls data/bob/"}) == 2
        assert code({"command": "ls data/sessions data/ann"}) == 0
        assert code({"command": "cat ~/.garminconnect-bob/oauth2_token.json"}) == 2
        assert code({"command": "ls ~/.garminconnect"}) == 2, "the default token path is never used"
        assert code({"command": "ls ~/.garminconnect-ann"}) == 0
        assert code({"file_path": "/repo/athletes/bob/x"}, sid="sess-9999") == 0, (
            "an unbound session is not this hook's job — athlete scripts already refuse it")


def test_app_attach_needs_a_bound_session_and_marks_it():
    """The app's server starts before anyone is bound, so it learns its athlete only from attach,
    which reads the session's binding itself (docs/DESIGN.md (the app) → The athlete)."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        roots = scratch_athletes(tmp, ["ann", "bob"])
        (tmp / "data" / "sessions").mkdir(parents=True)
        (tmp / "data" / "sessions" / "sess-0005").write_text('{"athlete": "ann"}')
        base = _env(OSC_ATHLETES_ROOT=str(roots), OSC_DATA_ROOT=str(tmp / "data"))
        unbound = _py(["scripts/app_data.py", "attach", "--session", "sess-9999"], base)
        assert unbound.returncode != 0 and "not bound" in unbound.stderr, unbound.stderr
        bound = _py(["scripts/app_data.py", "attach", "--session", "sess-0005"], base)
        assert bound.returncode == 0, bound.stderr
        who = json.loads(bound.stdout)
        assert {k: who[k] for k in ("athlete", "display", "garmin_account")} == \
            {"athlete": "ann", "display": "Ann", "garmin_account": "Ann"}
        assert who["app_dir"] == str(tmp / "data" / "ann" / "app") and who["logs_dir"].endswith("athletes/ann/logs")
        assert (tmp / "data" / "ann" / "app" / "sessions" / "sess-0005.json").is_file()
        assert not (tmp / "data" / "bob" / "app").exists(), "attach touched another athlete's state"


def _view_ids(vs: dict) -> set[str]:
    """Every activity and workout id the lite page's views carry — none of them may reach the page."""
    v, cal, prog, races = (vs.get(k) or {} for k in ("today", "calendar", "program", "races"))
    ids = {s.get("id") for s in (v.get("last_day") or {}).get("sessions") or []}
    ids |= {i.get("id") for d in (v.get("week") or {}).get("days") or [] for i in d.get("items") or []}
    ids |= {s.get("workout_id") for s in v.get("scheduled") or []}
    ids |= {w.get("id") for w in (v.get("sync") or {}).get("workouts") or []}
    ids |= {x.get("id") for x in cal.get("done") or []} | {x.get("workout_id") for x in cal.get("scheduled") or []}
    ids |= {w.get("id") for w in (prog.get("sync") or {}).get("workouts") or []}
    ids |= {(r.get("result") or {}).get("activity_id") for r in races.get("races") or []}
    return {str(i) for i in ids if i}


def _assert_lite_page(page: str, vs: dict, display: str, account: str | None = None) -> None:
    import re
    assert f"<title>OpenSportCoach · {display}</title>" in page[:8192], "the page's name is the athlete's"
    for tag in ("<script", "<form", "<input", "<button", "<iframe"):
        assert tag not in page.lower(), f"the lite page is read-only — it has a {tag}"
    # What LOADS (src=, <link href=) is the app's fonts only. A tap-through <a href> loads nothing, and the
    # only one the page carries is a planned Zwift ride's workout page (e9d4500, 11-05); the first came
    # into the agenda window on 2026-11-19 and this check, written before it, refused it.
    hosts = set(re.findall(r'src="(https?://[^/"]+)', page)) | set(re.findall(r'<link [^>]*href="(https?://[^/"]+)', page))
    assert hosts <= {"https://fonts.googleapis.com", "https://fonts.gstatic.com"}, hosts
    links = set(re.findall(r'<a [^>]*href="(https?://[^/"]+)', page))
    assert links <= {"https://whatsonzwift.com"}, links
    leaked = sorted(i for i in _view_ids(vs) if len(i) >= 4 and re.search(rf"(?<![\d,.]){i}(?![\d,.])", page))
    assert not leaked, f"ids left the Mac: {leaked}"
    if account and account != display:
        assert account not in page, "the Garmin account name reached the page"
    assert "weekLoad" not in page and "Week load" not in page, "never weekLoad alone (CLAUDE.md)"
    # Every section link lands on a section, and every icon it uses is in its sprite.
    for anchor in re.findall(r'href="#([\w-]+)"', page):
        assert f'id="{anchor}"' in page, f"the link #{anchor} goes nowhere"
    for ref in set(re.findall(r'<use href="#([\w-]+)"', page)):
        assert f'<symbol id="{ref}"' in page, f"icon {ref} is not in the sprite"


def test_the_lite_page_is_read_only_and_carries_only_what_lite_lets_through():
    """scripts/app_artifact.py turns the app's views into the page published to claude.ai: it must
    build on each athlete's real data, have nothing on it that acts (the confirm gate is a click in
    the app), load nothing but the app's fonts, and carry no activity id, workout id or Garmin account.
    Its gym section is the program he trains now — never the PR board, which keeps removed lifts."""
    import html
    import app_artifact
    import app_data
    vs = {k: app_data.run_view(k) for k in app_artifact.VIEWS}
    L = app_artifact.lite(vs)
    assert set(L) == {"day", "snapshot_at", "freshness", "block", "daily", "trained_today", "plan_today", "call_day", "today",
                      "night", "last_night", "vitals", "readiness_30", "form_spark", "body", "cardio", "week_strength", "week",
                      "sync", "sync_unknown", "bumps", "starved", "agenda", "recovery", "program", "races"}, set(L)
    assert not any("id" in w for w in L["sync"]), "workout ids stay on the Mac"
    end = (dt.date.fromisoformat(L["day"]) + dt.timedelta(days=app_artifact.AHEAD - 1)).isoformat()
    assert all(L["day"] <= x["date"] <= end for k in ("scheduled", "planned", "done", "race_days") for x in L["agenda"][k])
    trains = [[x.get("routine") or x.get("label") for x in d["exercises"]] for d in vs["program"]["days"]]
    assert [[x.get("routine") or x.get("label") for x in d["exercises"]] for d in L["program"]["days"]] == trains
    page = app_artifact.render(L, A.display, (A.config.get("app") or {}).get("accent"))
    _assert_lite_page(page, vs, A.display, A.garmin.get("full_name"))
    score = (vs["today"].get("night") or {}).get("recoveryScore")
    assert f'data-k="recovery">{"—" if score is None else score}<' in page, "the app's recovery number, not a second one"
    rec = (L["daily"] or {}).get("recommendation")
    if rec and L["daily"]["date"] == L["day"] and not L["trained_today"]:
        assert f'>{html.escape(rec["verb"])}</span>' in page


def test_the_lite_page_builds_from_the_demo_fixtures():
    """The preview is built from the synthetic Demo athletes (app/fixtures/), never a real one: the
    page shows the fixture's own call and recovery score, and a new athlete's page still builds."""
    import html
    import tempfile
    import app_artifact
    for folder in ("demo", "demo-new"):
        src = ROOT / "app" / "fixtures" / folder
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "page.html"
            proc = _py(["scripts/app_artifact.py", "build", "--fixture", str(src), "--out", str(out)], _env())
            assert proc.returncode == 0, proc.stderr
            page = out.read_text()
            vs = {k: json.loads((src / "views" / f"{k}.json").read_text()) for k in app_artifact.VIEWS}
            v = vs["today"]
            index = json.loads((src / "index.json").read_text())
            _assert_lite_page(page, vs, index["display"])
            score = (v.get("night") or {}).get("recoveryScore")
            assert f'data-k="recovery">{"—" if score is None else score}<' in page, score
            daily = v.get("daily") or {}
            if v.get("trained_today"):
                assert ">DONE</span>" in page
            elif daily.get("recommendation") and daily["date"] == v["generated_at"][:10]:
                assert f'>{html.escape(daily["recommendation"]["verb"])}</span>' in page
            else:
                assert "No call yet today" in page
            assert ('id="races"' in page) == bool(vs["races"].get("races")), "a race season, and only one, gets a Races section"


def test_the_lite_page_needs_an_opt_in_and_keeps_one_url_per_athlete():
    """It puts health data on claude.ai, so `build` refuses until the athlete said yes; its URL is
    recorded under that athlete's own app state, only once, and nobody else's is touched."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        roots = scratch_athletes(tmp, ["ann", "bob"])
        base = _env(OSC_ATHLETES_ROOT=str(roots), OSC_DATA_ROOT=str(tmp / "data"))
        run = lambda *args: _py(["scripts/app_artifact.py", *args, "--athlete", "ann"], base)  # noqa: E731
        refused = run("build")
        assert refused.returncode != 0 and "opted in" in refused.stderr, refused.stderr
        assert run("build", "--out", str(tmp / "x.html")).returncode != 0, "--out is for fixtures only"
        assert run("record", "https://example.com/artifact/abcdefgh12").returncode != 0
        url = "https://claude.ai/artifact/abcdefgh-1234"
        ok = run("record", url)
        assert ok.returncode == 0, ok.stderr
        assert json.loads((tmp / "data" / "ann" / "app" / "artifact.json").read_text())["url"] == url
        assert run("record", url).returncode == 0, "recording the same URL again is fine"
        moved = run("record", "https://claude.ai/artifact/zzzzzzzz-9999")
        assert moved.returncode != 0 and "already" in moved.stderr, moved.stderr
        status = json.loads(run("status").stdout)
        assert status["url"] == url and status["opted_in"] is None, status
        assert not (tmp / "data" / "bob").exists(), "another athlete's state was touched"


def test_confirm_gate_holds_garmin_writes_in_app_sessions_to_a_click():
    """In a session serving the app, a Garmin write runs only against a plan the athlete confirmed
    in the app in the last 15 minutes; a normal session is untouched (docs/DESIGN.md (the app) → confirm gate)."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        roots = scratch_athletes(tmp, ["ann", "bob"])
        sessions = tmp / "data" / "sessions"
        sessions.mkdir(parents=True)
        for sid, who in (("sess-app1", "ann"), ("sess-norm", "ann"), ("sess-bob1", "bob")):
            (sessions / sid).write_text(json.dumps({"athlete": who}))
        base = _env(OSC_ATHLETES_ROOT=str(roots), OSC_DATA_ROOT=str(tmp / "data"))
        assert _py(["scripts/app_data.py", "attach", "--session", "sess-app1"], base).returncode == 0
        assert _py(["scripts/app_data.py", "attach", "--session", "sess-bob1"], base).returncode == 0

        def code(command, sid="sess-app1"):
            return _py(["scripts/hooks/confirm_gate.py"], base, stdin=json.dumps(
                {"session_id": sid, "tool_name": "Bash", "tool_input": {"command": command}})).returncode

        sync = ".venv/bin/python -u scripts/sync_workouts.py --yes --skip-build"
        assert code(".venv/bin/python -u scripts/sync_workouts.py --skip-build") == 0, "a dry run is free"
        assert code("ls athletes/ann") == 0
        assert code(sync, sid="sess-norm") == 0, "a session not serving the app keeps today's confirm"
        assert code(sync) == 2, "no --expect-plan"
        assert code(sync + " --expect-plan abc123") == 2, "no click recorded"
        rec = _py(["scripts/app_confirm.py", "record", "--session", "sess-app1", "--plan", "abc123"], base)
        assert rec.returncode == 0, rec.stderr
        assert code(sync + " --expect-plan abc123") == 0
        assert code(sync + " --expect-plan zzz999") == 2, "a different plan needs its own click"
        assert code(sync + " --expect-plan abc123", sid="sess-bob1") == 2, "another session's click"
        assert code("cd x && .venv/bin/python scripts/reschedule_workout.py 1 --to 2026-10-09 --yes") == 2
        assert code(".venv/bin/python scripts/delete_workout.py --yes 123") == 2, "never from the app"
        assert code(".venv/bin/python -c 'c=get_client(); c.upload_workout(p)'") == 2
        assert code(".venv/bin/python scripts/app_confirm.py record --session sess-app1 --plan x1x1") == 2
        assert code(".venv/bin/python scripts/app_confirm.py record --session s --plan x", sid="sess-norm") == 2
        assert code("python3 -c 'import app_confirm; app_confirm.record(\"s\", \"p\")'", sid="sess-norm") == 2
        assert code("git add scripts/app_confirm.py && git commit -m 'sync_workouts.py --yes, "
                    "delete_workout.py, app_confirm.py record'") == 0, "git only carries the names"
        assert code("sed -n 1,20p scripts/app_confirm.py") == 0, "reading it records nothing"
        # A record goes stale after 15 minutes.
        rec_file = tmp / "data" / "ann" / "app" / "confirms" / "sess-app1--abc123.json"
        rec_file.write_text(json.dumps({"confirmed_at": "2026-01-01T07:00:00", "plan": "abc123"}))
        assert code(sync + " --expect-plan abc123") == 2, "an old click"
        # Only an attached, bound session can have a click recorded.
        assert _py(["scripts/app_confirm.py", "record", "--session", "sess-norm", "--plan", "abc123"],
                   base).returncode != 0


def test_precommit_keeps_each_commit_to_one_athlete():
    import importlib.machinery
    import importlib.util
    loader = importlib.machinery.SourceFileLoader("osc_precommit", str(ROOT / ".githooks" / "pre-commit"))
    hook = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
    loader.exec_module(hook)
    assert hook.check(["scripts/x.py", "athletes/ann/a.md"], None) is None
    assert hook.check(["athletes/ann/a.md", "athletes/bob/b.md"], None), "two athletes in one commit"
    assert hook.check(["athletes/bob/b.md"], "ann"), "a session bound to ann committed bob's file"
    assert hook.check(["athletes/ann/a.md", "memory/x.md", "scripts/y.py"], "ann") is None


def test_precommit_lets_a_merge_bring_in_each_athletes_own_commits_and_nothing_more():
    """A merge brings in commits that each passed the one-athlete rule; the hook judges it by what the merge
    itself changes. A throwaway repository: two branches, one athlete each, merged → allowed; the same merge
    with an athlete file edited while resolving it → refused; a plain commit spanning both → refused."""
    import tempfile
    hook_src = ROOT / ".githooks" / "pre-commit"
    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp)
        env = {**_env(), "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
               "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"}
        git = lambda *a, ok=True: subprocess.run(["git", *a], cwd=repo, env=env, capture_output=True,  # noqa: E731
                                                  text=True, check=ok)
        git("init", "-q", "-b", "main")
        (repo / "scripts").mkdir()
        for f in ("athlete.py", "leak_scan.py", "sources.py", "sports.py"):   # what the hook imports
            (repo / "scripts" / f).write_text((ROOT / "scripts" / f).read_text())
        (repo / ".githooks").mkdir()
        (repo / ".githooks" / "pre-commit").write_text(hook_src.read_text())
        (repo / ".githooks" / "pre-commit").chmod(0o755)
        for who in ("ann", "bob"):
            (repo / "athletes" / who).mkdir(parents=True)
            (repo / "athletes" / who / "log.md").write_text("start\n")
        git("add", "-A")
        git("commit", "-qm", "base", "--no-verify")
        git("config", "core.hooksPath", ".githooks")
        git("checkout", "-qb", "side")
        (repo / "athletes" / "ann" / "log.md").write_text("ann's day\n")
        git("commit", "-qam", "ann")
        (repo / "athletes" / "bob" / "log.md").write_text("bob's day\n")
        git("commit", "-qam", "bob")
        git("checkout", "-q", "main")
        git("merge", "--no-ff", "--no-commit", "side")
        r = git("commit", "-qm", "merge", ok=False)
        assert r.returncode == 0, f"a merge of two one-athlete commits was refused: {r.stderr}"
        git("reset", "-q", "--hard", "HEAD~1")
        git("merge", "--no-ff", "--no-commit", "side")
        (repo / "athletes" / "bob" / "log.md").write_text("edited while merging\n")
        git("add", "-A")
        r = git("commit", "-qm", "merge", ok=False)
        assert r.returncode == 0, f"a merge that changes one athlete's file itself is one athlete: {r.stderr}"
        git("reset", "-q", "--hard", "HEAD~1")
        git("merge", "--no-ff", "--no-commit", "side")
        for who in ("ann", "bob"):   # both edited while resolving: the merge itself spans two athletes
            (repo / "athletes" / who / "log.md").write_text("edited while merging\n")
        git("add", "-A")
        r = git("commit", "-qm", "merge", ok=False)
        assert r.returncode != 0 and "2 athletes" in r.stderr, "what a merge changes itself must still count"
        git("merge", "--abort")
        (repo / "athletes" / "ann" / "log.md").write_text("x\n")
        (repo / "athletes" / "bob" / "log.md").write_text("y\n")
        git("add", "-A")
        r = git("commit", "-qm", "both", ok=False)
        assert r.returncode != 0 and "2 athletes" in r.stderr, "a plain commit spanning two athletes"


def test_the_athletes_own_repository_keeps_one_athlete_per_commit():
    """athletes/ as its own private repository (athletes/README.md): its commits never pass the engine's
    hook, so .githooks/athletes/pre-commit runs the same rule there. A throwaway engine with a nested
    athletes repository: one athlete's commit passes, a commit spanning two is refused."""
    import shutil
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        eng = Path(tmp)
        (eng / "scripts").mkdir()
        for f in ("athlete.py", "leak_scan.py", "sources.py", "sports.py"):   # what the hooks import
            shutil.copy(ROOT / "scripts" / f, eng / "scripts" / f)
        shutil.copytree(ROOT / ".githooks", eng / ".githooks")
        ath = eng / "athletes"
        for who in ("ann", "bob"):
            (ath / who).mkdir(parents=True)
            (ath / who / "log.md").write_text("start\n")
        env = {**_env(), "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
               "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"}
        git = lambda *a, ok=True: subprocess.run(["git", *a], cwd=ath, env=env, capture_output=True,  # noqa: E731
                                                  text=True, check=ok)
        git("init", "-q")
        git("config", "core.hooksPath", "../.githooks/athletes")
        git("add", "ann/log.md")
        r = git("commit", "-qm", "ann only", ok=False)
        assert r.returncode == 0, f"one athlete's commit was refused: {r.stderr}"
        git("add", "bob/log.md")
        r = git("commit", "-qm", "bob only", ok=False)
        assert r.returncode == 0, r.stderr
        (ath / "ann" / "log.md").write_text("x\n")
        (ath / "bob" / "log.md").write_text("y\n")
        git("add", "-A")
        r = git("commit", "-qm", "both", ok=False)
        assert r.returncode != 0 and "2 athletes" in r.stderr, "a commit spanning two athletes in their repository"


def test_session_start_exports_the_session_and_asks_who_to_coach():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        roots = scratch_athletes(tmp, ["ann", "bob"])
        env_file = tmp / "claude_env"
        env_file.write_text("")
        base = _env(OSC_ATHLETES_ROOT=str(roots), OSC_DATA_ROOT=str(tmp / "data"),
                    CLAUDE_ENV_FILE=str(env_file))
        r = _py(["scripts/hooks/session_start.py"], base, stdin=json.dumps({"session_id": "sess-0005"}))
        assert r.returncode == 0 and "No athlete is bound" in r.stdout, r.stdout + r.stderr
        assert "export OSC_SESSION=sess-0005" in env_file.read_text()
        (tmp / "data" / "sessions").mkdir(parents=True, exist_ok=True)
        (tmp / "data" / "sessions" / "sess-0005").write_text('{"athlete": "bob"}')
        r = _py(["scripts/hooks/session_start.py"], base, stdin=json.dumps({"session_id": "sess-0005"}))
        assert "Athlete: Bob" in r.stdout, "a resumed session must come back bound, with its banner"
        r = _py(["scripts/hooks/session_start.py"], base, stdin="not json")
        assert r.returncode == 0, "a hook must never break session start"
        # Someone new is sent to the setup skill, never to use.py with a folder that doesn't exist.
        r = _py(["scripts/hooks/session_start.py"], base, stdin=json.dumps({"session_id": "sess-0006"}))
        assert "/osc-setup" in r.stdout and "Someone NEW" in r.stdout, r.stdout
        r = _py(["scripts/use.py", "zed"], {**base, "OSC_SESSION": "sess-0006"})
        assert r.returncode != 0 and "/osc-setup" in (r.stdout + r.stderr), "an unknown name points to the setup"
        # A fresh clone: nobody is set up — the first thing the coach does is /osc-setup.
        empty = tmp / "nobody"
        empty.mkdir()
        r = _py(["scripts/hooks/session_start.py"], {**base, "OSC_ATHLETES_ROOT": str(empty)},
                stdin=json.dumps({"session_id": "sess-0007"}))
        assert r.returncode == 0 and "nobody is set up" in r.stdout and "/osc-setup" in r.stdout, r.stdout
        assert "use.py" not in r.stdout, "a fresh clone has nobody to bind"


def test_a_new_athlete_scaffold_passes_every_engine_invariant():
    """new_athlete.py must produce a folder the engine accepts as-is — the starting point for
    every new athlete. Scaffolds a throwaway athlete in a temp root and runs the whole
    engine suite for it in its own child."""
    if os.environ.get("OSC_SCAFFOLD_CHECK"):
        return  # already inside the scaffold's own run
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "athletes").mkdir()
        base = _env(OSC_ATHLETES_ROOT=str(tmp / "athletes"), OSC_DATA_ROOT=str(tmp / "data"))
        r = _py(["scripts/new_athlete.py", "demo", "--display", "Demo"], base)
        assert r.returncode == 0, r.stdout + r.stderr
        r = _py(["tests/run_tests.py"], {**base, "OSC_ATHLETE": "demo", "OSC_TEST_CHILD": "1",
                                         "OSC_SCAFFOLD_CHECK": "1"})
        broken = [l for l in r.stdout.splitlines() if l.lstrip().startswith(("FAIL", "ERROR"))]
        assert r.returncode == 0, f"a fresh scaffold fails the engine invariants: {broken or r.stderr[-400:]}"
        r = _py(["scripts/new_athlete.py", "demo"], base)
        assert r.returncode != 0 and "already exists" in r.stderr, "new_athlete.py overwrote an athlete"


# --- fuelling (docs/DESIGN.md (fuelling and score), 2026-11-06) -----------------------------------

_GEL = {"id": "gel-40", "brand": "Test", "name": "Gel 40", "form": "gel", "serving_g": 60, "carbs_g": 40,
        "kcal": 160, "glucose_fructose": "1:0.8", "sodium_mg": None, "caffeine_mg": 0,
        "source": "https://example.org/gel", "source_kind": "maker", "checked": "2026-11-01"}
_MIX = {"id": "mix-95", "brand": "Test", "name": "Mix", "form": "drink_mix", "carbs_per_100g": 95,
        "source": "https://example.org/mix", "source_kind": "label", "checked": "2026-11-01"}


def _fuel_cfg(**over):
    import fuel
    cfg = json.loads(json.dumps(fuel.EMPTY))
    cfg.update({"products": ["gel-40", "mix-95"],
                "recipes": [{"id": "bottle", "product": "mix-95", "powder_g": 60, "water_ml": 750}],
                "gut": {"g_per_h": 60, "since": "2026-11-01", "how": "test"}}, **over)
    return cfg


def test_fuel_products_are_verified_and_complete():
    """nutrition/PRODUCTS.json is what every plan's grams come from. Each product carries its
    carbohydrate, its form, and the https page and date it was read from — never typed from memory
    (memory/convention/fuel-products-verified.md). The checker must refuse an entry without them."""
    import fuel
    raw = json.loads(athlete.PRODUCTS_PATH.read_text())
    ids = [p.get("id") for p in raw["products"]]
    assert len(ids) == len(set(ids)), f"product ids must be unique: {ids}"
    bad = [b for p in raw["products"] for b in fuel.product_problems(p)]
    assert not bad, bad
    assert fuel.catalog()["maurten-gel-160"]["carbs_g"] == 40, "Maurten's page: 40 g per Gel 160"
    assert not fuel.product_problems(_GEL) and not fuel.product_problems(_MIX)
    assert fuel.product_problems({**_GEL, "source": None}), "a product with no source must be refused"
    assert fuel.product_problems({**_GEL, "checked": "2999-01-01"}), "checked in the future"
    assert fuel.product_problems({**_GEL, "source_kind": "memory"}), "an unknown source kind"
    assert fuel.product_problems({**_MIX, "carbs_per_100g": None}), "a drink mix is dosed per 100 g"
    assert fuel.product_problems({**_GEL, "glucose_fructose": "lots"}), "a ratio reads like 1:0.8"


def test_the_carb_rule_is_keyed_on_duration_intensity_and_sport():
    """formulas.carb_band, by hand from the ACSM 2016 and Jeukendrup 2014 bands as approved
    (docs/DESIGN.md (fuelling and score) §4.1). Keyed on duration alone, an easy 75-minute spin would get the same
    grams as a 75-minute threshold session — CLAUDE.md's defect #1."""
    import formulas as f
    band = f.carb_band
    assert band(45, "vo2", "bike") == (0, 0)
    assert band(75, "endurance", "bike") == (0, 0)
    assert band(75, "threshold", "bike") == (30, 30)
    assert band(60, "threshold", "bike") == (30, 30), "60 min is in the 60–90 band"
    assert band(120, "endurance", "bike") == (30, 60)
    assert band(120, "endurance", "run") == (30, 45), "a run takes the lower half of the band"
    assert band(120, "tempo", "bike") == (60, 60)
    assert band(150, "endurance", "bike") == (60, 90), "2.5 h is in the open band"
    assert band(180, "race", "run") == (60, 75)
    assert band(240, "endurance", "swim") == (0, 0)
    for m in (30, 70, 100, 160, 300):
        for i in f.INTENTS:
            assert band(m, i, "run")[1] <= band(m, i, "bike")[1], (m, i)
    try:
        band(120, "hard", "bike")
        raise AssertionError("an unknown intent must be refused, not guessed")
    except ValueError:
        pass
    # 2026-11-22: `fuel.py plan 150 endurance cycling` read "cycling" as on foot (half the band, gels for
    # his bottles), and "lap_swimming" planned a gel in the pool. The rule takes groups only; the command
    # line maps a typeKey through the sport map.
    for key in ("cycling", "virtual_ride", "lap_swimming", "running", "bik"):
        try:
            band(120, "endurance", key)
            raise AssertionError(f"{key!r} is not a group: refused, never read as on foot")
        except ValueError:
            pass
    import sports, fuel
    assert f.SPORT_GROUPS == set(sports.SPORT_GROUP.values()) | {"other"}, "the rule's groups are the sport map's"
    assert [fuel.sport_group(k) for k in ("cycling", "virtual_ride", "gravel_cycling", "lap_swimming", "running", "run", "other")] \
        == ["bike", "bike", "bike", "swim", "run", "run", "other"]
    import argparse
    try:
        fuel.sport_group("bik")
        raise AssertionError("a typo must be refused, not read as on foot")
    except argparse.ArgumentTypeError:
        pass
    assert "2.5 h or more" in f.FUEL_DEFINITIONS["carb_band"], "the sentence puts 2.5 h where the rule does"
    assert f.carb_target(30, 60, "endurance") == 45, "an easy session plans the middle of its band"
    assert f.carb_target(60, 90, "race") == 60, "an untrained gut caps at 60 g/h"
    assert f.carb_target(60, 90, "race", gut_g_h=90) == 90
    assert f.carb_target(60, 90, "endurance", gut_g_h=90) == 75
    assert f.carb_target(60, 90, "race", gut_g_h=70, rehearsal=True) == 80, "a gut-training step is +10"
    assert f.carb_load(70, "A", 330) == {"days": 2, "g_per_kg_day": [8, 10], "g_per_day": [560, 700]}
    assert f.carb_load(70, "B", 115)["days"] == 1, "a B race loads one day"
    assert f.carb_load(70, "B", 75) is None, "no load for a race of 90 minutes or less"
    assert f.pre_race_meal(70)["g"] == [70, 280]
    assert set(f.FUEL_DEFINITIONS) >= {"carb_band", "carb_target", "gut", "carb_load", "pre_race_meal", "taken"}


def test_a_fuel_plan_turns_grams_into_the_athletes_own_products():
    """fuel.plan by hand: bottles first (one an hour at most), then whole gels nearest the rest, the
    first gel at 0:20 and the last 15 minutes before the end, never more than 5 g/h over the gut's
    cap. A bottle of the test recipe is 60 g of powder × 95 % = 57 g."""
    import fuel
    cat = {"gel-40": _GEL, "mix-95": _MIX}
    cfg = _fuel_cfg()
    p = fuel.plan(120, "endurance", "bike", cfg, cat)     # 45 g/h × 2 h = 90 g → 1 bottle (57) + 1 gel (40)
    assert (p["target_g_h"], p["total_g"], p["planned_g"], p["planned_g_h"]) == (45, 90, 97, 48), p
    assert [(i["kind"], i["id"], i["n"], i["g_each"]) for i in p["items"]] == [("recipe", "bottle", 1, 57), ("product", "gel-40", 1, 40)]
    assert [(t["at"], t["id"]) for t in p["timeline"]] == [(0, "bottle"), (65, "gel-40")]
    p = fuel.plan(150, "threshold", "bike", cfg, cat)     # 60 g/h (cap) × 2.5 h = 150 g → 2 bottles + 1 gel
    assert (p["target_g_h"], p["total_g"], p["planned_g"]) == (60, 150, 154), p
    assert [(t["at"], t.get("until"), t["id"]) for t in p["timeline"]] == [(0, 60, "bottle"), (60, 120, "bottle"), (80, None, "gel-40")]
    p = fuel.plan(180, "endurance", "bike", _fuel_cfg(recipes=[]), cat)   # 180 g → 4.5 gels → 4: a half rounds down
    assert (p["total_g"], p["planned_g"]) == (180, 160) and [t["at"] for t in p["timeline"]] == [20, 70, 115, 165], p
    p = fuel.plan(180, "race", "bike", _fuel_cfg(recipes=[], gut={"g_per_h": 70, "since": "2026-11-01"}), cat, rehearsal=True)
    assert (p["target_g_h"], p["planned_g"]) == (80, 240), "a gut-training session plans the next step"
    p = fuel.plan(120, "endurance", "run", cfg, cat)
    assert p["target_g_h"] == 40, "a 2 h easy run: 30–45 g/h, planned at 40"
    p = fuel.plan(45, "vo2", "bike", cfg, cat)
    assert not p["needed"] and not p["items"], "45 minutes needs no fuel"
    p = fuel.plan(120, "endurance", "bike", json.loads(json.dumps(fuel.EMPTY)), cat)
    assert p["setup_needed"] and p["total_g"] == 90 and not p["items"], "no products: grams only, and it says so"
    for m in (70, 100, 150, 200, 330):
        for i in ("endurance", "tempo", "race"):
            q = fuel.plan(m, i, "bike", cfg, cat)
            assert q["planned_g_h"] <= q["target_g_h"] + fuel.OVER_CAP_SLACK_G_H, (m, i, q["planned_g_h"])


_SLOW = {"id": "slow-80", "brand": "Test", "name": "Slow", "form": "drink_mix", "carbs_per_100g": 80,
         "max_g_per_h": 50, "max_g_per_session": 100, "easy_only": True,
         "source": "https://example.org/slow", "source_kind": "maker", "checked": "2026-11-01"}


def _two_mix_cfg(slow_powder=50, **over):
    """Fast listed first on purpose: the slow mix must still go first on an easy session. A fast bottle
    is 42 g × 95 % = 40 g; a slow one 50 g × 80 % = 40 g, a full hour at its maker's 50 g an hour."""
    return _fuel_cfg(products=["gel-40", "mix-95", "slow-80"],
                     recipes=[{"id": "fast", "product": "mix-95", "powder_g": 42, "water_ml": 500},
                              {"id": "slow", "product": "slow-80", "powder_g": slow_powder, "water_ml": 500}], **over)


def test_a_fuel_plan_drinks_each_recipe_within_its_makers_limits():
    """2026-11-06: an athlete owned two drink mixes. The planner used only the first recipe and could not
    know that MNSTRY caps Slow Carb Heat at 46 g of powder an hour and 92 g a session, and says to switch
    to Fast or Power Carb from the third hour — the coach applied it by hand. Now: a mix made for easy
    work goes first on an easy session and never on a hard one; no product goes past its maker's
    limits; a capped bottle is drunk no faster than its hourly limit; the next recipe, then the gels,
    carry the rest; and every product left out is named with its reason."""
    import fuel
    cat = {"gel-40": _GEL, "mix-95": _MIX, "slow-80": _SLOW}
    assert not fuel.product_problems(_SLOW)
    assert fuel.product_problems({**_SLOW, "max_g_per_h": 0}), "a limit is a number above 0"
    assert fuel.product_problems({**_SLOW, "easy_only": "yes"}), "easy_only is true or false"
    assert fuel.product_problems({**_GEL, "max_g_per_session": 120, "serving_g": None}), "a gel's limit needs serving_g"
    assert fuel.catalog()["mnstry-slow-carb-heat"]["max_g_per_session"] == 92, "MNSTRY's page: 92 g a session"

    def kinds(p):
        return [(i["kind"], i["id"], i["n"]) for i in p["items"]]

    p = fuel.plan(180, "endurance", "bike", _two_mix_cfg(), cat)   # 180 g: 2 slow (its limit) + 1 fast + 1 gel
    assert kinds(p) == [("recipe", "slow", 2), ("recipe", "fast", 1), ("product", "gel-40", 1)], p
    assert [(t["at"], t["until"], t["id"]) for t in p["timeline"] if t["kind"] == "recipe"] == \
        [(0, 60, "slow"), (60, 120, "slow"), (120, 180, "fast")]
    assert any("maker's limit" in n for n in p["notes"]), "the limit changed the plan, so it says so"
    p = fuel.plan(150, "endurance", "bike", _two_mix_cfg(), cat)   # 3 bottles in 2.5 h: the slow ones still get an hour
    assert [(t["at"], t["until"], t["id"]) for t in p["timeline"] if t["kind"] == "recipe"] == \
        [(0, 60, "slow"), (60, 120, "slow"), (120, 150, "fast")], p["timeline"]
    p = fuel.plan(180, "threshold", "bike", _two_mix_cfg(), cat)
    assert kinds(p) == [("recipe", "fast", 3), ("product", "gel-40", 1)], "a slow mix is not planned on a hard session"
    assert any("easy sessions" in n for n in p["notes"])
    p = fuel.plan(180, "endurance", "bike", _two_mix_cfg(slow_powder=60), cat)
    assert "slow" not in [i["id"] for i in p["items"]], "60 g of powder a bottle is over its 50 g an hour"
    assert any("over the maker's" in n for n in p["notes"])
    p = fuel.plan(120, "endurance", "bike", _two_mix_cfg(), cat)   # 80 g: two slow bottles, no limit reached
    assert kinds(p) == [("recipe", "slow", 2)] and not p["notes"], p
    capped_gel = {**_GEL, "max_g_per_session": 120}                 # 2 servings of 60 g
    p = fuel.plan(300, "endurance", "bike", _fuel_cfg(recipes=[]), {"gel-40": capped_gel, "mix-95": _MIX})
    assert kinds(p) == [("product", "gel-40", 2)] and any("limit" in n for n in p["notes"]), p
    for m in (70, 100, 130, 150, 200, 260, 330):
        for i in ("recovery", "endurance", "tempo", "race"):
            q = fuel.plan(m, i, "bike", _two_mix_cfg(), cat)
            slow = [t for t in q["timeline"] if t["id"] == "slow"]
            assert len(slow) <= fuel.allowance(_SLOW, 50, m), (m, i, "past the session limit")
            assert all(t["until"] - t["at"] >= 60 for t in slow), (m, i, "a slow bottle drunk faster than 50 g an hour")
            assert not (slow and i in ("tempo", "race")), (m, i, "a slow mix on a hard session")
            assert q["planned_g_h"] <= q["target_g_h"] + fuel.OVER_CAP_SLACK_G_H, (m, i, q["planned_g_h"])


def test_on_foot_the_fuel_plan_is_gels_not_bottles():
    """A run plan put bottles on the run (2026-11-06: the 70.3 run came out as 2 bottles + 1 gel). On
    foot the plan is gels; only someone with no gel gets a bottle — a flask — and the plan says so."""
    import fuel, sports
    cat = {"gel-40": _GEL, "mix-95": _MIX, "slow-80": _SLOW}
    p = fuel.plan(120, "endurance", "run", _two_mix_cfg(), cat)     # 40 g/h × 2 h = 80 g → 2 gels
    assert [(i["kind"], i["id"], i["n"]) for i in p["items"]] == [("product", "gel-40", 2)], p
    assert p["notes"] == ["on foot: gels, not bottles"], p["notes"]
    p = fuel.plan(115, "race", "run", _fuel_cfg(products=["mix-95"]), cat)
    assert [i["kind"] for i in p["items"]] == ["recipe"] and any("flask" in n for n in p["notes"]), p
    p = fuel.plan(75, "race", sports.group("cardio_training"), _two_mix_cfg(), cat)   # a HYROX circuit is "other": on foot too
    assert {i["kind"] for i in p["items"]} == {"product"}, p


def test_fuel_setup_and_the_intake_log_are_well_formed():
    """athletes/<name>/fuel.json and logs/fuel.json, when they exist, pass their checks. And the
    rules behind them: setup answers are dated and checked against the catalog; someone who takes
    nothing today starts the gut ramp at 30 g/h; an item names its kind (a recipe id and a product
    id could be the same word); a record keeps each item's grams as they were that day."""
    import fuel
    cat = fuel.catalog()
    if A.fuel_path.exists():
        assert not fuel.cfg_problems(fuel.load_cfg(A), cat), fuel.cfg_problems(fuel.load_cfg(A), cat)
    if A.fuel_log_path.exists():
        bad = fuel.log_problems(fuel.load_log(A), fuel.load_cfg(A), cat)
        assert not bad, bad

    cat = {"gel-40": _GEL, "mix-95": _MIX}
    empty = json.loads(json.dumps(fuel.EMPTY))
    assert fuel.setup_missing(empty, cat) == ["products", "recipes", "gut", "caffeine"]
    cfg = fuel.apply_setup(empty, {"products": ["gel-40", "mix-95"], "gut": 0, "caffeine": "races"}, cat,
                           today=dt.date(2026, 11, 6))
    assert cfg["gut"]["g_per_h"] == fuel.GUT_START_G_H and cfg["setup"]["gut"] == "2026-11-06"
    assert fuel.setup_missing(cfg, cat) == ["recipes"], "a drink mix with no recipe keeps the question open"
    cfg = fuel.apply_setup(cfg, {"recipes": [{"id": "bottle", "product": "mix-95", "powder_g": 60, "water_ml": 750}]}, cat)
    assert fuel.setup_missing(cfg, cat) == [] and not fuel.cfg_problems(cfg, cat)
    for wrong in ({"products": ["nope"]}, {"caffeine": "lots"}, {"favourite": "gels"},
                  {"recipes": [{"id": "gel-40", "product": "mix-95", "powder_g": 60, "water_ml": 750}]},
                  {"recipes": [{"id": "b", "product": "gel-40", "powder_g": 60, "water_ml": 750}]}):
        try:
            fuel.apply_setup(cfg, wrong, cat)
            raise AssertionError(f"setup accepted {wrong}")
        except ValueError:
            pass

    act = {"activityId": 11, "startTimeLocal": "2026-11-06 10:00:00", "movingDuration": 7200}
    rec = fuel.record(act, [fuel.parse_item("recipe:bottle:2"), fuel.parse_item("product:gel-40:1")], cfg, cat)
    s = fuel.summary(rec, act)
    assert (s["g"], s["g_h"], rec["source"]) == (154, 77, "you"), s
    stronger = fuel.apply_setup(cfg, {"recipes": [{"id": "bottle", "product": "mix-95", "powder_g": 80, "water_ml": 750}]}, cat)
    assert fuel.summary(rec, act)["g"] == 154 and fuel.item_grams("recipe", "bottle", stronger, cat) == 76, \
        "a changed recipe must not rewrite what was taken before"
    assert not fuel.log_problems({"records": [rec]}, cfg, cat)
    assert fuel.log_problems({"records": [rec, rec]}, cfg, cat), "one record per activity"
    assert fuel.log_problems({"records": [{**rec, "items": [{"kind": "recipe", "id": "gel-40", "n": 1, "g_each": 40}]}]}, cfg, cat)
    for spec in ("gel-40:1", "product:gel-40:0", "snack:gel-40:1"):
        try:
            fuel.parse_item(spec)
            raise AssertionError(f"parse_item accepted {spec!r}")
        except ValueError:
            pass


def test_the_fuel_card_gets_its_cues_hours_marks_and_ramp_from_the_engine():
    """The redesigned fuel card (handoff 2026-11-07, FUEL-SCORE-DATA.md) draws cues, grams per clock
    hour, each product's mark and why the plan rounded down — computed here so the page adds nothing.
    By hand, on the test pantry (a 57 g bottle, a 40 g gel), 120 min easy: 1 bottle 0:00–1:00, a gel at
    1:05 → 57 g in hour one, 40 in hour two. Gels only for 3 h: 4 gels, 53 g/h; a fifth would be 200 g,
    67 g/h, 7 over a 60 gut, past the slack — so the plan says why it rounded down."""
    import fuel
    cat = {"gel-40": _GEL, "mix-95": _MIX}
    cfg = _fuel_cfg()
    p = fuel.plan(120, "endurance", "bike", cfg, cat)
    assert [(c["at"], c["label"]) for c in p["cues"]] == [(0, "Mix"), (65, "Gel 40")], p["cues"]
    assert [h["g"] for h in p["per_hour_grams"]] == [57, 40], p["per_hour_grams"]
    assert p["alternatives"] == [] and p["over_cap_g_h"] == 0, "48 g/h meets the 45 target: nothing to explain"
    q = fuel.plan(180, "endurance", "bike", _fuel_cfg(recipes=[]), cat)   # 4 gels = 160 g, 53 g/h against 60
    assert q["alternatives"] == [{"grams": 200, "g_h": 67, "over_cap_by": 7, "rejected": "over_gut"}], q["alternatives"]
    marks = {i["id"]: i["display"] for i in p["items"]}
    assert marks["gel-40"] == {"slot": "gel", "mono": "GEL", "shape": "gel"} and marks["bottle"]["shape"] == "bottle", marks
    p = fuel.plan(150, "threshold", "bike", cfg, cat)
    assert [c["label"] for c in p["cues"]] == ["Mix", "2nd Mix", "Gel 40"] and p["over_cap_g_h"] == 2, (p["cues"], p["over_cap_g_h"])
    # The ramp: a logged 90-minute ride at or above the gut since it was set counts toward the next step.
    log = {"records": [{"activity_id": 1, "date": "2026-11-02", "items": [{"kind": "product", "id": "gel-40", "n": 3, "g_each": 40}]},
                       {"activity_id": 2, "date": "2026-11-03", "items": [{"kind": "product", "id": "gel-40", "n": 2, "g_each": 40}]},
                       {"activity_id": 3, "date": "2026-11-04", "items": [{"kind": "product", "id": "gel-40", "n": 1, "g_each": 40}]}]}
    acts = {1: {"duration": 7200, "_group": "bike"}, 2: {"duration": 7200, "_group": "bike"}, 3: {"duration": 3000, "_group": "run"}}
    r = fuel.ramp(cfg, log, acts)
    assert [(x["activity_id"], x["g_h"], x["counted"]) for x in r["history"]] == [(1, 60, True), (2, 40, False)], r["history"]
    assert (r["current_g_h"], r["next_g_h"], r["counted_at_current"], r["steps"]) == (60, 70, 1, [60, 70, 80, 90]), r
    assert fuel.ramp(json.loads(json.dumps(fuel.EMPTY)), log, acts) is None, "no gut set, no ramp"


def test_what_isnt_in_the_catalog_can_still_be_logged():
    """His 11-07 ride: he took bars, which no setup lists, and the log had nowhere to put them. Anything
    can be logged — a catalog product he doesn't own, or something else by name with the carbohydrate
    he read off its label (self-reported, capped at 150 g a unit) — and its grams stay as logged."""
    import fuel
    cat = {"gel-40": _GEL, "mix-95": _MIX}
    cfg = _fuel_cfg(products=["mix-95"])
    assert [o["id"] for o in fuel.others(cfg, cat)] == ["gel-40"], "a gel he doesn't own can still be logged"
    act = {"activityId": 7, "startTimeLocal": "2026-11-07 09:00:00", "duration": 10800}
    rec = fuel.record(act, [("product", "gel-40", 1)], cfg, cat, custom=[fuel.parse_custom("Clif Bar|44|2")])
    d = fuel.describe(rec, act, cfg, cat)
    assert (d["g"], d["g_h"]) == (128, 43) and d["items"][1]["kind"] == "custom" and d["items"][1]["label"] == "Clif Bar", d
    assert not fuel.log_problems({"records": [rec]}, cfg, cat)
    for bad in ("Clif Bar|400|1", "|40|1", "Bar|40|0", "Bar 40 1"):
        try:
            fuel.parse_custom(bad)
            raise AssertionError(f"parse_custom accepted {bad!r}")
        except ValueError:
            pass
    try:
        fuel.parse_item("custom:clif:1")
        raise AssertionError("a custom item goes through --custom, never --item")
    except ValueError:
        pass


def test_an_unfinished_setup_is_asked_for_when_a_session_is_bound():
    """The rule (2026-11-06): the setup questions are asked when a session is bound to the
    athlete — the banner use.py and the SessionStart hook print says so, and the daily asks. Until
    every question is answered, the line stays; once they are, it goes."""
    import tempfile
    import fuel
    import setup_status
    from whoami import banner
    with tempfile.TemporaryDirectory() as tmp:
        root = scratch_athletes(Path(tmp), ["ann"])
        ann = athlete.Athlete("ann", root / "ann")
        m = setup_status.missing(ann)
        assert [s["section"] for s in m][0] == "safety", "safety is asked first, before anything else"
        import consent
        consent.record(ann, {"adult": True, "accepted": True, "screen": {k: False for k in consent.SCREEN}})
        ann = athlete.Athlete("ann", root / "ann")
        m = [s for s in setup_status.missing(ann) if s["section"] != "sources"]
        assert [s["section"] for s in m] == ["fuel"] and len(m[0]["questions"]) == 4, m
        assert "fuelling (4 questions)" in banner(ann, full=True)
        cat = fuel.catalog()
        cfg = fuel.apply_setup(json.loads(json.dumps(fuel.EMPTY)),
                               {"products": ["maurten-gel-160"], "gut": 60, "caffeine": "never"}, cat)
        ann.fuel_path.write_text(json.dumps(cfg))
        assert [s for s in setup_status.missing(ann) if s["section"] == "fuel"] == [], \
            "a gel only — no drink mix, so no recipe to ask for"
        if not [s for s in setup_status.missing(ann) if s["section"] == "sources"]:
            assert "Setup to finish" not in banner(ann, full=True)
        ann.fuel_path.write_text("{not json")
        assert "Setup check failed" in banner(ann, full=True), "a broken setup must not break the banner"



# --- the execution score (docs/DESIGN.md (fuelling and score) §5) -----------------------------------
# Synthetic sets only, keyed on a pair no program prescribes, so the engine is checked the same way
# for every athlete and no warm-up rule or logging class can touch the arithmetic.

_LIFT = ("TEST", "SCORE_LIFT")


def _rest(secs):
    return {"setType": "REST", "duration": float(secs)}


def _row(sets, value, weight, rest=100, kind="reps", key=_LIFT, exid="T1"):
    return (exid, "test lift", key[0], key[1], sets, value, weight, rest, kind)


def _with_rests(sets, secs=100):
    out = []
    for s in sets:
        out += [s, _rest(secs)]
    return out


def _strength(raw, rows, ann=None, **kw):
    import session_score as sc
    return sc.strength_parts(raw, rows, ann, two_db=set(), unilateral=set(), **kw)


def test_score_a_strength_session_by_sets_reps_load_and_rest():
    """By hand: 3 × 10 @ 50 asked; a 40 ramp, then 50×10, 50×10, 50×8, 100 s rests. The heaviest three
    are the planned sets (the ramp adds nothing): sets 1, reps (1+1+0.8)/3, load 1, rest 2 of 2 in band.
    Total = (35 + 25×0.933 + 25 + 10) / 95 → 98."""
    import session_score as sc
    raw = _with_rests([_set(*_LIFT, 40, 10), _set(*_LIFT, 50, 10), _set(*_LIFT, 50, 10), _set(*_LIFT, 50, 8)])
    r = _strength(raw, [_row(3, 10, 50)])
    assert r["scores"] == {"sets": 1.0, "reps": (1 + 1 + 0.8) / 3, "load": 1.0, "rest": 1.0}, r["scores"]
    out = sc.assemble("strength", r["scores"], r["coverage"], "test", detail=r["detail"])
    assert (out["total"], out["band"]) == (98, "as_planned"), (out["total"], out["band"])
    assert out["out_of"] == 95 and abs(sum(p["points"] for p in out["parts"]) / out["out_of"] * 100 - 98.2) < 0.2, \
        "points earned ÷ the weight that could be scored is the total"
    assert out["summary"] and out["parts"][1]["planned_text"] == "30 reps" and out["parts"][1]["done_text"] == "28 reps", out["parts"][1]


def test_score_load_over_the_ask_is_flagged_never_rewarded():
    """+20 % is capped at 1 and flagged; near double says suspect the implement — the 09-21 incident,
    where a key/implement mismatch read 65 kg of dumbbells."""
    r = _strength(_with_rests([_set(*_LIFT, 60, 10)]), [_row(1, 10, 50)])
    assert r["scores"]["load"] == 1.0 and "+20 %" in r["flags"][0]["text"], r
    r = _strength(_with_rests([_set(*_LIFT, 95, 10), _set(*_LIFT, 95, 10)]), [_row(2, 10, 50)])
    assert len(r["flags"]) == 1 and "near double" in r["flags"][0]["text"], "one flag per exercise, not per set"


def test_score_sets_the_watch_could_not_name_are_not_a_miss():
    """One named set of three, plus two the watch could not name: the two missing sets may be those,
    so they leave the denominator and the coverage instead — 1 of 3 judged, no total shown."""
    import session_score as sc
    blank = {"setType": "ACTIVE", "weight": 50000.0, "repetitionCount": 10, "exercises": [{}]}
    r = _strength(_with_rests([_set(*_LIFT, 50, 10), blank, blank]), [_row(3, 10, 50)])
    assert r["scores"]["sets"] == 1.0 and abs(r["coverage"] - 1 / 3) < 1e-9, (r["scores"], r["coverage"])
    out = sc.assemble("strength", r["scores"], r["coverage"], "test")
    assert out["total"] is None and out["band"] == "unclear", out


def test_score_annotations_drop_load_on_another_machine_and_the_exercise_otherwise():
    """machine_change: the same discs on another machine are another resistance — load is 'not
    comparable', sets and reps still count. Any other annotated type takes the exercise out."""
    raw = _with_rests([_set(*_LIFT, 30, 10)] * 2)
    r = _strength(raw, [_row(2, 10, 50)], {"type": "machine_change", "exercises": [list(_LIFT)]})
    assert "load" not in r["scores"] and r["scores"]["sets"] == 1.0, r["scores"]
    assert r["rows"][0]["load_dropped"], r["rows"]
    other = ("TEST", "OTHER_LIFT")
    raw += _with_rests([_set(*other, 10, 10)])
    r = _strength(raw, [_row(2, 10, 50), _row(2, 10, 10, key=other, exid="T2")],
                  {"type": "data_error", "exercises": [list(_LIFT)]})
    assert r["rows"][0]["dropped"] and r["coverage"] == 0.5 and r["scores"]["sets"] == 0.5, (r["rows"], r["coverage"])


def test_score_per_side_sets_reps_without_reps_and_bodyweight_lifts():
    """A per-side hold logs two sets per planned set, each side scored. A reps set with no reps logged
    cannot be told from a lap pressed through: not done. A weighted pull-up at 0 added against a 5 kg
    ask, at 85 kg, is 85/90 of the load — not a total miss (he logs 0 when the shared belt is taken)."""
    raw = _with_rests([_hold(*_LIFT, 0, 30), _hold(*_LIFT, 0, 30), _hold(*_LIFT, 0, 15), _hold(*_LIFT, 0, 15)])
    r = _strength(raw, [_row(2, 30, None, kind="time_per_side")])
    assert r["scores"]["sets"] == 1.0 and r["scores"]["reps"] == 0.75, r["scores"]
    raw = _with_rests([{**_set(*_LIFT, 50, 0), "repetitionCount": None}])
    r = _strength(raw, [_row(1, 10, 50)])
    assert r["scores"]["sets"] == 0.0 and r["rows"][0]["blank_sets"] == 1, r
    pull = ("PULL_UP", "WEIGHTED_WIDE_GRIP_PULL_UP")
    r = _strength(_with_rests([_set(*pull, 0, 10)]), [_row(1, 10, 5, key=pull)], body_kg=85)
    assert abs(r["scores"]["load"] - 85 / 90) < 1e-9, r["scores"]


def test_score_a_ride_against_its_intent_duration_pacing_and_fuel():
    """An endurance hour at 150 W off a 250 W FTP (band 140–188): intent, duration and pacing full.
    50 % over the planned time scores duration 0. A 0 g fuel plan asks for nothing; a 100 g plan with
    50 g taken scores 0.5; a note with no grams drops out. With no intent, coverage is 35 of 75 and
    no total is shown."""
    import session_score as sc
    plan = {"intent": "endurance", "duration_min": 60}
    kw = dict(p1=[150.0] * 3600, speed1=None, hr_zones=[], ftp=250, grp="bike", fuel_taken=None)
    r = sc.endurance_parts(plan, {"vi": {"value": 1.02}}, moving_s=3600, fuel_plan={"total_g": 0}, **kw)
    assert r["scores"] == {"intent": 1.0, "duration": 1.0, "pacing": 1.0} and r["coverage"] == 1.0, r
    r = sc.endurance_parts(plan, {"vi": {"value": 1.02}}, moving_s=5400, fuel_plan=None, **kw)
    assert r["scores"]["duration"] == 0.0, r["scores"]
    kw["fuel_taken"] = {"items": [{"n": 1}], "g": 50}
    r = sc.endurance_parts(plan, {}, moving_s=3600, fuel_plan={"total_g": 100}, **kw)
    assert r["scores"]["fuel"] == 0.5 and r["dropped"]["pacing"], r
    kw["fuel_taken"] = {"items": [], "g": 0, "note": "two bars"}
    r = sc.endurance_parts(plan, {}, moving_s=3600, fuel_plan={"total_g": 100}, **kw)
    assert "fuel" not in r["scores"] and "no grams" in r["dropped"]["fuel"], r
    r = sc.endurance_parts({"duration_min": 60}, {"vi": {"value": 1.0}}, moving_s=3600, fuel_plan=None,
                           **(kw | {"fuel_taken": None}))
    assert abs(r["coverage"] - 35 / 75) < 1e-9, r
    assert sc.assemble("endurance", r["scores"], r["coverage"], "t", dropped=r["dropped"])["total"] is None


def test_score_an_interval_ride_counts_work_and_skips_pacing():
    """2 × 60 s asked at 300–310 W, ridden at 310 W: the work is found (3-second power, 20 s or more),
    and a 15-second sprint is not interval work. Pacing is not scored on an interval ride."""
    import session_score as sc
    p1 = [100.0] * 300 + [310.0] * 60 + [100.0] * 60 + [310.0] * 60 + [100.0] * 60 + [600.0] * 15 + [100.0] * 200
    plan = {"intent": "vo2", "duration_min": 13, "work": [{"reps": 2, "secs": 60, "target": [300, 310]}]}
    r = sc.endurance_parts(plan, {"if": {"value": 0.9}, "vi": {"value": 1.3}}, p1=p1, speed1=None, hr_zones=[],
                           ftp=250, moving_s=len(p1), fuel_plan=None, fuel_taken=None, grp="bike")
    assert 115 <= r["detail"]["intervals"]["done_s"] <= 120, r["detail"]["intervals"]
    assert "pacing" not in r["scores"] and "pacing" not in r["dropped"], r
    assert r["scores"]["intent"] == 1.0 and r["scores"]["duration"] == 1.0, r["scores"]


def test_score_a_skipped_exercise_caps_the_session_at_mostly():
    """Calibrated 2026-11-07: 11-02 cut two whole exercises (7 of 31 sets) and still read 90 As planned.
    A planned exercise not started now caps the total at 84 — unless the watch logged enough unnamed
    sets that the 'skipped' exercise may be them."""
    import formulas
    import session_score as sc
    other = ("TEST", "OTHER_LIFT")
    rows = [_row(3, 10, 50), _row(1, 10, 10, key=other, exid="T2")]
    raw = _with_rests([_set(*_LIFT, 50, 10)] * 3)
    r = _strength(raw, rows)
    assert r["skipped"] == ["test lift"] and r["scores"]["sets"] == 0.75, r
    out = sc.assemble("strength", r["scores"], r["coverage"], "t", cap=(formulas.SKIPPED_CAP, "x"))
    assert out["total"] == 84 and out["band"] == "mostly" and out["capped"]["from"] > 84, out
    blank = {"setType": "ACTIVE", "weight": 10000.0, "repetitionCount": 10, "exercises": [{}]}
    r = _strength(raw + _with_rests([blank]), rows)
    assert r["skipped"] == [], "one unnamed set may be the one-set exercise: not called skipped"


def test_score_time_under_an_easy_band_counts_half():
    """Calibrated 2026-11-07 (his words: a full miss 'sounds very extreme'): an endurance hour ridden at
    100 W, under the 140–188 W band, scores 0.5 / 0.85 on intent; over the band still scores nothing."""
    import session_score as sc
    kw = dict(speed1=None, hr_zones=[], ftp=250, grp="bike", fuel_taken=None, fuel_plan=None, moving_s=3600)
    plan = {"intent": "endurance", "duration_min": 60}
    r = sc.endurance_parts(plan, {"vi": {"value": 1.0}}, p1=[100.0] * 3600, **kw)
    assert abs(r["scores"]["intent"] - 0.5 / 0.85) < 1e-3, r["scores"]
    r = sc.endurance_parts(plan, {"vi": {"value": 1.0}}, p1=[230.0] * 3600, **kw)
    assert r["scores"]["intent"] == 0.0, r["scores"]
    hr = [{"zone": 1, "low": 97, "high": 118, "secs": 3000}, {"zone": 2, "low": 118, "high": 138, "secs": 600}]
    r = sc.endurance_parts(plan, {}, p1=None, **(kw | {"hr_zones": hr}))
    assert abs(r["scores"]["intent"] - min(1.0, (600 / 3600 + 0.5 * 3000 / 3600) / 0.85)) < 1e-3, r["scores"]

def test_fuel_taken_exactly_as_planned_scores_full():
    """2026-11-10 audit: a 3-hour plan asked 180 g and its own bottles and gel summed to 160 g, so a
    perfect day scored 0.89. The fuel part is scored on what the plan's products deliver when that is
    under the target, and still on the target when the products overshoot it."""
    import session_score as sc
    kw = dict(p1=None, speed1=None, hr_zones=[], ftp=None, grp="bike", moving_s=3600)
    take = lambda g: {"items": [{"n": 1}], "g": g}   # noqa: E731
    r = sc.endurance_parts({}, {}, fuel_plan={"total_g": 180, "planned_g": 160}, fuel_taken=take(160), **kw)
    assert r["scores"]["fuel"] == 1.0 and r["detail"]["fuel"]["planned_g"] == 160, r
    r = sc.endurance_parts({}, {}, fuel_plan={"total_g": 180, "planned_g": 160}, fuel_taken=take(80), **kw)
    assert r["scores"]["fuel"] == 0.5, r["scores"]
    r = sc.endurance_parts({}, {}, fuel_plan={"total_g": 265, "planned_g": 280}, fuel_taken=take(265), **kw)
    assert r["scores"]["fuel"] == 1.0, r["scores"]
    r = sc.endurance_parts({}, {}, fuel_plan={"total_g": 100, "planned_g": 0}, fuel_taken=take(50), **kw)
    assert r["scores"]["fuel"] == 0.5, "a grams-only plan (no products set up) is scored on its target"


def _watch_run(steps):
    return {"workoutName": "Run · Test", "sportType": {"sportTypeKey": "running"}, "estimatedDurationInSecs": 2400,
            "workoutSegments": [{"workoutSteps": steps}]}


def _watch_step(secs=None, hr=None):
    s = {"type": "ExecutableStepDTO", "endCondition": {"conditionTypeKey": "time" if secs else "lap.button"},
         "endConditionValue": secs, "targetType": {"workoutTargetTypeKey": "heart.rate.zone" if hr else "no.target"}}
    return s | ({"targetValueOne": hr[0], "targetValueTwo": hr[1]} if hr else {})


def test_a_watch_run_is_scored_on_its_own_heart_rate_target():
    """2026-11-10 audit: plan.json holds only what never reaches the watch, so every run done from a
    watch workout read "nothing was planned". It is scored on the workout's own HR range (his easy cap
    is 150; Z2 ends at 137), inside that step's window, and a workout with no HR target says so."""
    import formulas as f
    import session_score as sc
    w = _watch_run([_watch_step(300), _watch_step(1800, (118, 150)), _watch_step(300)])
    plan = sc.watch_target(w, threshold_hr=170)
    assert plan["hr_band"] == [118, 150] and plan["hr_window"] == [300, 2100] and plan["duration_min"] == 40, plan
    assert plan["intent"] == "endurance" and sc.watch_target(w)["intent"] is None, "a cap under threshold HR is easy; no threshold, no intent"
    assert f.hr_target_intent(170, 170) is None
    assert sc.watch_target(_watch_run([_watch_step(600), _watch_step(None)])) is None, "no HR target: nothing to score against"
    # after a lap-button step the target step's start is unknown: the whole run is read
    assert sc.watch_target(_watch_run([_watch_step(None), _watch_step(1800, (118, 150))]))["hr_window"] is None
    kw = dict(p1=None, speed1=None, hr_zones=[], ftp=None, grp="run", moving_s=2400, fuel_plan=None, fuel_taken=None)
    # a warm-up at 100 bpm is outside the window and costs nothing; 145 bpm is in his band, over Z2
    r = sc.endurance_parts(plan, {}, hr1=[100.0] * 300 + [145.0] * 1800 + [100.0] * 300, **kw)
    assert r["scores"]["intent"] == 1.0 and r["detail"]["intent"]["band"] == [118, 150], r
    r = sc.endurance_parts(plan, {}, hr1=[100.0] * 300 + [160.0] * 1800 + [100.0] * 300, **kw)
    assert r["scores"]["intent"] == 0.0, "over the cap scores nothing"
    r = sc.endurance_parts(plan, {}, hr1=[100.0] * 2400, **kw)
    assert abs(r["scores"]["intent"] - 0.5 / 0.85) < 1e-3, "under an easy target counts half"
    r = sc.endurance_parts(plan, {}, hr1=None, **kw)
    assert "intent" not in r["scores"] and r["dropped"]["intent"], r


def test_a_watch_run_from_a_replaced_workout_is_not_scored_on_todays_file():
    """An upload always makes a new id, so an activity carrying an older workoutId ran an older
    prescription. Scoring it on the file now on disk would be a number from another context."""
    import session_score as sc
    plan, why = sc.watch_session({"workoutId": 1})
    assert plan is None and "replaced" in why, why
    plan, why = sc.watch_session({})
    assert plan is None and "Nothing was planned" in why, why


def test_the_weight_series_keeps_only_this_seasons_points():
    """2026-11-10 audit: the label has no year, and two 2025 weigh-ins printed beside this October's."""
    import datetime as dt
    import export_dashboard_data as ed_
    dwl = [{"calendarDate": d, "weight": 84300.0} for d in ("2025-11-30", "2025-12-20", "2026-10-11", "2026-10-18")]
    assert [p["date"] for p in ed_.body_series(dwl, dt.date(2026, 11, 10))] == ["10-11", "10-18"]
    assert ed_.body_series(dwl, dt.date(2027, 6, 1)) == []


def test_a_past_session_keeps_the_gut_rate_of_its_day():
    """App audit 2026-11-10: the gut rate was corrected from 60 to 40 g/h, and a ride done three days
    earlier re-scored itself against the new plan (73 where it had been 70). A changed rate keeps the
    old one with its date, and a session's plan is read at the rate in force on the session's day."""
    import datetime as dt
    import fuel
    cat = {p["id"]: p for p in (_GEL, _MIX)}
    cfg = _fuel_cfg(gut={"g_per_h": 60, "since": "2026-11-06", "how": "test"})
    new = fuel.apply_setup(cfg, {"gut": 40}, cat, today=dt.date(2026, 11, 10))
    assert new["gut"]["g_per_h"] == 40 and new["gut"]["history"] == [{"g_per_h": 60, "since": "2026-11-06"}], new["gut"]
    ride = {"intent": "endurance", "duration_min": 180, "sport": "cycling"}
    assert fuel.for_session(ride | {"date": "2026-11-07"}, new, cat)["gut_g_h"] == 60
    assert fuel.for_session(ride | {"date": "2026-11-14"}, new, cat)["gut_g_h"] == 40
    assert fuel.for_session(ride | {"date": "2026-11-01"}, new, cat)["gut_g_h"] == 60, "before any rate: the earliest on record"
    assert fuel.for_session(ride, new, cat)["gut_g_h"] == 40, "no date: today's rate"
    same = fuel.apply_setup(new, {"gut": 40}, cat, today=dt.date(2026, 11, 12))
    assert same["gut"]["history"] == new["gut"]["history"], "the same rate again adds no history"


def test_zone_shares_are_of_the_session_not_of_the_zones_sum():
    """App audit 2026-11-10: Garmin counts no time under zone 1. On an easy 198-minute ride the zones
    summed to 76 minutes, and the page printed "Z1 98 %" for 38 % of the ride. The score reads the same
    time: under zone 1 is under the band too."""
    import endurance_metrics as em
    import session_score as sc
    raw = [{"zoneNumber": 1, "zoneLowBoundary": 97, "secsInZone": 4475}, {"zoneNumber": 2, "zoneLowBoundary": 118, "secsInZone": 114},
           {"zoneNumber": 3, "zoneLowBoundary": 138, "secsInZone": 0}]
    assert [z["pct"] for z in em.zones(raw, "bpm", 11895)] == [38, 1, 0]
    assert [z["pct"] for z in em.zones(raw, "bpm")] == [98, 2, 0], "with no duration, a share of the zones' sum"
    kw = dict(p1=None, speed1=None, ftp=None, grp="bike", fuel_plan=None, fuel_taken=None, moving_s=11895)
    r = sc.endurance_parts({"intent": "endurance"}, {}, hr_zones=em.zones(raw, "bpm", 11895), **kw)
    d = r["detail"]["intent"]
    assert (d["in"], d["under"], d["over"]) == (0.01, 0.99, 0.0), d
    hard = [{"zone": 2, "low": 118, "high": 138, "secs": 1800}, {"zone": 3, "low": 138, "high": 155, "secs": 1800}]
    d = sc.endurance_parts({"intent": "endurance"}, {}, hr_zones=hard, **(kw | {"moving_s": 3600}))["detail"]["intent"]
    assert (d["in"], d["under"], d["over"]) == (0.5, 0.0, 0.5), d


def test_an_annotation_belongs_to_the_days_gym_session_only():
    """App audit 2026-11-10: annotations are keyed by date, and the 11-07 gravel ride's page showed the
    note about seated lateral raises from that afternoon's gym session."""
    import app_data
    ann = {"type": "data_error", "note": "Lateral raises were done seated."}
    act = lambda tk, i=1: {"activityId": i, "activityType": {"typeKey": tk}}   # noqa: E731
    assert app_data._annotation_for(ann, act("strength_training")) == ann
    assert app_data._annotation_for(ann, act("gravel_cycling")) is None
    assert app_data._annotation_for(ann, act("tennis_v2")) is None
    assert app_data._annotation_for(None, act("strength_training")) is None
    named = {"type": "backoff", "note": "Hyrox (activity 21000000777): every run leg was 500 m."}
    assert app_data._annotation_for(named, act("indoor_cardio", 21000000777)) == named
    assert app_data._annotation_for(named, act("strength_training", 7)) is None, "it names another activity"


def test_a_race_predictor_says_when_it_was_missed_or_comes_after_the_race():
    """App audit 2026-11-10: HYROX on 12 Nov listed "400 m flat out (Fri 6 Nov)" — never run — and
    "5 km time trial (Wed 18 Nov)", six days after the race it was said to predict."""
    import types
    import app_data
    prog = types.SimpleNamespace(BENCHMARKS=[
        {"id": "400m", "name": "400 m", "sport": "running", "due": "2026-11-06", "unit": "time", "results": []},
        {"id": "5k", "name": "5 km", "sport": "running", "due": "2026-11-18", "unit": "time", "results": []},
        {"id": "css", "name": "CSS", "sport": "lap_swimming", "due": "2026-11-01", "unit": "time",
         "results": [{"date": "2026-11-01", "value": "1:45"}]}])
    A_ = types.SimpleNamespace(program=prog)
    race = {"id": "r", "date": "2026-11-12", "kind": "hyrox", "priority": "B", "benchmarks": ["400m", "5k", "css"]}
    real = app_data.TODAY
    app_data.TODAY = lambda: dt.date(2026, 11, 10)
    try:
        got = {b["id"]: b["timing"] for b in app_data._race_benchmarks(race, A_)}
    finally:
        app_data.TODAY = real
    assert got == {"400m": "overdue", "5k": "after_race", "css": None}, got


def test_the_app_says_enforced_only_where_a_check_holds_the_fact():
    """UX review 2026-11-10: About me showed "Enforced by a check" on every memory, because a fact whose
    file says `enforced_by: none — descriptive` reached the page as text. The view gives None for those."""
    import app_data
    import build_memory_index as bmi
    facts = app_data.run_view("memory")["facts"]
    for f in facts:
        raw = str(bmi.frontmatter(A.memory_dir / f["file"]).get("enforced_by") or "")
        held = bool(raw) and not raw.strip().lower().startswith("none")
        assert bool(f["enforced_by"]) == held, f"{f['file']}: the app says enforced={bool(f['enforced_by'])}, the file says {raw!r}"


def test_a_gym_sessions_page_carries_its_core_block_as_planned():
    """UX review 2026-11-10: the workout page's plan held the day's main lifts only, so every core
    exercise read "Planned —" under the watch's name. The core block (LEAD) is prescribed too."""
    import app_data
    import build_workouts as bw
    row = next((s for s in app_data.run_view("sessions")["sessions"] if s.get("kind") == "strength" and s.get("day") in bw.LEAD), None)
    if row is None:
        return   # no gym session of a day with a core block in this athlete's cache
    planned = app_data.run_view("workout", str(row["id"]))["planned"]["exercises"]
    block = bw.LEAD[row["day"]]["block"]
    assert [(e["category"], e["name"]) for e in planned[:len(block)]] == [(e[2], e[3]) for e in block], "the core block opens the plan"
    assert all(e["phase"] == "core" for e in planned[:len(block)])
    assert not any(n in why for why in __import__("session_score").NOT_SCORED_GROUPS.values() for n in (".md", "Phase")), "no file names on the page"


def test_score_bands():
    import formulas
    assert formulas.score_band(85, 1.0)[0] == "as_planned" and formulas.score_band(84, 1.0)[0] == "mostly"
    assert formulas.score_band(50, 1.0)[0] == "partly" and formulas.score_band(49, 1.0)[0] == "off_plan"
    assert formulas.score_band(95, 0.59)[0] == "unclear"
    assert set(formulas.SCORE_DEFINITIONS) >= set(formulas.SCORE_WEIGHTS["strength"]) | set(formulas.SCORE_WEIGHTS["endurance"])

# --- sources: Garmin, the athlete's own files, Strava's MCP (scripts/sources.py) -----------------------
def _synthetic_fit(path: Path, sport: str, sub: str, start: "dt.datetime", secs: int, sets: bool = False) -> None:
    """A small FIT activity written with Garmin's own encoder: 1 Hz records, one lap, one session, and a
    strength session's sets. Synthetic — no real athlete's file is ever a fixture."""
    import gzip
    from garmin_fit_sdk import Encoder, Profile
    mn = Profile["mesg_num"]
    e = Encoder()
    e.write_mesg({"mesg_num": mn["FILE_ID"], "type": "activity", "manufacturer": "development", "product": 0,
                  "time_created": start, "serial_number": 1})
    for i in range(secs):
        e.write_mesg({"mesg_num": mn["RECORD"], "timestamp": start + dt.timedelta(seconds=i), "heart_rate": 130 + i % 10,
                      "power": 200 + i % 20, "cadence": 88, "enhanced_speed": 8.0, "distance": 8.0 * i,
                      "enhanced_altitude": 50.0})
    if sets:
        for k in range(3):
            e.write_mesg({"mesg_num": mn["SET"], "timestamp": start + dt.timedelta(seconds=60 * k),
                          "start_time": start + dt.timedelta(seconds=60 * k), "duration": 30.0, "set_type": "active",
                          "repetitions": 8, "weight": 60.0, "category": ["bench_press"], "category_subtype": [1]})
    end = start + dt.timedelta(seconds=secs - 1)
    e.write_mesg({"mesg_num": mn["LAP"], "timestamp": end, "start_time": start, "total_elapsed_time": float(secs - 1),
                  "total_timer_time": float(secs - 1), "total_distance": 8.0 * (secs - 1), "avg_heart_rate": 134,
                  "avg_power": 209, "intensity": "active"})
    e.write_mesg({"mesg_num": mn["SESSION"], "timestamp": end, "start_time": start, "sport": sport, "sub_sport": sub,
                  "total_elapsed_time": float(secs - 1), "total_timer_time": float(secs - 1),
                  "total_distance": 8.0 * (secs - 1), "avg_heart_rate": 134, "max_heart_rate": 139, "avg_power": 209,
                  "normalized_power": 211, "total_ascent": 12, "total_calories": 300, "enhanced_avg_speed": 8.0})
    data = e.close()
    path.write_bytes(gzip.compress(data) if path.name.endswith(".gz") else data)


def test_duplicates_across_sources_keep_the_better_copy():
    """sources.same_session: same sport group, starts within 2 min, durations within 10 % (or 2 min).
    The kept copy is the better source's — Garmin, then the athlete's file, then Strava."""
    import sources
    g = {"activityId": 1, "activityType": {"typeKey": "virtual_ride"}, "startTimeGMT": "2026-03-02 17:00:30",
         "startTimeLocal": "2026-03-02 18:00:30", "duration": 1810}
    fl = {**g, "activityId": 2, "source": "files", "startTimeGMT": "2026-03-02 17:00:00", "duration": 1799}
    st = {**g, "activityId": 3, "source": "strava", "activityType": {"typeKey": "indoor_cycling"}, "duration": 1700}
    assert sources.same_session(g, fl) and sources.same_session(fl, st), "a ride is a ride, indoor or virtual"
    assert not sources.same_session(g, {**fl, "activityType": {"typeKey": "running"}}), "another sport"
    assert not sources.same_session(g, {**fl, "startTimeGMT": "2026-03-02 17:05:00"}), "five minutes apart"
    assert not sources.same_session(g, {**fl, "duration": 900}), "half the length is another session"
    drops = sources.duplicates([st, fl, g])
    assert {(k["activityId"], d["activityId"]) for k, d in drops} == {(1, 2), (1, 3)}, drops
    assert [d["activityId"] for _, d in sources.duplicates([st, fl])] == [3], "a file outranks Strava"
    assert sources.FILES_ID_BASE + 10 ** 15 < 2 ** 53 and sources.STRAVA_ID_BASE + 10 ** 12 < 2 ** 53, \
        "synthetic ids must survive JavaScript's numbers"


def test_an_athlete_without_garmin_imports_their_files_and_every_view_builds():
    """The no-Garmin path end to end, on a throwaway athlete: their FIT, GPX and TCX files import into the
    engine's own shapes (sets included), a second import is a no-op, Garmin refuses them, every app view
    builds on the imported data, and Strava's MCP records keep no GPS and are refused for a Garmin athlete."""
    if os.environ.get("OSC_SCAFFOLD_CHECK"):
        return
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "athletes").mkdir()
        base = _env(OSC_ATHLETES_ROOT=str(t / "athletes"), OSC_DATA_ROOT=str(t / "data"))
        r = _py(["scripts/new_athlete.py", "sam", "--display", "Sam", "--sources", "files,strava"], base)
        assert r.returncode == 0, r.stdout + r.stderr
        cfg = json.loads((t / "athletes" / "sam" / "athlete.json").read_text())
        assert cfg["sources"] == ["files", "strava"], cfg.get("sources")
        inbox = t / "in"
        inbox.mkdir()
        u = dt.timezone.utc
        _synthetic_fit(inbox / "ride.fit.gz", "cycling", "virtual_activity", dt.datetime(2026, 3, 2, 17, tzinfo=u), 900)
        _synthetic_fit(inbox / "lift.fit", "training", "strength_training", dt.datetime(2026, 3, 3, 7, tzinfo=u), 300, sets=True)
        pts = "".join(f'<trkpt lat="{41 + i * 1e-4:.5f}" lon="{2 + i * 1e-4:.5f}"><ele>10</ele>'
                      f'<time>2026-03-04T07:{i // 60:02d}:{i % 60:02d}Z</time></trkpt>' for i in range(0, 1200, 5))
        (inbox / "run.gpx").write_text('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1">'
                                       f'<trk><name>Run</name><type>running</type><trkseg>{pts}</trkseg></trk></gpx>')
        tps = "".join(f"<Trackpoint><Time>2026-03-05T18:{i // 60:02d}:{i % 60:02d}Z</Time><DistanceMeters>{i * 2.5}"
                      f"</DistanceMeters><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>" for i in range(0, 600, 10))
        (inbox / "walk.tcx").write_text('<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/'
                                        'xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running">'
                                        f'<Lap StartTime="2026-03-05T18:00:00Z"><Track>{tps}</Track></Lap></Activity>'
                                        '</Activities></TrainingCenterDatabase>')
        env = {**base, "OSC_ATHLETE": "sam"}
        r = _py(["scripts/import_files.py", str(inbox)], env)
        assert r.returncode == 0 and "imported 4 session(s)" in r.stdout, r.stdout + r.stderr
        r = _py(["scripts/import_files.py", str(inbox)], env)
        assert "imported 0 session(s); 4 already imported" in r.stdout, "a second import must be a no-op"
        cache = t / "data" / "sam"
        acts = json.loads((cache / "activities_files.json").read_text())
        assert {a["activityType"]["typeKey"] for a in acts} == {"virtual_ride", "strength_training", "running"}, acts
        assert all(a["source"] == "files" and a["activityId"] > sources_base() for a in acts), acts
        lift = next(a for a in acts if a["activityType"]["typeKey"] == "strength_training")
        sets = json.loads((cache / f"activity_{lift['activityId']}_sets.json").read_text())["exerciseSets"]
        assert sets[0]["exercises"][0] == {"category": "BENCH_PRESS", "name": "BARBELL_BENCH_PRESS"} and sets[0]["weight"] == 60000, \
            f"a FIT set's exercise, named from the FIT profile: {sets[0]}"
        r = _py(["scripts/pull_activities.py", "--days", "2"], env)
        assert r.returncode != 0 and "does not use Garmin" in (r.stdout + r.stderr), "Garmin must refuse them"
        views = _py(["-c", "import sys; sys.path.insert(0, 'scripts'); import json, app_data\n"
                           "s = app_data.run_view('sessions')['sessions']\n"
                           "for v in ('today', 'recovery', 'load', 'program', 'calendar', 'races', 'body', 'strength', 'system'):\n"
                           "    app_data.run_view(v)\n"
                           "for x in s: app_data.run_view('workout', str(x['id']))\n"
                           "print(len(s), 'sessions')"], env)
        assert views.returncode == 0 and "4 sessions" in views.stdout, views.stdout + views.stderr[-1500:]
        mcp = t / "strava.json"
        mcp.write_text(json.dumps({"activities": [
            {"id": 990000002, "name": "Evening Ride", "sport_type": "Ride", "trainer": True,
             "start_date": "2026-03-06T18:00:00Z", "start_date_local": "2026-03-06T19:00:00Z", "elapsed_time": 3600,
             "moving_time": 3550, "distance": 30000.0, "start_latlng": [41.39, 2.17], "map": {"summary_polyline": "x"}}]}))
        r = _py(["scripts/import_strava.py", "--json", str(mcp)], env)
        assert r.returncode == 0, r.stdout + r.stderr
        kept = (cache / "activities_strava.json").read_text()
        assert "latlng" not in kept and "polyline" not in kept and "41.39" not in kept, "Strava's GPS is never kept"
        row = json.loads(kept)[0]
        assert row["activityType"]["typeKey"] == "indoor_cycling" and row["retainUntil"], row
        cfg["sources"] = ["garmin"]
        (t / "athletes" / "sam" / "athlete.json").write_text(json.dumps(cfg))
        r = _py(["scripts/import_strava.py", "--json", str(mcp)], env)
        assert r.returncode != 0 and "only duplicate" in (r.stdout + r.stderr), "a Garmin athlete never reads Strava"


def test_no_plan_before_the_disclaimer_and_the_health_screen():
    """consent.py: an adult's own yes to DISCLAIMER.md and six yes/no answers, recorded with the
    disclaimer's version. Until then setup_status names them; a yes on the screen asks for a doctor's
    clearance; a minor is refused; a new disclaimer version is asked again."""
    if os.environ.get("OSC_SCAFFOLD_CHECK"):
        return
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "athletes").mkdir()
        base = _env(OSC_ATHLETES_ROOT=str(t / "athletes"), OSC_DATA_ROOT=str(t / "data"), OSC_ATHLETE="kim")
        assert _py(["scripts/new_athlete.py", "kim", "--sources", "files"], base).returncode == 0
        st = lambda: json.loads(_py(["scripts/setup_status.py", "--json"], base).stdout)["missing"]  # noqa: E731
        safety = next(s for s in st() if s["section"] == "safety")
        assert [q["id"] for q in safety["questions"]][:2] == ["adult", "disclaimer"], safety
        r = _py(["scripts/consent.py", "record", "--answers", json.dumps({"adult": False})], base)
        assert r.returncode != 0 and "adults only" in (r.stdout + r.stderr)
        screen = {k: False for k in ("heart", "symptoms", "chronic", "pregnancy", "injury", "other")}
        r = _py(["scripts/consent.py", "record", "--answers", json.dumps(
            {"adult": True, "accepted": True, "screen": {**screen, "injury": True}})], base)
        assert r.returncode == 0 and "CLEARANCE ADVISED" in r.stdout, r.stdout + r.stderr
        assert [q["id"] for s in st() if s["section"] == "safety" for q in s["questions"]] == ["clearance"]
        _py(["scripts/consent.py", "record", "--answers", json.dumps({"clearance": "yes"})], base)
        assert not [s for s in st() if s["section"] == "safety"], "a cleared adult who accepted is done"
        cfg = json.loads((t / "athletes" / "kim" / "athlete.json").read_text())
        import consent
        assert cfg["consent"]["version"] == consent.version() != "unversioned", "recorded against DISCLAIMER.md's version"


def test_the_session_dsl_encodes_the_proven_formats():
    """scripts/workout_dsl.py: swims, runs, circuits and mobility encode exactly as the formats proven on
    a watch (workouts/FORMAT.md) — Connect's stroke enum, kick/pull as a drillType, lap-button rests by
    default, a timed swim rest as fixed.rest, heart-rate targets in bpm, catalog exercises on every
    working circuit step — and every built workout passes the validation gate."""
    import tempfile
    import validate_workout
    import workout_dsl as d
    sw = d.swim_workout("Swim · Test", "x", [
        d.Swim(200, "free", "warm", kind="warmup"), d.Rest(),
        d.Repeat(4, [d.Swim(50, "free", "kick", eq="kickboard", drill="kick"), d.Rest(15)], skip_last_rest=True),
        d.Rest(), d.Swim(100, "back", "easy", kind="cooldown")], expect_m=500)
    steps = sw["workoutSegments"][0]["workoutSteps"]
    assert [s["stepType"]["stepTypeKey"] for s in steps] == ["warmup", "rest", "repeat", "rest", "cooldown"]
    assert steps[1]["endCondition"]["conditionTypeKey"] == "lap.button", "rests default to the lap button"
    kick, rest = steps[2]["workoutSteps"]
    assert kick["strokeType"]["strokeTypeId"] == 6 and kick["drillType"]["drillTypeKey"] == "kick"
    assert kick["equipmentType"] == {"equipmentTypeId": 2, "equipmentTypeKey": "kickboard", "displayOrder": 2}
    assert rest["endCondition"]["conditionTypeKey"] == "fixed.rest" and rest["endConditionValue"] == 15.0
    assert steps[4]["strokeType"]["strokeTypeKey"] == "backstroke" and sw["poolLength"] == 25.0
    for bad in (lambda: d.swim_workout("S", None, [d.Swim(100, "doggy")]),
                lambda: d.swim_workout("S", None, [d.Swim(100)], expect_m=200),
                lambda: d.swim_workout("S", None, [d.Repeat(2, [d.Repeat(2, [d.Swim(50)])])]),
                lambda: d.swim_workout("x" * 41, None, [d.Swim(100)])):
        try:
            bad()
        except ValueError:
            continue
        raise AssertionError("an unknown stroke, a wrong total, a nested repeat or a long name was accepted")
    run = d.run_workout("Run · Test", None, [
        d.Run("warmup", seconds=600), d.Run("interval", seconds=1200, hr=(130, 150)),
        d.Repeat(4, [d.Run("interval", seconds=20), d.Run("recovery", note="walk back", estimate_s=60)])])
    rs = run["workoutSegments"][0]["workoutSteps"]
    assert rs[1]["targetType"]["workoutTargetTypeKey"] == "heart.rate.zone" and rs[1]["targetValueTwo"] == 150.0
    assert run["estimatedDurationInSecs"] == 600 + 1200 + 4 * 80
    try:
        d.run_workout("R", None, [d.Run("interval", note="no estimate")])
        raise AssertionError("a lap-button run step with no estimate was accepted")
    except ValueError:
        pass
    circ = d.circuit_workout("Circuit · Test", None, [
        d.Station("warmup", "Easy", ("RUN", "RUN_OR_WALK"), seconds=300),
        d.Station("interval", "Row 500 m", ("ROW", "INDOOR_ROW")),
        d.Station("rest", "Partner: wall balls", ("SQUAT", "WALL_BALL")),
        d.Station("interval", "Carry", ("CARRY", "FARMERS_CARRY"), kg=48)])
    cs = circ["workoutSegments"][0]["workoutSteps"]
    assert cs[1]["endCondition"]["conditionTypeKey"] == "lap.button" and cs[3]["weightValue"] == 48.0
    for bad in (lambda: d.circuit_workout("C", None, [d.Station("interval", "no exercise")]),
                lambda: d.circuit_workout("C", None, [d.Station("interval", "x", ("ROW", "NOT_A_ROW"))]),
                lambda: d.circuit_workout("C", None, [d.Station("interval", "y" * 49, ("ROW", "INDOOR_ROW"))]),
                lambda: d.mobility_workout("M", None, [d.Station("rest", "unnamed", seconds=30)])):
        try:
            bad()
        except ValueError:
            continue
        raise AssertionError("an unnamed working step, an unknown pair or a long note was accepted")
    mob = d.mobility_workout("Mobility · Test", None, [d.Station("interval", "Cat-cow", ("WARM_UP", "STRETCH_CAT_COW"), seconds=60)])
    with tempfile.TemporaryDirectory() as tmp:
        for i, wo in enumerate((sw, run, circ, mob)):
            p = Path(tmp) / f"w{i}.json"
            p.write_text(json.dumps(wo))
            ok, report = validate_workout.validate(p)
            assert ok, (wo["workoutName"], [r for r in report if "FAIL" in r])


def test_a_coachs_written_swim_becomes_sections_with_lap_rests_between():
    """workout_dsl.from_sections: the first section is warm-up, the last cool-down; consecutive parts get
    a lap-button rest between them unless a T() puts a timed one there; a repeat's own rest is skipped
    after its last repetition."""
    import workout_dsl as d
    steps = d.from_sections([
        ("Cal", 300, [d.S(300, "free", "suave")]),
        ("Ppal", 400, [d.R(4, d.S(100, "free", "AEM"), 20), d.T(30)]),
        ("Enf", 100, [d.S(100, "back", "suave")])])
    kinds = [type(s).__name__ + (f":{s.kind}" if isinstance(s, d.Swim) else "") for s in steps]
    assert kinds == ["Swim:warmup", "Rest", "Repeat", "Rest", "Swim:cooldown"], kinds
    assert steps[2].skip_last_rest and steps[2].steps[1] == d.Rest(20) and steps[3] == d.Rest(30)
    assert d.metres(steps) == 800


_REVIEW_PROBE = r'''
import json, sys
sys.path.insert(0, "scripts")
import session_review as sr, session_score, app_contracts
swim, test, circ = 7000000000000001, 7000000000000002, 7000000000000003
a = sr.analyse(swim)
assert a["planned"]["key"] == "swim_sets" and a["planned"]["matched_by"].startswith("the workout id"), a["planned"]
assert a["planned"]["swims"] == 6 and a["planned"]["done"] == 5, a["planned"]       # one 100 skipped
assert a["sets"][0]["reps"] == 4 and a["sets"][0]["done"] == 3 and a["sets"][0]["pace_spread"] > 0.03
assert a["metrics"]["pace_100"]["value"] and "missed" in [f["key"] for f in a["flags"]]
s = session_score.score(swim)
assert s["band"] and {p["key"] for p in s["parts"]} == {"distance", "swims", "swim_pacing"}, s
t = sr.analyse(test)
assert t["metrics"]["css_100"]["value"] == 95.0, t["metrics"]        # (360 - 170) / 2
c = sr.analyse(circ)
assert c["planned"]["steps"] == 5 and c["planned"]["done_working"] == 3, c["planned"]
assert c["metrics"]["stray_laps"]["value"] == 1 and "stray_laps" in [f["key"] for f in c["flags"]]
assert [x["planned"]["role"] for x in c["intervals"]] == ["run", "station", "rest", "run", "station"][:len(c["intervals"])]
cs = session_score.score(circ)
assert {p["key"] for p in cs["parts"]} == {"steps", "structure", "circuit_pacing"} and cs["total"] is not None, cs
review = {"activity_id": swim, "findings": [{"evidence": [{"metric": "intervals.2.secs", "value": a["intervals"][1]["secs"]}]}]}
assert not app_contracts.check_evidence(review, sr.analysis_for(swim)), "a cited rep checked against the engine"
review["findings"][0]["evidence"][0]["value"] += 9
assert app_contracts.check_evidence(review, sr.analysis_for(swim)), "a misremembered rep time"
print("review probe ok")
'''


def test_swims_and_circuits_are_reviewed_against_the_workout_they_followed():
    """session_review.py on synthetic sessions: a swim matched to its workout by the watch's recorded id,
    its reps aligned to the planned swims by distance (one skipped rep costs one rep), its set's pace
    spread, a CSS test's critical swim speed; a circuit's steps aligned by the watch's step index, a
    stray lap press set aside and flagged; both scored, and a review's cited rep checked."""
    if os.environ.get("OSC_SCAFFOLD_CHECK"):
        return
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "athletes").mkdir()
        base = _env(OSC_ATHLETES_ROOT=str(t / "athletes"), OSC_DATA_ROOT=str(t / "data"))
        assert _py(["scripts/new_athlete.py", "rio", "--sources", "files"], base).returncode == 0
        root, cache = t / "athletes" / "rio", t / "data" / "rio"
        cache.mkdir(parents=True)
        (root / "sessions.py").write_text(
            "from workout_dsl import *\n"
            "WORKOUTS = {\n"
            " 'swim_sets': swim_workout('Swim · Sets', None, [Swim(200, kind='warmup'), Rest(),\n"
            "    Repeat(4, [Swim(100, note='Steady'), Rest(15)], skip_last_rest=True), Rest(), Swim(200, kind='cooldown')]),\n"
            " 'swim_css': swim_workout('Swim · CSS', None, [Swim(400, note='TEST 400'), Rest(), Swim(200, note='TEST 200')]),\n"
            " 'circuit': circuit_workout('Circuit · Probe', None, [Station('interval', 'Run 600 m', ('RUN', 'RUN_OR_WALK')),\n"
            "    Station('interval', 'Row', ('ROW', 'INDOOR_ROW')), Station('rest', 'Walk over'),\n"
            "    Station('interval', 'Run 600 m', ('RUN', 'RUN_OR_WALK')), Station('interval', 'Carry', ('CARRY', 'FARMERS_CARRY'))]),\n"
            "}\n")
        cfg = json.loads((root / "athlete.json").read_text())
        cfg["sessions"] = ["sessions.py"]
        (root / "athlete.json").write_text(json.dumps(cfg))
        env = {**base, "OSC_ATHLETE": "rio"}
        r = _py(["scripts/build_workouts.py"], env)
        assert r.returncode == 0 and "swim_sets.json" in r.stdout, r.stdout + r.stderr
        (root / "workouts" / "WORKOUT_IDS.json").write_text(json.dumps({"workouts": {"Swim · Sets": 501},
                                                                       "history": {"Swim · CSS": [502]}}))
        day = lambda d, h: f"2026-03-0{d} {h}:00:00"  # noqa: E731
        acts = [
            {"activityId": 7000000000000001, "activityName": "Pool Swim", "workoutId": 501, "startTimeLocal": day(2, "07"),
             "activityType": {"typeKey": "lap_swimming"}, "distance": 900.0, "duration": 1000, "movingDuration": 900},
            {"activityId": 7000000000000002, "activityName": "Pool Swim", "workoutId": 502, "startTimeLocal": day(3, "07"),
             "activityType": {"typeKey": "lap_swimming"}, "distance": 600.0, "duration": 700, "movingDuration": 530},
            {"activityId": 7000000000000003, "activityName": "Circuit · Probe", "startTimeLocal": day(4, "18"),
             "activityType": {"typeKey": "indoor_cardio"}, "duration": 900}]
        (cache / "activities_files.json").write_text(json.dumps(acts))
        lap = lambda d, s: {"distance": d, "duration": s, "movingDuration": s}  # noqa: E731
        (cache / "activity_7000000000000001_splits.json").write_text(json.dumps({"lapDTOs": [
            lap(200, 220), lap(0, 30), lap(100, 100), lap(100, 104), lap(100, 112), lap(0, 60), lap(200, 230)]}))
        (cache / "activity_7000000000000002_splits.json").write_text(json.dumps({"lapDTOs": [
            lap(400, 360), lap(0, 170), lap(200, 170)]}))
        st = lambda i, s, k="ACTIVE": {"wktStepIndex": i, "duration": s, "setType": k, "exercises": []}  # noqa: E731
        (cache / "activity_7000000000000003_sets.json").write_text(json.dumps({"exerciseSets": [
            st(0, 180), st(1, 4), st(1, 240), st(2, 40, "REST"), st(3, 200)]}))
        r = _py(["-c", _REVIEW_PROBE], env)
        assert r.returncode == 0 and "review probe ok" in r.stdout, r.stdout + r.stderr[-2000:]


def test_a_session_is_judged_against_the_version_it_followed_even_in_a_private_repo():
    """athlete.committed_before: a file as committed before a moment, from the git repository that holds
    it — here an athlete's own private repository, as athletes/ is in the public setup — following a
    move. Strength scoring (program_at) and the swim and circuit reviews read history through it."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp)
        run = lambda *a, when="2026-03-01T10:00:00": subprocess.run(  # noqa: E731
            ["git", *a], cwd=repo, check=True, capture_output=True,
            env={**os.environ, "GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when,
                 "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
                 "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"})
        run("init", "-q")
        body = json.dumps({"steps": [{"n": i, "note": "steady"} for i in range(20)]}, indent=1)
        (repo / "old.json").write_text(body + '{"v": 1}')
        run("add", "-A")
        run("commit", "-qm", "v1", "--no-verify")
        run("mv", "old.json", "w.json")
        (repo / "w.json").write_text(body + '{"v": 2}')
        run("add", "-A")
        run("commit", "-qm", "v2", "--no-verify", when="2026-03-10T10:00:00")
        got = lambda when: athlete.committed_before(repo / "w.json", when)[0]  # noqa: E731
        assert got("2026-03-05 08:00:00").endswith('{"v": 1}'), "the version before the move, by its old name"
        assert got("2026-03-11 08:00:00").endswith('{"v": 2}')
        assert got("2026-02-01 08:00:00") is None, "nothing committed yet"
        assert athlete.committed_before(Path(tmp) / "nowhere" / "x.json", "2026-03-05")[0] is None


def sources_base() -> int:
    import sources
    return sources.FILES_ID_BASE


def test_the_leak_scan_finds_a_named_athlete_outside_their_folder():
    """scripts/leak_scan.py: an athlete's name, an email or a Garmin-style id in an engine file is refused;
    the Demo athlete's synthetic ids and Anthropic's commit address are not."""
    import leak_scan
    terms = {"jordan": "an athlete's name", "harbour 70.3": "a race on their calendar"}
    pat = leak_scan._term_pattern(terms)
    hits = leak_scan.scan_text("scripts/x.py", "# Jordan's rule\n# their Harbour 70.3 plan\n", pat, terms)
    assert len(hits) == 2 and "athlete's name" in hits[0], hits
    assert not leak_scan.scan_text("scripts/x.py", "# jordanian bread\n", pat, terms), "whole words only"
    assert leak_scan.scan_text("README.md", "mail me: someone@" + "gmail.com", pat, terms)
    assert not leak_scan.scan_text("x.md", "Co-Authored-By: Claude <noreply@anthropic.com>", pat, terms)
    assert leak_scan.scan_text("tests/x.py", "activity " + "2495" + "5768053", pat, terms), "a real-looking Garmin id"
    assert leak_scan.scan_text("x.md", "activity_" + "2495" + "5768053" + "_sets.json", pat, terms), "an id in a file name"
    assert not leak_scan.scan_text(".github/workflows/t.yml", "uses: actions/x@6d4fd22b20465ccc0f"
                                   + "73544" + "76588" + "e8df7c9ca0e0", pat, terms), "digits inside a commit hash"
    assert not leak_scan.scan_text("tests/x.py", "activity 21000000093 · 2147483647", pat, terms)
    assert leak_scan.scan_path_name("athletes/jordan/athlete.json") and not leak_scan.scan_path_name("athletes/README.md")
    assert leak_scan.scan_path_name("app/web/public/marks/x.png"), "an event's logo"


# --- runner ---------------------------------------------------------------------
# The suite runs ONCE PER ATHLETE, each in its own child process with OSC_ATHLETE set:
# the engine invariants above against that athlete's program, rules and cache, then the
# athlete's own athletes/<name>/tests.py. So every engine change is checked against every
# athlete, every time. In a session bound to one athlete, another athlete's results are
# reported by count and test name only — their details stay in their own sessions.

def run_child() -> int:
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    own = A.root / "tests.py"
    if own.is_file():
        mod = _load(f"athlete_tests_{A.name}", own)
        tests += [(f"{A.name}::{n}", f) for n, f in sorted(vars(mod).items())
                  if n.startswith("test_") and callable(f)]
    failed = []
    for name, fn in tests:
        try:
            fn()
            print(f"  PASS  {name}")
        except AssertionError as e:
            failed.append(name)
            print(f"  FAIL  {name}\n        {e}")
        except Exception:
            failed.append(name)
            print(f"  ERROR {name}\n{traceback.format_exc()}")
    print("SUMMARY " + json.dumps({"athlete": A.name, "total": len(tests), "failed": failed}))
    return 1 if failed else 0


def run_parent() -> int:
    viewer = athlete.bound_name() if athlete.session_id() else None
    # The shared exercise catalog is generated from Garmin's FIT SDK on this machine, never committed
    # (the FIT Protocol License restricts redistributing it): build it before the first run.
    if not athlete.CATALOG_PATH.exists():
        r = _py(["scripts/build_exercise_catalog.py"], _env())
        if r.returncode != 0:
            print(f"could not build workouts/EXERCISE_CATALOG.json: {r.stderr[-400:]}")
            return 1
    names = athlete.known()
    roots: dict[str, str] = {}
    if not names:
        # A fresh clone has no athletes (their folders are private): check the engine against a
        # throwaway scaffold instead, so contributors and CI run the whole suite.
        import tempfile
        tmp = Path(tempfile.mkdtemp(prefix="osc-tests-"))
        (tmp / "athletes").mkdir()
        roots = {"OSC_ATHLETES_ROOT": str(tmp / "athletes"), "OSC_DATA_ROOT": str(tmp / "data")}
        r = _py(["scripts/new_athlete.py", "demo", "--display", "Demo"], _env(**roots))
        if r.returncode != 0:
            print(f"no athletes here, and the throwaway scaffold failed: {r.stdout}{r.stderr}")
            return 1
        print("no athletes on this machine — the engine suite runs against a fresh scaffold (demo)\n")
        names = ["demo"]
    grand_total, grand_failed, bad_exit = 0, [], False
    for name in names:
        env = _env(OSC_ATHLETE=name, OSC_TEST_CHILD="1", **roots)
        proc = subprocess.run([sys.executable, str(Path(__file__).resolve())], env=env,
                              capture_output=True, text=True, cwd=ROOT)
        bad_exit |= proc.returncode != 0
        lines = proc.stdout.splitlines()
        summary = next((json.loads(l[8:]) for l in reversed(lines) if l.startswith("SUMMARY ")), None)
        if summary is None:
            print(f"== {name}: the suite did not run ==\n{proc.stdout}{proc.stderr}")
            grand_failed.append(f"{name}::<suite crashed>")
            continue
        total, failed = summary["total"], summary["failed"]
        grand_total += total
        grand_failed += [f"{name}: {f}" for f in failed]
        print(f"== {name} — engine + own invariants: {total - len(failed)}/{total} passed ==")
        if viewer in (None, name):
            print("\n".join(l for l in lines if not l.startswith("SUMMARY ")))
        elif failed:
            print(f"   FAILED: {', '.join(failed)} (details in a session bound to {name})")
        print()
    print(f"{grand_total - len(grand_failed)}/{grand_total} passed across {len(names)} athlete(s)")
    if grand_failed:
        print("\nFAILURES:\n  " + "\n  ".join(grand_failed))
    return 1 if (grand_failed or bad_exit) else 0


if __name__ == "__main__":
    sys.exit(run_child() if CHILD else run_parent())

