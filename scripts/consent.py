#!/usr/bin/env python3
"""Record that the athlete read the disclaimer and answered the health screen — before any plan.

    .venv/bin/python scripts/consent.py show                     # the disclaimer summary and the questions
    .venv/bin/python scripts/consent.py record --answers '<json>'

WHY. OpenSportCoach writes training plans with an AI. It is not a doctor, a physiotherapist or a
qualified coach, and it can be wrong. So nobody gets a plan until they have (1) said they are an adult,
(2) read DISCLAIMER.md and accepted it in their own words, and (3) answered a short health screen. Any
"yes" on the screen means: get cleared by a doctor before following a plan. The coach says so, records
it, and keeps every plan conservative until they confirm the clearance. Nothing here is medical advice.

--answers is JSON: {"adult": true, "accepted": true, "screen": {"heart": false, "symptoms": false,
"chronic": false, "pregnancy": false, "injury": false, "other": false}, "clearance": null | "yes" | "no",
"notes": "their words, if any"}. It lands in athlete.json → consent, with the disclaimer's version and
the date. setup_status.py reads it: the banner says "Setup to finish" until it is complete.

The questions are this project's own wording, written for it; they are a prompt to see a professional,
not a clinical screening tool.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

DISCLAIMER = athlete.REPO_ROOT / "DISCLAIMER.md"
SCREEN = {
    "heart": "Has a doctor ever told you that you have a heart condition, or that you should only exercise "
             "under medical supervision?",
    "symptoms": "Do you get chest pain, unusual breathlessness, dizziness or fainting during or after exercise?",
    "chronic": "Do you have high blood pressure, diabetes or another long-term condition, or take medication "
               "for your heart or blood pressure?",
    "pregnancy": "Are you pregnant, or have you given birth in the last six months?",
    "injury": "Do you have an injury, a joint or bone problem, or recent surgery that training could make worse?",
    "other": "Is there any other reason you know of why you should not train hard?",
}
SUMMARY = ("OpenSportCoach is free software that uses an AI to suggest training. It is not medical advice and "
           "not a replacement for a doctor, physiotherapist or qualified coach. Its plans can be wrong. You "
           "train at your own risk, you decide what you do, and you stop and get help if something hurts or "
           "feels wrong. The authors and contributors accept no responsibility for any injury, illness or "
           "loss. Your data stays on your computer, except what you send to your AI provider when you use it.")


def version() -> str:
    """The disclaimer's version: its `Version:` line, so a changed disclaimer is accepted again."""
    m = re.search(r"^Version:\s*(\S+)", DISCLAIMER.read_text(), re.M) if DISCLAIMER.is_file() else None
    return m.group(1) if m else "unversioned"


def missing(a: athlete.Athlete) -> list[dict]:
    """The safety questions still open, for setup_status.py."""
    c = a.config.get("consent") or {}
    out = []
    if c.get("adult") is not True:
        out.append({"id": "adult", "text": "Are you 18 or older? (OpenSportCoach is for adults only.)"})
    if c.get("accepted") is not True or c.get("version") != version():
        out.append({"id": "disclaimer", "text": "Read DISCLAIMER.md (the summary: " + SUMMARY + ") — do you "
                                                "accept it?"})
    screen = c.get("screen") or {}
    out += [{"id": f"screen.{k}", "text": q} for k, q in SCREEN.items() if not isinstance(screen.get(k), bool)]
    if any(screen.get(k) for k in SCREEN) and c.get("clearance") != "yes":
        out.append({"id": "clearance", "text": "You answered yes on the health screen: have you been cleared by "
                                               "a doctor to train? Until then plans stay conservative."})
    return out


def record(a: athlete.Athlete, answers: dict) -> dict:
    if answers.get("adult") is False:
        raise SystemExit("OpenSportCoach is for adults only. Nothing was recorded, and no plan will be made.")
    screen = answers.get("screen") or {}
    bad = [k for k in screen if k not in SCREEN]
    if bad:
        raise SystemExit(f"unknown screen questions: {bad} (known: {', '.join(SCREEN)})")
    path = a.root / "athlete.json"
    cfg = json.loads(path.read_text())
    prev = cfg.get("consent") or {}
    c = {**prev, **{k: v for k, v in answers.items() if k in ("adult", "accepted", "clearance", "notes")}}
    c["screen"] = {**(prev.get("screen") or {}), **screen}
    if answers.get("accepted") is True:
        c["version"], c["accepted_on"] = version(), dt.date.today().isoformat()
    c["clearance_advised"] = any(c["screen"].get(k) for k in SCREEN)
    cfg["consent"] = c
    path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
    return c


def main() -> int:
    a = athlete.current()   # first: it takes --athlete off the command line
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    r = sub.add_parser("record")
    r.add_argument("--answers", required=True)
    args = ap.parse_args()
    if args.cmd == "show":
        print(f"Disclaimer (version {version()}): {SUMMARY}\n\nHealth screen — yes or no:")
        for i, q in enumerate(SCREEN.values(), 1):
            print(f"  {i}. {q}")
        return 0
    c = record(a, json.loads(args.answers))
    print(f"{a.display}: consent recorded" + (" — CLEARANCE ADVISED: tell them to see a doctor before following a plan,"
                                             " and keep every plan conservative until they confirm it."
                                             if c["clearance_advised"] and c.get("clearance") != "yes" else "."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
