---
type: convention
status: active
since: 2026-08-30
source: the 2026-08-30 audit, finding 2
enforced_by: scripts/prescription_audit.py
also_enforced_by:
  - tests/run_tests.py::test_prescription_history_covers_every_prescription
  - tests/run_tests.py::test_audit_ignores_the_session_that_caused_the_bump
  - tests/run_tests.py::test_audit_met_needs_reps_inside_the_range
  - tests/run_tests.py::test_audit_skips_annotated_sessions
  - tests/run_tests.py::test_a_swapped_exercise_starts_a_clean_history
---

# A permanently-on alarm is not an alarm

The prescription audit used to flag every load above his executed best. That fired **9 of 27
prescriptions every single day** — and **six of the nine were bumps applied that morning**, which
are above his best *by construction*, since a bump fires the moment he hits range-top.

The cost was real: the premature 2026-08-02 cable-overhead-triceps prescription survived **nine
days** after being flagged, because it was buried in fresh bumps.

## The four verdicts now

| | Meaning |
|---|---|
| **FRESH** | the ask changed and he has not trained it since — silent by design |
| **NO HISTORY** | never executed under this key, so the IMPOSSIBLE check has nothing to compare against |
| **watch** | one session since the ask, not met — noted, not alarmed |
| **STALE** | **two or more sessions, never once met — this is the signal** |
| **IMPOSSIBLE** | implied e1RM more than 8 kg above lifetime best — a bug regardless of freshness |
| **ABANDONED** (prefix) | no session of this day's prescription in 21 days — not push-blocking, but not "fresh" either |

Freshness comes from `athletes/<name>/workouts/PRESCRIPTION_HISTORY.json`, written by `build_workouts.py` on every
build. An entry's `since` only moves when weight or reps change.

## What counts as an attempt (2026-10-04)

- **After the ask, by timestamp.** `since_ts` is the build time. Only sessions that started after it
  count. Matching by date counted the session that caused a bump as the first attempt at it: all
  four WATCH rows on 10-04 were that session, one real miss away from a push-blocking STALE. Entries
  set before 10-04 carry a date only, and the audit reads them as the end of that day.
- **Per prescription.** Attempts are matched to `day/exid`, not to the catalog pair (see
  [[2026-09-21-prescription-history-collision]]).
- **Met = the load, with reps inside the range.** The range bottom is top−2 for `reps` asks, and the
  exact number for `fixed`. Load-only, any set at 80 met a 4×10 @80 ask. Requiring the range top
  would turn normal double progression into STALE; reaching the top is a bump signal, which is
  `progression_report.py`'s job.
- **Annotated sessions are not attempts.** Backoffs, equipment and asks he never saw are excluded.
- **A different lift under the same id is a new prescription**, with a clean `since` and no
  inherited `changes`.

