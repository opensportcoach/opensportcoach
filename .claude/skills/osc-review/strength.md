# Rubric: a strength session

Read [`SKILL.md`](SKILL.md) first. A gym session has its own engine and its own result, so the
shared `endurance_review` steps do not apply here.

## Spawn the agent

Use the `execution-reviewer` agent with the **athlete's name** and the date. It is read-only and
writes its findings to `athletes/<name>/logs/`. Relay what matters — **its report does not reach
the athlete directly.**

## Before accepting "regression" as the answer

Check these in order. Each has produced a false regression before:

1. **Different machine?** The athlete's `memory/equipment/`: a leg press and a hip thrust can exist
   on two machines with incompatible disc scales.
2. **Different logging convention?** The athlete's `memory/convention/` and `LOGGING_RULES.json`:
   per-arm vs summed, disc-load vs absolute, per-leg reps logged summed.
3. **Annotated session?** `athletes/<name>/workouts/SESSION_ANNOTATIONS.json`: backoffs and
   equipment-limited days are excluded from trend classification by design.
4. **Abandoned session?** Read duration and load, not the title. An activity called "D1 Push" can be
   three bench sets.
5. **A ramp set?** A first set lighter than the rest is usually a warm-up. Don't let it decide
   whether the prescription was met, in either direction.

**The diagnostic that worked:** if the drop sorts by *loading mechanism* rather than by effort, it is
equipment. Fatigue does not discriminate that way.

## Judging a bump

The engine's bump signal reads the session's sets. Before you propose its number, check which set
it read. A first set logged heavier for a few seconds (a mis-tap) or a ramp set can move the step.
The step is from the **ask**, unless the athlete exceeded the ask on every working set: then the ask
becomes what they did. A dumbbell step must be a dumbbell their gym has (`memory/equipment/`); ask
before you call a load unloadable.

## Then

Write the review into `athletes/<name>/logs/YYYY-MM-DD-<activity_id>-review.md`, named with the
session so the app shows it on that session's page only (a date-only review shows on the day's
strength session). Record any deliberate backoff, deload or equipment-limited day in their
`SESSION_ANNOTATIONS.json` so it never reads as a regression later.

**Ask rather than conclude** when the cause is not in the data. A machine-increment hypothesis was
once wrong, and the athlete disproved it five days later.
