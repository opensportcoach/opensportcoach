#!/usr/bin/env python3
"""Build the athlete's swims, runs, circuits and mobility routines into workout JSON.

    .venv/bin/python scripts/build_sessions.py            # every module in athlete.json → sessions
    (scripts/build_workouts.py runs it after the strength days, so one build makes everything)

Each module listed in athletes/<name>/athlete.json → "sessions" (paths relative to their folder) is
the athlete's own data — written with scripts/workout_dsl.py — and exposes WORKOUTS = {key: workout}.
Every workout is written to athletes/<name>/workouts/<key>.json and checked by validate_workout.py;
a failure exits non-zero before anything can be pushed. The module's folder is on sys.path while it
loads, so it may import a data file next to it (a week of swims transcribed from a coach's plan).

Location is ownership: a module outside the athlete's own folder is refused.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402


def load(a: athlete.Athlete, path: Path):
    path = path.resolve()
    if not path.is_relative_to(a.root.resolve()):
        sys.exit(f"REFUSED: {path} is not inside {a.display}'s folder")
    sys.path.insert(0, str(path.parent))
    try:
        spec = importlib.util.spec_from_file_location(f"osc_sessions_{a.name}_{path.stem}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    finally:
        sys.path.remove(str(path.parent))
    if not isinstance(getattr(mod, "WORKOUTS", None), dict):
        sys.exit(f"{path.name} must define WORKOUTS = {{key: workout}} (scripts/workout_dsl.py)")
    return mod


def build(a: athlete.Athlete | None = None, quiet: bool = False) -> dict[str, Path]:
    import validate_workout
    a = a or athlete.current()
    written: dict[str, Path] = {}
    a.workouts_dir.mkdir(parents=True, exist_ok=True)
    for path in a.sessions:
        mod = load(a, path)
        for key, wo in mod.WORKOUTS.items():
            if key in written:
                sys.exit(f"{path.name}: workout key {key!r} is also built by another sessions module")
            out = a.workouts_dir / f"{key}.json"
            out.write_text(json.dumps(wo, indent=1, ensure_ascii=False) + "\n")
            ok, errors = validate_workout.validate(out)
            if not ok:
                sys.exit(f"{out.name} fails the validation gate:\n  " + "\n  ".join(errors))
            written[key] = out
            if not quiet:
                sport = wo["sportType"]["sportTypeKey"]
                print(f"{out.name}: {sport} · {wo['workoutName']} -> OK")
    return written


def main() -> int:
    build()
    return 0


if __name__ == "__main__":
    sys.exit(main())
