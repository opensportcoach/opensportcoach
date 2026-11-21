#!/usr/bin/env python3
"""Synthetic score cases for the web component tests (app/web/src/test/score.test.tsx), every one
scripts/session_score.py's own output: a Mostly gym day with an exercise not started, an interval ride, an
Unclear ride and a provisional one. Synthetic sessions only, no athlete's data.

    .venv/bin/python app/fixtures/make_score_cases.py      # writes app/fixtures/score/cases.json
"""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import session_score as sc
import formulas as f

def s_(cat, name, kg, reps, dur=40):
    return {"setType": "ACTIVE", "weight": kg * 1000.0, "repetitionCount": reps, "duration": dur, "exercises": [{"category": cat, "name": name}]}
def r_(secs): return {"setType": "REST", "duration": secs}

# A gym day: rows done, one 2 reps short, one 20 % over, the last exercise never started.
rows = [("E1", "Bench press", "BENCH_PRESS", "BARBELL_BENCH_PRESS", 3, 10, 80, 120, "reps"),
        ("E2", "Cable row", "ROW", "SEATED_CABLE_ROW", 3, 12, 50, 90, "reps"),
        ("E3", "Lateral raise", "LATERAL_RAISE", "SEATED_LATERAL_RAISE", 3, 15, 10, 60, "reps"),
        ("E4", "Hammer curl", "CURL", "DUMBBELL_HAMMER_CURL", 3, 12, 14, 60, "reps")]
raw = []
for kg, reps in ((80, 10), (80, 10), (80, 8)):
    raw += [s_("BENCH_PRESS", "BARBELL_BENCH_PRESS", kg, reps), r_(125)]
for kg in (60, 60, 60):
    raw += [s_("ROW", "SEATED_CABLE_ROW", kg, 12), r_(95)]
for kg in (10, 10, 10):
    raw += [s_("LATERAL_RAISE", "SEATED_LATERAL_RAISE", kg, 15), r_(200)]
r = sc.strength_parts(raw, rows, None, two_db=set(), unilateral=set(), warmups_stripped=True)
cap = (f.SKIPPED_CAP, f"not started: {', '.join(r['skipped'])}") if r["skipped"] else None
head = lambda i, d, t, g: {"id": i, "date": d, "title": t, "type": None, "group": g}
gym = head(1, "2026-10-15", "Synthetic gym day", "strength") | sc.assemble(
    "strength", r["scores"], r["coverage"], "Synthetic day · program.py (working copy)",
    {"day": "d1", "rows": r["rows"], "chips": r["chips"], "unnamed_sets": 0}, r["dropped"], r["detail"], r["flags"], cap)

def ride(plan, m, p1, moving, fuel_plan=None, fuel_taken=None, grp="bike", i=2, title="Synthetic ride"):
    x = sc.endurance_parts(plan, m, p1=p1, speed1=None, hr_zones=[], ftp=250, moving_s=moving,
                           fuel_plan=fuel_plan, fuel_taken=fuel_taken, grp=grp)
    return head(i, "2026-10-14", title, grp) | sc.assemble("endurance", x["scores"], x["coverage"], f"plan.json · {title}",
                                                          {"intent": plan.get("intent")}, x["dropped"], x["detail"], x["flags"])

p1 = [120.0] * 600 + ([300.0] * 180 + [120.0] * 180) * 3 + [120.0] * 600
vo2 = ride({"intent": "vo2", "duration_min": 45, "work": [{"reps": 5, "secs": 180, "target": [292, 305]}]},
           {"if": {"value": 0.86}, "vi": {"value": 1.25}}, p1, len(p1), title="Synthetic VO2 ride")
unclear = ride({"duration_min": 60}, {"vi": {"value": 1.02}}, [150.0] * 3600, 3600, i=3, title="Synthetic ride, no intent")
pending = ride({"intent": "endurance", "duration_min": 120}, {"vi": {"value": 1.03}}, [160.0] * 6900, 6900,
               fuel_plan={"total_g": 100}, i=4, title="Synthetic long ride, fuel not logged")
out = {"_why": "Synthetic sessions scored by scripts/session_score.py, for the web component tests. Regenerate with the "
               "engine; never edit by hand.", "gym_mostly": gym, "ride_vo2": vo2, "ride_unclear": unclear, "ride_provisional": pending}
(ROOT / "app/fixtures/score/cases.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
for k, v in out.items():
    if k.startswith("_"): continue
    print(k, v["total"], v["band"], v["headline"], "|", v["summary"], "| chips", len(v.get("chips", [])), "| prov", v["provisional"])
