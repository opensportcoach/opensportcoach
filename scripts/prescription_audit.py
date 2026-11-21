#!/usr/bin/env python3
"""Flag prescriptions that ask for more than the athlete has ever executed.

WHY THIS EXISTS (2026-08-14). The 2026-07-16 progression fix made every generated
workout prescribe the TOP of its rep range instead of the bottom. That fix was
right — it broke a five-session pull-up plateau immediately — but it silently
raised every load-times-reps demand in the program, and nothing was checking the
result against reality. The deadlift ended up at 3x8 @100, an implied e1RM of
126.7 against his best-ever 120: he would have had to beat his lifetime estimated
max on all three sets, on the opening lift of the day. He caught it himself, three
weeks later, and only because it felt dangerous:

    "8 reps with 100kg for deadlift is something I can't do, it's too much
     I don't want to injure"

That is the wrong way to find a programming error. This script finds them instead.

WHAT IT DOES
Compares every PROGRAM prescription against the best e1RM he has actually hit for
that exercise, applying LOGGING_RULES normalization (two-DB weight summed,
unilateral reps summed). Machine disc-load lifts are reported but never judged —
their absolute load is unknown by definition, so e1RM is meaningless for them.

READING THE OUTPUT (rewritten 2026-08-30 — see AUDIT_2026-08-30 finding 2)
  FRESH    the ask changed and he has not trained it since. Silent by design: a bump
           fires the moment he hits range-top, so it is above his best BY CONSTRUCTION.
  NO HISTORY  never executed under this key: the IMPOSSIBLE check has nothing to compare.
  watch    one session since the ask, not met. Noted, not alarmed.
  STALE    two or more sessions since the ask, never once met. THIS is the signal.
           Either the load is wrong, the equipment cannot make the increment, or he
           is not seeing it. Ask him.
  IMPOSSIBLE  implied e1RM more than 8 kg above his lifetime best — the 2026-08-14
           deadlift failure mode. A bug regardless of how fresh the ask is.
  ABANDONED   prefix: no session of this day's prescription in --abandon-after days.

"Since the ask" means sessions that STARTED AFTER the build that set it (`since_ts`), matched
per day/exerciseId, with "met" requiring the reps as well as the load — see attempts().

The old version printed ABOVE CEILING for every prescription above his best, which
meant 9 warnings a day of which 6 were bumps applied that morning. A permanently-on
alarm is ignored, and that is exactly how the premature 08-02 cable-overhead-triceps
ask survived nine days after being flagged. Freshness is now read from
athletes/<name>/workouts/PRESCRIPTION_HISTORY.json, written by build_workouts.py on every build.

Usage:  python scripts/prescription_audit.py [--margin 1.02]
Exit code 1 if anything exceeds the ceiling by more than --margin, so it can gate
a build the way validate_workout.py gates a push.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import athlete  # noqa: E402
import formulas  # noqa: E402
import strength_sessions as ss  # noqa: E402
import build_workouts as bw  # noqa: E402
from build_workouts import PROGRAM  # noqa: E402

A = athlete.current()
RULES = A.logging_rules
TWO_DB = {tuple(x) for x in RULES["two_db_weight_summed"]}
UNI = {tuple(x) for x in RULES["unilateral_reps_summed"]}


# 2026-09-07: this script scanned EVERY activity_*_sets.json, and the Hyrox is one of them.
# Its lunge station logs under the same catalog key as D3E9, so a conditioning station
# carrying 2x16-20 kg for 100 m was audited against a 3x20 @10/arm hypertrophy
# prescription. That inflated one genuine 09-01 miss from "watch" to STALE, which is a
# PUSH-BLOCKING verdict. Third instance of this project's most common failure family: a
# lookup that cannot separate two contexts sharing a key.
#
# Only strength_training activities carry prescriptions. Everything else is excluded.
# Files whose activity type cannot be resolved are excluded too, but LOUDLY - silent
# exclusion is the other half of the same bug (test_nothing_is_ever_silently_dropped).
def strength_activity_ids() -> tuple[set, set]:
    """(ids known to be strength_training, all ids present in the activity cache)."""
    strength, known = set(), set()
    for path in glob.glob(str(A.data_dir / "activities_*.json")):
        try:
            acts = json.loads(Path(path).read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(acts, dict):
            acts = acts.get("activities", [])
        for a in acts:
            aid = a.get("activityId")
            if aid is None:
                continue
            known.add(aid)
            if (a.get("activityType") or {}).get("typeKey") == "strength_training":
                strength.add(aid)
    return strength, known


def strength_set_files() -> list:
    """Paths of the per-activity set files belonging to STRENGTH sessions."""
    strength, known = strength_activity_ids()
    keep, unresolved = [], []
    for path in sorted(glob.glob(str(A.data_dir / "activity_*_sets.json"))):
        try:
            aid = json.loads(Path(path).read_text()).get("activityId")
        except (json.JSONDecodeError, OSError):
            continue
        if aid in strength:
            keep.append(path)
        elif aid not in known:
            unresolved.append(aid)
    if unresolved:
        print(f"note: {len(unresolved)} set file(s) skipped - activity type not in the "
              f"cache: {sorted(x for x in unresolved if x is not None)}", file=sys.stderr)
    return keep
MACHINE = {tuple(x) for x in RULES["machine_added_load_only"]}


# The formula lives once, in formulas.py (2026-10-08).
epley = formulas.e1rm


def executed_ceilings() -> tuple[dict, dict]:
    """Best normalized e1RM and datapoint count per (category, exerciseName).

    UNITS — the one thing to get right here (bug fixed 2026-08-14). The two sides of
    this comparison use different conventions and only the executed side needs
    normalizing:

      * PROGRAM prescriptions are stored PER ARM. CURRENT_ROUTINE writes them as
        "24 kg c/u" and the athlete reads the watch that way — on 08-02 a 24 kg Arnold
        prescription produced 24 kg dumbbells in each hand.
      * GARMIN logs two-dumbbell lifts SUMMED. That same session came back as 40.0,
        i.e. 20 kg per arm.

    The original version divided BOTH by two, so every two-DB lift was audited at half
    its real demand — Arnold checked as 12/arm against a 24/arm prescription, and came
    back a comfortable "ok". Divide the executed data only.
    """
    best: dict[tuple, float] = defaultdict(float)
    seen: dict[tuple, set] = defaultdict(set)
    for path in strength_set_files():
        for s in json.loads(Path(path).read_text()).get("exerciseSets") or []:
            if s.get("setType") != "ACTIVE":
                continue
            if not s.get("exercises"):
                continue
            # The same key attempts() matches on (2026-10-23): built here by hand, it missed
            # LOGGING_RULES.same_lift, and 10-20's 160x17 seated calf never reached the ceiling.
            key = ss.pair(s)
            weight, reps = s.get("weight"), s.get("repetitionCount")
            if not weight or not reps:
                continue
            weight /= 1000.0
            if key in TWO_DB:
                weight /= 2
            if key in UNI:
                reps /= 2
            best[key] = max(best[key], epley(weight, reps))
            seen[key].add((s.get("startTime") or "")[:10])
    return best, {k: len(v) for k, v in seen.items()}



def is_work(s: dict, ask: float = 0, secs: bool = False) -> bool:
    """Was this logged set work, or a step tapped through? A rep ask needs reps; a hold needs a
    duration of at least half the ask (`ask` 0: any duration). The 2026-11-08 audit's P1-1: two
    rep-less taps on 11-03 counted as attempts and as hams/glutes sets."""
    if secs:
        return (s.get("duration") or 0) > 0 and (s.get("duration") or 0) >= ask / 2
    return bool(s.get("repetitionCount"))


def attempts(day: str, key: tuple, weight: float, reps: float, after_ts: str,
             sessions: list, owners: dict, annotations: dict | None = None,
             secs: bool = False) -> tuple[list, list]:
    """Attempts at ONE prescription — (day, catalog pair) — made after it was set.

    Returns ([(date, top per-side load, met)], [ambiguous dates]).

    Three rules, each a 2026-10-04 audit finding (P1-1):
      (a) Matched per DAY, not per catalog pair (strength_sessions.counts_for). Pair-keyed, D5E5's
          never-trained seated calf raise read "ok" off D3's sessions.
      (b) Only sessions that STARTED AFTER the ask was set (`since_ts`, a timestamp). Date-keyed,
          the very session that triggered a bump counted as the first attempt at it: all four
          WATCH rows on 10-04 were that session, one more miss would have read STALE and blocked
          a push.
      (c) MET needs the reps as well as the load, on at least one working set: `reps` is the
          range BOTTOM the athlete must reach (range_bottom()). Load-only, any set at 80 met a
          4x10 @80 ask whatever the reps, so bench could never go STALE.
    Annotated (date, pair)s — backoffs, equipment, bad data — are not attempts at all.

    `secs=True` for a prescription whose ask is a HOLD, not reps (the core block's planks and side
    planks, program.py kinds "time" and "time_per_side", 2026-11-01). Then the set's `duration` is
    the number compared against, and the unilateral rep-halving does not apply: a per-side hold logs
    each side as its own set with its own duration, so halving it would ask for twice the hold.
    """
    out, ambiguous = [], []
    for sess in sessions:
        if sess.start <= after_ts or ss.annotated(sess.date, key, annotations):
            continue
        # A set counts if it has something to judge — reps or a hold. It used to require
        # `weight is not None`, which was safe while every audited ask was weighted, and wrong the
        # moment bodyweight asks came in (2026-11-01): Garmin records 0.0 for a loaded-exercise set
        # at no load but NOTHING for a pure bodyweight hold, so the D3 side plank's 40/40/40/21 s on
        # 10-27 was dropped and the ask read "ABANDONED — never trained" the week he did it.
        #
        # But "something" is the ask's own unit (2026-11-08 audit, P1-1). A rep ask needs reps: on
        # 11-03 he tapped through hip thrust (55 kg, no reps, 17 s) and leg curl (no reps, 9 s) to
        # reach the calves, and "reps OR duration" read both as failed attempts — the 17 s tap was
        # half of the "2 sessions, never met" that made D3E4 a push-blocking STALE. A hold needs a
        # plausible hold: at least half the ask, so a lap pressed through a plank is not a miss.
        sets = [x for x in sess.sets if ss.pair(x) == key and is_work(x, reps, secs)]
        if not sets:
            continue
        owned = ss.counts_for(sess.day, day, key, owners)
        if owned is None:
            ambiguous.append(sess.date)
            continue
        if not owned:
            continue
        top, met = 0.0, False
        for x in sets:
            w = (x.get("weight") or 0) / 1000.0
            r = (x.get("duration") or 0) if secs else (x.get("repetitionCount") or 0)
            if key in TWO_DB:
                w /= 2
            if key in UNI and not secs:
                r /= 2
            top = max(top, w)
            met = met or (w >= weight - 0.01 and r >= reps)
        out.append((sess.date, top, met))
    return out, ambiguous


def skipped_chances(day: str, key: tuple, ask: float, after_ts: str, sessions: list,
                    annotations: dict | None = None, secs: bool = False,
                    variant_names: set | None = None) -> list[str]:
    """Dates this prescription's DAY ran after the ask was set without a single set of it.

    The 2026-11-08 audit's P1-2. FRESH ("not tried yet", silent by design) cannot tell "the ask is a
    day old" from "its day ran four times and it was cut every time". D4E3's DB curl sat FRESH from
    09-29 to 11-08 while D4 ran on 10-09, 10-26 and 11-05 without it — the last slot, dropped for
    time — and biceps got 7 sets in four weeks against a band of 8-15 a week. ABANDONED did not fire
    either, because it needs the whole day to go quiet.

    Not a chance: a session annotated for the whole day or for this exercise (it was done, on
    something else), and a VARIANT of the day (`Gym · Pull (corto)` keeps four lifts by design).
    """
    out = []
    for sess in sessions:
        if sess.day != day or sess.start <= after_ts or ss.annotated(sess.date, key, annotations):
            continue
        if variant_names and (sess.name or "").strip() in variant_names:
            continue
        if not any(ss.pair(x) == key and is_work(x, ask, secs) for x in sess.sets):
            out.append(sess.date)
    return out


def range_bottom(value: int, kind: str) -> int:
    """The fewest reps that still count as doing the ask. 'reps' prescriptions name the range TOP
    and the range is top-2 (build_workouts: "Range 8-10 · all sets at 10 -> +weight"), so 80x8 on
    a 4x10 ask is progress inside the range, not a miss. Reaching the top is a BUMP signal, which
    is progression_report's job. 'fixed' prescriptions are a single target."""
    base = kind.removesuffix("_per_side")
    return value - 2 if base == "reps" else value


def since_ts(hist: dict) -> str:
    """When the ask was set. Entries written before 2026-10-04 carry only a date; the end of that
    day is the conservative reading — it never counts the session that caused the bump."""
    return hist.get("since_ts") or f"{hist.get('since', '1970-01-01')} 23:59:59"


def load_history() -> dict:
    path = A.workouts_dir / "PRESCRIPTION_HISTORY.json"
    if not path.exists():
        return {}
    h = json.loads(path.read_text())
    h.pop("_meta", None)
    return h


def audit(margin: float = 1.02, stale_after: int = 2, abandon_after: int = 21,
          today: dt.date | None = None) -> dict:
    """Every prescription judged against what was executed — the data behind main()'s table, also
    read by the app (scripts/app_data.py). Each row keeps the exact line main() prints, so the
    two can never disagree."""
    best, counts = executed_ceilings()
    history = load_history()
    sessions = ss.sessions()
    owners = ss.pair_days()
    today = today or dt.date.today()
    rows, stale, watch, impossible, abandoned, skipped, ambiguous = [], [], [], [], [], [], {}
    variant_names = {v["name"].strip() for v in (ss.program()[1] or [])}
    # build_workouts.prescriptions(): the main lifts AND the core block. Until 2026-11-01 this
    # iterated PROGRAM[day]["exercises"] and skipped `weight is None or kind == "time"`, so the whole
    # core block was invisible three times over — it lives in LEAD, half of it is bodyweight, and the
    # planks are holds. A bodyweight or timed ask is still an ask: it can go STALE and it can be
    # ABANDONED. What it cannot do is carry an e1RM, so the IMPOSSIBLE check is scored only where a
    # rep-and-load prescription exists to score (`scored` below).
    for day_key, ex, _block in bw.prescriptions():
            exid, _, cat, name, sets, value, weight, _, kind = ex
            held = kind.startswith("time")
            w_ask = weight or 0.0
            scored = bool(weight) and not held
            # "3x40s@12" for a loaded hold, "3x14@BW" for bodyweight reps — the ask as it is asked.
            unit = "s" if held else ""
            load = f"{weight:g}" if weight else "BW"
            ask = f"{value:g}{unit} @ {load}"
            key = (cat, name)
            # 2026-09-21: keyed by day/exid, not cat/name. One catalog pair can be two
            # prescriptions (BARBELL_BENCH_PRESS is D1E1 @80 and D4E2 @70); pair-keying made
            # them overwrite each other every build and reported both FRESH forever.
            hist = history.get(f"{day_key}/{exid}", {})
            since = hist.get("since", "1970-01-01")
            done, amb = attempts(day_key, key, w_ask, range_bottom(value, kind), since_ts(hist),
                                 sessions, owners, secs=held)
            if amb:
                ambiguous[f"{exid} {name}"] = amb
            met = sum(1 for *_, m in done if m)
            n_since = len(done)

            # The 2026-08-14 check, kept: a prescription he could not physically do. Only where the
            # ask is reps at a load — e1RM off a 40-second plank is not a number.
            implied = epley(weight, value) if scored else 0.0
            ceiling = best.get(key, 0.0)
            over_ceiling = scored and ceiling and implied > ceiling * margin and key not in MACHINE

            # When was this prescription — this day's, not the pair's — last trained at all?
            ever, _ = attempts(day_key, key, 0, 0, "", sessions, owners, annotations={}, secs=held)
            last = ever[-1][0] if ever else None
            # Idle since the later of the last session and the ask itself: a lift swapped in five
            # days ago on a day trained five days ago is new, not dead.
            idle = (today - dt.date.fromisoformat(max(last or "", since))).days

            missed: list = []
            if n_since == 0:
                # 2026-10-04 (P2-3): with no executed history the ceiling is 0 and the IMPOSSIBLE
                # check cannot run. Say so, instead of FRESH, which reads as "checked and fine".
                # Only where there is something to score, though (2026-11-01): a bodyweight ask or a
                # hold has no e1RM by nature, not for want of history, and "NO HISTORY — first
                # exposure" on an ab wheel he has done five times is just wrong.
                status = "no_history" if scored and not ceiling and key not in MACHINE else "fresh"
                verdict = ("NO HISTORY — first exposure, unchecked" if status == "no_history"
                           else "FRESH — not tried yet")
                # 2026-11-08 (P1-2): not tried, but its day RAN without it — that is a skip, not new.
                missed = skipped_chances(day_key, key, range_bottom(value, kind) if held else 0,
                                         since_ts(hist), sessions, secs=held, variant_names=variant_names)
                if len(missed) >= stale_after:
                    status = "skipped"
                    verdict = f"SKIPPED — its day ran {len(missed)}× since the ask, never attempted"
                    skipped.append((day_key, exid, name, ask, since, missed))
            elif met:
                status, verdict = "ok", "ok"
            elif n_since >= stale_after:
                status, verdict = "stale", f"*** STALE — {n_since} sessions, never met ***"
                stale.append((exid, name, ask, range_bottom(value, kind), unit, since, n_since,
                              max((w for _, w, _ in done), default=0.0)))
            else:
                status, verdict = "watch", "watch — 1 session, not met"
                watch.append((exid, name, ask, done[-1][1]))

            # 2026-10-04 (P1-5): D5 sat FRESH for 51 days — silent by design, so nobody noticed the
            # day had never run. An ask nobody has trained in ABANDON_DAYS is not fresh, it is dead.
            is_abandoned = idle > abandon_after
            if is_abandoned:
                verdict = f"ABANDONED — {'never trained' if last is None else f'last {last}'} · " + verdict
                abandoned.append((day_key, exid, name, last))

            # Separately: a heavy compound asking well above his lifetime best is the
            # 2026-08-14 deadlift failure mode and is a bug regardless of freshness.
            is_impossible = bool(over_ceiling and (implied - ceiling) > 8 and key not in MACHINE)
            if is_impossible:
                impossible.append((exid, name, implied, ceiling))

            rows.append({
                "day": day_key, "exid": exid, "category": cat, "name": name, "sets": sets,
                "value": value, "weight": weight, "kind": kind, "since": since,
                "sessions": n_since, "met": met, "status": status, "abandoned": is_abandoned,
                "impossible": is_impossible, "last": last,
                "skipped": len(missed) if status == "skipped" else 0,
                "implied_e1rm": round(implied, 1) if scored else None,
                "best_e1rm": round(ceiling, 1) if (scored and ceiling) else None, "verdict": verdict,
                "line": (f"{exid + ' ' + name:<44s} {f'{sets}x{ask}'.replace(' ', ''):<16s} {since:>11s} "
                         f"{n_since:>5d} {met:>4d}  {verdict}"),
            })
    return {"rows": rows, "stale": stale, "watch": watch, "impossible": impossible,
            "abandoned": abandoned, "skipped": skipped, "ambiguous": ambiguous}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--margin", type=float, default=1.02,
                    help="allowed overshoot vs best executed e1RM (default 1.02 = 2%%)")
    ap.add_argument("--stale-after", type=int, default=2,
                    help="sessions an unmet ask may survive before it is STALE (default 2)")
    ap.add_argument("--abandon-after", type=int, default=21,
                    help="days without a session before a prescription is ABANDONED (default 21)")
    args = ap.parse_args()

    ss.print_cache_status()
    r = audit(args.margin, args.stale_after, args.abandon_after)
    stale, watch, impossible, abandoned, ambiguous = (r["stale"], r["watch"], r["impossible"],
                                                      r["abandoned"], r["ambiguous"])

    print(f"{'exercise':<44s} {'prescribed':>15s} {'since':>11s} {'sess':>5s} {'met':>4s}  verdict")
    print("-" * 102)
    for row in r["rows"]:
        print(row["line"])

    if impossible:
        print("\n=== IMPOSSIBLE — implied e1RM far above the athlete's lifetime best ===")
        print("This is the 2026-08-14 deadlift failure mode. Treat as a bug, not a stretch goal.")
        for exid, name, implied, ceiling in sorted(impossible, key=lambda x: x[2] - x[3], reverse=True):
            print(f"  {exid} {name}: implies {implied:.1f} vs best {ceiling:.1f} (+{implied - ceiling:.1f})")

    if stale:
        print(f"\n=== STALE — asked for {args.stale_after}+ sessions and never once met ===")
        print("Either the load is wrong, the equipment cannot make that increment, or they are")
        print("not seeing it. Ask them. Do NOT let these sit — the 08-02 overhead-triceps ask")
        print("survived nine days after being flagged because it was buried in fresh bumps.")
        for exid, name, ask, floor, unit, since, n, bestdone in sorted(stale, key=lambda x: x[6], reverse=True):
            print(f"  {exid} {name}: asked {ask} since {since}, {n} sessions, "
                  f"none reached {floor:g}{unit} at the load (top load done {bestdone:g})")

    if watch:
        print("\n=== WATCH — one session, not met (fine for now) ===")
        for exid, name, ask, dn in watch:
            print(f"  {exid} {name}: asked {ask}, top load done {dn:g}")

    if r["skipped"]:
        print(f"\n=== SKIPPED — its day ran {args.stale_after}+ times since the ask, never attempted (not push-blocking) ===")
        print("Usually the last slot of a session, cut for time. Move it earlier, or shorten what comes first.")
        for day_key, exid, name, ask, since, missed in r["skipped"]:
            print(f"  {day_key}/{exid} {name}: asked {ask} since {since}; day ran {', '.join(missed)} without it")

    if abandoned:
        print(f"\n=== ABANDONED — no session in {args.abandon_after}+ days (not push-blocking) ===")
        print("A prescription nobody trains is not fresh. Retire the day, or put it back in the week.")
        for day_key, exid, name, last in abandoned:
            print(f"  {day_key}/{exid} {name}: {'never trained' if last is None else f'last {last}'}")

    if ambiguous:
        print("\n=== AMBIGUOUS — a shared pair logged on a day that prescribes neither copy ===")
        print("Not credited to either prescription. Annotate the session if it matters.")
        for k, dates in ambiguous.items():
            print(f"  {k}: {', '.join(sorted(set(dates)))}")

    if not (stale or impossible):
        print("\nNo stale or impossible prescriptions.")

    sys.exit(1 if (stale or impossible) else 0)


if __name__ == "__main__":
    main()
