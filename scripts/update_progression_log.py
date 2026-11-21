#!/usr/bin/env python3
"""Regenerate the generated section of the athlete's PROGRESSION_LOG.md.

WHY (2026-08-30 audit, finding 4). The file is mandated by CLAUDE.md, append-only and
newest-first, and it was entirely hand-maintained — so it stopped. On 2026-08-30 its
newest entry was 2026-08-14 while roughly ten load bumps had been applied and pushed in
between. The data was never missing; only the transcription was.

Two sources, both already produced by the pipeline:
  * athletes/<name>/workouts/PRESCRIPTION_HISTORY.json  — every load change with its date
  * athletes/<name>/dashboard.json                      — e1RM PRs

Everything above the AUTO marker is curated prose and is preserved untouched. Everything
below it is regenerated on each run, so the script is safe to re-run any number of times.

Usage: .venv/bin/python scripts/update_progression_log.py
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

A = athlete.current()
LOG = A.root / "PROGRESSION_LOG.md"
MARKER = "<!-- AUTO-GENERATED BELOW — edit scripts/update_progression_log.py, not this text -->"


def pretty(key: str) -> str:
    return key.split("/", 1)[-1].replace("_", " ").title()


def main() -> None:
    hist = json.loads((A.workouts_dir / "PRESCRIPTION_HISTORY.json").read_text())
    hist.pop("_meta", None)

    by_date: dict[str, list] = defaultdict(list)
    for key, v in hist.items():
        # 2026-09-21: keys are now day/exid, so the exercise name comes from the entry. The
        # old pretty(key) split the catalog pair, which a day/exid key no longer contains.
        label = pretty(v.get("name") or key)
        if v.get("day") and v.get("id"):
            label = f"{label} ({v['id']})"
        for ch in v.get("changes", []):
            if ch.get("from") is None or ch.get("to") is None:
                continue
            by_date[ch["date"]].append((label, ch["from"], ch["to"], ch.get("reps")))

    prs = []
    dash = A.dashboard_path
    if dash.exists():
        prs = json.loads(dash.read_text()).get("strength", {}).get("prs", [])

    lines = [MARKER, ""]
    lines.append("## e1RM bests on record")
    lines.append("")
    lines.append("| Lift | e1RM | Date |")
    lines.append("|---|---|---|")
    for p in prs:
        lines.append(f"| {p['lift']} | **{p['e1rm']:g} kg** | {p['date']} |")
    lines.append("")
    # The athlete's own caveat about this table, if any (athlete.json -> profile).
    note = A.profile.get("progression_log_note") or []
    lines.extend(f"> {line}" for line in note)
    if note:
        lines.append("")
    lines.append("## Load changes, newest first")
    lines.append("")
    if not by_date:
        lines.append("_No recorded changes yet — PRESCRIPTION_HISTORY.json starts accumulating from")
        lines.append("the build that created it._")
    for date in sorted(by_date, reverse=True):
        lines.append(f"### {date}")
        lines.append("")
        for name, frm, to, reps in sorted(by_date[date]):
            arrow = "↑" if to > frm else "↓"
            lines.append(f"- {arrow} **{name}** {frm:g} → **{to:g} kg** (×{reps})")
        lines.append("")

    existing = LOG.read_text() if LOG.exists() else "# PROGRESSION_LOG — append-only, newest first\n"
    head = existing.split(MARKER)[0].rstrip() + "\n\n"
    LOG.write_text(head + "\n".join(lines).rstrip() + "\n")
    n = sum(len(v) for v in by_date.values())
    print(f"PROGRESSION_LOG.md: {n} load changes across {len(by_date)} dates, {len(prs)} PRs")


if __name__ == "__main__":
    main()
