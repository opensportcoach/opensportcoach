# Design

Why OpenSportCoach is built the way it is. Each subsystem's rules are written once, in code, with the
reason beside them in the module's docstring; this page is the map. Comments in the code that cite a
section (§4.1, Phase 6, H1…) refer to the original design records, which the maintainers keep.

## Principles

- **The coach is a model; the numbers are not.** Claude Code decides what to look at and what to say.
  Scripts compute every number, and each number has one definition with its defining sentence
  (`scripts/formulas.py`). A view that shows a number shows its definition and its source.
- **A fixed transformation is a script; a branch that depends on interpretation is a skill.**
  `scripts/refresh.sh` pulls unconditionally; `.claude/skills/osc-daily` decides what is worth analysing.
- **Every rule names the assertion that enforces it.** Memory facts (`memory/`, `athletes/<name>/memory/`)
  are typed, dated and carry `enforced_by:`. An injury is a medical fact *and* a test that refuses any
  program breaking it. A rule with no reader reports nothing, which is worse than no rule.
- **Never invent data.** A pull that fails is reported, never papered over. A record the coach did not
  read from a source is never written.
- **Safety before convenience.** No plan before consent (`scripts/consent.py`); no Garmin write without
  the validation gate, the full test suite and the athlete's explicit confirmation.

## Several athletes, one folder

One installation can coach several people, one per session (`scripts/athlete.py`, the only resolver of
an athlete's paths). A session is bound once (`scripts/use.py`) and never rebound; every athlete script
refuses to act for anyone else; every Garmin login asserts whose account it is (`garmin_client.py`); a
PreToolUse hook keeps a bound session out of other athletes' files; the pre-commit hook keeps each
commit to one athlete and runs the leak scan. The defect this prevents is the project's most common: a
lookup keyed on identity that cannot tell two contexts apart, producing a plausible wrong number.

## Data sources

`athletes/<name>/athlete.json → sources` (`scripts/sources.py`): `garmin` (activities, sets, health and
the watch), `files` (the athlete's own FIT/GPX/TCX and Strava archive, `scripts/import_files.py`) and
`strava` (Strava's official MCP, read by the coach, `scripts/import_strava.py`). Importers write the same
cache shapes Garmin's pull writes, tagged with `source`, so every view, review and score works
unchanged, and provenance says where a number came from. Duplicates are matched on sport group, start
time and duration; the better source's copy is kept (Garmin > file > Strava).

Strava's API Policy forbids putting API data into an AI's context, so the project never calls the API;
its MCP is the route Strava allows for a subscriber's own data. Because Strava does not say what an
assistant may keep, MCP records keep no GPS and expire after 7 days unless the athlete's own export
replaces them.

## Workouts to Garmin

`athletes/<name>/program.py` is the source of truth; `scripts/build_workouts.py` turns it into workout
JSON; `scripts/validate_workout.py` checks every exercise against the FIT SDK catalog (generated locally
by `build_exercise_catalog.py`); `scripts/sync_workouts.py` is the only write path. Upload always creates
a new id, so sync deletes the superseded one and re-points the calendar, and round-trip verifies every
step. Workouts that predate the project are protected by id. `workouts/FORMAT.md` documents the proven
payloads (strength, pool swim, run, cardio circuit, mobility). Everything that is not a gym day — swims,
runs, HYROX simulations and race rehearsals, mobility — is declared as data in the athlete's own
`sessions` modules with `scripts/workout_dsl.py`, which holds what the watch taught us: lap-button rests by
default, a catalog exercise on every working circuit step (the watch headlines the exercise, not the
note), distance never advancing an indoor step, kick and pull as a drill type.

## Rides and runs

`scripts/endurance_metrics.py` measures one session from its streams: NP, IF, TSS, decoupling,
efficiency, best efforts, zones, the route. Garmin's own values win where they exist; otherwise the
engine computes them and says so. A run is never scored against a cycling FTP. Without Garmin, FTP and
threshold heart rate come only from the athlete's own settings.

## Swims and circuits

`scripts/session_review.py` reviews a pool swim or a circuit against the workout it followed: matched by
the workout id the watch recorded (every id the workout ever had, kept by sync), then by name, **as the
workout was that day** (its JSON's git history — a re-generated workout must not re-judge an old
session). A swim's reps align to the planned swims by distance (a longest common subsequence, so a
skipped rep costs one rep, not everything after it); a circuit's steps align by the watch's own step
index, and a lap shorter than 10 s is a stray press, set aside and flagged. Both are scored with the
same shape as rides and lifts (`formulas.SCORE_WEIGHTS`), and a CSS test yields the critical swim speed.

## Fuelling and the execution score

`scripts/fuel.py` turns a session's carbohydrate need (`formulas.py`: duration, intensity, sport and the
athlete's gut training) into the products the athlete owns, from `nutrition/PRODUCTS.json`, where every
product is read off its maker's page with its source. What the athlete took is self-reported.
`scripts/session_score.py` scores a session against what was planned for it — sets, reps, load and
rest for strength; duration, intensity, pacing and fuel for endurance — with fixed, documented weights.

## Races

`athletes/<name>/races.json` holds the season: date, format, target, priority, every online check of the
date, the result. `scripts/races.py` holds the rules once: what the days around a race allow (taper,
race week, recovery) by kind and priority, when a date is due a re-check, and how a result's splits are
read from the activity. Event logos are their owners' trademarks and are never committed; an athlete
may keep them locally (`app/web/public/marks/`, ignored).

## The app

A local web app on top of a live coach session. `app/channel/` is an MCP channel server into the
session plus a local HTTP/SSE API on 127.0.0.1; `app/web/` is the React UI. Screens render from
`scripts/app_data.py` — the engine's numbers, no model in the loop. Requests (questions, plans, reviews)
go to the coach, whose results are validated against `app/contracts/` before the UI shows them. **Send
to watch** is the athlete's click on the exact dry-run plan; `scripts/hooks/confirm_gate.py` refuses any
Garmin write in an app session without a recorded click, and the sync refuses a plan that changed
since. The UI is developed against the synthetic Demo athlete (`app/fixtures/`), never a real one.
