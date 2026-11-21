#!/usr/bin/env python3
"""Diff the repo's generated workouts against the Garmin account and reconcile them.

WHY (2026-08-30 audit, finding 10). Garmin has no update call: every edit uploads a NEW
workout id and leaves the old one behind under the same name, so he opens the stale copy
from the watch's Workouts list. The correct cycle is upload -> round-trip verify -> delete
superseded -> re-point the calendar, and it had been hand-rolled about six times in
throwaway scripts. 81 ids have been created over the project's life; 9 are alive. The one
time the cycle went wrong, it was because HE deleted a workout by accident while trying to
unschedule it (2026-08-26, Swim A) — recoverable in seconds only because the JSON is
generated rather than hand-written.

WHAT IT DOES
  1. Builds every workout from its generator so the repo side is never stale.
  2. Fetches the account and matches by workoutName.
  3. Uploads anything missing or changed, round-trip verifies it, then deletes the
     superseded id and re-points any calendar entry that referenced it.
  4. Writes athletes/<name>/workouts/WORKOUT_IDS.json so the live ids live in one tracked place instead
     of being copied by hand into CLAUDE.md.

SAFETY
  * DRY RUN by default. Nothing is written without --yes.
  * The athlete's PROTECTED workouts (athlete.json) are refused by explicit id and by an
    assertion. They are never touched, listed for deletion, or renamed.
  * It acts for the bound athlete only, and prints whose Garmin account it is reading.
  * Deletion only ever targets an id this script has just superseded with a verified
    upload of the same name.

Usage:
    .venv/bin/python scripts/sync_workouts.py            # dry run, shows the plan
    .venv/bin/python scripts/sync_workouts.py --yes      # execute (needs the athlete's confirm)
    .venv/bin/python scripts/sync_workouts.py --only run_easy_strides   # one key: a format probe
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402
from garmin_client import get_client, read_scheduled_workouts  # noqa: E402

A = athlete.current()
ROOT = athlete.REPO_ROOT
WORKOUTS = A.workouts_dir
IDS_PATH = WORKOUTS / "WORKOUT_IDS.json"

# NEVER TOUCH. Workouts that were in the athlete's account before OpenSportCoach managed it — for
# e.g. an athlete's own swims built in Garmin Connect before this project. Recorded per athlete in athlete.json, asserted below.
HIS_OWN = A.protected_ids

# The engine builds the athlete's program.py AND their sessions (swims, runs, circuits, mobility —
# athlete.json → sessions, scripts/build_sessions.py). Legacy executable generators still run after it.
GENERATORS = [ROOT / "scripts" / "build_workouts.py", *A.generators]

# Only these are reconciled. Anything else in the account is left alone.
MANAGED = A.managed


def comparable(w: dict) -> str:
    """Signature of everything that actually reaches the watch, and nothing else.

    A structural deep-compare does NOT work here: Garmin echoes back dozens of fields the
    generated JSON omits (every step comes home with a null strokeType, poolLength,
    secondaryTargetValueUnit and so on) and renormalises displayOrder. Comparing raw
    documents reported all nine workouts as changed when only one had. So this extracts an
    explicit tuple per step instead — if a field is not listed here, it does not reach him
    and it does not count as a change.
    """
    def num(v):
        # Garmin returns 14.0 where the generated JSON wrote 14. Python compares those
        # equal but json.dumps does not, which made every strength workout look CHANGED.
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v

    def steps(node, out, iters=1):
        for s in node:
            if s.get("type") == "RepeatGroupDTO":
                out.append(("repeat", num(s.get("numberOfIterations"))))
                steps(s.get("workoutSteps", []), out, s.get("numberOfIterations"))
            else:
                row = (
                    (s.get("stepType") or {}).get("stepTypeKey"),
                    (s.get("endCondition") or {}).get("conditionTypeKey"),
                    num(s.get("endConditionValue")),
                    s.get("category"),
                    s.get("exerciseName"),
                    num(s.get("weightValue")),
                    (s.get("description") or "").strip() or None,
                    (s.get("strokeType") or {}).get("strokeTypeKey"),
                    (s.get("equipmentType") or {}).get("equipmentTypeKey"),
                    # Kick and pull are a drillType on a swim step (2026-10-04, from an athlete's own
                    # Connect-built swims). Absent on every other step, so None == None there.
                    (s.get("drillType") or {}).get("drillTypeKey"),
                )
                # A run's heart-rate range reaches the watch as an alert (2026-10-11). Appended only
                # when a step HAS a target, so every no-target workout keeps the exact signature —
                # and the recorded content hash — it had before runs existed.
                t = s.get("targetType") or {}
                if t.get("workoutTargetTypeKey") not in (None, "no.target"):
                    row += (t.get("workoutTargetTypeKey"), num(s.get("targetValueOne")),
                            num(s.get("targetValueTwo")), s.get("zoneNumber"))
                out.append(row)

    flat: list = []
    for seg in w.get("workoutSegments") or []:
        steps(seg.get("workoutSteps", []), flat)
    return json.dumps({
        "name": w.get("workoutName"),
        "sport": (w.get("sportType") or {}).get("sportTypeKey"),
        "pool": num(w.get("poolLength")),
        "steps": flat,
    }, sort_keys=True, ensure_ascii=False)




def account_match(key: str, name: str, account: dict, previous: dict) -> tuple[int | None, str | None]:
    """The account workout this managed key supersedes: (id, the name it carries there).

    Its current name first. Failing that, a name it used to carry (athlete.json → previous_names):
    a RENAME, so the upload supersedes the old-name copy exactly as it would a same-name one —
    verified, calendar re-pointed, old id deleted. Without this a rename left the old workout on
    the watch next to the new one, which is the duplicate this script exists to prevent.
    """
    if name in account:
        return account[name], name
    for old in previous.get(key, []):
        if old in account:
            return account[old], old
    return None, None


def content_hash(w: dict) -> str:
    """What a workout IS, as far as the watch can tell (comparable()), as a short hash. Recorded in
    WORKOUT_IDS.json for every workout known to be in sync, so the app can say "N changes not on
    the watch" without calling Garmin (2026-10-08, docs/DESIGN.md (the app))."""
    import hashlib
    return hashlib.sha256(comparable(w).encode()).hexdigest()[:16]


def plan_hash(plan: list, local: dict) -> str:
    """The plan the athlete confirms, as a hash: every action, plus the exact content of every
    workout it would upload. The app records the athlete's click against this hash, and --yes
    --expect-plan refuses to run anything else — what was confirmed is what gets pushed."""
    import hashlib
    body = [(key, name, old_id, action, content_hash(local[key]) if action != "in sync" else None)
            for key, name, old_id, action in plan]
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:16]


def plan_json(plan: list, local: dict, calendar: dict) -> dict:
    """The dry-run plan for the app's confirm card: whose account, and exactly what changes."""
    actions = []
    for key, name, old_id, action in plan:
        verb = "upload" if old_id is None else ("in_sync" if action == "in sync" else "replace")
        actions.append({"key": key, "workout": name, "old_id": old_id, "verb": verb,
                        "dates": [d for _, d in calendar.get(old_id or -1, [])]})
    return {"athlete": A.name, "display": A.display, "garmin_account": A.garmin.get("full_name"),
            "protected": len(HIS_OWN), "actions": actions, "plan_hash": plan_hash(plan, local)}


def recorded_ids() -> dict:
    try:
        return json.loads(IDS_PATH.read_text()).get("workouts") or {}
    except (OSError, json.JSONDecodeError):
        return {}


def recorded_hashes() -> dict:
    try:
        return json.loads(IDS_PATH.read_text()).get("hashes") or {}
    except (OSError, json.JSONDecodeError):
        return {}


def retrying(label: str, fn, *args, tolerate_404: bool = False, tries: int = 3):
    """Run a Garmin write, surviving the transport resets this API produces under load.

    2026-08-30, twice in one afternoon: a ConnectionResetError landed on the RESPONSE of
    an upload, and later on the response of a delete. Both times the server had done the
    work; both times the script died holding a half-finished reconciliation, which for
    this tool means duplicate workouts on his watch. Retrying is safe for delete and
    unschedule because they are idempotent — a 404 on the second attempt means the first
    one worked.
    """
    for attempt in range(1, tries + 1):
        try:
            return fn(*args)
        except Exception as exc:  # noqa: BLE001 - transport errors share no useful base
            msg = str(exc)
            if tolerate_404 and ("404" in msg or "not found" in msg.lower()):
                print(f"     {label}: already gone (404) — treating as done")
                return None
            if attempt == tries:
                raise
            print(f"     {label}: {type(exc).__name__} — retry {attempt}/{tries - 1}")
            time.sleep(3.0 * attempt)
    return None


def upload_resilient(client, payload: dict, old_id: int | None):
    """Upload, surviving a connection reset on the RESPONSE.

    2026-08-30: the first real run of this script died with ConnectionResetError inside
    upload_workout — but the workout had already been created server-side. The script
    never got the id back, so it never verified and never deleted, and the account was
    left holding TWO workouts called "D1 · Push": exactly the duplicate-name problem this
    tool exists to prevent. A naive retry would have made a third.

    So on a transport error we do NOT retry blindly. We re-list the account and look for a
    workout with this name whose id is not the one we were replacing. If it is there, the
    upload landed and we adopt it.
    """
    name = payload["workoutName"]
    try:
        return client.upload_workout(payload)["workoutId"]
    except Exception as exc:  # noqa: BLE001 - transport errors have no useful common base
        print(f"     upload raised {type(exc).__name__}: {exc}")
        print("     checking whether it landed anyway before retrying...")
        time.sleep(3.0)
        candidates = [w["workoutId"] for w in client.get_workouts(0, 60)
                      if w["workoutName"] == name and w["workoutId"] != old_id]
        if candidates:
            found = max(candidates)
            print(f"     it did — adopting {found} instead of re-uploading")
            return found
        print("     it did not; retrying once")
        time.sleep(3.0)
        return client.upload_workout(payload)["workoutId"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true",
                    help="actually write to Garmin (only after the athlete's explicit confirmation)")
    ap.add_argument("--skip-build", action="store_true", help="trust the JSON on disk")
    ap.add_argument("--plan-json", metavar="FILE",
                    help="also write the plan as JSON (athlete, account, actions, plan_hash) — the app's confirm card")
    ap.add_argument("--expect-plan", metavar="HASH",
                    help="with --yes: refuse unless the plan's hash is exactly this (the plan the athlete confirmed)")
    ap.add_argument("--only", metavar="KEY", action="append",
                    help="reconcile only this managed key (repeatable). For proving a new payload format "
                         "on one workout before the full push; every other workout is left as it is")
    args = ap.parse_args()
    if args.expect_plan and not args.yes:
        ap.error("--expect-plan only means something with --yes")
    unknown = sorted(set(args.only or []) - set(MANAGED))
    if unknown:
        ap.error(f"--only: not managed workouts: {unknown}")
    keys = [k for k in MANAGED if k in args.only] if args.only else MANAGED

    if not args.skip_build:
        for g in GENERATORS:
            subprocess.run([sys.executable, str(g)], check=True, capture_output=True)
        print("regenerated all workout JSON from source\n")

    client = get_client()
    # KEEP THE NEWEST id per name. get_workouts returns newest first, so a naive dict
    # comprehension keeps the OLDEST — which on 2026-08-30 made the script compare against
    # a superseded copy and report an already-synced workout as CHANGED.
    account: dict[str, int] = {}
    for w in client.get_workouts(0, 60):
        name, wid = w["workoutName"], w["workoutId"]
        if name not in account or wid > account[name]:
            account[name] = wid
    # The calendar window is derived from today and deduped by SCHEDULE id — see
    # read_scheduled_workouts. It was a hardcoded `2026, months 8-10` until 2026-09-24,
    # which would have gone blind to every November entry.
    calendar = {}
    for item in read_scheduled_workouts(client):
        calendar.setdefault(item["workoutId"], []).append((item["id"], item["date"]))

    plan, local_by_key, old_names = [], {}, {}
    for key in keys:
        local = json.loads((WORKOUTS / f"{key}.json").read_text())
        local_by_key[key] = local
        name = local["workoutName"]
        old_id, old_name = account_match(key, name, account, A.previous_names)
        old_names[key] = old_name
        if old_id is None:
            plan.append((key, name, None, "MISSING — upload"))
            continue
        assert old_id not in HIS_OWN, f"name collision with protected workout {old_id}"
        if old_name != name:
            plan.append((key, name, old_id, f"RENAMED from '{old_name}' — upload, delete old"))
            continue
        remote = client.get_workout_by_id(old_id)
        time.sleep(0.6)
        if comparable(local) != comparable(remote):
            plan.append((key, name, old_id, "CHANGED — re-upload and delete old"))
        else:
            plan.append((key, name, old_id, "in sync"))

    print(f"athlete: {A.display} · Garmin account: {A.garmin.get('full_name')}\n")
    print(f"{'workout':26s} {'id':>12s}  action")
    print("-" * 70)
    for key, name, old_id, action in plan:
        print(f"{name:26s} {str(old_id or '—'):>12s}  {action}")

    phash = plan_hash(plan, local_by_key)
    print(f"\nplan hash: {phash}")
    if args.plan_json:
        Path(args.plan_json).write_text(json.dumps(plan_json(plan, local_by_key, calendar), indent=1) + "\n")
    hashes = recorded_hashes()
    # With --only, the workouts outside this run keep their recorded ids; without it, the file is
    # rewritten from the plan, which also drops any name a rename retired.
    kept = {}
    if args.only:
        retired = {n for _, n, _, _ in plan} | {o for o in old_names.values() if o}
        kept = {n: i for n, i in recorded_ids().items() if n not in retired}
    todo = [p for p in plan if p[3] != "in sync"]
    if not todo:
        print("\nEverything in sync. Nothing to do.")
        write_ids({**kept, **{n: i for _, n, i, _ in plan}},
                  {**hashes, **{n: content_hash(local_by_key[k]) for k, n, _, _ in plan}})
        return
    if not args.yes:
        print(f"\nDRY RUN — {len(todo)} workout(s) would change. Re-run with --yes to execute.")
        sys.exit(0)
    if args.expect_plan and args.expect_plan != phash:
        sys.exit(f"REFUSED: the plan is now {phash}, not the {args.expect_plan} that was confirmed — "
                 "something changed since. Nothing was written. Dry-run again and get a new confirm.")

    ids = dict(kept)
    for key, name, old_id, action in plan:
        if action == "in sync":
            ids[name] = old_id
            hashes[name] = content_hash(local_by_key[key])
            continue
        payload = json.loads((WORKOUTS / f"{key}.json").read_text())
        new_id = upload_resilient(client, payload, old_id)
        time.sleep(1.2)
        fetched = client.get_workout_by_id(new_id)
        time.sleep(0.8)
        if comparable(payload) != comparable(fetched):
            print(f"  !! {name}: round-trip MISMATCH on {new_id} — leaving the old id alone")
            ids[name] = old_id
            continue
        print(f"  {name}: uploaded {new_id}, round-trip OK")
        hashes[name] = content_hash(payload)
        for sched_id, date in calendar.get(old_id or -1, []):
            retrying(f"unschedule {sched_id}", client.unschedule_workout, sched_id,
                     tolerate_404=True)
            time.sleep(1.0)
            retrying(f"schedule {date}", client.schedule_workout, new_id, date)
            time.sleep(1.0)
            print(f"     calendar {date} re-pointed to {new_id}")
        if old_id:
            assert old_id not in HIS_OWN, "refusing to delete a protected workout"
            retrying(f"delete {old_id}", client.delete_workout, old_id, tolerate_404=True)
            time.sleep(1.0)
            print(f"     deleted superseded {old_id}")
        ids[name] = new_id
    write_ids(ids, hashes)


def id_history(ids: dict) -> dict:
    """name -> every id the workout had before its current one. An upload always creates a new id, and a
    session on the watch records the id it was started from: session_review.py matches an older session
    to the workout it followed through this."""
    try:
        prev = json.loads(IDS_PATH.read_text())
    except (OSError, ValueError):
        prev = {}
    hist = {n: list(v) for n, v in (prev.get("history") or {}).items()}
    for name, old in (prev.get("workouts") or {}).items():
        if name in ids and ids[name] != old and old not in hist.setdefault(name, []):
            hist[name].append(old)
    return {n: v for n, v in sorted(hist.items()) if v}


def write_ids(ids: dict, hashes: dict | None = None) -> None:
    history = id_history(ids)
    IDS_PATH.write_text(json.dumps(
        {"_meta": {"purpose": "Live Garmin workout ids for the managed workouts. Written by "
                              "sync_workouts.py; the single source of truth for ids so they "
                              "stop being copied by hand into CLAUDE.md.",
                   "protected": f"{A.display}'s protected workouts "
                                f"{' / '.join(str(i) for i in sorted(HIS_OWN)) or '(none)'} "
                                "are never managed or deleted by this project (athlete.json)."},
         "workouts": dict(sorted(ids.items())),
         # content_hash() of what is on the watch, per workout — "not on the watch" offline.
         "hashes": dict(sorted((n, h) for n, h in (hashes or recorded_hashes()).items() if n in ids)),
         **({"history": history} if history else {})},
        indent=1) + "\n")
    print(f"\nwrote {IDS_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
