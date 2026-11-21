#!/usr/bin/env python3
"""Generate EXERCISE_CATALOG.json from Garmin's official FIT SDK profile.

WHY (his instruction, 2026-08-30): "You must update your catalog of exercises and include
ALL garmin exercises."

Until now the catalog grew one key at a time — 91 pairs against the ~1,548 his Connect
picker lists — because there is no Connect taxonomy endpoint (seven were probed, all 404
or 500) and guessing a key is worse than leaving a step unnamed: an unvalidated key
uploads cleanly and then renders as "Unknown exercise" on the watch.

The taxonomy was never actually missing. It is defined in the FIT protocol itself, which
is where both the watch and Connect get it from: `exercise_category` enumerates the
categories, and each one has its own `<category>_exercise_name` enum. Garmin publishes
this as the `garmin-fit-sdk` package. That is the authoritative source, offline and
versioned, and it supersedes hand-harvesting entirely.

CAVEAT WORTH KNOWING: the FIT profile carries 1,846 names while his Connect picker shows
~1,548. FIT is the superset — it includes names Connect's UI does not offer. A pair from
here is structurally valid and will render, but if one ever comes back wrong on the watch,
prefer a key harvested from his own logged data (harvest_exercises.py) over one that only
exists here.

Usage: .venv/bin/python scripts/build_exercise_catalog.py
"""
from __future__ import annotations

import json
from pathlib import Path

from garmin_fit_sdk import profile

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "workouts" / "EXERCISE_CATALOG.json"


def main() -> None:
    types = profile.Profile["types"]
    categories = types["exercise_category"]

    previous = {}
    if CATALOG.exists():
        previous = json.loads(CATALOG.read_text()).get("categories", {})

    built: dict[str, list[str]] = {}
    for _value, cat_name in categories.items():
        if cat_name == "unknown":
            continue
        names = types.get(f"{cat_name}_exercise_name")
        if not names:
            continue
        built[cat_name.upper()] = sorted(
            {str(n).upper() for n in names.values() if str(n) != "unknown"})

    # Nothing that was previously validated may be lost: those pairs are proven — they
    # round-tripped onto his watch or Garmin itself recorded them.
    lost = []
    for cat, names in previous.items():
        for n in names:
            if n not in built.get(cat, []):
                lost.append(f"{cat}/{n}")
                built.setdefault(cat, []).append(n)
                built[cat] = sorted(built[cat])

    total = sum(len(v) for v in built.values())
    payload = {
        "_meta": {
            "source": f"garmin-fit-sdk profile (FIT {profile.Profile.get('version')})",
            "generated_by": "scripts/build_exercise_catalog.py",
            "note": "GENERATED — do not hand-edit. The FIT profile is what the watch and "
                    "Connect both render from, so a pair here is structurally valid. It is a "
                    "superset of Connect's picker (~1548), so prefer a key harvested from his "
                    "own logged data if one ever renders wrong.",
            "categories": len(built),
            "pairs": total,
        },
        "categories": dict(sorted(built.items())),
    }
    CATALOG.write_text(json.dumps(payload, indent=1) + "\n")

    prev_total = sum(len(v) for v in previous.values())
    print(f"catalog: {len(previous)} categories / {prev_total} pairs "
          f"-> {len(built)} categories / {total} pairs")
    if lost:
        print(f"\n{len(lost)} previously-validated pair(s) NOT in the FIT profile — kept anyway:")
        for x in lost:
            print(f"  {x}")


if __name__ == "__main__":
    main()
