---
type: incident
status: fixed
since: 2026-08-29
source: he caught it — "you are not right, yesterday I did 2 run workouts"
enforced_by: tests/run_tests.py::test_run_and_bike_families_are_complete
also_enforced_by: tests/run_tests.py::test_every_logged_sport_typekey_is_grouped
---

# Two runs vanished because a lookup table was missing one key

`SPORT_GROUP` had `treadmill_running` but not **`virtual_run`**. On 2026-08-28 he ran twice —
virtual 2.82 km plus treadmill 2.20 km, **5.02 km total** — and the brief reported **run 0/2** and
*"5 days since last run"* the morning after he ran 5 km.

**He caught it, not the tests.**

Same family as [[2026-08-14-volume-attribution]]: a lookup with a silent default, output that looks
entirely plausible.

## What was changed

Added the missing run, bike and swim variants. Then two tests: one pinning the families, one walking
the cached pulls for any `typeKey` that is neither mapped nor on an explicit known-other list. **The
second immediately surfaced five more** — `indoor_cardio`, `mobility`, `paddelball`, `sailing_v2`,
`tennis_v2`.

**The lesson:** when he says the data is wrong, pull the raw list before defending the number. He
was right and the check cost two minutes.
