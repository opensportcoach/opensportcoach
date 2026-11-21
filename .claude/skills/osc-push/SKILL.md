---
name: osc-push
description: The guarded write to Garmin. Runs the validation gate, the test suite and the prescription audit, gets the athlete's explicit confirmation, then syncs and round-trip verifies. Use whenever anything is being uploaded, scheduled, deleted or unscheduled on Garmin — never call sync_workouts.py directly.
---

# Pushing to Garmin

**Never write to Garmin outside this sequence.** Push hygiene is five rules that used to live only
in memory; this skill makes them unskippable.

**Garmin only.** An athlete without `garmin` in their sources has no watch to push to: their sessions
go in `athletes/<name>/plan.json`, which the app shows beside the calendar. Garmin's client refuses them.

**Whose watch?** Only the bound athlete's. Every script resolves the session's athlete and every
Garmin login is checked against the account bound in `athletes/<name>/athlete.json` — a push for
anyone else is impossible by construction. If anything suggests otherwise, stop and say so.

## The gate — all four, in order, before anything is written

```bash
.venv/bin/python scripts/build_workouts.py          # regenerate — never push a hand-edited JSON
.venv/bin/python scripts/validate_workout.py athletes/<name>/workouts/<file>.json
.venv/bin/python tests/run_tests.py                 # every athlete's invariants, not just this one's
.venv/bin/python scripts/prescription_audit.py      # non-zero on STALE/IMPOSSIBLE
```

**If the test suite fails, stop** — even when the failure is another athlete's. Do not push, do not
"fix it after". The tests encode the medical constraints; each athlete's live in
`athletes/<name>/tests.py`. A failure you cannot see the details of belongs to another athlete: fix
it from a session bound to them, or revert the engine change that caused it.

`prescription_audit.py` exiting non-zero is *not* automatically a blocker: FRESH bumps are expected.
**STALE** (asked ≥2 sessions, never met) and **IMPOSSIBLE** (>8 kg over lifetime best) are blockers —
raise them with the athlete before pushing.

## The confirm

Run the dry run first — it prints `athlete: <name> · Garmin account: <full name>` and the plan:

```bash
.venv/bin/python -u scripts/sync_workouts.py --skip-build
```

Show them what changes, **name the athlete and the Garmin account out loud**, and wait for an
explicit yes. **Approval of the programming is not approval to push.** If they have already said
"push" for this specific change in this conversation, that is the confirm.

### The confirm, in a session serving the app

The athlete confirms by pressing **Send to watch** on the app's card, not in the chat. Run the dry
run with `--plan-json data/<name>/app/results/<request_id>.json`, publish it as a `push_plan`, and
wait for the `confirm` event: it carries the plan hash the athlete clicked. Then the write is
`sync_workouts.py --yes --skip-build --expect-plan <hash>` (or `reschedule_workout.py … --yes
--expect-plan <hash>`). `scripts/hooks/confirm_gate.py` refuses a Garmin write in an app session
without a recorded click for that hash, and the script refuses a plan that changed after the click.
In a normal session nothing changes: the confirm stays in the conversation.

## The write

**Content changes — always via `sync_workouts.py`**, the only upload path (`push_workout.py` was
retired on 2026-09-24):

```bash
.venv/bin/python -u scripts/sync_workouts.py --yes --skip-build
```

Run it **in the background** and wait on the output file — it takes 1–3 minutes and has died on a
`ConnectionResetError` three times.

It handles all five hygiene rules: uploads create a new id, the superseded id is deleted, calendar
entries are re-pointed, ids are verified before scheduling, and the athlete's protected workouts
(`athlete.json` → `protected_workout_ids`) are refused by assertion.

**Calendar-only moves — `reschedule_workout.py`.** `sync_workouts.py` re-points a calendar entry
only as a side effect of a content change; it has no way to say "the session they skipped on
Wednesday happens on Friday instead". Never upload to move a session — Garmin has no update verb,
so an upload leaves two identical workouts on the watch.

```bash
.venv/bin/python scripts/reschedule_workout.py <workout_id> --to YYYY-MM-DD --from YYYY-MM-DD --yes
```

Dry run without `--yes`. It can only reach `unschedule_workout` and `schedule_workout` — never an
upload, never a delete — refuses to duplicate a date, and re-reads the calendar afterwards so the
move is verified rather than assumed. The gate above still runs first.

## Verify, then record

1. Re-run `sync_workouts.py --skip-build` — it must say **"Everything in sync"**.
2. Check the account for duplicate names. Two of the last three failures left a duplicate.
3. Update `athletes/<name>/CURRENT_ROUTINE.md` —
   `test_every_programmed_load_appears_in_current_routine` will fail otherwise.
4. Commit with the reasoning, not just the change — one athlete per commit.

## Refuse to

- push while the suite is red
- push without an explicit confirm in this conversation
- touch a protected workout
- write anything at all from an unattended or scheduled session — there is nobody there to confirm
