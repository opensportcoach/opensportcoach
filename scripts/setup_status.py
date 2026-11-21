#!/usr/bin/env python3
"""What this athlete's setup is still missing — asked the first time a session is bound to them.

    .venv/bin/python scripts/setup_status.py          # the open questions, by section; nothing when done
    .venv/bin/python scripts/setup_status.py --json

WHY (2026-11-06, docs/DESIGN.md (fuelling and score) §3). Some features need answers only the athlete has — which gels
they own, how they mix a bottle. The rule: those questions are asked when a session is bound to
the athlete, and the next /osc-daily detects an unfinished setup and asks to finish it. Nobody has
to remember. So the detection is a script, and every place that can ask reads it:

  * use.py and the SessionStart hook print one line under the banner (whoami.banner → line());
  * /osc-daily runs this at step 0 and asks before it picks a session;
  * the app shows it as "Finish your setup" (a later phase);
  * /osc-brief, unattended, notes it and never asks.

Sections: safety (consent.py), data sources (sources.py), fuel. A later feature adds its section to
SECTIONS, never a second mechanism.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402


def _fuel(a: athlete.Athlete) -> list[dict]:
    import fuel
    open_ = fuel.setup_missing(fuel.load_cfg(a), fuel.catalog())
    return [{"id": q, "text": fuel.SETUP_TEXT[q]} for q in open_]


def _safety(a: athlete.Athlete) -> list[dict]:
    import consent
    return consent.missing(a)


def _sources(a: athlete.Athlete) -> list[dict]:
    """Is their data source connected? Garmin: an account bound. Files: anything imported. Strava: anything
    read (the MCP is connected in Claude Code, outside this repo, so a first import is the proof)."""
    import sources
    out = []
    srcs = sources.of(a)
    if "garmin" in srcs and not a.garmin.get("display_name"):
        out.append({"id": "garmin", "text": f"Connect Garmin: in your own terminal, "
                                            f".venv/bin/python scripts/login.py --athlete {a.name}"})
    if "files" in srcs and not (a.data_dir / sources.SUMMARY_FILE["files"]).exists():
        out.append({"id": "files", "text": "Import your history: Strava → Settings → My Account → Download or "
                                           "Delete Your Account → Request your archive, then "
                                           f".venv/bin/python scripts/import_files.py <the zip>; or drop FIT/GPX/TCX "
                                           f"files in data/{a.name}/inbox/"})
    if "strava" in srcs and not (a.data_dir / sources.SUMMARY_FILE["strava"]).exists():
        out.append({"id": "strava", "text": "Connect Strava's MCP (needs a Strava subscription): "
                                            "claude mcp add --transport http strava-mcp https://mcp.strava.com/mcp"})
    return out


# Safety first: no plan before the disclaimer is accepted and the health screen answered.
SECTIONS = (("safety", "Safety", _safety), ("sources", "Data sources", _sources), ("fuel", "Fuelling", _fuel))


def missing(a: athlete.Athlete) -> list[dict]:
    """Each section with open questions: {section, label, questions: [{id, text}]}."""
    out = []
    for key, name, open_questions in SECTIONS:
        qs = open_questions(a)
        if qs:
            out.append({"section": key, "label": name, "questions": qs})
    return out


def line(a: athlete.Athlete) -> str | None:
    """The banner's one line, or None when the setup is complete."""
    m = missing(a)
    if not m:
        return None
    parts = ", ".join(f"{s['label'].lower()} ({len(s['questions'])} question{'s' if len(s['questions']) > 1 else ''})"
                      for s in m)
    return (f"Setup to finish: {parts} — ask {a.display} before planning "
            "(.venv/bin/python scripts/setup_status.py lists the questions).")


def main() -> None:
    a = athlete.current()
    m = missing(a)
    if "--json" in sys.argv:
        print(json.dumps({"athlete": a.name, "missing": m}, indent=1))
        return
    if not m:
        print(f"{a.display}: setup complete.")
        return
    print(f"{a.display}: setup to finish.")
    for s in m:
        print(f"\n{s['label']}")
        for i, q in enumerate(s["questions"], 1):
            print(f"  {i}. {q['text']}")
    print("\nRecord safety answers with  .venv/bin/python scripts/consent.py record --answers '<json>'"
          "\nRecord the fuel answers with  .venv/bin/python scripts/fuel.py setup --answers '<json>'")


if __name__ == "__main__":
    main()
