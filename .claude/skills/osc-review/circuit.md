# Rubric: a circuit (HYROX, a station circuit)

Read [`SKILL.md`](SKILL.md) first: intent, context, the contract, validation and delivery are the
shared steps there. This file is what a circuit adds.

## Measure it

1. `.venv/bin/python scripts/session_review.py <activity_id>` (add `--json` for the paths). It finds
   the workout the session followed (the watch's recorded workout id, then the name) **as it was that
   day** (git history of its JSON), and aligns what was done to what was planned by the watch's own
   step index. **No workout matched → it is measured, not judged: say so.**
2. Score it: `.venv/bin/python scripts/session_review.py <activity_id> --score`. Weights and bands:
   `formulas.py` → `SCORE_WEIGHTS["circuit"]`.

Evidence paths: `metrics.<key>` and `intervals.<n>.<secs | hr>`, where `n` is the step.

## Judge it

- **The working steps done** against the steps planned.
- **Stray laps.** A button pressed twice shifts every step after it. Say which step it happened
  at, and suggest fewer steps or a clearer label, never "be careful".
- **Run legs vs stations vs rests**, as three totals.
- **The spread of the run legs.** Going out too hard shows here: the first legs fast and the last
  ones slow.
- **In a doubles race, the partner's stations are rests by design**, never a miss. The athlete's
  race notes say which stations are theirs.
- **Never judge a station by the run's HR zones**, or a run leg by the station's effort.
