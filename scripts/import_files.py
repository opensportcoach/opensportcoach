#!/usr/bin/env python3
"""Import the athlete's OWN activity files into their cache, in the shapes the engine already reads.

    .venv/bin/python scripts/import_files.py                         # everything in data/<name>/inbox/
    .venv/bin/python scripts/import_files.py ~/Downloads/export_123.zip   # Strava's "Download your data" archive
    .venv/bin/python scripts/import_files.py ride.fit run.gpx swim.tcx
    .venv/bin/python scripts/import_files.py ~/Dropbox/Apps/WahooFitness --since 2026-01-01

WHAT IT READS. FIT (any device: Garmin, Coros, Wahoo, Polar, Suunto, Zwift, Hammerhead...), GPX and TCX,
each optionally .gz, one by one, from a folder, or from Strava's bulk export (a zip or its unpacked
folder: activities.csv names each activity; activities/ holds the files). Nothing is fetched: the files
are the athlete's own export, which Strava's API Policy §6.6 says every user may make and use, and which
never touches an API.

WHAT IT WRITES, in data/<name>/ — the same shapes Garmin's pull writes, so every view, review and score
works unchanged (sources.py says which source each record came from):
    activities_files.json          one summary per session: activityId, activityType.typeKey, startTimeLocal,
                                   startTimeGMT, duration, distance, HR, power, elevation, calories, `source`
    activity_<id>_details.json     every recorded channel (metricDescriptors + activityDetailMetrics)
    activity_<id>_splits.json      the laps (lapDTOs)
    activity_<id>_sets.json        a FIT strength session's sets (exerciseSets), names from the FIT profile
Ids are synthetic (sources.FILES_ID_BASE + a hash of the file), so re-importing a file is a no-op and
never collides with a Garmin id. After the import, sources.reconcile removes any session another source
already holds better (a FIT export of a ride Garmin already has).

WHAT IT CANNOT KNOW. A file has no sleep, HRV or readiness, and Garmin's own training load, zones and
thresholds are computed in Garmin's cloud, not stored in the file. The coach asks how the athlete feels;
thresholds come from athlete.json → profile (ftp_w, threshold_hr). Never invented.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402
import sources  # noqa: E402

SUFFIXES = (".fit", ".gpx", ".tcx")
FIT_EPOCH = dt.datetime(1989, 12, 31, tzinfo=dt.timezone.utc)
SEMICIRCLE = 180 / 2 ** 31

# --- sport names → Garmin typeKeys (sports.py groups and labels them) --------------------------------
FIT_SPORT = {  # (sport, sub_sport) → typeKey; sub_sport None = any
    ("cycling", "virtual_activity"): "virtual_ride", ("cycling", "indoor_cycling"): "indoor_cycling",
    ("cycling", "gravel_cycling"): "gravel_cycling", ("cycling", "mountain"): "mountain_biking",
    ("cycling", "road"): "road_biking", ("cycling", None): "cycling", ("e_biking", None): "cycling",
    ("running", "treadmill"): "treadmill_running", ("running", "trail"): "trail_running",
    ("running", "virtual_activity"): "virtual_run", ("running", "track"): "track_running",
    ("running", "indoor_running"): "indoor_running", ("running", None): "running",
    ("swimming", "lap_swimming"): "lap_swimming", ("swimming", "open_water"): "open_water_swimming",
    ("swimming", None): "swimming",
    ("training", "strength_training"): "strength_training", ("training", "cardio_training"): "cardio_training",
    ("training", "hiit"): "hiit", ("training", "yoga"): "yoga", ("training", "pilates"): "pilates",
    ("training", None): "cardio_training", ("hiit", None): "hiit",
    ("fitness_equipment", "indoor_rowing"): "indoor_rowing", ("fitness_equipment", None): "indoor_cardio",
    ("walking", None): "walking", ("hiking", None): "hiking", ("tennis", None): "tennis",
    ("racket", "padel"): "paddelball", ("racket", "pickleball"): "pickleball", ("racket", "squash"): "squash",
    ("racket", "badminton"): "badminton", ("racket", None): "tennis",
    ("alpine_skiing", None): "resort_skiing", ("sailing", None): "sailing", ("rowing", None): "rowing",
    ("multisport", None): "multi_sport", ("generic", None): "other",
}
WORDS = {  # GPX <type>, TCX Sport, Strava's activity types (lowercased, spaces and _ removed)
    "ride": "cycling", "cycling": "cycling", "biking": "cycling", "bike": "cycling", "1": "cycling",
    "virtualride": "virtual_ride", "gravelride": "gravel_cycling", "mountainbikeride": "mountain_biking",
    "ebikeride": "cycling", "emountainbikeride": "mountain_biking", "indoorcycling": "indoor_cycling",
    "run": "running", "running": "running", "9": "running", "trailrun": "trail_running",
    "virtualrun": "virtual_run", "treadmill": "treadmill_running",
    "swim": "swimming", "swimming": "swimming", "weighttraining": "strength_training",
    "strengthtraining": "strength_training", "workout": "cardio_training", "hiit": "hiit",
    "crossfit": "hiit", "walk": "walking", "walking": "walking", "hike": "hiking", "hiking": "hiking",
    "yoga": "yoga", "pilates": "pilates", "tennis": "tennis", "padel": "paddelball",
    "pickleball": "pickleball", "squash": "squash", "badminton": "badminton", "rowing": "rowing",
    "alpineski": "resort_skiing", "sail": "sailing", "elliptical": "elliptical",
    "stairstepper": "stair_climbing", "other": "other",
}


def word_type(word: str | None) -> str:
    w = re.sub(r"[\s_-]", "", (word or "").lower())
    return WORDS.get(w) or (re.sub(r"\W+", "_", (word or "").strip().lower()).strip("_") or "other")


def fit_type(sport: str | None, sub: str | None) -> str:
    return FIT_SPORT.get((sport, sub)) or FIT_SPORT.get((sport, None)) or word_type(sport)


# --- the shapes the engine reads ---------------------------------------------------------------------
DETAIL_KEYS = (("ts", "directTimestamp"), ("hr", "directHeartRate"), ("power", "directPower"),
               ("speed", "directSpeed"), ("elevation", "directElevation"), ("distance", "sumDistance"),
               ("lat", "directLatitude"), ("lon", "directLongitude"), ("cadence", None))


def details_payload(rows: list[dict], cadence_key: str) -> dict | None:
    """rows: [{ts (ms), hr, power, speed, elevation, distance, lat, lon, cadence}] → Garmin's details."""
    if not rows:
        return None
    present = [(k, g or cadence_key) for k, g in DETAIL_KEYS if any(r.get(k) is not None for r in rows)]
    return {"metricDescriptors": [{"metricsIndex": i, "key": g} for i, (_, g) in enumerate(present)],
            "activityDetailMetrics": [{"metrics": [r.get(k) for k, _ in present]} for r in rows]}


def _iso(t: dt.datetime | None) -> str | None:
    return t.strftime("%Y-%m-%d %H:%M:%S") if t else None


def summary(*, key: str, type_key: str, start_utc: dt.datetime, offset: dt.timedelta | None, name: str | None,
            elapsed: float | None, timer: float | None, distance: float | None, avg_hr=None, max_hr=None,
            avg_power=None, norm_power=None, ascent=None, calories=None, avg_speed=None, device=None,
            origin: str, source_file: str) -> dict:
    local = start_utc + offset if offset is not None else start_utc.astimezone().replace(tzinfo=None)
    if local.tzinfo is not None:
        local = local.replace(tzinfo=None)
    aid = sources.FILES_ID_BASE + int(hashlib.sha1(key.encode()).hexdigest(), 16) % 10 ** 15
    out = {"activityId": aid, "activityName": name or f"{type_key.replace('_', ' ').capitalize()}",
           "activityType": {"typeKey": type_key}, "startTimeLocal": _iso(local),
           "startTimeGMT": _iso(start_utc.replace(tzinfo=None)), "duration": timer or elapsed,
           "elapsedDuration": elapsed, "movingDuration": timer, "distance": distance, "averageHR": avg_hr,
           "maxHR": max_hr, "avgPower": avg_power, "normPower": norm_power, "elevationGain": ascent,
           "calories": calories, "averageSpeed": avg_speed, "deviceName": device,
           "source": "files", "origin": origin, "sourceFile": source_file, "sourceKey": key}
    return {k: v for k, v in out.items() if v is not None}


# --- FIT ------------------------------------------------------------------------------------------------
def _fit_dt(v) -> dt.datetime | None:
    if isinstance(v, dt.datetime):
        return v if v.tzinfo else v.replace(tzinfo=dt.timezone.utc)
    if isinstance(v, (int, float)):
        return FIT_EPOCH + dt.timedelta(seconds=v)
    return None


def _exercise_name(category: str | None, subtype) -> str | None:
    if category is None or subtype is None:
        return None
    from garmin_fit_sdk import Profile
    names = Profile["types"].get(f"{category}_exercise_name") or {}
    n = names.get(str(subtype))
    return n.upper() if n else None


def parse_fit(data: bytes) -> list[dict]:
    from garmin_fit_sdk import Decoder, Stream
    msgs, errors = Decoder(Stream.from_byte_array(bytearray(data))).read()
    if errors and not msgs.get("session_mesgs"):
        raise ValueError(f"not a readable FIT activity ({errors[0]})")
    sessions = msgs.get("session_mesgs") or []
    if not sessions:
        raise ValueError("a FIT file with no session (a course, a workout or settings, not an activity)")
    offset = None
    for act in msgs.get("activity_mesgs") or []:
        ts, lt = _fit_dt(act.get("timestamp")), act.get("local_timestamp")
        if ts and isinstance(lt, (int, float)):
            offset = dt.timedelta(seconds=round(((FIT_EPOCH + dt.timedelta(seconds=lt)) - ts).total_seconds() / 900) * 900)
    device = None
    for fid in msgs.get("file_id_mesgs") or []:
        device = " ".join(str(x) for x in (fid.get("manufacturer"), fid.get("garmin_product") or fid.get("product")) if x)
    records = msgs.get("record_mesgs") or []
    laps = msgs.get("lap_mesgs") or []
    sets = msgs.get("set_mesgs") or []
    out = []
    for s in sessions:
        start, end = _fit_dt(s.get("start_time")), _fit_dt(s.get("timestamp"))
        within = lambda m: start and (t := _fit_dt(m.get("timestamp") or m.get("start_time"))) and start <= t <= (end or t)  # noqa: E731
        tk = fit_type(s.get("sport"), s.get("sub_sport"))
        rows = []
        for r in (r for r in records if within(r)):
            lat, lon = r.get("position_lat"), r.get("position_long")
            rows.append({"ts": int(_fit_dt(r["timestamp"]).timestamp() * 1000), "hr": r.get("heart_rate"),
                         "power": r.get("power"), "speed": r.get("enhanced_speed", r.get("speed")),
                         "elevation": r.get("enhanced_altitude", r.get("altitude")), "distance": r.get("distance"),
                         "lat": lat * SEMICIRCLE if isinstance(lat, int) else None,
                         "lon": lon * SEMICIRCLE if isinstance(lon, int) else None,
                         "cadence": r.get("cadence")})
        lap_dtos = [{k: v for k, v in {
            "startTimeGMT": _iso(_fit_dt(lap.get("start_time"))), "duration": lap.get("total_timer_time"),
            "elapsedDuration": lap.get("total_elapsed_time"), "movingDuration": lap.get("total_timer_time"),
            "distance": lap.get("total_distance"), "averageHR": lap.get("avg_heart_rate"),
            "maxHR": lap.get("max_heart_rate"), "averageSpeed": lap.get("enhanced_avg_speed", lap.get("avg_speed")),
            "maxSpeed": lap.get("enhanced_max_speed", lap.get("max_speed")), "averagePower": lap.get("avg_power"),
            "maxPower": lap.get("max_power"), "normalizedPower": lap.get("normalized_power"),
            "elevationGain": lap.get("total_ascent"), "elevationLoss": lap.get("total_descent"),
            "intensityType": str(lap["intensity"]).upper() if lap.get("intensity") else None,
            "averageRunCadence" if tk.endswith(("running", "_run")) else "averageBikeCadence": lap.get("avg_cadence"),
        }.items() if v is not None} for lap in laps if within(lap)]
        set_dtos = []
        for st in (x for x in sets if within(x)):
            cat = st.get("category")
            cat = cat[0] if isinstance(cat, list) else cat
            sub = st.get("category_subtype")
            sub = sub[0] if isinstance(sub, list) else sub
            set_dtos.append({"setType": "ACTIVE" if st.get("set_type") == "active" else "REST",
                             "startTime": (_fit_dt(st.get("start_time")) or start).strftime("%Y-%m-%dT%H:%M:%S.0"),
                             "duration": st.get("duration"), "repetitionCount": st.get("repetitions"),
                             "weight": st["weight"] * 1000 if isinstance(st.get("weight"), (int, float)) else None,
                             "exercises": [{"category": str(cat).upper() if cat else None,
                                            "name": _exercise_name(cat, sub)}] if cat else []})
        out.append({"summary": dict(type_key=tk, start_utc=start, offset=offset, elapsed=s.get("total_elapsed_time"),
                                    timer=s.get("total_timer_time"), distance=s.get("total_distance"),
                                    avg_hr=s.get("avg_heart_rate"), max_hr=s.get("max_heart_rate"),
                                    avg_power=s.get("avg_power"), norm_power=s.get("normalized_power"),
                                    ascent=s.get("total_ascent"), calories=s.get("total_calories"),
                                    avg_speed=s.get("enhanced_avg_speed", s.get("avg_speed")), device=device),
                    "rows": rows, "laps": lap_dtos, "sets": set_dtos,
                    "cadence_key": "directRunCadence" if tk.endswith(("running", "_run")) else "directBikeCadence"})
    return out


# --- GPX and TCX ----------------------------------------------------------------------------------------
def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _xml_time(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    t = dt.datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def _num(s):
    try:
        return float(s) if s not in (None, "") else None
    except ValueError:
        return None


def _rows_summary(rows, type_key, name):
    """A summary for a file that only has points: duration from the clock, HR and power averaged."""
    t0, t1 = rows[0]["ts"], rows[-1]["ts"]
    hrs = [r["hr"] for r in rows if r.get("hr")]
    pw = [r["power"] for r in rows if r.get("power") is not None]
    dist = next((r["distance"] for r in reversed(rows) if r.get("distance") is not None), None)
    if dist is None and any(r.get("lat") is not None for r in rows):
        dist, prev = 0.0, None
        for r in rows:
            if r.get("lat") is None:
                continue
            if prev:
                dist += _haversine(prev, (r["lat"], r["lon"]))
            prev = (r["lat"], r["lon"])
            r["distance"] = round(dist, 1)
    ele = [r["elevation"] for r in rows if r.get("elevation") is not None]
    gain = sum(max(0.0, b - a) for a, b in zip(ele, ele[1:])) if ele else None
    secs = (t1 - t0) / 1000
    return dict(type_key=type_key, start_utc=dt.datetime.fromtimestamp(t0 / 1000, dt.timezone.utc), offset=None,
                name=name, elapsed=secs, timer=secs, distance=dist,
                avg_hr=round(sum(hrs) / len(hrs)) if hrs else None, max_hr=max(hrs) if hrs else None,
                avg_power=round(sum(pw) / len(pw)) if pw else None,
                ascent=round(gain) if gain is not None else None,
                avg_speed=dist / secs if dist and secs else None)


def _haversine(a, b) -> float:
    import math
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def parse_gpx(text: str) -> list[dict]:
    root = ET.fromstring(text)
    out = []
    for trk in (e for e in root.iter() if _local(e.tag) == "trk"):
        name = next((e.text for e in trk if _local(e.tag) == "name"), None)
        typ = next((e.text for e in trk if _local(e.tag) == "type"), None)
        rows = []
        for pt in (e for e in trk.iter() if _local(e.tag) == "trkpt"):
            vals = {_local(c.tag): c.text for c in pt.iter()}
            t = _xml_time(vals.get("time"))
            if not t:
                continue
            rows.append({"ts": int(t.timestamp() * 1000), "lat": _num(pt.get("lat")), "lon": _num(pt.get("lon")),
                         "elevation": _num(vals.get("ele")), "hr": _num(vals.get("hr")),
                         "cadence": _num(vals.get("cad")), "power": _num(vals.get("power") or vals.get("PowerInWatts"))})
        if rows:
            tk = word_type(typ)
            out.append({"summary": _rows_summary(rows, tk, name), "rows": rows, "laps": [], "sets": [],
                        "cadence_key": "directRunCadence" if tk.endswith(("running", "_run")) else "directBikeCadence"})
    if not out:
        raise ValueError("a GPX file with no timed track points (a route, not a recorded activity)")
    return out


def parse_tcx(text: str) -> list[dict]:
    root = ET.fromstring(text)
    out = []
    for act in (e for e in root.iter() if _local(e.tag) == "Activity"):
        tk = word_type(act.get("Sport"))
        rows, laps = [], []
        for lap in (e for e in act if _local(e.tag) == "Lap"):
            f = {_local(c.tag): c for c in lap}
            hr = lambda key: _num(next((x.text for x in f[key].iter() if _local(x.tag) == "Value"), None)) if key in f else None  # noqa: E731
            laps.append({k: v for k, v in {
                "startTimeGMT": _iso(_xml_time(lap.get("StartTime"))), "duration": _num(getattr(f.get("TotalTimeSeconds"), "text", None)),
                "distance": _num(getattr(f.get("DistanceMeters"), "text", None)),
                "averageHR": hr("AverageHeartRateBpm"), "maxHR": hr("MaximumHeartRateBpm"),
                "intensityType": (getattr(f.get("Intensity"), "text", "") or "").upper() or None}.items() if v is not None})
            for tp in (e for e in lap.iter() if _local(e.tag) == "Trackpoint"):
                vals = {}
                for c in tp.iter():
                    vals.setdefault(_local(c.tag), c.text)
                t = _xml_time(vals.get("Time"))
                if not t:
                    continue
                rows.append({"ts": int(t.timestamp() * 1000), "lat": _num(vals.get("LatitudeDegrees")),
                             "lon": _num(vals.get("LongitudeDegrees")), "elevation": _num(vals.get("AltitudeMeters")),
                             "distance": _num(vals.get("DistanceMeters")), "hr": _num(vals.get("Value")),
                             "cadence": _num(vals.get("Cadence") or vals.get("RunCadence")),
                             "speed": _num(vals.get("Speed")), "power": _num(vals.get("Watts"))})
        if rows:
            s = _rows_summary(rows, tk, None)
            if laps:
                s["timer"] = sum(lap.get("duration") or 0 for lap in laps) or s["timer"]
                s["distance"] = sum(lap.get("distance") or 0 for lap in laps) or s["distance"]
            out.append({"summary": s, "rows": rows, "laps": laps, "sets": [],
                        "cadence_key": "directRunCadence" if tk.endswith(("running", "_run")) else "directBikeCadence"})
    if not out:
        raise ValueError("a TCX file with no recorded activity")
    return out


def parse(name: str, data: bytes) -> list[dict]:
    lower = name.lower()
    if lower.endswith(".gz"):
        data, lower = gzip.decompress(data), lower[:-3]
    if lower.endswith(".fit"):
        return parse_fit(data)
    text = data.decode("utf-8-sig", "replace").lstrip()
    if lower.endswith(".gpx"):
        return parse_gpx(text)
    if lower.endswith(".tcx"):
        return parse_tcx(text)
    raise ValueError("not a FIT, GPX or TCX file")


# --- inputs -------------------------------------------------------------------------------------------
def _activity_file(name: str) -> bool:
    n = name.lower().removesuffix(".gz")
    return n.endswith(SUFFIXES)


def _strava_index(csv_text: str) -> dict[str, dict]:
    """activities.csv of Strava's bulk export → {file name in the archive: {name, type}}."""
    out = {}
    for row in csv.DictReader(io.StringIO(csv_text)):
        fn = (row.get("Filename") or "").strip()
        if fn:
            out[fn] = {"name": (row.get("Activity Name") or "").strip() or None,
                       "type": (row.get("Activity Type") or "").strip() or None}
    return out


def inputs(paths: list[Path]):
    """Yield (display name, bytes, origin, strava metadata or None) for every activity file found."""
    for p in paths:
        p = p.expanduser()
        if p.is_file() and zipfile.is_zipfile(p):
            with zipfile.ZipFile(p) as z:
                names = z.namelist()
                meta = {}
                csvs = [n for n in names if n.rsplit("/", 1)[-1] == "activities.csv"]
                if csvs:
                    meta = _strava_index(z.read(csvs[0]).decode("utf-8-sig", "replace"))
                for n in names:
                    if _activity_file(n):
                        rel = n.split("/", 1)[1] if "/" in n and not n.startswith("activities/") and \
                            n.split("/", 1)[1].startswith("activities/") else n
                        yield f"{p.name}:{n}", z.read(n), "strava-export" if csvs else "zip", meta.get(rel)
        elif p.is_dir():
            meta = {}
            if (p / "activities.csv").is_file():
                meta = _strava_index((p / "activities.csv").read_text(encoding="utf-8-sig", errors="replace"))
            for f in sorted(x for x in p.rglob("*") if x.is_file() and _activity_file(x.name)):
                rel = str(f.relative_to(p))
                yield rel, f.read_bytes(), "strava-export" if meta else "folder", meta.get(rel)
        elif p.is_file() and _activity_file(p.name):
            yield p.name, p.read_bytes(), "file", None
        elif p.exists():
            print(f"  skipped {p.name}: not a FIT, GPX, TCX or zip", file=sys.stderr)
        else:
            print(f"  skipped {p}: no such file or folder", file=sys.stderr)


# --- the import -------------------------------------------------------------------------------------
def run(a: athlete.Athlete, paths: list[Path], since: dt.date | None = None) -> dict:
    cache = a.data_dir
    cache.mkdir(parents=True, exist_ok=True)
    summary_path = cache / sources.SUMMARY_FILE["files"]
    try:
        have = json.loads(summary_path.read_text())
    except (OSError, ValueError):
        have = []
    known = {x.get("sourceKey") for x in have}
    added, skipped, failed = [], 0, []
    for name, data, origin, meta in inputs(paths):
        digest = hashlib.sha1(data).hexdigest()
        try:
            parsed = parse(name, data)
        except (ValueError, ET.ParseError, OSError, EOFError) as e:
            failed.append(f"{name}: {e}")
            continue
        for i, act in enumerate(parsed):
            key = f"{digest}:{i}"
            if key in known:
                skipped += 1
                continue
            s = {"name": None, **act["summary"]}
            if since and s["start_utc"].date() < since:
                continue
            if meta:  # Strava's own name and type, which the file does not carry
                s["name"] = meta.get("name") or s.get("name")
                if meta.get("type") and s["type_key"] in ("other", "cycling", "running", "cardio_training"):
                    t = word_type(meta["type"])
                    s["type_key"] = s["type_key"] if t == "other" else t
            row = summary(key=key, origin=origin, source_file=name.rsplit("/", 1)[-1], **s)
            aid = row["activityId"]
            det = details_payload(act["rows"], act["cadence_key"])
            if det:
                (cache / f"activity_{aid}_details.json").write_text(json.dumps(det) + "\n")
            if act["laps"]:
                (cache / f"activity_{aid}_splits.json").write_text(json.dumps({"lapDTOs": act["laps"]}, indent=1) + "\n")
            if act["sets"]:
                (cache / f"activity_{aid}_sets.json").write_text(json.dumps({"exerciseSets": act["sets"]}, indent=1) + "\n")
            have.append(row)
            known.add(key)
            added.append(row)
    have.sort(key=lambda x: x.get("startTimeLocal") or "")
    summary_path.write_text(json.dumps(have, indent=2, default=str) + "\n")
    dropped = sources.reconcile(a)
    return {"added": added, "already": skipped, "failed": failed, "duplicates_removed": dropped}


def main() -> int:
    a = athlete.current()   # first: it takes --athlete off the command line
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="*", type=Path, help="files, folders or zips (default: data/<name>/inbox/)")
    ap.add_argument("--since", type=dt.date.fromisoformat, help="only sessions from this date (YYYY-MM-DD)")
    args = ap.parse_args()
    paths = args.paths or [a.data_dir / "inbox"]
    if not args.paths:
        (a.data_dir / "inbox").mkdir(parents=True, exist_ok=True)
    got = run(a, paths, args.since)
    by: dict[str, int] = {}
    for r in got["added"]:
        by[r["activityType"]["typeKey"]] = by.get(r["activityType"]["typeKey"], 0) + 1
    print(f"imported {len(got['added'])} session(s)" + (": " + ", ".join(f"{k}={v}" for k, v in sorted(by.items())) if by else "")
          + f"; {got['already']} already imported; {len(got['duplicates_removed'])} duplicate(s) of another source removed")
    if got["failed"]:
        print("NOT IMPORTED — say so, never guess what they held:", file=sys.stderr)
        for f in got["failed"]:
            print(f"  - {f}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
