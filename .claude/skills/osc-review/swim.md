# Rubric: a pool swim

Read [`SKILL.md`](SKILL.md) first: intent, context, the contract, validation and delivery are the
shared steps there. This file is what a swim adds.

## Measure it

1. `.venv/bin/python scripts/session_review.py <activity_id>` (add `--json` for the paths). It finds
   the workout the swim followed (the watch's recorded workout id, then the name) **as it was that
   day** (git history of its JSON), and aligns the reps to the planned swims by distance. **No workout
   matched → it is measured, not judged: say so.**
2. Score it: `.venv/bin/python scripts/session_review.py <activity_id> --score` (also what
   `session_score.py` returns). Weights and bands: `formulas.py` → `SCORE_WEIGHTS["swim"]`.

Evidence paths: `metrics.<key>` and `intervals.<n>.<secs | pace_100 | swolf | hr | metres>`, where
`n` is the rep.

## Judge it

- **Distance done vs planned**, and **which reps are missing**: one skipped rep costs one rep, not
  the set.
- **Inside each repeated set, the pace spread.** Under 3 % is even. A fade on the last reps is the
  usual story, and it says more than the average does.
- **SWOLF and strokes per length** against the athlete's own history **in the same pool**. Never
  against someone else's, and never across pool lengths.
- **The set's purpose** decides what matters. On a paddles set, the pull. On a speed set, the spread
  of the fast reps. On an aerobic set, evenness.
- **A CSS test** gives `css_100`: tell them, and offer to set `profile.css_s100` in `athlete.json`
  and re-pace the next swims from it (an edit to their sessions module, then `/osc-push`).

## Ask, don't guess

A crowded lane, a lap counted twice or a missed wall push changes the numbers. When a rep looks off
by a whole length, ask before you call it a miss.
