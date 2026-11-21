#!/usr/bin/env python3
"""Multi-session strength progression report for the current athlete (a standing requirement).

Judges every exercise across its LAST SEVERAL occurrences — never last-vs-plan.
Reads the athlete's cached data/<name>/ (no Garmin calls), normalizes per their LOGGING_RULES.json,
and classifies each lift: PROGRESSING / FLAT / STALLED / REGRESSED.

Reliable named-exercise data starts 2026-06-13 (structured workouts); older
auto-detect sessions are excluded by default.

Usage:
  python scripts/progression_report.py                 # full report
  python scripts/progression_report.py --min-points 2  # only lifts with a trend
  python scripts/progression_report.py --since 2026-06-13 --last 6
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402
import formulas  # noqa: E402
import strength_sessions as ss  # noqa: E402

A = athlete.current()
DATA = A.data_dir
RULES = A.logging_rules
TWO_DB = {tuple(x) for x in RULES["two_db_weight_summed"]}
UNILATERAL = {tuple(x) for x in RULES["unilateral_reps_summed"]}
# Machine lifts logged as added-disc load only (base unknown): NEVER e1RM —
# score by top disc weight, compare disc-to-disc across sessions only.
MACHINE = {tuple(x) for x in RULES.get("machine_added_load_only", [])}

# Deliberate backoff/deload/injury days + known bad data points live in
# athletes/<name>/workouts/SESSION_ANNOTATIONS.json: shown in trends (marked *) but excluded from
# classification. strength_sessions owns the reader, so every consumer applies the same scoping.
annotated = ss.annotated

FLAT_TOLERANCE = 0.02   # within 2% of previous best = FLAT
REGRESS_FLOOR = 0.95    # latest < 95% of best = REGRESSED
STALL_SESSIONS = 3      # no new best in >= 3 occurrences = STALLED


def e1rm(w: float, reps: int) -> float:
    return round(formulas.e1rm(w, reps), 1)


def pretty(cat: str | None, name: str | None) -> str:
    return (name or cat or "?").replace("_", " ").title()


def trend_key(cat: str, name: str, day: str | None, owners: dict) -> tuple:
    """(cat, name) — or (cat, name, day) when the pair is prescribed on several days.

    2026-10-04 audit, P1-2: bench is D1 4x10 @80 and D4 4x12 @70. One series mixed 80x8, 70x12
    and a 50x12 calibration day and printed [REGRESSED] off that mixture. A shared pair now gets
    one series per day; logged on a day that prescribes neither copy, it is its own series ("?").
    """
    if len(owners.get((cat, name), ())) <= 1:
        return (cat, name)
    return (cat, name, day if day in owners[(cat, name)] else "?")


def collect(since: str):
    """trend key -> list of (date, best_score, top_w, top_reps) sorted by date."""
    owners = ss.pair_days()
    per_ex = defaultdict(lambda: defaultdict(lambda: (0.0, 0.0, 0)))  # key -> date -> (score, w, reps)
    for sess in ss.sessions(since):
        for s in sess.sets:
            cat, name = ss.pair(s)
            if cat is None:
                continue
            key = trend_key(cat, name, sess.day, owners)
            pair_ = key[:2]
            w = (s.get("weight") or 0) / 1000
            reps = s.get("repetitionCount") or 0
            if pair_ in TWO_DB:
                w /= 2
            if pair_ in UNILATERAL:
                reps = reps // 2
            if not reps:
                continue
            if pair_ in MACHINE:
                score = w  # disc load only — e1RM is meaningless (machine base unknown)
            elif w:
                score = e1rm(w, reps)
            else:
                score = float(reps)  # bodyweight -> rep progression
            if score > per_ex[key][sess.date][0]:
                per_ex[key][sess.date] = (score, w, reps)
    return {k: sorted((d, *v) for d, v in days.items()) for k, days in per_ex.items()}


def classify(points: list, key: tuple) -> str:
    """Classify on non-annotated points only — deliberate backoff/deload/injury
    days and known bad data points (SESSION_ANNOTATIONS.json) must never read as
    regressions."""
    points = [p for p in points if not annotated(p[0], key[:2])] or points
    if len(points) < 2:
        return "1 POINT"
    scores = [p[1] for p in points]
    latest, prev_best = scores[-1], max(scores[:-1])
    if latest > prev_best * (1 + FLAT_TOLERANCE):
        return "PROGRESSING"
    if latest < max(scores) * REGRESS_FLOOR:
        return "REGRESSED"
    best_idx = scores.index(max(scores))
    if len(scores) - 1 - best_idx >= STALL_SESSIONS:
        return "STALLED"
    return "FLAT"


def bump_signals(sessions: list, history: dict, owners: dict, prog: dict | None = None,
                 lead: dict | None = None) -> list[str]:
    """The bump signals as main() prints them (rules: bump_rows)."""
    return [f"{b['exid']:5s} {pretty(b['category'], b['name']):38s} {b['date']}: {b['sets_done']} sets, "
            f"all >= {b['reps_target']}{'s' if b['kind'].startswith('time') else ' reps'} "
            f"@ {b['label']} -> {b['increment']}"
            for b in bump_rows(sessions, history, owners, prog, lead)]


def bump_rows(sessions: list, history: dict, owners: dict, prog: dict | None = None,
              lead: dict | None = None) -> list[dict]:
    """Prescriptions whose latest attempt(s) hit the rep target on all planned sets AT the
    programmed weight -> time to add weight (the double-progression trigger, automated).

    Reads build_workouts.prescriptions() — the main lifts AND the core block. Until 2026-11-01 it
    iterated PROGRAM[day]["exercises"], so it could not see the core block at all and the core
    rule never fired once in the three weeks it was in force. A main lift needs ONE clean session,
    the core block TWO; `_increment()` holds each one's step.

    Per PRESCRIPTION — day/exerciseId — not per catalog pair (2026-10-04 audit, P1-2):
      * Bench D1 4x10 @80 and D4 4x12 @70 used to be merged "conservatively" into 4x12 @80, a
        target neither day prescribes. D1's 80x8 missed 12 reps and D4's 70x12 was under 80, so
        a bench signal could never fire from either day.
      * A signal whose latest attempt started BEFORE the current ask was set has already been
        acted on. Re-firing it is how incline @30 — set on 10-03 from the 10-01 session — read
        "bump" again, and an agent that skipped the prose note would have asked for 32.
    """
    import prescription_audit as pa
    import build_workouts as bw
    # A synthetic program gets exactly the core blocks the caller hands it — never the real LEAD,
    # which has nothing to do with a fixture's days.
    rows = bw.prescriptions() if prog is None else bw.prescriptions(prog, lead or {})
    out = []
    for day_key, ex, block in rows:
        exid, _, cat, name, sets_n, top, w_plan, _, kind = ex
        held = kind.startswith("time")
        if kind not in ("reps", "fixed", "time", "reps_per_side", "time_per_side"):
            continue
        # An unloaded timed MAIN lift is a conditioning dose, not a double progression: the sprints,
        # ski moguls, alternating waves and sled pushes hit their clock every time by design, and
        # "+weight" on a 10-second sprint is not advice. A timed CORE hold does progress (the v8.4
        # rule), and so does a LOADED carry or hold.
        if held and not w_plan and block != "core":
            continue
        # A per-side exercise emits two work steps per round (build_workouts.exercise_group, the
        # 2026-09-01 side-plank fix), so 3 rounds reach the watch as 6 logged sets.
        want = sets_n * (2 if kind.endswith("_per_side") else 1)
        key = (cat, name)
        since = pa.since_ts(history.get(f"{day_key}/{exid}", {}))
        mine = [x for x in sessions
                if key in x.keys() and ss.counts_for(x.day, day_key, key, owners)
                and x.start > since          # sessions before the ask already produced it
                and not annotated(x.date, key)]   # never off a backoff day or a bad data point
        # HOW MANY CLEAN SESSIONS THE STEP COSTS. One for a main lift — the rule since this function
        # was written, and the comment above says why re-firing an older one is wrong. TWO for the
        # core block, because that is the rule he wrote: "the top of its range on every set, two
        # sessions running" (memory/preference/core-must-progress.md, v8.4). Firing core off one
        # session would have bumped the D2 pull-through on 2026-11-01, which was held by hand for
        # exactly this reason.
        need = 2 if block == "core" else 1
        if len(mine) < need:
            continue
        clean, last = [], None
        for sess in mine[-need:]:
            done = []
            for st in sess.sets:
                if ss.pair(st) != key:
                    continue
                r = (st.get("duration") or 0) if held else (st.get("repetitionCount") or 0)
                if not r:
                    continue
                w = (st.get("weight") or 0) / 1000
                # A per-side HOLD logs each side with its own duration — halving it would ask for
                # twice the hold. Only summed REPS are halved.
                if key in UNILATERAL and not held:
                    r = r // 2
                done.append((w / 2 if key in TWO_DB else w, r))
            w_top = max((w for w, _ in done), default=0)
            # EVERY planned set at the load, not just the top one. Until 2026-11-02 this compared
            # w_top alone, so his D2E9 cable row at 30/40/40 x12 read as 3x12 @40 and fired a bump
            # off two working sets. A lighter set before them is a warm-up: it neither counts as
            # one of the planned sets nor breaks them.
            work = [(w, r) for w, r in done if not w_plan or w >= w_plan - 0.01]
            clean.append(len(work) >= want and all(r >= top for _, r in work[:want]))
            last = (sess, done, w_top)
        if not all(clean):
            continue
        sess, done, w_top = last
        inc = _increment(block, cat, kind, w_plan)
        label = f"{w_top:g}kg" if w_top else "BW"
        out.append({"day": day_key, "exid": exid, "category": cat, "name": name,
                    "date": sess.date, "sets_done": len(done), "reps_target": top,
                    "weight": w_top, "label": label, "increment": inc, "kind": kind,
                    "block": block, "sessions_clean": need, "earned_on": sess.date})
    return out


def _increment(block: str, cat: str, kind: str, w_plan: float | None) -> str:
    """The next step this prescription earns, in the terms its own rule is written in.

    The core block has its own, his (memory/preference/core-must-progress.md, v8.4): "+2 kg on a
    plate, feet further back on the TRX, or +2 reps". The TRX case is keyed on the catalog CATEGORY,
    not on the exercise id — ids are per-day slots and C6 is the fallout only by convention.
    """
    if block == "core":
        if cat == "SUSPENSION":
            return "feet further back (the angle, not more reps)"
        if w_plan:
            return "+2kg (the hold or the reps stay)"
        return "+5s" if kind.startswith("time") else "+2 reps"
    if kind == "fixed":
        return "+2.5kg"
    return "+weight (reset reps to range bottom)"


CLASS_DEFINITIONS = {
    "PROGRESSING": f"latest session's best beats the previous best by more than {FLAT_TOLERANCE:.0%}",
    "FLAT": f"within {FLAT_TOLERANCE:.0%} of the previous best",
    "STALLED": f"no new best in {STALL_SESSIONS}+ sessions",
    "REGRESSED": f"latest below {REGRESS_FLOOR:.0%} of the best",
    "1 POINT": "only one session so far",
}


def lift_rows(since: str = "2026-06-13") -> list[dict]:
    """Every lift's trend and class — the data behind main()'s report, also read by the app
    (scripts/app_data.py). Scores: e1RM (per hand where it applies), added-disc load for machine
    lifts, reps for bodyweight lifts."""
    out = []
    for key, pts in collect(since).items():
        out.append({
            "category": key[0], "name": key[1], "day": key[2] if len(key) > 2 else None,
            "label": pretty(*key[:2]), "class": classify(pts, key),
            "score": "disc load" if key[:2] in MACHINE else ("e1rm" if any(w for _, _, w, _ in pts) else "reps"),
            "points": [{"date": d, "score": sc, "weight": w, "reps": r, "annotated": annotated(d, key[:2])}
                       for d, sc, w, r in pts],
        })
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--since", default="2026-06-13", help="reliable-data start date")
    p.add_argument("--last", type=int, default=5, help="occurrences shown per lift")
    p.add_argument("--min-points", type=int, default=1)
    args = p.parse_args()

    data = collect(args.since)
    order = {"REGRESSED": 0, "STALLED": 1, "PROGRESSING": 2, "FLAT": 3, "1 POINT": 4}
    rows = sorted(data.items(), key=lambda kv: (order[classify(kv[1], kv[0])], -kv[1][-1][1]))

    print(f"=== Progression report (since {args.since}; per-side normalized; "
          f"BW lifts scored by reps; machine lifts by disc load; * = annotated backoff/deload day) ===\n")
    for key, pts in rows:
        if len(pts) < args.min_points:
            continue
        cls = classify(pts, key)
        disc = " [disc]" if key[:2] in MACHINE else ""
        disc += f" [{key[2]}]" if len(key) > 2 else ""
        trend = "  ".join(
            (f"{d[5:]}: {w:g}x{r} ({s:g})" if w else f"{d[5:]}: BWx{r}") + ("*" if annotated(d, key[:2]) else "")
            for d, s, w, r in pts[-args.last:]
        )
        print(f"[{cls:11s}] {pretty(*key[:2]) + disc:38s} {trend}")

    import prescription_audit as pa
    bumps = bump_signals(ss.sessions(args.since), pa.load_history(), ss.pair_days())
    if bumps:
        print("\n=== BUMP SIGNALS — latest session hit the rep target on all sets ===\n")
        for line in bumps:
            print(f"  {line}")


if __name__ == "__main__":
    main()
