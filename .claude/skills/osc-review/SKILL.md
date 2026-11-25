---
name: osc-review
description: Deep review of one training session, judged by the rubric for its sport — a strength session against its prescription and the multi-session trend (spawns the execution-reviewer agent), a run or a ride against its intent (in-session, from endurance_metrics.py), or a pool swim or circuit (HYROX) against the workout it followed (session_review.py). Use when a session looks anomalous, when the athlete asks why something dropped, when they ask for a proper review of a named date or session, or when the app asks to analyse a ride, run, swim or circuit.
---

# Session review

For the mechanical planned-vs-executed comparison, do it inline — that is part of `osc-daily`.
**This skill is for when something needs breadth**: a pattern across many lifts, an unexplained
drop, a trend that only shows over several sessions, or a proper read of one ride, run or swim.

## Pick the rubric — and read only that one

Each sport is judged by its own rubric, a file next to this one. Find the activity's group
(`scripts/sports.py`: the activity's `typeKey` → group), then read **only** that file:

| The session | Rubric | Engine |
|---|---|---|
| a gym session (sets) | [`strength.md`](strength.md) | the `execution-reviewer` agent |
| a run (road, trail, treadmill) | [`run.md`](run.md) | `endurance_metrics.py` |
| a ride (outdoor, Zwift, indoor trainer) | [`ride.md`](ride.md) | `endurance_metrics.py` |
| a pool swim | [`swim.md`](swim.md) | `session_review.py` |
| a circuit (HYROX, a station circuit) | [`circuit.md`](circuit.md) | `session_review.py` |

**A multisport session** (a brick, a triathlon): review each leg as its own activity with its own
rubric. The transitions are not judged.

**Never** compare one sport's HR zones, pace or power with another's: a run's wrist power is not a
ride's power, and a run has no FTP.

## Every ride, run, swim or circuit review — the shared steps

The rubric says what to measure and how to judge it. Everything else is the same for all four:

1. **The numbers come from the engine; you interpret them.** Never type a number the engine did not
   compute — into a finding, the verdict or the summary.
2. **Intent**, in this order: a workout scheduled that day (`scheduled.json` / the calendar view) or
   a dated session in `plan.json` → `planned`; what they said they'd do (logs, the conversation) →
   `athlete`; otherwise read it from the data and mark it `inferred`, and say so in `why`. **The
   day's call outranks the template**: if this morning's daily changed the session (dropped the
   strides, shortened the ride), judge against the call, and say what the watch still had.
3. **Context** — only what bears on this session: the night before (recovery view), the session the
   day before, load over 7 and 28 days, heat (`weather.temp_c`, `feels_like_c`, `humidity_pct`,
   converted by the engine, outdoors only; never read a raw weather file), and their own word on how
   they felt.
4. **Write the result** — kind `endurance_review`, contract `app/contracts/endurance_review.schema.json`:
   - **`verdict`:** one line.
   - **`execution`:** a rating and a summary.
   - **`findings`:** at most 6. Include what went well. Each one's numbers go in **`evidence`** as
     paths: `metrics.<key>`, `bests.<key>`, `zones.<hr|power>.<n>` (% of time),
     `thresholds.<ftp|threshold_hr>`, `intervals.<n>.<field>` (a lap, a rep or a step: the rubric
     says which fields its engine has). Keep numbers out of the claim text; the evidence carries them.
   - **`next_time`:** one concrete change.
   - **`questions`:** at most 3, when the cause isn't in the data. **Ask rather than conclude.**
5. **Validate it:** `.venv/bin/python scripts/app_contracts.py validate endurance_review <file>`. It
   checks the shape **and every evidence number against the engine**. A refusal names the wrong
   number: fix it from the engine's output, never by rounding toward what you wrote.
6. **Deliver it:**
   - **From the app** (a `workflow` review request carrying `activity_id`): write the JSON to
     `data/<name>/app/results/<request_id>.json`, then `app_publish(request_id, "endurance_review", file)`.
   - **Always:** also write it as markdown to `athletes/<name>/logs/YYYY-MM-DD-<activity_id>-review.md`,
     named with the session so the app shows it on that session's page. The journal lists it.
   - **When the day's daily exists**, give the session its one line in `endurance` (strength: the
     review in `review`) and validate the daily again.

**Never:**
- call fitness gained or lost from one session (that's the trend's job);
- explain a flag you can't support. Ask instead;
- judge a session against another athlete's numbers, or against the population's.
