#!/usr/bin/env python3
"""The app's data layer: what the OpenSportCoach app shows, as JSON, through athlete.py.

    .venv/bin/python scripts/app_data.py attach --session <claude session id>
    .venv/bin/python scripts/app_data.py <view> [arg]           (as the bound athlete, or --athlete)

    views: today · recovery · load · strength · sessions · workout <activity id> ·
           exercise <CATEGORY/EXERCISE_NAME> · program · calendar · races · body · journal ·
           journal-entry <file> · memory · system

WHY (2026-10-08, docs/DESIGN.md (the app)). The app's server is TypeScript, and it must never build an athlete
path itself — that would be a second resolver, the defect the multi-athlete split exists to prevent.
So everything athlete-specific the app shows comes from here, and from here only.

RULES THIS FILE KEEPS
  * No model, no Garmin call. Every number comes from the cache, the export, the program or the
    athlete's files. A screen never waits on judgment.
  * No second formula. Numbers come from the engine's own functions (formulas, the export's
    helpers, rotation(), lift_rows(), audit(), recovery_on()); this file arranges them.
  * Definitions travel with numbers. Every view carries `defs`: for each metric, its source
    (garmin · computed · coach) and one line saying what it is — built from the engine's
    constants, so the app's tooltips cannot drift from the code.
  * `verdict` from dashboard.json is never shown: it is coaching text hardcoded in the engine.

attach — the channel server starts before anyone is bound, so it serves nothing athlete-specific
until the session attaches it. This reads the session's binding ITSELF (data/sessions/<sid>), refuses
an unbound session, marks the session as app-attached (scripts/hooks/confirm_gate.py then holds
Garmin writes to a click in the app), and prints who the app is for.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402
import sports  # noqa: E402

SINCE = "2026-06-13"   # reliable named-exercise data starts here (structured workouts)
TODAY = dt.date.today


# --- attach ----------------------------------------------------------------------------------
def attach(sid: str) -> dict:
    if not athlete.SESSION_RE.match(sid or ""):
        sys.exit(f"refused: {sid!r} is not a Claude session id.")
    name = athlete.bound_name(sid)
    if not name:
        sys.exit("refused: this Claude session is not bound to an athlete. Bind it first "
                 "(.venv/bin/python scripts/use.py <name>), then attach the app.")
    a = athlete.load(name)
    sessions = a.app_dir / "sessions"
    sessions.mkdir(parents=True, exist_ok=True)
    marker = sessions / f"{sid}.json"
    if not marker.exists():
        marker.write_text(json.dumps({"attached_at": dt.datetime.now().isoformat(timespec="seconds")}) + "\n")
    return {"athlete": a.name, "display": a.display, "garmin_account": a.garmin.get("full_name"),
            "accent": (a.config.get("app") or {}).get("accent"),
            # The only directories the server may read the coach's results from, and where it keeps
            # the app's state — handed over here so the server never builds an athlete path.
            "logs_dir": str(a.logs_dir), "app_dir": str(a.app_dir)}


# --- shared pieces ---------------------------------------------------------------------------
def _ed():
    import export_dashboard_data as ed
    return ed


def _dashboard(A) -> dict:
    try:
        return json.loads(A.dashboard_path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def _sid_group(a: dict) -> str:
    ed = _ed()
    return ed.SPORT_GROUP.get((a.get("activityType") or {}).get("typeKey", ""), "other")


def _iso_week(day: str) -> str:
    y, w, _ = dt.date.fromisoformat(day).isocalendar()
    return f"{y}-W{w:02d}"


def defs(*keys: str) -> dict:
    """{metric: {source, definition}}, each line built from the engine's own constants."""
    ed = _ed()
    import formulas
    import progression_report as pr
    import races as rc
    import rotation_status as rs
    names = {"HRV vs 30d": "HRV", "RHR vs 30d": "resting HR", "Sleep perf": "sleep vs need", "Respiration": "respiration",
             "Skin temp": "skin temperature"}
    weights = ", ".join(f"{names.get(label, label)} {w} %" for label, w in ed.RECOVERY_WEIGHTS)
    table = {
        "e1rm": ("computed", formulas.E1RM_DEFINITION),
        "hrv": ("garmin", "Average HRV across the night, from your watch."),
        "hrv_band": ("garmin", "Garmin's own balanced range for your HRV (its baseline), from the night's HRV summary."),
        "rhr": ("garmin", "Resting heart rate for the day, from your watch."),
        "rhr_baseline": ("computed", "Mean of the last 30 days' resting heart rate."),
        "readiness": ("garmin", "Garmin training readiness, from the wake-up reading."),
        "recovery": ("computed", f"OpenSportCoach's recovery score, 0–100: five signals against your own 30-day usual, "
                                 f"weighted {weights}. At your usual, HRV and resting HR earn half their points, so a "
                                 "good ordinary morning scores about 65–75; 67 and up reads as recovered. A signal "
                                 "the watch didn't record hands its weight to the others."),
        "strain": ("computed", f"The day's Garmin training load mapped onto 0–21 (21 × load / {ed.STRAIN_REF:g}, capped)."),
        "sleep_performance": ("computed", "Sleep time as a share of Garmin's sleep need for the night."),
        "sleep_score": ("garmin", "Garmin's overall sleep score."),
        "hrv_weekly": ("garmin", "Garmin's 7-night HRV average — what its HRV status compares with the balanced band."),
        "rhr_7d": ("computed", formulas.ROLLING_DEFINITION),
        "trend_7d": ("computed", formulas.ROLLING_DEFINITION),
        "sleep_restorative": ("computed", "Restorative sleep: deep + REM as a share of time asleep."),
        "sleep_efficiency": ("computed", "Sleep efficiency: time asleep ÷ time from falling asleep to waking."),
        "awakenings": ("garmin", "Times the watch staged you awake during the night, not counting the final waking."),
        "load": ("garmin", "Garmin training load: EPOC, from heart rate. It barely registers lifting — read "
                           "strength by tonnage and sets, never with cardio in one number."),
        "fitness": ("computed", f"Fitness: Garmin load averaged with a {ed.CTL_TAU}-day exponential weight."),
        "fatigue": ("computed", f"Fatigue: Garmin load averaged with a {ed.ATL_TAU}-day exponential weight."),
        "form": ("computed", "Form = fitness − fatigue."),
        "acwr_cardio": ("garmin", "Garmin's acute:chronic workload ratio."),
        "acwr_strength": ("computed", "Strength acute:chronic ratio: tonnage over 7 days ÷ (tonnage over 28 days ÷ 4)."),
        "tonnage": ("computed", "Σ weight × reps over every logged set, warm-ups included — they were lifted."),
        "week_like_for_like": ("computed", "This week up to its last finished day against last week up to the same "
                                           "day — never a part week against a whole one. Today counts once it logged "
                                           "a session and nothing planned for it is left."),
        "week_planned": ("coach", "Still to come this week: Garmin's calendar and the coach's off-watch plan. "
                                  "Minutes: a gym day's estimate from the program, a watch workout's own estimate, "
                                  "else your median time for that sport over its last five sessions (≈)."),
        "week_target": ("coach", "The coach's weekly band for this number (program WEEK_TARGETS; cardio load from "
                                 "your profile). Without one the row only says how it moved."),
        "sleep_need": ("garmin", "Garmin's sleep need for each night, averaged over the nights so far."),
        "sets_per_muscle": ("computed", "Working sets (programmed warm-ups excluded) over the last 7 days, by "
                                        "exercise; the band is your weekly target range."),
        "progression": ("computed", "Each lift judged over its sessions since mid-June: "
                                    + "; ".join(f"{k.lower()} = {v}" for k, v in pr.CLASS_DEFINITIONS.items()) + "."),
        "bump": ("computed", "Your latest session at the programmed load hit the target reps on every planned set."),
        "starved": ("computed", f"A program day not trained for more than {rs.STARVED_DAYS} days."),
        "audit": ("computed", "Prescription check: ok · watch (missed once) · stale (asked 2+ sessions, never met) · "
                              "impossible (implies an e1RM more than 8 kg above your best) · abandoned (no session in 21+ days)."),
        "weight": ("garmin", "Body weight from your scale, via Garmin."),
        "watch_sync": ("computed", "Compared with what was last verified on your watch — no Garmin call."),
        # Races (docs/DESIGN.md (races)): the windows are coaching rules the athlete approved; races.py holds them.
        "race_windows": ("coach", rc.WINDOWS_DEFINITION),
        "race_easy": ("coach", rc.WINDOW["easy"]),
        "race_taper": ("coach", rc.WINDOW["taper"]),
        "race_day": ("coach", rc.WINDOW["race"]),
        # Fuelling (docs/DESIGN.md (fuelling and score) §4): the rule's own sentences, never the page's.
        "fuel_band": ("computed", formulas.FUEL_DEFINITIONS["carb_band"]),
        "fuel_target": ("computed", formulas.FUEL_DEFINITIONS["carb_target"]),
        "fuel_gut": ("you", formulas.FUEL_DEFINITIONS["gut"]),
        "fuel_taken": ("you", formulas.FUEL_DEFINITIONS["taken"]),
        # The execution score (docs/DESIGN.md (fuelling and score) §5): scripts/session_score.py, its words formulas.py's.
        "score": ("computed", formulas.SCORE_DEFINITIONS["score"] + " " + formulas.SCORE_DEFINITIONS["bands"]),
        **{f"score_{k}": ("computed", formulas.SCORE_DEFINITIONS[k]) for k in formulas.SCORE_WEIGHTS["strength"]},
        **{f"score_{k}": ("computed", formulas.SCORE_DEFINITIONS[k]) for k in formulas.SCORE_WEIGHTS["endurance"]},
        **{f"score_{k}": ("computed", formulas.SCORE_DEFINITIONS[k]) for kind in ("swim", "circuit")
           for k in formulas.SCORE_WEIGHTS[kind]},
        "race_recovery": ("coach", rc.WINDOW["recovery"]),
        "race_priority": ("coach", " ".join(rc.PRIORITIES.values())),
        "race_countdown": ("computed", rc.COUNTDOWN_DEFINITION),
        "race_check": ("computed", rc.CHECK_DEFINITION),
        "race_target": ("coach", "Your own target for the race; the result is read against it."),
        "race_prediction": ("computed", rc.PREDICTION_DEFINITION),
        "race_splits": ("computed", rc.SPLITS_DEFINITION),
        "est_time": ("computed", f"Estimated: sets × work time (≈{SEC_PER_REP} s a rep, the prescribed time for timed "
                                 f"work, both sides for per-side work, {POWER_SET_S} s a power set) + the watch's rest "
                                 f"between series + {LAP_S} s a lap between exercises + {WARMUP_SET_S} s a warm-up set."),
        "phase": ("computed", "Phase in the day, in order: core block → power before the first main lift → the first "
                              "loaded lift (strength) → timed and athletic work after it (functional) → the rest "
                              "(hypertrophy). The program can name a phase itself."),
        "next_target": ("computed", "Double progression: the top of the range on every set earns the next step — "
                                    + ", ".join(f"{k.replace('_', ' ')} {v:g} kg" for k, v in INCREMENT.items())
                                    + " (dumbbells per hand; plates on a machine)."),
        "planned_volume": ("computed", "Working sets per muscle in one week of the program — every gym day once, "
                                       "optional days left out, warm-ups excluded. Speed, jump, throw, sled and rope "
                                       "work counts in the Athletic bucket, never as muscle volume."),
    }
    return {k: {"source": table[k][0], "definition": table[k][1]} for k in keys if k in table}


def block(A) -> dict | None:
    """The program's training block, if it declares one: {name, start, weeks} → week N of M."""
    b = getattr(A.program, "BLOCK", None)
    if not b:
        return None
    start = dt.date.fromisoformat(b["start"])
    week = (TODAY() - start).days // 7 + 1
    return {"name": b["name"], "start": b["start"], "weeks": b["weeks"], "week": week,
            "over": week > b["weeks"]}


def sync_status(A) -> dict:
    """Each managed workout: in sync with the watch, changed since, never pushed — offline."""
    import sync_workouts as sw
    try:
        ids = json.loads((A.workouts_dir / "WORKOUT_IDS.json").read_text())
    except (OSError, json.JSONDecodeError):
        ids = {}
    on_watch, hashes = ids.get("workouts") or {}, ids.get("hashes") or {}
    out = []
    for key in A.managed:
        path = A.workouts_dir / f"{key}.json"
        if not path.exists():
            continue
        w = json.loads(path.read_text())
        name = w.get("workoutName")
        if name not in on_watch:
            state = "not_pushed"
        elif name not in hashes:
            state = "unknown"
        else:
            state = "in_sync" if hashes[name] == sw.content_hash(w) else "changed"
        out.append({"key": key, "workout": name, "id": on_watch.get(name), "state": state})
    pending = [x for x in out if x["state"] in ("changed", "not_pushed")]
    return {"workouts": out, "pending": len(pending),
            "unknown": sum(1 for x in out if x["state"] == "unknown")}


def cardio_targets(A, dash: dict) -> dict | None:
    """This week's cardio against the athlete's weekly targets (athlete.json → profile.cardio_targets)."""
    t = A.profile.get("cardio_targets")
    if not t:
        return None
    done = defaultdict(int)
    load = 0
    for d in (dash.get("week") or {}).get("days", []):
        for it in d.get("items", []):
            done[it["group"]] += 1
            if it["group"] != "strength":
                load += it.get("load") or 0
    sessions = {g: {"done": done.get(g, 0), "target": t[k]}
                for g, k in (("run", "runs"), ("swim", "swims"), ("bike", "rides")) if k in t}
    return {"sessions": sessions, "load": {"done": round(load), "band": t.get("cardio_load")}}


def _latest_daily(A) -> dict | None:
    files = sorted(A.logs_dir.glob("[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].json")) if A.logs_dir.exists() else []
    for f in reversed(files):
        try:
            return {"file": f.name, **json.loads(f.read_text())}
        except json.JSONDecodeError:
            continue
    return None


def _trained_today() -> list:
    """Every session logged today, whatever the calendar says (Garmin links an activity to its
    scheduled workout only when it was started from it). kind: strength · circuit (Hyrox, HIIT —
    set-bearing, docs/DESIGN.md (app audit) M3) · endurance · sport (sports.badge). From the cache, not the export's workout list,
    which keeps only strength and endurance."""
    ed = _ed()
    out = []
    for a in ed.all_activities():
        if a.get("startTimeLocal", "")[:10] != TODAY().isoformat():
            continue
        tk = (a.get("activityType") or {}).get("typeKey", "")
        grp = sports.group(tk)
        b = sports.badge(tk)
        kind = b["kind"]
        sets = ed.sets_of(a["activityId"]) if tk in sports.SET_BEARING else []
        out.append({"id": a["activityId"], "title": a.get("activityName") or b["sport"], **b, "group": grp,
                    "start": a["startTimeLocal"][11:16], "durationMin": round((a.get("duration") or 0) / 60),
                    "sets": sum(1 for s in ed.strip_warmups(sets) if ed.is_logged_work(s)) if kind == "strength" else len(sets) or None,
                    "tonnage": ed.tonnage_of(a["activityId"]) if kind == "strength" else None,
                    "distanceKm": round((a.get("distance") or 0) / 1000, 1) or None})
    return sorted(out, key=lambda x: x["start"])


def _stations(raw: list) -> list:
    """A circuit's sets as stations, in order: what, how long, reps, load — the watch's own exercise
    names, marked when the watch guessed them (CLAUDE.md: never trust an auto-detected name)."""
    ed = _ed()
    out = []
    for s in raw:
        if s.get("setType") != "ACTIVE":
            continue
        ex = (s.get("exercises") or [{}])[0]
        prob = ex.get("probability")
        cat, name = ex.get("category") or "", ex.get("name") or ""
        # SLED/PUSH reads "Push" alone: name the category too when the name doesn't already.
        label = ed.pretty(cat, name) if cat.split("_")[0] in name else f"{ed.pretty(cat, cat)} {ed.pretty(cat, name)}"
        out.append({"label": label, "category": ex.get("category"),
                    "name": ex.get("name"), "duration_s": round(s.get("duration") or 0),
                    "reps": s.get("repetitionCount"), "weight": round((s.get("weight") or 0) / 1000, 1) or None,
                    "auto_detected": prob is not None and prob < 100})
    return out


def _call_program(A, daily: dict | None) -> dict | None:
    if not daily or daily.get("date") != TODAY().isoformat():
        return None
    key = (daily.get("recommendation") or {}).get("workout_key")
    if not key or key not in A.program.PROGRAM:
        return None
    return _program_day_view(A, key, A.program.PROGRAM[key])


def _program_day_view(A, key: str, spec: dict) -> dict:
    ed = _ed()
    phases = _phases(A, key, spec["exercises"])
    return {"key": key, "name": spec["name"],
            "exercises": [{"exid": e[0], "routine": e[1], "category": e[2], "name": e[3], "label": ed.pretty(e[2], e[3]),
                           "sets": e[4], "value": e[5], "weight": e[6], "rest_s": e[7], "kind": e[8], "phase": ph,
                           # PER ARM for two-dumbbell lifts (program.py's format); plates only on machines
                           "per_hand": (e[2], e[3]) in ed.TWO_DB, "machine": (e[2], e[3]) in ed.MACHINE}
                          for e, ph in zip(spec["exercises"], phases)]}


def _last_day() -> dict | None:
    """Every session of the last day anything was logged (today included), in time order — the
    Today card's tabs. Strength sessions say whether their sets have synced yet: Garmin lands the
    activity before its sets, and a session without them can't be read against the plan."""
    ed = _ed()
    acts = [a for a in ed.all_activities() if a.get("startTimeLocal", "")[:10] <= TODAY().isoformat()]
    if not acts:
        return None
    date = acts[0]["startTimeLocal"][:10]
    out = []
    for a in sorted((a for a in acts if a["startTimeLocal"][:10] == date), key=lambda a: a["startTimeLocal"]):
        tk = (a.get("activityType") or {}).get("typeKey", "")
        start = dt.datetime.fromisoformat(a["startTimeLocal"].replace(" ", "T"))
        secs = a.get("elapsedDuration") or a.get("duration") or 0
        grp = sports.group(tk)
        out.append({"id": a["activityId"], "title": a.get("activityName") or sports.badge(tk)["sport"], **sports.badge(tk),
                    "group": grp, "start": start.strftime("%H:%M"), "end": (start + dt.timedelta(seconds=secs)).strftime("%H:%M"),
                    "durationMin": round((a.get("duration") or 0) / 60),
                    "has_sets": (ed.DATA / f"activity_{a['activityId']}_sets.json").exists() if grp == "strength" else None})
    return {"date": date, "sessions": out}


def _weight_at(hist: dict | None, day: str):
    """The prescribed load on `day`, walking the history's changes back from today's ask."""
    if not hist:
        return None
    for ch in sorted(hist.get("changes") or [], key=lambda c: c["date"]):
        if ch["date"] > day:
            return ch.get("from")
    return hist.get("weight")


def _hrv_rhr(n: int = 30) -> list:
    """The last `n` days of HRV and resting HR with their 7-day trends: Garmin's own 7-night HRV
    average (weeklyAvg — what its HRV status compares to the band) and a computed 7-day resting-HR
    mean (formulas.rolling_mean; Garmin has none). Six extra days in front fill the first windows."""
    import formulas
    ed = _ed()
    end = TODAY()
    rows = []
    for i in range(n + 5, -1, -1):
        d = (end - dt.timedelta(days=i)).isoformat()
        h = (ed.load(f"{d}_hrv.json") or {}).get("hrvSummary") or {}
        rows.append({"date": d, "hrv": h.get("lastNightAvg"), "hrv_7d": h.get("weeklyAvg"), "rhr": ed.rhr_of(d)})
    for x, avg in zip(rows, formulas.rolling_mean([x["rhr"] for x in rows])):
        x["rhr_7d"] = avg
    return rows[-n:]


def _last_night() -> dict | None:
    """The latest night with a recording: this morning's, or — until it syncs — the one before."""
    for back in (0, 1):
        n = hypnogram((TODAY() - dt.timedelta(days=back)).isoformat())
        if n:
            return n
    return None


def _gym_day_plan(A, key: str, gym: list) -> dict:
    """One program day as the week card plans it: the Plan screen's time estimate (the same rows and
    _est_s as the program view), its prescribed sets (the core block's too — the watch logs them), and
    the kilos it moved the last time it was done (tonnage_of, the export's), never a computed guess."""
    import build_workouts as bw
    ed = _ed()
    lead = (bw.LEAD.get(key) or {}).get("block", [])
    rows = [(ex, bw.CORE_REST_SECS) for ex in lead]
    rows += [(ex, bw.SET_REST_BY_ID.get(ex[0], bw.SET_REST_SECS)) for ex in A.program.PROGRAM[key]["exercises"]]
    last = next((s for s in gym if s.day == key), None)
    return {"min": round(sum(_est_s(ex, rest, len(bw.WARMUPS.get(ex[0], []))) for ex, rest in rows) / 60),
            "min_source": "program", "sets": sum(ex[4] for ex, _ in rows),
            "tonnage": round(ed.tonnage_of(last.id)) if last else None, "tonnage_from": last.date if last else None}


def _week_plan(A, start: str, end: str, acts: list) -> dict:
    """Every session still planned from `start` to `end`, by date: Garmin's calendar and plan.json
    (_planned), each with its minutes — a gym day's program estimate, a watch workout's own estimate,
    plan.json's `duration_min`, else the athlete's typical time for that sport (the median of their
    last five), marked so the card can say ≈. A session counts as done once its day logged that sport."""
    import strength_sessions as ss
    ed = _ed()
    names = ss.workout_names()
    managed = {v: k for k, v in _workout_names(A).items()}
    gym = sorted(ss.sessions((TODAY() - dt.timedelta(weeks=8)).isoformat()), key=lambda s: s.start, reverse=True)
    logged = {(a["startTimeLocal"][:10], sports.badge((a.get("activityType") or {}).get("typeKey"))["icon"]) for a in acts}
    typical: dict = defaultdict(list)
    for a in sorted(acts, key=lambda a: a["startTimeLocal"], reverse=True):
        typical[sports.badge((a.get("activityType") or {}).get("typeKey"))["icon"]].append((a.get("duration") or 0) / 60)

    def item(date: str, title: str, tk: str, key: str | None, minutes: int | None, done: bool, badge=None) -> dict:
        b = badge or sports.badge(tk)
        out = {"date": date, "title": title, **b, "group": sports.group(tk), "done": done,
               "min": minutes, "min_source": "plan" if minutes else None}
        if key in A.program.PROGRAM:
            out |= _gym_day_plan(A, key, gym)
        elif key and minutes is None and (A.workouts_dir / f"{key}.json").exists():
            w = json.loads((A.workouts_dir / f"{key}.json").read_text())
            if w.get("estimatedDurationInSecs"):
                out |= {"min": round(w["estimatedDurationInSecs"] / 60), "min_source": "workout"}
        if out["min"] is None and typical.get(b["icon"]):
            xs = sorted(typical[b["icon"]][:5])
            out |= {"min": round(xs[len(xs) // 2]), "min_source": "typical"}
        return out

    out = []
    for i in _scheduled(A):
        d, title = i.get("date") or "", (i.get("title") or "").strip()
        if start <= d <= end:
            tk = i.get("sportTypeKey")
            out.append(item(d, title, tk, names.get(title) or managed.get(title), None,
                            bool(i.get("associatedActivityId")) or (d, sports.badge(tk)["icon"]) in logged))
    for p in _planned(A, start, end):
        out.append(item(p["date"], p["title"], p["sport"], p.get("workout"), p.get("duration_min"), p["done"], p["badge"]))
    return {"sessions": sorted(out, key=lambda x: x["date"])}


def _week_compare(A) -> dict:
    """This week against last, like for like (R6; handoff 2026-10-25, WEEK-DATA.md): the comparison
    runs to the last FINISHED day — today once it logged something and nothing it planned is left,
    else yesterday — against last week to the same day; last week's full total travels as context,
    never as the comparison. Per day, what was done (by kind, with the sports) and what is still
    planned (_week_plan). Training totals run to `cut`; sleep and recovery to today (last night is
    over). Nothing here is a new definition: tonnage and sets are the export's, recovery is
    recovery_on(), sleep and its need are Garmin's, cardio load is Garmin's and never the lifting's."""
    ed = _ed()
    end = TODAY()
    mon = end - dt.timedelta(days=end.weekday())
    today_i = end.weekday()
    acts = ed.all_activities()
    by_day = defaultdict(list)
    for a in acts:
        by_day[a["startTimeLocal"][:10]].append(a)
    plan = _week_plan(A, end.isoformat(), (mon + dt.timedelta(days=6)).isoformat(), acts)["sessions"]

    def week(start: dt.date) -> list:
        days = []
        for i in range(7):
            d = start + dt.timedelta(days=i)
            ds = d.isoformat()
            mins, done = defaultdict(float), []
            for a in sorted(by_day.get(ds, []), key=lambda x: x["startTimeLocal"]):
                tk = (a.get("activityType") or {}).get("typeKey")
                b = sports.badge(tk)
                m = (a.get("duration") or 0) / 60
                mins[b["kind"]] += m
                x = {**b, "title": a.get("activityName") or b["sport"], "min": round(m), "group": sports.group(tk),
                     "km": round((a.get("distance") or 0) / 1000, 1) if b["kind"] == "endurance" else None,
                     "load": a.get("activityTrainingLoad") or 0}
                if b["kind"] == "strength":
                    x |= {"tonnage": ed.tonnage_of(a["activityId"]),
                          "sets": sum(1 for s in ed.strip_warmups(ed.sets_of(a["activityId"])) if ed.is_logged_work(s))}
                done.append(x)
            sleep = rec = need = None
            if d <= end:
                dto = (ed.load(f"{ds}_sleep.json") or {}).get("dailySleepDTO") or {}
                sleep = round(dto["sleepTimeSeconds"] / 3600, 2) if dto.get("sleepTimeSeconds") else None
                need = round(dto["sleepNeed"]["actual"] / 60, 2) if (dto.get("sleepNeed") or {}).get("actual") else None
                rec = ed.recovery_on(ds)["score"]
            days.append({"date": ds, "dow": d.strftime("%a"), "minutes": {k: round(v) for k, v in mins.items()},
                         "sports": done, "sleep_h": sleep, "sleep_need_h": need, "recovery": rec,
                         "planned": [p for p in plan if p["date"] == ds and not p["done"]]})
        return days

    mean = lambda xs: round(sum(xs) / len(xs), 2) if xs else None  # noqa: E731

    def total(days: list, upto: int, frm: int = 0) -> dict:
        xs = [x for d in days[frm:upto + 1] for x in d["sports"]]
        km = defaultdict(float)
        for x in xs:
            if x["km"]:
                km[x["group"]] += x["km"]
        nights = days[:max(upto, today_i) + 1] if frm == 0 else []
        return {"minutes": sum(x["min"] for x in xs), "sessions": len(xs),
                "tonnage": round(sum(x.get("tonnage") or 0 for x in xs)), "sets": sum(x.get("sets") or 0 for x in xs),
                "cardio_load": round(sum(x["load"] for x in xs if x["kind"] != "strength")),
                "km": round(sum(km.values()), 1), "km_by": {g: round(v, 1) for g, v in km.items()},
                "sleep_h": mean([d["sleep_h"] for d in nights if d["sleep_h"] is not None]),
                "recovery": mean([d["recovery"] for d in nights if d["recovery"] is not None])}

    this, last = week(mon), week(mon - dt.timedelta(days=7))
    cut = today_i if this[today_i]["sports"] and not this[today_i]["planned"] else today_i - 1
    ahead = [p for d in this[today_i:] for p in d["planned"]]
    targets = getattr(A.program, "WEEK_TARGETS", None) or {}
    needs = [d["sleep_need_h"] for d in this[:today_i + 1] if d["sleep_need_h"]]
    return {
        "today_index": today_i, "cut": cut,
        "this": {"days": this, "to_date": total(this, cut),
                 # done after the cut (today, while some of it is still planned) — counted in the projection
                 "since": total(this, today_i, cut + 1) if cut < today_i else None,
                 "planned": {"sessions": len(ahead), "minutes": sum(p["min"] or 0 for p in ahead),
                             "sets": sum(p.get("sets") or 0 for p in ahead),
                             "tonnage": sum(p.get("tonnage") or 0 for p in ahead),
                             "untimed": sum(1 for p in ahead if p["min"] is None),
                             "today_only": all(p["date"] == end.isoformat() for p in ahead)}},
        "last": {"days": last, "to_date": total(last, cut), "full": total(last, 6)},
        "targets": {"minutes": targets.get("minutes"), "sets": targets.get("sets"),
                    "cardio_load": (A.profile.get("cardio_targets") or {}).get("cardio_load"),
                    "sleep_need_h": mean(needs)},
    }


# --- views -------------------------------------------------------------------------------------
VIEWS: dict = {}


def view(name):
    def deco(fn):
        VIEWS[name] = fn
        return fn
    return deco


@view("today")
def v_today(A) -> dict:
    import progression_report as pr
    import prescription_audit as pa
    import rotation_status as rs
    import strength_sessions as ss
    dash = _dashboard(A)
    today = dash.get("today") or {}
    plan = today.get("plan") or {}
    names = ss.workout_names()
    plan_day = names.get((plan.get("name") or "").strip())
    as_of, warnings = ss.cache_status()
    daily = _latest_daily(A)
    ed = _ed()
    monday = (TODAY() - dt.timedelta(days=TODAY().weekday())).isoformat()
    sunday = (TODAY() + dt.timedelta(days=6 - TODAY().weekday())).isoformat()
    week_strength = [w for w in dash.get("workouts", []) if w.get("kind") == "strength" and w.get("date", "") >= monday]
    sched = [{"date": i.get("date"), "title": i.get("title"), "workout_id": i.get("workoutId"),
              "sport": i.get("sportTypeKey"), "badge": sports.badge(i.get("sportTypeKey")),
              "done": bool(i.get("associatedActivityId")),
              "day": names.get((i.get("title") or "").strip())}
             for i in _scheduled(A) if monday <= (i.get("date") or "") <= sunday]
    trends = dash.get("trends") or {}
    return {
        "today": today,
        "scheduled": sched,
        "planned": _planned(A, monday, sunday),
        "week_strength": {"sessions": len(week_strength), "tonnage": sum(w.get("tonnage") or 0 for w in week_strength),
                          "sets": sum(w.get("sets") or 0 for w in week_strength),
                          "reps": sum(w.get("reps") or 0 for w in week_strength)},
        "trends": {"sleep": trends.get("sleep"), "recovery": trends.get("recovery")}, "night": dash.get("night"), "body": dash.get("body"), "spark": dash.get("spark"),
        "week": dash.get("week"),
        "plan_today": {**plan, "day": plan_day,
                       "program": _program_day_view(A, plan_day, A.program.PROGRAM[plan_day]) if plan_day else None},
        # The Last session card (handoff 2026-10-23): one tab per session of the last training day;
        # each tab reads the session's own workout view.
        "last_day": _last_day(),
        # What was logged today, whatever the calendar says: Garmin only links an activity to its
        # scheduled workout when it was started from that entry, so plan_today.done misses the rest.
        "trained_today": _trained_today(),
        # R2 R3 R6 (docs/DESIGN.md (app audit) round 2): the 7-day trends, last night's stages, the week against last.
        "vitals": _hrv_rhr(30),
        "last_night": _last_night(),
        "week_compare": _week_compare(A),
        "daily": daily,
        # The program day the coach's call names (docs/DESIGN.md (app audit) H2): the hero shows THIS under the
        # call — never the calendar's day, which can differ (the calendar holds what was pushed; the
        # call is today's decision). Null without a call for today, or when the call names no day.
        "call_program": _call_program(A, daily),
        "rotation": rs.rotation(),
        "bumps": pr.bump_rows(ss.sessions(SINCE), pa.load_history(), ss.pair_days()),
        "sync": sync_status(A),
        "cardio": cardio_targets(A, dash),
        "block": block(A),
        "race": _race_today(A),
        # docs/DESIGN.md (fuelling and score) §6.2: the setup still open, and the rides and runs that ask to be logged.
        "fuel": _today_fuel(A),
        "freshness": {"data_as_of": dash.get("generatedAt"), "cache": as_of, "warnings": warnings,
                      "coach_ran": (daily or {}).get("generated_at")},
        "defs": defs("recovery", "strain", "sleep_performance", "hrv", "hrv_band", "hrv_weekly", "rhr", "rhr_baseline",
                     "rhr_7d", "readiness", "fitness", "fatigue", "form", "load", "tonnage", "weight", "bump",
                     "starved", "watch_sync", "week_like_for_like", "week_planned", "week_target", "sleep_need",
                     "race_countdown", "race_easy", "race_taper", "race_day", "race_recovery",
                     "fuel_band", "fuel_target", "fuel_gut", "fuel_taken"),
    }


@view("recovery")
def v_recovery(A) -> dict:
    ed = _ed()
    dash = _dashboard(A)
    end = TODAY()
    days = [(end - dt.timedelta(days=i)).isoformat() for i in range(59, -1, -1)]
    series = []
    for d in days:
        h = (ed.load(f"{d}_hrv.json") or {}).get("hrvSummary") or {}
        base = h.get("baseline") or {}
        raw = ed.load(f"{d}_sleep.json") or {}
        s = raw.get("dailySleepDTO") or {}
        r = ed.readiness_of(d) or {}
        hr_sleep = [x["value"] for x in raw.get("sleepHeartRate") or [] if x.get("value")]
        series.append({
            "date": d, "hrv": h.get("lastNightAvg"), "hrv_7d": h.get("weeklyAvg"), "hrv_low": base.get("balancedLow"),
            "hrv_high": base.get("balancedUpper"), "hrv_status": h.get("status"), "rhr": ed.rhr_of(d),
            "readiness": r.get("score"),
            "sleep_h": round(s["sleepTimeSeconds"] / 3600, 2) if s.get("sleepTimeSeconds") else None,
            "need_h": round((s.get("sleepNeed") or {}).get("actual") / 60, 2) if (s.get("sleepNeed") or {}).get("actual") else None,
            "sleep_score": ((s.get("sleepScores") or {}).get("overall") or {}).get("value"),
            "deep_min": round((s.get("deepSleepSeconds") or 0) / 60), "rem_min": round((s.get("remSleepSeconds") or 0) / 60),
            "light_min": round((s.get("lightSleepSeconds") or 0) / 60), "awake_min": round((s.get("awakeSleepSeconds") or 0) / 60),
            # Overnight vitals (R10) — the export's own fields for last night, for every night.
            "resp": s.get("averageRespirationValue"), "spo2": s.get("averageSpO2Value"),
            "skin_dev": raw.get("avgSkinTempDeviationC"), "hr_low": min(hr_sleep) if hr_sleep else None,
        })
    calendar = [ed.recovery_on(d) for d in days[-35:]]
    # 30 nights: the night picker's range (R9); each night's "usual" is the 14 before it (NightCard).
    nights = [h for h in (hypnogram(d) for d in days[-30:]) if h]
    # Trends: Garmin's own 7-night HRV average (what its status compares to the band), and a
    # computed 7-day resting-HR mean — no Garmin equivalent.
    import formulas
    for x, avg in zip(series, formulas.rolling_mean([x["rhr"] for x in series])):
        x["rhr_7d"] = avg
    # The mini plots' trend lines (his ask, 2026-10-12): the same 7-day mean for each overnight vital
    # and for each recovery-score signal, so a single odd night reads against its week.
    for k in ("resp", "hr_low", "spo2", "skin_dev"):
        for x, avg in zip(series, formulas.rolling_mean([x[k] for x in series])):
            x[f"{k}_7d"] = avg
    for label in {c["label"] for d in calendar for c in d.get("components") or []}:
        comp = [next((c for c in d.get("components") or [] if c["label"] == label), None) for d in calendar]
        for c, avg in zip(comp, formulas.rolling_mean([c and c.get("value") for c in comp])):
            if c:
                c["value_7d"] = avg
    # Each night's usual: the mean over the 29 nights before it — the export's respiration baseline
    # (its 30-day window minus the night itself), so last night's matches the brief's (a test holds it).
    for k in ("resp", "hr_low"):
        for i, x in enumerate(series):
            prior = [y[k] for y in series[max(0, i - 29):i] if y[k]]
            x[f"{k}_base"] = round(sum(prior) / len(prior), 1) if prior else None
    nights_with_hrv = sum(1 for x in series[-30:] if x["hrv"])
    return {"series": series, "calendar": calendar, "night": dash.get("night"), "nights": nights,
            "baselines": {"hrv": (dash.get("today") or {}).get("hrv"), "rhr": (dash.get("today") or {}).get("rhr")},
            "calibrating": {"nights_with_hrv": nights_with_hrv, "needed": 7, "ready": nights_with_hrv >= 7},
            "weights": [{"label": l, "weight": w} for l, w in ed.RECOVERY_WEIGHTS],
            "defs": defs("recovery", "hrv", "hrv_band", "hrv_weekly", "rhr", "rhr_baseline", "rhr_7d", "trend_7d", "readiness",
                         "sleep_performance", "sleep_score", "sleep_restorative", "sleep_efficiency", "awakenings")}


# Garmin's sleepLevels.activityLevel → stage. A code table is a lookup keyed on identity (CLAUDE.md
# #1), so it is proven, not trusted: hypnogram() reports how far the timeline's per-stage totals sit
# from Garmin's own (dailySleepDTO), and tests/run_tests.py holds every cached night to it.
SLEEP_STAGE = {0: "deep", 1: "light", 2: "rem", 3: "awake"}
DTO_SECONDS = {"deep": "deepSleepSeconds", "light": "lightSleepSeconds", "rem": "remSleepSeconds", "awake": "awakeSleepSeconds"}


def _gmt_ms(s) -> int | None:
    """Garmin's GMT times, in epoch ms: sleepLevels sends ISO strings, sleepHeartRate epoch ms."""
    if isinstance(s, (int, float)):
        return int(s)
    if not s:
        return None
    return int(dt.datetime.fromisoformat(str(s)[:19]).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


def hypnogram(day: str) -> dict | None:
    """The night ending on `day`: its numbers (export.sleep_metrics — the brief's own definitions —
    plus Garmin's score, sleeping heart rate, awakenings, respiration, overnight HRV, body battery)
    and, when the watch staged it, the stage timeline: segments in minutes from falling asleep, local
    clock times, heart rate across the night, per-stage totals, and `mismatch_min` — the largest gap
    between the timeline's totals and Garmin's own per stage (the code table's proof)."""
    ed = _ed()
    raw = ed.load(f"{day}_sleep.json") or {}
    dto = raw.get("dailySleepDTO") or {}
    if not dto.get("sleepTimeSeconds"):
        return None
    sm = ed.sleep_metrics(dto)
    start_g, start_l, end_g = dto.get("sleepStartTimestampGMT"), dto.get("sleepStartTimestampLocal"), dto.get("sleepEndTimestampGMT")
    t0 = start_g
    mins = lambda ms: round((ms - t0) / 60000, 1)  # noqa: E731
    clock_l = lambda ms: dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%H:%M") if ms else None  # noqa: E731
    hr_all = [x["value"] for x in raw.get("sleepHeartRate") or [] if x.get("value")]
    out = {"date": day, "start": clock_l(start_l), "end": clock_l(dto.get("sleepEndTimestampLocal")), **sm,
           "score": ((dto.get("sleepScores") or {}).get("overall") or {}).get("value"),
           "hr_low": min(hr_all) if hr_all else None, "hr_avg": round(sum(hr_all) / len(hr_all)) if hr_all else None,
           "respiration": dto.get("averageRespirationValue"), "hrv_avg": raw.get("avgOvernightHrv"),
           "body_battery_change": raw.get("bodyBatteryChange"), "resting_hr": raw.get("restingHeartRate"),
           "segments": [], "hr": [], "totals_min": None, "awakenings": None, "mismatch_min": None}
    levels = raw.get("sleepLevels") or []
    if not levels or not start_g or not end_g or start_l is None:
        return out
    offset = start_l - start_g                      # local = GMT + offset (ms), for the clock labels
    segs, totals = [], {k: 0.0 for k in DTO_SECONDS}
    for lv in levels:
        a, b, code = _gmt_ms(lv.get("startGMT")), _gmt_ms(lv.get("endGMT")), lv.get("activityLevel")
        stage = SLEEP_STAGE.get(int(code)) if code is not None else None
        if a is None or b is None or stage is None or b <= a:
            continue
        segs.append([mins(a), mins(b), stage])
        totals[stage] += (b - a) / 60000
    hr = [[mins(_gmt_ms(x["startGMT"])), x["value"]] for x in raw.get("sleepHeartRate") or []
          if x.get("value") and _gmt_ms(x.get("startGMT")) is not None]
    clock = lambda ms: dt.datetime.fromtimestamp((ms + offset) / 1000, dt.timezone.utc).strftime("%H:%M")  # noqa: E731
    mismatch = max(abs(totals[k] - (dto.get(f) or 0) / 60) for k, f in DTO_SECONDS.items())
    return out | {"start": clock(start_g), "end": clock(end_g), "length_min": mins(end_g),
                  "segments": segs, "hr": hr[:: max(1, len(hr) // 240)],
                  "totals_min": {k: round(v) for k, v in totals.items()},
                  # A waking the watch staged, inside the night — not the minutes after the alarm.
                  "awakenings": sum(1 for a, b, st in segs[:-1] if st == "awake"),
                  "mismatch_min": round(mismatch, 1)}


@view("load")
def v_load(A) -> dict:
    ed = _ed()
    dash = _dashboard(A)
    acts = ed.all_activities()
    by_day = defaultdict(float)
    for a in acts:
        by_day[a["startTimeLocal"][:10]] += a.get("activityTrainingLoad") or 0
    model = [{"date": p["iso"], "fitness": p["ctl"], "fatigue": p["atl"], "form": p["tsb"]}
             for p in ed.fitness_model(acts, by_day, TODAY())[-90:]]
    weeks = defaultdict(lambda: {"cardio": defaultdict(float), "strength_load": 0.0, "tonnage": 0, "sets": 0,
                                 "minutes": defaultdict(float), "sports": defaultdict(float), "sport_kind": {}, "sessions": 0, "km": 0.0})
    tonnage_by_day = defaultdict(int)
    for a in acts:
        day, grp = a["startTimeLocal"][:10], _sid_group(a)
        wk = weeks[_iso_week(day)]
        # Time is the one measure every sport shares (R11): minutes by kind and by sport.
        b = sports.badge((a.get("activityType") or {}).get("typeKey"))
        wk["minutes"][b["kind"]] += (a.get("duration") or 0) / 60
        wk["sports"][b["sport"]] += (a.get("duration") or 0) / 60
        wk["sport_kind"][b["sport"]] = b["kind"]
        wk["sessions"] += 1
        if b["kind"] == "endurance":
            wk["km"] += (a.get("distance") or 0) / 1000
        if grp == "strength":
            t = ed.tonnage_of(a["activityId"])
            wk["strength_load"] += a.get("activityTrainingLoad") or 0
            wk["tonnage"] += t
            wk["sets"] += sum(1 for s in ed.strip_warmups(ed.sets_of(a["activityId"])) if ed.is_logged_work(s))
            tonnage_by_day[day] += t
        else:
            # Cardio load by bucket: rides, runs, swims, multisport; circuits and other sports apart
            # from "other" (tennis is not a circuit — R5).
            bucket = grp if grp in ("run", "bike", "swim", "race") else b["kind"]
            wk["cardio"][bucket] += a.get("activityTrainingLoad") or 0
    # Every week of the last twelve, empty ones included: a missing week is a week of rest, not a gap.
    this_monday = TODAY() - dt.timedelta(days=TODAY().weekday())
    last12 = [_iso_week((this_monday - dt.timedelta(weeks=i)).isoformat()) for i in range(11, -1, -1)]

    def tonnage_between(a_: dt.date, b_: dt.date) -> int:
        return sum(v for d, v in tonnage_by_day.items() if a_ <= dt.date.fromisoformat(d) <= b_)

    # A ratio needs a whole 28-day chronic window of history: three weeks in, a new athlete's first
    # weeks would read as a 4.0 spike and then "detraining". No ratio until the window is full.
    first = min((dt.date.fromisoformat(a["startTimeLocal"][:10]) for a in acts), default=TODAY())
    acwr_strength = []
    for wkey in last12:
        y, w = wkey.split("-W")
        end = min(dt.date.fromisocalendar(int(y), int(w), 7), TODAY())   # this week: the last 7 days, not a half week
        acute = tonnage_between(end - dt.timedelta(days=6), end)
        chronic = tonnage_between(end - dt.timedelta(days=27), end) / 4
        full = end - dt.timedelta(days=27) >= first
        acwr_strength.append({"week": wkey, "end": end.isoformat(),
                              "ratio": round(acute / chronic, 2) if chronic and full else None})
    t = dash.get("today") or {}
    return {"model": model,
            "weeks": [{"week": k, "monday": dt.date.fromisocalendar(int(k[:4]), int(k[6:]), 1).isoformat(),
                       "cardio": {g: round(v) for g, v in weeks[k]["cardio"].items()},
                       "cardio_total": round(sum(weeks[k]["cardio"].values())),
                       "strength_load": round(weeks[k]["strength_load"]), "tonnage": weeks[k]["tonnage"],
                       "sets": weeks[k]["sets"], "sessions": weeks[k]["sessions"], "km": round(weeks[k]["km"], 1),
                       "minutes": {g: round(v) for g, v in weeks[k]["minutes"].items()},
                       "sports": {g: round(v) for g, v in sorted(weeks[k]["sports"].items(), key=lambda x: -x[1])},
                       "sport_kind": weeks[k]["sport_kind"]}
                      for k in last12],
            # This week is partial: how many of its days have happened (Monday = 1).
            "days_so_far": TODAY().weekday() + 1,
            "acwr": {"cardio": t.get("acwr"), "strength": acwr_strength, "safe": [0.8, 1.3]},
            "status": t.get("loadStatus"), "vo2": t.get("vo2"), "week": dash.get("week"),
            "cardio": cardio_targets(A, dash),
            "defs": defs("load", "fitness", "fatigue", "form", "acwr_cardio", "acwr_strength", "tonnage")}


@view("strength")
def v_strength(A) -> dict:
    ed = _ed()
    import progression_report as pr
    import prescription_audit as pa
    import strength_sessions as ss
    dash = _dashboard(A)
    weekly = defaultdict(lambda: {"tonnage": 0, "sets": 0})
    for a in ed.all_activities():
        if _sid_group(a) != "strength":
            continue
        wk = weekly[_iso_week(a["startTimeLocal"][:10])]
        wk["tonnage"] += ed.tonnage_of(a["activityId"])
        wk["sets"] += sum(1 for s in ed.strip_warmups(ed.sets_of(a["activityId"])) if ed.is_logged_work(s))
    deload = {_iso_week(d) for d, v in ss.ANNOTATIONS.items() if v.get("type") == "deload"}
    s = dash.get("strength") or {}
    return {"key_lifts": s.get("progression"), "prs": s.get("prs"), "volume": s.get("executedVolume"),
            "weekly": [{"week": k, **weekly[k], "deload": k in deload} for k in sorted(weekly)[-16:]],
            # Each lift carries the muscle the "Sets per muscle" chart counts it under (muscle_of: the
            # pair wins over the category) and its last session's date — the app groups by these and
            # never keeps a muscle map of its own.
            "lifts": [{**r, "muscle": ed.muscle_of(r["category"], r["name"]),
                       "last": r["points"][-1]["date"] if r["points"] else None} for r in pr.lift_rows(SINCE)],
            "muscles": [*ed.MUSCLE_ORDER, ed.ATHLETIC, ed.UNATTRIBUTED],   # the groups' order, Unattributed last
            "bumps": pr.bump_rows(ss.sessions(SINCE), pa.load_history(), ss.pair_days()),
            "classes": pr.CLASS_DEFINITIONS,
            "defs": defs("e1rm", "tonnage", "sets_per_muscle", "progression", "bump")}


@view("sessions")
def v_sessions(A) -> dict:
    ed = _ed()
    import fuel
    import strength_sessions as ss
    fuel_cfg = fuel.load_cfg(A)
    fuel_log = {r["activity_id"]: r for r in fuel.load_log(A)["records"]}
    out = []
    for a in ed.all_activities():
        grp = _sid_group(a)
        row = {"id": a["activityId"], "date": a["startTimeLocal"][:10], "start": a["startTimeLocal"],
               "group": grp, **sports.badge((a.get("activityType") or {}).get("typeKey")),
               "title": a.get("activityName") or grp, "duration_min": round((a.get("duration") or 0) / 60),
               "load": round(a.get("activityTrainingLoad") or 0), "avg_hr": a.get("averageHR"),
               "max_hr": a.get("maxHR"), "distance_km": round((a.get("distance") or 0) / 1000, 2) or None,
               "calories": a.get("calories")}
        if grp == "strength":
            sets = ed.sets_of(a["activityId"])
            keys = {ss.pair(x) for x in sets} - {(None, None)}
            row.update(day=ss.attribute(row["title"], keys), tonnage=ed.tonnage_of(a["activityId"]),
                       sets=sum(1 for s in ed.strip_warmups(sets) if ed.is_logged_work(s)), has_sets=(A.data_dir / f"activity_{a['activityId']}_sets.json").exists())
        # Fuel (docs/DESIGN.md (fuelling and score) §6.3): what was taken, per hour, and whether it still asks to be logged.
        rec = fuel_log.get(a["activityId"])
        if rec:
            s = fuel.summary(rec, a)
            row.update(fuel_g=s["g"], fuel_g_h=s["g_h"])
        row["fuel_due"] = fuel.is_due(a, grp, fuel_cfg, rec is not None)
        # The score (docs/DESIGN.md (fuelling and score) §6.3): every row of a sport it has a rule for.
        row["score"] = _score_cell(_score(a))
        out.append(row)
    return {"sessions": out, "defs": defs("load", "tonnage", "fuel_taken", "score")}


SUMMARY_KEYS = ("duration", "movingDuration", "elapsedDuration", "distance", "averageSpeed", "maxSpeed",
                "averageHR", "maxHR", "calories", "activityTrainingLoad", "aerobicTrainingEffect",
                "anaerobicTrainingEffect", "trainingEffectLabel", "elevationGain", "elevationLoss",
                "poolLength", "activeLengths", "averageSwolf", "averageSwimCadenceInStrokesPerMinute",
                "strokes", "totalSets", "activeSets", "totalReps", "vO2MaxValue", "lapCount",
                "hrTimeInZone_1", "hrTimeInZone_2", "hrTimeInZone_3", "hrTimeInZone_4", "hrTimeInZone_5")


LAP_KEYS = ("distance", "duration", "movingDuration", "averageHR", "maxHR", "averageSpeed", "maxSpeed",
            "elevationGain", "elevationLoss", "averagePower", "maxPower", "normalizedPower", "strideLength",
            "lengthDTOs")
# Garmin names cadence differently per sport and per payload (laps vs summary). The first present wins;
# a ride's is rpm, a run's steps per minute. activity_fields.py reports which ones an athlete has.
CADENCE_KEYS = ("averageBikeCadence", "averageBikingCadenceInRevPerMinute", "averageRunCadence",
                "averageRunningCadenceInStepsPerMinute")


def _lap(lap: dict) -> dict:
    out = {k: lap[k] for k in LAP_KEYS if lap.get(k) is not None}
    cad = next((lap[k] for k in CADENCE_KEYS if lap.get(k) is not None), None)
    if cad is not None:
        out["cadence"] = round(cad)
    return out


def _annotation_for(ann: dict | None, a: dict) -> dict | None:
    import re
    if not ann or sports.kind((a.get("activityType") or {}).get("typeKey")) not in ("strength", "circuit"):
        return None
    named = {int(x) for x in re.findall(r"activity (\d{8,})", ann.get("note") or "")}
    return ann if not named or a["activityId"] in named else None


@view("workout")
def v_workout(A, activity_id: str) -> dict:
    ed = _ed()
    import formulas
    import prescription_audit as pa
    import strength_sessions as ss
    aid = int(activity_id)
    a = next((x for x in ed.all_activities() if x.get("activityId") == aid), None)
    if a is None:
        sys.exit(f"no activity {aid} in the cache")
    grp = _sid_group(a)
    date = a["startTimeLocal"][:10]
    out = {"id": aid, "date": date, "start": a["startTimeLocal"], "group": grp,
           **sports.badge((a.get("activityType") or {}).get("typeKey")), "title": a.get("activityName") or grp,
           "summary": {k: a[k] for k in SUMMARY_KEYS if a.get(k) is not None},
           # An annotation is about a day's logged SETS: it belongs to that day's gym or circuit
           # session, never to the ride or tennis of the same date (app audit 2026-11-10: the 11-07
           # gravel ride showed the note about seated lateral raises). One that names an activity
           # belongs to that activity only.
           "annotation": _annotation_for(ss.ANNOTATIONS.get(date), a),
           "reviews": _reviews_for(A, date, aid, grp),
           "fuel": _workout_fuel(A, a, grp),
           "score": _score(a)}

    details = ed.load(f"activity_{aid}_details.json")
    if details:
        out["hr"] = _hr_series(details)
    splits = ed.load(f"activity_{aid}_splits.json")
    if splits:
        out["laps"] = [_lap(lap) for lap in (splits.get("lapDTOs") or [])]
    if grp in ("bike", "run"):
        import endurance_metrics as em   # docs/DESIGN.md (rides and runs): the same numbers the review cites
        out["endurance"] = em.analyse(aid)
    import session_review   # a pool swim or a circuit against the workout it followed
    if session_review.kind_of((a.get("activityType") or {}).get("typeKey")):
        out["review"] = session_review.analyse(aid)
    if grp != "strength":
        raw_sets = (ed.load(f"activity_{aid}_sets.json") or {}).get("exerciseSets") or []
        if raw_sets:   # a Hyrox or HIIT session: its stations (docs/DESIGN.md (app audit) M3)
            out["stations"] = _stations(raw_sets)
        return out | {"defs": defs("load", "fuel_band", "fuel_target", "fuel_gut", "fuel_taken", *SCORE_DEFS)}

    raw = (ed.load(f"activity_{aid}_sets.json") or {}).get("exerciseSets") or []
    active = [s for s in raw if s.get("setType") == "ACTIVE"]
    working_ids = {id(s) for s in ed.strip_warmups(active)}
    keys = {ss.pair(s) for s in active} - {(None, None)}
    day = ss.attribute(out["title"], keys)
    best_before = _best_e1rm_before(date)
    history = pa.load_history()
    blocks, active_s, rest_s = [], 0.0, 0.0
    for i, s in enumerate(raw):
        if s.get("setType") != "ACTIVE":
            rest_s += s.get("duration") or 0
            continue
        active_s += s.get("duration") or 0
        key = ss.pair(s)
        rest_after = 0.0
        for nxt in raw[i + 1:]:
            if nxt.get("setType") == "ACTIVE":
                break
            rest_after += nxt.get("duration") or 0
        w = round((s.get("weight") or 0) / 1000, 2)
        r = s.get("repetitionCount") or 0
        per_hand = key in ed.TWO_DB
        per_side = key in ed.UNILATERAL
        machine = key in ed.MACHINE
        w_n, r_n = (w / 2 if per_hand else w), (r // 2 if per_side else r)
        e = round(formulas.e1rm(w_n, r_n), 1) if (w_n and r_n and not machine) else None
        prob = ((s.get("exercises") or [{}])[0]).get("probability")
        st = {"type": "working" if id(s) in working_ids else "warmup", "weight_logged": w, "reps_logged": r,
              "weight": w_n, "reps": r_n, "duration_s": round(s.get("duration") or 0),
              "rest_after_s": round(rest_after), "start": s.get("startTime"), "e1rm": e,
              "pr": bool(e and e > best_before.get(key, 0)),
              # The watch's own exercise recognition, when it was not confirmed — verify on real files.
              "auto_detected": prob is not None and prob < 100}
        if not blocks or blocks[-1]["key"] != list(key):
            muscle = ed.muscle_of(*key)
            blocks.append({"key": list(key), "label": ed.pretty(*key), "muscle": muscle,
                           # The watch named no exercise it knows: it can't be matched to the plan or counted.
                           "unnamed": muscle == ed.UNATTRIBUTED,
                           "per_hand": per_hand, "per_side": per_side, "machine": machine, "sets": []})
        blocks[-1]["sets"].append(st)
    # A PR is the session's FIRST set to beat the previous best — not every set that does.
    for b in blocks:
        best = max((x["e1rm"] or 0 for x in b["sets"] if x["pr"]), default=0)
        first = next((x for x in b["sets"] if x["pr"] and x["e1rm"] == best), None)
        for x in b["sets"]:
            x["pr"] = x is first
    # Per exercise: its last six sessions up to this one (top set, volume) and the signal it gave.
    import progression_report as pr
    history_by_key = defaultdict(list)
    for sess in ss.sessions(SINCE):
        if sess.date > date:
            continue
        for key_ in {ss.pair(x) for x in sess.sets}:
            rows = [x for x in sess.sets if ss.pair(x) == key_]
            ws = [((x.get("weight") or 0) / 1000) / (2 if key_ in ed.TWO_DB else 1) for x in rows]
            history_by_key[key_].append({"date": sess.date, "top": round(max(ws, default=0), 2),
                                         "volume": round(sum((x.get("weight") or 0) / 1000 * (x.get("repetitionCount") or 0) for x in rows))})
    bumps_today = {(b["category"], b["name"]) for b in pr.bump_rows(ss.sessions(SINCE), history, ss.pair_days())
                   if b["date"] == date}
    classes = {(r["category"], r["name"]): r["class"] for r in pr.lift_rows(SINCE)}
    for b in blocks:
        k = tuple(b["key"])
        b["history"] = history_by_key.get(k, [])[-6:]
        b["signal"] = "bump" if k in bumps_today else (classes.get(k) or "").lower() or None
    planned = None
    if day:
        spec = A.program.PROGRAM[day]
        planned = _program_day_view(A, day, spec)
        # The core block is prescribed too (program.py → LEAD), first in the session. Left out, every
        # core exercise on the page read "Planned —" and kept the watch's English name beside the
        # program's own (UX review 2026-11-10) — the core block invisible to one more reader.
        import build_workouts as bw
        ed_ = _ed()
        planned["exercises"] = [
            {"exid": e[0], "routine": e[1], "category": e[2], "name": e[3], "label": ed_.pretty(e[2], e[3]),
             "sets": e[4], "value": e[5], "weight": e[6], "rest_s": e[7], "kind": e[8], "phase": "core",
             "per_hand": (e[2], e[3]) in ed_.TWO_DB, "machine": (e[2], e[3]) in ed_.MACHINE}
            for e in (bw.LEAD.get(day) or {}).get("block", [])] + planned["exercises"]
        for ex in planned["exercises"]:
            ex["weight_then"] = _weight_at(history.get(f"{day}/{ex['exid']}"), date)
    # What each block was for — the plan's phase when it was planned; otherwise read from the lift
    # itself (core, athletic work as power, loaded work as strength). Unnamed blocks have none.
    planned_phase = {(e["category"], e["name"]): e["phase"] for e in (planned or {}).get("exercises", [])}
    for b in blocks:
        k = tuple(b["key"])
        b["phase"] = (planned_phase.get(k) or (None if b["unnamed"] else "core" if b["muscle"] == "Core"
                      else "power" if b["muscle"] == ed.ATHLETIC
                      else "strength" if any(x["weight"] for x in b["sets"]) else "functional"))
    muscles = defaultdict(int)
    for b in blocks:
        muscles[b["muscle"]] += sum(1 for x in b["sets"] if x["type"] == "working")
    weekly_plan = defaultdict(int)
    for spec in A.program.PROGRAM.values():
        for e in spec["exercises"]:
            weekly_plan[ed.muscle_of(e[2], e[3])] += e[4]
    return out | {
        "day": day, "planned": planned, "exercises": blocks,
        "active_s": round(active_s), "rest_s": round(rest_s),
        "tonnage": ed.tonnage_of(aid),
        "muscles": [{"muscle": m, "sets": n, "planned_week": weekly_plan.get(m, 0)} for m, n in muscles.items()],
        "defs": defs("e1rm", "tonnage", "load", "fuel_band", "fuel_target", "fuel_gut", "fuel_taken", *SCORE_DEFS),
    }


SCORE_DEFS = ("score", *(f"score_{k}" for k in ("sets", "reps", "load", "rest", "intent", "intervals", "duration", "pacing", "fuel",
                                                "distance", "swims", "swim_pacing", "steps", "structure", "circuit_pacing")))


def _score(a: dict) -> dict | None:
    """The execution score for one activity, from scripts/session_score.py — the only place it is
    computed. None for the sports it has no rule for; a failure is reported, never a page that won't open."""
    import session_score as sc
    try:
        return sc.score_activity(a)
    except Exception as e:   # noqa: BLE001 — one bad session must not take the page down
        print(f"score for {a.get('activityId')} failed: {e!r}", file=sys.stderr)
        return {**sc.excluded(f"The score could not be computed: {e}"), "error": True}


def _score_cell(sc: dict | None) -> dict | None:
    """What a list row or calendar cell shows: the number, its band and the badge's second line."""
    if not sc:
        return None
    return {"total": sc["total"], "band": sc["band"], "band_label": sc["band_label"], "headline": sc.get("headline"),
            "excluded": sc.get("excluded"), "provisional": sc.get("provisional", False)}


def _workout_fuel(A, a: dict, grp: str) -> dict:
    """The workout page's Fuel card (docs/DESIGN.md (fuelling and score) §6.1): what was planned for this session — the
    plan.json session that day, of this sport, naming its intent — what was taken, and what the log
    form offers. Every gram comes from scripts/fuel.py; the page computes none."""
    import fuel
    cfg, cat = fuel.load_cfg(A), fuel.catalog()
    rec = next((r for r in fuel.load_log(A)["records"] if r["activity_id"] == a["activityId"]), None)
    date = a["startTimeLocal"][:10]
    sessions = (json.loads(A.plan_path.read_text()).get("sessions") or []) if A.plan_path.exists() else []
    planned = next((s for s in sessions if s.get("date") == date and sports.group(s.get("sport")) == grp
                    and fuel.for_session(s, cfg, cat)), None)
    secs = a.get("movingDuration") or a.get("duration") or 0
    return {"taken": fuel.describe(rec, a, cfg, cat) if rec else None,
            "plan": fuel.for_session(planned, cfg, cat) if planned else None,
            "planned_title": planned.get("title") if planned else None,
            "pantry": fuel.pantry(cfg, cat), "others": fuel.others(cfg, cat), "setup_open": fuel.setup_missing(cfg, cat),
            "due": fuel.is_due(a, grp, cfg, rec is not None), "minutes": round(secs / 60),
            # Nobody eats in the pool: a swim gets no Fuel card.
            "loggable": grp != "swim"}


def _today_fuel(A) -> dict:
    """Today's fuel: the setup questions still open, and the rides and runs of the last week that ask
    to be logged (scripts/fuel.py → is_due). Today's planned sessions carry their own plan (_planned)."""
    import fuel
    cfg, cat = fuel.load_cfg(A), fuel.catalog()
    logged = {r["activity_id"] for r in fuel.load_log(A)["records"]}
    since = (TODAY() - dt.timedelta(days=fuel.DUE_DAYS)).isoformat()
    due = []
    for a in _ed().all_activities():
        if a["startTimeLocal"][:10] < since:
            continue
        grp = _sid_group(a)
        if fuel.is_due(a, grp, cfg, a["activityId"] in logged):
            secs = a.get("movingDuration") or a.get("duration") or 0
            due.append({"id": a["activityId"], "date": a["startTimeLocal"][:10], "title": a.get("activityName") or grp,
                        "group": grp, "minutes": round(secs / 60), **sports.badge((a.get("activityType") or {}).get("typeKey"))})
    return {"setup_open": [{"id": q, "text": fuel.SETUP_TEXT[q]} for q in fuel.setup_missing(cfg, cat)],
            "due": sorted(due, key=lambda x: x["date"], reverse=True)}


@view("fuel")
def v_fuel(A) -> dict:
    """The fuel setup form (docs/DESIGN.md (fuelling and score) §6.7): the shared catalog, what this athlete owns, their
    recipes with the grams in a bottle, their answers, and which questions are still open."""
    import fuel
    cfg, cat = fuel.load_cfg(A), fuel.catalog()
    open_ = fuel.setup_missing(cfg, cat)
    return {"catalog": [{**p, "display": fuel.display("product", p["id"], cfg, cat)} for p in cat.values()], "products": cfg["products"],
            "recipes": [{**r, "g_each": fuel.recipe_grams(r, cat) if r.get("product") in cat else None}
                        for r in cfg["recipes"]],
            "gut": cfg.get("gut"), "caffeine": cfg.get("caffeine"), "notes": cfg.get("notes"),
            "questions": [{"id": q, "text": fuel.SETUP_TEXT[q], "open": q in open_,
                           "answered": (cfg.get("setup") or {}).get(q)} for q in fuel.SETUP],
            "caffeine_options": list(fuel.CAFFEINE), "gut_start": fuel.GUT_START_G_H,
            "pantry": fuel.pantry(cfg, cat),
            # The Fuel screen (board Fuel, 2026-11-07): today, to log, coming up, the gut ramp, the next A race.
            **_fuel_screen(A, cfg, cat),
            "defs": defs("fuel_band", "fuel_target", "fuel_gut", "fuel_taken")}


def _fuel_screen(A, cfg: dict, cat: dict) -> dict:
    import fuel
    today = TODAY().isoformat()
    plans = _planned(A, today, (TODAY() + dt.timedelta(days=14)).isoformat())
    sessions = (json.loads(A.plan_path.read_text()).get("sessions") or []) if A.plan_path.exists() else []
    due = _today_fuel(A)["due"]
    for d in due:   # the plan it is logged against, when that day's session named its intent
        s = next((x for x in sessions if x.get("date") == d["date"] and sports.group(x.get("sport")) == d["group"]
                  and fuel.for_session(x, cfg, cat)), None)
        d["plan"] = fuel.for_session(s, cfg, cat) if s else None
    acts = {a["activityId"]: {**a, "_group": _sid_group(a)} for a in _ed().all_activities()}
    import races as rc
    nxt = next((r for r in rc.load(A) if r.get("priority") == "A" and r.get("date", "") >= today), None)
    return {"today_plans": [p for p in plans if p["date"] == today and p.get("fuel")],
            "upcoming": [p for p in plans if p["date"] > today and (p.get("fuel") or p.get("intent") is None)],
            "to_log": due,
            "ramp": fuel.ramp(cfg, fuel.load_log(A), acts),
            "a_race": {"id": nxt["id"], "name": nxt["name"], "date": nxt["date"]} if nxt else None}


def _reviews_for(A, date: str, aid: int, grp: str) -> list:
    """The reviews of THIS session (docs/DESIGN.md (app audit) M4). A file naming an activity id
    (`<date>-<id>-review.md`, as endurance reviews are written) belongs to that activity only; a
    date-only review is a strength review, shown on that day's strength session."""
    if not A.logs_dir.exists():
        return []
    out = []
    for f in sorted(A.logs_dir.glob(f"{date}*.md")):
        if "review" not in f.name:
            continue
        ids = re.findall(r"\d{8,}", f.name[10:])
        if ids:
            if str(aid) in ids:
                out.append(f.name)
        elif grp == "strength":
            out.append(f.name)
    return out


def _best_e1rm_before(day: str) -> dict:
    """(category, name) -> best normalized e1RM in sessions strictly before `day` (for PR marks)."""
    ed = _ed()
    import formulas
    best = defaultdict(float)
    for f in ed.DATA.glob("activity_*_sets.json"):
        for s in (json.loads(f.read_text()).get("exerciseSets") or []):
            if s.get("setType") != "ACTIVE" or str(s.get("startTime"))[:10] >= day:
                continue
            ex = (s.get("exercises") or [{}])[0]
            key = (ex.get("category"), ex.get("name"))
            if key in ed.MACHINE:
                continue
            w, r = (s.get("weight") or 0) / 1000, s.get("repetitionCount") or 0
            w, r = (w / 2 if key in ed.TWO_DB else w), (r // 2 if key in ed.UNILATERAL else r)
            if w and r:
                best[key] = max(best[key], formulas.e1rm(w, r))
    return best


def _hr_series(details: dict, max_points: int = 400) -> list:
    """[(seconds from start, bpm)] from a Garmin activity-details payload, downsampled."""
    descs = {d.get("key"): d.get("metricsIndex") for d in details.get("metricDescriptors") or []}
    hr_i, t_i = descs.get("directHeartRate"), descs.get("directTimestamp")
    if hr_i is None or t_i is None:
        return []
    rows = [m.get("metrics") or [] for m in details.get("activityDetailMetrics") or []]
    pts = [(r[t_i], r[hr_i]) for r in rows if len(r) > max(hr_i, t_i) and r[hr_i] and r[t_i]]
    if not pts:
        return []
    t0 = pts[0][0]
    step = max(1, len(pts) // max_points)
    return [[round((t - t0) / 1000), round(h)] for t, h in pts[::step]]


@view("exercise")
def v_exercise(A, pair_: str) -> dict:
    ed = _ed()
    import formulas
    import prescription_audit as pa
    import progression_report as pr
    import strength_sessions as ss
    cat, _, name = pair_.partition("/")
    key = (cat, name)
    sessions = []
    for sess in ss.sessions(SINCE):
        sets = [s for s in sess.sets if ss.pair(s) == key]
        if not sets:
            continue
        rows = []
        for s in sets:
            w, r = (s.get("weight") or 0) / 1000, s.get("repetitionCount") or 0
            w_n, r_n = (w / 2 if key in ed.TWO_DB else w), (r // 2 if key in ed.UNILATERAL else r)
            rows.append({"weight": round(w_n, 2), "reps": r_n, "weight_logged": round(w, 2), "reps_logged": r,
                         "e1rm": round(formulas.e1rm(w_n, r_n), 1) if (w_n and r_n and key not in ed.MACHINE) else None})
        top = max(rows, key=lambda x: (x["weight"], x["reps"]))
        sessions.append({"date": sess.date, "day": sess.day, "activity_id": sess.id, "sets": rows,
                         "top": top, "volume": round(sum(x["weight_logged"] * x["reps_logged"] for x in rows)),
                         "best_e1rm": max((x["e1rm"] or 0 for x in rows), default=0) or None,
                         "annotated": ss.annotated(sess.date, key)})
    history = [h for h in pa.load_history().values() if (h.get("cat"), h.get("name")) == key]
    return {"category": cat, "name": name, "label": ed.pretty(cat, name), "muscle": ed.muscle_of(cat, name),
            "logged_as": "plates" if key in ed.MACHINE else "per_hand" if key in ed.TWO_DB
                         else "per_side" if key in ed.UNILATERAL else "total",
            "prescriptions": [{"day": d, **{k: v for k, v in e.items()}}
                              for d, spec in A.program.PROGRAM.items()
                              for e in _program_day_view(A, d, spec)["exercises"] if (e["category"], e["name"]) == key],
            "history": history,
            "audit": [r for r in pa.audit()["rows"] if (r["category"], r["name"]) == key],
            "trend": [r for r in pr.lift_rows(SINCE) if (r["category"], r["name"]) == key],
            "sessions": sessions,
            "defs": defs("e1rm", "audit", "progression")}


def _watch_steps(w: dict) -> list:
    """The step list as the watch shows it: the headline is what ends the step."""
    out = []

    def headline(s):
        cond = (s.get("endCondition") or {}).get("conditionTypeKey")
        v = s.get("endConditionValue")
        if cond in ("time", "fixed.rest") and v:   # a timed rest reads as its countdown, like any time step
            return f"{int(v) // 60}:{int(v) % 60:02d}"
        if cond == "distance" and v:
            return f"{v / 1000:.2f} km"
        if cond == "lap.button":
            return "Lap"
        if s.get("exerciseName"):
            return s["exerciseName"].replace("_", " ").title()
        if cond == "reps" and v:
            return f"{int(v)} reps"
        return (s.get("stepType") or {}).get("stepTypeKey") or "step"

    def walk(steps, depth=0):
        for s in steps:
            if s.get("type") == "RepeatGroupDTO":
                out.append({"kind": "repeat", "times": s.get("numberOfIterations"), "depth": depth})
                walk(s.get("workoutSteps") or [], depth + 1)
            else:
                cond = (s.get("endCondition") or {}).get("conditionTypeKey")
                out.append({"kind": (s.get("stepType") or {}).get("stepTypeKey"), "headline": headline(s),
                            "sub": (s.get("description") or "").strip() or None,
                            "weight": s.get("weightValue"), "depth": depth,
                            # What ends the step: the time runs out on its own, or it waits for Lap
                            # (a reps step too — the watch counts, the athlete presses Lap).
                            "end": STEP_END.get(cond, cond),
                            "exercise": f"{s['category']}/{s['exerciseName']}" if s.get("exerciseName") else None})
    for seg in w.get("workoutSegments") or []:
        walk(seg.get("workoutSteps") or [])
    return out


STEP_END = {"time": "timer", "fixed.rest": "timer", "lap.button": "lap", "reps": "lap", "distance": "distance"}


def _tag_rows(steps: list | None, rows: list[tuple[str, int]]) -> None:
    """Mark each watch step with the exercise row it runs (`row` = exid), in place, so the Plan
    screen can tie a row of the session to its steps. build_workouts emits, per row, `chunks`
    blocks that each end on a top-level Lap rest — a warm-up, or the sets — in program order. A
    file that doesn't split that way (built from an older program) is left untagged: the steps
    still show, just not tied to rows."""
    if not steps:
        return
    ends = [i for i, s in enumerate(steps) if s["depth"] == 0 and s.get("end") == "lap" and s["kind"] == "rest"]
    if len(ends) != sum(n for _, n in rows):
        return
    start, k = 0, 0
    for exid, n in rows:
        stop = ends[k + n - 1]
        for s in steps[start:stop + 1]:
            s["row"] = exid
        start, k = stop + 1, k + n


# --- program (board Program v2, 2026-10-12) ----------------------------------------------------
# The Program screen explains the program: the week, each gym day's anatomy in order, the number to
# beat on every lift, the balance, the rules, the history. Two kinds of data feed it:
#
#   DERIVED here from what already exists — phase per exercise, rep range, next-weight target,
#   estimated session time, planned sets per muscle and the Athletic bucket, the standing rules the
#   engine itself enforces (series rest, core rest, lap between exercises, starved days).
#
#   DECLARED, optionally, in the athlete's program.py — like BLOCK, each one is read with getattr and
#   the screen still makes sense without it (a new athlete has none):
#     WHY            {exid: "one sentence"}         why the exercise is in this day
#     PHASE          {exid: phase}                  overrides the derived phase (see PHASES)
#     OPTIONAL_DAYS  {day key}                      run rarely: not counted in the week's volume
#     SESSION_CAP_MIN  int                          the cap the estimated time is drawn against
#     REMOVED        [{name, day, after, removed_in, reason, replaced_by[]}]
#                    a lift taken out — `after` is the exid it sat after (None = first), removed_in a
#                    version id or "medical"; drawn as a ghost row where it used to be
#     VERSIONS       [{id, date, title, rationale, changes[{kind, text, why}]}]
#                    kind = structural | added | removed; load changes nest under them by date
#     WEEK           {"mon".."sun": [{sport, title?, detail?, slot?, day?, workout?, platform?, duration?}]}
#                    the weekly template — `day` a gym day key, `workout` a managed workout key
#     WEEK_FLOOR     {sport typeKey: min | {min, label}}   the weekly floor, counted on the template
#     RULES          [{key, label, detail, span?[from, to], mark?, sport?}]   standing rules; a span
#                    draws the rule on the week strip
#     CARDIO         {start, weeks, tracks[{name, sport, when, workout?, cells[{title, rx, workout?, benchmark?}]}], notes[]}
#     BENCHMARKS     [{id, name, sport, due, retest_days?, unit?, results[{date, value}]}]
#     UNDER_ON_PURPOSE {muscle: "why it sits below its band"}
#     WEEK_TARGETS   {"minutes": [lo, hi], "sets": [lo, hi]}   the coach's weekly band for training time
#                    and working sets — Today's This week draws it; without one a row says only how it moved
PHASES = ("core", "power", "strength", "functional", "hypertrophy")
PHASE_LABEL = {"core": "Core block", "power": "Power", "strength": "Strength",
               "functional": "Functional / athletic", "hypertrophy": "Hypertrophy"}
# Next-weight step by implement, kg. Per hand for two-dumbbell lifts; disc load on plate machines.
INCREMENT = {"barbell": 2.5, "dumbbell": 2.0, "dumbbell_light": 1.0, "cable": 2.5, "machine": 5.0,
             "plates": 5.0, "added": 2.5}
# The Athletic bucket, broken down by what the work is (export_dashboard_data.ATHLETIC sets).
ATHLETIC_PART = {"RUN": "Sprint", "PLYO": "Jump", "PUSH_UP": "Throw / explosive push-up", "SLED": "Sled",
                 "BATTLE_ROPE": "Battle rope", "CARDIO": "Conditioning"}
DOW = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
# Work time per set, for the estimate only: what the watch cannot know until it is done.
SEC_PER_REP, POWER_SET_S, WARMUP_SET_S, LAP_S = 3, 20, 90, 30


def _base_kind(kind: str) -> tuple[str, bool]:
    return (kind[:-len("_per_side")], True) if kind.endswith("_per_side") else (kind, False)


def _implement(A, ex: tuple, per_hand: bool, machine: bool) -> str:
    """What the load is on — how it is shown, and how far the next step is."""
    _, _, cat, name, _, _, weight, _, _ = ex
    if weight is None:
        return "bw"
    if machine:
        return "plates"
    if name.startswith("WEIGHTED_"):
        return "added"
    if per_hand or "DUMBBELL" in name:
        return "dumbbell_light" if cat == "LATERAL_RAISE" else "dumbbell"
    if any(w in name for w in ("CABLE", "ROPE", "PULLDOWN", "FACE_PULL")):
        return "cable"
    if any(w in name for w in ("LEVER", "MACHINE", "SMITH", "LEG_CURL", "LEG_EXTENSION")) or cat in ("LEG_CURL", "CALF_RAISE"):
        return "machine"
    return "barbell"


def _est_s(ex: tuple, rest_s: int, warmups: int = 0) -> int:
    _, _, _, _, sets, value, _, _, kind = ex
    base, per_side = _base_kind(kind)
    work = (value if base == "time" else POWER_SET_S if base == "power" else value * SEC_PER_REP)
    if per_side:
        work = work * 2 + 10
    return int(sets * work + (sets - 1) * rest_s + LAP_S + warmups * WARMUP_SET_S)


def _phases(A, key: str, exercises: list) -> list[str]:
    """Phase per exercise, in order: power before the first main lift, the first loaded lift is
    strength, timed and athletic work after it is functional, the rest hypertrophy. PHASE wins."""
    ed = _ed()
    override = getattr(A.program, "PHASE", {})
    out, main_seen = [], False
    for ex in exercises:
        exid, _, cat, name, _, _, weight, _, kind = ex
        base, _ = _base_kind(kind)
        muscle = ed.muscle_of(cat, name)
        if exid in override:
            ph = override[exid]
        elif muscle == "Core":
            ph = "core"
        elif base == "power" or (muscle == ed.ATHLETIC and not main_seen):
            ph = "power" if not main_seen else "functional"
        elif base == "time" or muscle == ed.ATHLETIC or cat == "CARRY":
            ph = "functional"
        elif not main_seen and weight is not None:
            ph = "strength"
        else:
            ph = "hypertrophy"
        main_seen = main_seen or ph == "strength"
        out.append(ph)
    return out


def _exercise_row(A, ex: tuple, phase: str, rest_s: int, trend: dict, audit: dict | None) -> dict:
    import build_workouts as bw
    ed = _ed()
    exid, routine, cat, name, sets, value, weight, _, kind = ex
    base, per_side = _base_kind(kind)
    per_hand, machine = (cat, name) in ed.TWO_DB, (cat, name) in ed.MACHINE
    imp = _implement(A, ex, per_hand, machine)
    step = bw.FIXED_INCREMENT.get(exid) or INCREMENT.get(imp)
    warm = [list(w) for w in bw.WARMUPS.get(exid, [])]
    t = trend.get((cat, name))
    return {
        "exid": exid, "routine": routine, "category": cat, "name": name, "label": ed.pretty(cat, name),
        "sets": sets, "value": value, "weight": weight, "rest_s": rest_s, "kind": kind, "base": base, "per_side": per_side,
        "per_hand": per_hand, "machine": machine, "load": imp, "phase": phase,
        "why": getattr(A.program, "WHY", {}).get(exid), "note": bw.STEP_NOTES.get(exid), "warmup": warm,
        # The watch's own range note (build_workouts TEXT["range"]): bottom = value − 2.
        "range": [value - 2, value] if base == "reps" and phase != "core" else None,
        "increment": step if weight is not None and base in ("reps", "fixed") and phase != "core" else None,
        "next_weight": (round(weight + step, 2) if weight is not None and step and base in ("reps", "fixed")
                        and phase != "core" else None),
        "est_s": _est_s(ex, rest_s, len(warm)),
        "trend": [p["score"] for p in (t or {}).get("points", [])[-6:]],
        "trend_score": (t or {}).get("score"),
        "audit": audit,
    }


def _week(A, days_by_key: dict, sync: dict, planned_today: str) -> dict:
    """The week strip: the template if the program declares one, else this week's calendar —
    watch workouts and off-watch sessions — so an athlete without a template still sees a week."""
    state = {w["key"]: w["state"] for w in sync["workouts"]}
    monday = TODAY() - dt.timedelta(days=TODAY().weekday())

    def session(s: dict) -> dict:
        tk = "strength_training" if s.get("day") else s.get("sport")
        d = days_by_key.get(s.get("day"))
        key = s.get("day") or s.get("workout")
        sync_state = (state.get(key) if key in state
                      else "external" if s.get("platform") else "none")
        return {"sport": tk, "badge": _planned_badge({"sport": tk, "platform": s.get("platform")}),
                "title": s.get("title") or (d["title"] if d else None) or sports.badge(tk)["sport"],
                "detail": s.get("detail"), "slot": s.get("slot"), "day": s.get("day"),
                "workout": s.get("workout"), "platform": s.get("platform"),
                "duration": s.get("duration") or (f"{d['est_min']} min" if d else None), "sync": sync_state}

    template = getattr(A.program, "WEEK", None)
    if template:
        out = [{"dow": k, "sessions": [session(s) for s in template.get(k, [])]} for k in DOW]
        source = "template"
    else:
        ed = _ed()
        start, end = monday.isoformat(), (monday + dt.timedelta(days=6)).isoformat()
        by_name = {d["name"]: k for k, d in days_by_key.items()}
        managed_names = {}
        for k in A.managed:
            f = A.workouts_dir / f"{k}.json"
            if f.exists():
                managed_names[json.loads(f.read_text()).get("workoutName")] = k
        out = []
        for i, k in enumerate(DOW):
            day_iso = (monday + dt.timedelta(days=i)).isoformat()
            ss = [session({"day": by_name.get(x.get("title")),
                           "workout": None if x.get("title") in by_name else managed_names.get(x.get("title")),
                           "sport": x.get("sportTypeKey"), "title": x.get("title")})
                  for x in _scheduled(A) if x.get("date") == day_iso]
            ss += [session({"sport": p["sport"], "title": p["title"], "detail": p.get("detail"),
                            "platform": p.get("platform"), "workout": p.get("workout")})
                   for p in _planned(A, start, end) if p["date"] == day_iso]
            out.append({"dow": k, "sessions": ss})
        source = "calendar"
    for i, d in enumerate(out):
        d["date"] = (monday + dt.timedelta(days=i)).isoformat()
        d["today"] = d["date"] == planned_today
    return {"source": source, "days": out}


def _floor(A, week: dict) -> list:
    """Counted by the exact sport: a Zwift ride is not the long ride, though both are bikes."""
    key = lambda tk: (tk or "").removesuffix("_v2")  # noqa: E731
    have = defaultdict(int)
    for d in week["days"]:
        for s in d["sessions"]:
            have[key(s["sport"])] += 1
    out = []
    for tk, spec in (getattr(A.program, "WEEK_FLOOR", None) or {}).items():
        spec = spec if isinstance(spec, dict) else {"min": spec}
        out.append({"sport": tk, "label": spec.get("label") or sports.badge(tk)["sport"],
                    "min": spec["min"], "planned": have.get(key(tk), 0)})
    return out


def _balance(A, days: list) -> dict:
    """Planned working sets per muscle in one week of the program (optional days left out), against
    the athlete's bands — and the Athletic bucket, which is never muscle volume."""
    ed = _ed()
    optional = getattr(A.program, "OPTIONAL_DAYS", set())
    sets, athletic = defaultdict(int), defaultdict(int)
    for d in days:
        if d["key"] in optional:
            continue
        for e in d["lead"] + d["exercises"]:
            m = ed.muscle_of(e["category"], e["name"])
            if m == ed.ATHLETIC:
                athletic[ATHLETIC_PART.get(e["category"], ed.pretty(e["category"], e["name"]))] += e["sets"]
            else:
                sets[m] += e["sets"]
    notes = getattr(A.program, "UNDER_ON_PURPOSE", {})
    muscles = [{"muscle": m, "sets": sets.get(m, 0), "lo": ed.TARGET[m][0], "hi": ed.TARGET[m][1],
                "on_purpose": notes.get(m)} for m in ed.MUSCLE_ORDER]
    return {"muscles": muscles, "athletic": [{"part": k, "sets": v} for k, v in athletic.items()],
            "unattributed": sets.get(ed.UNATTRIBUTED, 0),
            "days": [d["key"] for d in days if d["key"] not in optional]}


def _rules(A) -> list:
    """The standing rules: the ones the engine itself enforces, then the athlete's own."""
    import build_workouts as bw
    import rotation_status as rs
    mmss = lambda s: f"{s // 60}:{s % 60:02d}"  # noqa: E731
    out = [{"key": mmss(bw.SET_REST_SECS), "label": "Rest between series", "detail": "A countdown on the watch.",
            "source": "engine"},
           {"key": "Lap", "label": "Between exercises", "detail": "“Press for next” — you control the transitions.",
            "source": "engine"}]
    if bw.LEAD:
        out.append({"key": mmss(bw.CORE_REST_SECS), "label": "Core-block rest",
                    "detail": "The block that opens the gym day.", "source": "engine"})
    cap = getattr(A.program, "SESSION_CAP_MIN", None)
    if cap:
        out.append({"key": f"{cap}′", "label": "Session cap", "detail": "Estimated time per gym day must fit.",
                    "source": "program"})
    out.append({"key": f"{rs.STARVED_DAYS} d", "label": "A starved day outranks the template",
                "detail": f"Days since each gym day; starved after {rs.STARVED_DAYS}.", "source": "engine"})
    return out + [{**r, "source": "program", "badge": sports.badge(r["sport"]) if r.get("sport") else None}
                  for r in getattr(A.program, "RULES", [])]


def _benchmarks(A) -> list:
    today = TODAY().isoformat()
    out = []
    for b in getattr(A.program, "BENCHMARKS", []):
        results = sorted(b.get("results") or [], key=lambda r: r["date"])
        last = results[-1] if results else None
        every = b.get("retest_days", 42)
        done_for_due = bool(last and last["date"] >= b["due"])
        nxt = (dt.date.fromisoformat(last["date"]) + dt.timedelta(days=every)).isoformat() if done_for_due else b["due"]
        out.append({"id": b["id"], "name": b["name"], "sport": b.get("sport"), "badge": sports.badge(b.get("sport")),
                    "unit": b.get("unit"), "due": b["due"], "next": nxt, "retest_days": every,
                    "retest": (dt.date.fromisoformat(nxt) + dt.timedelta(days=every)).isoformat(),
                    "last": last, "overdue": nxt < today, "results": results})
    return sorted(out, key=lambda b: b["next"])


def _cardio(A, sync: dict) -> dict | None:
    c = getattr(A.program, "CARDIO", None)
    if not c:
        return None
    state = {w["key"]: w["state"] for w in sync["workouts"]}
    start = dt.date.fromisoformat(c["start"])
    idx = (TODAY() - start).days // 7
    weeks = [{"n": i + 1, "start": (start + dt.timedelta(days=7 * i)).isoformat(),
              "end": (start + dt.timedelta(days=7 * i + 6)).isoformat()} for i in range(c["weeks"])]

    def track(t):
        tk = t.get("sport")
        ext = t.get("platform")
        return {"name": t["name"], "sport": tk, "badge": _planned_badge({"sport": tk, "platform": ext}),
                "when": t.get("when"), "platform": ext,
                "sync": "external" if ext else state.get(t.get("workout"), "none") if t.get("workout") else "none",
                "cells": [{**cell, "sync": state.get(cell.get("workout")) if cell.get("workout") else None}
                          for cell in t.get("cells", [])]}
    return {"start": c["start"], "weeks": weeks, "current": idx if 0 <= idx < c["weeks"] else None,
            "upcoming": idx < 0, "tracks": [track(t) for t in c.get("tracks", [])], "notes": c.get("notes", [])}


def _versions(A, changes: list) -> list:
    """Versions newest first, each with the load changes made from its date until the next one's.
    Changes older than every version gather under an entry of their own."""
    vs = sorted(getattr(A.program, "VERSIONS", []), key=lambda v: v["date"], reverse=True)
    out = [{**v, "loads": []} for v in vs]
    before = []
    for ch in changes:
        home = next((v for v in out if v["date"] <= ch["date"]), None)
        (home["loads"] if home else before).append(ch)
    if before:
        out.append({"id": None, "date": before[-1]["date"], "title": "Before the recorded versions",
                    "rationale": None, "changes": [], "loads": before})
    return out


@view("program")
def v_program(A) -> dict:
    import build_workouts as bw
    import prescription_audit as pa
    import progression_report as pr
    import rotation_status as rs
    audit = pa.audit()["rows"]
    by_ex = {(r["day"], r["exid"]): r for r in audit}
    lifts = pr.lift_rows(SINCE)
    trend = {}
    for r in lifts:   # split pairs come per day; the day's own wins below
        trend.setdefault((r["category"], r["name"]), r)
    rot = rs.rotation()
    rot_by = {r["day"]: r for r in rot["days"]}
    removed = getattr(A.program, "REMOVED", [])
    optional = getattr(A.program, "OPTIONAL_DAYS", set())
    days = []
    for key, spec in A.program.PROGRAM.items():
        d = _program_day_view(A, key, spec)
        f = A.workouts_dir / f"{key}.json"
        d["watch"] = _watch_steps(json.loads(f.read_text())) if f.exists() else None
        d["label"] = rs.DAY_LABEL.get(key, spec["name"])
        day_trend = {**trend, **{(r["category"], r["name"]): r for r in lifts if r["day"] == key}}
        lead = (bw.LEAD.get(key) or {}).get("block", [])
        d["lead"] = [_exercise_row(A, ex, "core", bw.CORE_REST_SECS, day_trend, None) for ex in lead]
        d["exercises"] = [_exercise_row(A, ex, ph, bw.SET_REST_BY_ID.get(ex[0], bw.SET_REST_SECS), day_trend,
                                        by_ex.get((key, ex[0])))
                          for ex, ph in zip(spec["exercises"], _phases(A, key, spec["exercises"]))]
        _tag_rows(d["watch"], [(e["exid"], 1) for e in d["lead"]]
                  + [(e["exid"], 1 + len(bw.TIMED_WARMUPS.get(e["exid"], [])) + len(e["warmup"])) for e in d["exercises"]])
        d["why"] = spec.get("desc")
        d["title"] = d["label"].split(" · ", 1)[-1]
        d["optional"] = key in optional
        d["est_min"] = round(sum(e["est_s"] for e in d["lead"] + d["exercises"]) / 60)
        d["rotation"] = rot_by.get(key)
        d["removed"] = [r for r in removed if r.get("day") == key]
        days.append(d)
    others = []
    for key in A.managed:
        if key in A.program.PROGRAM:
            continue
        f = A.workouts_dir / f"{key}.json"
        if f.exists():
            w = json.loads(f.read_text())
            others.append({"key": key, "name": w.get("workoutName"),
                           "sport": (w.get("sportType") or {}).get("sportTypeKey"),
                           "badge": sports.badge((w.get("sportType") or {}).get("sportTypeKey")),
                           "watch": _watch_steps(w)})
    changes = []
    for k, h in pa.load_history().items():
        for ch in h.get("changes") or []:
            changes.append({"prescription": k, "category": h.get("cat"), "name": h.get("name"), **ch})
    changes.sort(key=lambda c: c["date"], reverse=True)
    constraints = [f for f in _facts(A) if f.get("type") == "medical" and f.get("status", "active") == "active"]
    sync = sync_status(A)
    week = _week(A, {d["key"]: d for d in days}, sync, TODAY().isoformat())
    return {"days": days, "other_workouts": others, "rotation": rot, "audit": audit,
            "changes": changes, "block": block(A), "constraints": constraints, "sync": sync,
            "cap_min": getattr(A.program, "SESSION_CAP_MIN", None),
            "rest": {"series_s": bw.SET_REST_SECS, "core_s": bw.CORE_REST_SECS},
            "week": week, "floor": _floor(A, week), "rules": _rules(A),
            "cardio": _cardio(A, sync), "benchmarks": _benchmarks(A), "balance": _balance(A, days),
            "removed": removed, "versions": _versions(A, changes),
            "phases": [{"key": k, "label": PHASE_LABEL[k]} for k in PHASES],
            "season": _season(A),
            "defs": defs("audit", "starved", "watch_sync", "est_time", "phase", "next_target",
                         "planned_volume", "e1rm")}


PLATFORMS = {"zwift": "Zwift"}   # an app that runs the session itself; the tag shows its name and mark


def _planned_badge(i: dict) -> dict:
    """The sport's badge — or, for a session an app runs (`platform`), that app's name and mark: a
    Zwift session reads Zwift, not "Virtual ride" (his ask, 2026-10-12). Matching it to what was
    logged still uses the sport."""
    b = sports.badge(i["sport"])
    p = i.get("platform")
    return {**b, "sport": PLATFORMS[p], "icon": p} if p in PLATFORMS else b


# What a plan.json session carries that a Garmin calendar entry cannot: the Zwift workout to open, what the
# session is for (its fuel reads it) and the app that runs it.
PLAN_ONLY = ("zwift_workout", "intent", "platform")


def _mirrors(A, sched: list | None = None) -> dict:
    """The Garmin calendar entries a plan.json session stands for: (date, title) → that calendar entry.

    A plan session MIRRORS a watch entry when it names the managed `workout` Garmin has on that day AND
    carries something the watch entry cannot (PLAN_ONLY). Then the app lists ONE entry, the plan
    session's, with the watch's state on it. Before 2026-11-28 a Zwift ride and its watch copy showed
    twice, and the rule that hid a plan session once Garmin had it would have kept the bare copy and
    dropped the Zwift link and the fuel. A plan session with none of those (an accepted week's gym day
    waiting for the watch) still gives way to the watch entry, as before (2026-10-16). Matched on the
    workout's own name and the date, never on the sport: two rides on one day stay two rides."""
    f = A.plan_path
    if not f.exists():
        return {}
    names = _workout_names(A)
    sched = (_ed().load("scheduled.json") or []) if sched is None else sched
    by_key = {(i.get("date"), (i.get("title") or "").strip()): i for i in sched}
    out = {}
    for p in json.loads(f.read_text()).get("sessions") or []:
        if p.get("workout") and any(p.get(k) for k in PLAN_ONLY):
            k = (p.get("date"), names.get(p["workout"], ""))
            if k in by_key:
                out[k] = by_key[k]
    return out


def _scheduled(A) -> list:
    """Garmin's calendar (scheduled.json) as the app lists it: without the entries a plan.json session
    stands for (_mirrors), since _planned lists that session in their place."""
    sched = _ed().load("scheduled.json") or []
    mirrored = _mirrors(A, sched)
    return [i for i in sched if (i.get("date"), (i.get("title") or "").strip()) not in mirrored]


def _planned(A, start: str, end: str | None = None) -> list:
    """Sessions the coach planned that are not on Garmin's calendar, from athletes/<name>/plan.json:
    those that never go to the watch — Zwift (Zwift runs it), the long ride, tennis — and, naming a
    managed `workout`, the watch sessions of an accepted week that wait to go on the watch (only today
    and the next two days are kept there). Without the second kind an accepted week showed its later gym
    days as Rest (2026-10-16, his report: Legs on 10-20 accepted, Rest on the Plan screen). A watch
    session hides itself once Garmin's calendar has that workout on that day — the watch entry shows it
    then — unless it MIRRORS that entry (_mirrors: it carries a Zwift workout, an intent or a platform),
    when it stays as the one entry, `on_watch` true. `done` when that day logged the same kind of sport,
    the rule the Plan screen applies to watch entries, or when the watch entry it mirrors is done."""
    f = A.plan_path
    if not f.exists():
        return []
    items = [i for i in json.loads(f.read_text()).get("sessions") or []
             if start <= i["date"] and (end is None or i["date"] <= end)]
    if not items:
        return []
    names = _workout_names(A)
    sched = _ed().load("scheduled.json") or []
    on_watch = {(i.get("date"), (i.get("title") or "").strip()) for i in sched}
    mirrored = _mirrors(A, sched)

    def watch_key(i: dict) -> tuple:
        return (i["date"], names.get(i.get("workout"), "")) if i.get("workout") else (None, None)
    items = [i for i in items if watch_key(i) not in on_watch or watch_key(i) in mirrored]
    logged = {(a["startTimeLocal"][:10], sports.badge((a.get("activityType") or {}).get("typeKey"))["icon"])
              for a in _ed().all_activities() if a["startTimeLocal"][:10] >= start}
    import fuel
    cfg, cat = fuel.load_cfg(A), fuel.catalog()
    return [{"date": i["date"], "title": i["title"], "sport": i["sport"], "badge": _planned_badge(i),
             "detail": i.get("detail"), "why": i.get("why"), "platform": i.get("platform"),
             "workout": i.get("workout"), "duration_min": i.get("duration_min"),
             # The Zwift workout to open in Zwift's menu (scripts/zwift_workouts.py, his rule 2026-11-05).
             "zwift_workout": i.get("zwift_workout"),
             # Its fuel (docs/DESIGN.md (fuelling and score) §4): from its intent and minutes, in the athlete's own
             # products — null when it names no intent, since the rule needs one and guesses none.
             "intent": i.get("intent"), "fuel": fuel.for_session(i, cfg, cat),
             "on_watch": watch_key(i) in mirrored,
             "done": (i["date"], sports.badge(i["sport"])["icon"]) in logged
                     or bool((mirrored.get(watch_key(i)) or {}).get("associatedActivityId"))}
            for i in sorted(items, key=lambda i: i["date"])]


def _workout_names(A) -> dict:
    """Managed workout key → the name it carries on Garmin (its generated JSON's workoutName)."""
    out = {}
    for key in A.managed:
        f = A.workouts_dir / f"{key}.json"
        if f.exists():
            out[key] = (json.loads(f.read_text()).get("workoutName") or "").strip()
    return out


# --- races (docs/DESIGN.md (races), 2026-10-15) -------------------------------------------------------------
# The season as the app shows it, from athletes/<name>/races.json through scripts/races.py: the windows,
# the days to go and what is due a check are that file's, never counted here. Without races.json every
# piece is empty or None, as for a new athlete.
def _race_brief(r: dict, today: dt.date) -> dict:
    """One race in a line: what, when, how far off, how much it matters, the target."""
    import races as rc
    k = rc.RACE_KINDS.get(r.get("kind")) or {}
    day = dt.date.fromisoformat(r["date"])
    days_to = (day - today).days
    target = r.get("target") or None
    return {"id": r["id"], "name": r["name"], "kind": r.get("kind"), "kind_label": k.get("label"),
            "icon": k.get("icon"), "priority": r.get("priority"), "entry": r.get("entry"), "date": r["date"],
            "dow": day.strftime("%a"), "start": r.get("start"), "days_to": days_to, "weeks_to": round(days_to / 7, 1),
            "past": days_to < 0, "countdown": 0 <= days_to <= rc.COUNTDOWN_DAYS,
            "target": target and {**target, "seconds": rc.seconds(target["under"]) if target.get("under") else None}}


def _race_benchmarks(r: dict, A) -> list:
    """The program's benchmarks that predict this race (races.json `benchmarks`, ids from program.py
    BENCHMARKS): each with its next date, its last result, and whether it lands inside one of this race's
    windows — which the tests forbid, so the page flags one only while a move is pending."""
    import races as rc
    ids = r.get("benchmarks") or []
    if not ids or A is None:
        return []
    days = {d["date"]: d["window"] for d in rc.days_of(r)}
    by_id = {b["id"]: b for b in _benchmarks(A)}
    # `timing`: a test dated after the race cannot predict it, and one whose date has passed with no
    # result was missed — the page says so instead of printing the bare date (app audit 2026-11-10:
    # HYROX on 12 Nov listed "400 m (Fri 6 Nov)", never run, and "5 km time trial (Wed 18 Nov)").
    def timing(b):
        if b["last"] and b["last"]["date"] <= r["date"]:
            return None
        return "after_race" if b["next"] > r["date"] else "overdue" if b["overdue"] else None
    return [{"id": i, "name": b["name"], "unit": b.get("unit"), "next": b["next"], "last": b["last"],
             "in_window": days.get(b["next"]), "timing": timing(b)} for i in ids if (b := by_id.get(i))]


def _race_stations(r: dict, kind: dict) -> list:
    """A station race's stations in order (races.py RACE_KINDS → stations): the distance, the load for the
    race's division (format.loads), and who takes it (split: partner, shared, or mine)."""
    loads = (r.get("format") or {}).get("loads") or {}
    split = r.get("split") or {}
    who = lambda key: ("partner" if key in (split.get("partner_only") or []) else  # noqa: E731
                       "shared" if key in (split.get("shared") or []) else "mine")
    per_hand = lambda f: f.endswith("_per_hand")  # noqa: E731
    return [{"key": key, "name": name, "distance": dist, "who": who(key),
             "load": (f"2 × {loads[f]:g} kg" if per_hand(f) else f"{loads[f]:g} kg") if f and loads.get(f) is not None else None}
            for key, name, dist, f in kind.get("stations") or ()]


def _race_reference(r: dict, under: int | None, A=None) -> dict | None:
    """A past result the target is read against (races.json `reference`): its time and splits in seconds,
    and how far the target is from it. With an `activity_id` whose recording is cached, the splits are
    read from that Garmin activity (races.splits, `splits_from`); otherwise they are the ones typed into
    races.json. Each split names its discipline where it has one, which the result is compared on."""
    import races as rc
    ref = r.get("reference")
    if not ref:
        return None
    took = rc.seconds(ref["time"])
    got = rc.splits(r, ref.get("activity_id"), A) if A is not None else None
    splits = ([{"name": p["label"], "time": rc.clock(p["seconds"]), "seconds": p["seconds"], "discipline": p["discipline"]}
               for p in got[1]] if got else
              [{"name": n, "time": t, "seconds": rc.seconds(t), "discipline": rc.discipline_of(r, n)}
               for n, t in (ref.get("splits") or {}).items()])
    return {**ref, "seconds": took, "target_gap_s": took - under if under is not None else None,
            "splits": splits, "splits_from": got[0] if got else None}


def _race_card(r: dict, today: dt.date, due: dict | None, A=None) -> dict:
    """Everything the race page shows: the brief; the windows as dates; the check of its date; the
    prediction, which comes only from data (Garmin's race predictor for run distances — never a guess);
    the result against the target; and the event's mark, or the fallback the page draws without one."""
    import races as rc
    brief = _race_brief(r, today)
    k = rc.RACE_KINDS.get(r.get("kind")) or {}
    v = r.get("verified") or {}
    res = r.get("result")
    took = rc.seconds(res["time"]) if res and res.get("time") else None
    under = (brief["target"] or {}).get("seconds")
    mark = rc.MARKS.get(r.get("series")) or {}
    ref = _race_reference(r, under, A)
    # The result's splits by discipline, from its Garmin activity (races.splits), and each against the
    # reference's — never typed in, never computed on the page.
    got = rc.splits(r, res.get("activity_id"), A) if res and A is not None else None
    return {**brief, "official_name": r.get("official_name"), "series": r.get("series"),
            "start_note": r.get("start_note"), "where": r.get("where"), "format": r.get("format"),
            "split": r.get("split"), "type_keys": list(k.get("type_keys") or ()), "windows": rc.span(r),
            "verified": {**v, "days_since": (today - dt.date.fromisoformat(v["checked"])).days if v.get("checked") else None},
            "check_due": due, "prediction": rc.prediction(r, A),
            "benchmarks": _race_benchmarks(r, A), "reference": ref,
            "stations": _race_stations(r, k),
            "result": res and {**res, "seconds": took,
                               "vs_target_s": took - under if took is not None and under is not None else None,
                               "splits": got[1] if got else None, "splits_from": got[0] if got else None,
                               "vs_reference": rc.versus(r, got and got[1], ref and ref["splits"])},
            "mark": ({f: mark.get(f) for f in ("label", "wordmark", "icon", "colours", "source", "note", "suffix")}
                     if mark.get("wordmark") or mark.get("icon") else None),
            "fallback": {"icon": k.get("icon") or "race", "monogram": rc.monogram(r["name"]), "label": mark.get("label")}}


def _phase(p: dict, today: dt.date) -> dict:
    """races.phase_on(), with each race as its brief."""
    one = lambda h: {**h, "race": h["race"] and _race_brief(h["race"], today)}  # noqa: E731
    return {**one(p), "also": [one(h) for h in p["also"]]}


def _race_today(A) -> dict | None:
    """Today's race line (docs/DESIGN.md (races) §4): the next race and the days to it, and the window today
    falls in. `countdown` is when the brief shows the line: 8 weeks out or less. None with no race
    ahead and no window today."""
    import races as rc
    rs_, today = rc.load(A), TODAY()
    nxt = rc.next_race(rs_, today)
    p = rc.phase_on(today, rs_)
    if not nxt and p["window"] is None:
        return None
    brief = nxt and _race_brief(nxt, today)
    return {"next": brief, "window": _phase(p, today), "countdown": bool(brief and brief["countdown"])}


def _race_days(A, start: str) -> list:
    """Race days and their windows from `start` on, for the Plan screen's week and month grids: a row
    per day each race shapes ({date, window, day, of, intensity, race}), so a day two races shape has two."""
    import races as rc
    today = TODAY()
    out = []
    for r in rc.racing(rc.load(A)):
        brief = _race_brief(r, today)
        out += [{**x, "race": brief} for x in rc.days_of(r) if x["date"] >= start]
    return sorted(out, key=lambda x: (x["date"], x["race"]["date"]))


def _season(A, rs_: list | None = None) -> dict | None:
    """The season for the timeline (docs/DESIGN.md (races) §4, §6): the blocks to the A race (program.py →
    SEASON, optional — BLOCK stays the current block) and every race. Which race a block opens with,
    holds or ends at is read from the dates. None with neither races nor a SEASON."""
    import races as rc
    rs_ = rc.load(A) if rs_ is None else rs_
    season = getattr(A.program, "SEASON", None)
    if not rs_ and not season:
        return None
    today = TODAY()
    # The A race: the one SEASON builds to; without a SEASON, the next A race in races.json.
    a_race = (next((r for r in rs_ if r["id"] == season.get("race")), None) if season else
              next((r for r in rs_ if r.get("priority") == "A" and dt.date.fromisoformat(r["date"]) >= today), None))
    nxt = rc.next_race(rs_, today)
    # Without a SEASON the timeline still shows the block in force (program.py BLOCK); the ones after it
    # are written at each block review (`planned` false: the page says so instead of drawing a guess).
    block = getattr(A.program, "BLOCK", None)
    blocks = rc.season_blocks(season or ({"blocks": [block]} if block else None), rs_, today)
    return {"race": a_race and _race_brief(a_race, today), "blocks": blocks, "planned": bool(season),
            "current": next((b for b in blocks if b["current"]), None),
            "races": [_race_brief(r, today) for r in rs_], "next": nxt and _race_brief(nxt, today)}


@view("races")
def v_races(A) -> dict:
    """The race season (docs/DESIGN.md (races) §6): every race with its windows, the check of its date, its
    target and result; the next race; today's window; the season's blocks; and what is due an online
    check — listed from the dates, with no network."""
    import races as rc
    today = TODAY()
    rs_ = rc.load(A)
    due = {x["id"]: x for x in rc.check(rs_, today)}
    cards = [_race_card(r, today, due.get(r["id"]), A) for r in rs_]
    nxt = rc.next_race(rs_, today)
    return {"races": cards, "next": next((c for c in cards if nxt and c["id"] == nxt["id"]), None),
            "today": _phase(rc.phase_on(today, rs_), today), "season": _season(A, rs_),
            "due": list(due.values()),
            "kinds": {k: {"label": v["label"], "icon": v["icon"]} for k, v in rc.RACE_KINDS.items()},
            "defs": defs("race_windows", "race_easy", "race_taper", "race_day", "race_recovery", "race_priority",
                         "race_countdown", "race_check", "race_target", "race_prediction", "race_splits")}


@view("calendar")
def v_calendar(A) -> dict:
    ed = _ed()
    sched = _scheduled(A)
    start = (TODAY() - dt.timedelta(days=42)).isoformat()
    done = [{"date": a["startTimeLocal"][:10], "id": a["activityId"], "title": a.get("activityName"),
             "group": _sid_group(a), **sports.badge((a.get("activityType") or {}).get("typeKey"))}
            for a in ed.all_activities() if a["startTimeLocal"][:10] >= start]
    # `sport` stays the scheduled workout's sportTypeKey (Today and Plan read it); the badge rides beside it.
    return {"scheduled": [{"date": i.get("date"), "title": i.get("title"), "workout_id": i.get("workoutId"),
                           "sport": i.get("sportTypeKey"), "badge": sports.badge(i.get("sportTypeKey")),
                           "done": bool(i.get("associatedActivityId"))} for i in sched],
            "planned": _planned(A, start), "done": done, "sync": sync_status(A),
            "race_days": _race_days(A, start),
            "defs": defs("watch_sync", "race_easy", "race_taper", "race_day", "race_recovery", "fuel_band", "fuel_target")}


@view("body")
def v_body(A) -> dict:
    ed = _ed()
    bc = ed.load("bodycomp.json") or {}
    pts = sorted(({"date": e["calendarDate"][:10], "kg": round((e.get("weight") or 0) / 1000, 1)}
                  for e in bc.get("dateWeightList") or [] if e.get("weight")), key=lambda x: x["date"])
    start = (TODAY() - dt.timedelta(days=120)).isoformat()
    pts = [p for p in pts if p["date"] >= start]
    for i, p in enumerate(pts):
        window = [q["kg"] for q in pts if dt.date.fromisoformat(p["date"]) - dt.timedelta(days=6)
                  <= dt.date.fromisoformat(q["date"]) <= dt.date.fromisoformat(p["date"])]
        p["avg7"] = round(sum(window) / len(window), 1)
    target = A.profile.get("weight_target_kg")
    last = pts[-1] if pts else None
    return {"series": pts, "target": target, "latest": last,
            "days_since": (TODAY() - dt.date.fromisoformat(last["date"])).days if last else None,
            "defs": defs("weight")}


def _journal_kind(name: str) -> str:
    for k in ("brief", "review", "recap", "audit", "insight"):
        if k in name:
            return k
    return "daily" if re.match(r"^\d{4}-\d{2}-\d{2}\.md$", name) else "note"


@view("journal")
def v_journal(A) -> dict:
    entries = []
    for f in sorted(A.logs_dir.glob("*.md"), reverse=True) if A.logs_dir.exists() else []:
        head = next((l[2:].strip() for l in f.read_text().splitlines() if l.startswith("# ")), f.stem)
        entries.append({"file": f.name, "date": f.name[:10], "kind": _journal_kind(f.name), "title": head})
    return {"entries": entries}


@view("journal-entry")
def v_journal_entry(A, file: str) -> dict:
    if not re.fullmatch(r"[\w.-]+\.md", file or ""):
        sys.exit(f"refused: {file!r} is not a journal file name")
    path = A.logs_dir / file
    if not path.is_file():
        sys.exit(f"no journal entry {file}")
    return {"file": file, "markdown": path.read_text()}


def _facts(A) -> list:
    import build_memory_index as bmi
    out = []
    mem = A.memory_dir
    for f in sorted(mem.rglob("*.md")) if mem.exists() else []:
        if f.name == "INDEX.md":
            continue
        fm = bmi.frontmatter(f)
        row = {k: fm.get(k) for k in ("type", "status", "since", "source", "enforced_by")}
        # "none — descriptive" is the file saying NO check holds it (build_memory_index marks it
        # unenforced). Passed through as text, the page read any text as a check and showed
        # "Enforced by a check" on all 21 facts, 12 of them unenforced (UX review 2026-11-10).
        if not row["enforced_by"] or str(row["enforced_by"]).strip().lower().startswith("none"):
            row["enforced_by"] = None
        out.append({"file": str(f.relative_to(mem)), "title": bmi.title(f), **row})
    return out


@view("memory")
def v_memory(A) -> dict:
    return {"facts": _facts(A)}


@view("system")
def v_system(A) -> dict:
    import strength_sessions as ss
    dash = _dashboard(A)
    state = A.data_dir / ".refresh-state"
    as_of, warnings = ss.cache_status()
    return {"athlete": A.name, "display": A.display, "garmin_account": A.garmin.get("full_name"),
            "accent": (A.config.get("app") or {}).get("accent"),
            "refresh": state.read_text().split("\n") if state.exists() else None,
            "data_as_of": dash.get("generatedAt"), "cache": as_of, "warnings": warnings,
            "block": block(A), "cardio_targets": A.profile.get("cardio_targets")}


# --- CLI ---------------------------------------------------------------------------------------
def run_view(name: str, arg: str | None = None) -> dict:
    if name not in VIEWS:
        sys.exit(f"no view {name!r} (views: {', '.join(VIEWS)})")
    A = athlete.current()
    with contextlib.redirect_stdout(sys.stderr):   # stdout is the JSON, nothing else
        payload = VIEWS[name](A, arg) if arg is not None else VIEWS[name](A)
    return {"view": name, "athlete": A.name, "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
            **payload}


def main() -> None:
    if sys.argv[1:2] != ["attach"]:
        athlete.current()   # resolves the athlete first: it consumes --athlete before argparse sees it
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("view")
    p.add_argument("arg", nargs="?")
    p.add_argument("--session")
    args = p.parse_args()
    if args.view == "attach":
        print(json.dumps(attach(args.session or "")))
        return
    print(json.dumps(run_view(args.view, args.arg), default=str))


if __name__ == "__main__":
    main()
