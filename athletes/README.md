# athletes/ — private, never committed here

Each person's folder (`athletes/<name>/`) holds their program, memory, logs, races, fuelling setup and
Garmin identity. **This repository ignores everything here except this file.**

- Create yours with the coach: say your name and "set me up" (`/osc-setup`), which runs
  `scripts/new_athlete.py <name> --sources …`.
- Want history for your own folder? Make `athletes/` its own **private** git repository, with the same
  one-athlete-per-commit guard as the engine — and never push it anywhere public:

  ```bash
  git -C athletes init && printf 'README.md\n' > athletes/.gitignore
  git -C athletes config core.hooksPath ../.githooks/athletes
  ```

  Athlete files are then committed there (`git -C athletes commit …`), engine changes in this repository.
- The synthetic Demo athlete the app and tests use lives in `app/fixtures/`, not here.
