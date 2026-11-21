---
type: convention
status: active
since: 2026-06-12
source: the bootstrap history pull — 29% of 90 days of sets carried a usable exercise name
enforced_by: none — a reading rule; scripts/export_dashboard_data.py files unnamed sets as Unattributed rather than guessing
---

# Never trust an auto-detected exercise name

When a strength session is recorded WITHOUT a structured workout on the watch, the watch guesses the
exercise from the motion. On one athlete's first 90 days only **~29% of sets** came back named, and the
names that did come back were often wrong in the worst direction: bench logged as `PUSH_UP`,
deadlift as `SQUAT`.

**The rule:** progression, e1RM, volume-per-muscle and bump signals are computed from sessions run
from a structured workout, whose steps carry the prescribed catalog key. Auto-detected history is
context — frequency, duration, rough load — never a lift-by-lift baseline.

**Why it matters for a new athlete.** Their first pull will be all auto-detected. Read it for *how
often and how long* they train, then ask what the lifts and loads actually were. Their first two
weeks of structured workouts are the real baseline.
