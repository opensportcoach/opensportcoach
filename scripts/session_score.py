#!/usr/bin/env python3
"""The execution score: one session against what was agreed for it, 0–100 (docs/DESIGN.md (fuelling and score) §5).

It measures EXECUTION, not fitness — heat, decoupling and efficiency stay flags, never points. Every
weight, band and threshold lives in formulas.py (SCORE_WEIGHTS … SCORE_DEFINITIONS) and is a draft
until the Phase 2 calibration pass. This script is the only place a score is computed: the reviews,
the daily and the app cite it and never re-derive it (S3: the engine's band replaces the model's
rating).

WHAT A SESSION IS SCORED AGAINST
  * Strength: its program day AS IT WAS when the session started — `program.py` read from git at the
    last commit before the start, because the program changes week to week (v8.10 replaced the Arnold
    press the day after 11-05's session, and scoring 11-05 against today's program would call a lift
    he was never asked to do a miss). The day is `strength_sessions.attribute()` — name, then
    signature — never the name alone. A variant (`Gym · Pull (corto)`) is scored as the variant.
  * Rides and runs: the plan.json session that day, of that sport group. Its `intent` (and `work`,
    for intervals) is what the parts read; free text is never parsed.
    With no plan.json session, the managed watch workout the activity was started from
    (`workoutId`), scored on that workout's own heart-rate target — only while the file on disk is
    still what was sent (watch_session).

NOT SCORED, WITH THE REASON (S1)
  * nothing planned: no program day, no plan.json session, no watch workout with a target;
  * a whole-session annotation in SESSION_ANNOTATIONS.json;
  * swims, HYROX and circuits (Phase 7).
  An annotation scoped to exercises takes those out: `machine_change` drops their LOAD only ("not
  comparable": the same discs on another machine are another resistance), any other type drops the
  exercise. Sets the watch could not name are never counted as a miss: up to that many missing sets
  leave the denominator and lower the coverage instead.

Usage:
  session_score.py <activity_id> [--json]
  session_score.py --since 2026-11-01 [--until 2026-11-30] [--json]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

A = athlete.current()
import export_dashboard_data as ed  # noqa: E402
import formulas as f  # noqa: E402
import sports  # noqa: E402
import strength_sessions as ss  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
REPS_KINDS = ("reps", "fixed", "power")
# Added weight on a bodyweight lift (a pull-up belt, a dip belt, a vest): the resistance is the body plus
# the plate, so 0 added against a 5 kg ask is ~95 % of the load, not 0 %. He logs 0 when the shared belt
# is taken (program.py STEP_NOTES D1E6), and the added-only ratio called every such set a total miss.
BODYWEIGHT_MARKERS = ("PULL_UP", "CHIN_UP", "DIP", "PUSH_UP")


def bodyweight_lift(key: tuple) -> bool:
    name = key[1] or ""
    return name.startswith("WEIGHTED_") and any(m in name for m in BODYWEIGHT_MARKERS)
# An annotation's type, as the page words a row it took out of the score (never the code).
ANNOTATION_WORDS = {"data_error": "logged differently from what was done", "machine_change": "a different machine",
                    "backoff": "lighter on purpose", "autoregulated": "adjusted on the day", "abandoned": "session cut short",
                    "injury": "injury", "ask_not_seen": "the new ask wasn't on the watch yet"}
# What the athlete reads on the page: no file names (UX review 2026-11-10). The plan is docs/DESIGN.md (fuelling and score), Phase 7.
NOT_SCORED_GROUPS = {"swim": "Swims are not scored yet.",
                     "circuit": "HYROX and circuits are not scored yet."}


# --------------------------------------------------------------------------- the shape
def assemble(kind: str, scores: dict, coverage: float, against: str, notes: dict | None = None,
             dropped: dict | None = None, detail: dict | None = None, flags: list | None = None,
             cap: tuple[int, str] | None = None) -> dict:
    """scores: part -> 0..1 (scored) · dropped: part -> reason. Parts that do not apply are absent from
    both. Each part earns fraction × weight; the score is what was earned ÷ the weight that could be
    scored (`out_of`), as recovery_composite rescales. Every word the card shows is written here: the
    page adds up nothing and phrases nothing (FUEL-SCORE-DATA.md)."""
    weights = f.SCORE_WEIGHTS[kind]
    dropped, detail = dropped or {}, detail or {}
    out_of = sum(w for k, w in weights.items() if k in scores)
    earned = sum(scores[k] * w for k, w in weights.items() if k in scores)
    parts = []
    for k, w in weights.items():
        if k not in scores and k not in dropped:
            continue
        d = dict(detail.get(k) or {})
        words = {x: d.pop(x, None) for x in ("planned_text", "done_text", "miss", "short")}
        p = {"key": k, "label": f.SCORE_LABELS[k], "weight": w, "measure": f.SCORE_MEASURE[k],
             "planned_text": words["planned_text"], "done_text": words["done_text"], "detail": d}
        if k in scores:
            p |= {"score": round(scores[k], 3), "points": round(scores[k] * w, 1), "dropped": None}
        else:
            p |= {"score": None, "points": None, "dropped": dropped[k]}
        p["_miss"], p["_short"] = words["miss"], words["short"]
        parts.append(p)
    total = round(100 * earned / out_of) if out_of else None
    capped = None
    if cap and total is not None and total > cap[0]:
        total, capped = cap[0], {"from": total, "to": cap[0], "why": cap[1]}
    coverage = round(coverage, 3)
    shown = total if coverage >= f.SCORE_MIN_COVERAGE else None
    band, band_label = f.score_band(total, coverage)
    # What cost the most: the parts by points lost, the first named in the summary and on the badge.
    lost = sorted((p for p in parts if p["score"] is not None and p["score"] < 0.995),
                  key=lambda p: (1 - p["score"]) * p["weight"], reverse=True)
    if shown is None:
        summary = f"Only {round(coverage * 100)} % of the session could be scored, so no number: it would claim more than it knows."
        headline = f"{round(coverage * 100)} % scorable"
    else:
        bits = []
        if capped:
            bits.append(f"{capped['why'][0].upper()}{capped['why'][1:]}, so the session stops at {capped['to']}.")
        big = [p for p in lost if (1 - p["score"]) * p["weight"] >= 1 and p["_miss"]]
        if big:
            first = big[0]["_miss"]
            more = f"; {big[1]['_miss']}" if len(big) > 1 and (1 - big[1]["score"]) * big[1]["weight"] >= 2 else ""
            bits.append(f"{first[0].upper()}{first[1:]}{more}.")
            if all(p["score"] >= 0.95 for p in parts if p["score"] is not None and p not in big[:2]):
                bits.append("Everything else was on target.")
        if not bits:
            bits.append("Done as agreed.")
        if any(r == "not logged" for r in dropped.values()):
            bits.append("Fuel isn't logged yet, so it sits out for now: log it and the score updates.")
        summary = " ".join(bits)
        headline = ("exercise not started" if capped else None if total >= 85
                    else (lost[0]["_short"] if lost and lost[0]["_short"] else None))
    drops = [p["label"] for p in parts if p["dropped"]]
    foot = (f"Score = {earned:.1f} ÷ {out_of} points that could be scored."
            + (f" {', '.join(drops)} dropped out, each with its reason." if drops else "")
            + (f" Capped at {capped['to']} from {capped['from']}: a planned exercise not started stops a session under As planned."
               if capped else "")) if out_of else ""
    for p in parts:
        p.pop("_miss"), p.pop("_short")
    return {"total": shown, "band": band, "band_label": band_label, "parts": parts, "coverage": coverage,
            "out_of": out_of, "earned": round(earned, 1), "excluded": None, "against": against,
            "summary": summary, "headline": headline, "foot": foot, "capped": capped,
            "provisional": any(r == "not logged" for r in dropped.values()),
            "flags": flags or [], **(notes or {})}


def excluded(reason: str, against: str | None = None) -> dict:
    return {"total": None, "band": None, "band_label": "Not scored", "parts": [], "coverage": 0.0,
            "excluded": reason, "against": against, "summary": reason, "headline": None, "foot": "",
            "capped": None, "provisional": False, "flags": []}


def _hm(minutes: float) -> str:
    m = round(minutes)
    return f"{m // 60}:{m % 60:02d}"


def _pct(x: float) -> str:
    return f"{round(x * 100)} %"


def _strength_words(detail: dict, scores: dict) -> None:
    """planned → done, what was missed and its one-word cost, per part (strength)."""
    if "sets" in detail:
        d = detail["sets"]
        miss = d["planned"] - d["done"]
        d |= {"planned_text": f"{d['planned']} sets", "done_text": f"{d['done']}" + (f" · {d['unknown']} unnamed" if d["unknown"] else ""),
              "miss": f"{miss} of {d['planned']} planned sets not done" if miss else None, "short": "sets missed"}
    if "reps" in detail:
        d = detail["reps"]
        pl = " · ".join(x for x in (f"{d['rep_target']} reps" if d["rep_target"] else "",
                                    f"{d['sec_target']} s held" if d["sec_target"] else "") if x)
        dn = " · ".join(x for x in (f"{d['rep_done']} reps" if d["rep_target"] else "",
                                    f"{d['sec_done']} s" if d["sec_target"] else "") if x)
        short_by = (d["rep_target"] - d["rep_done"]) if d["rep_target"] else 0
        d |= {"planned_text": pl or "the target on each set", "done_text": dn or _pct(scores["reps"]),
              "miss": (f"{short_by} reps short across the sets done" if short_by else f"sets at {_pct(scores['reps'])} of target"),
              "short": "reps short"}
    if "load" in detail:
        d = detail["load"]
        d |= {"planned_text": "as prescribed", "done_text": f"{_pct(scores['load'])} of the ask"
              + (f" · {d['flagged']} flagged" if d["flagged"] else ""),
              "miss": f"load at {_pct(scores['load'])} of the ask", "short": "load under"}
    if "rest" in detail:
        d = detail["rest"]
        d |= {"planned_text": f"{d['rests']} rests in their window", "done_text": f"{d['in_band']}",
              "miss": f"{d['rests'] - d['in_band']} of {d['rests']} rests outside their window", "short": "rests off"}


def _endurance_words(detail: dict, scores: dict, plan: dict, grp: str) -> None:
    """planned → done, what was missed and its one-word cost, per part (rides and runs)."""
    intent = plan.get("intent") or ""
    if "intent" in detail:
        d = detail["intent"]
        if d["basis"] == "if":
            lo, hi = d["band"]
            d |= {"planned_text": f"IF {lo:.2f}–{hi:.2f} ({intent})", "done_text": f"IF {d['done']:.2f}",
                  "miss": f"IF {d['done']:.2f} against {lo:.2f}–{hi:.2f}", "short": "IF off band"}
        else:
            band = d.get("band") or [None, None]
            unit = "W" if d["basis"] == "power" else "bpm"
            zone = "the watch's HR target" if d.get("target") == "watch" else {"recovery": "Z1", "endurance": "Z2", "tempo": "Z3"}.get(intent, intent)
            where = (f"{band[0]}–{band[1]} {unit}" if band[1] else f"{band[0]}+ {unit}") if band[0] is not None else zone
            under, over = d["under"], d["over"]
            how = ("easier than planned" if under >= over else "harder than planned")
            d |= {"planned_text": f"{zone} · {where}", "done_text": f"{_pct(d['in'])} in band"
                  + (f" · {_pct(under)} under" if under >= 0.05 else "") + (f" · {_pct(over)} over" if over >= 0.05 else ""),
                  "miss": f"{_pct(d['in'])} of the {'ride' if grp == 'bike' else 'run'} in {zone}, {how}",
                  "short": "too easy" if under >= over else "too hard"}
    if "intervals" in detail:
        d = detail["intervals"]
        work = plan.get("work") or []
        pl = " + ".join(f"{w['reps']} × {w['secs'] // 60 if w['secs'] % 60 == 0 else w['secs']}{'′' if w['secs'] % 60 == 0 else ' s'}"
                        f" at {w['target'][0]}–{w['target'][1]} W" for w in work)
        d |= {"planned_text": pl, "done_text": f"{d['done_s'] // 60}:{d['done_s'] % 60:02d} of work at {d['threshold_w']} W+",
              "miss": f"{round(d['done_s'] / 60)} of {round(d['planned_s'] / 60)} minutes of work at target",
              "short": "intervals short"}
    if "duration" in detail:
        d = detail["duration"]
        longer = d["done_min"] > d["planned_min"]
        d |= {"planned_text": _hm(d["planned_min"]), "done_text": _hm(d["done_min"]),
              "miss": f"{_hm(d['done_min'])} against {_hm(d['planned_min'])} planned",
              "short": "too long" if longer else "cut short"}
    if "pacing" in detail:
        d = detail["pacing"]
        if d["basis"] == "vi":
            d |= {"planned_text": f"steady · VI {f.VI_FULL:.2f} or under", "done_text": f"VI {d['done']:.2f}",
                  "miss": f"surges: VI {d['done']:.2f}", "short": "uneven"}
        else:
            x = d["second_vs_first"]
            d |= {"planned_text": f"even halves · within {round(f.RUN_SPLIT_FULL * 100)} %",
                  "done_text": f"second half {abs(round(x * 100, 1))} % {'slower' if x > 0 else 'faster'}",
                  "miss": f"second half {abs(round(x * 100, 1))} % {'slower' if x > 0 else 'faster'}", "short": "uneven"}
    if "fuel" in detail:
        d = detail["fuel"]
        if d.get("taken_g") is not None:
            d |= {"planned_text": f"{d['planned_g']} g", "done_text": f"{d['taken_g']} g · you",
                  "miss": f"fuel {d['taken_g']} g of {d['planned_g']} g", "short": "fuel short"}
        else:
            d |= {"planned_text": f"{d['planned_g']} g", "done_text": "not logged"}


def strength_chips(rows: list, flags: list) -> list:
    """The set rows that moved the score, for the card (board Score-Card, gym): what each lost, in words."""
    out = []
    flagged = {fl.get("exid"): fl["text"] for fl in flags}
    for r in rows:
        code, name = r["exid"], r["label"]
        if r.get("dropped"):
            out.append({"code": code, "name": name, "what": f"Planned {r['planned']} · {r['dropped']}", "chip": "Excluded", "kind": "info"})
            continue
        done, planned = r["sets"]
        if done == 0:
            why = " · a lap pressed through, no reps" if r.get("blank_sets") else ""
            out.append({"code": code, "name": name, "what": f"0 of {planned} sets{why}", "chip": "Not started", "kind": "miss"})
            continue
        if done < planned:
            out.append({"code": code, "name": name, "what": f"{done} of {planned} sets · {r['done']}", "chip": f"−{planned - done} {'set' if planned - done == 1 else 'sets'}", "kind": "warn"})
        short = [f"{what} {_pct(r[what])}" for what in ("reps", "load") if r.get(what) is not None and r[what] < 0.995]
        if short:   # one row per exercise: what it lost, together
            out.append({"code": code, "name": name, "what": f"{r['done']} against {r['planned']}", "chip": " · ".join(short), "kind": "warn"})
        if r.get("load_dropped"):
            out.append({"code": code, "name": name, "what": f"{r['done']} · {r['load_dropped']}", "chip": "Not comparable", "kind": "info"})
        if code in flagged:
            out.append({"code": code, "name": name, "what": flagged[code].removeprefix(f"{name}: "), "chip": "Flagged", "kind": "flag"})
    return out


# --------------------------------------------------------------------------- strength
_PROGRAMS: dict[str, tuple[dict, str]] = {}


def program_at(start: str) -> tuple[dict, str]:
    """program.py as committed before `start` ("YYYY-MM-DD HH:MM:SS", local): (namespace, ref).
    Falls back to the working copy when git has nothing older, or the athlete lives outside any
    repository (the app's fixtures build a synthetic one in a temp folder). The history is read from
    whichever git repository holds the athlete's folder — theirs, when athletes/ is its own private
    repository — following moves (athlete.committed_before). One read per commit per process."""
    path = A.root / "program.py"
    src, sha = athlete.committed_before(path, start)
    sha = sha or ""
    if sha in _PROGRAMS:
        return _PROGRAMS[sha]
    if src is not None:
        ref = f"program.py @ {sha}"
    else:
        src, ref = path.read_text(), "program.py (working copy)"
    ns: dict = {}
    exec(compile(src, ref, "exec"), ns)   # program.py is plain data: no imports beyond __future__
    _PROGRAMS[sha] = (ns, ref)
    return ns, ref


def day_rows(ns: dict, name: str, keys: set) -> tuple[str | None, str | None, list]:
    """(day key, workout name, rows) the session was, from that program version. Rows are the core
    block first, then the main lifts (build_workouts.prescriptions' order); a variant keeps/drops."""
    prog, lead, variants = ns["PROGRAM"], ns.get("LEAD", {}), ns.get("VARIANTS", [])
    variant = next((v for v in variants if v["name"].strip() == (name or "").strip()), None)
    day = variant["base"] if variant else ss.attribute(name, keys, prog, variants)
    if day is None:
        return None, None, []
    main = list(prog[day]["exercises"])
    if variant:
        drop = set(variant.get("drop") or ()) | set((variant.get("swap") or {}).keys())
        main = [e for e in main if e[0] not in drop][: variant.get("keep") or None]
    core = list(((lead.get(day) or {}).get("block")) or ())
    return day, (variant or prog[day])["name"], core + main


def _kind(kind: str) -> tuple[str, bool]:
    return (kind[: -len("_per_side")], True) if kind.endswith("_per_side") else (kind, False)


def _fmt(n: float | None) -> str:
    return "—" if n is None else (str(int(n)) if float(n).is_integer() else f"{n:g}")


def strength_parts(raw: list, rows: list, annotation: dict | None, *, two_db=None, unilateral=None,
                   unnamed_keys: set | None = None, body_kg: float | None = None, warmups_stripped: bool = False) -> dict:
    """The pure core: raw exerciseSets (ACTIVE and REST, in order) against one day's rows.
    Returns scores, dropped, detail, coverage, per-exercise rows and flags. `warmups_stripped`: the caller
    passes working sets only (the app's fixtures, rebuilt from a workout view that already split them)."""
    two_db = ed.TWO_DB if two_db is None else two_db
    unilateral = ed.UNILATERAL if unilateral is None else unilateral

    # Each ACTIVE set with the rest that followed it.
    active = []
    for i, s in enumerate(raw):
        if s.get("setType") != "ACTIVE":
            continue
        rest = 0.0
        for nxt in raw[i + 1:]:
            if nxt.get("setType") == "ACTIVE":
                break
            rest += nxt.get("duration") or 0
        active.append({"raw": s, "key": ss.pair(s), "rest_after": rest, "i": len(active)})
    working_ids = ({id(a["raw"]) for a in active} if warmups_stripped
                   else {id(s) for s in ed.strip_warmups([a["raw"] for a in active])})
    working = [a for a in active if id(a["raw"]) in working_ids]

    row_keys = {(r[2], r[3]) for r in rows}
    unnamed = [a for a in working if a["key"] == (None, None)
               or (unnamed_keys is not None and a["key"] in unnamed_keys)
               or (a["key"] not in row_keys and ed.muscle_of(*a["key"]) == ed.UNATTRIBUTED)]

    ann_scope = {tuple(x) for x in (annotation or {}).get("exercises") or []}
    ann_type = (annotation or {}).get("type")

    by_key: dict[tuple, list] = {}
    for a in working:
        by_key.setdefault(a["key"], []).append(a)
    seen_rows: dict[tuple, int] = {}

    out_rows, rep_scores, load_scores, rest_hits, flags = [], [], [], [], []
    over: dict[str, tuple] = {}   # exid -> (worst ratio, load, label, ask): one flag per exercise
    tot = {"rep": [0, 0.0], "sec": [0, 0.0]}   # [target, done capped at target], for the card's words
    planned_all = planned_judged = done_judged = 0
    for exid, label, cat, name, n_sets, value, weight, rest_s, kind in rows:
        key = (cat, name)
        base, per_side = _kind(kind)
        planned_all += n_sets
        row = {"exid": exid, "label": label, "key": list(key),
               "planned": f"{n_sets} × {value}{' s' if base == 'time' else ''}{'/side' if per_side else ''}"
                          + (f" @ {_fmt(weight)}" if weight else "")}
        if key in ann_scope and ann_type != "machine_change":
            out_rows.append(row | {"dropped": f"coach's note: {ANNOTATION_WORDS.get(ann_type, 'set aside')}", "sets": None})
            continue
        load_dropped = "a different machine: not comparable" if key in ann_scope else None

        # A pair prescribed twice in one day splits its sets in order; otherwise every set is a candidate.
        twice = sum(1 for r in rows if (r[2], r[3]) == key) > 1
        pool = by_key.get(key, [])
        if twice:
            start = seen_rows.get(key, 0)
            take = n_sets * (2 if per_side else 1)
            pool, seen_rows[key] = pool[start:start + take], start + take

        def norm(a):
            s = a["raw"]
            w = (s.get("weight") or 0) / 1000
            r = s.get("repetitionCount")
            w_n = w / 2 if key in two_db else w
            r_n = (r / 2 if (r is not None and key in unilateral and not per_side) else r)
            return w_n, r_n, s.get("duration") or 0

        if base in REPS_KINDS:   # a reps set with no reps logged cannot be told from a lap pressed through
            blank = [a for a in pool if not a["raw"].get("repetitionCount")]
            pool = [a for a in pool if a["raw"].get("repetitionCount")]
        else:
            blank = []
        units = [pool[i:i + 2] for i in range(0, len(pool) - 1, 2)] if per_side else [[a] for a in pool]
        if not per_side and len(units) > n_sets:   # extras add nothing: keep the heaviest, in order
            best = sorted(units, key=lambda u: (norm(u[0])[0], norm(u[0])[1] or 0), reverse=True)[:n_sets]
            units = sorted(best, key=lambda u: u[0]["i"])
        units = units[:n_sets]
        planned_judged += n_sets
        done_judged += len(units)

        r_sc, l_sc = [], []
        for u in units:
            for a in u:
                w_n, r_n, dur = norm(a)
                done_v = dur if base == "time" else (r_n or 0)
                r_sc.append(min(1.0, done_v / value) if value else 1.0)
                if value:
                    tot["sec" if base == "time" else "rep"][0] += value
                    tot["sec" if base == "time" else "rep"][1] += min(done_v, value)
            if weight and not load_dropped:
                w_n = max(norm(a)[0] for a in u)
                bw = body_kg if (body_kg and bodyweight_lift(key)) else 0
                ratio = (bw + w_n) / (bw + weight)
                l_sc.append(min(1.0, ratio))
                over.setdefault(exid, (0.0, 0.0, label, weight))
                if ratio > over[exid][0]:
                    over[exid] = (ratio, w_n, label, weight)
        rest_units = sorted(units, key=lambda u: u[-1]["i"])[:-1]
        hits = [f.REST_BAND[0] <= u[-1]["rest_after"] / rest_s <= f.REST_BAND[1] for u in rest_units if rest_s]
        rep_scores += r_sc
        load_scores += l_sc
        rest_hits += hits

        done_desc = []
        for u in units:
            w_n, r_n, dur = norm(u[0])
            v = round(dur) if base == "time" else _fmt(r_n)
            done_desc.append(f"{v}{' s' if base == 'time' else ''}" + (f" @ {_fmt(round(w_n, 2))}" if (w_n or weight) else ""))
        row |= {"sets": [len(units), n_sets], "done": " · ".join(done_desc) or "not done",
                "reps": round(sum(r_sc) / len(r_sc), 3) if r_sc else None,
                "load": round(sum(l_sc) / len(l_sc), 3) if l_sc else None,
                "load_dropped": load_dropped, "dropped": None}
        if blank:
            row["blank_sets"] = len(blank)
        out_rows.append(row)

    for exid, (ratio, w_n, label, ask) in over.items():
        if ratio >= f.LOAD_SUSPECT:
            flags.append({"exid": exid, "text": f"{label}: {_fmt(round(w_n, 2))} against {_fmt(ask)}, near double. "
                                                "Suspect the implement or the logging class."})
        elif ratio > f.LOAD_OVER_FLAG:
            flags.append({"exid": exid, "text": f"{label}: {_fmt(round(w_n, 2))} against {_fmt(ask)}, "
                                                f"+{round((ratio - 1) * 100)} %. Flagged, not rewarded."})
    missing = planned_judged - done_judged
    unknown = min(len(unnamed), missing)
    # Skipped: a planned exercise with no set done — unless the unnamed sets could be it.
    skipped = [r["label"] for r in out_rows if r.get("sets") and r["sets"][0] == 0]
    skipped_sets = sum(r["sets"][1] for r in out_rows if r.get("sets") and r["sets"][0] == 0)
    if skipped_sets <= unknown:
        skipped = []
    denom = planned_judged - unknown
    scores, dropped, detail = {}, {}, {}
    if denom > 0:
        scores["sets"] = done_judged / denom
        detail["sets"] = {"planned": denom, "done": done_judged, "skipped": skipped, "unknown": unknown}
    else:
        dropped["sets"] = "no planned set could be judged"
    if rep_scores:
        scores["reps"] = sum(rep_scores) / len(rep_scores)
        detail["reps"] = {"sets": len(rep_scores), "rep_target": tot["rep"][0], "rep_done": round(tot["rep"][1]),
                          "sec_target": tot["sec"][0], "sec_done": round(tot["sec"][1])}
    else:
        dropped["reps"] = "no set done to judge"
    if load_scores:
        scores["load"] = sum(load_scores) / len(load_scores)
        detail["load"] = {"sets": len(load_scores), "flagged": len(flags)}
    else:
        dropped["load"] = "no loaded set comparable to its ask"
    if rest_hits:
        scores["rest"] = sum(rest_hits) / len(rest_hits)
        detail["rest"] = {"in_band": sum(rest_hits), "rests": len(rest_hits)}
    else:
        dropped["rest"] = "no rest between two sets of one exercise"
    coverage = (planned_judged - unknown) / planned_all if planned_all else 0.0
    _strength_words(detail, scores)
    return {"scores": scores, "dropped": dropped, "detail": detail, "coverage": coverage, "rows": out_rows,
            "flags": flags, "unnamed_sets": len(unnamed), "unknown_sets": unknown, "skipped": skipped,
            "chips": strength_chips(out_rows, flags)}


def score_strength(a: dict) -> dict:
    aid, start = a["activityId"], a.get("startTimeLocal") or ""
    date, name = start[:10], a.get("activityName") or ""
    raw = (ed.load(f"activity_{aid}_sets.json") or {}).get("exerciseSets")
    if raw is None:
        return excluded("No set file in the cache: refresh first.")
    ann = ss.ANNOTATIONS.get(date)
    if ann and not ann.get("exercises"):
        return excluded(f"Annotated day ({ann.get('type')}): {ann.get('note', '')[:160]}")
    ns, ref = program_at(start)
    keys = {ss.pair(s) for s in raw if s.get("setType") == "ACTIVE"} - {(None, None)}
    day, wname, rows = day_rows(ns, name, keys)
    if not day:
        return excluded("Nothing was planned: the session matches no program day.")
    r = strength_parts(raw, rows, ann, body_kg=(A.profile or {}).get("weight_kg"))
    against = f"{wname} · {ref}"
    notes = {"day": day, "rows": r["rows"], "chips": r["chips"], "unnamed_sets": r["unnamed_sets"]}
    if r["unknown_sets"]:
        notes["coverage_note"] = (f"{r['unknown_sets']} missing set(s) not counted as missed: the watch logged "
                                  f"{r['unnamed_sets']} set(s) it could not name.")
    cap = ((f.SKIPPED_CAP, f"not started: {', '.join(r['skipped'])}") if r["skipped"] else None)
    return assemble("strength", r["scores"], r["coverage"], against, notes, r["dropped"], r["detail"], r["flags"], cap)


# --------------------------------------------------------------------------- rides and runs
def planned_session(date: str, grp: str) -> dict | None:
    if not A.plan_path.exists():
        return None
    sessions = json.loads(A.plan_path.read_text()).get("sessions") or []
    return next((s for s in sessions if s.get("date") == date and sports.group(s.get("sport")) == grp), None)


def watch_target(w: dict, threshold_hr: float | None = None) -> dict | None:
    """A generated watch workout as a plan to score against, or None when it sets no heart-rate target.

    The target is the workout's own: the longest timed step with an HR range, in bpm — never the zone
    an intent would imply (his easy cap is 150, Z2 ends at 137: scored on Z2, a run done exactly as
    asked reads "too hard"). `hr_window` is that step's seconds from the start, known only while every
    step before it is timed; after a lap-button step the whole run is read instead."""
    best, at, timed = None, 0.0, True
    for seg in w.get("workoutSegments") or []:
        for s in seg.get("workoutSteps") or []:
            secs = s.get("endConditionValue") if (s.get("endCondition") or {}).get("conditionTypeKey") == "time" else None
            t = s.get("targetType") or {}
            if (s.get("type") != "RepeatGroupDTO" and secs and t.get("workoutTargetTypeKey") == "heart.rate.zone"
                    and s.get("targetValueOne") and s.get("targetValueTwo") and (best is None or secs > best[0])):
                best = (secs, [s["targetValueOne"], s["targetValueTwo"]], [at, at + secs] if timed else None)
            if s.get("type") == "RepeatGroupDTO" or not secs:
                timed = False
            else:
                at += secs
    if best is None:
        return None
    est = w.get("estimatedDurationInSecs")
    return {"title": w.get("workoutName"), "sport": (w.get("sportType") or {}).get("sportTypeKey"),
            "intent": f.hr_target_intent(best[1][1], threshold_hr), "hr_band": best[1], "hr_window": best[2],
            **({"duration_min": round(est / 60)} if est else {})}


def watch_session(a: dict, threshold_hr: float | None = None) -> tuple[dict | None, str | None]:
    """(plan, None) for a ride or run done from one of the athlete's managed watch workouts, else
    (None, why). plan.json holds only what never reaches the watch, so without this every watch run
    read "nothing was planned" (2026-11-10 audit: three of three in the block).

    The workout on disk is used only when it IS what he ran: the activity's workoutId is the live id
    and the file's content hash is the one recorded at its last sync. An upload always makes a new id,
    so an older id is an older prescription (a 30-minute run, a 140 cap) whose targets are gone —
    scoring it on today's file would be a number from another context, and it says so instead."""
    import sync_workouts as sw
    wid = a.get("workoutId")
    if not wid:
        return None, "Nothing was planned: no plan.json session that day for this sport, and it was not started from a watch workout."
    ids_path = A.workouts_dir / "WORKOUT_IDS.json"
    rec = json.loads(ids_path.read_text()) if ids_path.exists() else {}
    name = next((n for n, i in (rec.get("workouts") or {}).items() if i == wid), None)
    if name is None:
        return None, (f"Done from a watch workout that has since been replaced (id {wid}): "
                      "the targets it carried are no longer on file.")
    w = next((x for x in (json.loads(p.read_text()) for p in sorted(A.workouts_dir.glob("*.json")))
              if isinstance(x, dict) and x.get("workoutName") == name), None)
    if w is None or sw.content_hash(w) != (rec.get("hashes") or {}).get(name):
        return None, f"Done from the watch workout {name}, which has changed on disk since it was sent: not scored against an edit he never ran."
    plan = watch_target(w, threshold_hr)
    if plan is None:
        return None, f"Done from the watch workout {name}, which sets no heart-rate target to score against."
    return plan, None


def endurance_parts(plan: dict, m: dict, *, p1: list | None, speed1: list | None, hr_zones: list,
                    ftp: float | None, moving_s: float, fuel_plan: dict | None, fuel_taken: dict | None,
                    grp: str, hr1: list | None = None) -> dict:
    """The pure core for one ride or run against its plan: a plan.json session, or a watch workout's
    own heart-rate target (`hr_band`, from watch_target)."""
    intent, work = plan.get("intent"), plan.get("work") or []
    scores, dropped, detail = {}, {}, {}
    steady = intent in f.INTENT_POWER_BAND

    # Intent
    if plan.get("hr_band"):
        lo, hi = plan["hr_band"]
        a0, a1 = plan.get("hr_window") or (0, len(hr1 or []))
        seg = [x for x in (hr1 or [])[int(a0):int(a1)] if x]
        if len(seg) < 60:
            dropped["intent"] = "no heart rate recorded for the step with the target"
        else:
            under, over = sum(x < lo for x in seg) / len(seg), sum(x > hi for x in seg) / len(seg)
            share = 1 - under - over
            credit = share + (f.UNDER_EASY_CREDIT * under if intent in f.EASY_INTENTS else 0)
            scores["intent"] = min(1.0, credit / f.INTENT_FULL_SHARE)
            detail["intent"] = {"basis": "hr", "band": [round(lo), round(hi)], "in": round(share, 3),
                                "under": round(under, 3), "over": round(over, 3), "target": "watch"}
    elif intent not in f.INTENTS:
        dropped["intent"] = "the plan names no intent"
    elif steady and p1 and ftp:
        lo, hi = (x * ftp for x in f.INTENT_POWER_BAND[intent])
        r30 = f.rolling_seconds(p1, 30)
        ped = [x for x, raw in zip(r30, p1) if x is not None and raw > 0]
        if ped:
            under = sum(x < lo for x in ped) / len(ped)
            over = sum(x > hi for x in ped) / len(ped)
            share = 1 - under - over
            credit = share + (f.UNDER_EASY_CREDIT * under if intent in f.EASY_INTENTS else 0)
            scores["intent"] = min(1.0, credit / f.INTENT_FULL_SHARE)
            detail["intent"] = {"basis": "power", "band": [round(lo), round(hi)], "in": round(share, 3),
                                "under": round(under, 3), "over": round(over, 3)}
        else:
            dropped["intent"] = "no pedalling power recorded"
    elif steady and hr_zones:
        want = f.INTENT_HR_ZONE[intent]
        # Of the session, not of the zones' sum: Garmin counts no time under zone 1, and that time is
        # under the band too (app audit 2026-11-10).
        tot = max(sum(z["secs"] for z in hr_zones), moving_s or 0) or 1
        share = sum(z["secs"] for z in hr_zones if z["zone"] in want) / tot
        under = 1 - share - sum(z["secs"] for z in hr_zones if z["zone"] > max(want)) / tot
        credit = share + (f.UNDER_EASY_CREDIT * under if intent in f.EASY_INTENTS else 0)
        scores["intent"] = min(1.0, credit / f.INTENT_FULL_SHARE)
        z = [x for x in hr_zones if x["zone"] in want]
        detail["intent"] = {"basis": "hr", "band": [z[0]["low"], z[-1]["high"]] if z else None, "in": round(share, 3),
                            "under": round(under, 3), "over": round(max(0.0, 1 - share - under), 3)}
    elif intent in f.INTENT_IF_BAND:
        if_ = (m.get("if") or {}).get("value")
        if if_ is None:
            dropped["intent"] = ("no IF on a run: FTP is a cycling threshold" if grp == "run"
                                 else "no IF: no power or no FTP")
        else:
            lo, hi = f.INTENT_IF_BAND[intent]
            dist = max(0.0, lo - if_, if_ - hi)
            scores["intent"] = f.linear(dist, 0.0, f.IF_FADE)
            detail["intent"] = {"basis": "if", "band": [lo, hi], "done": if_}
    else:
        dropped["intent"] = "no power and no HR zones"

    # Intervals: only when the plan sets work
    if work:
        planned_w = sum(w["reps"] * w["secs"] for w in work)
        if not p1:
            dropped["intervals"] = "no power recorded"
        else:
            thr = f.WORK_TARGET_SLACK * min(w["target"][0] for w in work)
            r10 = f.rolling_seconds(p1, f.WORK_SMOOTH_S)
            done_w = run = 0
            for x in r10 + [None]:
                if x is not None and x >= thr:
                    run += 1
                else:
                    if run >= f.WORK_MIN_S:
                        done_w += run
                    run = 0
            scores["intervals"] = min(1.0, done_w / planned_w)
            detail["intervals"] = {"planned_s": planned_w, "done_s": done_w, "threshold_w": round(thr)}

    # Duration
    if plan.get("duration_min"):
        planned_s = plan["duration_min"] * 60
        dev = abs(moving_s / planned_s - 1)
        scores["duration"] = f.linear(dev, f.DURATION_FULL, f.DURATION_ZERO)
        detail["duration"] = {"planned_min": plan["duration_min"], "done_min": round(moving_s / 60)}

    # Pacing: steady rides on VI, runs on halves; not an interval ride
    if grp == "run":
        moving = [v for v in (speed1 or []) if v > 0.5]
        if len(moving) >= 600:
            h = len(moving) // 2
            v1, v2 = sum(moving[:h]) / h, sum(moving[h:]) / (len(moving) - h)
            dev = abs(v1 / v2 - 1)   # pace ratio: pace2/pace1 = v1/v2
            scores["pacing"] = f.linear(dev, f.RUN_SPLIT_FULL, f.RUN_SPLIT_ZERO)
            detail["pacing"] = {"basis": "halves", "second_vs_first": round(v1 / v2 - 1, 3)}
        else:
            dropped["pacing"] = "no speed stream long enough"
    elif steady or intent not in f.INTENTS:
        vi = (m.get("vi") or {}).get("value")
        if vi is None:
            dropped["pacing"] = "no power: no variability index"
        else:
            scores["pacing"] = f.linear(vi, f.VI_FULL, f.VI_ZERO)
            detail["pacing"] = {"basis": "vi", "done": vi}

    # Fuel: only when a fuel plan existed (S2)
    if fuel_plan and fuel_plan.get("total_g"):   # a plan of 0 g (under an hour) asks for nothing to score
        # What the plan's own products deliver, when that is under the target: whole bottles and gels
        # rarely sum to it, and taking exactly what was planned must score full (2026-11-10 audit:
        # 160 g of products against a 180 g target scored 0.89 for a perfect day).
        fuel_asked = min(fuel_plan["total_g"], fuel_plan.get("planned_g") or fuel_plan["total_g"])
        if fuel_taken is None:
            dropped["fuel"] = "not logged"
        elif not fuel_taken.get("items"):
            dropped["fuel"] = "logged as a note, with no grams" if fuel_taken.get("note") else "logged as nothing taken"
            if not fuel_taken.get("note"):
                scores["fuel"] = 0.0
                dropped.pop("fuel")
        else:
            scores["fuel"] = min(1.0, fuel_taken["g"] / fuel_asked)
        detail["fuel"] = {"planned_g": fuel_asked, "taken_g": (fuel_taken or {}).get("g")}

    flags = []
    it = detail.get("intent") or {}
    if intent in f.EASY_INTENTS and it.get("basis") == "hr" and it.get("under", 0) > 0.5:
        flags.append({"text": f"{round(it['under'] * 100)} % of the ride under the HR band: it was easier than planned, "
                              "or the heart-rate reading was low. Ask before reading it as a miss."})
    _endurance_words(detail, scores, plan, grp)
    applicable = [k for k in f.SCORE_WEIGHTS["endurance"] if k in scores or k in dropped]
    w = f.SCORE_WEIGHTS["endurance"]
    coverage = sum(w[k] for k in scores) / sum(w[k] for k in applicable) if applicable else 0.0
    return {"scores": scores, "dropped": dropped, "detail": detail, "coverage": coverage, "flags": flags}


def score_endurance(a: dict, grp: str) -> dict:
    import endurance_metrics as em
    import fuel
    aid, date = a["activityId"], a["startTimeLocal"][:10]
    plan, against = planned_session(date, grp), None
    if plan is None:
        plan, why = watch_session(a, (em.thresholds().get("threshold_hr") or {}).get("value"))
        if plan is None:
            return excluded(why)
        against = f"watch · {plan['title']}"
    s = em.streams(ed.load(f"activity_{aid}_details.json"))
    hr1 = f.resample_1hz(s["t"], s["hr"]) if "hr" in s else None
    # Pedalling power only: a run's wrist power is not on the bike FTP's scale (11-17: IF 1.57).
    p1 = f.resample_1hz(s["t"], s["power"]) if "power" in s and grp == "bike" else None
    if p1 is not None and not any(p1):
        p1 = None
    sp1 = f.resample_1hz(s["t"], s["speed"]) if "speed" in s else None
    met = em.analyse(aid)
    cfg, cat = fuel.load_cfg(A), fuel.catalog()
    fplan = fuel.for_session(plan, cfg, cat)
    rec = next((r for r in fuel.load_log(A)["records"] if r["activity_id"] == aid), None)
    r = endurance_parts(plan, met["metrics"], p1=p1, speed1=sp1, hr_zones=met["zones"]["hr"],
                        ftp=(met["thresholds"]["ftp"] or {}).get("value"),
                        moving_s=a.get("movingDuration") or a.get("duration") or 0,
                        fuel_plan=fplan, fuel_taken=fuel.summary(rec, a) if rec else None, grp=grp, hr1=hr1)
    return assemble("endurance", r["scores"], r["coverage"], against or f"plan.json {date} · {plan.get('title')}",
                    {"intent": plan.get("intent")}, r["dropped"], r["detail"], r["flags"])


# --------------------------------------------------------------------------- entry points
def score(aid: int) -> dict:
    a = next((x for x in ed.all_activities() if x.get("activityId") == aid), None)
    if a is None:
        raise SystemExit(f"no activity {aid} in the cache")
    return score_activity(a)


def score_activity(a: dict) -> dict:
    """One cached activity (its summary dict), scored — what the app's views call."""
    aid = a["activityId"]
    tk = (a.get("activityType") or {}).get("typeKey")
    grp, kind = sports.group(tk), sports.kind(tk)
    head = {"id": aid, "date": a["startTimeLocal"][:10], "title": a.get("activityName"), "type": tk, "group": grp}
    if grp == "strength" and tk == "strength_training":
        return head | score_strength(a)
    if grp in ("bike", "run"):
        return head | score_endurance(a, grp)
    if tk == "lap_swimming" or kind == "circuit":   # swims and circuits: scripts/session_review.py
        import session_review
        return head | session_review.score(a)
    reason = NOT_SCORED_GROUPS.get("circuit" if kind == "circuit" else grp, "Not a scored sport.")
    return head | excluded(reason)


def scored_between(since: str, until: str = "9999") -> list[dict]:
    acts = sorted((x for x in ed.all_activities() if since <= (x.get("startTimeLocal") or "")[:10] <= until),
                  key=lambda x: x["startTimeLocal"])
    return [score_activity(x) for x in acts]


def _print(r: dict) -> None:
    tot = "—" if r["total"] is None else r["total"]
    print(f"{r['date']}  {r['title']}  ·  {tot} {r['band_label']}  (coverage {round(r['coverage'] * 100)} %)")
    if r["excluded"]:
        print(f"    not scored: {r['excluded']}")
        return
    print(f"    against: {r['against']}")
    print(f"    {r['summary']}" + (f"  [{r['headline']}]" if r.get("headline") else ""))
    for p in r["parts"]:
        if p["dropped"]:
            print(f"    {p['label']:<10} dropped: {p['dropped']}")
        else:
            print(f"    {p['label']:<10} {p['score']:.2f} × {p['weight']} → {p['points']}  {p['planned_text']} → {p['done_text']}")
    for row in r.get("rows") or []:
        if row.get("dropped"):
            print(f"      {row['exid']:<6} {row['label'][:34]:<34} {row['planned']:<18} dropped: {row['dropped']}")
        else:
            print(f"      {row['exid']:<6} {row['label'][:34]:<34} {row['planned']:<18} {row['sets'][0]}/{row['sets'][1]}  "
                  f"{row['done']}" + (f"  [load: {row['load_dropped']}]" if row.get("load_dropped") else "")
                  + (f"  [{row['blank_sets']} set(s) with no reps]" if row.get("blank_sets") else ""))
    if r.get("capped"):
        print(f"    capped {r['capped']['from']} → {r['capped']['to']}: {r['capped']['why']}")
    if r.get("coverage_note"):
        print(f"    {r['coverage_note']}")
    for fl in r["flags"]:
        print(f"    ⚑ {fl['text']}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("activity_id", nargs="?", type=int)
    ap.add_argument("--since")
    ap.add_argument("--until", default="9999")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--athlete", help="checked against the bound session by athlete.current()")
    args = ap.parse_args()
    if args.activity_id is None and not args.since:
        ap.error("give an activity id or --since")
    out = [score(args.activity_id)] if args.activity_id else scored_between(args.since, args.until)
    if args.json:
        print(json.dumps(out if args.since else out[0], indent=1, ensure_ascii=False))
        return
    for r in out:
        _print(r)
        print()


if __name__ == "__main__":
    main()
