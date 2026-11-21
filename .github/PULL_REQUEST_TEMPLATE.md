## What and why

<!-- One change per PR. Link the issue it closes: "Closes #123". -->

## How it was tested

<!-- Which test covers it? Paste the last line of `.venv/bin/python tests/run_tests.py`. -->

## Checklist

- [ ] `tests/run_tests.py` passes, and a test covers the change
- [ ] `scripts/leak_scan.py` is clean — **no real person's data** (names, ids, races, health, files, screenshots)
- [ ] No credentials, tokens, third-party logos or copied content
- [ ] No safety gate weakened (validation gate, Garmin confirm, medical tests, consent)
- [ ] Docs and the enforcing test changed together where a rule changed
- [ ] My commits are signed off (`git commit -s`) and licensed under Apache-2.0
