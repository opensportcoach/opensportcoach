#!/usr/bin/env python3
"""Record what the coach read through Strava's official MCP connector — recent sessions, briefly.

    .venv/bin/python scripts/import_strava.py --json /tmp/strava_recent.json   # save what the MCP returned
    .venv/bin/python scripts/import_strava.py --prune                          # drop what has expired

HOW STRAVA IS CONNECTED. Strava publishes its own MCP server; Claude Code connects to it with
    claude mcp add --transport http strava-mcp https://mcp.strava.com/mcp
and the athlete approves it in their browser (Strava → Settings → My Apps revokes it). It is read-only,
needs a Strava subscription, and serves the athlete's own data to the athlete's own assistant. This
project never holds a Strava token and never calls Strava's API: Strava's API Policy (2026-06-01) §5.3
forbids putting API data into an AI's context, and names the MCP (§3.5) as the one route for a
subscriber's personal use of their own data.

WHAT IS KEPT, AND FOR HOW LONG. Strava's terms do not say what an assistant may keep from the MCP, so
this keeps the least that makes the daily work, under the strictest rule Strava writes anywhere (the
API's: a cache of at most 7 days, §6.2; no location data, §5.7):
  * a SUMMARY per session — sport, start, duration, distance, heart rate, power, elevation, its name;
  * never GPS: start/end coordinates, maps and polylines are dropped before anything is written;
  * `retainUntil` = the day it was read + RETAIN_DAYS. --prune (refresh.sh runs it) deletes it after that.
History older than a week comes from the athlete's OWN export — Strava's "Download your data"
archive, imported by scripts/import_files.py — which is theirs to keep (§6.6). When that export holds
the same session, sources.reconcile keeps the file's copy (it has every channel) and drops this one.

THE INPUT. The coach saves the MCP's activity records VERBATIM to a JSON file — a list, or
{"activities": [...]} — and passes it here. The keys Strava uses for an activity are read (id, name,
sport_type or type, start_date, start_date_local, elapsed_time, moving_time, distance,
total_elevation_gain, average_heartrate, max_heartrate, average_watts, weighted_average_watts,
calories, device_name, trainer). A record without an id, a start and a duration is refused, not
guessed. Never type a record from memory: if the MCP returned nothing, say so.

An athlete whose sources include garmin is refused: their Strava holds the same sessions their watch
already gave Garmin (sources.py).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402
import sources  # noqa: E402

RETAIN_DAYS = 7
DROPPED = {"start_latlng", "end_latlng", "map", "summary_polyline", "polyline", "location_city",
           "location_state", "location_country", "segment_efforts", "best_efforts_location"}


def _type_key(rec: dict) -> str:
    import import_files
    raw = rec.get("sport_type") or rec.get("type") or rec.get("activity_type")
    tk = import_files.word_type(raw)
    if rec.get("trainer") and tk == "running":
        return "treadmill_running"
    if rec.get("trainer") and tk == "cycling":
        return "indoor_cycling"
    return tk


def _when(v) -> dt.datetime | None:
    if not v:
        return None
    try:
        t = dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t


def normalize(rec: dict, today: dt.date) -> dict:
    """One Strava activity record → a summary in the engine's shape. Raises ValueError when it lacks
    what a session needs."""
    sid = rec.get("id") or rec.get("activity_id")
    if not str(sid or "").isdigit():
        raise ValueError(f"no numeric activity id in {sorted(rec)[:8]}")
    start_utc, start_local = _when(rec.get("start_date")), _when(rec.get("start_date_local"))
    if not (start_utc or start_local):
        raise ValueError(f"activity {sid}: no start_date")
    secs = rec.get("moving_time") or rec.get("elapsed_time")
    if not isinstance(secs, (int, float)) or secs <= 0:
        raise ValueError(f"activity {sid}: no duration")
    local = (start_local or start_utc.astimezone()).replace(tzinfo=None)
    gmt = (start_utc.astimezone(dt.timezone.utc).replace(tzinfo=None) if start_utc and start_utc.tzinfo else None)
    out = {"activityId": sources.STRAVA_ID_BASE + int(sid), "activityName": rec.get("name"),
           "activityType": {"typeKey": _type_key(rec)},
           "startTimeLocal": local.strftime("%Y-%m-%d %H:%M:%S"),
           "startTimeGMT": gmt.strftime("%Y-%m-%d %H:%M:%S") if gmt else None,
           "duration": rec.get("moving_time") or secs, "elapsedDuration": rec.get("elapsed_time"),
           "movingDuration": rec.get("moving_time"), "distance": rec.get("distance"),
           "averageHR": rec.get("average_heartrate"), "maxHR": rec.get("max_heartrate"),
           "avgPower": rec.get("average_watts"), "normPower": rec.get("weighted_average_watts"),
           "elevationGain": rec.get("total_elevation_gain"), "calories": rec.get("calories"),
           "averageSpeed": rec.get("average_speed"), "deviceName": rec.get("device_name"),
           "source": "strava", "origin": "strava-mcp", "sourceId": str(sid),
           "retainUntil": (today + dt.timedelta(days=RETAIN_DAYS)).isoformat()}
    return {k: v for k, v in out.items() if v is not None}


def records(payload) -> list[dict]:
    if isinstance(payload, dict):
        for key in ("activities", "data", "results", "items"):
            if isinstance(payload.get(key), list):
                return payload[key]
        return [payload]
    if isinstance(payload, list):
        return payload
    raise ValueError("expected a list of activities or {\"activities\": [...]}")


def prune(a: athlete.Athlete, today: dt.date | None = None) -> int:
    """Delete every Strava record past its retainUntil. Returns how many went."""
    today = today or dt.date.today()
    path = a.data_dir / sources.SUMMARY_FILE["strava"]
    try:
        rows = json.loads(path.read_text())
    except (OSError, ValueError):
        return 0
    keep = [r for r in rows if str(r.get("retainUntil") or "0000") >= today.isoformat()]
    if len(keep) != len(rows):
        path.write_text(json.dumps(keep, indent=2) + "\n")
    return len(rows) - len(keep)


def ingest(a: athlete.Athlete, payload, today: dt.date | None = None) -> dict:
    if sources.uses(a, "garmin"):
        raise SystemExit(f"REFUSED: {a.display}'s source is Garmin, and everything on their Strava came from "
                         "the watch. Reading it too would only duplicate sessions (scripts/sources.py).")
    if not sources.uses(a, "strava"):
        raise SystemExit(f"REFUSED: strava is not one of {a.display}'s sources (athlete.json → sources).")
    today = today or dt.date.today()
    path = a.data_dir / sources.SUMMARY_FILE["strava"]
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        have = {r["activityId"]: r for r in json.loads(path.read_text())}
    except (OSError, ValueError):
        have = {}
    added, refused = 0, []
    for rec in records(payload):
        if not isinstance(rec, dict):
            refused.append(f"not a record: {str(rec)[:60]}")
            continue
        clean = {k: v for k, v in rec.items() if k not in DROPPED}
        try:
            row = normalize(clean, today)
        except ValueError as e:
            refused.append(str(e))
            continue
        added += row["activityId"] not in have
        have[row["activityId"]] = row
    path.write_text(json.dumps(sorted(have.values(), key=lambda r: r["startTimeLocal"]), indent=2) + "\n")
    expired = prune(a, today)
    dropped = sources.reconcile(a)
    return {"added": added, "refused": refused, "expired": expired, "duplicates_removed": dropped}


def main() -> int:
    a = athlete.current()   # first: it takes --athlete off the command line
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--json", type=Path, help="the MCP's activity records, saved verbatim")
    g.add_argument("--prune", action="store_true", help="delete records past their retainUntil")
    args = ap.parse_args()
    if args.prune:
        print(f"strava: {prune(a)} expired record(s) deleted")
        return 0
    try:
        payload = json.loads(args.json.read_text())
    except (OSError, ValueError) as e:
        print(f"refused: {args.json} is not readable JSON ({e})", file=sys.stderr)
        return 1
    got = ingest(a, payload)
    print(f"strava: {got['added']} new session(s) kept until "
          f"{(dt.date.today() + dt.timedelta(days=RETAIN_DAYS)).isoformat()}; {got['expired']} expired; "
          f"{len(got['duplicates_removed'])} duplicate(s) of another source removed")
    if got["refused"]:
        print("NOT RECORDED — say so, never fill them in:", file=sys.stderr)
        for r in got["refused"]:
            print(f"  - {r}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
