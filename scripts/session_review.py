#!/usr/bin/env python3
"""Review a pool swim or a circuit (a HYROX simulation or race rehearsal, a station circuit) against the
structured workout it followed — measured, and scored.

    .venv/bin/python scripts/session_review.py <activity id>          # the analysis, readable
    .venv/bin/python scripts/session_review.py <activity id> --json   # what the app and the review read
    .venv/bin/python scripts/session_review.py <activity id> --score  # its execution score

WHICH WORKOUT IT FOLLOWED. A session started from a workout on the watch carries that workout's id
(`workoutId`). It is matched to the athlete's own generated workout through WORKOUT_IDS.json (the id
Garmin gave the upload, and every id it had before a re-upload), then by name. A session that followed
nothing of ours is still measured; it just has nothing to be scored against, and says so.

SWIMS. Every lap with distance is a rep (a structured swim laps each step itself; a lap-button rest is
a lap with none). The reps are matched to the planned swims in order, by distance — a longest common
subsequence, so one skipped rep costs one rep, not the alignment of everything after it. Measured:
distance, moving pace per 100 m, SWOLF, strokes per length, the pace spread inside each repeated set,
and on a CSS test (planned steps whose note starts "TEST", a 400 and a 200) the critical swim speed.

CIRCUITS. Every step of a lap-button session is a lap. The laps are matched to the planned steps one to
one; a lap under formulas.STRAY_LAP_S is a stray press (2026-11-01: one in round 3 shifted every step
after it and the athlete could not tell where they were), set aside and flagged. Measured: each step's
time and heart rate, labelled with the planned step; the run legs, the stations and the rests in total;
the spread of the run legs.

Every number here is defined in formulas.py (REVIEW_DEFINITIONS, SCORE_DEFINITIONS); the weights are
formulas.SCORE_WEIGHTS["swim"] and ["circuit"]. Reviews written about a session cite these numbers by
path (metrics.<key>, intervals.<n>.<field>) and app_contracts.py checks every one.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

A = athlete.current()
import export_dashboard_data as ed  # noqa: E402
import formulas as f  # noqa: E402
import sports  # noqa: E402

RUN_CATEGORIES = {"RUN"}


def m(value, source: str, unit: str = "", digits: int = 0) -> dict | None:
    if value is None:
        return None
    return {"value": round(value, digits) if digits else round(value), "source": source, "unit": unit}


def kind_of(type_key: str | None) -> str | None:
    tk = type_key or ""
    if tk == "lap_swimming":
        return "swim"
    if tk in sports.CIRCUIT:
        return "circuit"
    return None


# --- the workout it followed ---------------------------------------------------------------------------
def _local_workouts() -> dict[str, tuple[str, dict]]:
    """workoutName → (key, workout) for every generated workout in the athlete's folder."""
    out = {}
    for p in sorted(A.workouts_dir.glob("*.json")):
        try:
            w = json.loads(p.read_text())
        except ValueError:
            continue
        if isinstance(w, dict) and w.get("workoutName") and w.get("workoutSegments"):
            out[w["workoutName"]] = (p.stem, w)
    return out


def planned_workout(a: dict) -> tuple[str | None, dict | None, str]:
    """(key, workout, how it was matched) — or (None, None, why not)."""
    local = _local_workouts()
    ids_doc = ed.load_json(A.workouts_dir / "WORKOUT_IDS.json") if hasattr(ed, "load_json") else None
    if ids_doc is None:
        try:
            ids_doc = json.loads((A.workouts_dir / "WORKOUT_IDS.json").read_text())
        except (OSError, ValueError):
            ids_doc = {}
    by_id = {int(i): n for n, i in (ids_doc.get("workouts") or {}).items() if str(i).isdigit()}
    for n, old in (ids_doc.get("history") or {}).items():
        by_id.update({int(i): n for i in old if str(i).isdigit()})
    wid = a.get("workoutId")
    if wid and int(wid) in by_id and by_id[int(wid)] in local:
        key, w = local[by_id[int(wid)]]
        return key, w, "the workout id the watch recorded"
    if a.get("activityName") in local:
        key, w = local[a["activityName"]]
        return key, w, "the activity's name"
    if wid:
        return None, None, "it followed a workout that is not one of this athlete's generated workouts"
    return None, None, "it was not started from a structured workout"


def workout_at(key: str, current: dict, start: str) -> tuple[dict, str]:
    """The workout as it was when the session started: the last commit of its JSON before `start`, in
    whichever git repository holds the athlete's folder (theirs, when athletes/ is its own private
    repository). Falls back to the current file. A workout is re-generated as it evolves, so a session
    from last month followed last month's steps (2026-11-01: 32 steps against today's 18)."""
    src, sha = athlete.committed_before(A.workouts_dir / f"{key}.json", start)
    if src is not None:
        try:
            return json.loads(src), f"{key}.json @ {sha}"
        except ValueError:
            pass
    return current, f"{key}.json (current)"


def executable_steps(w: dict) -> list[dict]:
    """The workout's executable steps as encoded, repeats NOT expanded — what a set's wktStepIndex counts."""
    out = []

    def walk(steps):
        for s in steps:
            if s.get("type") == "RepeatGroupDTO":
                walk(s.get("workoutSteps") or [])
            else:
                out.append(s)
    for seg in w.get("workoutSegments") or []:
        walk(seg.get("workoutSteps") or [])
    return out


def _step_info(s: dict) -> dict:
    kind = (s.get("stepType") or {}).get("stepTypeKey")
    ex = (s.get("category"), s.get("exerciseName")) if s.get("category") else None
    return {"kind": kind, "note": s.get("description"), "exercise": ex, "rest": kind in ("rest", "recovery")}


def plan_steps(w: dict) -> list[dict]:
    """The workout's steps in the order the watch runs them, repeats expanded:
    {kind, note, metres, seconds, exercise, rest}."""
    out = []

    def walk(steps):
        for s in steps:
            if s.get("type") == "RepeatGroupDTO":
                inner = s.get("workoutSteps") or []
                n = int(s.get("numberOfIterations") or 1)
                for rep in range(n):
                    last = rep == n - 1
                    walk([x for x in inner if not (last and s.get("skipLastRestStep")
                                                   and (x.get("stepType") or {}).get("stepTypeKey") == "rest"
                                                   and x is inner[-1])])
                continue
            kind = (s.get("stepType") or {}).get("stepTypeKey")
            end = (s.get("endCondition") or {}).get("conditionTypeKey")
            v = s.get("endConditionValue")
            out.append({"kind": kind, "note": s.get("description"),
                        "metres": v if end == "distance" else None,
                        "seconds": v if end in ("time", "fixed.rest") else None,
                        "exercise": (s.get("category"), s.get("exerciseName")) if s.get("category") else None,
                        "rest": kind in ("rest", "recovery")})
    for seg in w.get("workoutSegments") or []:
        walk(seg.get("workoutSteps") or [])
    return out


def _laps(aid: int) -> list[dict]:
    return (ed.load(f"activity_{aid}_splits.json") or {}).get("lapDTOs") or []


def _lcs(planned: list[float], done: list[float]) -> list[tuple[int, int]]:
    """Index pairs (planned i, done j) of the longest common subsequence of equal distances."""
    n, k = len(planned), len(done)
    t = [[0] * (k + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(k - 1, -1, -1):
            t[i][j] = t[i + 1][j + 1] + 1 if abs(planned[i] - done[j]) < 1 else max(t[i + 1][j], t[i][j + 1])
    out, i, j = [], 0, 0
    while i < n and j < k:
        if abs(planned[i] - done[j]) < 1:
            out.append((i, j))
            i, j = i + 1, j + 1
        elif t[i + 1][j] >= t[i][j + 1]:
            i += 1
        else:
            j += 1
    return out


# --- swims ------------------------------------------------------------------------------------------------
def analyse_swim(a: dict) -> dict:
    aid = a["activityId"]
    key, w, how = planned_workout(a)
    ref = None
    if w is not None:
        w, ref = workout_at(key, w, a["startTimeLocal"])
    reps = [x for x in _laps(aid) if (x.get("distance") or 0) > 0]
    met = {"distance": m(a.get("distance"), "garmin", "m"),
           "moving_s": m(a.get("movingDuration") or a.get("duration"), "garmin", "s"),
           "pace_100": m(f.pace_per_100(a.get("movingDuration") or a.get("duration"), a.get("distance")), "computed", "s/100m"),
           "swolf": m(a.get("averageSwolf"), "garmin"),
           "strokes_per_length": m(a.get("avgStrokes"), "garmin", "", 1),
           "stroke_rate": m(a.get("averageSwimCadenceInStrokesPerMinute"), "garmin", "spm"),
           "avg_hr": m(a.get("averageHR"), "garmin", "bpm")}
    intervals = []
    for i, lap in enumerate(reps):
        secs = lap.get("movingDuration") or lap.get("duration")
        intervals.append({"n": i + 1, "metres": round(lap.get("distance") or 0), "secs": round(secs or 0),
                          "pace_100": round(f.pace_per_100(secs, lap.get("distance")) or 0, 1),
                          "swolf": lap.get("averageSWOLF"), "stroke": lap.get("swimStroke"),
                          "hr": lap.get("averageHR"), "planned": None})
    out = {"id": aid, "sport": "swim", "type": "lap_swimming", "metrics": {}, "intervals": intervals,
           "planned": None, "sets": [], "flags": [], "definitions": f.REVIEW_DEFINITIONS}
    if w is not None:
        steps = plan_steps(w)
        work = [s for s in steps if not s["rest"] and s["metres"]]
        pairs = _lcs([s["metres"] for s in work], [x["metres"] for x in intervals])
        for i, j in pairs:
            intervals[j]["planned"] = {"n": i + 1, "note": work[i]["note"], "kind": work[i]["kind"]}
        planned_m = sum(s["metres"] for s in work)
        out["planned"] = {"key": key, "name": w["workoutName"], "matched_by": how, "version": ref, "metres": planned_m,
                          "swims": len(work), "done": len(pairs)}
        # Sets: runs of consecutive planned swims with the same distance and note — a repeat's reps.
        groups, cur = [], []
        for i, s in enumerate(work):
            if cur and (s["metres"], s["note"]) == (work[cur[-1]]["metres"], work[cur[-1]]["note"]) and i == cur[-1] + 1:
                cur.append(i)
            else:
                if len(cur) > 1:
                    groups.append(cur)
                cur = [i]
        if len(cur) > 1:
            groups.append(cur)
        done_at = dict(pairs)
        for g in groups:
            paces = [intervals[done_at[i]]["pace_100"] for i in g if i in done_at]
            sp = f.spread(paces)
            out["sets"].append({"reps": len(g), "done": len(paces), "metres": work[g[0]]["metres"],
                                "note": work[g[0]]["note"], "pace_spread": round(sp, 3) if sp is not None else None})
        # A CSS test: the planned "TEST" 400 and 200, each matched to its lap.
        tests = {int(work[i]["metres"]): intervals[j]["secs"] for i, j in pairs
                 if (work[i]["note"] or "").upper().startswith("TEST") and int(work[i]["metres"]) in (400, 200)}
        if 400 in tests and 200 in tests:
            met["css_100"] = m(f.css_per_100(tests[400], tests[200]), "computed", "s/100m", 1)
            out["flags"].append({"key": "css", "text": "A CSS test: set profile.css_s100 in athlete.json to this, and "
                                                        "pace the swims that follow from it."})
        if len(pairs) < len(work):
            n = len(work) - len(pairs)
            out["flags"].append({"key": "missed", "text": f"{n} planned swim{' has' if n == 1 else 's have'} no matching lap."})
    else:
        out["planned_note"] = f"Not reviewed against a plan: {how}."
    sp = [s["pace_spread"] for s in out["sets"] if s["pace_spread"] is not None]
    if sp:
        met["pace_spread"] = m(max(sp) * 100, "computed", "%", 1)
    out["metrics"] = {k: v for k, v in met.items() if v}
    return out


# --- circuits -----------------------------------------------------------------------------------------------
def analyse_circuit(a: dict) -> dict:
    aid = a["activityId"]
    tk = (a.get("activityType") or {}).get("typeKey")
    key, w, how = planned_workout(a)
    ref = None
    if w is not None:
        w, ref = workout_at(key, w, a["startTimeLocal"])
    sets = (ed.load(f"activity_{aid}_sets.json") or {}).get("exerciseSets") or []
    by_index = [s for s in sets if s.get("wktStepIndex") is not None]
    out = {"id": aid, "sport": "circuit", "type": tk, "metrics": {}, "intervals": [], "planned": None,
           "flags": [], "definitions": f.REVIEW_DEFINITIONS}
    plan = [_step_info(s) for s in executable_steps(w)] if w is not None else []
    # The steps done: the watch's own sets, each naming the planned step it was on (a cardio profile
    # records a structured circuit this way); else the laps, in order (a session raced without a workout).
    if by_index:
        done = [{"secs": s.get("duration") or 0, "hr": None, "index": s["wktStepIndex"],
                 "logged": "rest" if s.get("setType") != "ACTIVE" else "active",
                 "exercise": "/".join(x for x in ((s.get("exercises") or [{}])[0].get(k) for k in ("category", "name")) if x) or None}
                for s in sets if s.get("wktStepIndex") is not None]
        basis = "sets"
    else:
        laps = _laps(aid)
        done = [{"secs": x.get("duration") or 0, "hr": x.get("averageHR"), "index": i, "logged": None,
                 "metres": x.get("distance")} for i, x in enumerate(laps)]
        basis = "laps"
    stray = [d for d in done if d["secs"] < f.STRAY_LAP_S]
    kept = [d for d in done if d["secs"] >= f.STRAY_LAP_S]
    if basis == "laps":   # laps carry no step index: set the strays aside, then count them in order
        for i, d in enumerate(kept):
            d["index"] = i
    for n, d in enumerate(kept, 1):
        st = plan[d["index"]] if d["index"] < len(plan) else None
        ex = (st or {}).get("exercise")
        role = None if st is None else "rest" if st["rest"] else "run" if ex and ex[0] in RUN_CATEGORIES else "station"
        out["intervals"].append({"n": n, "secs": round(d["secs"]), "hr": d.get("hr"), "step": d["index"] + 1,
                                 "planned": {"note": st["note"], "role": role, "exercise": "/".join(ex) if ex else None}
                                 if st else None})
    met = {"moving_s": m(a.get("duration"), "garmin", "s"), "avg_hr": m(a.get("averageHR"), "garmin", "bpm"),
           "steps_recorded": m(len(done), "garmin"), "stray_laps": m(len(stray), "computed")}
    if w is not None:
        working = [i for i, s in enumerate(plan) if not s["rest"]]
        seen = {d["index"] for d in kept}
        out["planned"] = {"key": key, "name": w["workoutName"], "matched_by": how, "version": ref,
                          "steps": len(plan), "working": len(working), "done_working": len(seen & set(working)),
                          "steps_seen": len(seen & set(range(len(plan)))), "basis": basis}
        extra = len(kept) - len(seen)
        if out["planned"]["steps_seen"] < len(plan) or extra > 0:
            out["flags"].append({"key": "structure",
                                 "text": f"{out['planned']['steps_seen']} of {len(plan)} planned steps recorded"
                                         + (f", {extra} recorded more than once" if extra > 0 else "") + "."})
        for role in ("run", "station", "rest"):
            tt = sum(x["secs"] for x in out["intervals"] if (x["planned"] or {}).get("role") == role)
            if tt:
                met[f"{role}_s"] = m(tt, "computed", "s")
        runs = [x["secs"] for x in out["intervals"] if (x["planned"] or {}).get("role") == "run"
                and plan[x["step"] - 1]["kind"] == "interval"]
        sp = f.spread(runs)
        if sp is not None:
            met["run_spread"] = m(sp * 100, "computed", "%", 1)
    else:
        out["planned_note"] = f"Not reviewed against a plan: {how}."
    if stray:
        n = len(stray)
        out["flags"].append({"key": "stray_laps", "text": f"{n} step{'' if n == 1 else 's'} under {f.STRAY_LAP_S} s — "
                                                          f"a button pressed twice. Set aside; check the steps around "
                                                          f"{'it' if n == 1 else 'them'}."})
    out["metrics"] = {k: v for k, v in met.items() if v is not None}
    return out


def analyse(aid: int) -> dict:
    a = next((x for x in ed.all_activities() if x.get("activityId") == aid), None)
    if a is None:
        sys.exit(f"no activity {aid} in the cache")
    k = kind_of((a.get("activityType") or {}).get("typeKey"))
    if k == "swim":
        return analyse_swim(a)
    if k == "circuit":
        return analyse_circuit(a)
    sys.exit(f"activity {aid} is not a pool swim or a circuit (rides and runs: endurance_metrics.py)")


def analysis_for(aid: int) -> dict:
    """The analysis a review of this activity cites: this module's for swims and circuits, the endurance
    engine's for rides and runs."""
    a = next((x for x in ed.all_activities() if x.get("activityId") == aid), None)
    if a is not None and kind_of((a.get("activityType") or {}).get("typeKey")):
        return analyse(aid)
    import endurance_metrics
    return endurance_metrics.analyse(aid)


# --- the score ---------------------------------------------------------------------------------------------
def score(a: dict) -> dict:
    """session_score's shape (session_score.assemble), for a swim or a circuit."""
    import session_score as ss
    k = kind_of((a.get("activityType") or {}).get("typeKey"))
    an = analyse_swim(a) if k == "swim" else analyse_circuit(a)
    if an["planned"] is None:
        return ss.excluded(an.get("planned_note") or "Nothing was planned.")
    p, scores, detail, dropped = an["planned"], {}, {}, {}
    # What the athlete reads: the workout's own name and how it was found — no file names (the score's rule).
    how = {"the workout id the watch recorded": "the workout the watch ran"}.get(p["matched_by"], p["matched_by"])
    against = f"{p['name']} · {how}" + (", as it was that day" if "@" in (p.get("version") or "") else "")
    if k == "swim":
        swum = (an["metrics"].get("distance") or {}).get("value") or 0
        off = abs(swum - p["metres"]) / p["metres"] if p["metres"] else None
        scores["distance"] = f.band_score(off, *f.SWIM_DISTANCE_BAND) if off is not None else 0.0
        pm = round(p["metres"])
        detail["distance"] = {"planned_m": pm, "swum_m": swum, "planned_text": f"{pm:,} m",
                              "done_text": f"{swum:,} m", "miss": f"{swum:,} m of {pm:,} m planned",
                              "short": "short" if swum < p["metres"] else "long"}
        scores["swims"] = p["done"] / p["swims"] if p["swims"] else 0.0
        miss = p["swims"] - p["done"]
        detail["swims"] = {"planned": p["swims"], "done": p["done"], "planned_text": f"{p['swims']} swims",
                           "done_text": f"{p['done']}", "miss": f"{miss} of {p['swims']} planned swims not done" if miss else None,
                           "short": "swims missed"}
        sets = [s for s in an["sets"] if s["pace_spread"] is not None]
        if sets:
            n = sum(s["done"] for s in sets)
            scores["swim_pacing"] = sum(f.band_score(s["pace_spread"], *f.PACE_CV_BAND) * s["done"] for s in sets) / n
            worst = max(s["pace_spread"] for s in sets)
            detail["swim_pacing"] = {"sets": len(sets), "worst_spread": worst,
                                     "planned_text": f"even sets · within {round(f.PACE_CV_BAND[0] * 100)} %",
                                     "done_text": f"spread {round(worst * 100, 1)} % at worst",
                                     "miss": f"a set's pace spread {round(worst * 100, 1)} %", "short": "uneven"}
        else:
            dropped["swim_pacing"] = "No repeated set with two reps done to compare."
        weights = f.SCORE_WEIGHTS["swim"]
    else:
        scores["steps"] = p["done_working"] / p["working"] if p["working"] else 0.0
        miss = p["working"] - p["done_working"]
        detail["steps"] = {"planned": p["working"], "done": p["done_working"], "planned_text": f"{p['working']} working steps",
                           "done_text": f"{p['done_working']}", "short": "steps missed",
                           "miss": f"{miss} of {p['working']} working steps not done" if miss else None}
        stray = (an["metrics"].get("stray_laps") or {}).get("value", 0)
        recorded = (an["metrics"].get("steps_recorded") or {}).get("value", 0) - stray
        off = (p["steps"] - p["steps_seen"]) + max(0, recorded - p["steps_seen"]) + stray
        scores["structure"] = max(0.0, 1 - off / p["steps"]) if p["steps"] else 0.0
        detail["structure"] = {"planned_steps": p["steps"], "recorded": recorded, "stray": stray,
                               "planned_text": f"{p['steps']} steps, one lap each",
                               "done_text": f"{recorded} recorded" + (f" · {stray} stray" if stray else ""),
                               "miss": f"{off} step{'s' if off != 1 else ''} out of place" if off else None,
                               "short": "stray laps" if stray else "steps off"}
        rsp = (an["metrics"].get("run_spread") or {}).get("value")
        if rsp is not None:
            scores["circuit_pacing"] = f.band_score(rsp / 100, *f.CIRCUIT_RUN_CV_BAND)
            detail["circuit_pacing"] = {"run_spread_pct": rsp,
                                        "planned_text": f"even run legs · within {round(f.CIRCUIT_RUN_CV_BAND[0] * 100)} %",
                                        "done_text": f"spread {rsp} %", "miss": f"run legs {rsp} % apart", "short": "uneven"}
        else:
            dropped["circuit_pacing"] = "Fewer than two run legs to compare."
        weights = f.SCORE_WEIGHTS["circuit"]
    coverage = sum(weights[x] for x in scores) / sum(weights.values())
    return ss.assemble(k, scores, coverage, against, None, dropped, detail, an["flags"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("activity_id", type=int)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--score", action="store_true")
    args = ap.parse_args()
    if args.score:
        a = next((x for x in ed.all_activities() if x.get("activityId") == args.activity_id), None)
        if a is None:
            sys.exit(f"no activity {args.activity_id} in the cache")
        print(json.dumps(score(a), indent=1, ensure_ascii=False))
        return 0
    out = analyse(args.activity_id)
    if args.json:
        print(json.dumps(out, indent=1, ensure_ascii=False, default=str))
        return 0
    p = out["planned"]
    print(f"{A.display} · activity {out['id']} · {out['type']} · "
          + (f"against {p['name']} ({p['matched_by']})" if p else out.get("planned_note", "")))
    for key, v in out["metrics"].items():
        print(f"  {key:20} {v['value']} {v['unit']}  [{v['source']}]")
    for x in out["intervals"]:
        pl = x["planned"] or {}
        print(f"  {x['n']:>3}. {x.get('metres') or '':>5} {x['secs']:>5}s  hr {x.get('hr') or '-':>4}  "
              f"{pl.get('role') or pl.get('kind') or '':8} {pl.get('note') or ''}")
    for s in out.get("sets", []):
        print(f"  set {s['reps']}×{s['metres']}: {s['done']} done, pace spread {s['pace_spread']}")
    for fl in out["flags"]:
        print(f"  ! {fl['text']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
