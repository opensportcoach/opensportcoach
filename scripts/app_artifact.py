#!/usr/bin/env python3
"""The app's lite page: the athlete's daily briefing as one static HTML page, published as a claude.ai
artifact so they can read it away from the Mac.

    .venv/bin/python scripts/app_artifact.py build                 (as the bound athlete)
    .venv/bin/python scripts/app_artifact.py build --fixture app/fixtures/demo --out <file.html>
    .venv/bin/python scripts/app_artifact.py record <claude.ai artifact url>
    .venv/bin/python scripts/app_artifact.py status

WHY (2026-10-26). The app is localhost-only: it exists while a coach.sh session runs, on the Mac.
An athlete asked for a lite version inside Claude, readable from a phone, republished to the same URL
after every daily (/osc-daily, step 6).

A PHONE BRIEFING, NOT A PORT (his ask, 2026-11-01: "could be drastically improved"). The first version
ported the app's desktop Today screen, which on a phone opened on a screen of prose, scrolled the week
sideways and stopped at today. This one follows the athlete's own brief order (athletes/<name>/ATHLETE.md):
the call → the KPI strip → GYM and CARDIO with the cardio pips → the next seven days → the plots →
the program's numbers to beat → the race season. It keeps the app's tokens, fonts and thresholds, and
its words where the app has them (Today.tsx, Program.tsx). Sections are reached by anchor links.

RULES THIS FILE KEEPS
  * Read-only, by construction. The page has no script, no form and no button: it can't send to the
    watch, accept a plan or answer a question — the confirm gate is a click in the app, and nothing
    here can produce one. It says where those things happen instead.
  * The numbers are the engine's. Everything comes from app_data.py's views (VIEWS) through lite():
    one whitelist of what leaves the Mac — no activity or workout ids, no Garmin account. No formula
    lives here: the page arranges, it never computes a metric.
  * Gym progress is what he trains NOW — the program's exercises — never the strength view's PR
    board, which still carries lifts removed for medical reasons.
  * Opt-in, per athlete. It puts health data on claude.ai (private by default, but off the Mac), so
    `build` refuses until athlete.json carries `app.artifact_opt_in` — the date they said yes.
  * One athlete per page. The page and its URL live under that athlete's data/<name>/app/ (gitignored),
    resolved by athlete.py; --fixture builds the synthetic Demo athlete's page with no athlete at all.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import html
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

URL_RE = re.compile(r"^https://claude\.ai/(code/)?artifact/[A-Za-z0-9-]{8,64}$")
VIEWS = ("today", "recovery", "program", "races", "calendar")
AHEAD = 7   # days in the agenda, today included


# --- what leaves the Mac -----------------------------------------------------------------------
def _pick(d: dict | None, *keys: str) -> dict:
    return {k: (d or {}).get(k) for k in keys}


def _badge(b: dict | None) -> dict:
    return _pick(b, "sport", "icon", "kind")


def _exercise(e: dict) -> dict:
    return {**_pick(e, "routine", "label", "sets", "value", "weight", "kind", "base", "per_side", "per_hand", "load", "phase",
                    "note", "range", "next_weight", "trend", "trend_score"),
            "audit": e.get("audit") and _pick(e["audit"], "status", "impossible", "abandoned", "skipped", "implied_e1rm", "best_e1rm", "sessions", "last")}


def _race(r: dict) -> dict:
    w = r.get("windows") or {}
    return {**_pick(r, "id", "name", "kind_label", "icon", "priority", "entry", "date", "dow", "start", "days_to", "past"),
            "target": (r.get("target") or {}).get("under"), "city": (r.get("where") or {}).get("city"),
            "windows": {"before": _pick(w.get("before"), "window", "from", "to"), "recovery": _pick(w.get("recovery"), "from", "to"),
                        "text": w.get("text")},
            "result": r.get("result") and _pick(r["result"], "time", "vs_target_s")}


def lite(vs: dict) -> dict:
    """The app's views, cut down to what the page shows. Nothing else reaches the HTML."""
    v, rv, pv, races, cal = ({**(vs.get(k) or {})} for k in VIEWS)
    today, night, daily = v.get("today") or {}, v.get("night") or {}, v.get("daily") or None
    ln, body, wc = v.get("last_night") or None, v.get("body") or None, v.get("week_compare") or {}
    day = (v.get("generated_at") or dt.datetime.now().isoformat())[:10]
    end = (dt.date.fromisoformat(day) + dt.timedelta(days=AHEAD - 1)).isoformat()
    ahead = lambda x: day <= (x.get("date") or "") <= end  # noqa: E731
    lead = lambda d: d if isinstance(d, list) else (d or {}).get("block") or []  # noqa: E731
    this = wc.get("this") or {}
    return {
        "day": day,
        "snapshot_at": v.get("generated_at"),
        "freshness": _pick(v.get("freshness"), "data_as_of", "coach_ran", "warnings"),
        "block": v.get("block"),
        "daily": daily and {
            **_pick(daily, "date", "generated_at", "notes"),
            "recommendation": daily.get("recommendation"),
            "feel": _pick(daily.get("feel"), "answer", "note"),
            "pending": [_pick(p, "kind", "text", "options", "bump") for p in daily.get("pending") or []],
            "endurance": [_pick(x, "sport", "title", "line", "flag") for x in daily.get("endurance") or []]},
        "trained_today": [_pick(w, "kind", "title", "start", "durationMin", "sets", "tonnage", "distanceKm") for w in v.get("trained_today") or []],
        "plan_today": _pick(v.get("plan_today"), "name", "day", "done"),
        "call_day": (v.get("call_program") or {}).get("key"),
        "today": {"date": today.get("date"), "readiness": _pick(today.get("readiness"), "score", "level"),
                  "hrv": _pick(today.get("hrv"), "value", "bandLow", "bandHigh"), "rhr": _pick(today.get("rhr"), "value", "baseline"),
                  "sleep": _pick(today.get("sleep"), "score", "hours"), **_pick(today, "fitness", "fatigue", "form")},
        "night": {"recoveryScore": night.get("recoveryScore"),
                  "components": [_pick(c, "label", "state") for c in night.get("components") or []],
                  "sleep": _pick(night.get("sleep"), "performancePct", "needH", "debt7dH", "efficiencyPct", "bedtime", "waketime")},
        "last_night": ln and _pick(ln, "start", "end", "asleep_min", "need_min", "score", "length_min", "totals_min", "segments"),
        "vitals": [_pick(x, "hrv", "hrv_7d", "rhr", "rhr_7d") for x in v.get("vitals") or []],
        "readiness_30": [x.get("readiness") for x in (v.get("trends") or {}).get("recovery") or []],
        "form_spark": list((v.get("spark") or {}).get("form") or []),
        "body": body and {**_pick(body, "latestKg", "targetLow", "targetHigh", "daysSince"),
                          "series": [_pick(x, "date", "kg") for x in body.get("series") or []]},
        "cardio": _pick(v.get("cardio"), "sessions", "load"),
        "week_strength": _pick(v.get("week_strength"), "sessions", "sets", "tonnage"),
        "week": {"this": _pick(this.get("to_date"), "sets", "tonnage", "cardio_load", "km_by"),
                 "last": _pick((wc.get("last") or {}).get("to_date"), "sets", "tonnage", "cardio_load", "km_by"),
                 "cut": wc.get("cut"),
                 "days": [{**_pick(d, "date", "dow"),
                           "sports": [_pick(s, "title", "icon", "kind", "min", "km", "sets") for s in d.get("sports") or []]}
                          for d in this.get("days") or []]},
        "sync": [_pick(w, "key", "workout", "state") for w in (v.get("sync") or {}).get("workouts") or []],
        "sync_unknown": (v.get("sync") or {}).get("unknown"),
        "bumps": [_pick(b, "day", "exid", "sets_done", "reps_target", "label", "earned_on") for b in v.get("bumps") or []],
        "starved": [_pick(x, "day", "label", "age") for x in (v.get("rotation") or {}).get("days") or [] if x.get("starved")],
        "agenda": {
            "scheduled": [{**_pick(s, "date", "title", "done"), "badge": _badge(s.get("badge"))} for s in cal.get("scheduled") or [] if ahead(s)],
            "planned": [{**_pick(p, "date", "title", "detail", "done", "duration_min"), "on_watch": bool(p.get("workout")),
                         "badge": _badge(p.get("badge")),
                         # The Zwift workout to open in Zwift's menu: its name and its public page (2026-11-05).
                         "zwift_workout": _pick(p["zwift_workout"], "name", "url", "collection", "duration_min") if p.get("zwift_workout") else None}
                        for p in cal.get("planned") or [] if ahead(p)],
            "done": [{**_pick(x, "date", "title"), "badge": _badge(x)} for x in cal.get("done") or [] if ahead(x)],
            "race_days": [{**_pick(x, "date", "window", "day", "of"), "race": _pick(x.get("race"), "name", "start")}
                          for x in cal.get("race_days") or [] if ahead(x)]},
        "recovery": {
            "series": [_pick(x, "date", "hrv", "hrv_7d", "hrv_low", "hrv_high", "rhr", "rhr_7d", "sleep_h", "need_h")
                       for x in (rv.get("series") or [])[-30:]],
            "scores": [_pick(x, "date", "score") for x in (rv.get("calendar") or [])[-30:]]},
        "program": {
            "days": [{**_pick(d, "key", "name", "est_min"), "rotation": _pick(d.get("rotation"), "last", "age", "starved"),
                      "lead": [x.get("routine") or x.get("label") for x in lead(d.get("lead"))],
                      "exercises": [_exercise(e) for e in d.get("exercises") or []]} for d in pv.get("days") or []],
            "benchmarks": [{**_pick(b, "name", "unit", "next", "overdue", "retest", "last"), "badge": _badge(b.get("badge"))}
                           for b in pv.get("benchmarks") or []],
            # His template week by weekday: what a coming day holds before a week is planned onto it.
            "template": {d["dow"]: [{**_pick(x, "title", "detail", "duration"), "badge": _badge(x.get("badge"))} for x in d.get("sessions") or []]
                         for d in (pv.get("week") or {}).get("days") or [] if d.get("dow")}},
        "races": {
            "list": [_race(r) for r in races.get("races") or []],
            "next": (races.get("next") or {}).get("id"),
            "today": {**_pick(races.get("today"), "window", "day", "of"), "race": (races.get("today") or {}).get("race", {}) and
                      _pick(races["today"]["race"], "id", "name", "days_to", "start")},
            "blocks": [_pick(b, "name", "start", "end", "weeks", "emphasis", "current", "week")
                       for b in (races.get("season") or {}).get("blocks") or []]},
    }


# --- the app's formatting (app/web/src/lib/fmt.ts, form.ts, recovery.ts) ------------------------
e = html.escape
DOW, MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def nf(v, digits: int = 0) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "—"
    return f"{v:,.{digits}f}"


def kg(v) -> str:
    return "—" if v is None else nf(v, 1 if v % 1 else 0)


def hm(hours) -> str:
    if hours is None:
        return "—"
    h = math.floor(hours)
    m = round((hours - h) * 60)
    return f"{h + 1}:00" if m == 60 else f"{h}:{m:02d}"


def clock(iso: str | None) -> str:
    return iso[11:16] if iso else "—"


def day(iso: str) -> str:
    d = dt.date.fromisoformat(iso[:10])
    return f"{DOW[d.weekday()]} {d.day} {MON[d.month - 1]}"


def dshort(iso: str) -> str:
    """"2 Oct" — a chart's axis; the series' own "MM-DD" dates are read as this year."""
    if len(iso) == 5:
        return f"{int(iso[3:])} {MON[int(iso[:2]) - 1]}"
    d = dt.date.fromisoformat(iso[:10])
    return f"{d.day} {MON[d.month - 1]}"


def signed(x: float, digits: int = 0) -> str:
    r = round(x, digits)
    return f"{'+' if r > 0 else '−' if r < 0 else '±'}{nf(abs(r), digits)}"


def zone(r) -> str:
    return "var(--tx3)" if r is None else "var(--g)" if r >= 67 else "var(--y)" if r >= 34 else "var(--r)"


def rec_word(s) -> str:
    return "—" if s is None else "Recovered" if s >= 67 else "Recovering" if s >= 34 else "Run down"


FORM_ZONES = [(25, 1e9, "Detraining", "very fresh — fitness is slipping", "var(--y)", "var(--yt)"),
              (5, 25, "Fresh", "rested — ready for a hard day or a test", "var(--g)", "var(--gt)"),
              (-10, 5, "Neutral", "load and recovery in balance", "var(--tx2)", "transparent"),
              (-30, -10, "Building", "productive fatigue — training is adding fitness", "var(--b)", "var(--bt)"),
              (-1e9, -30, "Overreaching", "fatigue well above fitness — recover soon", "var(--r)", "var(--rt)")]


def form_zone(v):
    return None if v is None else next((z for z in FORM_ZONES if z[0] <= v < z[1]), None)


SIGNAL = {"HRV vs 30d": ("HRV", {"better": "above your usual", "usual": "your usual", "below": "below your usual", "well_below": "well below your usual"}),
          "RHR vs 30d": ("resting HR", {"better": "lower than usual", "usual": "your usual", "below": "higher than usual", "well_below": "well above usual"}),
          "Sleep perf": ("sleep", {"met": "need met", "short": "a little short", "well_short": "short of your need"}),
          "Respiration": ("respiration", {"usual": "your usual", "raised": "slightly up", "high": "raised — an illness sign"}),
          "Skin temp": ("skin temperature", {"usual": "your usual", "raised": "slightly warm", "high": "raised"})}
GOOD = {"better", "usual", "met"}
VERB_COL = {"TRAIN": "var(--g)", "REST": "var(--v)", "EASY CARDIO": "var(--b)", "CARDIO": "var(--b)", "MOBILITY": "var(--tx2)"}
KIND_COLOR = {"strength": "var(--o)", "endurance": "var(--b)", "circuit": "var(--v)", "sport": "var(--c)"}
STAGES = [("awake", "Awake", "var(--y)"), ("rem", "REM", "var(--v)"), ("light", "Light", "var(--b)"), ("deep", "Deep", "var(--g)")]
# A race window's word and colour (the app's WIN, app/web/src/lib/races.ts).
WIN = {"easy": ("Easy", "var(--b)", "var(--bt)"), "taper": ("Taper", "var(--y)", "var(--yt)"),
       "race": ("Race day", "var(--tx)", "var(--s3)"), "recovery": ("Recovery", "var(--v)", "var(--vt)")}
# An exercise's state at its prescription (Program.tsx ST): mark, colour, words.
ST = {"ok": ("✓", "var(--g)", "met at this prescription"), "watch": ("!", "var(--y)", "missed once at this prescription"),
      "stale": ("⧗", "var(--y)", "asked 2+ sessions, never met"), "impossible": ("✕", "var(--r)", "implies an e1RM above your best"),
      "abandoned": ("–", "var(--tx3)", "no session in 21+ days"),
      "skipped": ("↷", "var(--y)", "its day ran 2+ times without it"), "new": ("+", "var(--tx2)", "no history at this prescription yet"),
      "speed": ("⚡", "var(--tx2)", "power work — judged by speed and quality")}
CARDIO = (("run", "Run", "s-run"), ("swim", "Swim", "s-swim"), ("bike", "Ride", "s-bike"))


def kind_color(kind) -> str:
    return KIND_COLOR.get(kind or "", KIND_COLOR["sport"])


# --- icons: one sprite, used by reference (components/ui.tsx IC, components/SportIcon.tsx) -------
IC = {"check": "M5 12l5 5 9-10", "up": "M12 19V5M6 11l6-6 6 6", "down": "M12 5v14M6 13l6 6 6-6", "warn": "M12 3 2 21h20L12 3zM12 10v5",
      "clock": "M12 7v5l3 2", "minus": "M5 12h14", "moon": "M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z", "x": "M6 6l12 12M18 6 6 18",
      "watch": "M7 7h10v10H7zM9 7l1-4h4l1 4M9 17l1 4h4l1-4", "flag": "M5 21V4h11l-2 4 2 4H5", "cut": "M8.1 8.1 20 20M8.1 15.9 20 4",
      "q": "M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V15M12 18h.01", "time": "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
      "plan": "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01", "chev": "M9 6l6 6-6 6"}
SPORT = {"strength": "M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11",
         "run": "M14.5 4.5a1.6 1.6 0 1 0 0.01 0M8 20.5l2.6-5 3 2.2V21M10.6 15.5l1.4-6 3.2 2.6 3.3.9M12 9.5l-3.6.8-2 3",
         "bike": "M5.5 17.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M18.5 17.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M5.5 17.5 9 10h6.5l3 7.5M9 10 8 7H6M12.2 17.5 15.5 10",
         "swim": "M2 18c2 0 2-1.4 4-1.4s2 1.4 4 1.4 2-1.4 4-1.4 2 1.4 4 1.4 2-1.4 4-1.4M5 13.5 10 9l3 3 3-2.5M17.5 6.5m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0",
         "race": "M5 21V4h11l-2 4 2 4H5", "circuit": "M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5l1-8z",
         "racket": "M9.5 9.5m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M13.8 13.8 20.5 20.5M5.5 7.5l8 4M7.5 4.5l4 8M19 5m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0",
         "walk": "M12.5 4.5a1.6 1.6 0 1 0 0.01 0M9.5 21l2-6.5 2.5 2.5v4M11.5 14.5l1-5.5-3 1.2-1.5 3.3M12.5 9l2.5 3h3",
         "hike": "M3 20 9.5 9l4 6.5 3-4.5L21 20H3z", "other": "M3 12h4l2.5-6 5 12 2.5-6h4"}
ZWIFT_Z = ("m1461.1 626.301h-212.55l766.36 1252.609h-1701.762c-172.949 0-313.144-140.2-313.144-313.16 0-172.95 140.195-313.14 "
           "313.144-313.14h211.532l-479.473-783.739s-45.203-65.883-45.203-160.883c0-170.097 137.891-307.988 307.976-307.988h1153.12c172.95 "
           "0 313.15 140.211 313.15 313.16s-140.2 313.141-313.15 313.141")
SPRITE = ('<svg width="0" height="0" style="position:absolute" aria-hidden="true">'
          + "".join(f'<symbol id="i-{k}" viewBox="0 0 24 24"><path d="{d}"/></symbol>' for k, d in IC.items())
          + "".join(f'<symbol id="i-s-{k}" viewBox="0 0 24 24"><path d="{d}"/></symbol>' for k, d in SPORT.items())
          + f'<symbol id="i-s-zwift" viewBox="0 -68 2015 2015"><path d="{ZWIFT_Z}" transform="matrix(1 0 0 -1 0 1879)" fill="#F2541B" stroke="none"/></symbol>'
          + "</svg>")
LOGO = ('<svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5 27 L16 5 L27 27" style="stroke:var(--tx)" '
        'stroke-width="2.8"/><path d="M10.5 19.5 H21.5" style="stroke:var(--id)" stroke-width="2.8"/><circle cx="16" cy="5" r="2.4" style="fill:var(--id)"/></svg>')


def icon(name: str, size: int = 14, sw: float = 2.4, color: str | None = None) -> str:
    # Stroke, caps and fill live in the .ic rule: the page carries ~60 icons and is read before every publish.
    return (f'<svg class="ic" width="{size}" height="{size}" style="stroke-width:{sw}{";color:" + color if color else ""}" aria-hidden="true">'
            f'<use href="#i-{name}"/></svg>')


def sport_icon(name: str | None, size: int = 14, color: str | None = None) -> str:
    key = name if name in SPORT or name == "zwift" else "other"
    return icon(f"s-{key}", size, 2.1, color)


# --- charts --------------------------------------------------------------------------------------
def _scale(vals, pad: float = 0.08, extra=()) -> tuple[float, float]:
    xs = [x for x in [*vals, *extra] if x is not None]
    if not xs:
        return 0.0, 1.0
    lo, hi = min(xs), max(xs)
    if lo == hi:
        lo, hi = lo - 1, hi + 1
    p = (hi - lo) * pad
    return lo - p, hi + p


def _y(v, lo, hi, h):
    return h - (v - lo) / (hi - lo) * h


def _x(i, n, w):
    return w / 2 if n <= 1 else i * w / (n - 1)


def _line(vals, lo, hi, w, h) -> str:
    d, pen = [], False
    for i, v in enumerate(vals):
        if v is None:
            pen = False
            continue
        d.append(f"{'L' if pen else 'M'}{_x(i, len(vals), w):.1f} {_y(v, lo, hi, h):.1f}")
        pen = True
    return " ".join(d)


def spark(values: list, color: str = "var(--tx)", band_lo=None, band_hi=None, base=None, h: int = 30, avg: list | None = None,
          zones: list | None = None) -> str:
    """The KPI tile's sparkline (components/ui.tsx Spark): a line, a band, a baseline, the last point."""
    extra = [x for x in (band_lo, band_hi, base) if x is not None]
    lo, hi = _scale([*values, *(avg or [])], 0.1, extra)
    band = lambda a, b: f"M0 {_y(b, lo, hi, h):.1f} H100 V{_y(a, lo, hi, h):.1f} H0 Z"  # noqa: E731
    main = avg or values
    idx = [i for i, x in enumerate(main) if x is not None]
    out = [f'<svg viewBox="0 0 100 {h}" preserveAspectRatio="none" width="100%" height="{h}" aria-hidden="true" class="spark">']
    for z_lo, z_hi, tint in zones or []:
        if z_hi > lo and z_lo < hi:
            out.append(f'<path d="{band(max(z_lo, lo), min(z_hi, hi))}" style="fill:{tint}"/>')
    if band_lo is not None and band_hi is not None:
        out.append(f'<path d="{band(band_lo, band_hi)}" style="fill:var(--s3)"/>')
    if base is not None:
        out.append(f'<path d="M0 {_y(base, lo, hi, h):.1f} H100" class="base"/>')
    out.append(f'<path d="{_line(values, lo, hi, 100, h)}" class="ln{" faint" if avg else ""}" style="stroke:{color}"/>')
    if avg:
        out.append(f'<path d="{_line(avg, lo, hi, 100, h)}" class="ln bold" style="stroke:{color}"/>')
    if idx:
        i = idx[-1]
        out.append(f'<circle cx="{_x(i, len(main), 100):.1f}" cy="{_y(main[i], lo, hi, h):.1f}" r="1.6" style="fill:{color}"/>')
    return "".join(out) + "</svg>"


def plot(dates: list[str], *, lines=(), bars=None, bar_colors=None, band=None, base=None, guides=(), floor0: bool = False,
         unit: str = "", digits: int = 0, label: str = "", year: int | None = None) -> str:
    """A 30-day chart drawn to one scale: bars or lines, a band, a dashed baseline. Its labels name the
    values it reaches (the series' high and low, and each guide), placed at their height."""
    W, H, n = 300, 110, len(dates)
    vals = [x for s in lines for x in s[0]] + list(bars or [])
    if band:
        vals += list(band[0]) + list(band[1])
    data = [x for x in vals if x is not None]
    if not data:
        return '<p class="quiet">No readings yet.</p>'
    extra = [x for x in [base, *guides] if x is not None] + ([0] if floor0 else [])
    lo, hi = _scale(data, 0.1, extra)
    if floor0:
        lo = 0
    Y = lambda v: _y(v, lo, hi, H)  # noqa: E731
    out = [f'<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" width="100%" height="{H}" role="img" aria-label="{e(label)}">']
    for g in [x for x in [base, *guides] if x is not None]:
        out.append(f'<path d="M0 {Y(g):.1f} H{W}" class="guide"/>')
    if band:
        pts = [(i, a, b) for i, (a, b) in enumerate(zip(*band)) if a is not None and b is not None]
        if pts:
            top = " L".join(f"{_x(i, n, W):.1f} {Y(b):.1f}" for i, _, b in pts)
            bot = " L".join(f"{_x(i, n, W):.1f} {Y(a):.1f}" for i, a, _ in reversed(pts))
            out.append(f'<path d="M{top} L{bot} Z" style="fill:var(--gt)"/>')
    if bars:
        slot = W / n
        for i, b in enumerate(bars):
            if b is None:
                continue
            col = (bar_colors or [None] * n)[i] or "var(--tx3)"
            out.append(f'<rect x="{i * slot + slot * 0.15:.1f}" y="{Y(b):.1f}" width="{slot * 0.7:.1f}" height="{max(1.0, Y(lo) - Y(b)):.1f}" rx="1.5" style="fill:{col}"/>')
    for vals_, color, cls in lines:
        out.append(f'<path d="{_line(vals_, lo, hi, W, H)}" class="ln {cls}" style="stroke:{color}"/>')
    out.append("</svg>")
    marks = sorted({round(max(data), digits), round(min(data), digits), *(round(g, digits) for g in [base, *guides] if g is not None)})
    labels = "".join(f'<span class="yl" style="top:{Y(m) / H * 100:.1f}%">{nf(m, digits)}{unit}</span>' for m in marks)
    ends = [dshort(dates[0]), dshort(dates[-1])] if dates else []
    # Spanning two years, each end says which: full dates carry it; "MM-DD" series (the weigh-ins)
    # are in date order, so a first date later in the year than the last is the year before.
    if dates and len(dates[0]) == 10 and dates[0][:4] != dates[-1][:4]:
        ends = [f"{ends[0]} ’{dates[0][2:4]}", f"{ends[1]} ’{dates[-1][2:4]}"]
    elif dates and len(dates[0]) == 5 and dates[0] > dates[-1]:
        yy = (year or dt.date.today().year) % 100
        ends = [f"{ends[0]} ’{yy - 1:02d}", f"{ends[1]} ’{yy:02d}"]
    axis = f'<div class="xl"><span>{e(ends[0])}</span><span>{e(ends[1])}</span></div>' if dates else ""
    return f'<div class="plot">{"".join(out)}{labels}</div>{axis}'


def ring(value, mx: float, color: str, inner: str, size: int = 92) -> str:
    C = 2 * math.pi * 52
    p = 0 if value is None else max(0.0, min(1.0, value / mx))
    arc = (f'<circle cx="60" cy="60" r="52" fill="none" style="stroke:{color}" stroke-width="10" stroke-linecap="round" '
           f'stroke-dasharray="{C * p:.1f} {C:.1f}" transform="rotate(-90 60 60)"/>') if value is not None else ""
    return (f'<div class="ring" style="width:{size}px;height:{size}px"><svg width="{size}" height="{size}" viewBox="0 0 120 120" aria-hidden="true">'
            f'<circle cx="60" cy="60" r="52" fill="none" style="stroke:var(--ln)" stroke-width="10"/>{arc}</svg><div class="ring-in">{inner}</div></div>')


def hypnogram(n: dict, height: int = 44) -> str:
    length = max(1, n.get("length_min") or 1)
    lane = height / len(STAGES)
    keys = [k for k, _, _ in STAGES]
    rows = "".join(f'<rect x="0" y="{i * lane}" width="600" height="{lane}" style="fill:{"transparent" if i % 2 else "var(--s2)"}"/>'
                   for i in range(len(STAGES)))
    segs = "".join(f'<rect x="{a / length * 600:.1f}" y="{keys.index(st) * lane + 1}" width="{max(1.5, (b - a) / length * 600):.1f}" '
                   f'height="{lane - 2}" rx="1.5" style="fill:{STAGES[keys.index(st)][2]}"/>'
                   for a, b, st in n.get("segments") or [] if st in keys)
    return (f'<svg viewBox="0 0 600 {height}" width="100%" height="{height}" preserveAspectRatio="none" role="img" '
            f'aria-label="Last night\'s stages, {e(n.get("start") or "")} to {e(n.get("end") or "")}">{rows}{segs}</svg>')


# --- prescriptions (Program.tsx loadTxt, status, the number to beat) -----------------------------
def load_txt(x: dict, w=None) -> str:
    w = x.get("weight") if w is None else w
    if w is None:
        return "body weight"
    if x.get("load") == "plates":
        return f"+{kg(w)} kg plates"
    if x.get("load") == "added":
        return f"BW +{kg(w)} kg"
    return f"{kg(w)} kg{' / hand' if x.get('per_hand') else ''}"


def rx(x: dict) -> str:
    unit = " s" if (x.get("kind") or "").startswith("time") or x.get("base") == "time" else ""
    side = " / side" if x.get("per_side") else ""
    load = "" if x.get("weight") is None and x.get("phase") == "core" else f" @ {load_txt(x)}"
    return f"{x.get('sets')}×{x.get('value')}{unit}{side}{load}"


def status(x: dict) -> str | None:
    a = x.get("audit")
    if not a:
        return "speed" if x.get("base") == "power" else None
    if a.get("impossible"):
        return "impossible"
    if a.get("abandoned"):
        return "abandoned"
    return "new" if a.get("status") in ("fresh", "no_history") else a.get("status")


def beat(x: dict) -> str:
    s, a = status(x), x.get("audit") or {}
    if s == "impossible":
        return f"re-prescribe — {load_txt(x)} implies e1RM {kg(a.get('implied_e1rm'))} vs best {kg(a.get('best_e1rm'))}"
    if s == "stale":
        return f"first: all {x.get('sets')} sets at {x.get('value')} — {a.get('sessions')} tries, none met"
    if s == "skipped":
        return f"do it — skipped the last {a.get('skipped')} times its day ran"
    if x.get("phase") == "core":
        return "quality first · anti-movement, no load race"
    if x.get("base") == "power":
        return f"{x.get('note') or 'max speed'} · every rep crisp — never by load"
    if x.get("per_side"):
        return f"time first ({x.get('value')} s / side), then load"
    if x.get("base") == "time":
        return x.get("note") or "the week’s intensity"
    if x.get("next_weight") is not None:
        return f"all {x.get('sets')} sets at {(x.get('range') or [None, x.get('value')])[1]} → {load_txt(x, x['next_weight'])}"
    return f"all {x.get('sets')} sets at {x.get('value')} → add reps or load"


def exercise_row(x: dict, trend: bool) -> str:
    s = status(x)
    mark, col, word = ST.get(s or "", ("·", "var(--tx3)", ""))
    tr = x.get("trend") or []
    sp = ""
    if trend and x.get("trend_score") == "e1rm" and len([t for t in tr if t is not None]) >= 2:
        sp = f'<span class="tr" title="e1RM trend">{spark(tr, "var(--o)", h=18)}</span>'
    return (f'<li class="ex"><span class="mk" style="color:{col}" title="{e(word)}">{mark}</span>'
            f'<span class="exn"><b>{e(x.get("routine") or x.get("label") or "")}</b><span class="beat">→ {e(beat(x))}</span></span>'
            f'<span class="rx n">{e(rx(x))}</span>{sp}</li>')


# --- the page's sections ------------------------------------------------------------------------
def _plan_today(L: dict) -> dict:
    """The watch's day from the export — only when the export is today's. Built on an earlier day it
    names that day's plan (2026-11-01: Friday's run shown as Sunday's), so the calendar speaks instead."""
    fresh = (L["freshness"].get("data_as_of") or "")[:10] == L["day"]
    return L["plan_today"] if fresh else {}


def _sync(L: dict) -> dict:
    return {w["workout"]: w["state"] for w in L["sync"]}


def _program_day(L: dict, key: str | None) -> dict | None:
    return next((d for d in L["program"]["days"] if d["key"] == key), None) if key else None


def _day_by_title(L: dict, title: str | None) -> dict | None:
    return next((d for d in L["program"]["days"] if d["name"] == (title or "").strip()), None)


def _race_by_id(L: dict, rid: str | None) -> dict | None:
    return next((r for r in L["races"]["list"] if r["id"] == rid), None) if rid else None


def topbar(L: dict, display: str, body: str) -> str:
    f = L["freshness"]
    as_of = f.get("data_as_of")
    old = bool(as_of) and as_of[:10] < L["day"]
    if as_of and (old or f.get("warnings")):
        fresh = f'<span class="fr bad">{icon("warn", 12, 2.4)}Data {e(dshort(as_of)) if old else clock(as_of)}</span>'
    elif as_of:
        fresh = f'<span class="fr">{icon("time", 12, 2.2)}Data {clock(as_of)}</span>'
    else:
        fresh = ""
    # Only the sections this page has: a new athlete has no race season, and a link must land somewhere.
    nav = "".join(f'<a href="#{k}">{t}</a>' for k, t in (("today", "Today"), ("week", "Week"), ("body", "Recovery"), ("gym", "Gym"), ("races", "Races"))
                  if f'id="{k}"' in body)
    return (f'<header class="top"><div class="bar"><span class="brand">{LOGO}<b class="n">OSC</b></span>'
            f'<span class="who"><span class="av n" aria-hidden="true">{e(display[:1])}</span>{e(display)}</span><span class="sp"></span>{fresh}</div>'
            f'<nav class="nav" aria-label="Sections">{nav}</nav></header>')


def race_chip(L: dict) -> str:
    rt = L["races"]["today"]
    w = rt.get("window")
    race = rt.get("race") or {}
    if w in WIN and race:
        word, col, bg = WIN[w]
        if w == "race":
            text = f"Race day · {race['name']}{' · ' + race['start'] if race.get('start') else ''}"
        else:
            text = f"{word} day {rt.get('day')} of {rt.get('of')} · {race['name']}"
        return f'<span class="chip" style="color:{col};background:{bg}">{icon("flag", 12)}{e(text)}</span>'
    nxt = _race_by_id(L, L["races"]["next"])
    if nxt and nxt.get("days_to") is not None and 0 < nxt["days_to"] <= 56:
        return (f'<span class="chip" style="color:var(--tx);background:var(--s2)">{icon("flag", 12, 2.4, "var(--o)")}'
                f'{e(nxt["name"])} in {nxt["days_to"]} {"day" if nxt["days_to"] == 1 else "days"}</span>')
    return ""


def hero(L: dict) -> str:
    d, daily, plan_today = L["day"], L["daily"], _plan_today(L)
    stale = bool(daily) and daily["date"] != d
    rec = daily["recommendation"] if daily and not stale else None
    blk = L["block"]
    meta = [day(d), f"week {dt.date.fromisoformat(d).isocalendar()[1]}"]
    if blk and not blk.get("over"):
        meta.append(f"{blk['name']} · wk {blk['week']}/{blk['weeks']}")
    eyebrow = f'<div class="eb"><span class="l">{" · ".join(e(m) for m in meta)}</span>{race_chip(L)}</div>'
    lifted = [w for w in L["trained_today"] if w["kind"] in ("strength", "circuit")]
    if lifted or plan_today.get("done"):
        sessions = L["trained_today"]
        main = next((w for w in sessions if w["kind"] == "strength"), None) or next((w for w in sessions if w["kind"] == "circuit"), None) or (sessions[0] if sessions else None)
        title = (main or {}).get("title") or plan_today.get("name") or "Today’s session"
        facts = " · ".join(x for x in [main.get("start") and f"at {main['start']}", main.get("durationMin") and f"{main['durationMin']} min",
                                       main.get("sets") and (f"{main['sets']} stations" if main["kind"] == "circuit" else f"{main['sets']} sets"),
                                       main.get("tonnage") and f"{nf(main['tonnage'] / 1000, 1)} t"] if x) if main else "logged on the watch"
        others = [w for w in sessions if w is not main]
        also = f" Also today: {', '.join(w['title'] + (f' {nf(w['distanceKm'], 1)} km' if w.get('distanceKm') else '') for w in others)}." if others else ""
        morning = f'<p class="sub">The morning’s call was <b>{e(rec["verb"])} · {e(rec["title"])}</b> — {e(rec["why"])}</p>' if rec else ""
        return f'''<section class="hero" id="today" style="--glow:var(--gt)">{eyebrow}
  <h1 class="call"><span class="verb n" data-k="verb" style="color:var(--g)">DONE</span><span class="ttl n">· {e(title.replace(" · ", " "))}</span></h1>
  <p class="why">Trained {e(facts)}.{e(also)}</p>{morning}</section>'''
    if not rec:
        last = daily["recommendation"] if stale else None
        watch = [x["title"] for x in L["agenda"]["scheduled"] if x["date"] == d and not x["done"]]
        box = ""
        if last or watch:
            box = '<div class="lastcall">' + (f'<span>Last call, {e(day(daily["date"]))}: <b>{e(last["verb"])} · {e(last["title"])}</b> — {e(last["why"])}</span>' if last else "") \
                + (f'<span>On the watch today: <b>{e(" · ".join(watch) if len(watch) == 1 else ", ".join(watch))}</b></span>' if watch else "") + "</div>"
        since = f" since {day(daily['date'])}" if daily else ""
        return f'''<section class="hero" id="today" style="--glow:var(--s2)">{eyebrow}
  <h1 class="call"><span class="ttl n">No call yet today</span></h1>
  <p class="why">The daily hasn’t run{e(since)}. The numbers below are from the data alone.</p>{box}</section>'''
    col = VERB_COL.get(rec["verb"], "var(--tx)")
    glow = {"var(--g)": "var(--gt)", "var(--b)": "var(--bt)"}.get(col, "var(--vt)")
    title = rec["title"] if re.search(r"[.!?]$", rec["title"]) else f"· {rec['title'].replace(' · ', ' ')}"
    tone = {"good": ("var(--gt)", "var(--g)", "check"), "warn": ("var(--yt)", "var(--y)", "warn"),
            "bad": ("var(--rt)", "var(--r)", "x"), "neutral": ("var(--s3)", "var(--tx2)", "minus")}
    sig = "".join(f'<span class="sig"><span class="sig-i" style="background:{tone.get(s["tone"], tone["neutral"])[0]};color:{tone.get(s["tone"], tone["neutral"])[1]}">'
                  f'{icon(tone.get(s["tone"], tone["neutral"])[2], 10, 3.2)}</span><b class="n">{e(s["value"])}</b><span>{e(s["label"])}</span></span>'
                  for s in rec.get("signals") or [])
    cut = (f'<div class="cut">{icon("cut", 16, 2.2, "var(--y)")}<span class="l" style="color:var(--y)">Cut</span><span>{e(rec["cut"])}</span></div>'
           if rec.get("cut") else "")
    endurance = "".join(f'<div class="endu{" flag" if x.get("flag") else ""}"><span class="l">{"Ride" if x.get("sport") == "bike" else "Run"}</span>'
                        f'<span><b>{e(x.get("title") or "")}</b> — {e(x.get("line") or "")}</span></div>' for x in daily.get("endurance") or [])
    plan = _program_day(L, L["call_day"])
    differs = plan and plan_today.get("day") and plan_today["day"] != plan["key"]
    note = (f'<div class="note">{icon("watch", 15, 2, "var(--y)")}<span>The watch has <b>{e(plan_today["name"])}</b> today; the call is '
            f'<b>{e(plan["name"])}</b>. Start it from the watch’s workout list.</span></div>') if differs else ""
    reasoning = f'<details class="more"><summary>The full reasoning</summary><p>{e(rec["reasoning"])}</p></details>' if rec.get("reasoning") else ""
    feel = daily.get("feel") or {}
    felt = f'<p class="felt">You checked in {feel["answer"]}/5{" — “" + e(feel["note"]) + "”" if feel.get("note") else ""}.</p>' if feel.get("answer") else ""
    return f'''<section class="hero" id="today" style="--glow:{glow}">{eyebrow}
  <h1 class="call"><span class="verb n" data-k="verb" style="color:{col}">{e(rec["verb"])}</span><span class="ttl n">{e(title)}</span></h1>
  <p class="why">{e(rec["why"])}</p>
  <div class="sigs">{sig}</div>{cut}{endurance}{note}{reasoning}{felt}</section>'''


def session_card(L: dict) -> str:
    """Today's sessions, and the gym day's exercises with each one's number to beat."""
    d, plan_today = L["day"], _plan_today(L)
    daily = L["daily"]
    rec = daily["recommendation"] if daily and daily["date"] == d else None
    if L["trained_today"] and any(w["kind"] in ("strength", "circuit") for w in L["trained_today"]) or plan_today.get("done"):
        return ""
    key = L["call_day"] if rec else plan_today.get("day")
    pd = _program_day(L, key)
    rows = agenda_entries(L, d)
    if not pd and not rows:
        return ""
    head = f'<div class="ch"><h2 class="l">On today</h2></div>'
    body = f'<div class="ents">{rows}</div>' if rows else ""
    if pd:
        lead = f'<p class="lead">{icon("check", 12, 2.6, "var(--tx3)")}Core first: {e(", ".join(pd["lead"]))}</p>' if pd["lead"] else ""
        body += (f'<div class="sess"><div class="sh"><b class="n">{e(pd["name"])}</b><span class="m">{len(pd["exercises"])} exercises'
                 f'{f" · ~{pd["est_min"]} min" if pd.get("est_min") else ""}</span></div>{lead}'
                 f'<ul class="exl">{"".join(exercise_row(x, False) for x in pd["exercises"])}</ul></div>')
    return f'<section class="card">{head}{body}</section>'


def waiting(L: dict) -> str:
    """Waiting for you, without its buttons: what the daily left open, most urgent first."""
    daily = L["daily"] or {}
    unsynced = [w["workout"] for w in L["sync"] if w["state"] in ("changed", "not_pushed")]
    watch_open = bool(unsynced) or bool(L["sync_unknown"])
    items = []
    for p in daily.get("pending") or []:
        if p["kind"] == "unsynced":
            if watch_open:
                items.append((3, "Not on the watch", "var(--y)", "var(--yt)", "warn", e(p["text"]), None))
        elif p["kind"] == "bump":
            b = p.get("bump") or {}
            text = p.get("text") or ""
            title = (f'<span class="cap">{e(b["exercise"])}</span> {kg(b.get("from"))}{f" → {kg(b['to'])} kg" if b.get("to") is not None else ""}'
                     if b else e(text))
            earned = ", ".join(day(x) for x in b.get("evidence_dates") or [])
            sub = (f"{' — '.join(text.split(' — ')[1:]) + ' · ' if ' — ' in text else ''}earned {earned}") if earned else text
            items.append((0, "Progression", "var(--g)", "var(--gt)", "up", title, e(sub)))
        elif p["kind"] == "question":
            opts = " · ".join(p.get("options") or [])
            items.append((2, "Question from the coach", "var(--b)", "var(--bt)", "q", e(p["text"]), e(f"Options: {opts}") if opts else None))
    if unsynced and not any(x[1] == "Not on the watch" for x in items):
        items.append((3, "Not on the watch", "var(--y)", "var(--yt)", "warn",
                      e(f"{', '.join(unsynced)} {'is' if len(unsynced) == 1 else 'are'} not on the watch yet"), None))
    if not items:
        return ""
    items.sort(key=lambda x: x[0])
    rows = "".join(f'<div class="item"><span class="ib" style="background:{bg};color:{c}">{icon(i, 13, 2.6)}</span>'
                   f'<span class="it"><span class="l" style="color:{c}">{e(k)}</span><span class="it-t">{t}</span>{f"<span class=it-s>{s}</span>" if s else ""}</span></div>'
                   for _, k, c, bg, i, t, s in items)
    return (f'<section class="card"><div class="ch"><h2 class="l">Waiting for you</h2><span class="n count">{len(items)}</span></div>{rows}'
            f'<p class="m quiet">Answer these in the app on the Mac.</p></section>')


def kpis(L: dict) -> str:
    """The KPI strip: recovery first, then the six tiles the app's Today shows (Today.tsx Kpis)."""
    td, v, body, n, night = L["today"], L["vitals"], L["body"], L["last_night"], L["night"]
    hrv, rhr = td["hrv"], td["rhr"]
    last_of = lambda k: next((x[k] for x in reversed(v) if x.get(k) is not None), None)  # noqa: E731
    hrv7, rhr7 = last_of("hrv_7d"), last_of("rhr_7d")
    has_band = hrv.get("bandLow") is not None and hrv.get("bandHigh") is not None
    judged = hrv7 if hrv7 is not None else hrv.get("value")
    in_band = has_band and judged is not None and hrv["bandLow"] <= judged <= hrv["bandHigh"]
    rhr_d = rhr7 - rhr["baseline"] if rhr7 is not None and rhr.get("baseline") is not None else None
    asleep = n["asleep_min"] / 60 if n and n.get("asleep_min") is not None else td["sleep"].get("hours")
    need = n["need_min"] / 60 if n and n.get("need_min") else night["sleep"].get("needH")
    short = need - asleep if need and asleep is not None else None
    lo, hi = (body or {}).get("targetLow"), (body or {}).get("targetHigh")
    fz = form_zone(td.get("form"))
    r = night["recoveryScore"]
    off = [c for c in night["components"] if c.get("state") and c["state"] not in GOOD]
    holding = (f"Holding it down: {', '.join(SIGNAL.get(c['label'], (c['label'], {}))[0] + ' ' + SIGNAL.get(c['label'], ('', {}))[1].get(c['state'], c['state']) for c in off)}."
               if off else "Every signal at or better than your usual.") if night["components"] else ""
    state = "Calibrating" if r is None else f"{rec_word(r)} · {'ready to train' if r >= 67 else 'train, cap intensity' if r >= 34 else 'recover first'}"
    inner = (f'<span class="n rv" data-k="recovery">{"—" if r is None else r}</span><span class="l" style="font-size:9px">recovery</span>')
    over = "" if td.get("date") in (None, L["day"]) else f'<p class="m quiet">{icon("moon", 11, 2.2)} from {e(day(td["date"]))} — this morning’s reading hadn’t reached Garmin</p>'
    rec_tile = (f'<div class="kpi rec">{ring(r, 100, zone(r), inner)}<div class="rt"><span class="l">Recovery</span>'
                f'<span class="st" style="color:{zone(r)}">{icon("check" if r is not None and r >= 67 else "warn", 13, 2.6)}{e(state)}</span>'
                f'<span class="rn">{e(holding)}</span>{over}</div></div>')
    tiles = [
        ("HRV · 7-day", nf(judged), "ms", f"last night {nf(hrv['value'])}" if hrv.get("value") is not None else None,
         "No reading" if judged is None else "Calibrating · no band yet" if not has_band else f"In band {hrv['bandLow']}–{hrv['bandHigh']}" if in_band else f"Out of band {hrv['bandLow']}–{hrv['bandHigh']}",
         "var(--v)" if not has_band else "var(--g)" if in_band else "var(--y)", "minus" if not has_band else "check" if in_band else "warn",
         spark([x.get("hrv") for x in v], avg=[x.get("hrv_7d") for x in v], band_lo=hrv.get("bandLow") if has_band else None, band_hi=hrv.get("bandHigh") if has_band else None)),
        ("Resting HR · 7-day", nf(rhr7 if rhr7 is not None else rhr.get("value"), 1 if rhr7 is not None else 0), "bpm",
         f"last night {nf(rhr['value'])}" if rhr.get("value") is not None else None,
         "—" if rhr_d is None else f"{signed(rhr_d, 1)} vs baseline {nf(rhr['baseline'], 1)}",
         "var(--g)" if rhr_d is not None and rhr_d <= 0.5 else "var(--y)", "down" if rhr_d is not None and rhr_d <= 0.5 else "up",
         spark([x.get("rhr") for x in v], avg=[x.get("rhr_7d") for x in v], base=rhr.get("baseline"), color="var(--r)")),
        ("Sleep", hm(asleep), "h", f"score {n['score']}" if n and n.get("score") is not None else None,
         "—" if short is None else f"{hm(short)} short of {hm(need)}" if short > 0.05 else "Need met",
         "var(--y)" if short is not None and short > 0.05 else "var(--g)", "warn" if short is not None and short > 0.05 else "check",
         spark([x.get("sleep_h") for x in L["recovery"]["series"]], "var(--v)", base=need)),
        ("Readiness", nf(td["readiness"].get("score")), "/100", None, (td["readiness"].get("level") or "—").lower().capitalize(),
         zone(td["readiness"].get("score")), "minus" if td["readiness"].get("score") is None else "check" if td["readiness"]["score"] >= 67 else "warn",
         spark(L["readiness_30"])),
        ("Form", "—" if td.get("form") is None else signed(td["form"]), fz[2] if fz else "", None, fz[3] if fz else "—", fz[4] if fz else "var(--tx2)",
         "warn" if fz and fz[2] == "Overreaching" else "minus",
         spark(L["form_spark"], fz[4] if fz else "var(--tx)", base=0, zones=[(z[0], z[1], z[5]) for z in FORM_ZONES if z[5] != "transparent"])),
        ("Body weight", nf(body["latestKg"], 1) if body else "—", "kg", ("today" if not body["daysSince"] else f"{body['daysSince']} d ago") if body else None,
         "No weigh-in" if not body else f"{nf(body['latestKg'] - hi, 1)} above {lo}–{hi}" if lo is not None and body["latestKg"] > hi
         else f"{nf(lo - body['latestKg'], 1)} below {lo}–{hi}" if lo is not None and body["latestKg"] < lo else f"In range {lo}–{hi}" if lo is not None else "No target set",
         "var(--tx3)" if not body else "var(--y)" if lo is not None and (body["latestKg"] > hi or body["latestKg"] < lo) else "var(--g)",
         "minus" if not body else "warn" if lo is not None and (body["latestKg"] > hi or body["latestKg"] < lo) else "check",
         spark([x["kg"] for x in (body or {}).get("series") or []], band_lo=lo, band_hi=hi)),
    ]
    out = ""
    for label, val, u, sub, delta, col, ic, chart in tiles:
        ucol = f"color:{col};font-weight:700" if label == "Form" else "color:var(--tx2)"
        out += (f'<div class="kpi"><span class="l">{label}</span><span class="kv"><span class="n kn">{e(val)}</span><span style="font-size:12px;{ucol}">{e(u)}</span>'
                f'{f"<span class=ks>{e(sub)}</span>" if sub else ""}</span><span class="delta" style="color:{col}">{icon(ic, 11, 2.8)}{e(delta)}</span>{chart}</div>')
    return f'<section class="kpis" aria-label="Today’s numbers">{rec_tile}{out}</section>'


def banners(L: dict) -> str:
    """GYM and CARDIO, the week so far: never one load number (CLAUDE.md) — sets and tonnage on one
    side, sessions against target and cardio load on the other, each against last week to the same day."""
    w, ws, c = L["week"], L["week_strength"], L["cardio"]
    this, last = w["this"], w["last"]
    days = w["days"]
    cut = w.get("cut")
    to = days[cut]["dow"] if cut is not None and 0 <= cut < len(days) else None

    def vs(a, b, fmt) -> str:
        if a is None or b is None:
            return ""
        arrow = "▲" if a > b else "▼" if a < b else "="
        return f'<span class="vs">{arrow} {fmt(b)} last week</span>'
    gym_sets = f'<b class="n">{nf(ws.get("sets"))}</b> sets' if ws.get("sets") is not None else ""
    gym = [f'<div class="bn-big"><b class="n">{nf(ws.get("sessions"))}</b> <span>{"session" if ws.get("sessions") == 1 else "sessions"}</span></div>',
           f'<div class="bn-row"><span>{gym_sets} · <b class="n">{nf((ws.get("tonnage") or 0) / 1000, 1)}</b> t</span></div>']
    if to and this.get("sets") is not None:
        gym.append(f'<div class="bn-cmp"><span class="l">To {e(to)}</span><span>{nf(this["sets"])} sets {vs(this.get("sets"), last.get("sets"), nf)}</span>'
                   f'<span>{nf((this.get("tonnage") or 0) / 1000, 1)} t {vs(this.get("tonnage"), last.get("tonnage"), lambda x: nf(x / 1000, 1) + " t")}</span></div>')
    for s in L["starved"]:
        gym.append(f'<p class="flagl">{icon("flag", 12)}{e(s["label"])} — {s["age"] if s.get("age") is not None else "∞"} days since last trained</p>')
    if L["bumps"]:
        gym.append(f'<p class="bumps">{icon("up", 12, 2.8, "var(--g)")}{len(L["bumps"])} {"step" if len(L["bumps"]) == 1 else "steps"} earned — '
                   f'see the numbers to beat under Gym</p>')
    sess = c.get("sessions") or {}
    pips = ""
    for k, label, ic in CARDIO:
        s = sess.get(k)
        if not s:
            continue
        done, tgt = s.get("done") or 0, s.get("target") or 0
        dots = "".join(f'<i class="{"on" if i < done else ""}{" over" if i >= tgt else ""}"></i>' for i in range(max(done, tgt)))
        met = done >= tgt > 0
        pips += (f'<div class="pip"><span class="pl">{icon(ic, 14, 2.1)}{label}</span><span class="dots">{dots}</span>'
                 f'<span class="n pc" style="color:{"var(--g)" if met else "var(--tx)"}">{done}/{tgt}</span></div>')
    others: dict[str, int] = {}
    for d in days:
        for s in d["sports"]:
            if s.get("kind") == "sport":
                others[s["title"]] = others.get(s["title"], 0) + 1
    extra = f'<p class="quiet">On top: {e(", ".join(f"{k} ×{n}" for k, n in others.items()))}</p>' if others else ""
    load = (c.get("load") or {})
    band = load.get("band")
    km = this.get("km_by") or {}
    kms = " · ".join(f"{lab} {nf(km[k], 1)}" for k, lab, _ in CARDIO if km.get(k))
    cardio = [f'<div class="pips">{pips}</div>', extra,
              f'<div class="bn-row"><span>Cardio load <b class="n">{nf(load.get("done"))}</b>{f" · band {band[0]}–{band[1]}" if band else ""}</span></div>']
    if to and this.get("cardio_load") is not None:
        cardio.append(f'<div class="bn-cmp"><span class="l">To {e(to)}</span><span>load {nf(this["cardio_load"])} {vs(this.get("cardio_load"), last.get("cardio_load"), nf)}</span>'
                      f'{f"<span>{kms} km</span>" if kms else ""}</div>')
    return (f'<section class="banners" id="week"><div class="bn gymb"><div class="bh">{sport_icon("strength", 16)}<h2 class="l">Gym · this week</h2></div>{"".join(gym)}</div>'
            f'<div class="bn cardb"><div class="bh">{sport_icon("run", 16)}<h2 class="l">Cardio · this week</h2></div>{"".join(cardio)}</div></section>')


def agenda_entries(L: dict, ds: str) -> str:
    ag, sync = L["agenda"], _sync(L)
    out = []
    for x in ag["done"]:
        if x["date"] == ds:
            out.append((x["title"], x["badge"], None, ("Done", "var(--g)", "check")))
    for x in ag["scheduled"]:
        if x["date"] == ds and not x["done"]:
            st = sync.get(x["title"])
            pd = _day_by_title(L, x["title"])
            dur = f" · ~{pd['est_min']} min" if pd and pd.get("est_min") else ""
            out.append((x["title"], x["badge"], None, ("Not on the watch yet", "var(--y)", "warn") if st in ("changed", "not_pushed")
                        else (f"On the watch{dur}", "var(--g)", "watch")))
    zw = {}   # entry index → its Zwift workout line
    for x in ag["planned"]:
        if x["date"] == ds and not x["done"]:
            dur = f" · {x['duration_min']} min" if x.get("duration_min") else ""
            if x.get("zwift_workout"):
                zw[len(out)] = x["zwift_workout"]
            out.append((x["title"], x["badge"], x.get("detail"), (("Goes on the watch" if x["on_watch"] else "Off the watch") + dur, "var(--tx2)", "clock")))
    return "".join(f'<div class="en"><span class="eni" style="color:{kind_color((b or {}).get("kind"))}">{sport_icon((b or {}).get("icon"), 17)}</span>'
                   f'<div class="ent"><b>{e(t or "")}</b><span class="ens" style="color:{sc}">{icon(si, 11, 2.6)}{e(st)}</span>'
                   f'{zwift_line(zw[i]) if i in zw else ""}'
                   f'{f"<span class=end>{e(det)}</span>" if det else ""}</div></div>' for i, (t, b, det, (st, sc, si)) in enumerate(out))


def zwift_line(w: dict) -> str:
    """The Zwift workout a planned ride names: what to pick in Zwift's menu, linked to its page."""
    meta = " · ".join(x for x in (w.get("collection"), f"{w['duration_min']} min" if w.get("duration_min") else None) if x)
    return (f'<a class="zw" href="{e(w.get("url") or "")}" target="_blank" rel="noopener">{sport_icon("zwift", 12)}'
            f'<b>{e(w.get("name") or "")}</b>{f"<span>{e(meta)}</span>" if meta else ""}</a>')


def agenda(L: dict) -> str:
    d0 = dt.date.fromisoformat(L["day"])
    rdays = {x["date"]: x for x in L["agenda"]["race_days"]}
    bm = {}
    for b in L["program"]["benchmarks"]:
        if b.get("next") and not b.get("overdue"):
            bm.setdefault(b["next"], []).append(b["name"])
    rows = ""
    for i in range(AHEAD):
        ds = (d0 + dt.timedelta(days=i)).isoformat()
        rd = rdays.get(ds)
        pill = ""
        if rd and rd.get("window") in WIN:
            word, col, bg = WIN[rd["window"]]
            txt = f"Race day · {rd['race']['name']}{' · ' + rd['race']['start'] if rd['race'].get('start') else ''}" if rd["window"] == "race" \
                else f"{word} {rd.get('day')}/{rd.get('of')} · {rd['race']['name']}"
            pill = f'<span class="win" style="color:{col};background:{bg}">{e(txt)}</span>'
        marks = "".join(f'<span class="bmk">{icon("flag", 11, 2.4)}{e(n)} due</span>' for n in bm.get(ds, []))
        dd = d0 + dt.timedelta(days=i)
        ents = agenda_entries(L, ds)
        if not ents and i > 0 and not rd:
            tpl = L["program"]["template"].get(DOW[dd.weekday()].lower()) or []
            ents = "".join(f'<div class="en tpl"><span class="eni">{sport_icon(x["badge"].get("icon"), 17)}</span><div class="ent"><b>{e(x.get("title") or "")}</b>'
                           f'<span class="ens">{icon("plan", 11, 2.4)}Template · not planned yet{" · " + e(x["duration"]) if x.get("duration") else ""}</span></div></div>'
                           for x in tpl)
        ents = ents or '<span class="rest">Rest</span>'
        rows += (f'<li class="ad{" now" if i == 0 else ""}{" racew" if rd else ""}"><div class="adw"><span class="l">{"Today" if i == 0 else DOW[dd.weekday()]}</span>'
                 f'<b class="n">{dd.day}</b><span class="adm">{MON[dd.month - 1]}</span></div><div class="adb">{pill}{ents}{marks}</div></li>')
    done = ""
    past = [d for d in L["week"]["days"] if d["date"] < L["day"] and d["sports"]]
    if past:
        lines = "".join(f'<li><span class="l">{e(d["dow"])} {int(d["date"][8:])}</span><span class="dl">'
                        + " ".join(f'<span class="dli" style="color:{kind_color(s.get("kind"))}">{sport_icon(s.get("icon"), 13)}<span>{e(s.get("title") or "")}'
                                   f'<i>{" · " + str(s["min"]) + " min" if s.get("min") else ""}{" · " + nf(s["km"], 1) + " km" if s.get("km") else ""}'
                                   f'{" · " + str(s["sets"]) + " sets" if s.get("sets") else ""}</i></span></span>' for s in d["sports"])
                        + "</span></li>" for d in past)
        n = sum(len(d["sports"]) for d in past)
        done = f'<details class="card donew"><summary><h2 class="l">Done this week</h2><span class="m quiet">{n} {"session" if n == 1 else "sessions"}</span>{icon("chev", 14, 2.4)}</summary><ul class="dlist">{lines}</ul></details>'
    return f'<section class="card"><div class="ch"><h2 class="l">Next {AHEAD} days</h2></div><ol class="agenda">{rows}</ol></section>{done}'


def body_section(L: dict) -> str:
    """Recovery and sleep, 30 days, at a size you can read: each chart to scale, labelled at its values."""
    s, scores = L["recovery"]["series"], L["recovery"]["scores"]
    if not s:
        return ""
    dates = [x["date"] for x in s]
    td, night, n, body = L["today"], L["night"], L["last_night"], L["body"]
    r = night["recoveryScore"]
    cards = []
    if scores:
        cards.append(("Recovery score", f'<b class="n" style="color:{zone(r)}">{nf(r)}</b> <span>{e(rec_word(r))}</span>',
                      plot([x["date"] for x in scores], bars=[x["score"] for x in scores], bar_colors=[zone(x["score"]) for x in scores],
                           guides=(67,), floor0=True, label="Recovery score, 30 days"), "Bars: each morning’s score · line: 67, recovered"))
    hrv7 = next((x["hrv_7d"] for x in reversed(s) if x.get("hrv_7d") is not None), None)
    cards.append(("HRV", f'<b class="n">{nf(hrv7)}</b> <span>ms · 7-day</span>',
                  plot(dates, lines=[([x.get("hrv") for x in s], "var(--tx2)", "faint"), ([x.get("hrv_7d") for x in s], "var(--tx)", "bold")],
                       band=([x.get("hrv_low") for x in s], [x.get("hrv_high") for x in s]), label="HRV, 30 nights"),
                  "Faint: nightly · bold: 7-day · green: Garmin’s balanced band"))
    rhr7 = next((x["rhr_7d"] for x in reversed(s) if x.get("rhr_7d") is not None), None)
    base = td["rhr"].get("baseline")
    cards.append(("Resting HR", f'<b class="n">{nf(rhr7, 1)}</b> <span>bpm · 7-day{f" · baseline {nf(base, 1)}" if base is not None else ""}</span>',
                  plot(dates, lines=[([x.get("rhr") for x in s], "var(--r)", "faint"), ([x.get("rhr_7d") for x in s], "var(--r)", "bold")],
                       base=base, digits=0, label="Resting heart rate, 30 days"), "Faint: daily · bold: 7-day · dashed: 30-day baseline"))
    need = [x.get("need_h") for x in s]
    asleep = n["asleep_min"] / 60 if n and n.get("asleep_min") is not None else td["sleep"].get("hours")
    debt = night["sleep"].get("debt7dH")
    cards.append(("Sleep", f'<b class="n">{hm(asleep)}</b> <span>last night{f" · 7-night debt {nf(debt, 1)} h" if debt is not None else ""}</span>',
                  plot(dates, bars=[x.get("sleep_h") for x in s], bar_colors=["var(--v)"] * len(s),
                       lines=[(need, "var(--tx)", "dash")] if any(x is not None for x in need) else (), floor0=True, unit=" h", digits=1,
                       label="Sleep hours, 30 nights")
                  + (f'<div class="hyp">{hypnogram(n)}<div class="hl">' + "".join(f'<span><i style="background:{c}"></i>{lab} {hm((n.get("totals_min") or {}).get(k, 0) / 60)}</span>' for k, lab, c in STAGES)
                     + f'<span class="m">{e(n.get("start") or "")}→{e(n.get("end") or "")}</span></div></div>' if n and n.get("segments") else ""),
                  "Bars: hours asleep · dashed: Garmin’s sleep need"))
    if body and body.get("series"):
        bs = body["series"]
        cards.append(("Body weight", f'<b class="n">{nf(body["latestKg"], 1)}</b> <span>kg{f" · target {body["targetLow"]}–{body["targetHigh"]}" if body.get("targetLow") is not None else ""}</span>',
                      plot([x["date"] for x in bs], lines=[([x["kg"] for x in bs], "var(--tx)", "bold")],
                           band=([body.get("targetLow")] * len(bs), [body.get("targetHigh")] * len(bs)) if body.get("targetLow") is not None else None,
                           digits=1, label="Body weight", year=int(L["day"][:4])), "Green: the target range"))
    html_ = "".join(f'<div class="card chart"><div class="cht"><span class="l">{t}</span><span class="chv">{v}</span></div>{p}<p class="cap">{e(c)}</p></div>'
                    for t, v, p, c in cards)
    return f'<section id="body"><h2 class="sec">Recovery &amp; sleep <span>30 days</span></h2><div class="charts">{html_}</div></section>'


def gym_section(L: dict) -> str:
    days = L["program"]["days"]
    if not days:
        return ""
    sync = {w["key"]: w["state"] for w in L["sync"]}
    nxt = next((_day_by_title(L, x["title"]) for x in sorted(L["agenda"]["scheduled"], key=lambda x: x["date"])
                if not x["done"] and _day_by_title(L, x["title"])), None)
    open_key = L["call_day"] or (nxt or {}).get("key")
    out = ""
    for d in days:
        rot = d.get("rotation") or {}
        age = rot.get("age")
        last = f"last {age} d ago" if age is not None else "not trained yet"
        st = sync.get(d["key"])
        watch = {"in_sync": ("on the watch", "var(--g)"), "changed": ("changed · not on the watch", "var(--y)"),
                 "not_pushed": ("not on the watch yet", "var(--y)")}.get(st or "", (None, None))
        flag = f'<span class="chip" style="color:var(--o);background:var(--ot)">{icon("flag", 11)}{age} days</span>' if rot.get("starved") else ""
        lead = f'<p class="lead">{icon("check", 12, 2.6, "var(--tx3)")}Core first: {e(", ".join(d["lead"]))}</p>' if d["lead"] else ""
        out += (f'<details class="pd"{" open" if d["key"] == open_key else ""}><summary><span class="pdn"><b class="n">{e(d["name"])}</b>'
                f'<span class="m">{len(d["exercises"])} exercises{f" · ~{d["est_min"]} min" if d.get("est_min") else ""} · {last}'
                f'{f" · <span style=color:{watch[1]}>{watch[0]}</span>" if watch[0] else ""}</span></span>{flag}{icon("chev", 14, 2.4)}</summary>'
                f'{lead}<ul class="exl">{"".join(exercise_row(x, True) for x in d["exercises"])}</ul></details>')
    bms = ""
    for b in L["program"]["benchmarks"]:
        last = b.get("last") or {}
        unit = f" {b['unit']}" if b.get("unit") and b["unit"] != "time" else ""
        due_col = "var(--r)" if b.get("overdue") else "var(--tx2)"
        bms += (f'<li class="bm"><span class="eni" style="color:{kind_color(b["badge"].get("kind"))}">{sport_icon(b["badge"].get("icon"), 16)}</span>'
                f'<span class="bmn"><b>{e(b["name"])}</b><span class="m" style="color:{due_col}">{"overdue · " if b.get("overdue") else "due "}{e(day(b["next"])) if b.get("next") else "—"}</span></span>'
                f'<span class="bmv"><span class="l">To beat</span><b class="n">{e(str(last["value"]) + unit) if last.get("value") is not None else "first test sets it"}</b></span></li>')
    bench = f'<div class="card"><div class="ch"><h2 class="l">Benchmarks · numbers to beat</h2></div><ul class="bml">{bms}</ul></div>' if bms else ""
    legend = " · ".join(f'<span style="color:{c}">{m}</span> {w}' for m, c, w in (ST["ok"], ST["watch"], ST["stale"], ST["new"]))
    return (f'<section id="gym"><h2 class="sec">Gym <span>numbers to beat</span></h2>{bench}<div class="card pds">{out}</div>'
            f'<p class="m quiet legend">{legend} · lines: e1RM trend</p></section>')


def races_section(L: dict) -> str:
    R = L["races"]
    if not R["list"]:
        return ""
    nxt = _race_by_id(L, R["next"])
    hero_ = ""
    if nxt:
        w = nxt["windows"]
        parts = []
        if w["before"].get("from"):
            word = WIN.get(w["before"].get("window") or "easy", WIN["easy"])[0]
            parts.append(f'<span class="win" style="color:{WIN.get(w["before"].get("window") or "easy", WIN["easy"])[1]};background:{WIN.get(w["before"].get("window") or "easy", WIN["easy"])[2]}">{word} {e(dshort(w["before"]["from"]))}–{e(dshort(w["before"]["to"]))}</span>')
        parts.append(f'<span class="win" style="color:var(--tx);background:var(--s3)">Race {e(dshort(nxt["date"]))}</span>')
        if w["recovery"].get("from"):
            parts.append(f'<span class="win" style="color:var(--v);background:var(--vt)">Recovery {e(dshort(w["recovery"]["from"]))}–{e(dshort(w["recovery"]["to"]))}</span>')
        meta = " · ".join(x for x in [day(nxt["date"]), nxt.get("start"), nxt.get("kind_label"), nxt.get("city")] if x)
        hero_ = (f'<div class="card rh"><div class="rhm"><span class="l">Next race · {e(nxt.get("priority") or "")} priority</span>'
                 f'<b class="rname">{e(nxt["name"])}</b><span class="m quiet">{e(meta)}</span>'
                 f'{f"<span class=tg>target <b class=n>sub {e(nxt["target"])}</b></span>" if nxt.get("target") else ""}</div>'
                 f'<div class="rhd"><b class="n">{nxt["days_to"]}</b><span>{"day" if nxt["days_to"] == 1 else "days"}</span></div>'
                 f'<div class="rhw">{"".join(parts)}</div>{f"<p class=quiet>{e(w["text"])}</p>" if w.get("text") else ""}</div>')
    rows = ""
    for r in R["list"]:
        res = r.get("result")
        right = (f'<b class="n">{e(res["time"])}</b>{f"<span style=color:{"var(--g)" if (res.get("vs_target_s") or 0) < 0 else "var(--r)"}> {signed(res["vs_target_s"])} s</span>" if res.get("vs_target_s") is not None else ""}'
                 if res else f'<b class="n">{r["days_to"]}</b><span class="m">days</span>' if not r.get("past") else '<span class="m quiet">past</span>')
        rows += (f'<li class="rr{" past" if r.get("past") else ""}{" a" if r.get("priority") == "A" else ""}"><span class="rp n">{e(r.get("priority") or "")}</span>'
                 f'<span class="rrn"><b>{e(r["name"])}</b><span class="m quiet">{e(day(r["date"]))} · {e(r.get("kind_label") or "")}'
                 f'{" · sub " + e(r["target"]) if r.get("target") else ""}</span></span><span class="rrd">{right}</span></li>')
    blocks = ""
    for b in R["blocks"]:
        cur = b.get("current")
        pct = round(100 * (b.get("week") or 0) / b["weeks"]) if cur and b.get("weeks") else 0
        blocks += (f'<li class="blk{" cur" if cur else ""}"><span class="bln"><b>{e(b["name"])}</b><span class="m quiet">{e(dshort(b["start"]))} – {e(dshort(b["end"]))}'
                   f'{f" · week {b["week"]} of {b["weeks"]}" if cur else ""}</span>'
                   f'{f"<span class=ble>{e(b["emphasis"])}</span>" if b.get("emphasis") else ""}</span>'
                   f'{f"<span class=blb><i style=width:{pct}%></i></span>" if cur else ""}</li>')
    season = f'<div class="card"><div class="ch"><h2 class="l">The season</h2></div><ol class="rl">{rows}</ol></div>'
    blk = f'<details class="card"><summary><h2 class="l">Training blocks</h2>{icon("chev", 14, 2.4)}</summary><ol class="bl">{blocks}</ol></details>' if blocks else ""
    return f'<section id="races"><h2 class="sec">Races</h2>{hero_}{season}{blk}</section>'


def footer(L: dict) -> str:
    f = L["freshness"]
    return (f'<footer class="foot m">A read-only snapshot of the OpenSportCoach app, built {e(day(L["day"]))} {clock(L["snapshot_at"])} '
            f'from Garmin data as of {e(day(f["data_as_of"])) + " " + clock(f["data_as_of"]) if f.get("data_as_of") else "—"}. '
            'It updates after each daily. Sending to the watch, plans and questions happen in the app on the Mac.</footer>')


def _accent(hex_: str | None, light: bool) -> tuple[str, str]:
    """The app's --id / --idt for an athlete's accent (app/web/src/main.tsx accentVars)."""
    if not hex_ or not re.match(r"^#[0-9a-fA-F]{6}$", hex_):
        return ("#8A6420", "rgba(138,100,32,.10)") if light else ("#D4B27A", "rgba(212,178,122,.14)")
    r, g, b = (int(hex_[i:i + 2], 16) for i in (1, 3, 5))
    if light:
        r, g, b = (round(c * 0.42) for c in (r, g, b))
    return f"rgb({r},{g},{b})", f"rgba({r},{g},{b},{'.10' if light else '.14'})"


def render(L: dict, display: str, accent: str | None = None) -> str:
    today = "".join(x for x in (hero(L), kpis(L), session_card(L), waiting(L)) if x)
    body = "\n".join(x for x in (today, banners(L), agenda(L), body_section(L), gym_section(L), races_section(L), footer(L)) if x)
    (d_id, d_idt), (l_id, l_idt) = _accent(accent, False), _accent(accent, True)
    return PAGE.format(title=e(f"OpenSportCoach · {display}"), top=topbar(L, display, body), sprite=SPRITE, body=body,
                       d_id=d_id, d_idt=d_idt, l_id=l_id, l_idt=l_idt)


LIGHT = ("--bg:#ECEEEC;--s1:#FFFFFF;--s2:#F5F6F4;--s3:#E9ECE9;--ln:rgba(12,16,20,.09);--ln2:rgba(12,16,20,.18);"
         "--tx:#0C1014;--tx2:#434D56;--tx3:#5B656F;--g:#077A42;--y:#8F6400;--r:#C92F37;--b:#1A64C8;--v:#5B48D0;--o:#B0550A;"
         "--gt:rgba(10,133,73,.10);--yt:rgba(143,100,0,.10);--rt:rgba(201,47,55,.09);--bt:rgba(26,100,200,.09);"
         "--vt:rgba(91,72,208,.09);--ot:rgba(176,85,10,.09);--on:#FFFFFF;--c:#0E7C86;--ct:rgba(14,124,134,.10);"
         "--sh:0 1px 2px rgba(12,16,20,.06),0 10px 28px rgba(12,16,20,.07);--id:{l_id};--idt:{l_idt};color-scheme:light;")

PAGE = """<title>{title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Layout: a phone-first briefing in one column — the call, the numbers, the week, the plots, the gym,
   the races — with sticky section links. The app's tokens (app/web/src/styles.css): dark first. */
:root {{
  --bg:#07090B;--s1:#0E1114;--s2:#14181C;--s3:#1C2126;--ln:rgba(255,255,255,.08);--ln2:rgba(255,255,255,.16);
  --tx:#F1F3F4;--tx2:#AEB6BD;--tx3:#87919A;--g:#3DDC84;--y:#F2C14E;--r:#FF6B6B;--b:#4AA3FF;--v:#A99BFF;--o:#FF9F4A;
  --gt:rgba(61,220,132,.14);--yt:rgba(242,193,78,.14);--rt:rgba(255,107,107,.14);--bt:rgba(74,163,255,.14);
  --vt:rgba(169,155,255,.14);--ot:rgba(255,159,74,.14);--on:#07090B;--c:#5BD1D7;--ct:rgba(91,209,215,.14);
  --sh:0 1px 0 rgba(255,255,255,.04) inset,0 18px 40px rgba(0,0,0,.5);--id:{d_id};--idt:{d_idt};
  --body:Barlow,"Helvetica Neue",Arial,sans-serif;--cond:"Barlow Condensed","Arial Narrow",sans-serif;--mono:"JetBrains Mono",ui-monospace,monospace;
  color-scheme:dark;
}}
@media (prefers-color-scheme: light) {{ :root:not([data-theme="dark"]) {{ """ + LIGHT + """ }} }}
:root[data-theme="light"] {{ """ + LIGHT + """ }}
body {{ background:var(--bg);color:var(--tx);font:15px/1.45 var(--body);-webkit-font-smoothing:antialiased; }}
body::before {{ content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top, 0px);z-index:30;background:var(--bg); }}
.n {{ font-family:var(--cond);font-variant-numeric:tabular-nums;font-weight:600;letter-spacing:-.005em; }}
.l {{ font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--tx3);margin:0; }}
.m {{ font-family:var(--mono);font-size:11px; }}
h1, h2, p, ul, ol {{ margin:0; }} ul, ol {{ list-style:none;padding:0; }}
.ic {{ flex:none;vertical-align:-2px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round; }}
.quiet {{ color:var(--tx3);font-size:13px; }} .m.quiet {{ font-size:11px; }}
.cap {{ text-transform:capitalize; }}
a {{ color:inherit; }}
:focus-visible {{ outline:2px solid var(--id);outline-offset:2px; }}
.chip {{ display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:999px;font-size:12px;font-weight:700; }}

.top {{ position:sticky;top:env(safe-area-inset-top, 0px);z-index:20;background:color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-top:2px solid var(--id);border-bottom:1px solid var(--ln); }}
.bar, .nav {{ max-width:880px;margin:0 auto;box-sizing:border-box;padding-left:max(16px, env(safe-area-inset-left, 0px));padding-right:max(16px, env(safe-area-inset-right, 0px)); }}
.bar {{ display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding-block:9px 6px; }}
.brand {{ display:flex;align-items:center;gap:8px; }} .brand .n {{ font-size:18px;font-weight:700;letter-spacing:.26em; }}
.who {{ display:flex;align-items:center;gap:7px;font-size:14px;font-weight:700;padding:2px 10px 2px 2px;border-radius:999px;background:var(--idt);border:1px solid var(--id); }}
.av {{ width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--id);color:var(--on);font-size:13px;font-weight:700; }}
.sp {{ flex:1; }}
.fr {{ display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--tx2);white-space:nowrap; }}
.fr.bad {{ color:var(--y);padding:3px 8px;border:1px dashed var(--y);border-radius:8px;background:var(--yt); }}
.nav {{ display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;padding-block:0 8px; }} .nav::-webkit-scrollbar {{ display:none; }}
.nav a {{ flex:none;text-decoration:none;font-size:13px;font-weight:600;color:var(--tx2);padding:5px 12px;border-radius:999px;border:1px solid var(--ln); }}
.nav a:hover {{ color:var(--tx);border-color:var(--ln2); }}

main {{ max-width:880px;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;padding-block:16px 48px;
  padding-left:max(16px, env(safe-area-inset-left, 0px));padding-right:max(16px, env(safe-area-inset-right, 0px)); }}
section[id], .hero {{ scroll-margin-top:96px; }}
section[id] {{ display:flex;flex-direction:column;gap:12px; }}
.sec {{ font-family:var(--cond);font-size:26px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;margin:18px 0 0;display:flex;align-items:baseline;gap:10px; }}
.sec span {{ font-size:12px;font-family:var(--body);font-weight:600;letter-spacing:.14em;color:var(--tx3); }}
.card {{ border-radius:16px;border:1px solid var(--ln);background:var(--s1);padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0; }}
.ch {{ display:flex;align-items:center;gap:8px; }} .ch .l {{ color:var(--tx); }}
.count {{ min-width:20px;height:20px;padding:0 6px;box-sizing:border-box;border-radius:999px;display:grid;place-items:center;background:var(--tx);color:var(--on);font-size:13px;font-weight:700; }}
details > summary {{ list-style:none;cursor:pointer; }} details > summary::-webkit-details-marker {{ display:none; }}
details > summary > .ic:last-child {{ margin-left:auto;color:var(--tx3);transition:transform .15s; }}
details[open] > summary > .ic:last-child {{ transform:rotate(90deg); }}
details.card > summary {{ display:flex;align-items:center;gap:8px; }} details.card > summary .l {{ color:var(--tx); }}

.hero {{ border-radius:20px;border:1px solid var(--ln);box-shadow:var(--sh);padding:18px 18px 20px;display:flex;flex-direction:column;gap:12px;
  background:radial-gradient(110% 120% at 0% 0%, var(--glow), transparent 62%), var(--s1); }}
.eb {{ display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px; }} .eb .l {{ color:var(--tx2); }}
.call {{ display:flex;flex-direction:column;gap:6px; }}
.verb {{ font-size:clamp(64px, 19vw, 120px);line-height:.84;font-weight:700;letter-spacing:-.02em; }}
.ttl {{ font-size:clamp(26px, 7vw, 38px);line-height:1.05;font-weight:600; }}
.why {{ font-size:18px;line-height:1.4;max-width:46ch;text-wrap:pretty; }}
.sub {{ font-size:14px;color:var(--tx2); }} .sub b {{ color:var(--tx); }}
.sigs {{ display:flex;flex-wrap:wrap;gap:6px; }}
.sig {{ display:inline-flex;align-items:center;gap:7px;padding:5px 11px 5px 6px;border-radius:999px;background:var(--s2);font-size:12px;color:var(--tx2); }}
.sig b {{ font-size:17px;color:var(--tx); }}
.sig-i {{ width:20px;height:20px;border-radius:50%;display:grid;place-items:center; }}
.cut {{ display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:12px;background:var(--s2);border:1px solid var(--ln);font-size:15px;line-height:1.4; }}
.cut .l {{ padding-top:2px; }}
.endu {{ display:flex;gap:10px;padding:8px 12px;border-radius:10px;border:1px solid var(--ln);font-size:14px; }} .endu .l {{ color:var(--b);padding-top:2px; }}
.endu.flag {{ border-color:var(--y); }} .endu.flag .l {{ color:var(--y); }}
.note {{ display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;border:1px solid var(--y);background:var(--yt);font-size:14px; }}
.more summary {{ font-size:13px;font-weight:600;color:var(--tx2);text-decoration:underline;text-underline-offset:3px; }}
.more p {{ margin-top:8px;font-size:15px;line-height:1.55;color:var(--tx2);max-width:62ch; }}
.felt {{ font-size:12px;color:var(--tx3); }}
.lastcall {{ display:flex;flex-direction:column;gap:4px;font-size:14px;color:var(--tx2);padding:10px 12px;border-radius:12px;background:var(--s2); }}
.lastcall b {{ color:var(--tx); }}

.ents {{ display:flex;flex-direction:column;gap:10px; }}
.en {{ display:flex;gap:10px;align-items:flex-start; }}
.eni {{ width:30px;height:30px;flex:none;border-radius:9px;display:grid;place-items:center;background:var(--s2); }}
.ent {{ display:flex;flex-direction:column;gap:2px;min-width:0; }} .ent b {{ font-size:15px;line-height:1.25; }}
.ens {{ display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600; }}
.end {{ font-size:13px;color:var(--tx2);line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden; }}
.zw {{ display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin-top:2px;padding:4px 8px;border-radius:8px;background:var(--s2);color:var(--tx);font-size:13px;text-decoration:none;align-self:flex-start;max-width:100%; }}
.zw b {{ font-weight:700; }} .zw span {{ color:var(--tx2);font-size:12px; }} .zw:hover {{ background:var(--s3); }}
.sess {{ border-top:1px solid var(--ln);padding-top:10px;display:flex;flex-direction:column;gap:6px; }}
.sh {{ display:flex;align-items:baseline;gap:10px;flex-wrap:wrap; }} .sh .n {{ font-size:20px; }} .sh .m {{ color:var(--tx3); }}
.lead {{ display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx3); }}
.exl {{ display:flex;flex-direction:column; }}
.ex {{ display:grid;grid-template-columns:16px minmax(0, 1fr) auto;align-items:baseline;gap:2px 10px;padding:8px 0;border-top:1px solid var(--ln); }}
.ex:first-child {{ border-top:0; }}
.mk {{ font-weight:700;font-size:13px;text-align:center; }}
.exn {{ display:flex;flex-direction:column;gap:1px;min-width:0; }} .exn b {{ font-size:14px;font-weight:600; }}
.beat {{ font-size:12px;color:var(--tx2);line-height:1.35; }}
.rx {{ font-size:15px;color:var(--tx);white-space:nowrap;text-align:right; }}
.tr {{ grid-column:3;width:64px;justify-self:end; }}

.item {{ display:flex;gap:10px;align-items:flex-start;padding:10px;border-radius:12px;background:var(--bg);border:1px solid var(--ln2); }}
.ib {{ flex:none;width:26px;height:26px;border-radius:7px;display:grid;place-items:center; }}
.it {{ display:flex;flex-direction:column;gap:2px;min-width:0; }} .it .l {{ font-size:9px; }}
.it-t {{ font-size:14px;font-weight:700;line-height:1.3; }} .it-s {{ font-size:12px;color:var(--tx2);line-height:1.35; }}

.kpis {{ display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:1px;border-radius:16px;background:var(--ln);border:1px solid var(--ln);overflow:hidden; }}
.kpi {{ background:var(--s1);padding:12px 12px 8px;display:flex;flex-direction:column;gap:3px;min-width:0; }}
.kpi.rec {{ grid-column:1 / -1;flex-direction:row;align-items:center;gap:14px;padding:12px 14px; }}
.ring {{ position:relative;flex:none; }} .ring-in {{ position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center; }}
.rv {{ font-size:36px;line-height:.9;font-weight:700; }}
.rt {{ display:flex;flex-direction:column;gap:4px;min-width:0; }}
.st {{ display:inline-flex;align-items:center;gap:6px;font-size:15px;font-weight:700; }} .rn {{ font-size:13px;color:var(--tx2);line-height:1.4; }}
.kv {{ display:flex;align-items:baseline;gap:4px;flex-wrap:wrap; }} .kn {{ font-size:30px;line-height:1;font-weight:700; }}
.ks {{ margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--tx3); }}
.delta {{ display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;line-height:1.25; }}
.spark {{ display:block;margin-top:3px; }}
.spark .ln, .plot .ln {{ fill:none;stroke-width:1.6;stroke-linejoin:round;vector-effect:non-scaling-stroke; }}
.ln.faint {{ stroke-width:1.1;opacity:.4; }} .ln.bold {{ stroke-width:2.2; }} .ln.dash {{ stroke-width:1.3;stroke-dasharray:3 3; }}
.spark .base, .plot .guide {{ fill:none;stroke:var(--tx3);stroke-width:1;stroke-dasharray:2 3;vector-effect:non-scaling-stroke; }}

section.banners {{ display:grid;grid-template-columns:repeat(auto-fit, minmax(min(300px, 100%), 1fr));gap:12px; }}
.bn {{ border-radius:16px;border:1px solid var(--ln);background:var(--s1);padding:14px 16px;display:flex;flex-direction:column;gap:8px;border-top:3px solid; }}
.gymb {{ border-top-color:var(--o); }} .cardb {{ border-top-color:var(--b); }}
.bh {{ display:flex;align-items:center;gap:8px; }} .gymb .bh {{ color:var(--o); }} .cardb .bh {{ color:var(--b); }} .bh .l {{ color:var(--tx); }}
.bn-big {{ display:flex;align-items:baseline;gap:6px;font-size:15px;color:var(--tx2); }} .bn-big b {{ font-size:40px;line-height:1;color:var(--tx); }}
.bn-row {{ font-size:15px;color:var(--tx2); }} .bn-row b {{ font-size:20px;color:var(--tx); }}
.bn-cmp {{ display:flex;flex-direction:column;gap:2px;font-size:13px;padding-top:8px;border-top:1px solid var(--ln); }}
.vs {{ color:var(--tx3);font-size:12px;margin-left:4px; }}
.flagl {{ display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--o);background:var(--ot);padding:6px 8px;border-radius:8px; }}
.bumps {{ display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx2); }}
.pips {{ display:flex;flex-direction:column;gap:8px; }}
.pip {{ display:grid;grid-template-columns:72px 1fr auto;align-items:center;gap:10px; }}
.pl {{ display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600;color:var(--tx2); }}
.dots {{ display:flex;gap:6px; }}
.dots i {{ width:16px;height:16px;border-radius:50%;border:2px solid var(--b);box-sizing:border-box; }}
.dots i.on {{ background:var(--b); }} .dots i.over {{ border-color:var(--g); }} .dots i.on.over {{ background:var(--g); }}
.pc {{ font-size:20px; }}

.agenda {{ display:flex;flex-direction:column; }}
.ad {{ display:grid;grid-template-columns:52px minmax(0, 1fr);gap:12px;padding:12px 0;border-top:1px solid var(--ln); }}
.ad:first-child {{ border-top:0;padding-top:4px; }}
.adw {{ display:flex;flex-direction:column;align-items:center;gap:0;padding-top:2px; }}
.adw b {{ font-size:26px;line-height:1; }} .adw .l {{ font-size:10px; }} .adm {{ font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:.08em; }}
.ad.now .adw .l, .ad.now .adw b {{ color:var(--id); }}
.adb {{ display:flex;flex-direction:column;gap:8px;min-width:0; }}
.rest {{ font-size:14px;color:var(--tx3);padding-top:6px; }}
.en.tpl {{ opacity:.62; }} .en.tpl .eni {{ color:var(--tx3);background:transparent;border:1px dashed var(--ln2); }} .en.tpl .ens {{ color:var(--tx3);font-weight:500; }}
.win {{ align-self:flex-start;display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:700; }}
.bmk {{ display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--o); }}
.donew summary {{ display:flex;align-items:center;gap:10px; }}
.dlist {{ display:flex;flex-direction:column;gap:8px; }} .dlist li {{ display:grid;grid-template-columns:52px minmax(0, 1fr);gap:10px;align-items:baseline; }}
.dl {{ display:flex;flex-direction:column;gap:3px;min-width:0; }} .dli {{ display:flex;align-items:center;gap:6px;font-size:13px; }}
.dli span {{ color:var(--tx); }} .dli i {{ font-style:normal;color:var(--tx3); }}

.charts {{ display:grid;grid-template-columns:repeat(auto-fit, minmax(min(320px, 100%), 1fr));gap:12px; }}
.chart {{ gap:8px; }}
.cht {{ display:flex;flex-direction:column;gap:2px; }} .chv {{ font-size:13px;color:var(--tx2); }} .chv b {{ font-size:26px;color:var(--tx); }}
.plot {{ position:relative;padding-right:34px; }} .plot svg {{ display:block;overflow:visible; }}
.yl {{ position:absolute;right:0;transform:translateY(-50%);font-family:var(--mono);font-size:10px;color:var(--tx3);background:var(--s1);padding-left:3px; }}
.xl {{ display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--tx3);padding-right:34px; }}
.chart .cap {{ font-size:11px;color:var(--tx3);text-transform:none; }}
.hyp {{ margin-top:6px;display:flex;flex-direction:column;gap:6px; }}
.hl {{ display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--tx2); }} .hl i {{ display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px; }}

.pds {{ padding:4px 16px; }}
.pd {{ border-top:1px solid var(--ln); }} .pd:first-child {{ border-top:0; }}
.pd > summary {{ display:flex;align-items:center;gap:10px;padding:12px 0; }}
.pdn {{ display:flex;flex-direction:column;gap:2px;min-width:0; }} .pdn .n {{ font-size:20px; }} .pdn .m {{ color:var(--tx3); }}
.pd[open] {{ padding-bottom:10px; }}
.legend {{ padding:0 4px; }}
.bml {{ display:flex;flex-direction:column; }}
.bm {{ display:grid;grid-template-columns:30px minmax(0, 1fr) auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--ln); }}
.bm:first-child {{ border-top:0; }}
.bmn {{ display:flex;flex-direction:column;gap:1px;min-width:0; }} .bmn b {{ font-size:14px; }}
.bmv {{ display:flex;flex-direction:column;align-items:flex-end;gap:1px;text-align:right; }} .bmv .l {{ font-size:9px; }} .bmv b {{ font-size:16px; }}

.rh {{ display:grid;grid-template-columns:minmax(0, 1fr) auto;gap:10px 14px;align-items:start;border-top:3px solid var(--o); }}
.rhm {{ display:flex;flex-direction:column;gap:3px;min-width:0; }} .rname {{ font-size:22px;line-height:1.15; }}
.tg {{ font-size:14px;color:var(--tx2); }} .tg b {{ font-size:18px;color:var(--tx); }}
.rhd {{ display:flex;flex-direction:column;align-items:center; }} .rhd b {{ font-size:54px;line-height:.9;color:var(--o); }} .rhd span {{ font-size:12px;color:var(--tx3); }}
.rhw {{ grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:6px; }}
.rh > p {{ grid-column:1 / -1; }}
.rl {{ display:flex;flex-direction:column; }}
.rr {{ display:grid;grid-template-columns:24px minmax(0, 1fr) auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--ln); }}
.rr:first-child {{ border-top:0; }} .rr.past {{ opacity:.6; }}
.rp {{ width:24px;height:24px;border-radius:6px;display:grid;place-items:center;font-size:14px;font-weight:700;border:1px solid var(--ln2);color:var(--tx2); }}
.rr.a .rp {{ background:var(--o);border-color:var(--o);color:var(--on); }}
.rrn {{ display:flex;flex-direction:column;gap:1px;min-width:0; }} .rrn b {{ font-size:14px; }}
.rrd {{ display:flex;align-items:baseline;gap:4px; }} .rrd b {{ font-size:20px; }}
.bl {{ display:flex;flex-direction:column;gap:2px; }}
.blk {{ display:flex;flex-direction:column;gap:6px;padding:9px 0;border-top:1px solid var(--ln); }} .blk:first-child {{ border-top:0; }}
.bln {{ display:flex;flex-direction:column;gap:1px; }} .bln b {{ font-size:14px; }} .ble {{ font-size:12px;color:var(--tx2); }}
.blk.cur b {{ color:var(--id); }}
.blb {{ height:4px;border-radius:2px;background:var(--s3);overflow:hidden; }} .blb i {{ display:block;height:100%;background:var(--id); }}
.foot {{ color:var(--tx3);line-height:1.6;padding-top:8px; }}

@media (min-width: 640px) {{
  .kpis {{ grid-template-columns:repeat(3, minmax(0, 1fr)); }}
  .hero {{ padding:24px 26px 26px; }}
  .card {{ padding:16px 20px; }}
}}
@media (prefers-reduced-motion: reduce) {{ * {{ transition:none !important; }} }}
</style>
{sprite}
{top}
<main>
{body}
</main>
"""


# --- commands ----------------------------------------------------------------------------------
def _opted_in(A) -> str | None:
    return (A.config.get("app") or {}).get("artifact_opt_in")


def _record(A) -> dict:
    try:
        return json.loads(A.artifact_record.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def build_fixture(folder: Path, out: Path) -> dict:
    """The Demo athlete's page, from the committed fixtures — no athlete, no cache."""
    index = json.loads((folder / "index.json").read_text())
    views = {k: json.loads((folder / "views" / f"{k}.json").read_text()) for k in VIEWS}
    system = json.loads((folder / "views" / "system.json").read_text())
    page = render(lite(views), index["display"], system.get("accent"))
    out.write_text(page)
    return {"athlete": index["athlete"], "display": index["display"], "file": str(out), "bytes": len(page.encode())}


def build(A) -> dict:
    if not _opted_in(A):
        sys.exit(f"refused: {A.display} hasn't opted in to the lite page — it puts health data on claude.ai. "
                 f"Ask them; on a yes, set app.artifact_opt_in to today's date in athletes/{A.name}/athlete.json.")
    import app_data
    with contextlib.redirect_stdout(sys.stderr):
        views = {k: app_data.run_view(k) for k in VIEWS}
    page = render(lite(views), A.display, (A.config.get("app") or {}).get("accent"))
    A.app_dir.mkdir(parents=True, exist_ok=True)
    A.artifact_page.write_text(page)
    return {"athlete": A.name, "display": A.display, "file": str(A.artifact_page), "bytes": len(page.encode()),
            "url": _record(A).get("url")}


def record(A, url: str) -> dict:
    if not URL_RE.match(url or ""):
        sys.exit(f"refused: {url!r} is not a claude.ai artifact link.")
    old = _record(A).get("url")
    if old and old != url:
        sys.exit(f"refused: {A.display}'s page is already {old}. Every daily updates that one; "
                 f"delete {A.artifact_record} first if it really moved.")
    A.app_dir.mkdir(parents=True, exist_ok=True)
    rec = {"url": url, "athlete": A.name, "recorded_at": dt.datetime.now().isoformat(timespec="seconds")}
    A.artifact_record.write_text(json.dumps(rec, indent=1) + "\n")
    return rec


def main() -> None:
    fixture = "--fixture" in sys.argv
    if not fixture:
        athlete.current()   # consumes --athlete before argparse sees it
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=("build", "record", "status"))
    p.add_argument("url", nargs="?")
    p.add_argument("--fixture", help="a fixture folder (app/fixtures/demo): builds that synthetic athlete's page")
    p.add_argument("--out", help="with --fixture: where to write the page")
    a = p.parse_args()
    if a.fixture:
        if a.command != "build" or not a.out:
            sys.exit("--fixture builds only, and needs --out.")
        print(json.dumps(build_fixture(Path(a.fixture), Path(a.out))))
        return
    if a.out:
        sys.exit("--out is for --fixture only: an athlete's page lives where athlete.py puts it.")
    A = athlete.current()
    if a.command == "build":
        print(json.dumps(build(A)))
    elif a.command == "record":
        print(json.dumps(record(A, a.url or "")))
    else:
        print(json.dumps({"athlete": A.name, "opted_in": _opted_in(A), "page": str(A.artifact_page),
                          "built": A.artifact_page.exists(), **_record(A)}))


if __name__ == "__main__":
    main()
