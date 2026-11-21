---
type: incident
status: fixed
since: 2026-08-14
source: AUDIT_2026-08-14.md
enforced_by: tests/run_tests.py::test_dips_count_as_chest
also_enforced_by:
  - tests/run_tests.py::test_nothing_is_ever_silently_dropped
  - tests/run_tests.py::test_every_programmed_exercise_resolves_to_a_real_muscle
---

# The volume instrument was wrong by 13%, and it justified a program change

**Garmin's exercise categories do not partition by muscle.** Dips live under `TRICEPS_EXTENSION`,
face pull under `ROW`, leg extensions under `CRUNCH`. A category-only muscle map therefore misfiled
whole exercises: **232 of 1,731 sets (13.4%)** miscounted or dropped, including **51 dip sets that
never counted toward chest** — in the very chart used to argue that chest was under-trained.

The figures first quoted to him, 13.2 vs 21.4 sets/week, were **wrong**. The real numbers were
15.1 vs 20.1. The conclusion survived; the evidence did not.

## What was changed

- `muscle_of()` is now **pair-aware**: `MUSCLE_PAIR[(category, exerciseName)]` is checked before the
  category fallback. **Add new exercises there, not just to `MUSCLE`.**
- Unrecognised sets land in a visible **Unattributed** row instead of vanishing. This bucket has
  since caught `HIP_STABILITY/DEAD_BUG` on its first outing (2026-09-01) — it works.
- Warm-ups no longer count as working sets.

**The lesson:** a lookup table with a silent default is how a measurement error survives long enough
to change programming.
