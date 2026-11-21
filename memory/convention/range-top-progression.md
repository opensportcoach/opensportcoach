---
type: convention
status: active
since: 2026-07-16
source: the pull-up plateau fix; revised 2026-08-14 after the deadlift failure
enforced_by: tests/run_tests.py::test_rep_ranges_stay_sane
also_enforced_by: scripts/prescription_audit.py
---

# The watch shows the range TOP

Every generated step prescribes the **top** of its rep range, with the rule in the step note:
`Range 11-13 · all sets at 13 -> +weight`. Hitting the top on all sets fires a **bump signal**.

This was right — it broke a five-session pull-up plateau immediately.

## But it can prescribe the impossible

The same change silently raised every load×reps demand. The deadlift ended at **3×8 @100, an implied
e1RM of 126.7 against a lifetime best of 120** — he would have had to beat his best on all three
sets of the day's opening lift. It survived **four weeks** because nothing checked, and he caught it
himself:

> "8 reps with 100kg for deadlift is something I can't do, it's too much I don't want to injure"

`prescription_audit.py` exists because of that. It now reports **FRESH / watch / STALE / IMPOSSIBLE**
rather than alarming on everything above his best — see [[fresh-vs-stale-prescriptions]].

## The corollary

**A prescription he never performs is data.** If a load is asked for across two or more sessions and
never met, the load is wrong, the equipment cannot make that increment, or he is not seeing it.
Ask him. Do not let it sit.
