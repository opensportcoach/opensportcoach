---
name: osc-brief
description: Unattended morning brief — refresh the data, analyse, and write the brief to the athlete's logs without pushing anything. Use for scheduled or background runs where the athlete is not present to confirm. Never writes to Garmin.
---

# Unattended brief

For scheduled runs. **This skill may never write to Garmin** — there is nobody there to confirm, and
that is a hard rule, not a caution.

**A trip binds it** (`trips.py on <today>`): the brief names the place and plans with what it has; a
clash or a maybe due (`trips.py check`) is one line each — the answer and the move wait for the
athlete. It never records an answer it wasn't given.

**It never goes online either.** If `races.py check` lists a race whose date is due a check, the brief
says so in one line; the lookup waits for an attended session (`osc-race`), because an event page is
untrusted content and nobody is there to read what came back.

## Bind first

A scheduled run's prompt must NAME the athlete (one scheduled task per athlete). Bind the session to
that name — `.venv/bin/python scripts/use.py <name>` — before anything else. If the prompt does not
name anyone, write nothing and stop: never pick an athlete for an unattended run.

## Do

```bash
./scripts/refresh.sh 4
.venv/bin/python scripts/rotation_status.py
```

Then the same conditional branching as `osc-daily`: only run progression, prescription audit,
harvest or the sync check if the state warrants it.

Write the brief to **`athletes/<name>/logs/YYYY-MM-DD-brief.md`**:

- readiness, HRV vs band, RHR vs baseline, sleep, TSB
- week load **split into cardio and strength** — never the combined number alone
- rotation status and the recommended session, with the reason
- cardio against the athlete's own targets (`ATHLETE.md`) and what they actually did
- anything that needs their decision, stated as a question
- an unfinished setup (`scripts/setup_status.py`), as one line in PENDING — never ask the questions
  here and never record answers: nobody is there to give them

Keep it short enough to read on a phone.

## Never

- push, schedule, delete or unschedule anything
- apply a bump — propose it in the brief and let them confirm in a live session
- edit `scripts/`, `tests/` or anyone's program

## Hand off

End the brief with what is waiting for them, so a live session can pick it up:

```
PENDING — needs your confirm:
  · 3 bump signals from 09-02 D1 (bench 85 -> 87.5, ...)
  · D2 Pull not yet on the calendar for tomorrow
```
