# Contributing to OpenSportCoach

Thanks for helping. This project coaches real people, so two things matter more than anything else:
**nobody's personal data in the repository, ever**, and **safety rules stay enforced by tests**.

## The workflow

1. **Open an issue first** for anything bigger than a fix, so we can agree on the approach.
2. **Fork** the repository and create a branch: `git checkout -b fix/short-description`.
3. Set up once:
   ```bash
   python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
   .venv/bin/python scripts/build_exercise_catalog.py
   git config core.hooksPath .githooks
   (cd app/web && npm ci) && (cd app/channel && npm ci)   # only if you touch the app
   ```
4. Make your change, with a test. Engine invariants live in `tests/run_tests.py`; the app's in
   `app/web/src/test/` and `app/channel/test/`.
5. Run everything:
   ```bash
   .venv/bin/python tests/run_tests.py
   .venv/bin/python scripts/leak_scan.py
   ```
6. Open a **pull request** against `main`, fill in the template, and keep it focused: one change per PR.

## Rules for every contribution

- **No real data.** No names, accounts, activity or workout ids, race calendars, health data,
  screenshots or recorded activity files of real people — including yourself. Use the synthetic Demo
  athlete (`app/fixtures/make_demo.py`) or build synthetic data in the test (see `_synthetic_fit` in
  `tests/run_tests.py`). `athletes/` and `data/` are ignored; `leak_scan.py` checks the rest.
- **No credentials or tokens**, ever. Garmin logins go through `scripts/login.py`, typed by the user.
- **No third-party logos, copied text or scraped content.** Write it yourself, or link to it.
- **Respect the data sources' terms.** No Strava API calls, no community Strava MCP servers, no
  scraping of sites whose terms forbid it. Garmin access only through `garminconnect`.
- **Never weaken a safety gate** (the validation gate, the confirm before a Garmin write, the medical
  tests, the consent step) without discussing it in an issue first.
- **One definition per number.** A new metric goes in `scripts/formulas.py` with its defining sentence.
- **Keep code and docs in step.** When a rule changes, change the test that enforces it in the same PR.

## Licensing of contributions

OpenSportCoach is licensed under the [Apache License 2.0](LICENSE). By submitting a pull request you
agree that your contribution is licensed under the same terms (Apache-2.0, Section 5), and you confirm
that you wrote it or have the right to submit it. Please sign off your commits (`git commit -s`), which
certifies the [Developer Certificate of Origin](https://developercertificate.org/).

## Reporting a security or privacy problem

Please don't open a public issue — see [`SECURITY.md`](SECURITY.md).

## Code of conduct

Be kind and constructive. See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
