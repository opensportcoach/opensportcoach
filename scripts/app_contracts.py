#!/usr/bin/env python3
"""Check a coach result against its contract before the app shows it.

    .venv/bin/python scripts/app_contracts.py validate <kind> <file.json>
    kinds: daily · answer · plan_proposal · push_plan · push_result · review · endurance_review · race_check ·
           recap · request

WHY (2026-10-08, docs/DESIGN.md (the app) → Requests and results). The coach answers the app in structured
results, and the app draws them as screens: a malformed one would render as a broken card, or worse,
as a plausible wrong one. So every result kind has a JSON Schema in app/contracts/ — the single source
of truth, from which the app's TypeScript types are generated too — and the coach runs this before
publishing; the app's server runs it again before the page sees anything. The Meal Prep bridge's
lesson: a validator on the boundary turns "the model wrote something odd" into an error it can fix.

Exit 0 when valid; 1 with every problem listed, each with its JSON path, when not.

An endurance_review is checked twice (docs/DESIGN.md (rides and runs) §4, 2026-10-09): its shape, then its
EVIDENCE — every number a finding cites must equal what scripts/endurance_metrics.py computes for
that activity, so the model can interpret the numbers but never invent or misremember one.

A race_check is checked twice too (docs/DESIGN.md (races) §3, 2026-10-15): its shape, then its RECORD — every
race it names must be in the athlete's races.json with exactly that check recorded (date checked,
status, source, what was found). The coach records a check before it publishes one, and the page draws
from the races view, so a result that disagrees with the file would show one thing and say another.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CONTRACTS = REPO / "app" / "contracts"


def kinds() -> list[str]:
    return sorted(p.name.removesuffix(".schema.json") for p in CONTRACTS.glob("*.schema.json"))


def validate(kind: str, payload) -> list[str]:
    """Every problem with `payload` as a `kind`, as 'path: message' lines. Empty = valid."""
    from jsonschema import Draft202012Validator
    path = CONTRACTS / f"{kind}.schema.json"
    if not path.is_file():
        return [f"no contract for kind {kind!r} (kinds: {', '.join(kinds())})"]
    v = Draft202012Validator(json.loads(path.read_text()))
    out = []
    for e in sorted(v.iter_errors(payload), key=lambda e: list(e.absolute_path)):
        where = "/".join(str(p) for p in e.absolute_path) or "(top)"
        out.append(f"{where}: {e.message}")
    return out


def resolve(analysis: dict, path: str):
    """The value at an evidence path in endurance_metrics.analyse()'s output, or None."""
    head, _, rest = path.partition(".")
    if head == "metrics":
        return (analysis.get("metrics", {}).get(rest) or {}).get("value")
    if head == "bests":
        return analysis.get("bests", {}).get(rest)
    if head == "zones":
        which, _, n = rest.partition(".")
        z = next((z for z in analysis.get("zones", {}).get(which, []) if str(z.get("zone")) == n), None)
        return z and z.get("pct")
    if head == "thresholds":
        return (analysis.get("thresholds", {}).get(rest) or {}).get("value")
    if head == "intervals":   # a swim's rep or a circuit's step (session_review.py): intervals.<n>.<field>
        n, _, fld = rest.partition(".")
        row = next((x for x in analysis.get("intervals", []) if str(x.get("n")) == n), None)
        return row and row.get(fld)
    return None


def check_evidence(payload: dict, analysis: dict) -> list[str]:
    """Every cited number against the engine's: same path, same value (to its rounding)."""
    out = []
    if payload.get("activity_id") != analysis.get("id"):
        out.append(f"activity_id: {payload.get('activity_id')} is not the analysed activity {analysis.get('id')}")
    for i, f in enumerate(payload.get("findings", [])):
        for j, ev in enumerate(f.get("evidence", [])):
            truth = resolve(analysis, ev["metric"])
            where = f"findings/{i}/evidence/{j}"
            if truth is None:
                out.append(f"{where}: {ev['metric']} — the metrics engine has no such number for this activity")
            elif abs(ev["value"] - truth) > max(0.051, 0.01 * abs(truth)):
                out.append(f"{where}: {ev['metric']} is {truth}, not {ev['value']}")
    return out


def check_races(payload: dict, races: list[dict]) -> list[str]:
    """Every way a race_check disagrees with the athlete's races.json. Empty = it was recorded as said."""
    by_id = {r["id"]: r for r in races}
    out = []
    for i, c in enumerate(payload.get("races") or []):
        r = by_id.get(c.get("id"))
        if r is None:
            out.append(f"races/{i}: {c.get('id')!r} is not a race in races.json")
            continue
        v = r.get("verified") or {}
        if v.get("checked") != payload.get("checked"):
            out.append(f"races/{i}: races.json records its last check on {v.get('checked')}, not {payload.get('checked')} "
                       "— record the check before publishing it")
        for f in ("status", "source_kind", "source"):
            if v.get(f) != c.get(f):
                out.append(f"races/{i}/{f}: {c.get(f)!r} here, {v.get(f)!r} in races.json")
        for f in ("date", "start", "venue"):
            if f in (c.get("found") or {}) and (v.get("found") or {}).get(f) != c["found"][f]:
                out.append(f"races/{i}/found/{f}: {c['found'][f]!r} here, {(v.get('found') or {}).get(f)!r} in races.json")
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate")
    v.add_argument("kind")
    v.add_argument("file")
    args = p.parse_args()
    try:
        payload = json.loads(Path(args.file).read_text())
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"{args.file}: not readable JSON ({e})")
    problems = validate(args.kind, payload)
    if not problems and args.kind == "endurance_review":
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import session_review   # the bound athlete's — the same engine the page reads (rides, runs, swims, circuits)
        problems = check_evidence(payload, session_review.analysis_for(int(payload["activity_id"])))
    if not problems and args.kind == "race_check":
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import races   # the bound athlete's races.json — the file the races view reads
        problems = check_races(payload, races.load())
    if problems:
        print(f"{args.file} is not a valid {args.kind}:", file=sys.stderr)
        for line in problems:
            print(f"  - {line}", file=sys.stderr)
        sys.exit(1)
    print(f"ok — valid {args.kind}")


if __name__ == "__main__":
    main()
