#!/usr/bin/env python3
"""Scaffold a new athlete: athletes/<name>/ with everything the engine needs, and nothing else.

    .venv/bin/python scripts/new_athlete.py alex --display Alex

Creates an EMPTY athlete — no program, no Garmin binding, no facts — that already passes every
engine invariant. What comes next is theirs, not a template's:

  1. Their first session, bound to them, runs /osc-setup: safety (adult, disclaimer, health screen),
     data source (a Garmin user logs in THEMSELVES with scripts/login.py --athlete <name>), goals,
     training, races, injuries, schedule, equipment, preferences, fuelling, history, first plan.
     Every answer lands in their memory/, ATHLETE.md, athlete.json and program.py; every injury
     becomes a medical fact PLUS an enforcing test in their tests.py.
  2. A Garmin athlete's program goes to their watch through /osc-push.

Refuses to touch an athlete that already exists. Nothing here reads or writes Garmin.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

ATHLETE_JSON = {
    "_about": "Identity and plumbing. Read by scripts/athlete.py. The Garmin identity is written by "
              "scripts/login.py when the athlete binds their account; every Garmin login is "
              "asserted against it.",
    "display": None,
    "_sources": "Where their training data comes from: garmin (activities, health, the watch), files (their "
                "own FIT/GPX/TCX and Strava export, scripts/import_files.py), strava (Strava's MCP, recent "
                "sessions; scripts/import_strava.py). A Garmin athlete never reads Strava (scripts/sources.py).",
    "sources": ["garmin"],
    "garmin": {},
    "_protected_workout_ids": "Workouts already in the account when it was bound. Never touched, "
                              "renamed or deleted — asserted by sync, reschedule and delete.",
    "protected_workout_ids": [],
    "managed_workouts": [],
    "_generators": "Extra generator scripts in this folder, run by sync_workouts.py after the "
                   "engine's build_workouts.py.",
    "generators": [],
    "_sessions": "Swim, run, circuit and mobility modules in this folder, each exposing WORKOUTS "
                 "(scripts/workout_dsl.py); built by scripts/build_sessions.py.",
    "sessions": ["sessions.py"],
    "profile": {
        "_about": "Filled in at the intake. dumbbell_cap_kg becomes REQUIRED by the engine tests "
                  "as soon as the program prescribes two-dumbbell loads.",
        "goal": None,
        "weight_kg": None,
        "weight_target_kg": None,
        "dumbbell_cap_kg": None,
        "key_lifts": {},
        "muscle_targets": {},
    },
}

PROGRAM_PY = '''"""{display}'s strength program — the source of truth for what reaches their watch.

Loaded by scripts/build_workouts.py (the engine) whenever {display} is the bound athlete, and
turned into athletes/{name}/workouts/<day>.json. CURRENT_ROUTINE.md next to this file is the
human-readable mirror — change both together; the engine tests enforce the lockstep.

Nothing in this file may import from another athlete's folder.

FORMAT. PROGRAM maps a day key to {{"name", "desc", "exercises"}}; every exercise is a tuple
    (id, routine name, category, exerciseName, sets, value, weight_kg|None, rest_s, kind)
  id        D<day>E<n>, e.g. D1E1 — the routine doc's rows are matched on it
  category, exerciseName   a pair from workouts/EXERCISE_CATALOG.json (the FIT SDK taxonomy)
  value     for kind "reps": the TOP of the rep range (range = value-2..value; hit the top on
            every set -> add weight). For "time": seconds. "fixed": a single-target protocol.
            "power": explosive reps (jumps, throws) — a target count, never progressed by load.
  weight    PER ARM for two-dumbbell lifts; None = bodyweight
  kind      "reps" | "time" | "fixed" | "power", or "<kind>_per_side" for one-side-at-a-time work
Every day key must also be listed in athlete.json -> managed_workouts, or it never reaches the
watch.

OPTIONAL names (engine defaults in brackets): VARIANTS [none], WARMUPS [none], STEP_NOTES [none],
LEAD — a prescribed block before the day's lifts [none], SET_REST_SECS [90], CORE_REST_SECS [45],
FIXED_INCREMENT [2.5 kg], SPLIT_LOAD_ALLOWED [none], SPLIT_SEED [none], DAY_LABEL [the day names],
SIDE_LABELS [("Right side", "Left side")]. workouts/FORMAT.md documents each of them.
"""
from __future__ import annotations

PROGRAM: dict[str, dict] = {{}}
'''

SESSIONS_PY = '''"""{display}'s swims, runs, circuits and mobility — everything for the watch that is not a gym day.

Built by scripts/build_sessions.py with the strength days; the encoding is the engine's
(scripts/workout_dsl.py, whose docstring has the rules the watch taught us). Every key here must also be
in athlete.json -> managed_workouts to reach the watch, through /osc-push. Examples, to copy:

    "swim_easy": swim_workout("Swim · Easy 1500", "25 m pool.", [
        Swim(300, "free", "Long strokes", kind="warmup"), Rest(),
        Repeat(6, [Swim(100, "free", "Steady, same time each"), Rest(20)], skip_last_rest=True), Rest(),
        Swim(200, "backstroke", "Easy", kind="cooldown")], expect_m=1100),
    "run_easy": run_workout("Run · Easy 40", "Conversational.", [
        Run("warmup", seconds=300), Run("interval", seconds=1800, hr=(120, 145), note="Easy"),
        Repeat(6, [Run("interval", seconds=20, note="Stride"), Run("recovery", note="Walk back", estimate_s=60)]),
        Run("cooldown", seconds=300)]),
    "circuit": circuit_workout("Circuit · 3 rounds", None, [
        Station("warmup", "Easy jog", ("RUN", "RUN_OR_WALK"), seconds=480),
        Repeat(3, [Station("interval", "Run 800 m", ("RUN", "RUN_OR_WALK")),
                   Station("interval", "Row 500 m", ("ROW", "INDOOR_ROW")),
                   Station("interval", "Carry 100 m", ("CARRY", "FARMERS_CARRY"), kg=32)])]),
"""
from __future__ import annotations

from workout_dsl import Repeat, Rest, Run, Station, Swim, circuit_workout, run_workout, swim_workout  # noqa: F401

WORKOUTS: dict[str, dict] = {{}}
'''

TESTS_PY = '''"""{display}'s own invariants — the constraints that are theirs, not the engine's.

Run by tests/run_tests.py in a child process bound to {name}, after the engine invariants (which
run for every athlete). Every ACTIVE medical fact in athletes/{name}/memory/medical/ must name a
test in this file as its enforced_by — the engine test
test_active_medical_facts_name_a_real_enforcing_test refuses anything else.

Import what you need from the harness, e.g.:
    from harness import A, RULES, CATALOG, bw, export, audit
"""
from __future__ import annotations
'''

ATHLETE_MD = '''# {display}

You are {display}'s strength & conditioning coach. _Filled in at the intake: who they are, how they
train, what they want._

## Read this first

Their durable facts live in `athletes/{name}/memory/` — load its `INDEX.md` at the start of any
session that will make a coaching decision. _(Empty until the intake.)_

`CURRENT_ROUTINE.md` is the live routine and the human-readable mirror of `program.py`, which is the
source of truth for what they train.

## Their own rules

_None yet — the intake sets them. Every injury becomes a `memory/medical/` fact AND a test in
`tests.py`._

## The brief

_How they want the daily brief: format, length, which targets to track._

## Current state

- **Not set up yet.** Run **`/osc-setup`** in a session bound to them: safety first (adult, the
  disclaimer, the health screen), then their data source, goals, current training, races, injuries,
  schedule and equipment, preferences and fuelling; then their history and a first plan.
'''

ROUTINE_MD = '''# CURRENT_ROUTINE — {display}

> The human-readable mirror of `program.py`. Every prescribed exercise gets its own table row,
> keyed by its id (`| D1E1 | ...`), carrying the load that is on the watch — the engine tests
> check it. _No program yet: written at the intake._
'''

LOGGING_RULES = {
    "_meta": {
        "purpose": "How THIS athlete's logged sets are normalized. Consumed by "
                   "scripts/export_dashboard_data.py, progression_report.py and "
                   "prescription_audit.py. Filled in at the intake from how they actually enter "
                   "loads on the watch — ask; never copy another athlete's rules.",
        "two_db_weight_summed": "lifts holding two dumbbells at once where they log the SUM of "
                                "both: per-side weight = logged / 2",
        "unilateral_reps_summed": "one-side-at-a-time lifts where the logged reps are both sides "
                                  "summed: per-side reps = logged / 2",
        "machine_added_load_only": "machine lifts where they log only the plates they add; the "
                                   "base is unknown, so compare disc-load to disc-load only and "
                                   "never compute e1RM",
    },
    "two_db_weight_summed": [],
    "unilateral_reps_summed": [],
    "machine_added_load_only": [],
}

ANNOTATIONS = {
    "_meta": {
        "purpose": "Per-date context flags for strength sessions. Consumed by "
                   "scripts/progression_report.py: a flagged date is shown in the trend (marked *) "
                   "but excluded when classifying PROGRESSING/FLAT/STALLED/REGRESSED.",
        "types": "backoff, deload, injury, data_error",
        "scoping": "By default an entry applies to the WHOLE session. Add an optional "
                   "\"exercises\": [[category, exerciseName], ...] list to scope it.",
    }
}


RACES = {
    "_why": "The race season (docs/DESIGN.md (races)): each race's date, format, target and priority, every online "
            "check of its date, and the result. Empty until they enter one; scripts/races.py holds the rules "
            "and the windows around each race.",
    "races": [],
}


def fuel_scaffold() -> dict:
    """Their fuelling setup, every question open: the first session bound to them asks for it
    (scripts/setup_status.py, docs/DESIGN.md (fuelling and score) §3)."""
    import fuel
    return {"_why": "Their fuelling setup: the products they own (from nutrition/PRODUCTS.json), how they mix a "
                    "bottle, the rate their gut is trained to and caffeine. Asked the first time a session is "
                    "bound to them; scripts/fuel.py setup records the answers.",
            **json.loads(json.dumps(fuel.EMPTY))}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name", help="lowercase folder name, e.g. alex")
    ap.add_argument("--display", help="how the athlete is addressed, e.g. Alex")
    ap.add_argument("--sources", default="garmin",
                    help="comma-separated: garmin, files, strava (default garmin). garmin and strava never together")
    args = ap.parse_args()
    import sources
    srcs = [s.strip() for s in args.sources.split(",") if s.strip()]
    if not srcs or any(s not in sources.KNOWN for s in srcs):
        sys.exit(f"--sources must name some of {', '.join(sources.KNOWN)}: {args.sources!r}")
    if "garmin" in srcs and "strava" in srcs:
        sys.exit("garmin and strava never together: everything on a Garmin athlete's Strava came from the watch.")

    name = args.name.strip().lower()
    if not athlete.NAME_RE.match(name):
        sys.exit(f"'{name}' is not a valid athlete name (lowercase letters, digits, - or _).")
    root = athlete.ATHLETES_DIR / name
    if root.exists():
        sys.exit(f"{root} already exists — refusing to touch an existing athlete.")
    display = args.display or name.title()
    fmt = {"name": name, "display": display}

    (root / "workouts").mkdir(parents=True)
    (root / "memory").mkdir()
    (root / "logs").mkdir()
    (root / "logs" / ".gitkeep").write_text("")
    cfg = json.loads(json.dumps(ATHLETE_JSON))
    cfg["display"] = display
    cfg["sources"] = list(dict.fromkeys(srcs))
    (root / "athlete.json").write_text(json.dumps(cfg, indent=2) + "\n")
    (root / "program.py").write_text(PROGRAM_PY.format(**fmt))
    (root / "tests.py").write_text(TESTS_PY.format(**fmt))
    (root / "sessions.py").write_text(SESSIONS_PY.format(**fmt))
    (root / "ATHLETE.md").write_text(ATHLETE_MD.format(**fmt))
    (root / "CURRENT_ROUTINE.md").write_text(ROUTINE_MD.format(**fmt))
    (root / "workouts" / "LOGGING_RULES.json").write_text(json.dumps(LOGGING_RULES, indent=1) + "\n")
    (root / "workouts" / "SESSION_ANNOTATIONS.json").write_text(json.dumps(ANNOTATIONS, indent=1) + "\n")
    (root / "races.json").write_text(json.dumps(RACES, indent=1) + "\n")
    (root / "fuel.json").write_text(json.dumps(fuel_scaffold(), indent=1, ensure_ascii=False) + "\n")

    # Generated artefacts, built by the real generators so they are never hand-made. The build
    # runs as the NEW athlete, outside whatever session this was started from — it only writes an
    # empty PRESCRIPTION_HISTORY.json into their fresh folder.
    import os
    env = {k: v for k, v in os.environ.items() if k not in ("OSC_SESSION", "OSC_ATHLETE")}
    subprocess.run([sys.executable, str(athlete.REPO_ROOT / "scripts" / "build_workouts.py"),
                    "--athlete", name], check=True, capture_output=True, env=env)
    subprocess.run([sys.executable, str(athlete.REPO_ROOT / "scripts" / "build_memory_index.py")],
                   check=True, capture_output=True, env=env)

    shown = root.relative_to(athlete.REPO_ROOT) if root.is_relative_to(athlete.REPO_ROOT) else root
    print(f"Scaffolded {display} at {shown}/ — empty, and passing the engine invariants.\n")
    print("Next:")
    print(f"  1. Bind a session to {display} (scripts/use.py {name}) and run /osc-setup.")
    if "garmin" in cfg["sources"]:
        print(f"  2. {display} logs in to Garmin THEMSELVES, in a terminal:")
        print(f"       .venv/bin/python scripts/login.py --athlete {name}")
    print(f"  Their folder is private: never commit it to a public repository.")


if __name__ == "__main__":
    main()
