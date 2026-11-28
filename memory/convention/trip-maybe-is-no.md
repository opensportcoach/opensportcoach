---
type: convention
status: active
since: 2026-11-28
source: the owner, designing trips
enforced_by: tests/run_tests.py::test_trip_rules_are_keyed_on_sport_and_how_it_is_done
---

# A maybe on a trip is planned as a no

When an athlete says a place on a trip *may* have something — "maybe I can take my bike in the car,
I'll confirm" — nothing is planned on it until they confirm it. `scripts/trips.py allows()` counts a
`maybe` as not there; the daily asks for the answer from `ASK_DAYS` (10) before the trip, and Today
shows the question. Once answered (`trips.py answer`), the plan can use it.

Why: a plan built on a bike that doesn't fit in the car fails on the day, with no time to replan; a plan
built without it only gains a ride when the answer comes.

Also decided the same day: the first and last days of a trip are travel days, kept light (no intensity,
no test), with one home session when the athlete leaves after the morning or is back before the evening;
away from the gym, a gym day becomes a bodyweight session or moves before or after the trip.
