---
type: incident
status: fixed
since: 2026-09-21
source: the gate itself — a bump signal asked for 65 kg of dumbbells he has never lifted
enforced_by: none — see "why there is no test", below
---

# The exercise key says one implement, his hands hold another

Garmin's catalog names an implement. When the implement he actually uses differs, a units rule in
the athlete's `LOGGING_RULES.json` silently transforms the number and **nothing downstream can tell.**

Four instances inside eight days, all found by hand:

| Date | Slot | Key said | He used | Damage |
|---|---|---|---|---|
| 09-16 | D4E2 | `DUMBBELL_BENCH_PRESS` | **barbell** | 70 kg halved to "35/arm", 1 kg under the gym's heaviest dumbbell; read as MET |
| 09-16 | D4E5 | `CABLE_OVERHEAD_TRICEPS_EXTENSION` | **dumbbell** | a STALE flag that was implement, not strength |
| 09-16 | D4E3 | `DUMBBELL_BICEPS_CURL`, doc'd as Biostrength | **free dumbbells** | his real 20 kg/arm looked untrustworthy for a month |
| 09-21 | D1E3 | `DECLINE_DUMBBELL_BENCH_PRESS` | **barbell** | **60 kg halved to "30/arm" → a bump signal demanding 32.5/arm, i.e. 65 kg of dumbbells** |

The 09-21 one is the sharpest: it is the first time this family nearly **changed a prescription**,
and it fired on an ordinary daily run.

## The asymmetry that makes this dangerous

Halving a barbell load produces a number that looks *plausible* — 35, 30 — sitting right inside the
dumbbell range. Nothing is out of bounds, no assertion trips, and the verdict reads `ok` or `MET`.
**A corrupted number that looks reasonable is worse than one that looks absurd.**

## What was changed

- `DECLINE_DUMBBELL_BENCH_PRESS` removed from `two_db_weight_summed` — he presses it with a bar and
  Garmin has **no barbell decline key in any of its 1,846 pairs**, so the key stays and the units
  rule goes. The watch label is cosmetically wrong; the numbers are right.
- D4E2 → `BARBELL_BENCH_PRESS`, D4E5 → `SINGLE_ARM_DUMBBELL_OVERHEAD_TRICEPS_EXTENSION` (09-16).
- **Baseline breaks** recorded for decline (pre-09-20 is a different implement) and for the
  Biostrength claim about the curl, which was simply false.

## Why there is no test, and what to do instead

**A test cannot see which implement he picked up.** The repo knows the prescription and Garmin
reports a key and a number; the fact that his hands held a bar exists only in what he says. So the
control is behavioural, not automated:

> **When a lift's executed load jumps by a factor near 2, or lands suspiciously close to an
> equipment ceiling, suspect the implement before believing the number.** Ask. Do not bump.

`test_no_dumbbell_exceeds_the_gym_cap` catches the *prescription* side of this — it would have
refused a 37 kg/arm ask — but not the *executed* side, which is where all four instances began.

See [[2026-09-07-hyrox-audited-as-gym]] and [[2026-08-29-virtual-run-ungrouped]]: same family, a
lookup that cannot distinguish two contexts sharing one key.
