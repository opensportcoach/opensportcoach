---
type: incident
status: fixed
since: 2026-11-08
source: the 2026-11-08 full audit (P1-1), verified against the activity's raw set file
enforced_by: tests/run_tests.py::test_audit_does_not_count_a_tapped_through_set
also_enforced_by:
  - tests/run_tests.py::test_weekly_volume_does_not_count_a_tapped_through_set
---

# A step tapped through on the watch is a logged set, and it is not work

On 2026-11-03 the athlete ran out of time and pressed the lap button through two steps to reach the
calves. Garmin logged both as ACTIVE sets with the prescribed weight and **no reps**: hip thrust 55 kg,
16.7 s, and leg curl 40 kg, 8.5 s. Two instruments read them as real:

| Reader | Rule | What it said |
|---|---|---|
| `prescription_audit.attempts()` | a set counts with "reps **or** duration" | a failed attempt at 4 × 12 @55, half of a push-blocking **STALE** on a lift never tried on the barbell |
| `export_dashboard_data` weekly sets | every set counts | Hams/Glutes **2** when the truth was 0 (band 10–16) |

The duration clause came from the 2026-11-01 bodyweight-hold fix (a plank has no reps), so it was
right for holds and wrong for every rep ask. **The corrupted numbers looked plausible**: a miss and
two sets.

**The rule now:** a rep ask needs a rep count; a hold needs at least half its asked duration
(`prescription_audit.is_work`). Weekly volume and the app's set counts need reps for any pair the
program asks in reps, and keep reps-or-time for holds and unprescribed pairs
(`export_dashboard_data.is_logged_work`). `progression_report.bump_rows` already skipped a rep-less
set. A tap moves no weight, so tonnage is untouched.
