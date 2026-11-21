---
name: osc-review
description: Deep review of one training session — a strength session against its prescription and the multi-session trend (spawns the execution-reviewer agent), a ride or run against its intent (in-session, from endurance_metrics.py), or a pool swim or circuit (HYROX) against the workout it followed (session_review.py). Use when a session looks anomalous, when the athlete asks why something dropped, when they ask for a proper review of a named date, or when the app asks to analyse a ride, run, swim or circuit.
---

# Session review

For the mechanical planned-vs-executed comparison, do it inline — that is part of `osc-daily`.
**This skill is for when something needs breadth**: a pattern across many lifts, an unexplained
drop, a trend that only shows over several sessions.

## Spawn the agent

Use the `execution-reviewer` agent with the **athlete's name** and the date. It is read-only and
writes its findings to `athletes/<name>/logs/`. Relay what matters — **its report does not reach
the athlete directly.**

## Before accepting "regression" as the answer

Check these in order. Each has produced a false regression before:

1. **Different machine?** The athlete's `memory/equipment/` — e.g. a leg press and hip thrust
   exist on two machines with incompatible disc scales.
2. **Different logging convention?** The athlete's `memory/convention/` and `LOGGING_RULES.json` —
   per-arm vs summed, disc-load vs absolute.
3. **Annotated session?** `athletes/<name>/workouts/SESSION_ANNOTATIONS.json` — backoffs and
   equipment-limited days are excluded from trend classification by design.
4. **Abandoned session?** Read duration and load, not the title. The 2026-08-23 activity is called
   "D1 Push" and is three bench sets.

**The diagnostic that worked:** if the drop sorts by *loading mechanism* rather than by effort, it is
equipment. Fatigue does not discriminate that way.

## Then

Write the review into `athletes/<name>/logs/YYYY-MM-DD-<activity_id>-review.md` — named with the
session, so the app shows it on that session's page only (a date-only review shows on the day's
strength session). Record any deliberate backoff, deload or
equipment-limited day in their `SESSION_ANNOTATIONS.json` so it never reads as a regression later.

**Ask rather than conclude** when the cause is not in the data. The 2026-08-14 machine-increment
hypothesis was wrong and the athlete disproved it five days later.

---

# A ride or a run (docs/DESIGN.md (rides and runs) §4)

**No agent** — one session's numbers, read in this session. The numbers come from the engine; you
interpret them. Never type a number the engine did not compute.

1. **The numbers.** `.venv/bin/python scripts/endurance_metrics.py <activity_id> --json` — metrics
   (each `garmin` or `computed`), zones with this session's bounds, bests, intervals (laps'
   `intensityType`), flags, thresholds. The page shows exactly these.
2. **Intent**, in this order: a cardio workout scheduled that day (`scheduled.json` / the calendar
   view) → `planned`; what they said they'd do (logs, the conversation) → `athlete`; otherwise read it
   from the zones and IF and mark it `inferred` — and say so in `why`.
3. **Context** — only what bears on this session: the night before (recovery view), load over 7 and 28
   days (load view), heat (`weather.temp_c`, `feels_like_c`, `humidity_pct` — converted to Celsius by the engine, outdoors only; never read a raw weather file),
   their `cardio_targets` and goals.
4. **Judge execution against the intent.**
   - **Endurance:** most of the time in HR zones 1–2, IF under about 0.75, decoupling under 5 %.
   - **Recovery:** zone 1, IF under about 0.6.
   - **Tempo:** IF about 0.76–0.87.
   - **Threshold:** IF about 0.88–1.0, or work intervals at threshold.

   **Without power** (most outdoor rides), judge by HR zones and speed per heartbeat. Hills and wind
   bend speed, so call a speed-based decoupling approximate, never a verdict.
   **No FTP** → no IF or TSS claim. Tell them how to set `ftp_w` in `athlete.json` → `profile`.
5. **Write the result** — kind `endurance_review`, contract `app/contracts/endurance_review.schema.json`:
   - **`verdict`:** one line.
   - **`execution`:** a rating and a summary.
   - **`findings`:** at most 6. Include what went well. Each one's numbers go in **`evidence`** as paths:
     `metrics.<key>`, `bests.<key>`, `zones.<hr|power>.<n>` (% of time), `thresholds.<ftp|threshold_hr>`.
     Keep numbers out of the claim text; the evidence carries them.
   - **`next_time`:** one concrete change.
   - **`questions`:** at most 3, when the cause isn't in the data (food, heat, a fan indoors, a stop).
6. **Validate it:** `.venv/bin/python scripts/app_contracts.py validate endurance_review <file>`.
   It checks the shape **and every evidence number against the engine**. A refusal names the wrong
   number: fix it from step 1's output, never by rounding toward what you wrote.
7. **Deliver it:**
   - **From the app** (a `workflow` review request carrying `activity_id`): write the JSON to
     `data/<name>/app/results/<request_id>.json`, then `app_publish(request_id, "endurance_review", file)`.
   - **Always:** also write it as markdown to `athletes/<name>/logs/YYYY-MM-DD-<activity_id>-review.md`.
     The workout page and the journal list it.

**Never:**
- compare one sport's HR zones with another's;
- call fitness gained or lost from one session (that's the trend's job);
- explain a flag you can't support. Ask instead.

# A pool swim or a circuit (HYROX, a station circuit)

In-session, from the engine — the same `endurance_review` contract as a ride, with its evidence checked.

1. **Measure it:** `.venv/bin/python scripts/session_review.py <activity_id>` (add `--json` for the
   paths). It finds the workout the session followed — the watch's recorded workout id, then the name —
   **as it was that day** (git history of its JSON), and aligns what was done to what was planned:
   a swim's reps to the planned swims by distance, a circuit's steps by the watch's own step index.
   No workout matched → it is measured, not judged: say so.
2. **Score it:** `.venv/bin/python scripts/session_review.py <activity_id> --score` (also what
   `session_score.py` returns). Weights and bands: `formulas.py` → `SCORE_WEIGHTS["swim" | "circuit"]`.
3. **Judge execution against the intent:**
   - **Swim:** distance done vs planned; the reps that are missing; inside each repeated set the
     **pace spread** (under 3 % is even — a fade on the last reps is the usual story); SWOLF and strokes
     per length against the athlete's own history in the **same pool**, never against someone else's.
     A **CSS test** gives `css_100`: tell them, and offer to set `profile.css_s100` in `athlete.json`
     and re-pace the next swims from it (an edit to their sessions module, then `/osc-push`).
   - **Circuit:** the working steps done; **stray laps** (a button pressed twice shifts every step
     after it — say which step, and suggest fewer steps or a clearer label, never "be careful");
     run legs vs stations vs rests; the spread of the run legs (going out too hard shows here). In a
     doubles race the partner's stations are rests by design — never a miss.
4. **Write and validate** exactly as for a ride (steps 5–7 above). Evidence paths: `metrics.<key>` and
   `intervals.<n>.<secs | pace_100 | swolf | hr | metres>`.
