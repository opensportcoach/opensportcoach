---
type: preference
status: active
since: 2026-06-12
source: CLAUDE.md rules, reinforced by the 2026-08-26 accident
enforced_by: scripts/sync_workouts.py
also_enforced_by: scripts/validate_workout.py
---

# Never write to Garmin without an explicit confirm

Read operations are free. **Every upload, schedule, delete or unschedule needs his explicit
confirmation**, and the validation gate must pass first. Never bypass it, even when he seems in a
hurry.

## Workouts that predate this project are untouchable

Their ids are recorded once, in `athletes/<name>/athlete.json` → `protected_workout_ids`, when the
account is bound. `sync_workouts.py`, `reschedule_workout.py` and `delete_workout.py` assert them.

## Push hygiene — five rules, all now in sync_workouts.py

1. Uploads **always create a new id** with the same name — there is no update verb.
2. So **delete the superseded id in the same breath**, or he opens the stale one from the watch.
3. **Re-point any calendar entry** to the new id.
4. **Verify an id still resolves before scheduling it** — see [[2026-08-26-accidental-workout-deletion]].
5. Never touch his three swims.

## Unattended sessions may never push

A scheduled run has nobody to confirm with. It may pull, analyse, write a log — and stop.
