#!/usr/bin/env python3
"""Every planned Zwift ride names a workout from Zwift's library. The rule is written here, once.

WHY (2026-11-05, an athlete's rule). The plan for 11-05 said "Zwift · VO2 50′: 5 × 3′ at 292–305 W" and
named no workout. On the bike he rode what Zwift offered, "8.5 Minutes Of Pain": 9′ of work against
the 15′ planned. His words: "whenever you plan a Zwift ride you must also recommend a workout from
Zwift". So a Zwift session carries `zwift_workout`: a real workout from Zwift's library, as documented
on whatsonzwift.com, with its link. The watts and the reps stay in `detail`. The workout is what he
opens in Zwift's menu.

Where it lives:
    athletes/<name>/plan.json  → sessions[] with "platform": "zwift"  → "zwift_workout": {...}
    a plan_proposal            → days[] with "sport": "zwift"         → "zwift_workout": {...}

The shape:
    name           the workout's name in Zwift, exactly as the site lists it
    url            its page: https://whatsonzwift.com/workouts/<collection>/<slug>
    collection     the collection it sits in (Endurance, VO2 Max…): where to find it in Zwift's menu
    duration_min   how long it runs, from the site
    stress_points  the site's stress points (optional)
    adjust         how to ride it against the prescription when it is not an exact match: "in ERG,
                   lift cadence to 110–120 rpm for 20 s every 5′" (optional)

Never invent one. Guessed slugs often 404 (memory/convention/zwift-prescription-lookup.md), so the
coach opens the page with its own web tool, reads the fields off it, and checks the block here:

    .venv/bin/python scripts/zwift_workouts.py '<zwift_workout json>'   # prints it back, or refuses

This script never fetches the site itself. whatsonzwift.com's robots.txt forbids automated collection
of its content other than search indexing and AI retrieval, so the reading is the coach's, one page at
the athlete's request, and the block keeps only the facts (name, collection, minutes, stress points)
and the link back to the page.

Enforced by tests/run_tests.py::test_off_watch_plan_is_well_formed (plan.json) and the plan_proposal
contract (app/contracts/plan_proposal.schema.json).
"""
from __future__ import annotations

import json
import re
import sys

SITE = "https://whatsonzwift.com/workouts/"
# His rule is from 2026-11-05. Sessions already planned for that day and earlier predate it.
RULE_FROM = "2026-11-06"
REQUIRED = ("name", "url", "duration_min")
OPTIONAL = ("collection", "stress_points", "adjust")


def needs_workout(session: dict) -> bool:
    """A plan.json session that must name a Zwift workout: one Zwift runs, dated from the rule on."""
    return session.get("platform") == "zwift" and str(session.get("date", "")) >= RULE_FROM


def problems(zw) -> list[str]:
    """What is wrong with a `zwift_workout` block; [] when it is well formed."""
    if not isinstance(zw, dict):
        return ["zwift_workout is missing: name a workout from Zwift's library (scripts/zwift_workouts.py <url>)"]
    out = [f"zwift_workout.{k} is missing" for k in REQUIRED if zw.get(k) in (None, "")]
    out += [f"zwift_workout.{k} is not a known field" for k in zw if k not in REQUIRED + OPTIONAL]
    url = str(zw.get("url") or "")
    if url and not (url.startswith(SITE) and len(url) > len(SITE)):
        out.append(f"zwift_workout.url must be a workout page under {SITE}: {url!r}")
    for k in ("duration_min", "stress_points"):
        v = zw.get(k)
        if v is not None and not (isinstance(v, int) and v > 0):
            out.append(f"zwift_workout.{k} must be a positive whole number: {v!r}")
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.split("\n\n")[0])
        print("usage: zwift_workouts.py '<zwift_workout json>'  (read off the whatsonzwift.com page)")
        return 2
    try:
        block = json.loads(sys.argv[1])
    except ValueError as e:
        print(f"refused: not JSON ({e})", file=sys.stderr)
        return 1
    bad = problems(block)
    if bad:
        print("refused: " + "; ".join(bad), file=sys.stderr)
        return 1
    print(json.dumps(block, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
