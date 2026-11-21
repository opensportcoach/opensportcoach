---
type: convention
status: active
since: 2026-11-05
source: an athlete, 2026-11-05 — "whenever you plan a Zwift ride you must also recommend a workout from Zwift (you can find workouts in this website: https://whatsonzwift.com/workouts)"
enforced_by: tests/run_tests.py::test_a_planned_zwift_ride_names_a_real_workout
---

# Every planned Zwift ride names a workout from Zwift's library

**Why.** The 11-05 plan said "Zwift · VO2 50′: 5 × 3′ at 292–305 W" and named no workout. On the bike
he used "a Zwift training routine that was available", *8.5 Minutes Of Pain*: 9′ of work against the
15′ planned, in reps too short for HR to reach the top. Watts and reps in a note are not what he opens
in Zwift. A workout is.

**The rule.** A Zwift session the coach plans carries `zwift_workout` in `plan.json`, and so does a
Zwift day in a `plan_proposal`: a real workout from Zwift's library that does the session's job, with
its whatsonzwift.com page. Hold its steps at the athlete's FTP against the prescription: the
intensity, the time at intensity, the day's ceilings. When none matches, take the closest and say how
to ride it in `adjust`. Name it in the reply too.

**How.** Find it on <https://whatsonzwift.com/workouts>, then
open the page with your web tool and read the name, collection, minutes and stress points off it;
check the block with `.venv/bin/python scripts/zwift_workouts.py '<json>'`. Never from memory. The
script itself never fetches the site (its robots.txt forbids automated collection).

**Held by** `test_off_watch_plan_is_well_formed`, for every Zwift session dated from 2026-11-06 (the
ones already planned predate the rule), and by the `plan_proposal` contract. The app shows the
workout on the session panel, on Today's week and its Next card, on the proposal board and on the
phone page. For reading a ride that was already done, see `zwift-prescription-lookup.md`.
