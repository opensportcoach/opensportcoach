#!/usr/bin/env python3
"""Where an athlete's training data comes from, and the one rule that keeps two sources from counting a
session twice.

    .venv/bin/python scripts/sources.py              # this athlete's sources, one per line
    .venv/bin/python scripts/sources.py reconcile    # find duplicates across sources, delete the weaker copy

THE SOURCES (athlete.json → "sources", a list; set at setup by /osc-setup):

  garmin   Garmin Connect through the `garminconnect` library: activities, exercise sets, laps, streams,
           AND sleep, HRV, readiness and the rest of the health data, AND the watch (workouts pushed to
           it). The richest source by far. scripts/pull_activities.py, pull_health.py.
  files    The athlete's OWN exported files: FIT, GPX or TCX from any device or app (Coros, Wahoo, Polar,
           Suunto, Zwift, an Apple Watch export), and Strava's "Download your data" archive.
           scripts/import_files.py. No account, no API, nothing leaves the machine.
  strava   Strava's official MCP connector, read by the coach in a session (it is read-only and needs a
           Strava subscription): recent sessions only. Strava's API Policy forbids putting API data into
           an AI's context; the MCP is the one route it allows, for a subscriber's personal use of their
           own data. It says nothing about keeping that data, so this project keeps the least: no GPS,
           and each record expires after 7 days unless the athlete's own export replaces it.
           scripts/import_strava.py.

An athlete WITH Garmin does not read Strava: everything on Strava came from the watch, so it could only
duplicate. Absent "sources" means ["garmin"] — every athlete bound before sources existed was a Garmin one.

DUPLICATES. A session recorded on the watch can come back through a FIT export or Strava too. Two
records are the SAME session when they are the same sport group (sports.group), start within
SAME_START_S of each other, and last within SAME_DURATION (fraction) or SAME_DURATION_S of each other.
The copy from the better source is kept — PRIORITY, best first — and the other is deleted from the
cache with its per-activity files, and written to dedupe_log.json with why. "Better" is what each source
can carry: Garmin has sets, zones, training load and the device's own metrics; a file has every recorded
channel; Strava's MCP has a summary.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402
import sports  # noqa: E402

KNOWN = ("garmin", "files", "strava")
PRIORITY = ("garmin", "files", "strava")      # best first: the kept copy of a duplicate
SAME_START_S = 120
SAME_DURATION = 0.10
SAME_DURATION_S = 120
# Synthetic activity ids for sessions that did not come from Garmin. Kept below 2**53 so the app's
# JavaScript reads them exactly, and far above any Garmin id (~2.5e10) so they can never collide.
FILES_ID_BASE = 7_000_000_000_000_000
STRAVA_ID_BASE = 8_000_000_000_000_000
# Each source's own summary file in the cache. Garmin's are activities_<start>_<end>.json.
SUMMARY_FILE = {"files": "activities_files.json", "strava": "activities_strava.json"}
PER_ACTIVITY = ("sets", "splits", "details", "full", "hrzones", "powerzones", "weather")


def of(a: athlete.Athlete) -> list[str]:
    """This athlete's sources, validated. Exits on an unknown one, before anything is read."""
    got = a.config.get("sources")
    if got is None:
        return ["garmin"]
    if not isinstance(got, list) or not got or any(s not in KNOWN for s in got):
        sys.exit(f"{a.display}'s athlete.json → sources must be a non-empty list of {', '.join(KNOWN)}: {got!r}")
    return list(dict.fromkeys(got))


def uses(a: athlete.Athlete, source: str) -> bool:
    return source in of(a)


def source_of(activity: dict) -> str:
    """Which source a cached summary came from. Garmin's own carry no `source` field."""
    return activity.get("source") or "garmin"


def _start(a: dict) -> dt.datetime | None:
    for key in ("startTimeGMT", "startTimeLocal"):
        v = a.get(key)
        if v:
            try:
                return dt.datetime.fromisoformat(str(v).replace("Z", "").replace("T", " ")[:19])
            except ValueError:
                continue
    return None


def same_session(x: dict, y: dict) -> bool:
    """The duplicate rule, written once (see the module docstring)."""
    tx, ty = (x.get("activityType") or {}).get("typeKey"), (y.get("activityType") or {}).get("typeKey")
    if sports.group(tx) != sports.group(ty):
        return False
    # Compare like with like: GMT with GMT where both have it, else local with local.
    key = "startTimeGMT" if x.get("startTimeGMT") and y.get("startTimeGMT") else "startTimeLocal"
    sx, sy = _start({key: x.get(key)}), _start({key: y.get(key)})
    if sx is None or sy is None or abs((sx - sy).total_seconds()) > SAME_START_S:
        return False
    dx, dy = x.get("duration") or x.get("elapsedDuration"), y.get("duration") or y.get("elapsedDuration")
    if not dx or not dy:
        return True
    return abs(dx - dy) <= max(SAME_DURATION_S, SAME_DURATION * max(dx, dy))


def duplicates(activities: list[dict]) -> list[tuple[dict, dict]]:
    """[(kept, dropped)] — each dropped record paired with the copy that outranks it."""
    rank = {s: i for i, s in enumerate(PRIORITY)}
    ordered = sorted(activities, key=lambda a: (rank.get(source_of(a), 99), str(a.get("startTimeLocal"))))
    kept: list[dict] = []
    out: list[tuple[dict, dict]] = []
    for a in ordered:
        twin = next((k for k in kept if source_of(k) != source_of(a) and same_session(k, a)), None)
        if twin is None:
            kept.append(a)
        else:
            out.append((twin, a))
    return out


def _summaries(a: athlete.Athlete) -> dict[Path, list[dict]]:
    out = {}
    for path in sorted(a.data_dir.glob("activities_*.json")):
        try:
            out[path] = json.loads(path.read_text())
        except ValueError:
            continue
    return out


def reconcile(a: athlete.Athlete) -> list[dict]:
    """Delete every lower-priority duplicate from the cache; return what was dropped (and log it)."""
    files = _summaries(a)
    every = [x for rows in files.values() for x in rows if isinstance(x, dict)]
    drops = duplicates(every)
    if not drops:
        return []
    gone = {id(d) for _, d in drops}
    for path, rows in files.items():
        left = [x for x in rows if id(x) not in gone]
        if len(left) != len(rows):
            path.write_text(json.dumps(left, indent=2, default=str) + "\n")
    for _, d in drops:
        for part in PER_ACTIVITY:
            (a.data_dir / f"activity_{d['activityId']}_{part}.json").unlink(missing_ok=True)
    log_path = a.data_dir / "dedupe_log.json"
    try:
        log = json.loads(log_path.read_text())
    except (OSError, ValueError):
        log = []
    now = dt.datetime.now().isoformat(timespec="seconds")
    entries = [{"at": now, "kept": {"id": k["activityId"], "source": source_of(k)},
                "dropped": {"id": d["activityId"], "source": source_of(d), "start": d.get("startTimeLocal"),
                            "type": (d.get("activityType") or {}).get("typeKey")},
                "why": f"same sport, started within {SAME_START_S}s, same duration; {source_of(k)} outranks "
                       f"{source_of(d)}"} for k, d in drops]
    log_path.write_text(json.dumps(log + entries, indent=1) + "\n")
    return entries


def main() -> int:
    a = athlete.current()
    if len(sys.argv) > 1 and sys.argv[1] == "reconcile":
        dropped = reconcile(a)
        print(f"duplicates: {len(dropped)} removed" + "".join(
            f"\n  - {e['dropped']['start']} {e['dropped']['type']} from {e['dropped']['source']} "
            f"(kept {e['kept']['source']}'s copy)" for e in dropped))
        return 0
    print("\n".join(of(a)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
