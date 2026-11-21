---
type: incident
status: fixed
since: 2026-10-04
source: the 2026-10-04 full audit, P1-3
enforced_by: tests/run_tests.py::test_a_stale_cache_is_flagged
also_enforced_by:
  - tests/run_tests.py::test_a_backfill_does_not_make_the_cache_look_fresh
---

# Every check was green on a cache pulled before the session it was judging

On 2026-10-04 the audit's cheap checks — tests, prescription audit, harvest, sync dry run — all
passed. They ran on an activity cache pulled at **12:31 on 10-03**. His D3 legs session started at
**17:29** that day. So `rotation_status.py` said "D3 Legs STARVED — next gym day should be D3" the
morning after he trained legs, and every D3 prescription read FRESH. A daily built on that cache would
have proposed legs again.

Nothing was wrong with the logic. The scripts read the cache and never say how old it is.

## What was changed

- `strength_sessions.cache_status()` prints `cache as of …` at the top of `prescription_audit.py`
  and `rotation_status.py`. It shouts `STALE CACHE` when the calendar (`scheduled.json`) has a
  past-dated strength workout, on or after the pull date, with no strength session cached that day.
  A pull made after the day has seen all of it, so a skipped workout stays quiet.
- `/osc-audit` now runs `scripts/refresh.sh` before its cheap checks.
- 2026-10-16: the pull date is the last **refresh**, never a backfill. It was the newest
  `activities_*.json` by mtime, and a backfill (`--end` before the day it ran: one race day in June)
  writes one too, so the cache looked pulled just then and this check went quiet for every day the
  backfill never saw. Only a file whose window reached the day it was written counts
  (`refreshed_at`). Found by reading the code.

**Read the freshness line before reading a verdict.** A green check on stale data is the same
failure mode as a plausible wrong number.
