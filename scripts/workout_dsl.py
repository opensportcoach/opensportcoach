#!/usr/bin/env python3
"""Structured workouts beyond the gym — pool swims, runs, rides, circuits (HYROX-style) and mobility —
written as plain data and encoded, once, the way Garmin's watch receives them.

An athlete declares their sessions in a module in their own folder, listed in athlete.json → sessions:

    # athletes/<name>/swims.py
    from workout_dsl import Swim, Rest, Repeat, swim_workout
    WORKOUTS = {
        "swim_easy_1500": swim_workout("Swim · Easy 1500", "25 m pool, all easy.", [
            Swim(300, "free", "Warm-up, long strokes", kind="warmup"), Rest(),
            Repeat(6, [Swim(100, "free", "Steady"), Rest(20)], skip_last_rest=True), Rest(),
            Swim(300, "backstroke", "Easy", kind="cooldown"),
        ]),
    }

scripts/build_workouts.py builds every one of them into athletes/<name>/workouts/<key>.json with the
strength days, validate_workout.py checks them, and sync_workouts.py is the only path to the watch
(through /osc-push, with the athlete's confirmation). Every key must be in athlete.json →
managed_workouts to reach the watch.

THE FORMATS are the proven ones (workouts/FORMAT.md): each was uploaded, fetched back and checked on a
real watch before it was written here. Things the watch taught us, kept as rules of this module:
  * The watch headlines a step by its END CONDITION or its EXERCISE, the note only as grey subtext.
    So a circuit or mobility step names a catalog exercise (workouts/EXERCISE_CATALOG.json), checked
    here: an unknown pair uploads fine and renders as "Unknown exercise".
  * Rests default to the LAP BUTTON, never a countdown: a busy lane or a busy gym must not start the
    next rep for the athlete. A timed rest is opt-in (Rest(20)).
  * Indoors, distance never advances a step (a treadmill or a cardio profile cannot be trusted to
    measure it): put the distance in the note and end the step on the lap button.
  * Text that reaches the watch stays plain ASCII-friendly: an accented letter can come back from
    Garmin in another Unicode form and make a synced workout look changed. `plain` warns on it.
  * Kick and pull are a drillType on a freestyle step, with the board / buoy / fins as equipment.
  * A ride step carries ONE target, a custom power range in watts or a heart-rate range in bpm: the
    watch alerts outside it. Never both, and never a zone number (the athlete's zones on Garmin are not
    the plan's). Distance never ends a ride step: indoors the trainer's distance is Zwift's, and
    outdoors the plan is time or the lap button.
"""
from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

# --- Garmin's workout enums (Connect's WORKOUT enums, which are not the FIT activity enums) ----------
STEP_IDS = {"warmup": 1, "cooldown": 2, "interval": 3, "recovery": 4, "rest": 5, "repeat": 6, "main": 8}
SPORTS = {"swimming": 4, "running": 1, "cycling": 2, "cardio_training": 6, "mobility": 11}
COND_IDS = {"lap.button": 1, "time": 2, "distance": 3, "iterations": 7, "fixed.rest": 8}
STROKES = {"any_stroke": 1, "backstroke": 2, "breaststroke": 3, "drill": 4, "fly": 5, "free": 6, "im": 7,
           "mixed": 8}
STROKE_ALIASES = {"any": "any_stroke", "back": "backstroke", "breast": "breaststroke", "butterfly": "fly",
                  "freestyle": "free"}
EQUIPMENT = {None: 0, "fins": 1, "kickboard": 2, "paddles": 3, "pull_buoy": 4, "snorkel": 5}
EQUIPMENT_ALIASES = {"swim_kickboard": "kickboard", "board": "kickboard", "buoy": "pull_buoy"}
DRILLS = {"kick": 1, "pull": 2}
METER = {"unitId": 1, "unitKey": "meter", "factor": 100.0}
KG = {"unitId": 8, "unitKey": "kilogram", "factor": 1000.0}
NO_TARGET = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}
HR_TARGET = {"workoutTargetTypeId": 4, "workoutTargetTypeKey": "heart.rate.zone", "displayOrder": 4}
# A custom power range: Connect's "power.zone" target with the watts in targetValueOne/Two and no zone.
POWER_TARGET = {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone", "displayOrder": 2}
HR_BPM = (60, 220)
POWER_W = (1, 2000)
CATALOG_PATH = Path(__file__).resolve().parent.parent / "workouts" / "EXERCISE_CATALOG.json"


def _step_type(kind: str) -> dict:
    if kind not in STEP_IDS:
        raise ValueError(f"step kind {kind!r} is not one of {sorted(STEP_IDS)}")
    return {"stepTypeId": STEP_IDS[kind], "stepTypeKey": kind, "displayOrder": STEP_IDS[kind]}


def _cond(key: str) -> dict:
    return {"conditionTypeId": COND_IDS[key], "conditionTypeKey": key, "displayOrder": COND_IDS[key],
            "displayable": key != "iterations"}


def _sport(key: str) -> dict:
    return {"sportTypeId": SPORTS[key], "sportTypeKey": key, "displayOrder": SPORTS[key]}


def plain(text: str | None) -> str | None:
    """The text as it will reach the watch: NFC-normalised. Raises on characters outside Latin-1, which
    some watches cannot draw."""
    if text is None:
        return None
    t = unicodedata.normalize("NFC", text)
    bad = sorted({c for c in t if ord(c) > 0xFF and c not in "·–—′″’"})
    if bad:
        raise ValueError(f"{text!r}: the watch may not draw {''.join(bad)!r}")
    return t


# --- the steps --------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Swim:
    """One swim of `m` metres. kind: warmup · main · cooldown. drill: kick | pull (on a free step)."""
    m: int
    stroke: str = "free"
    note: str | None = None
    eq: str | None = None
    drill: str | None = None
    kind: str = "main"


@dataclass(frozen=True)
class Run:
    """One run step. Ends on `seconds`, else on `metres`, else on the lap button. hr: (low, high) bpm,
    an alert on the watch. kind: warmup · interval · recovery · cooldown. `estimate_s`: what a
    lap-button step is assumed to last, for the workout's estimated duration."""
    kind: str
    seconds: int | None = None
    metres: int | None = None
    hr: tuple[int, int] | None = None
    note: str | None = None
    estimate_s: int | None = None


@dataclass(frozen=True)
class Ride:
    """One ride step. Ends on `seconds`, else on the lap button. One target at most, an alert on the
    watch: `watts` (low, high), a custom power range, or `hr` (low, high) bpm. kind: warmup · interval ·
    recovery · cooldown. `estimate_s`: what a lap-button step is assumed to last, for the estimate."""
    kind: str
    seconds: int | None = None
    watts: tuple[int, int] | None = None
    hr: tuple[int, int] | None = None
    note: str | None = None
    estimate_s: int | None = None


@dataclass(frozen=True)
class Station:
    """One circuit or mobility step: a catalog exercise (category, name), done for `seconds`, `metres`
    or until the lap button, optionally with `kg`. kind: warmup · interval · rest · cooldown. A rest
    may carry an exercise as a LABEL (a partner's station in a doubles race: the athlete waits)."""
    kind: str
    note: str
    exercise: tuple[str, str] | None = None
    seconds: int | None = None
    metres: int | None = None
    kg: float | None = None


@dataclass(frozen=True)
class Rest:
    """A rest: None = until the lap button (the default), or a fixed number of seconds."""
    seconds: int | None = None


@dataclass(frozen=True)
class Repeat:
    """`n` times the steps inside. skip_last_rest: the rest after the last time is dropped — use it when
    a Rest follows the repeat anyway."""
    n: int
    steps: list = field(default_factory=list)
    skip_last_rest: bool = False


# --- the encoder ------------------------------------------------------------------------------------
def _range_target(s: dict, target: dict, rng: tuple, bounds: tuple, what: str, unit: str) -> None:
    lo, hi = rng
    if not bounds[0] <= lo < hi <= bounds[1]:
        raise ValueError(f"{what} range {rng} is not low < high within {bounds[0]}-{bounds[1]} {unit}")
    s.update(targetType=target, targetValueOne=float(lo), targetValueTwo=float(hi), zoneNumber=None)


class _Encoder:
    def __init__(self, sport: str):
        self.sport, self.order, self.groups = sport, 0, 0

    def _next(self) -> int:
        self.order += 1
        return self.order

    def _base(self, kind: str, child: int | None, note: str | None) -> dict:
        return {"type": "ExecutableStepDTO", "stepId": None, "stepOrder": self._next(), "childStepId": child,
                "stepType": _step_type(kind), "description": plain(note), "targetType": NO_TARGET}

    def _end(self, s: dict, seconds=None, metres=None, rest: bool = False) -> dict:
        if seconds is not None:
            s["endCondition"] = _cond("fixed.rest" if rest and self.sport == "swimming" else "time")
            s["endConditionValue"] = float(seconds)
        elif metres is not None:
            s["endCondition"] = _cond("distance")
            s["endConditionValue"] = float(metres)
            s["preferredEndConditionUnit"] = METER
        else:
            s["endCondition"] = _cond("lap.button")
            s["endConditionValue"] = None
        return s

    def step(self, item, child: int | None = None) -> dict:
        if isinstance(item, Rest):
            return self._end(self._base("rest", child, None), seconds=item.seconds, rest=True)
        if isinstance(item, Swim):
            if self.sport != "swimming":
                raise ValueError("a Swim step outside a swim workout")
            stroke = STROKE_ALIASES.get(item.stroke, item.stroke)
            eq = EQUIPMENT_ALIASES.get(item.eq, item.eq)
            if stroke not in STROKES:
                raise ValueError(f"stroke {item.stroke!r} is not one of {sorted(STROKES)}")
            if eq not in EQUIPMENT:
                raise ValueError(f"equipment {item.eq!r} is not one of {sorted(k for k in EQUIPMENT if k)}")
            if item.drill and item.drill not in DRILLS:
                raise ValueError(f"drill {item.drill!r} is not kick or pull")
            if item.m <= 0:
                raise ValueError(f"a swim of {item.m} m")
            s = self._end(self._base(item.kind, child, item.note), metres=item.m)
            s["strokeType"] = {"strokeTypeId": STROKES[stroke], "strokeTypeKey": stroke,
                               "displayOrder": STROKES[stroke]}
            s["equipmentType"] = {"equipmentTypeId": EQUIPMENT[eq], "equipmentTypeKey": eq,
                                  "displayOrder": EQUIPMENT[eq]}
            if item.drill:
                s["drillType"] = {"drillTypeId": DRILLS[item.drill], "drillTypeKey": item.drill,
                                  "displayOrder": DRILLS[item.drill]}
            return s
        if isinstance(item, Run):
            if self.sport != "running":
                raise ValueError("a Run step outside a run workout")
            s = self._end(self._base(item.kind, child, item.note), item.seconds, item.metres)
            if item.hr:
                _range_target(s, HR_TARGET, item.hr, HR_BPM, "heart-rate", "bpm")
            return s
        if isinstance(item, Ride):
            if self.sport != "cycling":
                raise ValueError("a Ride step outside a ride workout")
            if item.watts and item.hr:
                raise ValueError(f"ride step {item.note!r}: one target, watts or heart rate, not both")
            s = self._end(self._base(item.kind, child, item.note), item.seconds)
            if item.watts:
                _range_target(s, POWER_TARGET, item.watts, POWER_W, "power", "W")
            elif item.hr:
                _range_target(s, HR_TARGET, item.hr, HR_BPM, "heart-rate", "bpm")
            return s
        if isinstance(item, Station):
            if self.sport not in ("cardio_training", "mobility"):
                raise ValueError("a Station step outside a circuit or mobility workout")
            s = self._end(self._base(item.kind, child, item.note), item.seconds, item.metres)
            s["category"], s["exerciseName"] = item.exercise if item.exercise else (None, None)
            s["weightValue"], s["weightUnit"] = (float(item.kg), KG) if item.kg else (None, None)
            return s
        raise TypeError(f"not a step: {item!r}")

    def items(self, items: list) -> list:
        out = []
        for item in items:
            if isinstance(item, Repeat):
                if item.n < 1 or not item.steps:
                    raise ValueError(f"a repeat of {item.n} with {len(item.steps)} steps")
                self.groups += 1
                child = self.groups
                group = {"type": "RepeatGroupDTO", "stepId": None, "stepOrder": self._next(),
                         "stepType": _step_type("repeat"), "childStepId": child, "numberOfIterations": item.n,
                         "smartRepeat": False, "skipLastRestStep": item.skip_last_rest,
                         "endCondition": _cond("iterations"), "endConditionValue": float(item.n),
                         "targetType": NO_TARGET}
                if any(isinstance(x, Repeat) for x in item.steps):
                    raise ValueError("a repeat inside a repeat: the watch does not nest them")
                group["workoutSteps"] = [self.step(x, child) for x in item.steps]
                out.append(group)
            else:
                out.append(self.step(item))
        return out


def _workout(sport: str, name: str, desc: str | None, steps: list, **extra) -> dict:
    if not name or len(name) > 40:
        raise ValueError(f"workout name {name!r}: 1-40 characters, or the watch's list truncates it")
    enc = _Encoder(sport)
    wsteps = enc.items(steps)
    return {"workoutName": plain(name), "description": plain(desc), "sportType": _sport(sport),
            "subSportType": None, **extra,
            "workoutSegments": [{"segmentOrder": 1, "sportType": _sport(sport), "workoutSteps": wsteps}]}


# --- what the athlete calls -------------------------------------------------------------------------
def metres(items) -> int:
    """Total swim metres in a list of Swim / Repeat / S / R (the sum the watch will show)."""
    total = 0
    for i in items:
        if isinstance(i, Swim):
            total += i.m
        elif isinstance(i, Repeat):
            total += i.n * metres(i.steps)
        elif isinstance(i, S):
            total += i.metres
        elif isinstance(i, R):
            total += i.times * i.swim.metres
    return total


def swim_workout(name: str, desc: str | None, steps: list, pool_m: float = 25.0,
                 expect_m: int | None = None) -> dict:
    """A pool swim. expect_m: refuse the workout unless its swims add up to exactly this."""
    total = metres(steps)
    if expect_m is not None and total != expect_m:
        raise ValueError(f"{name}: the steps swim {total} m, expected {expect_m} m")
    return _workout("swimming", name, desc, steps, estimatedDurationInSecs=None,
                    estimatedDistanceInMeters=float(total), poolLength=float(pool_m), poolLengthUnit=METER)


def _estimate(items) -> int:
    total = 0
    for i in items:
        if isinstance(i, Repeat):
            total += i.n * _estimate(i.steps)
        elif isinstance(i, (Run, Ride, Station)):
            if i.seconds is not None:
                total += i.seconds
            elif isinstance(i, Run) and i.estimate_s is None and i.metres is None:
                raise ValueError(f"lap-button run step {i.note!r} needs estimate_s (its usual duration)")
            elif isinstance(i, Ride) and i.estimate_s is None:
                raise ValueError(f"lap-button ride step {i.note!r} needs estimate_s (its usual duration)")
            else:
                total += (i.estimate_s if isinstance(i, (Run, Ride)) else 0) or 0
    return total


def run_workout(name: str, desc: str | None, steps: list) -> dict:
    """A structured run. Its estimated duration counts each lap-button step at its estimate_s."""
    return _workout("running", name, desc, steps, estimatedDurationInSecs=_estimate(steps))


def ride_workout(name: str, desc: str | None, steps: list) -> dict:
    """A structured ride, indoors or out: time or lap-button steps, each with at most one target (a
    power range in watts or a heart-rate range in bpm). Its estimated duration counts each lap-button
    step at its estimate_s."""
    return _workout("cycling", name, desc, steps, estimatedDurationInSecs=_estimate(steps))


def _check_stations(steps: list, max_note: int | None, every_step_named: bool) -> None:
    catalog = json.loads(CATALOG_PATH.read_text())["categories"]
    flat = [x for i in steps for x in (i.steps if isinstance(i, Repeat) else [i])]
    for s in flat:
        if not isinstance(s, Station):
            continue
        if max_note and len(s.note) > max_note:
            raise ValueError(f"note too long for the watch ({len(s.note)} > {max_note}): {s.note!r}")
        if s.exercise:
            if s.exercise[1] not in catalog.get(s.exercise[0], []):
                raise ValueError(f"{s.exercise[0]}/{s.exercise[1]} is not in EXERCISE_CATALOG.json — it would "
                                 f"render as 'Unknown exercise' on the watch ({s.note})")
        elif every_step_named or s.kind != "rest":
            raise ValueError(f"a working step with no catalog exercise: {s.note!r} (the watch would headline "
                             "it with its end condition)")


def circuit_workout(name: str, desc: str | None, steps: list, estimated_s: int | None = None,
                    max_note: int | None = 48) -> dict:
    """A circuit on the watch's cardio profile (a HYROX simulation or race rehearsal, a station circuit).
    Every working step names a catalog exercise; a rest may carry one as a label. Each step is its own
    lap, so the activity's laps are the session's splits."""
    _check_stations(steps, max_note, every_step_named=False)
    return _workout("cardio_training", name, desc, steps,
                    estimatedDurationInSecs=estimated_s if estimated_s is not None else _estimate(steps) or None)


def mobility_workout(name: str, desc: str | None, steps: list, max_note: int | None = 48) -> dict:
    """A mobility or stretching routine on the watch's Mobility profile: timed steps, each a catalog
    exercise. (sportTypeId 11 is the one that comes back as `mobility`; 9 and 13 are renormalised.)"""
    _check_stations(steps, max_note, every_step_named=True)
    return _workout("mobility", name, desc, steps, estimatedDurationInSecs=_estimate(steps))


# --- a coach's written swim, section by section -------------------------------------------------------
@dataclass(frozen=True)
class S:
    """Section notation: one swim of `metres`."""
    metres: int
    stroke: str
    nota: str
    eq: str | None = None
    drill: str | None = None


@dataclass(frozen=True)
class R:
    """Section notation: `times` repetitions of a swim, `rest_s` seconds after each."""
    times: int
    swim: S
    rest_s: int


@dataclass(frozen=True)
class T:
    """Section notation: a timed rest between two parts that are not a repeat."""
    rest_s: int


def from_sections(blocks: list) -> list:
    """Steps from a swim written as sections — [(section name, declared metres, [S | R | T, ...]), ...],
    the way a coach writes one (warm-up, technique, main, cool-down). The first section's swims are
    warm-up, the last section's cool-down, the rest main. Consecutive parts get a lap-button rest
    between them unless a T() puts a timed rest there; a repeat's timed rest is skipped after its last
    repetition, because the lap rest that follows replaces it."""
    first, last = blocks[0][0], blocks[-1][0]
    flat = [(section, item) for section, _declared, items in blocks for item in items]
    out: list = []
    for n, (section, item) in enumerate(flat):
        if isinstance(item, T):
            out.append(Rest(item.rest_s))
            continue
        if isinstance(item, R):
            sw = item.swim
            out.append(Repeat(item.times, [Swim(sw.metres, sw.stroke, sw.nota, sw.eq, sw.drill), Rest(item.rest_s)],
                              skip_last_rest=True))
        else:
            kind = "warmup" if section == first else "cooldown" if section == last else "main"
            out.append(Swim(item.metres, item.stroke, item.nota, item.eq, item.drill, kind=kind))
        nxt = flat[n + 1][1] if n + 1 < len(flat) else None
        if nxt is not None and not isinstance(nxt, T):
            out.append(Rest())
    return out
