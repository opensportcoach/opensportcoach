#!/usr/bin/env python3
"""Trips: the days an athlete is away from their usual setup, and what each of those days allows — written once.

    .venv/bin/python scripts/trips.py                    # every trip: where, when, what is there, questions, clashes
    .venv/bin/python scripts/trips.py on 2026-12-05      # where a day falls: home, or a trip day and what it allows
    .venv/bin/python scripts/trips.py check [--json]     # what clashes with a trip, and the maybes due an answer
    .venv/bin/python scripts/trips.py save --json '<trip>'          # add one, or replace it by id
    .venv/bin/python scripts/trips.py answer <id> <access> yes|no   # settle a maybe ("the bike fits")
    .venv/bin/python scripts/trips.py remove <id>
    .venv/bin/python scripts/trips.py home "<where>"                 # where home is (shown on the page)

WHY (2026-11-28, docs/DESIGN.md (trips)). The owner asked for it: at home he has his gym, his pool, his
bikes and his trainer; on a trip he may have only his running shoes, and on another his bike "if it fits
in the car". The daily and the week planner must plan each trip day with what that place has. What a
trip IS — where, the dates, what is there, how much time, when they leave and are back — is the
athlete's own (athletes/<name>/trips.json, through athlete.py → trips_path). What a day of it ALLOWS,
and what a session NEEDS, is here, once, for every athlete: the views, the daily, the week planner, the
plan-proposal contract and the tests all read on(), needs_of() and allows(), so no screen or skill
can decide it differently.

RULES THIS FILE KEEPS
  * What a session needs is keyed on its sport AND how it is done, never on the sport group: a Zwift
    ride and an outdoor ride are both "bike" in sports.py, yet one needs the trainer and the other the
    bike — the lookup defect CLAUDE.md lists first. And the watch's copy of a Zwift ride is a `cycling`
    workout, so a managed workout declares its own needs where its sport would say otherwise
    (athlete.json → workout_needs), as a plan.json session or a proposed day may (`needs`). A sport with
    no entry in NEEDS has no default: planned on a trip day it must say what it needs — never a guess
    (tests/run_tests.py::test_trip_rules_are_keyed_on_sport_and_how_it_is_done).
  * A maybe is a no until it is answered (the owner's call, 2026-11-28). Nothing is planned on
    something that may not be there; the daily asks for the answer from ASK_DAYS before the trip, so the
    week can be planned with it (questions()).
  * The first and last days are travel days: kept light — no intensity and no test (the owner's call,
    2026-11-28). The trip's own setup holds on them, unless the athlete says they leave after the morning
    or are back before the evening: then one session at home fits (`leave`, `back`).
  * Away from the gym, a gym day becomes a session that needs nothing — a bodyweight session, which
    passes the athlete's own tests like any other — or moves before or after the trip (the owner's call,
    2026-11-28; the skills say how). Nothing here writes a plan.
  * Trips never overlap, and every trip says yes, maybe or no for every place in ACCESS: nothing is
    assumed to be there (tests/run_tests.py::test_trips_are_well_formed).
  * No Garmin call. A clash on the watch is read from the cached calendar; fixing it is a push (/osc-push).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402
import formulas  # noqa: E402
import sports  # noqa: E402

# --- what a place has ------------------------------------------------------------------------------
# key → (what a person calls it, what it covers). Home has everything the athlete trains with; a trip
# says, for each of these, whether it is there.
ACCESS: dict[str, tuple[str, str]] = {
    "gym": ("Gym", "Your gym: the program's gym days, circuits on its machines, the treadmill."),
    "pool": ("Pool", "A pool to swim lengths in."),
    "bike": ("Bike", "Your own bike, to ride outdoors."),
    "trainer": ("Indoor trainer", "Your indoor trainer: Zwift and indoor rides."),
    "run": ("Running", "Somewhere to run."),
    "courts": ("Courts", "A court and someone to play with: tennis, padel."),
}
STATES = {
    "yes": "It is there.",
    "maybe": "Not sure yet: planned as not there until you confirm it.",
    "no": "It is not there.",
}
TIME = {
    "normal": "Time to train as at home.",
    "limited": "Limited time: short sessions, and every one optional — skipping one is not a miss.",
}
PARTS = ("morning", "afternoon", "evening")
# From this many days before a trip, a maybe is asked for every day until it is answered: the week
# around the trip is planned about a week ahead, and it needs the answer.
ASK_DAYS = 10
# Today shows a trip from this many days before it starts.
TODAY_DAYS = 21

# --- what a session needs ----------------------------------------------------------------------------
# Garmin typeKey → the places it needs. A typeKey with no entry has no default (None): on a trip day it
# must carry its own `needs`. An empty tuple needs nothing (a walk, mobility).
NEEDS: dict[str, tuple[str, ...]] = {
    "strength_training": ("gym",),
    # Circuits default to the gym: a HYROX simulation needs its sled, SkiErg and rower. A bodyweight
    # circuit says so in its own needs.
    "indoor_cardio": ("gym",), "hiit": ("gym",), "cardio_training": ("gym",),
    # A treadmill is the gym's; a virtual run is on one.
    "treadmill_running": ("gym",), "indoor_running": ("gym",), "virtual_run": ("gym",),
    "running": ("run",), "trail_running": ("run",), "track_running": ("run",),
    "cycling": ("bike",), "road_biking": ("bike",), "gravel_cycling": ("bike",), "mountain_biking": ("bike",),
    "virtual_ride": ("trainer",), "indoor_cycling": ("trainer",),
    "lap_swimming": ("pool",), "swimming": ("pool",),
    "tennis": ("courts",), "tennis_v2": ("courts",), "paddelball": ("courts",), "pickleball": ("courts",),
    "squash": ("courts",), "badminton": ("courts",),
    "walking": (), "hiking": (), "yoga": (), "mobility": (), "pilates": (),
}
# How it is done outranks the sport: an app that runs the session on the trainer (plan.json `platform`).
PLATFORM_NEEDS: dict[str, tuple[str, ...]] = {"zwift": ("trainer",)}
# A proposed day's `sport` (app/contracts/plan_proposal.schema.json) → what it needs; None: say it.
PROPOSAL_NEEDS: dict[str, tuple[str, ...] | None] = {
    "strength": ("gym",), "circuit": ("gym",), "run": ("run",), "bike": ("bike",), "zwift": ("trainer",),
    "swim": ("pool",), "tennis": ("courts",), "other": None,
}

RULES = {
    "home": "At home: your usual setup.",
    "away": "A trip day: only what this place has. A maybe counts as not there until you confirm it.",
    "travel": "A travel day: kept light — no intensity and no test — with only what the trip has, unless "
              "you leave after the morning or are back before the evening: then one session at home fits.",
}
DEFINITIONS = {
    "trip": "A trip is the days you are away from your usual setup, the first and last included. For each "
            "place — gym, pool, bike, indoor trainer, running, courts — it says yes, maybe or no.",
    "maybe": STATES["maybe"],
    "travel": RULES["travel"],
    "limited": TIME["limited"],
    "clash": "A session planned on a trip day that needs something the trip doesn't have, or a hard "
             "session or a test on a travel day. Read from your plan and the watch's calendar, with no Garmin call.",
    "no_gym": "Away from the gym, a gym day becomes a session that needs nothing — a bodyweight session — or "
              "moves to before or after the trip.",
}


# --- reading ---------------------------------------------------------------------------------------
def _date(day) -> dt.date:
    return day if isinstance(day, dt.date) else dt.date.fromisoformat(day)


def load(A=None) -> dict:
    """The athlete's trips file: {home, trips} with the trips in date order; empty without trips.json."""
    A = A or athlete.current()
    raw = json.loads(A.trips_path.read_text()) if A.trips_path.exists() else {}
    return {**raw, "home": raw.get("home"), "trips": sorted(raw.get("trips") or [], key=lambda t: t["from"])}


def trips_of(A=None) -> list[dict]:
    return load(A)["trips"]


def days_of(trip: dict) -> list[dict]:
    """Every day of the trip, in order: {date, day, of, travel: leave · back · both · None, home}.
    `home` names the part of a travel day the home setup is reachable — before leaving in the
    afternoon or evening, after being back in the morning or afternoon — else None."""
    a, b = _date(trip["from"]), _date(trip["to"])
    n = (b - a).days + 1
    out = []
    for i in range(n):
        d = a + dt.timedelta(days=i)
        travel = "both" if n == 1 else "leave" if i == 0 else "back" if i == n - 1 else None
        home = None
        if travel in ("leave", "both") and trip.get("leave") in ("afternoon", "evening"):
            home = "before you leave"
        elif travel in ("back", "both") and trip.get("back") in ("morning", "afternoon"):
            home = "after you are back"
        out.append({"date": d.isoformat(), "day": i + 1, "of": n, "travel": travel, "home": home})
    return out


def trip_on(day, trips: list[dict]) -> dict | None:
    iso = _date(day).isoformat()
    return next((t for t in trips if t["from"] <= iso <= t["to"]), None)


def next_trip(trips: list[dict], day=None) -> dict | None:
    """The first trip that has not ended by `day` (today by default): the one under way, or the next."""
    iso = _date(day or dt.date.today()).isoformat()
    return next((t for t in trips if t["to"] >= iso), None)


def on(day=None, trips: list[dict] | None = None) -> dict:
    """Where `day` falls — the one function the views, the daily, the week planner and the tests read:
    {away, trip, day, of, travel, home, access, time, rule, next, days_to}.

    away: on a trip. `access` is the trip's own (yes · maybe · no for every place in ACCESS), or None at
    home. `home` names the part of a travel day the home setup is reachable, or None. `next` is the
    trip under way or the next one, `days_to` the days to its first day (0 or less once it started)."""
    day = _date(day or dt.date.today())
    trips = trips_of() if trips is None else trips
    t = trip_on(day, trips)
    nxt = next_trip(trips, day)
    base = {"next": nxt, "days_to": (_date(nxt["from"]) - day).days if nxt else None}
    if not t:
        return {"away": False, "trip": None, "day": None, "of": None, "travel": None, "home": None,
                "access": None, "time": None, "rule": RULES["home"], **base}
    x = next(x for x in days_of(t) if x["date"] == day.isoformat())
    return {"away": True, "trip": t, "day": x["day"], "of": x["of"], "travel": x["travel"], "home": x["home"],
            "access": dict(t["access"]), "time": t.get("time") or "normal",
            "rule": RULES["travel" if x["travel"] else "away"], **base}


# --- what a session needs, and whether a day has it ---------------------------------------------------
def _clean(needs) -> tuple[str, ...]:
    return tuple(dict.fromkeys(needs))


def needs_of(session: dict, A=None) -> tuple[str, ...] | None:
    """What a plan.json session needs: its own `needs`; else what runs it (`platform`); else what its
    managed `workout` declares (athlete.json → workout_needs); else its sport's default. None: unknown."""
    if session.get("needs") is not None:
        return _clean(session["needs"])
    if session.get("platform") in PLATFORM_NEEDS:
        return PLATFORM_NEEDS[session["platform"]]
    if session.get("workout") and A is not None and session["workout"] in A.workout_needs:
        return _clean(A.workout_needs[session["workout"]])
    return NEEDS.get(session.get("sport") or "")


def workout_needs(key: str | None, sport: str | None, A=None) -> tuple[str, ...] | None:
    """What a watch workout needs: what it declares (athlete.json → workout_needs), else its sport's."""
    if key and A is not None and key in A.workout_needs:
        return _clean(A.workout_needs[key])
    return NEEDS.get(sport or "")


def proposal_needs(day: dict, A=None) -> tuple[str, ...] | None:
    """What a proposed day (app/contracts/plan_proposal) needs: its own `needs`; else the managed workout
    it names, where that declares its own; else its sport (a session with none is a gym day; a rest day
    needs nothing)."""
    if day.get("needs") is not None:
        return _clean(day["needs"])
    if day.get("type") == "rest":
        return ()
    if day.get("workout_key") and A is not None and day["workout_key"] in A.workout_needs:
        return _clean(A.workout_needs[day["workout_key"]])
    sport = day.get("sport") or ("strength" if day.get("type") == "session" else "other")
    return PROPOSAL_NEEDS.get(sport)


def allows(needs: tuple[str, ...] | None, access: dict | None) -> dict:
    """Whether a place has what a session needs: {ok, missing (no), unsure (maybe), unknown}. At home
    (access None) everything is there. A maybe is a no until it is answered."""
    if access is None:
        return {"ok": True, "missing": [], "unsure": [], "unknown": False}
    if needs is None:
        return {"ok": False, "missing": [], "unsure": [], "unknown": True}
    missing = [k for k in needs if access.get(k) == "no"]
    unsure = [k for k in needs if access.get(k) == "maybe"]
    return {"ok": not missing and not unsure, "missing": missing, "unsure": unsure, "unknown": False}


def day_allows(needs, p: dict) -> dict:
    """allows() on the day on() describes: a travel day with a part at home allows everything once."""
    return allows(needs, None if (not p["away"] or p["home"]) else p["access"])


def labels(keys) -> str:
    """["gym", "bike"] → "gym and bike"."""
    words = [ACCESS[k][0].lower() for k in keys]
    return " and ".join(words) if len(words) < 3 else ", ".join(words[:-1]) + " and " + words[-1]


def what_is_there(trip: dict) -> dict:
    """{yes: [...], maybe: [...], no: [...]} — the trip's places by state, in ACCESS order."""
    a = trip.get("access") or {}
    return {s: [k for k in ACCESS if a.get(k) == s] for s in STATES}


# --- clashes -------------------------------------------------------------------------------------------
def _why(where: str, res: dict, hard: bool) -> str:
    """Why a session clashes, in words: what the place lacks, and/or the travel day's rule."""
    parts = []
    if res["unknown"]:
        parts.append(f"the engine can't tell what it needs: say it (`needs`) on a {where} day")
    if res["missing"]:
        parts.append(f"no {labels(res['missing'])} in {where}")
    if res["unsure"]:
        parts.append(f"{labels(res['unsure'])} in {where} is a maybe until you confirm it")
    if hard:
        parts.append("a travel day is kept light: no intensity and no test")
    return " · ".join(parts)


def clashes(A=None, start=None, *, trips: list[dict] | None = None, plan: list[dict] | None = None,
            scheduled: list[dict] | None = None, benchmarks: list[dict] | None = None,
            names: dict | None = None) -> list[dict]:
    """Every session from `start` (today) on that a trip day can't hold, one row each:
    {date, source: plan · watch · benchmark, title, sport, needs, missing, unsure, unknown, why, trip,
    where, on_watch}. Read from plan.json, the cached Garmin calendar (data/<name>/scheduled.json) and
    program.py → BENCHMARKS — no Garmin call. A plan session that stands for a watch entry (it names its
    workout, on its day) is one row, `on_watch` true: fixing it is a push. On a travel day a hard session
    (formulas.HARD_INTENTS) or a test clashes too."""
    A = A or athlete.current()
    start = _date(start or dt.date.today()).isoformat()
    trips = trips_of(A) if trips is None else trips
    if not trips:
        return []
    if plan is None:
        plan = (json.loads(A.plan_path.read_text()).get("sessions") or []) if A.plan_path.exists() else []
    if scheduled is None:
        f = A.data_dir / "scheduled.json"
        scheduled = (json.loads(f.read_text()) if f.exists() else []) or []
    if benchmarks is None:
        benchmarks = getattr(A.program, "BENCHMARKS", None) or []
    if names is None:   # managed key → the name its workout carries on Garmin
        names = {}
        for key in A.managed:
            f = A.workouts_dir / f"{key}.json"
            if f.exists():
                names[key] = (json.loads(f.read_text()).get("workoutName") or "").strip()
    by_name = {v: k for k, v in names.items()}
    out = []

    def add(date, source, title, sport, needs, hard=False, on_watch=False):
        p = on(date, trips)
        if not p["away"]:
            return
        res = day_allows(needs, p)
        hard = hard and bool(p["travel"])
        if res["ok"] and not hard:
            return
        t = p["trip"]
        out.append({"date": date, "source": source, "title": title, "sport": sport,
                    "needs": list(needs) if needs is not None else None,
                    **{k: res[k] for k in ("missing", "unsure", "unknown")}, "hard": hard,
                    "why": _why(t["where"], res, hard), "trip": t["id"], "where": t["where"],
                    "travel": p["travel"], "on_watch": on_watch})

    watch_days = {(i.get("date"), (i.get("title") or "").strip()) for i in scheduled}
    covered = set()
    for s in plan:
        if s.get("date", "") < start:
            continue
        key = (s["date"], names.get(s.get("workout"), "")) if s.get("workout") else None
        on_watch = bool(key and key in watch_days)
        if on_watch:
            covered.add(key)
        add(s["date"], "plan", s.get("title"), s.get("sport"), needs_of(s, A),
            hard=s.get("intent") in formulas.HARD_INTENTS, on_watch=on_watch)
    for i in scheduled:
        d, title = i.get("date") or "", (i.get("title") or "").strip()
        if d < start or (d, title) in covered:
            continue
        add(d, "watch", title, i.get("sportTypeKey"), workout_needs(by_name.get(title), i.get("sportTypeKey"), A),
            on_watch=True)
    for b in benchmarks:
        if b.get("due") and b["due"] >= start:
            add(b["due"], "benchmark", b.get("name") or b.get("id"), b.get("sport"),
                workout_needs(None, b.get("sport"), A), hard=True)
    return sorted(out, key=lambda c: (c["date"], c["source"] != "benchmark", c["title"] or ""))


# --- the maybes --------------------------------------------------------------------------------------
QUESTION = {
    "gym": "Will you have a gym in {where}?", "pool": "Will you have a pool in {where}?",
    "bike": "Is your bike coming to {where}?", "trainer": "Is your indoor trainer coming to {where}?",
    "run": "Will you be able to run in {where}?", "courts": "Will you have a court in {where}?",
}


def questions(trips: list[dict], day=None) -> list[dict]:
    """Every maybe on a trip that has not ended: {trip, where, access, label, question, ask_from, due}.
    `due` from ASK_DAYS before the trip on: then the daily asks it, and Today shows it, until answered."""
    day = _date(day or dt.date.today())
    out = []
    for t in trips:
        if _date(t["to"]) < day:
            continue
        ask_from = _date(t["from"]) - dt.timedelta(days=ASK_DAYS)
        for k in ACCESS:
            if (t.get("access") or {}).get(k) == "maybe":
                out.append({"trip": t["id"], "where": t["where"], "from": t["from"], "to": t["to"], "access": k,
                            "label": ACCESS[k][0], "question": QUESTION[k].format(where=t["where"]),
                            "ask_from": ask_from.isoformat(), "due": day >= ask_from})
    return out


# --- writing -------------------------------------------------------------------------------------------
TRIP_KEYS = {"id", "where", "from", "to", "access", "time", "leave", "back", "note", "answered"}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")


def problems(trip: dict, others: list[dict] = ()) -> list[str]:
    """Everything wrong with one trip, against the athlete's other trips. Empty = it can be saved."""
    out = []
    unknown = set(trip) - TRIP_KEYS
    if unknown:
        out.append(f"unknown fields {sorted(unknown)}")
    if not ID_RE.match(str(trip.get("id") or "")):
        out.append(f"id {trip.get('id')!r} is not a lowercase slug")
    if not str(trip.get("where") or "").strip() or len(str(trip.get("where"))) > 60:
        out.append("a trip names where it is (at most 60 characters)")
    try:
        a, b = _date(trip.get("from") or ""), _date(trip.get("to") or "")
        if b < a:
            out.append(f"it ends ({b}) before it starts ({a})")
        elif (b - a).days > 365:
            out.append("a trip of more than a year is a move: change your home setup instead")
    except (TypeError, ValueError):
        out.append("from and to are dates (YYYY-MM-DD)")
        a = b = None
    acc = trip.get("access")
    if not isinstance(acc, dict):
        out.append("access says yes, maybe or no for every place")
    else:
        if set(acc) != set(ACCESS):
            out.append(f"access must say yes, maybe or no for each of {list(ACCESS)} — "
                       f"missing {sorted(set(ACCESS) - set(acc))}, unknown {sorted(set(acc) - set(ACCESS))}")
        bad = {k: v for k, v in acc.items() if v not in STATES}
        if bad:
            out.append(f"access states must be yes, maybe or no: {bad}")
    if trip.get("time") is not None and trip["time"] not in TIME:
        out.append(f"time {trip['time']!r} is not one of {list(TIME)}")
    for k in ("leave", "back"):
        if trip.get(k) is not None and trip[k] not in PARTS:
            out.append(f"{k} {trip[k]!r} is not one of {list(PARTS)}")
    if trip.get("note") is not None and (not isinstance(trip["note"], str) or len(trip["note"]) > 300):
        out.append("note is text, at most 300 characters")
    ans = trip.get("answered") or {}
    if not isinstance(ans, dict) or not set(ans) <= set(ACCESS):
        out.append("answered maps a place to the date its maybe was settled")
    elif isinstance(acc, dict):
        for k, d in ans.items():
            try:
                _date(d)
            except (TypeError, ValueError):
                out.append(f"answered.{k} {d!r} is not a date")
            if acc.get(k) == "maybe":
                out.append(f"{k} is answered, yet still a maybe")
    if a and b:
        for o in others:
            if o.get("id") != trip.get("id") and o["from"] <= b.isoformat() and a.isoformat() <= o["to"]:
                out.append(f"it overlaps {o['where']} ({o['from']} → {o['to']}): a day is in one trip at most")
    return out


def slug(where: str, start: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", where.lower()).strip("-")[:36] or "trip"
    return f"{base}-{start[:7]}"


def _write(A, data: dict) -> None:
    path = A.trips_path
    tmp = path.with_suffix(path.suffix + ".tmp")
    order = ("id", "where", "from", "to", "access", "time", "leave", "back", "note", "answered")
    data = {"_why": data.get("_why") or "Trips (docs/DESIGN.md (trips)): the days away from the usual setup, "
                                        "and what each place has. scripts/trips.py holds the rules.",
            "home": data.get("home"),
            "trips": [{k: t[k] for k in order if k in t} for t in sorted(data["trips"], key=lambda t: t["from"])]}
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def save(trip: dict, A=None) -> dict:
    """Add a trip, or replace the one with its id. Without an id it gets one from where and when.
    Raises ValueError with every problem; nothing is written then."""
    A = A or athlete.current()
    data = load(A)
    # An empty field is no field (the form sends null for "not said"); `answered` is this file's to keep.
    trip = {k: v for k, v in trip.items() if v is not None and v != "" and k != "answered"}
    if isinstance(trip.get("where"), str):
        trip["where"] = trip["where"].strip()
    if not trip.get("id") and trip.get("where") and trip.get("from"):
        base, n = slug(trip["where"], trip["from"]), 2
        trip["id"] = base
        while any(t["id"] == trip["id"] for t in data["trips"]):
            trip["id"], n = f"{base}-{n}", n + 1
    old = next((t for t in data["trips"] if t["id"] == trip.get("id")), None)
    if old:   # a place that was a maybe and is now settled keeps the day it was settled
        ans = dict(old.get("answered") or {})
        for k, v in (trip.get("access") or {}).items():
            if v != "maybe" and (old.get("access") or {}).get(k) == "maybe":
                ans[k] = dt.date.today().isoformat()
            if v == "maybe":
                ans.pop(k, None)
        if ans:
            trip["answered"] = ans
    bad = problems(trip, data["trips"])
    if bad:
        raise ValueError("; ".join(bad))
    data["trips"] = [t for t in data["trips"] if t["id"] != trip["id"]] + [trip]
    _write(A, data)
    return trip


def answer(trip_id: str, key: str, state: str, A=None) -> dict:
    """Settle a maybe: the place is there (yes) or not (no), recorded with today's date."""
    A = A or athlete.current()
    t = next((t for t in trips_of(A) if t["id"] == trip_id), None)
    if t is None:
        raise ValueError(f"no trip {trip_id!r}")
    if key not in ACCESS:
        raise ValueError(f"{key!r} is not one of {list(ACCESS)}")
    if state not in ("yes", "no"):
        raise ValueError("an answer is yes or no")
    if t["access"].get(key) != "maybe":
        raise ValueError(f"{ACCESS[key][0]} in {t['where']} is already {t['access'].get(key)}, not a maybe")
    return save({**t, "access": {**t["access"], key: state}}, A)


def set_home(where: str | None, A=None) -> dict | None:
    """Where home is — the usual setup every trip is away from. Shown on the page; changes no rule."""
    A = A or athlete.current()
    where = (where or "").strip()
    if len(where) > 60:
        raise ValueError("home is at most 60 characters")
    data = load(A)
    data["home"] = {"where": where} if where else None
    _write(A, data)
    return data["home"]


def remove(trip_id: str, A=None) -> dict:
    A = A or athlete.current()
    data = load(A)
    t = next((t for t in data["trips"] if t["id"] == trip_id), None)
    if t is None:
        raise ValueError(f"no trip {trip_id!r}")
    data["trips"] = [x for x in data["trips"] if x["id"] != trip_id]
    _write(A, data)
    return t


# --- CLI ----------------------------------------------------------------------------------------------
def _fmt(day: str) -> str:
    return dt.date.fromisoformat(day).strftime("%a %d %b %Y")


def _line(t: dict) -> str:
    w = what_is_there(t)
    parts = [labels(w["yes"]) if w["yes"] else "nothing"]
    if w["maybe"]:
        parts.append(f"maybe {labels(w['maybe'])}")
    if w["no"]:
        parts.append(f"no {labels(w['no'])}")
    extra = [f"time {t['time']}" if t.get("time") else None, f"leave {t['leave']}" if t.get("leave") else None,
             f"back {t['back']}" if t.get("back") else None]
    return " · ".join(parts + [x for x in extra if x])


def _where(p: dict) -> str:
    if not p["away"]:
        nxt = p["next"]
        return "home." + (f" Next trip: {nxt['where']} in {p['days_to']} days ({_fmt(nxt['from'])})." if nxt else "")
    t = p["trip"]
    travel = {"leave": " · you leave", "back": " · you are back", "both": " · out and back"}.get(p["travel"], "")
    home = f" · home setup {p['home']}" if p["home"] else ""
    return f"{t['where']}, day {p['day']} of {p['of']}{travel}{home} — {_line(t)}."


def main() -> None:
    A = athlete.current()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("what", nargs="?", choices=("list", "on", "check", "save", "answer", "remove", "home"), default="list")
    ap.add_argument("args", nargs="*")
    ap.add_argument("--json", nargs="?", const=True, default=None,
                    help="print JSON; with `save`, the trip as JSON")
    a = ap.parse_args()
    today = dt.date.today()
    try:
        if a.what == "save":
            if not isinstance(a.json, str):
                sys.exit("REFUSED: save takes the trip as --json '<trip>'")
            try:
                trip = json.loads(a.json)
            except json.JSONDecodeError as e:
                sys.exit(f"REFUSED: the trip is not JSON ({e})")
            if not isinstance(trip, dict):
                sys.exit("REFUSED: the trip is a JSON object")
            t = save(trip, A)
            n = len([c for c in clashes(A, today) if c["trip"] == t["id"]])
            print(f"Saved {t['where']}, {_fmt(t['from'])} → {_fmt(t['to'])}"
                  + (f" · {n} session{'s' if n != 1 else ''} clash with it" if n else ""))
            return
        if a.what == "answer":
            if len(a.args) != 3:
                sys.exit("REFUSED: answer <trip id> <place> yes|no")
            t = answer(*a.args, A=A)
            print(f"Saved: {ACCESS[a.args[1]][0]} in {t['where']} is {a.args[2]}")
            return
        if a.what == "home":
            h = set_home(" ".join(a.args), A)
            print(f"Saved: home is {h['where']}" if h else "Saved: no home place")
            return
        if a.what == "remove":
            if len(a.args) != 1:
                sys.exit("REFUSED: remove <trip id>")
            t = remove(a.args[0], A)
            print(f"Removed {t['where']}, {_fmt(t['from'])} → {_fmt(t['to'])}")
            return
    except ValueError as e:
        sys.exit(f"REFUSED: {e}")
    trips = trips_of(A)
    if a.what == "on":
        day = a.args[0] if a.args else today.isoformat()
        p = on(day, trips)
        if a.json:
            print(json.dumps({**p, "trip": p["trip"] and p["trip"]["id"], "next": p["next"] and p["next"]["id"]}, indent=1))
            return
        print(f"{_fmt(day)}: {_where(p)}\n  {p['rule']}")
        if p["away"] and p["time"] == "limited":
            print(f"  {TIME['limited']}")
        if p["away"] and p["trip"].get("note"):   # what they said about the place, for the session the coach writes
            print(f"  Their note: {p['trip']['note']}")
        return
    if a.what == "check":
        out = {"clashes": clashes(A, today), "questions": [q for q in questions(trips, today) if q["due"]]}
        if a.json:
            print(json.dumps(out, indent=1))
            return
        if not out["clashes"] and not out["questions"]:
            print("No clash, and no question due.")
        for c in out["clashes"]:
            print(f"{c['date']}  {c['source']:<9} {c['title']}: {c['why']}{' · on the watch' if c['on_watch'] else ''}")
        for q in out["questions"]:
            print(f"ask  {q['question']} ({q['from']} → {q['to']})")
        return
    if not trips:
        print(f"{A.display}: no trips ({A.trips_path.name} is absent or empty).")
        return
    print(f"{A.display}'s trips · {len(trips)} · today {today}")
    for t in trips:
        to = (_date(t["from"]) - today).days
        when = f"in {to} d" if to > 0 else "now" if _date(t["to"]) >= today else "past"
        print(f"  {_fmt(t['from'])} → {_fmt(t['to'])}  {t['where']:<16} {when:<8} {_line(t)}")
        if t.get("note"):
            print(f"      note: {t['note']}")
    for q in questions(trips, today):
        print(f"  ? {q['question']}{' — ask now' if q['due'] else ' — ask from ' + q['ask_from']}")
    cs = clashes(A, today)
    for c in cs:
        print(f"  ! {c['date']} {c['title']} ({c['source']}): {c['why']}")
    print(f"Today: {_where(on(today, trips))}")


if __name__ == "__main__":
    main()
