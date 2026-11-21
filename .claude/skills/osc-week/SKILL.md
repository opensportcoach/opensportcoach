---
name: osc-week
description: Weekly planning and recap — the rolling schedule, the week-over-week recap, and the weekly insight pass. Use when the athlete asks to plan the week or several days, or on the last check-in of an ISO week.
---

# Weekly planning and recap

The session must be bound to the athlete (see `osc-daily`, step 0). Their weekly shape — how many
gym days, how cardio pairs with lifting, their targets — is in `athletes/<name>/ATHLETE.md`.

## Planning the next days

Keep **today plus the next two** on their Garmin calendar (or their own horizon, if `ATHLETE.md`
says otherwise). The plan stays mutable — the daily loop can and should rewrite any of it.

1. `rotation_status.py` — **most-starved first**, and >7 days outranks next-in-rotation.
2. Pair gym with cardio so the PM session does not hit what the AM session just trained, following
   the athlete's own pairing rules in `ATHLETE.md`.
3. **Their stated plans outrank the template.** If they say they are swimming Tuesday, they are.
4. Read the calendar first — `reschedule_workout.py` lists it on a dry run, and scripts read it
   through `garmin_client.read_scheduled_workouts`. **Fill gaps, never blind-schedule over an item.**
5. Changing a scheduled day is unschedule + reschedule, and unscheduling needs the **schedule id**
   from `calendarItems`, not the workout id.
6. **Race windows bind the days you plan** (`races.py on <date>`, for each one): never a benchmark or a
   hard session inside an easy, taper or recovery window, and **race week** is written around the race —
   its start time, the travel, the easy days before it. A benchmark the tests flag inside a window moves.

Scheduling is a Garmin write → `osc-push`, with their confirm.

**Sessions that never go to the watch** — Zwift (Zwift runs it), the long ride, tennis — go in
`athletes/<name>/plan.json` (date, title, sport typeKey, detail, why; `"platform": "zwift"` for a Zwift session, which shows Zwift's mark; `"duration_min"` when you know how long it runs — Today's This week otherwise draws it at the athlete's typical time for that sport; and **`"intent"` on every ride and run** — recovery · endurance · tempo · threshold · vo2 · race · mixed, what the session is for. Its fuel plan reads the intent and the minutes (`scripts/fuel.py`, docs/DESIGN.md (fuelling and score) §4.3); without them the app shows no fuel for it, and never write the grams into `detail` by hand), or the app's Plan and Today
screens never show them. Writing that file is not a Garmin write: no push, no confirm. Keep it to the
days you are planning, and drop a session from it when the plan changes. `tests/run_tests.py` checks it.

**Every Zwift ride names a Zwift workout** (his rule, 2026-11-05; `memory/convention/zwift-workout-named.md`).
The 11-05 VO2 ride said "5 × 3′ at 292–305 W" and named nothing, so he rode what Zwift offered: 9′ of
work against 15′. A Zwift session in `plan.json`, and a Zwift day in a `plan_proposal`, carries
`zwift_workout`, a real workout from Zwift's library that does the session's job:
1. Find it on <https://whatsonzwift.com/workouts>: the collections (Endurance, Recovery, Sweet Spot,
   Threshold, VO2 Max, Sprinting…) or the finder, which filters by duration and zone.
2. Read its steps at the athlete's FTP and hold them against the prescription: the intensity, the
   **time at intensity**, the warm-up, and the day's ceilings (a power cap, a race window). Prefer one
   whose work time is at least the prescription's.
3. Open its page with your web tool and read the block off it — `name`, `url`, `collection`,
   `duration_min`, `stress_points` — never from memory. Check it:
   `.venv/bin/python scripts/zwift_workouts.py '<json>'`. A 404 or a collection page: search again.
4. When nothing matches exactly, take the closest and say in `adjust` how to ride it ("in ERG, lift
   cadence to 110–120 rpm for 20 s every 5′"; "add two more 3′ reps"). `detail` keeps the prescription.
5. Name it in the reply as well: what to open in Zwift (the collection, then the name), and the watts at
   their FTP.

If they choose to free-ride instead, keep the recommendation and record their choice in `detail`.
`tests/run_tests.py` refuses a Zwift session dated from 2026-11-06 without one, and the
`plan_proposal` contract refuses a Zwift day without one.

**For an athlete who keeps a horizon, an accepted week's watch sessions beyond it** (Legs on day 4, say) go in `plan.json` too, each
naming its managed `workout` and carrying that workout's own name and sport type (from its generated
JSON). Garmin only holds today plus the next two, so without this the Plan screen shows those days as
Rest (2026-10-16). The entry hides itself once Garmin's calendar has that workout on that day; the
daily schedules it two days ahead, as usual, through `osc-push`.

## The recap, on the last check-in of the week

- Week load **split into cardio and strength** — never present `weekLoad` alone. Garmin's load is
  EPOC-derived and lifting sits near 100 bpm, so a 73-minute push session scores 16 while a
  13-minute run scores 43. Load is a cardio measure.
- Tonnage and executed sets per muscle vs the athlete's target bands (`athlete.json` → profile) —
  that is the strength axis.
- Cardio against the athlete's own targets and what they actually did, grouped by `typeKey`, not
  against the plan.
- With a race season: weeks to the next race, and the target check — the prediction against the target
  where the data has one (the races view), "not tested yet" where it has none.
- Wins and watch-items, then the shape of next week.

## The end of a block

If the athlete's `program.py` declares a `BLOCK`, a block is the **frame**: its goal, session types,
benchmarks and week-to-week progression are set once, and the daily loop still decides each day
inside it. Nothing here overrides the daily loop's adjustments.

- **In its last week**, the recap is a block review: each `BENCHMARKS` result against the number it had
  to beat (a missing result is "not tested", never a guess), what moved in the gym (e1RM, executed
  sets per muscle vs bands), what did not, and the week-by-week compliance with the cardio arc.
- **Then propose the next block** — name, start (the day after this one ends), weeks, and its cardio
  arc in `program.py` (`BLOCK`, `CARDIO`), opening with an easier week before its tests. The results
  just recorded become the numbers to beat. It is a programming change: the athlete approves it,
  `CURRENT_ROUTINE.md` changes with it, and anything that reaches the watch goes through `osc-push`.
- **With a race season**, the next block is planned backward from the A race (`program.py → SEASON`:
  the blocks to it, each with its emphasis and the race it opens or ends with — docs/DESIGN.md (races) §4). A B
  race opens a block where it can, so the race and its easy days are the block's easier first week.
  `SEASON` changes only with the athlete's approval, like `BLOCK`.
- A benchmark result goes into `BENCHMARKS[].results` the day it happens, by the daily loop — not
  saved up for the review.

## The weekly insight pass

Spawn `insight-agent`, telling it the athlete's name. **A finding must clear all four bars** — ≥3
data points, actionable, not already known, and survives a stated counter-hypothesis.

**"No findings this week" is a correct and common answer.** An agent that cannot say that will
manufacture significance, they will stop reading it, and then it is worse than nothing.
