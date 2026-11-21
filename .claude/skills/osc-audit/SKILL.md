---
name: osc-audit
description: Full-project audit of the OpenSportCoach repo — data correctness, doc drift, stale prescriptions, dead code, catalog coverage, Garmin account hygiene and test-coverage gaps. Spawns the integrity-auditor agent. Use monthly, or when the athlete asks for an audit or says something feels off across the whole system.
---

# Full-project audit

An audit covers the **engine** (everything outside `athletes/`) and the **bound athlete's** data,
program and Garmin account. Another athlete's account and files are audited from a session bound to
them — never from this one.

If the athlete's folder keeps earlier audits (`athletes/<name>/history/AUDIT_*.md`), read the latest
one first — it sets the standard for evidence.

## Run the cheap checks yourself first

```bash
scripts/refresh.sh --athlete <name>        # FIRST — 2026-10-04's checks were all green on a cache
                                           # pulled before the session they were judging
.venv/bin/python tests/run_tests.py
.venv/bin/python scripts/prescription_audit.py
.venv/bin/python scripts/build_memory_index.py
.venv/bin/python scripts/harvest_exercises.py --skip-account
.venv/bin/python scripts/sync_workouts.py --skip-build
```

These are deterministic and take seconds. **Do not spend an agent invocation on anything a script
already answers.**

## Then spawn `integrity-auditor`

Give it the athlete's name, the date range and anything specific they have raised. It is read-only
and has no write tool, so it returns the report to you: **verify its top findings yourself, then
save it as `athletes/<name>/history/AUDIT_YYYY-MM-DD.md`.** Relay the ranked summary, because its
report does not reach them directly.

## The bar for a finding

**Evidence first, then the claim.** File, number, and how it was verified. A finding without a
reproduction is a guess.

Rank by whether it changes a coaching decision, not by how interesting it is. The most valuable
finding on 2026-08-30 was that the headline load metric is nearly blind to strength work —
unglamorous, and it invalidated a month of recommendations.

**Say what is working, too.** An audit that only lists problems gets discounted, and four things
have demonstrably prevented damage: generated-not-hand-written workouts, signature-based rotation,
the spine guard, and the per-athlete isolation (resolver, identity check, session lock).

## Afterwards

Turn each accepted finding into either a fix, a test, or a memory fact (engine `memory/` if it is
true for everyone, the athlete's own `memory/` if it is theirs). **A finding that becomes none of
those three will recur** — that is exactly how the premature cable-overhead-triceps prescription
survived nine days after being flagged.
