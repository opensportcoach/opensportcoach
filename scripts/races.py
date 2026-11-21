#!/usr/bin/env python3
"""The race season's rules, written once — every athlete's races are read through this file.

    .venv/bin/python scripts/races.py                  # the season: days to go, windows, checks
    .venv/bin/python scripts/races.py on 2026-11-11    # where a day falls: build · easy · taper · race · recovery
    .venv/bin/python scripts/races.py check [--json]   # the races whose online check is due — no network

WHY (2026-10-15, docs/DESIGN.md (races)). An athlete entered four races with targets, and the daily and the week
planner must respect the days around each one. What a race IS — its date, format, target, priority,
every check of its date, its result — is the athlete's own (athletes/<name>/races.json, through
athlete.py → races_path). What the days around it ALLOW is here, once, for every athlete: the views,
the daily, the week planner and the tests all read phase_on() and WINDOWS, so no screen or skill can
count the days differently.

RULES THIS FILE KEEPS
  * Windows are keyed on kind AND priority. Keyed on the kind alone, a B half would get an A taper —
    the lookup defect CLAUDE.md lists first. A (kind, priority) with no default must give its own
    windows, and a race keeps a `windows` entry only where it differs from the default
    (tests/run_tests.py::test_races_are_well_formed).
  * No network. `check` lists what is due from the dates alone; the skill goes online for those only.
  * A date is never changed here, and never silently: a check that finds another date is recorded as
    `differs` and asked about (tests/run_tests.py::test_a_race_date_is_never_overwritten_silently).
  * The marks are keyed by series, here: the app has no second registry (docs/DESIGN.md (races) §5).
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
import sports  # noqa: E402

# --- what a race is -----------------------------------------------------------------------------
# kind → what a person calls it, its icon (a key app/web/src/components/SportIcon.tsx draws), and the
# Garmin typeKeys its result is logged under, which the result finder matches on race day. Every key
# must be in sports.py: a new one (a HYROX typeKey, say) goes there first, and its test catches a miss.
RACE_KINDS: dict[str, dict] = {
    # His HYROX sim (2026-08-30) was logged as indoor_cardio; HIIT and Cardio are the other circuits.
    "hyrox": {"label": "HYROX", "icon": "circuit", "type_keys": ("indoor_cardio", "hiit", "cardio_training"),
              # The race's own format, in order, each after a 1 km run (hyrox.com, 2026-10-15). A race's
              # `format.loads` gives the weights for its division; its `split` says who takes each one.
              "stations": (("skierg", "SkiErg", "1,000 m", None), ("sled_push", "Sled push", "50 m", "sled_push_kg"),
                           ("sled_pull", "Sled pull", "50 m", "sled_pull_kg"),
                           ("burpee_broad_jump", "Burpee broad jumps", "80 m", None), ("row", "Row", "1,000 m", None),
                           ("farmers_carry", "Farmers carry", "200 m", "farmers_kg_per_hand"),
                           ("sandbag_lunges", "Sandbag lunges", "100 m", "sandbag_kg"),
                           ("wall_balls", "Wall balls", "100 reps", "wall_ball_kg")),
              # A result's splits (below): the runs, the stations, and the roxzone between them.
              "split_by": "stations", "splits": (("runs", "Runs"), ("stations", "Stations"), ("roxzone", "Roxzone"))},
    "half_marathon": {"label": "Half marathon", "icon": "run", "type_keys": ("running",)},
    "gravel": {"label": "Gravel race", "icon": "bike",
               "type_keys": ("gravel_cycling", "cycling", "road_biking", "mountain_biking")},
    "triathlon_70_3": {"label": "Triathlon 70.3", "icon": "race", "type_keys": ("multi_sport",),
                       "split_by": "legs", "splits": (("swim", "Swim"), ("t1", "T1"), ("bike", "Bike"), ("t2", "T2"),
                                                      ("run", "Run")),
                       # Against a reference, the two transitions as one: a reference read off a summary
                       # (a past race's, typed by hand) often has only their sum.
                       "compare": (("swim", "Swim", ("swim",)), ("bike", "Bike", ("bike",)), ("run", "Run", ("run",)),
                                   ("transitions", "T1 + T2", ("t1", "t2")))},
}

# A or B (C, trained straight through, is left for later — docs/DESIGN.md (races) §1).
PRIORITIES = {
    "A": "An A race: a full taper, and the season peaks for it.",
    "B": "A B race: a hard day with a few easy days around it — no taper, and no block built to peak "
         "for it. Not unprepared: the block before still trains what the race needs.",
}
ENTRY = ("intending", "entered", "done", "dns", "dnf")
STATUS = ("confirmed", "differs", "unconfirmed")
# The organiser's page first; a listing only when that fails; his entry outranks any listing (§3).
SOURCE_KINDS = ("official", "entry", "listing")

# --- the days around a race ---------------------------------------------------------------------
# In calendar days next to race day. The defaults, approved as proposed on 2026-10-15
# (docs/DESIGN.md (races) → Decided); a race overrides any of them in its own `windows`.
#   easy_before          easy days right before the race
#   taper                taper days right before an A race (instead of easy days)
#   recovery_after       recovery days right after the race
#   no_intensity_after   of those, how many hold no intensity at all (absent: every one)
WINDOW_KEYS = ("easy_before", "taper", "recovery_after", "no_intensity_after")
WINDOWS: dict[tuple[str, str], dict] = {
    ("hyrox", "B"): {"easy_before": 2, "recovery_after": 3},
    ("half_marathon", "B"): {"easy_before": 3, "recovery_after": 5},
    ("gravel", "B"): {"easy_before": 2, "recovery_after": 4},
    ("triathlon_70_3", "A"): {"taper": 14, "recovery_after": 10, "no_intensity_after": 7},
}
WINDOWS_APPROVED = "2026-10-15"

# What each day may hold — the sentence the app shows beside it and the daily obeys.
WINDOW = {
    "build": "No race window: the block's own training.",
    "easy": "An easy day before a race: no sprints, VO2 work, threshold work or tests, and no heavy legs. "
            "Easy aerobic work, mobility and a lighter upper-body gym day are fine.",
    "taper": "A taper day before an A race: the volume comes down by about half over the taper, and "
             "short race-pace efforts stay in.",
    "race": "Race day: the race, its warm-up and its fuelling, and nothing else.",
    "recovery": "A recovery day after a race: no intensity, and no long ride or long run. Easy aerobic "
                "work and mobility, and a light gym day from the second day. After an A race, short "
                "intensity may come back once its no-intensity days are over.",
}
WINDOWS_DEFINITION = ("Race windows are counted in calendar days next to race day, from defaults per kind "
                      "and priority that the athlete approved; a race may override them.")
# A countdown line shows in the brief and on Today from 8 weeks out (docs/DESIGN.md (races) §4).
COUNTDOWN_DAYS = 56
COUNTDOWN_DEFINITION = f"Days to race day; the countdown shows from {COUNTDOWN_DAYS // 7} weeks out."

# --- the prediction -----------------------------------------------------------------------------
# kind → the field of Garmin's race predictor that predicts it (docs/DESIGN.md (races) phase 6). Garmin predicts
# 5 km, 10 km, the half and the marathon only; every other kind has no prediction until a benchmark and a
# formula in formulas.py give one — and with neither the page reads "not tested yet", never a guess.
# pull_health.py caches a year of Garmin's predictions, one a day, for an athlete with a race season.
GARMIN_PREDICTOR = {"half_marathon": "timeHalfMarathon"}
PREDICTION_TREND_EVERY = 7        # a point a week back from the latest, for the trend line
PREDICTION_DEFINITION = ("Predicted only from data: Garmin's own race predictor for run distances (5 km to the "
                         "marathon), the latest day it has, with its best of the past year and a weekly trend. "
                         "Garmin predicts a fresh race, not one run off the bike. With no predictor and no "
                         "benchmark-based estimate, it reads \"not tested yet\".")

# --- the result's splits ------------------------------------------------------------------------------
# A race's time by discipline (docs/DESIGN.md (races) phase 6), read from its Garmin activity in the cache — never
# typed in. Each split is a leg's or a lap's ELAPSED time — the race clock, as a race result is (the
# osc-race skill records the elapsed time) — so together they make the result. Not the timer: on his
# one 70.3 the bike's timer stood still for 2:22 that the race clock counted, and its laps' timer
# times add up to neither (pulled 2026-10-15). A set has only its duration, and the sets tile the session.
#   * legs (a triathlon): a multisport activity is one parent in the activity list, and its legs are child
#     activities (sports.legs) that pull_activities.py pulls with their sport and time. Swim, bike and run
#     in that order; a transition leg after the swim is T1, after the bike T2.
#   * stations (HYROX): eight runs, each followed by its station, and the roxzone between them. From the
#     legs of a repeating multisport (a run leg, a station leg, a transition leg the roxzone); else from
#     the activity's laps, when their count fits the format exactly — a lap per run and per station, or
#     a roxzone lap between each two — and none is too short to be a run or a station; else from its
#     exercise sets, which name each segment's exercise (RUN is a run; a rest set is the roxzone).
# A recording that fits none of these gives no splits: the page shows the time alone, never a guess.
SPLITS_MIN_S = 30     # no 1 km run and no HYROX station takes less: a lap that short is a mis-press
SPLITS_FROM = {"legs": "the legs of its Garmin multisport activity", "laps": "its Garmin activity's laps",
               "sets": "its Garmin activity's exercise sets"}
SPLITS_DEFINITION = ("A race's splits are read from its Garmin activity, never typed in: a triathlon's from the "
                     "legs of its multisport activity (swim, T1, bike, T2, run), a HYROX's from the legs, the laps "
                     "or the exercise sets that split it into its runs, its stations and the roxzone between them. "
                     "Each is that part's elapsed time — the race clock — so they add up to the race's elapsed "
                     "time. A recording that doesn't fit the race's format gives none — never a guess.")

# --- when a date is due a check ------------------------------------------------------------------
CHECK_EVERY = 30                  # days between checks, far from the race
CHECK_CLOSE, CHECK_CLOSE_EVERY = 21, 7    # within 3 weeks of the race: weekly
CHECK_START = 4                   # within 4 days: once more, when start times appear (~3 days out)
CHECK_DEFINITION = (f"A race's date is due an online check when it was never checked, when the last check "
                    f"is more than {CHECK_EVERY} days old, when the race is within {CHECK_CLOSE} days and the "
                    f"last check more than {CHECK_CLOSE_EVERY} days old, and once within {CHECK_START} days "
                    "of it, when start times appear. A past race is due its result until one is recorded.")

# --- the marks --------------------------------------------------------------------------------------
# series → the event's own mark, keyed by series, while which races an athlete runs stays theirs. Each mark
# has a `wordmark` and an `icon`, each {file, draw} or None, the brand's `colours` (hex), its `source`, its
# trademark `note`, and a `suffix` the page sets beside a brand's own wordmark ("70.3"). The page asks for
# /<file>; Vite copies app/web/public/ into the build. tests/run_tests.py holds every named file to exist.
MARK_DRAW = {
    "mask": "A single-colour mark, drawn as a mask filled with the text colour, so it reads in both themes.",
    "image": "A full-colour mark, drawn as it is.",
}
MARKS_ROOT = athlete.REPO_ROOT / "app" / "web" / "public"
# THE ENGINE SHIPS NO MARKS. Event logos are their owners' trademarks, so they are never committed to the
# public repository: an athlete who wants them keeps them on their own machine, in app/web/public/marks/
# (gitignored) with a marks.json beside them, {"marks": {series: {label, wordmark, icon, colours, source,
# note, suffix?}}}. Without it every race draws the fallback: its kind's icon and a monogram.
MARKS_FILE = MARKS_ROOT / "marks" / "marks.json"


def _local_marks() -> dict[str, dict]:
    try:
        return json.loads(MARKS_FILE.read_text()).get("marks") or {}
    except (OSError, ValueError):
        return {}


MARKS: dict[str, dict] = _local_marks()
ARTICLES = {"the", "la", "el", "le", "les", "de", "del"}


# --- reading ---------------------------------------------------------------------------------------
def load(A=None) -> list[dict]:
    """The athlete's races, in date order; [] when races.json is absent (no races, like plan.json)."""
    A = A or athlete.current()
    if not A.races_path.exists():
        return []
    return sorted(json.loads(A.races_path.read_text()).get("races") or [], key=lambda r: r["date"])


def _date(day) -> dt.date:
    return day if isinstance(day, dt.date) else dt.date.fromisoformat(day)


def seconds(hms: str) -> int:
    """'1:15:00' or '24:10' → seconds. Raises ValueError on anything else."""
    parts = str(hms).split(":")
    if not 2 <= len(parts) <= 3 or not all(p.isdigit() for p in parts) or any(int(p) > 59 for p in parts[1:]):
        raise ValueError(f"{hms!r} is not a time (h:mm:ss or mm:ss)")
    total = 0
    for p in parts:
        total = total * 60 + int(p)
    return total


def clock(s: float) -> str:
    """Seconds → '2:44:25' or '7:30', the inverse of seconds()."""
    h, rest = divmod(round(s), 3600)
    m, sec = divmod(rest, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def monogram(name: str) -> str:
    """Two letters for a race with no mark: the initials of its first two words, articles and numbers
    skipped ("City Half Marathon" → CH), or the first two letters of a lone word ("The Gravel 100" → GR)."""
    words = [w for w in re.findall(r"[^\W\d_][\w'’.-]*", name) if w.lower() not in ARTICLES]
    if not words:
        return (name.strip()[:2] or "?").upper()
    return (words[0][0] + words[1][0] if len(words) > 1 else words[0][:2]).upper()


# --- the prediction --------------------------------------------------------------------------------
def prediction(race: dict, A=None) -> dict | None:
    """Garmin's predicted time for a run race, from the athlete's cached predictor (data/<name>/
    race_predictions.json): the latest day's value, the year's best, and a point a week for the trend,
    oldest first — with the gap to the target when there is one. None for a kind Garmin does not
    predict, or with no cached prediction: the page reads "not tested yet", never a guess."""
    field = GARMIN_PREDICTOR.get(race.get("kind"))
    if not field:
        return None
    A = A or athlete.current()
    path = A.data_dir / "race_predictions.json"
    days = sorted((d for d in (json.loads(path.read_text()) if path.exists() else []) or []
                   if d.get(field) and d.get("calendarDate")), key=lambda d: d["calendarDate"])
    if not days:
        return None
    last, best = days[-1], min(days, key=lambda d: d[field])
    under = (race.get("target") or {}).get("under")
    return {"value_s": last[field], "source": "garmin", "as_of": last["calendarDate"],
            "vs_target_s": last[field] - seconds(under) if under else None,
            "best": {"value_s": best[field], "date": best["calendarDate"]},
            "trend": [{"date": d["calendarDate"], "value_s": d[field]}
                      for d in days[::-1][::PREDICTION_TREND_EVERY][::-1]]}


# --- the result's splits ---------------------------------------------------------------------------
def _cached(A, aid, what: str):
    path = A.data_dir / f"activity_{aid}_{what}.json"
    return json.loads(path.read_text()) if path.exists() else None


def _elapsed(part: dict) -> float | None:
    """A leg's or a lap's time on the race clock: its elapsed time, else (a set) its duration."""
    return part["elapsedDuration"] if part.get("elapsedDuration") is not None else part.get("duration")


def _legs(aid, A) -> list[dict] | None:
    """A multisport activity's legs from the cache, in race order: [{type_key, seconds}]. None when it is
    not one, or when its record or any leg's is not cached: part of a race is never shown as all of it."""
    out = []
    for i, leg in enumerate(sports.legs(_cached(A, aid, "full"))):
        full = _cached(A, leg, "full") or {}
        s = full.get("summaryDTO") or {}
        if _elapsed(s) is None:
            return None
        out.append({"type_key": (full.get("activityTypeDTO") or {}).get("typeKey"), "seconds": _elapsed(s),
                    "order": (s.get("startTimeGMT") or "", i)})
    return [{k: x[k] for k in ("type_key", "seconds")} for x in sorted(out, key=lambda x: x["order"])] or None


def _triathlon(legs: list[dict]) -> list[tuple[str, float]] | None:
    """Swim, bike and run in that order, a transition after the swim T1 and after the bike T2; else None."""
    out: list[tuple[str, float]] = []
    for leg in legs:
        if leg["type_key"] in sports.TRANSITION:
            d = {"swim": "t1", "bike": "t2"}.get(out[-1][0] if out else None)
        else:
            d = sports.group(leg["type_key"])
        if d not in ("swim", "t1", "bike", "t2", "run"):
            return None
        out.append((d, leg["seconds"]))
    return out if [d for d, _ in out if d in ("swim", "bike", "run")] == ["swim", "bike", "run"] else None


def _stations(race: dict, aid, A) -> tuple[str, list[tuple[str, float]]] | None:
    """A station race's segments — (runs | stations | roxzone, seconds) — and where they were read from."""
    n = len((race.get("format") or {}).get("stations") or RACE_KINDS[race["kind"]].get("stations") or ())
    fits = lambda segs: [k for k, _ in segs if k != "roxzone"] == ["runs", "stations"] * n  # noqa: E731
    if sports.legs(_cached(A, aid, "full")):   # a repeating multisport: each leg names its sport
        legs = _legs(aid, A)
        segs = legs and [("roxzone" if x["type_key"] in sports.TRANSITION else
                          "runs" if sports.group(x["type_key"]) == "run" else "stations", x["seconds"]) for x in legs]
        return ("legs", segs) if segs and fits(segs) else None
    laps = [_elapsed(x) for x in (_cached(A, aid, "splits") or {}).get("lapDTOs") or []]
    pattern = (["runs", "stations"] * n if len(laps) == 2 * n else
               (["runs", "roxzone", "stations", "roxzone"] * n)[:-1] if len(laps) == 4 * n - 1 else None)
    if n and pattern and None not in laps and all(s >= SPLITS_MIN_S for k, s in zip(pattern, laps) if k != "roxzone"):
        return "laps", list(zip(pattern, laps))
    sets = (_cached(A, aid, "sets") or {}).get("exerciseSets") or []
    segs = [(("runs" if ((s.get("exercises") or [{}])[0] or {}).get("category") == "RUN" else "stations")
             if s.get("setType") == "ACTIVE" else "roxzone", s["duration"]) for s in sets if s.get("duration")]
    return ("sets", segs) if n and segs and fits(segs) else None


def splits(race: dict, activity_id, A=None) -> tuple[str, list[dict]] | None:
    """The race's time by discipline, read from its Garmin activity in the cache (see above): where it
    was read from (legs, laps or sets, SPLITS_FROM) and [{discipline, label, seconds, n}] in race order,
    `n` being how many legs, laps or sets each is made of. None for a kind with one discipline (a run, a
    ride), with no activity, or with a recording that doesn't fit the race's format — never a guess."""
    k = RACE_KINDS.get(race.get("kind")) or {}
    if not activity_id or not k.get("splits"):
        return None
    A = A or athlete.current()
    if k["split_by"] == "legs":
        legs = _legs(activity_id, A)
        got = ("legs", legs and _triathlon(legs))
    else:
        got = _stations(race, activity_id, A) or (None, None)
    if not got[1]:
        return None
    parts, raw, done = [], 0.0, 0
    for d, label in k["splits"]:
        xs = [s for x, s in got[1] if x == d]
        if xs:   # rounded on the running total, so the parts add up to the activity's whole seconds
            raw += sum(xs)
            parts.append({"discipline": d, "label": label, "seconds": round(raw) - done, "n": len(xs)})
            done = round(raw)
    return got[0], parts


def discipline_of(race: dict, name: str) -> str | None:
    """The discipline a split typed by hand belongs to, from its first word: "Swim" → swim, "Transitions +
    rounding" → transitions. One of the kind's disciplines or comparison groups, else None."""
    k = RACE_KINDS.get(race.get("kind")) or {}
    word = (str(name).split() or [""])[0].lower()
    return word if word in {d for d, _ in k.get("splits") or ()} | {g for g, _, _ in k.get("compare") or ()} else None


def versus(race: dict, parts: list[dict] | None, ref: list[dict] | None) -> list[dict] | None:
    """A result's splits against a reference's, group by group (RACE_KINDS → compare, else one group per
    discipline): [{key, label, seconds, reference_s, delta_s}] for each group both of them hold, `delta_s`
    negative where the result was faster. None unless both have splits."""
    k = RACE_KINDS.get(race.get("kind")) or {}
    groups = k.get("compare") or tuple((d, label, (d,)) for d, label in k.get("splits") or ())
    out = []
    for key, label, members in groups:
        mine = [p["seconds"] for p in parts or () if p["discipline"] in members]
        theirs = [p["seconds"] for p in ref or () if p.get("discipline") in (*members, key)]
        if mine and theirs:
            out.append({"key": key, "label": label, "seconds": sum(mine), "reference_s": sum(theirs),
                        "delta_s": sum(mine) - sum(theirs)})
    return out or None


# --- the windows -----------------------------------------------------------------------------------
def windows_of(race: dict) -> dict:
    """The race's windows: the default for its kind and priority, overridden key by key by its own
    `windows`. Raises ValueError when they don't say what comes before and after — never a guess."""
    w = {**WINDOWS.get((race.get("kind"), race.get("priority")), {}), **(race.get("windows") or {})}
    if "recovery_after" not in w or not {"easy_before", "taper"} & set(w):
        raise ValueError(f"{race.get('id')}: races.py has no windows for a {race.get('priority')} "
                         f"{race.get('kind')}, so the race must give its own (easy_before or taper, and recovery_after)")
    if w.get("easy_before") and w.get("taper"):
        raise ValueError(f"{race.get('id')}: easy days or a taper before the race, not both")
    return w


def days_of(race: dict) -> list[dict]:
    """Every day the race shapes, in order — the days before it (easy, or taper), race day, and the
    recovery days after: {date, window, day, of, intensity}. `day` of `of` places it in its window;
    `intensity` says whether that day may hold any (None on race day: the race is the day)."""
    w = windows_of(race)
    d = _date(race["date"])
    before, n_before = ("taper", w["taper"]) if w.get("taper") else ("easy", w.get("easy_before") or 0)
    n_after = w.get("recovery_after") or 0
    calm = w.get("no_intensity_after", n_after)
    out = [{"date": (d - dt.timedelta(days=n_before - i)).isoformat(), "window": before, "day": i + 1,
            "of": n_before, "intensity": before == "taper"} for i in range(n_before)]
    out.append({"date": d.isoformat(), "window": "race", "day": 1, "of": 1, "intensity": None})
    out += [{"date": (d + dt.timedelta(days=i)).isoformat(), "window": "recovery", "day": i, "of": n_after,
             "intensity": i > calm} for i in range(1, n_after + 1)]
    return out


def span(race: dict) -> dict:
    """The race's windows as dates: {before: {window, from, to, days} | None, race,
    recovery: {from, to, days, no_intensity_to} | None, counts, text} — what the app draws."""
    days = days_of(race)
    pre = [x for x in days if x["window"] in ("easy", "taper")]
    rec = [x for x in days if x["window"] == "recovery"]
    calm = [x for x in rec if x["intensity"] is False]
    before = {"window": pre[0]["window"], "from": pre[0]["date"], "to": pre[-1]["date"], "days": len(pre)} if pre else None
    recovery = ({"from": rec[0]["date"], "to": rec[-1]["date"], "days": len(rec),
                 "no_intensity_to": calm[-1]["date"] if calm else None} if rec else None)
    w = windows_of(race)
    return {"before": before, "race": race["date"], "recovery": recovery, "counts": w, "text": windows_text(w)}


def windows_text(w: dict) -> str:
    """The windows in words: "2 easy days before · 3 recovery days after"."""
    n = lambda k, one: f"{w[k]} {one}{'' if w[k] == 1 else 's'}"  # noqa: E731
    parts = []
    if w.get("taper"):
        parts.append(f"a {w['taper']}-day taper")
    elif w.get("easy_before"):
        parts.append(n("easy_before", "easy day") + " before")
    if w.get("recovery_after"):
        calm = w.get("no_intensity_after")
        parts.append(n("recovery_after", "recovery day") + " after"
                     + (f", the first {calm} without intensity" if calm is not None and calm < w["recovery_after"] else ""))
    return " · ".join(parts) or "no window"


def racing(races: list[dict]) -> list[dict]:
    """The races that shape days: a race he will not start (dns) shapes none."""
    return [r for r in races if r.get("entry") != "dns"]


def next_race(races: list[dict], day=None) -> dict | None:
    """The first race on or after `day` (today by default) that he will start."""
    day = _date(day or dt.date.today()).isoformat()
    return next((r for r in sorted(racing(races), key=lambda r: r["date"]) if r["date"] >= day), None)


# Where windows overlap: race day first, then the days before the race ahead, then the recovery behind.
_PRECEDENCE = {"race": 0, "taper": 1, "easy": 1, "recovery": 2}


def phase_on(day=None, races: list[dict] | None = None) -> dict:
    """Where `day` falls in the season — the one function the views, the daily, the week planner and
    the tests read: {window, race, days_to, day, of, from, to, intensity, rule, also}.

    window: race · taper or easy (the days before a race) · recovery (the days after) · build (no
    window, a race still ahead) · None (no race ahead and none just run). `race` is the race the
    window belongs to — for build, the next one. `days_to` runs from `day` to race day, negative after
    it. `day` of `of` places the day in its window, `from`–`to` is the window, `intensity` whether the
    day may hold any. Where windows overlap the precedence above picks `window`, and `also` holds the
    others: each of them binds too."""
    day = _date(day or dt.date.today())
    races = load() if races is None else races
    iso = day.isoformat()
    hits = []
    for r in racing(races):
        days = days_of(r)
        x = next((x for x in days if x["date"] == iso), None)
        if x:
            same = [y["date"] for y in days if y["window"] == x["window"]]
            hits.append({"window": x["window"], "race": r, "days_to": (_date(r["date"]) - day).days,
                         "day": x["day"], "of": x["of"], "from": same[0], "to": same[-1],
                         "intensity": x["intensity"], "rule": WINDOW[x["window"]]})
    hits.sort(key=lambda h: (_PRECEDENCE[h["window"]], h["race"].get("priority") != "A", abs(h["days_to"])))
    if hits:
        return {**hits[0], "also": hits[1:]}
    nxt = next_race(races, day)
    return {"window": "build" if nxt else None, "race": nxt,
            "days_to": (_date(nxt["date"]) - day).days if nxt else None, "day": None, "of": None,
            "from": None, "to": None, "intensity": True, "rule": WINDOW["build"], "also": []}


# --- the season (program.py → SEASON) --------------------------------------------------------------
def season_blocks(season: dict | None, races: list[dict], day=None) -> list[dict]:
    """SEASON's blocks with their dates: {name, start, end (its last day), weeks, emphasis, current,
    week (when current), races: [{id, at}]}. Which race a block opens with, holds or ends at is read
    from the dates, never stored twice: `opens` on its first day, `in` it, `ends` on the day after."""
    if not season:
        return []
    day = _date(day or dt.date.today())
    out = []
    for b in season.get("blocks") or []:
        start = _date(b["start"])
        end = start + dt.timedelta(days=7 * b["weeks"] - 1)
        at = []
        for r in races:
            d = _date(r["date"])
            where = ("opens" if d == start else "in" if start < d <= end
                     else "ends" if d == end + dt.timedelta(days=1) else None)
            if where:
                at.append({"id": r["id"], "at": where})
        current = start <= day <= end
        out.append({"name": b["name"], "start": b["start"], "end": end.isoformat(), "weeks": b["weeks"],
                    "emphasis": b.get("emphasis"), "current": current,
                    "week": (day - start).days // 7 + 1 if current else None, "races": at})
    return out


# --- the online check: when, never how --------------------------------------------------------------
def check(races: list[dict], day=None) -> list[dict]:
    """The races whose online check is due, and why — from the dates alone, no network (§2). Most
    days this is empty; the skill looks up only what it lists. `due` is `date` (look the race up) or
    `result` (the race is past: record it from the Garmin activity)."""
    day = _date(day or dt.date.today())
    out = []
    for r in sorted(racing(races), key=lambda r: r["date"]):
        d = _date(r["date"])
        to = (d - day).days
        v = r.get("verified") or {}
        checked = v.get("checked")
        row = {"id": r["id"], "name": r.get("name"), "date": r["date"], "days_to": to, "checked": checked,
               "status": v.get("status")}
        if to < 0:
            if r.get("result") is None and r.get("entry") != "dnf":
                out.append({**row, "due": "result", "why": "The race is past and its result is not recorded."})
            continue
        since = (day - _date(checked)).days if checked else None
        if since is None:
            why = "Never checked."
        elif to <= CHECK_START and _date(checked) < d - dt.timedelta(days=CHECK_START):
            why = f"{to} days out: start times appear about 3 days before the race."
        elif to <= CHECK_CLOSE and since > CHECK_CLOSE_EVERY:
            why = f"{to} days out, and last checked {since} days ago."
        elif since > CHECK_EVERY:
            why = f"Last checked {since} days ago."
        else:
            continue
        out.append({**row, "due": "date", "why": why})
    return out


# --- CLI ----------------------------------------------------------------------------------------------
def _fmt(day: str) -> str:
    return dt.date.fromisoformat(day).strftime("%a %d %b %Y")


def _days(n: int) -> str:
    return f"{n} day{'' if n == 1 else 's'}"


def _where(p: dict) -> str:
    if p["window"] is None:
        return "no race ahead."
    r = p["race"]
    if p["window"] == "build":
        return f"build — {r['name']} in {_days(p['days_to'])} ({_fmt(r['date'])})."
    if p["window"] == "race":
        return f"RACE DAY — {r['name']}{', start ' + r['start'] if r.get('start') else ''}."
    when = f"{_days(p['days_to'])} to go" if p["days_to"] > 0 else f"{_days(-p['days_to'])} after"
    calm = "" if p["window"] != "recovery" else " · no intensity" if not p["intensity"] else " · short intensity allowed"
    return f"{p['window']} day {p['day']} of {p['of']} — {r['name']}, {when}{calm}."


def main() -> None:
    A = athlete.current()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("what", nargs="?", choices=("season", "on", "check"), default="season")
    ap.add_argument("day", nargs="?", help="for `on`: an ISO date (default today)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    races = load(A)
    today = dt.date.today()
    if args.what == "check":
        due = check(races, today)
        if args.json:
            print(json.dumps(due, indent=1))
        elif not due:
            print("No check due.")
        else:
            for x in due:
                print(f"{x['date']}  {x['name']}: {x['due']} — {x['why']}")
        return
    if args.what == "on":
        day = args.day or today.isoformat()
        p = phase_on(day, races)
        if args.json:
            print(json.dumps({**p, "race": p["race"] and p["race"]["id"],
                              "also": [{**h, "race": h["race"]["id"]} for h in p["also"]]}, indent=1))
            return
        print(f"{_fmt(day)}: {_where(p)}\n  {p['rule']}")
        for h in p["also"]:
            print(f"  also {_where(h)}\n  {h['rule']}")
        return
    if not races:
        print(f"{A.display}: no races ({A.races_path.name} is absent or empty).")
        return
    print(f"{A.display}'s season · {len(races)} race(s) · today {today}")
    due = {x["id"]: x for x in check(races, today)}
    for r in races:
        to = (_date(r["date"]) - today).days
        sp = span(r)
        parts = []
        if sp["before"]:
            parts.append(f"{sp['before']['window']} {sp['before']['from'][5:]}→{sp['before']['to'][5:]}")
        if sp["recovery"]:
            parts.append(f"recovery {sp['recovery']['from'][5:]}→{sp['recovery']['to'][5:]}")
        target = (r.get("target") or {}).get("under")
        v = r.get("verified") or {}
        print(f"  {_fmt(r['date'])}  {r['name']:<28} {r['priority']}  "
              f"{'in ' + str(to) + ' d' if to >= 0 else str(-to) + ' d ago':<9} "
              f"{'sub ' + target if target else 'no target':<12} {' · '.join(parts):<40} "
              f"{v.get('status') or 'unchecked'} {v.get('checked') or ''}{'  ← ' + due[r['id']]['due'] + ' due' if r['id'] in due else ''}")
    blocks = season_blocks(getattr(A.program, "SEASON", None), races, today)
    for b in blocks:
        at = ", ".join(f"{x['id']} ({x['at']})" for x in b["races"])
        print(f"  block {b['name']}: {b['start']} → {b['end']} · {b['weeks']} wk"
              f"{' · week ' + str(b['week']) if b['current'] else ''}{' · ' + at if at else ''}")
    print(f"Today: {_where(phase_on(today, races))}")


if __name__ == "__main__":
    main()
