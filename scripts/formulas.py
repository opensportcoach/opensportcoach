#!/usr/bin/env python3
"""The formulas behind the numbers, each written ONCE, with the sentence that defines it.

WHY (2026-10-08, docs/DESIGN.md (the app) → Design review). The e1RM lived in three scripts
(export_dashboard_data, progression_report, prescription_audit), and the Claude Design handoff
labelled it with a fourth formula (load × reps^0.10). Two formulas for one number both look
plausible — the project's most common defect. So the formula lives here, the app shows the
definition this module gives, and tests/run_tests.py::test_one_e1rm_formula fails on any copy.
"""
from __future__ import annotations

import math

E1RM_REP_CAP = 12


def e1rm(weight: float, reps: float) -> float:
    """Estimated 1-rep max (Epley), reps capped at 12 — the formula degrades badly past that.
    Unrounded: callers round for display."""
    return weight * (1 + min(reps, E1RM_REP_CAP) / 30)


E1RM_DEFINITION = (f"Estimated 1-rep max (Epley): load × (1 + reps / 30), reps capped at {E1RM_REP_CAP}. "
                   "Per-hand lifts use the per-hand load; plate-loaded machines have none.")


# --- Endurance (docs/DESIGN.md (rides and runs) §2.3, 2026-10-09) -----------------------------------------------
# Garmin's own value wins wherever it sends one (its stream is denser than the 2,000 points we pull);
# these compute what it doesn't — TSS and IF on most rides, everything on rides without them.

NP_WINDOW_S = 30


def resample_1hz(t: list[float], v: list[float | None]) -> list[float]:
    """A channel sampled at uneven times → one value per second (linear between samples; gaps
    and pauses hold the last value). `t` is seconds from the start, ascending."""
    pts = [(a, b) for a, b in zip(t, v) if a is not None and b is not None]
    if len(pts) < 2:
        return [p[1] for p in pts]
    out, j = [], 0
    for s in range(int(pts[0][0]), int(pts[-1][0]) + 1):
        while j < len(pts) - 2 and pts[j + 1][0] < s:
            j += 1
        (t0, v0), (t1, v1) = pts[j], pts[j + 1]
        out.append(v0 if t1 == t0 else v0 + (v1 - v0) * min(1.0, max(0.0, (s - t0) / (t1 - t0))))
    return out


def rolling_seconds(p1hz: list[float], window: int = NP_WINDOW_S) -> list[float | None]:
    """Each second's mean over the `window` seconds ending at it; None until a whole window exists.
    NP's first step, and the ride page's "30 s smoothing" line (APP_AUDIT round 3) — one definition."""
    out: list[float | None] = [None] * min(len(p1hz), window - 1)
    if len(p1hz) < window:
        return out
    run = sum(p1hz[:window])
    out.append(run / window)
    for i in range(window, len(p1hz)):
        run += p1hz[i] - p1hz[i - window]
        out.append(run / window)
    return out


def normalized_power(p1hz: list[float]) -> float | None:
    """NP: the 30-second rolling mean of power, raised to the 4th power, averaged, 4th root."""
    if len(p1hz) < NP_WINDOW_S:
        return None
    roll = [x for x in rolling_seconds(p1hz, NP_WINDOW_S) if x is not None]
    return (sum(x ** 4 for x in roll) / len(roll)) ** 0.25


def intensity_factor(np_w: float, ftp: float) -> float:
    """IF: normalized power ÷ FTP."""
    return np_w / ftp


def tss(seconds: float, np_w: float, ftp: float) -> float:
    """TSS: hours × IF² × 100 — one hour at FTP scores 100."""
    return seconds / 3600 * intensity_factor(np_w, ftp) ** 2 * 100


def best_mean(p1hz: list[float], seconds: int) -> float | None:
    """The highest average over any `seconds`-long stretch (a power-curve point)."""
    if len(p1hz) < seconds:
        return None
    run = best = sum(p1hz[:seconds])
    for i in range(seconds, len(p1hz)):
        run += p1hz[i] - p1hz[i - seconds]
        best = max(best, run)
    return best / seconds


def decoupling(output: list[float], hr: list[float]) -> float | None:
    """Aerobic decoupling, %: how much output per heartbeat fell from the first half to the second.
    output = power (or speed), 1 Hz, moving time only. Under 5 % on a steady ride is a sound base."""
    n = len(output)
    if n < 600 or len(hr) != n:
        return None
    h = n // 2
    first = sum(output[:h]) / max(1e-9, sum(hr[:h]))
    second = sum(output[h:]) / max(1e-9, sum(hr[h:]))
    return (first - second) / first * 100 if first else None


def efficiency_factor(output: float, avg_hr: float) -> float:
    """EF: output per beat — NP ÷ average HR on a bike, speed (m/min) ÷ average HR on foot."""
    return output / avg_hr


ENDURANCE_DEFINITIONS = {
    "np": "Normalized power: the 30-second rolling average of power, raised to the 4th power, averaged, then the 4th root. Garmin's value when it has one.",
    "if": "Intensity factor: normalized power ÷ FTP.",
    "tss": "Training stress score: hours × IF² × 100. One hour at FTP is 100.",
    "vi": "Variability index: normalized power ÷ average power. 1.00–1.05 is steady.",
    "decoupling": "Aerobic decoupling: how much power (or speed) per heartbeat dropped from the first half to the second. Under 5 % on a steady session is a sound aerobic base.",
    "ef": "Efficiency factor: normalized power (bike) or speed in m/min (run) ÷ average heart rate. Up over weeks at the same effort = fitter.",
    "best_efforts": "The highest average power over any stretch of that length in the session.",
}


# --- Fuelling (docs/DESIGN.md (fuelling and score) §4.1, approved 2026-11-06) --------------------------
# Carbohydrate during a session, keyed on duration × intensity × sport — never on duration alone: a
# table keyed on one of them would be the lookup defect CLAUDE.md lists first. Sources: ACSM,
# "Nutrition and Athletic Performance" (2016); Jeukendrup, "A step towards personalized sports
# nutrition: carbohydrate intake during exercise" (Sports Medicine, 2014). scripts/fuel.py turns the
# grams into the athlete's own products; the app shows FUEL_DEFINITIONS and never its own sentence.

EASY_INTENTS = frozenset({"recovery", "endurance"})
HARD_INTENTS = frozenset({"tempo", "threshold", "vo2", "race", "mixed"})
INTENTS = EASY_INTENTS | HARD_INTENTS

# (under this many minutes, easy band, hard band), each band (low, high) in g/h; the last row is open.
CARB_BANDS: tuple = (
    (60, (0, 0), (0, 0)),
    (90, (0, 0), (30, 30)),
    (150, (30, 60), (60, 60)),
    (None, (60, 90), (60, 90)),
)
GUT_UNTRAINED_G_H = 60   # an untrained gut: about what one carbohydrate (glucose) can be absorbed at
GUT_STEP_G_H = 10        # a gut-training session goes this far above the trained rate, and no further
CARB_LOAD_G_PER_KG_DAY = (8, 10)
CARB_LOAD_DAYS = {"A": 2, "B": 1}   # keyed on priority: a B race is a hard day, not a peak
CARB_LOAD_MIN_RACE_MIN = 90
PRE_RACE_G_PER_KG = (1, 4)          # 1 g/kg an hour before, up to 4 g/kg four hours before


def _round5(x: float) -> int:
    return int(math.floor(x / 5 + 0.5) * 5)


def carb_band(minutes: float, intent: str, sport: str) -> tuple[int, int]:
    """Carbohydrate during a session, g/h (low, high), before the athlete's gut caps it. A bike takes
    the whole band; a swim takes none (nobody eats in the pool); anything else on foot takes the lower
    half of the band, since the gut tolerates less while running."""
    if intent not in INTENTS:
        raise ValueError(f"unknown intent {intent!r}: one of {sorted(INTENTS)}")
    if sport == "swim":
        return 0, 0
    hard = intent in HARD_INTENTS
    for limit, easy, hard_band in CARB_BANDS:
        if limit is None or minutes < limit:
            lo, hi = hard_band if hard else easy
            break
    if sport != "bike" and hi > lo:
        hi = lo + (hi - lo) // 2
    return lo, hi


def carb_target(lo: int, hi: int, intent: str, gut_g_h: float | None = None, rehearsal: bool = False) -> int:
    """The g/h to plan: the top of a hard session's band, the middle of an easy one's (to 5 g), capped
    at what this athlete's gut is trained to — an untrained gut at 60 — plus 10 on a gut-training
    session."""
    want = hi if intent in HARD_INTENTS else _round5((lo + hi) / 2)
    return int(min(want, gut_cap(gut_g_h, rehearsal)))


def gut_cap(gut_g_h: float | None = None, rehearsal: bool = False) -> int:
    """The most carbohydrate an hour a plan may ask for: what the gut is trained to (60 g/h untrained),
    plus 10 on a gut-training session."""
    return int((GUT_UNTRAINED_G_H if gut_g_h is None else gut_g_h) + (GUT_STEP_G_H if rehearsal else 0))


def carb_load(weight_kg: float, priority: str, race_minutes: float) -> dict | None:
    """Carbohydrate loading before a race longer than 90 minutes: 8–10 g per kg of body weight a day,
    for 2 days before an A race and 1 day before a B race. None for a shorter race."""
    if race_minutes <= CARB_LOAD_MIN_RACE_MIN or priority not in CARB_LOAD_DAYS:
        return None
    lo, hi = CARB_LOAD_G_PER_KG_DAY
    return {"days": CARB_LOAD_DAYS[priority], "g_per_kg_day": [lo, hi],
            "g_per_day": [_round5(weight_kg * lo), _round5(weight_kg * hi)]}


def pre_race_meal(weight_kg: float) -> dict:
    """The meal before a race: 1–4 g of carbohydrate per kg, eaten 1–4 hours before the start —
    the closer to the start, the less."""
    lo, hi = PRE_RACE_G_PER_KG
    return {"g_per_kg": [lo, hi], "hours_before": [1, 4], "g": [_round5(weight_kg * lo), _round5(weight_kg * hi)]}


FUEL_DEFINITIONS = {
    "carb_band": "Carbohydrate during a session, by its length, how hard it is and the sport. Under an hour: none. "
                 "60–90 min: none if easy, about 30 g/h if hard. 90 min to 2.5 h: 30–60 g/h easy, about 60 hard. "
                 "Over 2.5 h: 60–90 g/h of glucose and fructose. Runs take the lower half of each band; swims none. "
                 "Sources: ACSM 2016; Jeukendrup 2014.",
    "carb_target": "The rate planned: the top of a hard session's band, the middle of an easy one's, never above "
                   "what your gut is trained to (60 g/h until you say otherwise), plus 10 g/h on a gut-training session.",
    "gut": "The most carbohydrate an hour you have taken in training without trouble. Raised 10 g/h at a time, "
           "only after a logged session at the current rate.",
    "carb_load": "Before a race over 90 minutes: 8–10 g of carbohydrate per kg of body weight a day, "
                 "2 days before an A race, 1 day before a B race.",
    "pre_race_meal": "1–4 g of carbohydrate per kg, 1–4 hours before the start — the closer to it, the less.",
    "taken": "What you logged taking, in grams, from each product's label and your bottle recipe as it was that day. "
             "Self-reported: Garmin does not record it.",
}


# --- Trends ---------------------------------------------------------------------------------------
TREND_DAYS = 7


def rolling_mean(values: list, days: int = TREND_DAYS, min_points: int = 4) -> list:
    """The mean of each day and the days before it (a `days`-day window), over the days that have a
    value; None until the window holds `min_points` — a 7-day average from two nights isn't one."""
    out = []
    for i in range(len(values)):
        win = [v for v in values[max(0, i - days + 1): i + 1] if v is not None]
        out.append(round(sum(win) / len(win), 1) if len(win) >= min_points else None)
    return out


ROLLING_DEFINITION = (f"{TREND_DAYS}-day average: the mean of each day and the {TREND_DAYS - 1} before it, over the days "
                      "with a reading (at least 4) — the trend the nightly numbers wobble around.")


# --- The execution score (docs/DESIGN.md (fuelling and score) §5; S1–S4 approved 2026-11-06) ------------
# One session scored against what was agreed for it: execution, never fitness. Every weight below is a
# DRAFT until the Phase 2 calibration pass with the athlete. scripts/session_score.py is the only
# reader; the app and the reviews show SCORE_DEFINITIONS and never a sentence of their own.

SCORE_WEIGHTS = {
    "strength": {"sets": 35, "reps": 25, "load": 25, "rest": 10},
    "endurance": {"intent": 40, "intervals": 25, "duration": 20, "pacing": 15, "fuel": 10},
}
SCORE_BANDS = ((85, "as_planned", "As planned"), (70, "mostly", "Mostly"), (50, "partly", "Partly"),
               (0, "off_plan", "Off plan"))
SCORE_UNCLEAR = ("unclear", "Unclear")
SCORE_MIN_COVERAGE = 0.60       # under this share of the session scored, the total is not shown
# Calibrated 2026-11-07 (his call, "I'll let you decide"): a planned exercise not started caps the session
# under As planned. 11-02 cut farmers carry and preacher curl, 7 of 31 sets, and still read 90; sets at
# 35 points can't carry that, and no weight that could would leave the reps and load parts room to count.
SKIPPED_CAP = 84

LOAD_OVER_FLAG = 1.15           # more than 15 % over the ask: flagged, never rewarded
LOAD_SUSPECT = 1.80             # near double: suspect the implement (2026-09-21 key/implement incident)
REST_BAND = (0.75, 1.5)         # × the prescribed rest

# The intent's band as a share of FTP (Coggan's levels), read on 30-second power while pedalling.
# Without power, the activity's own Garmin HR zones: recovery Z1, endurance Z2, tempo Z3.
INTENT_POWER_BAND = {"recovery": (0.0, 0.55), "endurance": (0.56, 0.75), "tempo": (0.76, 0.90)}
INTENT_HR_ZONE = {"recovery": (1,), "endurance": (2,), "tempo": (3,)}
INTENT_FULL_SHARE = 0.85        # this share of the time in band scores full


def hr_target_intent(hi_bpm: float, threshold_hr: float | None) -> str | None:
    """The intent a watch workout's own heart-rate target implies: a cap under the athlete's threshold
    heart rate is an aerobic step — "endurance" — so time under it counts half, as on any easy session.
    At or over threshold, or with no threshold known, the target names no intent: it is still scored
    on its own band, never on a zone it did not ask for (2026-11-10 audit)."""
    return "endurance" if threshold_hr and hi_bpm < threshold_hr else None
# Calibrated 2026-11-07 (his call: a full miss "sounds very extreme"): on an easy intent, time UNDER the
# band counts half. Too easy costs a little of the session's purpose; too hard costs the next session.
UNDER_EASY_CREDIT = 0.5
# Interval intents are scored on the whole ride's IF; full inside the band, nothing 0.15 outside it.
INTENT_IF_BAND = {"threshold": (0.80, 0.95), "vo2": (0.80, 0.95), "race": (0.70, 0.95), "mixed": (0.70, 0.90)}
IF_FADE = 0.15
WORK_TARGET_SLACK = 0.95        # a work stretch counts at the target's low end −5 % or better
WORK_MIN_S = 20                 # …held for at least this long (a sprint is not interval work) …
WORK_SMOOTH_S = 3               # … on 3-second power: a 10-second window clipped each 30″ effort to 24″
DURATION_FULL = 0.10            # ±10 % of the planned duration scores full …
DURATION_ZERO = 0.50            # … and ±50 % scores nothing, linear between
VI_FULL, VI_ZERO = 1.05, 1.20   # steady rides
RUN_SPLIT_FULL, RUN_SPLIT_ZERO = 0.03, 0.15   # second half vs first half, pace


def linear(x: float, full: float, zero: float) -> float:
    """1 at or under `full`, 0 at or over `zero`, linear between."""
    if x <= full:
        return 1.0
    if x >= zero:
        return 0.0
    return 1 - (x - full) / (zero - full)


def score_band(total: float | None, coverage: float) -> tuple[str, str]:
    if total is None or coverage < SCORE_MIN_COVERAGE:
        return SCORE_UNCLEAR
    return next((key, label) for floor, key, label in SCORE_BANDS if total >= floor)


SCORE_DEFINITIONS = {
    "score": "How the session went against what was planned for it that day, 0–100. Execution, not fitness: "
             "heat, decoupling and efficiency stay flags. Each part scores 0–1 and earns its weight; a part that "
             "cannot be scored drops out and the others rescale. Under 60 % of the session scored, no total.",
    "bands": "85+ As planned · 70–84 Mostly · 50–69 Partly · under 50 Off plan · under 60 % scored: Unclear. "
             "A gym session with a planned exercise not started scores 84 at most.",
    "sets": "Working sets done ÷ planned, per exercise, capped at planned: extra sets add nothing.",
    "reps": "Per planned set, reps (or seconds) done ÷ target, capped at 1. A per-side set is scored per side.",
    "load": "Per planned set, the load in the program's terms (per hand, discs on a machine) ÷ the ask, capped at 1; on a weighted bodyweight lift, body plus plate. "
            "More than 15 % over is flagged, not rewarded; near double means suspect the implement. "
            "A lift done on a different machine is not comparable and drops out.",
    "rest": "Share of rests between sets within 0.75–1.5 × the prescribed rest. Weighted low: rest runs on the lap button.",
    "intent": "Easy and tempo rides: the share of time in the intent's band (power against your FTP, else the "
              "activity's own HR zones); 85 % scores full. On an easy ride, time under the band counts half. "
              "Interval rides: IF inside the intent's band.",
    "intervals": "Only when the plan sets work: time at the target's low end −5 % or better (3-second power), held 20 s or more, "
                 "÷ the work planned.",
    "duration": "Moving time against the plan, both ways: ±10 % scores full, ±50 % nothing.",
    "pacing": "Steady rides: variability index, 1.05 or under full, 1.20 nothing. Runs: second half's pace "
              "within 3 % of the first. Not scored on interval rides.",
    "fuel": "Only when a fuel plan existed: grams taken ÷ planned, capped at 1. A log with no grams drops out.",
    "coverage": "The share of the session that could be scored: planned sets that could be judged, or the weight of "
                "the parts that apply.",
}

SCORE_LABELS = {"sets": "Sets done", "reps": "Reps", "load": "Load", "rest": "Rest", "intent": "Intent",
                "intervals": "Intervals", "duration": "Duration", "pacing": "Pacing", "fuel": "Fuel"}
SCORE_MEASURE = {
    "sets": "done ÷ planned, capped at planned",
    "reps": "hit ÷ target on each set, capped",
    "load": "lifted ÷ asked, capped at 100 % — over is flagged, not rewarded",
    "rest": "rests inside 0.75–1.5 × the prescribed rest",
    "intent": "time in the intent's band (under counts half on an easy ride), or IF in its band",
    "intervals": "work at target ÷ work planned",
    "duration": "done vs planned: ±10 % full, ±50 % nothing",
    "pacing": "evenness: VI on a steady ride, halves on a run",
    "fuel": "taken ÷ planned · from your log",
}

# --- Swims and circuits: their review and their score (scripts/session_review.py) ----------------------
# Appended, not interleaved: the score's own section above is shared with the rides and the lifts.
STRAY_LAP_S = 10            # a lap shorter than this on a lap-button session is a stray press, not a step
SWIM_DISTANCE_BAND = (0.10, 0.50)   # metres swum vs planned: within 10 % full, 50 % off nothing, both ways
PACE_CV_BAND = (0.03, 0.10)         # spread of pace across a set's reps: 3 % or under full, 10 % nothing
CIRCUIT_RUN_CV_BAND = (0.05, 0.20)  # spread of a circuit's run legs: 5 % or under full, 20 % nothing

SCORE_WEIGHTS["swim"] = {"distance": 35, "swims": 40, "swim_pacing": 25}
SCORE_WEIGHTS["circuit"] = {"steps": 50, "structure": 20, "circuit_pacing": 30}


def pace_per_100(seconds: float | None, metres: float | None) -> float | None:
    """Seconds per 100 m."""
    return 100 * seconds / metres if seconds and metres else None


def css_per_100(t400: float, t200: float) -> float | None:
    """Critical swim speed, seconds per 100 m: (T400 − T200) ÷ 2 — the pace a swimmer can hold for about
    30 minutes, from an all-out 400 and an all-out 200."""
    return (t400 - t200) / 2 if t400 and t200 and t400 > t200 else None


def spread(values: list[float]) -> float | None:
    """Coefficient of variation: the standard deviation ÷ the mean. 0.03 = the values sit within ~3 %."""
    v = [x for x in values if x]
    if len(v) < 2:
        return None
    mean = sum(v) / len(v)
    return (sum((x - mean) ** 2 for x in v) / (len(v) - 1)) ** 0.5 / mean


def band_score(x: float | None, full: float, zero: float) -> float | None:
    """1 at or under `full`, 0 at or over `zero`, linear between."""
    if x is None:
        return None
    return max(0.0, min(1.0, (zero - x) / (zero - full)))


REVIEW_DEFINITIONS = {
    "pace_100": "Moving time per 100 m: the time spent swimming (rests excluded) ÷ the distance × 100.",
    "swolf": "SWOLF: seconds plus strokes for one length. Lower is more efficient; compare only in the same pool.",
    "strokes_per_length": "Average strokes per pool length.",
    "css_100": "Critical swim speed per 100 m: (T400 − T200) ÷ 2, from this session's all-out 400 and 200.",
    "pace_spread": "How much the pace of a set's reps varied: standard deviation ÷ mean. Under 3 % is even.",
    "run_spread": "How much a circuit's run legs varied in time: standard deviation ÷ mean.",
    "stray_laps": f"Laps under {STRAY_LAP_S} s on a lap-button session: a button pressed twice, which shifts "
                  "every step after it.",
}
SCORE_DEFINITIONS.update({
    "distance": "Metres swum against the metres planned, both ways: within 10 % scores full, 50 % off nothing.",
    "swims": "Planned swims done, in order (the lap's distance matching the planned rep's) ÷ planned swims.",
    "steps": "Working steps of the planned circuit done (a lap of its own, not a stray press) ÷ planned.",
    "structure": "Laps against the planned steps: the same number scores full; each lap more or fewer costs "
                 "its share. A stray lap press shifts every step after it.",
    "swim_pacing": "Per set of repeated swims, the spread of pace across its reps: 3 % or under full, 10 % nothing.",
    "circuit_pacing": "The spread of the run legs' times: 5 % or under full, 20 % nothing.",
})

SCORE_LABELS.update({"distance": "Distance", "swims": "Swims done", "swim_pacing": "Pacing", "steps": "Steps done",
                     "structure": "Structure", "circuit_pacing": "Pacing"})
SCORE_MEASURE.update({"distance": "swum vs planned: ±10 % full, ±50 % nothing",
                      "swims": "planned swims matched by a lap ÷ planned",
                      "swim_pacing": "evenness of each repeated set: pace spread 3 % or under full",
                      "steps": "working steps done ÷ planned",
                      "circuit_pacing": "evenness of the run legs: spread 5 % or under full",
                      "structure": "steps recorded vs planned; a stray lap press costs its share"})
