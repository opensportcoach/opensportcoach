---
type: incident
status: mitigated
since: 2026-08-26
source: his message — "I accidentally deleted it when trying to remove it from the calendar"
enforced_by: scripts/sync_workouts.py — verifies an id resolves before scheduling
---

# He can destroy a workout while trying to unschedule it

Swim A vanished from the account and `schedule_workout` 404'd on it. Cause, from him:

> "I accidentally deleted it when trying to remove it from the calendar."

In Garmin Connect, **removing a calendar entry and deleting the underlying workout sit next to each
other**, and deleting kills it for *every* future date, not just the one he was looking at.

## Consequences

- **Tell him to ask for an unschedule** rather than clearing the calendar himself. Unscheduling
  needs the SCHEDULE id from `calendarItems`, which is exactly the distinction the app blurs.
- **Verify an id still resolves before scheduling it.** Never assume an id from a doc is live.
- **Re-uploading is cheap because the JSON is generated.** Swim A came back byte-identical in
  seconds. This is the payoff for `build_swims.py` existing at all — never let a pushed workout
  exist only as a hand-written file.
