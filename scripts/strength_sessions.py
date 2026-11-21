#!/usr/bin/env python3
"""Which program day each cached strength session was — and whether the cache is fresh enough to say.

WHY THIS EXISTS (2026-10-04 audit, P1-1 / P1-3). The 09-21 audit re-keyed PRESCRIPTION_HISTORY by
day/exerciseId so two prescriptions of one catalog pair could not overwrite each other. Only the
history half was fixed: prescription_audit.py and progression_report.py still matched SESSIONS by
(category, exerciseName). So D5E5's seated calf raise — never trained — read "ok" off D3's two
sessions, and D1's bench @80 was credited with D4's 50 and 70. Seventh instance of the project's
most common defect: a lookup keyed on identity that cannot tell two contexts apart.

Every consumer that turns a set into "an attempt at a prescription" now asks this module, so the
rule lives in exactly one place:

  * A session's DAY is its activity name when that matches a workout name in PROGRAM (or a
    variant of it), else the best signature overlap (>= MIN_MATCHES), else None.
  * A set counts toward prescription (day, exid) when the session WAS that day — or when the
    catalog pair is prescribed on only one day, in which case nothing can be confused.
  * A pair prescribed on several days, logged in a session of none of them, is AMBIGUOUS and is
    reported, never silently credited to either.

And the freshness guard: on 2026-10-04 every check was green on a cache pulled before the 10-03
legs session, and rotation_status called D3 "STARVED" the day after he trained it.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

A = athlete.current()
DATA = A.data_dir
MIN_MATCHES = 2  # signature overlap needed to call an unnamed session a program day


@dataclass
class Session:
    id: int
    date: str            # YYYY-MM-DD, local
    start: str           # "YYYY-MM-DD HH:MM:SS", local — compared against PRESCRIPTION_HISTORY.since_ts
    name: str
    day: str | None      # PROGRAM key, or None if it could not be attributed
    sets: list = field(default_factory=list)  # ACTIVE exerciseSets, raw

    def keys(self) -> set:
        return {pair(s) for s in self.sets} - {(None, None)}


# One machine the watch logs under two catalog names (LOGGING_RULES.same_lift), read as the name
# the program prescribes. Dated: an old machine under the same name stays its own lift.
SAME_LIFT = {tuple(r["logged"]): (tuple(r["as"]), r.get("since", "")) for r in A.logging_rules["same_lift"]}


def pair(s: dict) -> tuple:
    ex = (s.get("exercises") or [{}])[0]
    key = ex.get("category"), ex.get("name")
    alias = SAME_LIFT.get(key)
    if alias and (s.get("startTime") or "")[:10] >= alias[1]:
        return alias[0]
    return key


# --- annotations ---------------------------------------------------------------------------
# Deliberate backoff/deload/injury days and known bad data points
# (athletes/<name>/workouts/SESSION_ANNOTATIONS.json). An entry with an "exercises" list scopes
# it to those (category, exerciseName) pairs — a single bad lift on a day whose others are real.
_ann_file = A.workouts_dir / "SESSION_ANNOTATIONS.json"
ANNOTATIONS = {d: v for d, v in (json.loads(_ann_file.read_text()) if _ann_file.exists() else {}).items()
               if not d.startswith("_")}


def annotated(date: str, key: tuple, annotations: dict | None = None) -> bool:
    """Is this (date, exercise) excluded from judgement?"""
    a = (ANNOTATIONS if annotations is None else annotations).get(date)
    if a is None:
        return False
    scoped = a.get("exercises")
    if not scoped:
        return True  # whole-session annotation
    return tuple(key) in {tuple(x) for x in scoped}


# --- attribution ---------------------------------------------------------------------------
def program():
    from build_workouts import PROGRAM, VARIANTS
    return PROGRAM, VARIANTS


def signatures(prog: dict | None = None) -> dict:
    prog = prog if prog is not None else program()[0]
    return {day: {(cat, name) for _, _, cat, name, *_ in spec["exercises"]}
            for day, spec in prog.items()}


def workout_names(prog: dict | None = None, variants: list | None = None,
                  previous: dict | None = None) -> dict:
    """Workout name on the watch -> PROGRAM day. Variants map to their base day, and a day's
    previous names (athlete.json) to the day itself — a renamed workout keeps its history."""
    if prog is None:
        prog, variants = program()
        previous = A.previous_names if previous is None else previous
    # Previous names first, so a current name always wins a collision.
    names = {n.strip(): day for day, olds in (previous or {}).items() if day in prog for n in olds}
    names.update({spec["name"].strip(): day for day, spec in prog.items()})
    for v in variants or []:
        names[v["name"].strip()] = v["base"]
    return names


def attribute(name: str, keys: set, prog: dict | None = None, variants: list | None = None) -> str | None:
    """The PROGRAM day a session was: its name if that is a workout of ours, else its signature."""
    names = workout_names(prog, variants)
    if (name or "").strip() in names:
        return names[name.strip()]
    scores = {day: len(keys & sig) for day, sig in signatures(prog).items()}
    best = max(scores, key=scores.get) if scores else None
    return best if best and scores[best] >= MIN_MATCHES else None


def pair_days(prog: dict | None = None, lead: dict | None = None) -> dict:
    """(category, exerciseName) -> set of days that prescribe it.

    THE CORE BLOCK COUNTS HERE (2026-11-01). It lives in program.py's `LEAD`, not in
    `PROGRAM[day]["exercises"]`, and leaving it out made every shared core pair look UNIQUE — so
    `counts_for()` below answered True for any day and credited one day's session to another day's
    core prescription. WEIGHTED_SIDE_PLANK is prescribed on two days (30 s on D2, 35 s on D4) and
    WEIGHTED_DEAD_BUG and KNEELING_AB_WHEEL on three. `build_workouts.prescriptions()` is the one
    definition of "every prescription"; pass `prog` explicitly (and `lead`, if the fixture has one)
    only for a synthetic program in a test.

    Deliberately NOT done to `signatures()` above: that identifies WHICH day a session was, and the
    core movements are shared across days, so they are noise there and would create false matches.
    Ownership and identification are different jobs.
    """
    out: dict[tuple, set] = {}
    if prog is None and lead is None:
        import build_workouts as bw
        rows = bw.prescriptions()
    else:
        prog = prog if prog is not None else program()[0]
        rows = (((day, ex) for day, spec in prog.items() for ex in spec["exercises"])
                if lead is None else
                ((day, ex) for day, ex in _rows_with_lead(prog, lead)))
    for day, ex, *_ in rows:
        cat, name = ex[2], ex[3]
        out.setdefault((cat, name), set()).add(day)
    return out


def _rows_with_lead(prog: dict, lead: dict):
    """prescriptions() for a synthetic program, without importing build_workouts."""
    for day, spec in prog.items():
        for ex in ((lead.get(day) or {}).get("block") or ()):
            yield day, ex
        for ex in spec["exercises"]:
            yield day, ex


def counts_for(session_day: str | None, day: str, key: tuple, owners: dict) -> bool | None:
    """Does a set of `key` in a session of `session_day` count toward `day`'s prescription?

    True / False, or None when it is AMBIGUOUS: a shared pair logged on a day that owns none of
    its prescriptions. Ambiguous sets are reported by the caller, never credited.
    """
    days = owners.get(key, set())
    if session_day == day:
        return True
    if len(days) <= 1:
        return True          # unique pair: nothing to confuse it with
    if session_day in days:
        return False         # it belongs to the OTHER prescription of this pair
    return None


# --- the cache ----------------------------------------------------------------------------
def strength_activities(since: str = "") -> list[dict]:
    """Every cached strength_training activity on/after `since`, deduped, oldest first."""
    seen, out = set(), []
    for af in sorted(DATA.glob("activities_*.json")):
        try:
            acts = json.loads(af.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(acts, dict):
            acts = acts.get("activities", [])
        for a in acts:
            aid = a.get("activityId")
            if aid is None or aid in seen:
                continue
            seen.add(aid)
            start = a.get("startTimeLocal") or ""
            if start[:10] < since or (a.get("activityType") or {}).get("typeKey") != "strength_training":
                continue
            out.append(a)
    return sorted(out, key=lambda a: a.get("startTimeLocal") or "")


def sessions(since: str = "") -> list[Session]:
    """Attributed strength sessions with their ACTIVE sets. Activities with no set file are skipped
    and named on stderr — silent exclusion is how the Hyrox lunge hid for a week."""
    prog, variants = program()
    out, missing = [], []
    for a in strength_activities(since):
        aid = a["activityId"]
        f = DATA / f"activity_{aid}_sets.json"
        if not f.exists():
            missing.append(aid)
            continue
        sets = [s for s in json.loads(f.read_text()).get("exerciseSets") or []
                if s.get("setType") == "ACTIVE"]
        start = a.get("startTimeLocal") or ""
        name = a.get("activityName") or ""
        keys = {pair(s) for s in sets} - {(None, None)}
        out.append(Session(aid, start[:10], start, name, attribute(name, keys, prog, variants), sets))
    if missing:
        print(f"note: {len(missing)} strength activit(ies) have no set file yet: {missing}",
              file=sys.stderr)
    return out


def unseen_scheduled(pulled: dt.datetime, done: set, sched: list, today: dt.date) -> list[str]:
    """Calendar strength workouts the cache cannot vouch for: past-dated, pulled no later than that
    day, and no strength session cached on it. Either skipped or not pulled yet — only a refresh
    can tell which. A pull made AFTER the day saw all of it, so a skipped day stays quiet."""
    out = []
    for item in sched:
        d = item.get("date") or ""
        if item.get("sportTypeKey") != "strength_training" or not d:
            continue
        if pulled.date().isoformat() <= d < today.isoformat() and d not in done:
            out.append(f"{item.get('title')} was scheduled {d} and the cache (pulled "
                       f"{pulled:%m-%d %H:%M}) has no strength session that day")
    return out


WINDOW = re.compile(r"activities_\d{4}-\d{2}-\d{2}_(?P<end>\d{4}-\d{2}-\d{2})\.json")  # pull_activities.py


def refreshed_at(path: Path) -> dt.datetime | None:
    """When this activities file was pulled, if its window reached that day — else None.

    A backfill (--end before the day it ran: one race day in June) saw nothing after its end, so it
    cannot say how fresh the cache is, and neither can a name with no window. Until 2026-10-16 the
    newest file's mtime was "pulled", whatever it covered: a backfill made the cache look pulled
    just then, and the 10-04 check went quiet for every day it never saw (found by reading).
    """
    m = WINDOW.fullmatch(path.name)
    written = dt.datetime.fromtimestamp(path.stat().st_mtime)
    return written if m and m["end"] >= written.date().isoformat() else None


def cache_status(today: dt.date | None = None) -> tuple[str, list[str]]:
    """("cache as of …", warnings). A warning means a decision made now may be on stale data.

    The check that would have caught 10-04: the calendar had D3 on 10-03, the cache was pulled at
    12:31 that day, and the 17:29 session was not in it. "Pulled" is the last refresh, never a
    backfill (refreshed_at).
    """
    today = today or dt.date.today()
    files = list(DATA.glob("activities_*.json"))
    if not files:
        return "cache: no activities pulled", ["no activity cache at all — run scripts/refresh.sh"]
    refreshes = [t for t in map(refreshed_at, files) if t]
    if not refreshes:
        return "cache: backfills only", ["no pull reached the day it ran — run scripts/refresh.sh"]
    pulled = max(refreshes)
    done = {a.get("startTimeLocal", "")[:10] for a in strength_activities()}
    sched_file = DATA / "scheduled.json"
    sched = json.loads(sched_file.read_text()) if sched_file.exists() else []
    warnings = unseen_scheduled(pulled, done, sched, today)
    if warnings:
        warnings.append(f"run `scripts/refresh.sh --athlete {A.name}` before deciding anything")
    return f"cache as of {pulled:%Y-%m-%d %H:%M}", warnings


def print_cache_status(stream=sys.stdout) -> bool:
    """Print the freshness line (and any warnings). Returns True when the cache looks stale."""
    as_of, warnings = cache_status()
    print(as_of, file=stream)
    for w in warnings:
        print(f"  !! STALE CACHE: {w}", file=stream)
    return bool(warnings)
