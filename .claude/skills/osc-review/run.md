# Rubric: a run

Read [`SKILL.md`](SKILL.md) first: intent, context, the contract, validation and delivery are the
shared steps there. This file is what a run adds.

## Measure it

`.venv/bin/python scripts/endurance_metrics.py <activity_id> --json`: metrics (each `garmin` or
`computed`), HR zones with this session's bounds, run bests (`bests.1k`, `bests.5k`), weather, flags,
and **`intervals`**, the laps.

- **Laps are cited as `intervals.<n>.<secs | metres | hr | pace | cadence | power>`**, where `pace`
  is the lap's s/km, `cadence` its spm and `n` its lap number. The engine lists every lap once there
  are two or more: a watch workout's steps (`type` says warm-up, active, recovery or cooldown) and a
  plain run's km auto-laps alike. A one-lap run has none: cite whole-run metrics.
- **Build the lap table in the markdown from the intervals**, so its numbers are the ones the
  evidence is checked against. Max HR per lap is Garmin's (`activity_<id>_splits.json` → `lapDTOs`):
  label it so.
- **A run has no FTP**: never an IF or TSS claim. Wrist running power is not a ride's power; don't
  compare the two, and don't judge a run by power.

## Judge it against its intent, by HR and pace

- **Easy and long runs: the athlete's own ceiling first.** If their memory or profile names an
  easy-run HR cap (`memory/preference/`), judge the time and the laps against **that cap**, not
  against Garmin's zones 1–2. A cap set off the lactate threshold can sit inside Garmin's zone 3,
  and then "most of the time in zone 3" is the cap working as set, not a run that was too hard. With
  no cap named, use zones 1–2.
- **On a steady block, HR should not climb at a constant pace.** Compare the first and last steady
  laps (`intervals.<n>.hr` and `.pace`). Laps that cross the cap late, at an unchanged pace, are the
  usual miss. The fix is to slow down when the HR passes the cap, not to hold the pace.
- **Decoupling covers the whole moving time.** With strides, reps or a fast finish in the second
  half, it mixes them in and reads low. Call it approximate, and let the steady laps speak.
- **Strides and reps:** each one quick and relaxed (about 20 s for a stride), then a walk or an easy
  jog until the HR comes down. Check every recovery lap: its HR should fall from the rep before, and
  its pace should be slower than easy pace. Recoveries jogged near tempo turn six strides into one
  hard block, and the HR stacks rep on rep.
- **Tempo, threshold and tests:** against `thresholds.threshold_hr` and the plan's target pace.
  Pacing should be even or negative. A first km well under the target that the rest can't hold is the
  common miss. A **benchmark** (a 5 km time trial, a 400 m) is recorded in their `BENCHMARKS`
  results: the measured number, never an estimate (`osc-daily` step 3).
- **Hills:** `metrics.gap` against `metrics.pace`, and `metrics.elevation_gain`. On a hilly route,
  judge by HR, not pace.
- **The day before.** A legs day, sprints or a long ride within about 24 h raises the HR at the same
  pace. Say so rather than reading fitness into it.
- **Heat and humidity** from `weather` (outdoors only). A treadmill has no weather, and its pace comes
  from the wrist: judge a treadmill run by HR.
- **Running form** (cadence, ground contact, vertical oscillation, stride) is context. A cadence
  that sags in the last laps is a fatigue sign worth one line. It is never a verdict from one run.
- **The cooldown.** Note it when it was skipped. Don't make it a finding unless it keeps happening.

## Ask, don't guess

The usual unknowns: why a planned change didn't happen (they felt better, or the watch led them in),
a stop (traffic, a call), a treadmill's incline, and what they ate before a long one.
