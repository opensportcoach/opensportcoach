---
type: convention
status: active
since: 2026-11-07
source: docs/DESIGN.md (fuelling and score) §5 and S1–S4, approved 2026-11-06; Phase 2 built 2026-11-07
enforced_by: tests/run_tests.py::test_score_a_strength_session_by_sets_reps_load_and_rest
also_enforced_by: athletes/<name>/tests.py (an athlete may add their own)
---

# The execution score is the engine's, never the coach's

A session's score (0–100, its band, its parts) comes from `scripts/session_score.py` and nowhere
else. Weights, bands and thresholds live in `formulas.py` (`SCORE_WEIGHTS` … `SCORE_DEFINITIONS`).
A review, the daily or the app cites the number. It never re-derives one, and never rates "on target"
in its own words when a band exists (S3).

- **Against what was agreed that day.** Strength reads `program.py` from git as committed before
  the session started, because the program changes weekly. Rides and runs read the plan.json session
  that day, by its `intent` and `work`. Free text is never parsed.
- **Not scored, with the reason:** nothing planned (S1), a whole-session annotation, swims and HYROX
  (Phase 7).
- **Not comparable rather than low:** a `machine_change` annotation drops that lift's load. Sets the
  watch couldn't name come out of the denominator, not into the misses. Under 60 % coverage, no total
  is shown.
- **Over the ask is flagged, never rewarded.** Near double means suspect the implement
  (`memory/incident/2026-09-21-key-implement-mismatch.md`).
