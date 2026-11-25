#!/usr/bin/env python3
"""Everything measurable about one ride or run — deterministic, no model (docs/DESIGN.md (rides and runs) §2.3).

The app's workout view and the endurance review both read this, so a number the coach cites is the
number the page shows. Every metric carries its source: `garmin` when Garmin sent it, `computed`
when formulas.py derived it — Garmin's value wins wherever both exist.

Usage: python scripts/endurance_metrics.py <activity_id> [--json]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

A = athlete.current()
import export_dashboard_data as ed  # noqa: E402
import formulas as f  # noqa: E402
import sources  # noqa: E402
import sports  # noqa: E402

STREAM_POINTS = 600    # what the page draws
ROUTE_POINTS = 800
BEST_POWER_S = (5, 60, 300, 1200, 3600)
BEST_RUN_M = (1000, 5000, 10000)
MIN_DECOUPLING_S = 40 * 60   # shorter than this, half-vs-half says nothing about aerobic durability

# Garmin detail channel → our name. Cadence comes under different keys per sport.
CHANNELS = {"directTimestamp": "ts", "directHeartRate": "hr", "directPower": "power", "directSpeed": "speed",
            "directElevation": "elevation", "sumDistance": "distance", "directLatitude": "lat",
            "directLongitude": "lon", "directBikeCadence": "cadence", "directRunCadence": "cadence",
            "directDoubleCadence": "cadence"}


def m(value, source: str, unit: str = "", digits: int = 0) -> dict | None:
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return None
    return {"value": round(value, digits) if digits else round(value), "source": source, "unit": unit}


def streams(details: dict | None) -> dict:
    """Aligned channels from a details payload; t = seconds from the start."""
    if not details:
        return {}
    idx = {CHANNELS[d["key"]]: d["metricsIndex"] for d in details.get("metricDescriptors") or []
           if d.get("key") in CHANNELS}
    rows = [r.get("metrics") or [] for r in details.get("activityDetailMetrics") or []]
    if "ts" not in idx or not rows:
        return {}
    get = lambda r, k: r[idx[k]] if k in idx and len(r) > idx[k] else None  # noqa: E731
    rows = [r for r in rows if get(r, "ts")]
    t0 = get(rows[0], "ts")
    out = {"t": [(get(r, "ts") - t0) / 1000 for r in rows]}
    for k in ("hr", "power", "speed", "elevation", "distance", "lat", "lon", "cadence"):
        if k in idx:
            vals = [get(r, k) for r in rows]
            if any(v is not None for v in vals):
                out[k] = vals
    return out


def thresholds() -> dict:
    """FTP and threshold HR: the athlete's own values in athlete.json → profile win (D2), else
    Garmin's (thresholds.json, pulled weekly). None when neither exists — never a default.

    Garmin's values are read at their exact paths — `ftp.functionalThresholdPower` and
    `lactate.speed_and_heart_rate.heartRate`, confirmed on real payloads 2026-10-10 — never by
    searching for a key name, which could pick up some other heart rate (docs/DESIGN.md (app audit) L5)."""
    prof = A.profile or {}
    cached = ed.load("thresholds.json") or {}
    ftp_payload = cached.get("ftp")
    if isinstance(ftp_payload, list):
        ftp_payload = ftp_payload[0] if ftp_payload else None
    garmin_ftp = (ftp_payload or {}).get("functionalThresholdPower") if isinstance(ftp_payload, dict) else None
    garmin_lthr = ((cached.get("lactate") or {}).get("speed_and_heart_rate") or {}).get("heartRate")
    ftp, ftp_src = (prof["ftp_w"], "athlete.json") if prof.get("ftp_w") else (garmin_ftp, "garmin")
    lthr, lthr_src = (prof["threshold_hr"], "athlete.json") if prof.get("threshold_hr") else (garmin_lthr, "garmin")
    ok = lambda v: isinstance(v, (int, float)) and v > 0  # noqa: E731
    return {"ftp": {"value": ftp, "source": ftp_src} if ok(ftp) else None,
            "threshold_hr": {"value": lthr, "source": lthr_src} if ok(lthr) else None}


def zones(payload, unit: str, total_s: float | None = None) -> list:
    """Garmin's per-activity zones → [{zone, low, high, secs, pct}]; the next zone's low is this
    one's high. Bounds are THIS activity's — run and bike HR zones differ.

    `pct` is a share of the SESSION when `total_s` is given. Garmin counts no time under zone 1, so
    the zones of an easy ride sum to far less than the ride (2026-11-07: 76 of 198 minutes), and a
    share of that sum printed "Z1 98 %" for 38 % of the ride (app audit 2026-11-10)."""
    rows = payload if isinstance(payload, list) else (payload or {}).get("zones") or []
    rows = sorted((r for r in rows if isinstance(r, dict) and r.get("zoneNumber") is not None),
                  key=lambda r: r["zoneNumber"])
    total = max(sum(r.get("secsInZone") or 0 for r in rows), total_s or 0) or 1
    return [{"zone": r["zoneNumber"], "low": r.get("zoneLowBoundary"),
             "high": rows[i + 1].get("zoneLowBoundary") if i + 1 < len(rows) else None,
             "secs": round(r.get("secsInZone") or 0), "pct": round(100 * (r.get("secsInZone") or 0) / total),
             "unit": unit} for i, r in enumerate(rows)]


def smoothed(s: dict, p1: list[float]) -> dict:
    """`power_30s`: the 30-second rolling power (formulas.rolling_seconds — NP's own first step),
    taken from the FULL 1 Hz stream at each sample's time, before the page's ~600-point thinning.
    2026-10-11: the page used to average neighbouring points of the thinned stream — on a two-hour
    ride that was three points, not thirty seconds, and the toggle changed almost nothing."""
    if not p1 or "power" not in s:
        return {}
    roll = f.rolling_seconds(p1)
    t0 = int(next(t for t, v in zip(s["t"], s["power"]) if t is not None and v is not None))
    at = lambda t: roll[int(t) - t0] if t is not None and 0 <= int(t) - t0 < len(roll) else None  # noqa: E731
    return {"power_30s": [None if v is None else at(t) for t, v in zip(s["t"], s["power"])]}


def _downsample(s: dict, n: int, outdoors: bool) -> dict:
    """Every channel at the same ~600 points. Outdoors, lat/lon come along, so the route line and the
    charts share an index (one hover moves both); a virtual session's fictional ones never do."""
    step = max(1, math.ceil(len(s.get("t", [])) / n))
    digits = {"speed": 2, "distance": 1, "lat": 5, "lon": 5}
    return {k: [None if v is None else round(v, digits.get(k, 0)) for v in vals[::step]]
            for k, vals in s.items() if k != "ts" and (outdoors or k not in ("lat", "lon"))}


def route(details: dict | None, s: dict, type_key: str) -> list | None:
    """[[lat, lon]] for the map, or None — virtual sessions have fictional coordinates."""
    if not sports.outdoors(type_key) or not details:
        return None
    poly = (details.get("geoPolylineDTO") or {}).get("polyline") or []
    pts = [[p["lat"], p["lon"]] for p in poly if p.get("lat") is not None and p.get("lon") is not None]
    if not pts and "lat" in s:
        pts = [[a, b] for a, b in zip(s["lat"], s["lon"]) if a is not None and b is not None]
    step = max(1, math.ceil(len(pts) / ROUTE_POINTS))
    return [[round(a, 5), round(b, 5)] for a, b in pts[::step]] or None


def _f_to_c(f) -> float | None:
    return round((f - 32) * 5 / 9, 1) if isinstance(f, (int, float)) else None


def weather(w: dict | None) -> dict | None:
    """Garmin's weather for the session, in Celsius. The payload's `temp`, `apparentTemp` and
    `dewPoint` carry no unit and are FAHRENHEIT: on 2026-10-10 an October ride showed "59 °C" when it
    was read as Celsius (docs/DESIGN.md (app audit) M5; 59 °F = 15 °C). A temperature outside -40…50 °C after
    conversion is no reading at all — dropped, never shown. The station's coordinates are dropped too."""
    if not w:
        return None
    temp_c = _f_to_c(w.get("temp"))
    if temp_c is None or not -40 <= temp_c <= 50:
        return None
    desc = (w.get("weatherTypeDTO") or {}).get("desc")
    return {"temp_c": temp_c, "feels_like_c": _f_to_c(w.get("apparentTemp")), "dew_point_c": _f_to_c(w.get("dewPoint")),
            "humidity_pct": w.get("relativeHumidity"), "conditions": desc, "source": "garmin"}


def run_bests(s: dict) -> dict:
    """Fastest time over each distance, from the distance stream (seconds)."""
    if "distance" not in s:
        return {}
    pts = [(t, d) for t, d in zip(s["t"], s["distance"]) if d is not None]
    out = {}
    for meters in BEST_RUN_M:
        best, j = None, 0
        for i in range(len(pts)):
            while j < len(pts) and pts[j][1] - pts[i][1] < meters:
                j += 1
            if j == len(pts):
                break
            dt_ = pts[j][0] - pts[i][0]
            best = dt_ if best is None or dt_ < best else best
        if best:
            out[f"{meters // 1000}k"] = round(best)
    return out


def analyse(aid: int) -> dict:
    a = next((x for x in ed.all_activities() if x.get("activityId") == aid), None)
    if a is None:
        sys.exit(f"no activity {aid} in the cache")
    tk = (a.get("activityType") or {}).get("typeKey", "")
    grp = sports.group(tk)
    full = (ed.load(f"activity_{aid}_full.json") or {}).get("summaryDTO") or {}
    details = ed.load(f"activity_{aid}_details.json")
    s = streams(details)
    th = thresholds()
    # FTP is a CYCLING threshold. A run with wrist power (Garmin's running power, ~400 W for him) is on
    # another scale entirely: scored against the bike's 254 W, his 11-17 5 km read IF 1.57 / TSS 103 and
    # zeroed its intent score. So a run has no FTP, and therefore no IF or TSS.
    if grp != "bike":
        th = th | {"ftp": None}
    ftp = (th["ftp"] or {}).get("value")
    secs = a.get("movingDuration") or a.get("duration") or 0
    g = lambda *keys: next((v for k in keys for v in [full.get(k), a.get(k)] if v is not None), None)  # noqa: E731

    # Measured numbers name the record's real source: Garmin's own, a file the athlete exported, or Strava's.
    rs = {"garmin": "garmin", "files": "file", "strava": "strava"}[sources.source_of(a)]
    p1 = f.resample_1hz(s["t"], s["power"]) if "power" in s else []
    met: dict = {}
    avg_p = g("averagePower", "avgPower")
    if avg_p:
        met["avg_power"] = m(avg_p, rs, "W")
        np_g = g("normalizedPower", "normPower")
        np_c = f.normalized_power(p1) if p1 else None
        np_w, np_src = (np_g, rs) if np_g else (np_c, "computed")
        met["np"] = m(np_w, np_src, "W")
        if np_w:
            met["vi"] = m(np_w / avg_p, "computed", "", 2)
            # Garmin's IF and TSS are scored against GARMIN's FTP. Once the athlete's own FTP wins
            # (athlete.json), Garmin's pair answers a different question and is never shown: his
            # 10-31 ride read IF 0.70 / TSS 214 off 290 W when his tested 254 says 0.80 / ~279.
            if_g, tss_g = (g("intensityFactor"), g("trainingStressScore")) if (th["ftp"] or {}).get("source") == "garmin" else (None, None)
            if ftp:
                met["if"] = m(if_g, rs, "", 2) if if_g else m(f.intensity_factor(np_w, ftp), "computed", "", 2)
                met["tss"] = m(tss_g, rs) if tss_g else m(f.tss(secs, np_w, ftp), "computed")
        # Work: average power × moving time. (Garmin's totalWork has no documented unit — not guessed.)
        met["kj"] = m(avg_p * secs / 1000, "computed", "kJ") if secs else None
    met["avg_hr"] = m(g("averageHR"), rs, "bpm")
    met["max_hr"] = m(g("maxHR"), rs, "bpm")
    spd = g("averageSpeed")
    if grp == "run":
        met["pace"] = m(1000 / spd if spd else None, rs, "s/km")
        gap = g("avgGradeAdjustedSpeed")
        met["gap"] = m(1000 / gap if gap else None, rs, "s/km")
        met["cadence"] = m(g("averageRunningCadenceInStepsPerMinute", "averageRunCadence"), rs, "spm")
        met["stride"] = m(g("avgStrideLength", "strideLength"), rs, "cm")
        met["gct"] = m(g("avgGroundContactTime", "groundContactTime"), rs, "ms")
        met["vo"] = m(g("avgVerticalOscillation", "verticalOscillation"), rs, "cm", 1)
    else:
        met["speed"] = m(spd * 3.6 if spd else None, rs, "km/h", 1)
        met["cadence"] = m(g("averageBikingCadenceInRevPerMinute", "averageBikeCadence"), rs, "rpm")
    met["elevation_gain"] = m(g("elevationGain"), rs, "m")

    # The aerobic signal. Output per beat: power on a bike that has it, else speed (a run, an
    # rides) — and the basis travels with the number, because they are not comparable.
    basis = "power" if grp == "bike" and "power" in s else "speed" if "speed" in s else None
    if basis and "hr" in s:
        out1 = f.resample_1hz(s["t"], s[basis])
        hr1 = f.resample_1hz(s["t"], s["hr"])
        n = min(len(out1), len(hr1))
        moving = [(o, h) for o, h in zip(out1[:n], hr1[:n]) if o > (0.5 if basis == "speed" else 0) and h > 0]
        if len(moving) >= MIN_DECOUPLING_S:
            dc = f.decoupling([o for o, _ in moving], [h for _, h in moving])
            met["decoupling"] = m(dc, "computed", "%", 1) | {"basis": basis} if dc is not None else None
    if met.get("avg_hr"):
        hr_avg = met["avg_hr"]["value"]
        if basis == "power" and met.get("np"):
            met["ef"] = m(f.efficiency_factor(met["np"]["value"], hr_avg), "computed", "", 2) | {"basis": "power"}
        elif spd:
            met["ef"] = m(f.efficiency_factor(spd * 60, hr_avg), "computed", "", 2) | {"basis": "speed"}

    flags = []
    dc = (met.get("decoupling") or {}).get("value")
    if dc is not None and dc > 5:
        flags.append({"key": "decoupling", "text": f"Decoupling {dc} % — output per heartbeat fell in the second half."})

    laps = (ed.load(f"activity_{aid}_splits.json") or {}).get("lapDTOs") or []
    # `n` is the key a review cites (intervals.<n>.<field>, app_contracts.resolve), the same as a swim's
    # rep or a circuit's step; `lap` stays for readers of the old name. Until 2026-11-25 a ride or run's
    # laps carried only `lap`, so no review could cite one and the lap table lived outside the check.
    def interval(i: int, lap: dict) -> dict:
        secs, metres = lap.get("duration") or 0, lap.get("distance") or 0
        row = {"n": i + 1, "lap": i + 1, "type": lap.get("intensityType"), "secs": round(secs),
               "metres": round(metres), "power": lap.get("averagePower"), "hr": lap.get("averageHR")}
        if grp == "run" and metres > 0 and secs > 0:
            row["pace"] = round(secs / metres * 1000)   # s/km, the lap's own (Garmin's duration ÷ distance)
        return row
    intervals = [interval(i, lap) for i, lap in enumerate(laps) if lap.get("intensityType")]

    return {
        "id": aid, "sport": grp, "type": tk, "virtual": tk in sports.VIRTUAL, "outdoors": sports.outdoors(tk),
        "metrics": {k: v for k, v in met.items() if v},
        "thresholds": th,
        "zones": (lambda hz: {"hr": hz,
                              # the session's time under zone 1, which Garmin puts in no zone
                              "hr_below_s": max(0, round((a.get("duration") or 0) - sum(z["secs"] for z in hz))) if hz else None,
                              "power": zones(ed.load(f"activity_{aid}_powerzones.json"), "W")})(
            zones(ed.load(f"activity_{aid}_hrzones.json"), "bpm", a.get("duration"))),
        "bests": ({f"{d}s": round(v) for d in BEST_POWER_S if (v := f.best_mean(p1, d))} if p1 else {}) | (
            run_bests(s) if grp == "run" else {}),
        "intervals": intervals if len({x["type"] for x in intervals}) > 1 else [],
        "streams": _downsample(s | smoothed(s, p1), STREAM_POINTS, sports.outdoors(tk)) if s else {},
        "route": route(details, s, tk),
        "weather": weather(ed.load(f"activity_{aid}_weather.json")),
        "flags": flags,
        "definitions": f.ENDURANCE_DEFINITIONS,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("activity_id", type=int)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    out = analyse(args.activity_id)
    if args.json:
        print(json.dumps(out, indent=1, default=str))
        return
    print(f"{A.display} · activity {out['id']} · {out['type']}{' (virtual)' if out['virtual'] else ''}")
    for k, v in out["metrics"].items():
        print(f"  {k:16} {v['value']} {v['unit']}  [{v['source']}{', ' + v['basis'] if 'basis' in v else ''}]")
    if out["bests"]:
        print("  bests           " + ", ".join(f"{k} {v}" for k, v in out["bests"].items()))
    for fl in out["flags"]:
        print(f"  ! {fl['text']}")


if __name__ == "__main__":
    main()
