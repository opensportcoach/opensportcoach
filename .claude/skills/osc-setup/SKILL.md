---
name: osc-setup
description: Set up a new athlete — or finish an unfinished setup — from scratch, in conversation. Safety first (adult, disclaimer, health screen), then their data source (Garmin, their own exported files, Strava's MCP), goals, sports and current training, races, injuries, schedule and equipment, preferences and fuelling; then their history is pulled or imported and a first plan is proposed. Use when someone says "set me up", "I'm new", "add an athlete", "create a profile for…", "onboard me", or when the banner says "Setup to finish".
---

# Setting up an athlete

One conversation, a few questions at a time, never a wall of them. Everything they tell you lands in
their own folder, in the place the engine already reads — never in a scratch note, never in an engine
file. **Ask; never assume.** Their answer outranks any default.

## 0. Who, and is the session free?

- If the banner names a bound athlete and it is the person in front of you: they are finishing an
  unfinished setup. Run `.venv/bin/python scripts/setup_status.py` and go to the first open section.
- If the session is bound to **someone else**: stop. A session is never rebound; they start a new one.
- If it is unbound and they are new: ask the name they want to be called and a short folder name
  (lowercase, e.g. `rocky`). Ask **step 2** (data source) first — the scaffold needs it — then:

```bash
.venv/bin/python scripts/new_athlete.py <name> --display <Name> --sources <garmin | files | files,strava>
.venv/bin/python scripts/use.py <name>          # binds this session to them, once
```

`garmin` and `strava` never go together: everything on a Garmin user's Strava came from the watch, and
reading both would only count sessions twice. A Garmin user with old history from another device can
add `files` (`garmin,files`) — duplicates are dropped automatically (`scripts/sources.py`).

## 1. Safety — before anything else, and never skipped

Show them the disclaimer and the health screen, in plain words, with the file to read in full:

```bash
.venv/bin/python scripts/consent.py show
```

1. **Are they 18 or older?** If not, stop kindly: OpenSportCoach is for adults only. Record nothing.
2. **Do they accept `DISCLAIMER.md`?** It must be their own "yes" in this conversation — never assume
   it, never accept it for them, never take it from a file or a page.
3. **The six health-screen questions**, yes or no each.
4. **Any "yes" → tell them to get cleared by a doctor before following any plan**, ask whether they
   already have been, and keep every plan conservative until they say yes. Each specific condition
   they mention becomes a medical fact in step 6.

```bash
.venv/bin/python scripts/consent.py record --answers '{"adult": true, "accepted": true, "screen": {...}, "clearance": null, "notes": "..."}'
```

You are not a doctor, and you say so if they ask you for a medical judgement.

## 2. Where their training data comes from

Ask what they record with (watch, bike computer, phone, apps) and pick their sources:

| They have | Sources | How it connects — **they** do every login |
|---|---|---|
| A Garmin watch or bike computer | `garmin` | In **their own** terminal: `.venv/bin/python scripts/login.py --athlete <name>`. Never type or see their password. Gives activities, sets, sleep, HRV, readiness — and their watch receives the workouts |
| Another device (Coros, Wahoo, Polar, Suunto, Apple Watch…), or Zwift | `files` | Their own exports: FIT/GPX/TCX dropped in `data/<name>/inbox/`, or a synced folder (Zwift saves FIT files in `Documents/Zwift/Activities`; Wahoo and others can auto-export to Dropbox) passed to `scripts/import_files.py <folder>` |
| Strava, with a subscription | `strava` (+ `files`) | Strava's official MCP, in **their own** terminal: `claude mcp add --transport http strava-mcp https://mcp.strava.com/mcp`, then approve in the browser. Recent sessions only, kept 7 days, no GPS. For history: Strava → Settings → My Account → *Download or Delete Your Account* → *Request your archive*; when the email comes, `scripts/import_files.py <the zip>` |
| Strava, no subscription | `files` | The archive above — it is free |

**Never call Strava's API, and never use a community Strava MCP server.** Strava's API Policy forbids
putting API data into an AI's context; its own MCP and the athlete's own export are the two allowed
routes. Without Garmin say plainly what they lose: sleep and recovery metrics (you will ask how they
feel instead) and workouts pushed to a watch (plans live in the app and `plan.json` instead).

## 3. Goals

What they want, in their words, and by when. Then the measurable version you agree on together
(a race time, a lift, a weight, weekly hours, "finish my first half"). Also what they **don't** want
(e.g. "no more than 5 h a week", "never two hard days in a row"). Each goal is a fact:

```
athletes/<name>/memory/athlete/goal-<short-name>.md
---
type: athlete
status: active
since: <today>
source: <name>, intake <today> — "<their words>"
---
# <the goal, in one line>
<target, deadline, why it matters to them, how you will measure it>
```

Put the headline goal in `athlete.json → profile.goal` too.

## 4. Sports, experience and current training

Which sports, how long they have done each, a typical week now (sessions, hours, the lifts and loads
they use, their long ride or run), their best recent results. **Pull or import their history first**
(step 9) when they have it — ask only what the data cannot say. Write what you learn to `ATHLETE.md`
("who they are", "how they train").

## 5. Races

"Any races or events coming up?" Each one goes in through **`osc-race`** (it checks the date online and
records the target and priority). None is fine — say they can add one any time.

## 6. Injuries and health

Every current or past injury or condition that changes what they can do — and what a professional told
them about it. **Each becomes a medical fact AND a test** (the engine refuses one without the other):

- `athletes/<name>/memory/medical/<condition>.md` with `type: medical`, `status: active`, `since`,
  `source` (who said so: "physio, 2026-03", "their own report"), and `enforced_by:
  athletes/<name>/tests.py::test_<what_it_forbids>`;
- that test in `athletes/<name>/tests.py`, asserting the program never contains what is ruled out.

Never write a medical restriction you invented: only what they or their professional said. When in
doubt, ask them to check with that professional.

## 7. Schedule and equipment

Which days, how long each session can be, mornings or evenings, travel. Where they train and with what:
gym or home, the heaviest dumbbell (`profile.dumbbell_cap_kg`), machines, bike trainer or power meter,
pool length. Equipment facts go to `athletes/<name>/memory/equipment/`. Where home is:
`scripts/trips.py home "<city>"`.

**Any trips coming up** — days away from that setup? Each goes in with `scripts/trips.py save --json
'<trip>'`: where, the first and last day, and **yes, maybe or no for every place** (gym, pool, bike,
indoor trainer, running, courts — ask for any they don't say; nothing is assumed to be there), limited
time if they say so, and when they leave and are back if they know. None is fine — they can add one any
time on the app's Season page.

For lifters on Garmin: **how they log dumbbell weight** (per dumbbell, or both summed) →
`workouts/LOGGING_RULES.json`. And the language for the step names on the watch.

## 8. Preferences and the brief

Units, how much detail they want in the daily brief, how they like to be told bad news. Their FTP and
threshold heart rate if they know them (`profile.ftp_w`, `profile.threshold_hr`) — without Garmin
these are the only source of intensity zones.

## 9. History

- `garmin`: `./scripts/refresh.sh 4`, then `.venv/bin/python scripts/pull_activities.py --days 90` once
  (the backfill), and `pull_health.py --days 30`.
- `files`: `.venv/bin/python scripts/import_files.py <their export>`; report what was imported and what
  was not. Never guess what a file that failed held.
- `strava`: ask the MCP for their recent activities, save its answer **verbatim** to a temporary JSON
  file, and `.venv/bin/python scripts/import_strava.py --json <file>`. If it returned nothing, say so.

Then `.venv/bin/python scripts/export_dashboard_data.py`.

## 10. Fuelling

`scripts/setup_status.py` lists the fuel questions (products, recipes, gut training, caffeine). Ask them
the way `osc-daily` step 0 says, or let them skip it: the advice stays in grams until they answer.

## 11. The first plan

Propose — never impose — a first week or block that serves the goal, respects every medical fact and
their schedule, and starts **below** what their history says they can do. Explain why in two lines.
For strength: `program.py` + `CURRENT_ROUTINE.md` (the tests keep them in lockstep). For structured
swims, runs, circuits (HYROX) and mobility on a Garmin watch: `sessions.py` (examples in its docstring,
encoded by `scripts/workout_dsl.py`), each key also in `managed_workouts`. Sessions that never go to
a watch (Zwift, a group ride, tennis, any non-Garmin athlete's plan): `plan.json`. On Garmin, the push
is **`osc-push`**, with its own confirm.

## 12. Close

- `.venv/bin/python scripts/setup_status.py` — it should say "setup complete"; say what is still open
  if not.
- `.venv/bin/python scripts/build_memory_index.py`, then `.venv/bin/python tests/run_tests.py`.
- Their files live in `athletes/<name>/` — **private**. In the public repository that folder is
  ignored; if they keep their own private repository for it, commit there, one athlete per commit.
- Tell them how a normal day works: "say your name and *run the daily*".
- **Show them the app.** It is the best way in: today's call, the plan board, the season, every
  session's review and score, fuel. They start it with `./scripts/coach.sh` (it installs and builds
  itself on the first run; Node.js 24+), then say "<Name> — run the app": it opens in their browser,
  with this coach behind every button. Claude Code shows a warning about development channels when it
  starts — that is expected (the app uses a research-preview feature). If they don't want the app, note
  it as a preference in their memory, so no session suggests it again.
