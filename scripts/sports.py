"""Which sport each Garmin activity typeKey belongs to — the ONE map (export, app views, puller).

Moved here from export_dashboard_data.py on 2026-10-09, when the puller needed it too: a second copy
of this map is exactly the defect it records below.
"""
from __future__ import annotations

# 2026-08-29: "virtual_run" was MISSING and fell through to "other". He ran twice on
# 08-28 (virtual 2.82 km + treadmill 2.20 km = 5.02 km); the brief showed one of them,
# reported run 0/2 on the cardio tracker and "5 days since last run" the morning after
# he had run 5 km. He caught it. Any Garmin typeKey absent here is silently invisible
# in the cardio tracker and the weekly-hours chart — add new ones as they appear, and
# see tests/run_tests.py::test_every_logged_sport_typekey_is_grouped.
SPORT_GROUP = {
    "cycling": "bike", "virtual_ride": "bike", "gravel_cycling": "bike", "road_biking": "bike",
    "indoor_cycling": "bike", "mountain_biking": "bike",
    "running": "run", "treadmill_running": "run", "trail_running": "run",
    "virtual_run": "run", "indoor_running": "run", "track_running": "run",
    "lap_swimming": "swim", "open_water_swimming": "swim", "swimming": "swim",
    "strength_training": "strength", "multi_sport": "race",
}

# Sessions whose exercise sets are pulled (pull_activities.py). Not just strength: 2026-08-30 the
# Hyrox was logged as `indoor_cardio` with a real Garmin exercise per station, and those keys are the
# only way to grow the catalog. CIRCUIT is the non-strength part: shown as stations, not lifts.
SET_BEARING = {"strength_training", "indoor_cardio", "hiit", "cardio_training", "other"}
CIRCUIT = {"indoor_cardio", "hiit", "cardio_training"}

# A multisport activity (a triathlon; a HYROX recorded as a repeating multisport) is ONE parent in the
# activity list. Its legs are child activities, which the parent's own record names (get_activity →
# metadataDTO.childIds); the list never carries them. pull_activities.py pulls each leg, and races.py
# reads a race result's splits from them (docs/DESIGN.md (races) phase 6). A transition leg is T1 or T2 in a
# triathlon and a roxzone in a HYROX: `transition_v2` on a real 70.3 (pulled 2026-10-15).
MULTISPORT = "multi_sport"
TRANSITION = {"transition_v2"}


def legs(full: dict | None) -> list[int]:
    """The leg (child activity) ids a multisport parent's record names; [] for any other activity."""
    return [int(i) for i in ((full or {}).get("metadataDTO") or {}).get("childIds") or []]


# Sessions whose GPS is fictional (Zwift and friends) or absent (indoors): no map, no weather.
VIRTUAL = {"virtual_ride", "virtual_run"}
INDOOR = {"indoor_cycling", "treadmill_running", "indoor_running"}


# What a person calls each sport, its icon, and its kind — the ONE map for every label on screen.
# 2026-10-11 (docs/DESIGN.md (app audit) R5): the app labelled every `other` session "Activity" on Today and
# "Circuit" on Workouts — tennis among them. Garmin's own sport names now, and "circuit"
# only for CIRCUIT. Kinds: strength · endurance (rides, runs, swims) · circuit · sport (everything
# else a person plays or does). Icons are keys the page draws (app/web/src/components/SportIcon.tsx).
SPORT_LABEL = {
    "strength_training": ("Strength", "strength"),
    "running": ("Run", "run"), "treadmill_running": ("Treadmill run", "run"), "trail_running": ("Trail run", "run"),
    "virtual_run": ("Virtual run", "run"), "indoor_running": ("Indoor run", "run"), "track_running": ("Track run", "run"),
    "cycling": ("Ride", "bike"), "road_biking": ("Road ride", "bike"), "gravel_cycling": ("Gravel ride", "bike"),
    "mountain_biking": ("MTB ride", "bike"), "indoor_cycling": ("Indoor ride", "bike"), "virtual_ride": ("Virtual ride", "bike"),
    "lap_swimming": ("Pool swim", "swim"), "open_water_swimming": ("Open-water swim", "swim"), "swimming": ("Swim", "swim"),
    "multi_sport": ("Multisport", "race"),
    "indoor_cardio": ("Indoor cardio", "circuit"), "hiit": ("HIIT", "circuit"), "cardio_training": ("Cardio", "circuit"),
    "tennis": ("Tennis", "racket"), "tennis_v2": ("Tennis", "racket"), "paddelball": ("Padel", "racket"),
    "pickleball": ("Pickleball", "racket"), "squash": ("Squash", "racket"), "badminton": ("Badminton", "racket"),
    "walking": ("Walk", "walk"), "hiking": ("Hike", "hike"), "yoga": ("Yoga", "yoga"), "mobility": ("Mobility", "yoga"),
    "pilates": ("Pilates", "yoga"), "sailing_v2": ("Sailing", "sail"), "sailing": ("Sailing", "sail"),
    "resort_skiing": ("Skiing", "ski"), "resort_skiing_snowboarding_ws": ("Skiing", "ski"),
    "other": ("Other", "other"),
}


def kind(type_key: str | None) -> str:
    tk = type_key or ""
    grp = group(tk)
    return ("strength" if grp == "strength" else "circuit" if tk in CIRCUIT
            else "endurance" if grp in ("bike", "run", "swim", "race") else "sport")


def badge(type_key: str | None) -> dict:
    """{type, sport, icon, kind} for one Garmin typeKey (an activity's, or a scheduled workout's
    sportTypeKey). An unmapped key reads as its own words ("stand_up_paddleboarding_v2" → "Stand up
    paddleboarding") — never as another sport's name."""
    tk = type_key or ""
    label, icon = SPORT_LABEL.get(tk) or (tk.removesuffix("_v2").replace("_", " ").capitalize() or "Other", "other")
    return {"type": tk, "sport": label, "icon": icon, "kind": kind(tk)}


def group(type_key: str | None) -> str:
    return SPORT_GROUP.get(type_key or "", "other")


def outdoors(type_key: str | None) -> bool:
    return (type_key or "") not in VIRTUAL | INDOOR
