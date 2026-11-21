---
type: incident
status: fixed
since: 2026-11-01
source: the weekly insight pass of ISO 2026-W44, verified slot-by-slot against his logged sets
enforced_by: tests/run_tests.py::test_the_core_block_is_among_the_programs_prescriptions
also_enforced_by:
  - tests/run_tests.py::test_a_core_bump_needs_two_clean_sessions_running
  - tests/run_tests.py::test_a_bump_signal_reads_a_hold_in_seconds
  - tests/run_tests.py::test_prescription_history_covers_every_prescription
  - tests/run_tests.py::test_same_exercise_has_the_same_load_on_every_day
---

# A progression rule ran for three weeks with no instrument that could see it

`program.py` prescribes in **two** places: `PROGRAM[day]["exercises"]`, the main lifts, and
`LEAD[day]["block"]`, the core block that opens every gym day. **Five readers iterated the first
one only:**

| | |
|---|---|
| `progression_report.bump_rows()` | no core bump signal could ever fire |
| `prescription_audit.audit()` | no core ask could go STALE or ABANDONED |
| `strength_sessions.pair_days()` | every shared core pair looked unique, so `counts_for()` credited any day's session to any day's core prescription |
| `build_workouts.update_prescription_history()` | `PRESCRIPTION_HISTORY.json` held 36 keys and **not one** core id |
| `tests/run_tests.py` ×2 | the history-coverage and same-load tests certified a file and a program they could not fully read |

## What it cost

The athlete asked for this on 2026-10-18: *"I feel that core is getting very simple and each day is
the same."* The rule written that day (v8.4) is his — the top of its range on every set, **two
sessions running**, earns +2 kg, the feet further back on the TRX, or +2 reps — and the preference
file adds that *a core number flat for three weeks is a failure to flag*.

Three weeks later **seven slots had met it and not one ask had moved.** Every daily that followed a
gym day marked core "met", truthfully, and there the information stopped: nothing turned "met twice"
into a signal. The deadline the rule set for itself, 2026-11-08, would have passed unnoticed. It was
found by a weekly insight pass, not by any check.

Two narrower blind spots fell out of the same fix:

- **`prescription_audit` had never audited a single TIMED prescription.** It skipped
  `kind == "time"` outright, so D2E8's farmers carry — asked at 30 kg/hand for 40 s since 10-11,
  executed at 24 both times — had never been checked. It reads STALE the moment it is looked at.
- **`attempts()` required `weight is not None`.** Garmin records `0.0` for an unloaded set of a
  loaded exercise but **nothing at all** for a pure bodyweight hold, so the D3 side plank's
  40/40/40/21 s on 10-27 was dropped and the ask read `ABANDONED — never trained` the week he did it.

## What was changed

`build_workouts.prescriptions()` is now the single definition of "every prescription" — core block
first, because that is the order the day is built in — and it yields `(day, row, "core"|"main")`. All
five readers go through it. The block is **named, not inferred**: a consumer that treats core
differently is told which it has, instead of reading the `C` prefix off an id.

Keys stay `day/exerciseId`, and here that is load-bearing rather than tidy: **the same core id is a
different exercise in a different block** — `C1` is the kneeling ab wheel in `CORE_ANTI_EXTENSION`
and the weighted side plank in `CORE_ANTI_ROTATION` and `CORE_LOADED`.

`bump_rows()` now needs **two** clean sessions for a core row and one for a main lift, reads a hold
in seconds, counts a per-side row as two logged sets per round, and refuses to fire on an unloaded
timed main lift — a sprint or a ski mogul hits its clock by design, and "+weight" on a 10-second
sprint is not advice. The 14 core entries of that athlete's `PRESCRIPTION_HISTORY.json` were seeded by
hand at the **v8.4** ask with `since: 2026-10-18`, the date the code comments and that day's log
give, so the next build recorded the v8.11 change honestly instead of defaulting every core ask to
"set today" — the same reasoning as `SPLIT_SEED` in [[2026-09-21-prescription-history-collision]].

`signatures()` was deliberately left alone: it identifies *which day* a session was, and the core
movements are shared across days, so there they are noise that would create false matches.
Ownership and identification are different jobs.

## The lesson

Same family as [[2026-09-21-prescription-history-collision]], [[2026-09-21-key-implement-mismatch]]
and [[2026-09-07-hyrox-audited-as-gym]] — a lookup that cannot tell two contexts apart — with a
sharper edge on it: **the rule was not wrong, and no number was wrong. There was simply no
instrument, and an absent instrument reports nothing, so nothing looked broken.** A corrupted number
is loud. A rule with no reader is silent, and it stays silent for exactly as long as nobody checks
by hand.

So: **when a rule is written, name the assertion that will fire it.** `enforced_by` already demands
this of every memory file; `core-must-progress.md` carried `enforced_by: ... the progression rule is
behavioural` and that was the warning, in writing, three weeks early.

## The correction this turned up in its own fix

Replaying the pre-v8.11 state through the fixed code reproduced **seven** of the nine bumps made by
hand that day and held the right two. The two it would not reproduce were the hand calls' fault:
D2's side plank and TRX fallout each have **one** qualifying session on their own day (10-25), and
the 10-18 and 10-26 sessions cited for them were **D4's** prescriptions of the same pairs. Pooling
them was this very defect, committed while fixing it. Both asks still stand at the v8.11 number — the
side plank because one movement carries one load across days and D4's slot earned the plate, the
fallout because 12 is what he did on that day once — but each now says which of those it is.
