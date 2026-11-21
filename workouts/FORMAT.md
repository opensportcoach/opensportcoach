# Strength-workout JSON payload format — PROVEN 2026-06-12

Validated end-to-end: `_format_test.json` → `upload_workout` → a new workoutId →
`get_workout_by_id` returned every field verbatim → exercises resolve by name, weights stay kg.
The reference fetches (ours, and a Garmin-native swim envelope) were compared field by field.

## Envelope

```json
{
  "workoutName": "OSC · D1 Push",
  "description": "optional",
  "sportType": {"sportTypeId": 5, "sportTypeKey": "strength_training", "displayOrder": 9},
  "subSportType": null,
  "estimatedDurationInSecs": 3600,
  "workoutSegments": [
    {"segmentOrder": 1, "sportType": { ...same... }, "workoutSteps": [ ...groups... ]}
  ]
}
```

## One exercise = one RepeatGroupDTO (iterations = sets)

```json
{
  "type": "RepeatGroupDTO", "stepId": null, "stepOrder": 1,
  "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
  "childStepId": 1, "numberOfIterations": 4, "smartRepeat": false,
  "skipLastRestStep": false,
  "endCondition": {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": false},
  "workoutSteps": [ workStep, restStep ]
}
```

- `childStepId`: unique int per group; repeat it on the group's child steps.
- `skipLastRestStep`: **`true` since 2026-08-01** — see the Rest step section. The guarantee the old
  `false` rule protected (never move to the next exercise without a rest) is now provided by an
  explicit lap-button rest step after each repeat group, which also lets the between-series rests be
  countdowns. Before 2026-08-01 this was `false` with every rest on lap.button.

## Work step

```json
{
  "type": "ExecutableStepDTO", "stepId": null, "stepOrder": 2, "childStepId": 1,
  "stepType": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
  "endCondition": {"conditionTypeId": 10, "conditionTypeKey": "reps", "displayOrder": 10, "displayable": true},
  "endConditionValue": 8,
  "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1},
  "category": "BENCH_PRESS", "exerciseName": "BARBELL_BENCH_PRESS",
  "weightValue": 82.5,
  "weightUnit": {"unitId": 8, "unitKey": "kilogram", "factor": 1000.0}
}
```

- **Exercise keys:** `category` + `exerciseName`, UPPERCASE FIT taxonomy names
  (`garmin-fit-sdk` Profile: `exercise_category` + `<category>_exercise_name`). Unknown keys
  upload fine but render "Unknown exercise" — hence the validation gate.
- **Weights:** `weightValue` is the kg number when `weightUnit` = kilogram (factor 1000 is the
  unit's gram factor — do NOT pre-multiply; 65.0 round-trips as 65.0 kg).
- **Bodyweight:** omit `weightValue`/`weightUnit` entirely.
- **Time-based work** (planks): `endCondition` time (id 2), `endConditionValue` = seconds.
- Reps come back as floats (12 → 12.0) — normal.

## Warm-up step (optional, before an exercise's working sets)

A single `ExecutableStepDTO` with `stepType` {1, warmup}, same exercise `category`/`exerciseName` +
`weightValue`, `endCondition` reps. Place it (followed by a rest step) before the working repeat
group; not inside it. Generated from the `WARMUPS` dict in `build_workouts.py`.

## Rest step

**Two kinds of rest (rule updated 2026-08-01).**

1. **Between SERIES of the same exercise — a 1:40 countdown.** `endCondition` **`fixed.rest`**
   (id 8) with `endConditionValue` 100. He is already standing at the equipment, so a timer keeps
   the session moving and holds the 75-minute cap. Lives inside the repeat group.
2. **Between EXERCISES — `lap.button`** (id 1, no value): a count-up that advances only when he
   presses lap. This preserves the original 2026-06-16 concern — a busy machine must never
   auto-start the next lift. Emitted as a standalone rest step *after* the repeat group.

Because the between-exercise rest is now its own step, the repeat group sets
**`skipLastRestStep: true`** — the final set gets no countdown, the lap rest follows instead.
That is NOT the old bug the `false` rule guarded against: a rest before the next exercise is still
guaranteed, it is just manual instead of timed. `SET_REST_SECS` in `build_workouts.py` is the single
knob for the countdown length. (Time-based *work* holds like planks still use `time`.)

## Server normalization observed on fetch-back

Adds `stepId` (assigned), `endConditionCompare`, `preferredEndConditionUnit`, and echoes
everything else verbatim. No structural rewrites.

## Scheduling

`schedule_workout(workout_id, "YYYY-MM-DD")`. Unscheduling needs the *scheduled* id
(from `get_scheduled_workouts`), not the workout id.

## Round-trip verification checklist (after every push)

1. `sync_workouts.py --yes` fetches every upload back and compares the signature of everything that
   reaches the watch; a mismatch leaves the old id in place. Every exercise must resolve to
   `CATEGORY/NAME` — no nulls, no "Unknown".
2. Weights echo the kg values sent.
3. Spot-check rendering in Connect app/web (exercise display names + muscle map).
4. New keys proven this way → mark "round-trip verified" in the athlete's `workouts/EXERCISE_MAPPING.md`.

## Generation

`scripts/build_workouts.py` is the engine: it loads the bound athlete's `athletes/<name>/program.py`
(mirrored by their `CURRENT_ROUTINE.md` — change both together), verifies every key against the FIT
taxonomy, and emits `athletes/<name>/workouts/<day>.json`. Then it builds the athlete's **sessions**:
modules in their folder listed in `athlete.json` → `sessions` (e.g. `swims.py`, `runs.py`, `hyrox.py`),
each declaring `WORKOUTS` with `scripts/workout_dsl.py` — which encodes every format below exactly as it
was proven, so an athlete writes data, never payloads.

## Pool swims — proven 2026-07-13, generated by an athlete's `swims.py`

Same `upload_workout(payload)` as strength. Differences that matter:

- Top level: `sportType` `{4, "swimming"}`, `poolLength: 25.0`, `poolLengthUnit` `{1, "meter", 100.0}`.
- Steps end on `distance` (condition id 3) in meters; each work step carries `strokeType` and
  `equipmentType`. Step types: warmup 1, main 8, cooldown 2, rest 5, repeat 6.
- **Stroke ids are the Connect WORKOUT enum, alphabetical — NOT the FIT activity enum:** any 1,
  backstroke 2, breaststroke 3, drill 4, **fly 5**, free 6, im 7, mixed 8. (FIT's `swim_stroke` has
  butterfly = 3; guessing rendered "any stroke" on the watch.) Equipment: none 0, fins 1, kickboard 2,
  paddles 3, pull buoy 4, snorkel 5 — one per step. Kick = stroke 0 + kickboard 2.
- **Garmin re-resolves the stroke NAME from the id on fetch**, so a wrong id comes back looking
  plausible. Verify stroke and equipment by ID, never by name.
- Rests are lap-button (condition id 1): the athlete advances when ready.
- **Kick and pull can also be a `drillType`** — proven 2026-10-04 from swims an athlete built in the
  Connect editor: a freestyle step with
  `drillType` `{1, "kick"}` or `{2, "pull"}` plus the board/fins/pull buoy as equipment. Work steps
  there are stepType `{8, "main"}` and timed rests `fixed.rest` (id 8, seconds). `sync_workouts.py`
  compares `drillTypeKey` in its round-trip signature.
- **TrainingPeaks' own Garmin sync is NOT a structured swim**: one distance step in a 25-*yard* pool.

## Cardio — proven 2026-08-30, generated by an athlete's `hyrox.py`

Same `upload_workout(payload)` again. Differences that matter:

- Top level and segment: `sportType` `{6, "cardio_training", 6}`. No pool fields.
- Flat `ExecutableStepDTO` list, no repeat groups (when every round differs, a repeat group has
  nothing to repeat — the round counter goes in the description instead). Step types: warmup 1,
  cooldown 2, interval 3, rest 5.
- End conditions: `time` (id 2, seconds), `distance` (id 3, meters, with
  `preferredEndConditionUnit` `{1, "meter", 100.0}`) and `lap.button` (id 1, value null).
- **Exercise keys work exactly as in strength** — `category` + `exerciseName` from the catalog,
  optional `weightValue` + kilogram unit — and the Connect editor exposes an exercise selector for
  cardio steps. The exercise name becomes the step headline on the watch; without one a lap step
  reads "Pulsacion de boton Lap". Transition rests carry none; a rest that stands for a partner's
  HYROX station carries that station's pair as a label (2026-11-08), so the watch names it.
- Proven pairs, harvested from a logged session rather than guessed: `RUN/RUN_OR_WALK`,
  `CARDIO/SKI_MOGULS` (SkiErg), `SLED/PUSH`, `ROW/INDOOR_ROW`, `LUNGE/DUMBBELL_LUNGE`,
  `CARRY/FARMERS_CARRY`.

## Runs — proven 2026-10-11, generated by an athlete's `runs.py`

**Proven by a probe** — `sync_workouts.py --only run_easy_strides` — checked two
ways. The sync round trip: Garmin echoed every step, the target re-resolved from id 4 to
`heart.rate.zone`, values 118.0 / 140.0, zoneNumber null. And the workout's **FIT file** (the
library's `download_workout`, decoded with `garmin_fit_sdk`) — what the watch actually receives:
`sport: running`; the 25-min step `target_type: heart_rate` with `custom_target_heart_rate_low/high`
**218 / 240** (FIT encodes bpm as value + 100, so 118–140 bpm); warmup / active / recovery / cooldown
intensities from step types 1 / 3 / 4 / 2; the lap-button walk-back as `duration_type: open`; the
repeat as `repeat_until_steps_cmplt` back to the stride, ×4; every description as the step's notes.

- Top level and segment: `sportType` `{1, "running", 1}`. No pool fields.
- Step types: warmup 1, cooldown 2, interval 3, **recovery 4** (between reps), repeat 6.
- End conditions: `time` (id 2, seconds) and `lap.button` (id 1, value null) — the walk-back after a
  stride ends on the lap button, so he starts the next rep when he is back at the line.
- **Target: a custom heart-rate range in bpm.** `targetType` `{4, "heart.rate.zone"}`,
  `targetValueOne` low, `targetValueTwo` high, `zoneNumber` null. Strides carry `no.target` on purpose
  — short and by feel, and an HR alert lags them by 20 s. **Pace targets are not used yet**: the id for
  `pace.zone` disagrees between sources (the garminconnect library calls 6 "open"), and a wrong target
  id comes back with a plausible name, as with swim strokes. Prove it with its own probe first.
- No exercise keys on run steps: the step headline is the step type and its duration or target.
- `sync_workouts.py` compares the target (key, low, high, zone) in its round-trip signature, but only
  on steps that HAVE one — every no-target workout keeps the signature, and the content hash, it had.

## The validation gate — every proven format

`scripts/validate_workout.py` dispatches on `sportTypeKey` to the formats proven above:
`strength_training`, `swimming`, `cardio_training` and `running`. Any other sport
**fails** — an unproven payload is what the gate exists to stop. Since 2026-10-11 every step's
`stepTypeId` must also agree with its key, and every `targetType` id with its key; a target other than
`no.target` must be a type proven on that sport (today: a bpm heart-rate range, on runs). Until 2026-10-04 it knew only strength, so every swim
failed with "no exercise steps found" and the cardio file failed on its `distance` steps.

Common to all: end-condition id must agree with its key (Garmin reads the id), positive values on
reps/time/distance/fixed.rest, repeat groups with whole iterations and children, any
`category`/`exerciseName` present must be in the catalog. Swims add: `poolLength` + unit, distances
in whole pool lengths, a valid `strokeTypeId` (0–8) and `equipmentTypeId` (0–5) on every work step.
`test_every_managed_workout_passes_the_gate` runs it over every athlete's generated files.
