---
type: incident
status: fixed
since: 2026-09-07
source: the gate itself — prescription_audit.py blocked a D4 push on a STALE that did not exist
enforced_by: tests/run_tests.py::test_audit_counts_only_strength_sessions
---

# A Hyrox station was audited against a gym prescription, and it blocked a push

`prescription_audit.py` scanned **every** `data/activity_*_sets.json` with no filter on activity
type. The Hyrox is one of them, and its lunge station logs under `LUNGE/DUMBBELL_LUNGE` — the **same
catalog key** as `D3E9`.

The two prescriptions are unrelated:

| | Prescription |
|---|---|
| `D3E9`, gym | 3 × 20 @ **10 kg/arm** |
| Hyrox station | 2 × **16–20 kg** carried at the sides for **100 m** |

So a conditioning station was scored as an attempt at a hypertrophy lift. One genuine miss on
2026-09-01 (8/arm against 10/arm asked) was joined by the 09-06 Hyrox and **inflated from `watch` to
`STALE`** — and STALE is a **push-blocking** verdict. The gate refused a `D4` push over a lift that
was not being written.

Third in the family, after [[2026-08-14-volume-attribution]] and
[[2026-08-29-virtual-run-ungrouped]]: **a lookup that cannot separate two contexts sharing a key.**
The output looked entirely plausible — "2 sessions, best done 8" — and only failed because D3 Legs
had obviously run once, not twice.

## What was changed

`strength_activity_ids()` and `strength_set_files()` resolve each set file's `activityId` against the
cached activity list and keep only `strength_training`. Everything else is excluded, and a set file
whose activity type is **not resolvable at all** is excluded *loudly*, on stderr — silent exclusion
is the other half of this same bug.

`DUMBBELL_LUNGE` correctly reads `1 session — watch` again and the audit exits 0.

## The lesson

**An exercise key is not a prescription.** The same movement appears in the gym program and in the
Hyrox with different loads, distances and intent. Any check that reasons from
`(category, exerciseName)` alone must first ask which kind of session it is looking at.
