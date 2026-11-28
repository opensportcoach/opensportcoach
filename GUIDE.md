# Operating guide

**Nothing runs by itself.** Every workflow starts with something you type. Scheduling is possible
but is not set up — see the last section.

**More than one person can use this folder**, one at a time. Everything below is the same for
everyone; what differs is whose program, data and watch a session works on.

---

## Start every session by saying who you are

Open a new session in the OpenSportCoach folder and **start your first message with your name**:

> Rocky — run the daily
> Sam — plan my gym week

The session locks to you for its whole life, and the banner confirms it:
`OSC · Athlete: Sam · Garmin: <your Garmin name>`. If you don't say who you are, it asks. Every
push confirmation names your Garmin account — if it ever names the other person, say no.

- A session is **never switched** to the other person. If the wrong name was given, start a new one.
- Resuming an old session keeps its owner.
- Don't run two sessions at the same time.

## The first time — set up

Say your name and **"set me up"**. The coach runs `/osc-setup`: first the safety part (you confirm you
are an adult, accept [`DISCLAIMER.md`](DISCLAIMER.md) and answer a short health screen), then where your
data comes from, your goals, races, injuries, schedule and equipment. It takes one conversation.

**Where your data comes from:**

- **Garmin** — the richest: activities, sets, sleep and recovery, and workouts sent to your watch. You
  connect it yourself, once (below).
- **Your own files** — FIT, GPX or TCX from any device or app, and Strava's free *Download your data*
  archive. Drop them in `data/<you>/inbox/`; every refresh imports them.
- **Strava's MCP** (Strava subscribers) — recent sessions, read by the coach in a session. You connect
  it yourself: `claude mcp add --transport http strava-mcp https://mcp.strava.com/mcp`.

Without Garmin there is no sleep or recovery data — the coach asks how you feel — and nothing is sent
to a watch: your plan lives in the app.

### Connecting your Garmin

Once per person, in a terminal (the app's Terminal tab works), **type your own credentials**:

```
cd ~/opensportcoach
.venv/bin/python scripts/login.py --athlete sam
```

It shows the Garmin account's name and asks you to confirm it is yours. After that, no script ever
needs your password again, and every login is checked to be yours. The coach never types or sees
your password.

---

## The trigger table

| When this is true | Type this | Or just say |
|---|---|---|
| Morning, or you want today's plan | `/osc-daily` | "run the daily process" · "what should I do today?" |
| You just finished a session | `/osc-daily` | "just got back from the gym" |
| A lift dropped and you want to know why | `/osc-review 2026-09-01` | "why did my leg press drop?" |
| Planning several days ahead | `/osc-week` | "plan the week" · "schedule gym for Tuesday" |
| Sunday, end of week | `/osc-week` | "weekly recap" |
| Anything needs to reach the watch | `/osc-push` | "push" · "schedule it" |
| You entered a race, or want its date checked | `/osc-race` | "I entered the city half marathon" · "check my race dates" |
| The day after a race | `/osc-race` | "I raced yesterday" |
| You'll be away from your usual setup | `/osc-week` | "I'm in Lisbon 3–6 May, no gym, I can run" · or **Season · Trips** in the app |
| Monthly, or something feels off system-wide | `/osc-audit` | "audit the project" |
| Unattended / scheduled run | `/osc-brief` | — |

**The slash command and the sentence do the same thing.** Each skill has a description written to
catch the natural phrasing. Use the slash command when you want to be certain which one fires.

---

## What each one actually does

**`/osc-daily`** — refreshes the data (~60 s), then *decides what analysis is warranted*. If you
trained, it reviews the session and checks for bump signals. If you didn't, it says so in two lines
and stops. Ends with a visual brief and a recommendation. **Never pushes.**

**`/osc-review <date>`** — a deep review of one session, judged by the rubric for its sport: a gym
session spawns `execution-reviewer` for a multi-session pass; a run, ride, swim or circuit is read
in the session against its intent, every number checked against the engine. Use it when something
is odd or you want a proper read, not routinely — the daily loop already does the mechanical comparison.

**`/osc-week`** — the three-day rolling schedule, or the Sunday recap plus the insight pass.

**`/osc-push`** — the only path to Garmin. Runs build → validate → the full test suite (both
athletes' invariants) → prescription audit, names your Garmin account and asks you to confirm,
syncs, then round-trip verifies. **Refuses to run if the tests are red.**

**`/osc-race`** — your race season. Adding a race: you give the date, format, target and priority
(A: full taper, the season peaks for it · B: a hard day with easy days around it); the coach looks it up
on the organiser's site, records the check, and the windows around it start binding every daily and
weekly plan. It never changes a date you gave without asking. In the app: **Season · races** in the
sidebar, and **Check dates** there. **Never pushes.**

**Trips** — days away from your usual setup. For each place (gym, pool, bike, indoor trainer, running,
courts) you say yes, maybe or no, and whether time is limited. Every daily and weekly plan works with
what that place has: gym days move before or after the trip or become a bodyweight session, rides that
need a bike you won't have become runs, and the first and last days are kept light. **A maybe is planned
as a no** until you confirm it — the coach asks about ten days before. In the app: **Season → Trips** to
add one (saved directly), and **Replan around it** to get a proposal. Anything already on the watch that
no longer fits shows on Plan; moving it is a Send to watch.

**`/osc-audit`** — cheap deterministic checks first, then `integrity-auditor` fans out across data
correctness, doc drift, stale prescriptions, dead code, catalog coverage and account hygiene.

**`/osc-brief`** — for scheduled runs. Analyses, writes `athletes/<you>/logs/YYYY-MM-DD-brief.md`, and stops.
Cannot push.

---

## The app

A local web app on top of your coach session: today's call first, then every number, every workout down
to the last set, your plan, and an ask box. It runs on your Mac only (`127.0.0.1`).

```bash
./scripts/coach.sh
```

Run it in a terminal (the desktop app's terminal panel works). Accept the development-channel dialog,
say who you are and "run the app". The app opens straight away; the coach then pulls your Garmin data
and runs the daily — Today says "The coach is on it" and what it's doing, every screen reloads when the
new data lands. When it needs to know how you feel, the question appears right there on Today (1–5 and a
note; the terminal works too), and today's call follows your answer.

- **Asking** — the box on the right (in a narrower window, the **Ask the coach** button at the bottom
  right opens it), or "Ask about this" on any chart, workout or set — the page stays where it is.
  Enter sends; Shift+Enter starts a new line. Answers take seconds to minutes and the newest one reads
  right under the box (every earlier one is on Coach); you keep browsing meanwhile. One request at a time.
- **This number looks wrong** — on any workout. The coach checks it against Garmin and your history.
- **Accept plan** changes the plan. **Send to watch** is a separate step: a card names you, your Garmin
  account and exactly what changes. Your click is the confirmation — nothing reaches the watch
  without it, whatever else happens in the session.
- **Refresh data** pulls the last 4 days from Garmin and rebuilds every screen — at any time, as often
  as you like. Every open window shows it running, then what it pulled ("Updated 18:42 · 9
  activities") or why it failed. If the coach is already refreshing, yours waits for it.
- **Rides and runs** — power, cadence, pace, zones, best efforts, the route as a line, charts you can
  hover or drag across (or use the arrow keys), and the **coach's analysis** at the top: what the
  session was for and whether it did its job. Every number it cites is checked against the metrics. It
  runs by itself for every new ride and run once the data is refreshed (with the coach online); an older
  session keeps the **Analyse this ride** button. The written review folds in under it.
- **A planned ride or run on the watch** draws as Zwift draws a workout: one block per step, as long as
  the step and as tall as its target, coloured by zone (power against your FTP on a ride, heart rate
  against your zones on a run).
- **Hyrox and HIIT** show their stations as the watch logged them; names the watch guessed are marked.
- **Close the session and the app goes quiet** — it only answers while your coach session runs. A
  window left from an earlier session says so; use the one the newest session opened.

Data and coach answers stay on the Mac. To switch person, close the session and start a new one.

## Where you get asked

Two gates, and only two:

1. **Before any Garmin write.** Upload, schedule, delete, unschedule — all of it. You will be shown
   what changes and asked. Approving the programming is not approving the push.
2. **When the data can't settle it.** A machine question, how you feel, whether a drop was equipment
   or fatigue. Your answer outranks the numbers.

Everything else runs without asking.

---

## Telling it things it can't measure

These change the outcome, so say them:

| Say | Why it matters |
|---|---|
| "the gym was packed, I changed the order" | order stops being read as non-compliance |
| "I used the other leg press today" | same lift, different machine, incompatible numbers (e.g. a plate-loaded vs a selectorized leg press) |
| "I'm tired" / "I feel great" | **outranks every metric on the watch** |
| "I'm swimming tomorrow" | your stated plans outrank the template |
| "I'm away 4–7 Dec, no gym, maybe the bike" | the days you're away are planned with what that place has |
| "that weight is discs, not total" | changes how the load is scored |

---

## When something breaks

| Symptom | Do |
|---|---|
| The sync dies mid-run | just re-run — `refresh.sh` resumes the run that stopped, the sync is idempotent |
| The app says "This window is from an earlier coach session" | a newer session owns the app — use its window, or start one with `./scripts/coach.sh` |
| Today shows numbers "from yesterday" | this morning's reading hasn't reached Garmin — sync the watch, then **Refresh data** |
| `/osc-*` missing from the `/` list | frontmatter parse error; say so and it gets fixed |
| "No athlete is bound" | the session doesn't know who you are yet — say your name |
| "REFUSED: … tokens belong to …" | the saved Garmin login isn't yours; nothing was read or written. Re-run `login.py --athlete <you>` |
| A number looks wrong | **say so.** The raw list gets pulled before the number gets defended |
| Duplicate workout on the watch | say so — the keeper is verified, the other deleted |

---

## Making it automatic

Not set up. If you want a brief waiting for you each morning, it needs a scheduled task running
`/osc-brief` — which analyses, writes to your `logs/`, and stops.

**It can never push**, so the shape would be: read the brief on your phone, and when you're ready to
train, open a session and say "push". One scheduled task per person, and its prompt must name you —
an unattended run never picks an athlete by itself. Ask for it and it takes about ten minutes to set
up.
