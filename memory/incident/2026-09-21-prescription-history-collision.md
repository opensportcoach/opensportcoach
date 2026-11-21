---
type: incident
status: fixed
since: 2026-09-21
source: the 2026-09-21 full audit; the session-matching half on 2026-10-04
enforced_by: tests/run_tests.py::test_prescription_history_covers_every_prescription
also_enforced_by:
  - tests/run_tests.py::test_audit_matches_a_shared_pair_to_its_own_day
  - tests/run_tests.py::test_bump_signals_do_not_refire_on_an_applied_bump
---

# Two prescriptions sharing one catalog key defeated STALE detection for both

`PRESCRIPTION_HISTORY.json` (now `athletes/<name>/workouts/`) was keyed by `category/exerciseName` — **one entry per catalog
pair.** That assumed no exercise is ever prescribed twice.

That stopped being true on **2026-09-16**, when `BARBELL_BENCH_PRESS` became **both** `D1E1`
(heavy, 4×10 @80) and `D4E2` (volume, 4×12 @70) — a split deliberately declared in
`SPLIT_LOAD_ALLOWED` (then in tests/run_tests.py, now in the athlete's `program.py`) so the duplicate-load test would allow it.

## What it did, on every single build

Iterating `PROGRAM`, D1's 80 was written and then **overwritten** by D4's 70, each overwrite logging
a fabricated change and resetting `since` to the build date. So:

- `PROGRESSION_LOG.md` read as though the load flip-flopped **70 → 80 → 70** several times a day.
- `prescription_audit.py` reported **both** asks as `FRESH — not tried yet`, permanently. D1E1's
  80 kg had been live since **2026-09-06** and its true staleness was unknowable.

**STALE detection is the instrument the 2026-08-30 audit was built to repair.** It was silently
defeated again, for the one case that audit's fix assumed could not happen — and it fired on
ordinary rebuilds, with nobody doing anything wrong.

## What was changed

Keyed by **`day/exerciseId`**, unique by construction. Each entry now also carries `cat` and `name`
so `update_progression_log.py` can still label a change.

`SPLIT_SEED` (now in the athlete's `program.py`) holds the real `since` dates for the split pair (D1E1 09-06,
D4E2 09-16) taken from the comments that introduced each ask. **The old shared entry's `changes`
were NOT migrated** — they were fabricated by the collision, and inheriting them would carry the
corruption into the human-readable record. A documented break beats a plausible lie.

Unambiguous pairs — one prescription, one catalog pair — migrate their history intact.

## The lesson

**`SPLIT_LOAD_ALLOWED` was known to only one file.** The test knew two days could share a key;
`update_prescription_history`, `prescription_audit.py` and `update_progression_log.py` did not.
**A declared exception is only safe if every consumer of the thing it excepts knows about it.**

Same family as [[2026-09-21-key-implement-mismatch]] and [[2026-09-07-hyrox-audited-as-gym]]: a
lookup keyed on identity that cannot distinguish two contexts.

## 2026-10-04: the fix covered the history half only

The 09-21 fix re-keyed the HISTORY. Every consumer that matched SESSIONS to a prescription still
keyed on the catalog pair: `prescription_audit.sessions_since`, `progression_report.plan_targets`
and its trend lines. So D5E5's never-trained seated calf raise read `ok` from D3's sessions, D1's
bench @80 was credited with D4's 50 and 70, and the two bench prescriptions were merged into a
4×12 @80 target that neither day prescribes, so a bench bump could never fire. **The status
`fixed` was true for half the defect for thirteen days.** The lesson above was written and then
applied to only one of the three consumers it named.

Now `scripts/strength_sessions.py` owns the rule for every consumer. A session's day comes from
its workout name, then its signature. A set counts toward `day/exid` when the session was that
day, or when the pair is prescribed on only one day. A shared pair logged on a third day is
reported as AMBIGUOUS and not credited.

