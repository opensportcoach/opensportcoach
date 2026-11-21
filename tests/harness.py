"""Shared fixtures for the engine tests (tests/run_tests.py) and every athlete's own tests
(athletes/<name>/tests.py).

Imported inside a per-athlete child process: run_tests.py runs the whole suite once PER ATHLETE,
each in its own process with OSC_ATHLETE set, so every module below resolves that athlete's
program, rules and cache at import — exactly as the scripts do in a real session.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import athlete  # noqa: E402


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


A = athlete.current()
export = _load("export_dashboard_data", ROOT / "scripts" / "export_dashboard_data.py")
audit = _load("prescription_audit", ROOT / "scripts" / "prescription_audit.py")
import build_workouts as bw  # noqa: E402

RULES = A.logging_rules
CATALOG = json.loads(athlete.CATALOG_PATH.read_text())["categories"]


def _set(cat, name, kg, reps):
    return {"setType": "ACTIVE", "weight": kg * 1000.0, "repetitionCount": reps,
            "exercises": [{"category": cat, "name": name}]}


def _hold(cat, name, kg, secs):
    """A timed set, as Garmin records one: a duration and NO repetitionCount. A pure bodyweight
    hold records no weight at all (not 0.0) — that difference dropped the D3 side plank from the
    audit until 2026-11-01, so the fixture keeps it."""
    s = {"setType": "ACTIVE", "duration": float(secs), "repetitionCount": None,
         "exercises": [{"category": cat, "name": name}]}
    return {**s, "weight": kg * 1000.0} if kg else s


def b_core():
    """Every exercise across every per-day core block, deduped by (category, name, kind)."""
    out, seen = [], set()
    for spec in bw.LEAD.values():
        for ex in spec["block"]:
            key = (ex[2], ex[3], ex[8])
            if key not in seen:
                seen.add(key)
                out.append(ex)
    return out


def frontmatter(path: Path) -> dict:
    import re
    m = re.match(r"^---\n(.*?)\n---\n", path.read_text(), re.S)
    if not m:
        return {}
    fm, key = {}, None
    for line in m.group(1).splitlines():
        if line.startswith("  - "):
            fm.setdefault(key, []).append(line[4:].strip())
        elif ":" in line:
            key, _, val = line.partition(":")
            key, val = key.strip(), val.strip()
            fm[key] = val if val else []
    return fm


def scratch_athletes(tmp: Path, names: list[str]) -> Path:
    """A throwaway athletes root holding minimal athletes, for guard/binding tests that must not
    depend on — or touch — the real ones."""
    root = tmp / "athletes"
    for n in names:
        (root / n).mkdir(parents=True, exist_ok=True)
        (root / n / "athlete.json").write_text(json.dumps(
            {"display": n.title(), "garmin": {"display_name": f"id-{n}", "full_name": n.title()}}))
    return root
