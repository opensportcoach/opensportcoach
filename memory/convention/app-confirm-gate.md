---
type: convention
status: active
since: 2026-10-08
source: docs/DESIGN.md (the app) — the app's confirm gate, (auto mode, the hook as the hard line)
enforced_by: tests/run_tests.py::test_confirm_gate_holds_garmin_writes_in_app_sessions_to_a_click
---

# In a session serving the app, the confirm is a click

When a coach session serves the app (`/osc-app`, attached), the athlete confirms a Garmin write by
pressing **Send to watch** on the card that shows the dry-run plan — not by typing "yes" in the chat.
The session runs in auto mode, where permission prompts never reach the page, so the rule is held
mechanically:

- `sync_workouts.py --yes` and `reschedule_workout.py --yes` run only with `--expect-plan <hash>`, and
  only after the app's server recorded a click on that hash in this session, within 15 minutes.
- The scripts refuse a plan whose hash changed since the click — what was confirmed is what is pushed.
- Deletes and raw client writes are refused in app sessions; Claude never records a click itself.

Sessions not serving the app keep the conversational confirm, unchanged. Accepting a plan is never a
confirmation to push.
