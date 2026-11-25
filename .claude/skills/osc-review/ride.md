# Rubric: a ride

Read [`SKILL.md`](SKILL.md) first: intent, context, the contract, validation and delivery are the
shared steps there. This file is what a ride adds.

## Measure it

`.venv/bin/python scripts/endurance_metrics.py <activity_id> --json`: metrics (each `garmin` or
`computed`), HR and power zones with this session's bounds, power bests (`bests.<secs>s`),
thresholds, weather (outdoors), flags, and **`intervals`**, the laps.

- **Laps are cited as `intervals.<n>.<secs | metres | hr | power | cadence>`**, where `n` is the
  lap number and `cadence` its rpm. The engine lists every lap once there are two or more: a Zwift
  workout's blocks (Zwift marks them all ACTIVE), a watch workout's steps, and auto-laps. A one-lap
  ride has none: cite whole-ride metrics. NP and max HR per lap are Garmin's (`lapDTOs`): label them
  so in the markdown.
- **No FTP → no IF or TSS claim.** Tell them how to set `ftp_w` in `athlete.json` → `profile`.

## Judge it against its intent

| Intent | On target |
|---|---|
| **Recovery** | zone 1, IF under about 0.6 |
| **Endurance** | most of the time in HR zones 1–2, IF under about 0.75, decoupling under 5 % |
| **Tempo** | IF about 0.76–0.87 |
| **Threshold** | IF about 0.88–1.0, or work intervals at threshold |

- **The athlete's own Z2** (a power or HR range in their plan or memory) outranks the table, as an
  easy-run cap does for a run.
- **Without power** (most outdoor rides): judge by HR zones and speed per heartbeat. Hills and wind
  bend speed, so a speed-based decoupling is approximate, never a verdict.
- **Outdoors: surges.** A group ride or rolling terrain shows in `metrics.vi` and the short power
  bests. An endurance ride with big 5 s and 60 s bests was a different ride, whatever its average.
- **Indoors (Zwift, a trainer):**
  - **In ERG, the trainer sets the power.** Hitting the target isn't execution. Judge the HR and the
    cadence (`intervals.<n>.cadence` against the workout's rpm), and the HR drift across the steady
    block.
  - **A planned Zwift ride names its workout** (`plan.json` → `zwift_workout`). Its laps are the
    workout's blocks, in order: judge each against its block, and say when one was cut short (a
    ramp-down of seconds is the usual one).
  - **Whole-ride decoupling** includes the warm-up ramp. A ramp in the first half makes it read
    negative: that's no drift, not a gain. The steady block's HR says more.
  - **No weather.** If the HR drifts indoors, ask about the fan and the room before calling it
    fatigue.
- **Structured rides:** judge each work interval by `intervals.<n>.power` against its target, and
  check that the recoveries come down. With intervals in the second half, decoupling is approximate.
- **Fuel, on a ride of an hour or more:** compare their `logs/fuel.json` record (self-reported) with
  `scripts/fuel.py plan <minutes> <intent> bike`. No record → ask once. Never fill it in.

## Ask, don't guess

The usual unknowns: a stop (traffic lights, a puncture, a café), drafting in a group, the wind, the
fan indoors, and what they ate and drank.
