#!/usr/bin/env python3
"""Fuelling: the athlete's products, a session's carbohydrate plan in those products, and what they took.

    .venv/bin/python scripts/fuel.py products                          # the shared catalog — no athlete needed
    .venv/bin/python scripts/fuel.py need 150 endurance bike           # the g/h band and its sentence — no athlete
    .venv/bin/python scripts/fuel.py plan 150 endurance bike [--rehearsal] [--json]
    .venv/bin/python scripts/fuel.py log <activity_id> --item product:maurten-gel-160:2 --item recipe:bottle:1 \
                                        [--as-planned] [--note "…"]
    .venv/bin/python scripts/fuel.py taken <activity_id> [--json]
    .venv/bin/python scripts/fuel.py setup --answers '{"products": ["maurten-gel-160"], "caffeine": "races"}'
    .venv/bin/python scripts/fuel.py add-product --json '{…}'         # a verified product → the shared catalog

WHY (2026-11-06, docs/DESIGN.md (fuelling and score)). An athlete asked for carbohydrate advice in the products he owns
(Maurten Gel 160, a MNSTRY drink mix) and for what he takes during a session to be tracked. Before
this, fuelling advice was prose with nothing behind it: the demo ride review said "60 g an hour" and
no number in the repo backed it.

RULES THIS FILE KEEPS
  * The rule (how many grams an hour) is formulas.py's — carb_band, carb_target. This file only turns
    grams into products and records what was taken.
  * A product's numbers come from the shared catalog (nutrition/PRODUCTS.json, through athlete.py →
    PRODUCTS_PATH), which carries each one's source and the date it was checked. Nothing here types a
    product's carbohydrate (memory/convention/fuel-products-verified.md).
  * Which products an athlete owns, how they mix a bottle, their gut's trained rate and caffeine are
    theirs: athletes/<name>/fuel.json (athlete.py → fuel_path).
  * Every item names its kind — `product` or `recipe` — because an athlete's recipe id and a product
    id could be the same word: a lookup that cannot tell the two apart is CLAUDE.md's defect #1.
  * A record stores each item's grams as they were that day (`g_each`), so changing a recipe later
    never rewrites what was taken before.
  * Intake is self-reported: every record's source is `you` unless Garmin itself recorded it.
  * A maker's limits (`max_g_per_h`, `max_g_per_session`, `easy_only`) are catalog fields, and plan()
    never goes past them. On foot the plan is gels. A product left out of a plan is named in its
    notes, with the reason.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402
import formulas as f  # noqa: E402

FORMS = ("gel", "drink_mix", "bar", "chew")
SOURCE_KINDS = ("maker", "label", "listing")
CAFFEINE = ("never", "races", "training")
ITEM_KINDS = ("product", "recipe", "custom")   # custom: something not in the catalog, its carbs read off the label by the athlete
CUSTOM_MAX_G = 150
LOG_SOURCES = ("you", "garmin")
GUT_START_G_H = 30   # someone who takes nothing today starts the ramp here, not at zero
FIRST_INTAKE_MIN = 20
LAST_INTAKE_BEFORE_END_MIN = 15
# A maker's own limits, optional on a catalog entry and read off the same page as its numbers: grams of
# the product as sold (a mix's powder, a gel's serving) an hour and per session. `easy_only` marks a
# product its maker makes for low-intensity work (MNSTRY Slow Carb: isomaltulose, slow to absorb).
LIMITS = ("max_g_per_h", "max_g_per_session")

# The setup questions, asked the first time a session is bound to the athlete (scripts/setup_status.py).
SETUP_TEXT = {
    "products": "Which fuelling products do you use — gels, drink mixes, bars? Pick them from the catalog, "
                "or name one and the coach looks it up on the maker's page.",
    "recipes": "How do you mix a bottle of each drink mix: grams of powder, and the bottle's size in ml?",
    "gut": "What do you take today on a 2–3 hour ride, in grams of carbohydrate an hour — none, about 30, "
           "about 60 or about 90? Has anything upset your stomach?",
    "caffeine": "Caffeine: never, in races only, or in training too?",
}
SETUP = tuple(SETUP_TEXT)
EMPTY = {"products": [], "recipes": [], "gut": None, "caffeine": None, "notes": None,
         "setup": {q: None for q in SETUP}}


# --- reading -----------------------------------------------------------------------------------
def catalog(path: Path | None = None) -> dict:
    """Product id → product, from the shared catalog."""
    raw = json.loads((path or athlete.PRODUCTS_PATH).read_text())
    return {p["id"]: p for p in raw.get("products") or []}


def load_cfg(a: athlete.Athlete) -> dict:
    """The athlete's fuel.json, or the empty setup when there is none."""
    if not a.fuel_path.exists():
        return json.loads(json.dumps(EMPTY))
    cfg = json.loads(a.fuel_path.read_text())
    for k, v in EMPTY.items():
        cfg.setdefault(k, json.loads(json.dumps(v)))
    for q in SETUP:
        cfg["setup"].setdefault(q, None)
    return cfg


def load_log(a: athlete.Athlete) -> dict:
    return json.loads(a.fuel_log_path.read_text()) if a.fuel_log_path.exists() else {"records": []}


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


# --- the products ------------------------------------------------------------------------------
def product_problems(p: dict) -> list[str]:
    """What is wrong with a catalog entry: a product without its carbohydrate, its form, or the source
    and date it was read from is refused."""
    bad = []
    pid = p.get("id") or "?"
    if not p.get("id") or not str(p["id"]).replace("-", "").isalnum() or p["id"] != p["id"].lower():
        bad.append(f"{pid}: id must be lowercase letters, digits and dashes")
    if not p.get("brand") or not p.get("name"):
        bad.append(f"{pid}: brand and name")
    if p.get("form") not in FORMS:
        bad.append(f"{pid}: form must be one of {FORMS}")
    if p.get("form") == "drink_mix":
        if not (isinstance(p.get("carbs_per_100g"), (int, float)) and 0 < p["carbs_per_100g"] <= 100):
            bad.append(f"{pid}: a drink mix needs carbs_per_100g (0–100) — it is dosed by the athlete's recipe")
    elif not (isinstance(p.get("carbs_g"), (int, float)) and 0 < p["carbs_g"] <= 150):
        bad.append(f"{pid}: carbs_g per serving (0–150)")
    for k in ("serving_g", "kcal", "sodium_mg", "caffeine_mg"):
        if p.get(k) is not None and not (isinstance(p[k], (int, float)) and p[k] >= 0):
            bad.append(f"{pid}: {k} must be a number ≥ 0 or null")
    for k in LIMITS:
        if p.get(k) is not None and not (isinstance(p[k], (int, float)) and p[k] > 0):
            bad.append(f"{pid}: {k} — the maker's limit in grams of product — must be a number above 0, or absent")
    if any(p.get(k) for k in LIMITS) and p.get("form") != "drink_mix" and not p.get("serving_g"):
        bad.append(f"{pid}: a limit in grams needs serving_g, to count servings against it")
    if "easy_only" in p and not isinstance(p["easy_only"], bool):
        bad.append(f"{pid}: easy_only must be true or false")
    gf = p.get("glucose_fructose")
    if gf is not None:
        try:
            a, b = (float(x) for x in str(gf).split(":"))
            assert a > 0 and b >= 0
        except Exception:
            bad.append(f"{pid}: glucose_fructose must read like 1:0.8")
    if not str(p.get("source") or "").startswith("https://"):
        bad.append(f"{pid}: source must be the https page it was read from")
    if p.get("source_kind") not in SOURCE_KINDS:
        bad.append(f"{pid}: source_kind must be one of {SOURCE_KINDS}")
    try:
        if dt.date.fromisoformat(p.get("checked") or "") > dt.date.today():
            bad.append(f"{pid}: checked in the future")
    except ValueError:
        bad.append(f"{pid}: checked must be the date it was read (YYYY-MM-DD)")
    return bad


def recipe_grams(r: dict, cat: dict) -> int:
    """Carbohydrate in one bottle of a recipe: grams of powder × the mix's carbohydrate per 100 g."""
    p = cat[r["product"]]
    return round(r["powder_g"] * p["carbs_per_100g"] / 100)


def item_grams(kind: str, iid: str, cfg: dict, cat: dict) -> int:
    """Grams of carbohydrate in one unit of an item: a serving of a product, or one bottle of a recipe."""
    if kind == "recipe":
        r = next((x for x in cfg.get("recipes") or [] if x.get("id") == iid), None)
        if r is None:
            raise ValueError(f"no recipe {iid!r} in this athlete's fuel.json")
        return recipe_grams(r, cat)
    if kind != "product":
        raise ValueError(f"an item is a product or a recipe, not {kind!r}")
    p = cat.get(iid)
    if p is None:
        raise ValueError(f"no product {iid!r} in the catalog")
    if p["form"] == "drink_mix":
        if not p.get("serving_g"):
            raise ValueError(f"{iid} is a drink mix with no serving size: log it as one of your recipes")
        return round(p["serving_g"] * p["carbs_per_100g"] / 100)
    return round(p["carbs_g"])


def label(kind: str, iid: str, cfg: dict, cat: dict) -> str:
    if kind == "recipe":
        r = next(x for x in cfg.get("recipes") or [] if x.get("id") == iid)
        p = cat.get(r["product"]) or {}
        return f"{r.get('label') or 'Bottle'} · {p.get('brand', '')} {p.get('name', '')}".strip()
    p = cat[iid]
    return f"{p['brand']} {p['name']}"


def cfg_problems(cfg: dict, cat: dict) -> list[str]:
    """What is wrong with an athlete's fuel.json: products the catalog doesn't know, a recipe for a
    product they don't own or that isn't a drink mix, a gut rate out of range, an unknown answer."""
    bad = []
    owned = cfg.get("products") or []
    bad += [f"product {p!r} is not in nutrition/PRODUCTS.json" for p in owned if p not in cat]
    ids = [r.get("id") for r in cfg.get("recipes") or []]
    if len(ids) != len(set(ids)) or not all(ids):
        bad.append(f"recipe ids must be present and unique: {ids}")
    for r in cfg.get("recipes") or []:
        if r.get("product") not in owned:
            bad.append(f"recipe {r.get('id')!r}: its product {r.get('product')!r} is not one they own")
        elif (cat.get(r["product"]) or {}).get("form") != "drink_mix":
            bad.append(f"recipe {r.get('id')!r}: {r['product']} is not a drink mix")
        if not (isinstance(r.get("powder_g"), (int, float)) and 0 < r["powder_g"] <= 200):
            bad.append(f"recipe {r.get('id')!r}: powder_g (0–200)")
        if not (isinstance(r.get("water_ml"), (int, float)) and 100 <= r["water_ml"] <= 1500):
            bad.append(f"recipe {r.get('id')!r}: water_ml (100–1500)")
        if r.get("id") in cat:
            bad.append(f"recipe {r.get('id')!r} has a product's id — name it something else")
    gut = cfg.get("gut")
    if gut is not None:
        if not (isinstance(gut.get("g_per_h"), (int, float)) and GUT_START_G_H <= gut["g_per_h"] <= 120):
            bad.append(f"gut.g_per_h must be {GUT_START_G_H}–120")
        try:
            dt.date.fromisoformat(gut.get("since") or "")
        except ValueError:
            bad.append("gut.since must be a date")
    if cfg.get("caffeine") is not None and cfg["caffeine"] not in CAFFEINE:
        bad.append(f"caffeine must be one of {CAFFEINE}")
    unknown = set(cfg.get("setup") or {}) - set(SETUP)
    if unknown:
        bad.append(f"unknown setup questions {sorted(unknown)}")
    for q, when in (cfg.get("setup") or {}).items():
        if when is not None:
            try:
                dt.date.fromisoformat(when)
            except ValueError:
                bad.append(f"setup.{q} must be the date it was answered, or null")
    return bad


def setup_missing(cfg: dict, cat: dict) -> list[str]:
    """The setup questions still open, in asking order. Recipes stay open while products are, and
    reopen when they own a drink mix with no recipe."""
    s = cfg.get("setup") or {}
    out = [q for q in ("products",) if not s.get(q)]
    mixes = [p for p in cfg.get("products") or [] if (cat.get(p) or {}).get("form") == "drink_mix"]
    mixed = {r.get("product") for r in cfg.get("recipes") or []}
    if not s.get("products") or (mixes and (not s.get("recipes") or set(mixes) - mixed)):
        out.append("recipes")
    out += [q for q in ("gut", "caffeine") if not s.get(q)]
    return out


# --- a session's plan --------------------------------------------------------------------------
def _round5(x: float) -> int:
    return int(math.floor(x / 5 + 0.5) * 5)


def _nearest(x: float) -> int:
    """The nearest whole number, a half rounding DOWN — toward less in the stomach."""
    return max(0, math.ceil(x - 0.5))


OVER_CAP_SLACK_G_H = 5   # a whole gel may carry a plan this far over the gut's cap — half a training step


def allowance(p: dict, unit_g: float, minutes: float) -> int | None:
    """How many units of a product — a bottle's powder, a gel's serving — its maker allows in a session
    of this length: the per-session limit, and the hourly limit over the session's hours. None when the
    maker gives no limit."""
    n = None
    if p.get("max_g_per_session") is not None:
        n = int(p["max_g_per_session"] // unit_g)
    if p.get("max_g_per_h") is not None:
        h = int(p["max_g_per_h"] * minutes / 60 // unit_g)
        n = h if n is None else min(n, h)
    return n


def fits(p: dict, intent: str) -> bool:
    """A product its maker makes for easy work is planned only on an easy session."""
    return not (p.get("easy_only") and intent in f.HARD_INTENTS)


def _slots(minutes: float, floors: list[float]) -> list[float]:
    """Minutes for each bottle, in drinking order: an even share of the session, at most an hour each —
    except a bottle whose maker limits it an hour, which gets at least the time that limit asks for
    (46 g of powder at 46 g an hour: a full hour). The others share what is left."""
    lens: list[float | None] = [None] * len(floors)
    free, left = list(range(len(floors))), float(minutes)
    while free:
        share = min(60.0, left / len(free))
        slow = [i for i in free if floors[i] > share]
        if not slow:
            break
        for i in slow:
            lens[i], left = floors[i], left - floors[i]
            free.remove(i)
    for i in free:
        lens[i] = min(60.0, left / len(free))
    return lens


def plan(minutes: float, intent: str, sport: str, cfg: dict, cat: dict, rehearsal: bool = False) -> dict:
    """A session's carbohydrate in the athlete's own products, with a timeline.

    The rate is formulas.py's. The grams become bottles first — one per hour at most — then gels fill
    what is left: the nearest whole number (a half rounds down), the one with the most carbohydrate
    first, and never more than 5 g/h over the gut's cap. The first gel at 0:20, the rest spread evenly
    to 15 minutes before the end. With no products set up, the plan is grams only, and says so.

    The athlete's recipes are drunk in turn. A mix its maker makes for easy work goes first, on an easy
    session only — MNSTRY's "SLOW CARB in the initial phase", then FAST or POWER CARB. No product goes
    past its maker's limits (`max_g_per_h`, `max_g_per_session`): a capped bottle is drunk no faster
    than its hourly limit, and when its session limit is reached the next recipe, then the gels, carry
    the rest. On foot the plan is gels, not bottles; only someone with no gel gets a bottle there (a
    flask), and the plan says so. Every product left out is named in `notes`, with the reason."""
    lo, hi = f.carb_band(minutes, intent, sport)
    gut = (cfg.get("gut") or {}).get("g_per_h")
    target = f.carb_target(lo, hi, intent, gut, rehearsal) if hi else 0
    total = _round5(target * minutes / 60)
    cap = f.gut_cap(gut, rehearsal)
    out = {"minutes": round(minutes), "intent": intent, "sport": sport, "band": [lo, hi], "cap_g_h": cap,
           "slack_g_h": OVER_CAP_SLACK_G_H,
           "target_g_h": target, "total_g": total, "gut_g_h": gut, "rehearsal": rehearsal,
           "items": [], "timeline": [], "planned_g": 0, "planned_g_h": 0, "setup_needed": False,
           "needed": bool(target), "notes": []}
    if not target:
        return out
    owned = [cat[p] for p in cfg.get("products") or [] if p in cat]
    all_gels = sorted((p for p in owned if p["form"] != "drink_mix"), key=lambda p: -p["carbs_g"])
    all_recipes = [r for r in cfg.get("recipes") or [] if r.get("product") in cat]
    if not all_gels and not all_recipes:
        out["setup_needed"] = True
        return out
    notes = out["notes"]
    gels = []
    for p in all_gels:
        if fits(p, intent):
            gels.append(p)
        else:
            notes.append(f"{p['brand']} {p['name']}: made for easy sessions, so not on a {intent} one")
    recipes = []
    if sport != "bike" and gels and all_recipes:
        notes.append("on foot: gels, not bottles")
        all_recipes = []
    for r in all_recipes:
        p, name = cat[r["product"]], label("recipe", r["id"], cfg, cat)
        if not fits(p, intent):
            notes.append(f"{name}: made for easy sessions, so not on a {intent} one")
        elif recipe_grams(r, cat) <= 0:
            notes.append(f"{name}: no carbohydrate in a bottle, so it is not planned")
        elif p.get("max_g_per_h") is not None and r["powder_g"] > p["max_g_per_h"]:
            notes.append(f"{name}: {r['powder_g']} g of powder a bottle is over the maker's {p['max_g_per_h']} g "
                         "an hour, so it is not planned")
        else:
            recipes.append(r)
    recipes.sort(key=lambda r: not cat[r["product"]].get("easy_only"))   # stable: the athlete's order otherwise
    if sport != "bike" and recipes:
        notes.append("on foot with no gel set up: the bottle is a flask you carry")
    if not gels and not recipes:
        notes.append("none of your products fits this session: grams only")
        return out

    hours = math.ceil(minutes / 60)
    limit_g = (cap + OVER_CAP_SLACK_G_H) * minutes / 60
    grams = {r["id"]: recipe_grams(r, cat) for r in recipes}
    room = {r["id"]: allowance(cat[r["product"]], r["powder_g"], minutes) for r in recipes}
    floor = {r["id"]: 60 * r["powder_g"] / cat[r["product"]]["max_g_per_h"]
             if cat[r["product"]].get("max_g_per_h") else 0.0 for r in recipes}
    bottles, g = [], 0
    while not (gels and len(bottles) >= hours):
        used = sum(floor[b["id"]] for b in bottles)
        r = next((r for r in recipes if (room[r["id"]] is None or room[r["id"]] > 0)
                  and used + floor[r["id"]] <= minutes), None)
        if r is None:
            break
        gr = grams[r["id"]]
        if bottles and g + gr > limit_g:
            break
        if gels and g + gr > total:
            break
        if not gels and bottles and total - g <= gr / 2:   # the nearest whole bottle, a half rounding down
            break
        bottles.append(r)
        g += gr
        if room[r["id"]] is not None:
            room[r["id"]] -= 1
    for r in recipes:
        n = sum(1 for b in bottles if b["id"] == r["id"])
        if n:
            out["items"].append({"kind": "recipe", "id": r["id"], "label": label("recipe", r["id"], cfg, cat),
                                 "n": n, "g_each": grams[r["id"]], "g": n * grams[r["id"]]})
    at = 0.0
    for b, length in zip(bottles, _slots(minutes, [floor[b["id"]] for b in bottles])):
        out["timeline"].append({"at": round(at), "until": round(min(at + length, minutes)), "kind": "recipe", "id": b["id"]})
        at += length
    for r in recipes:   # name a limit only where it changed the plan: another recipe took over after it
        mine = [i for i, b in enumerate(bottles) if b["id"] == r["id"]]
        if room[r["id"]] == 0 and mine and any(b["id"] != r["id"] for b in bottles[mine[-1] + 1:]):
            notes.append(f"{label('recipe', r['id'], cfg, cat)}: {len(mine)} a session, the maker's limit; "
                         "the next recipe carries on")

    units = []
    for p in gels:
        ge = round(p["carbs_g"])
        n = _nearest((total - g) / ge)
        cap_n = allowance(p, p["serving_g"], minutes) if any(p.get(k) for k in LIMITS) else None
        if cap_n is not None and n > cap_n:
            n = cap_n
            notes.append(f"{p['brand']} {p['name']}: its maker's limit is reached at {cap_n}")
        while n and g + n * ge > limit_g:
            n -= 1
        if n:
            out["items"].append({"kind": "product", "id": p["id"], "label": label("product", p["id"], cfg, cat),
                                 "n": n, "g_each": ge, "g": n * ge})
            units += [p["id"]] * n
            g += n * ge
    if units:
        first, last = FIRST_INTAKE_MIN, max(FIRST_INTAKE_MIN, minutes - LAST_INTAKE_BEFORE_END_MIN)
        times = [_round5((first + last) / 2)] if len(units) == 1 else [
            _round5(first + i * (last - first) / (len(units) - 1)) for i in range(len(units))]
        out["timeline"] += [{"at": t, "kind": "product", "id": pid} for t, pid in zip(times, units)]
    out["timeline"].sort(key=lambda x: x["at"])
    out["planned_g"] = sum(i["g"] for i in out["items"])
    out["planned_g_h"] = round(out["planned_g"] / (minutes / 60))
    _dress(out, cfg, cat, minutes)
    return out


# --- what the page draws (the design round of 2026-11-07) ----
GEL_FORMS = ("gel", "chew", "bar")
MARK_SLOTS = ("1", "2", "3", "4")   # styles.css --f-1 … --f-4: OpenSportCoach's own colours, never a maker's


def display(kind: str, iid: str, cfg: dict, cat: dict) -> dict:
    """How an item is drawn: a colour slot, a monogram and a shape. A gel is always the gel colour; the
    athlete's drink mixes take slots 1, 2, 3 in the order they own them, so a colour means the same
    product on every screen."""
    pid = iid if kind == "product" else next((r["product"] for r in cfg.get("recipes") or [] if r.get("id") == iid), iid)
    p = cat.get(pid) or {}
    if p.get("form") in GEL_FORMS:
        return {"slot": "gel", "mono": {"gel": "GEL", "chew": "CHW", "bar": "BAR"}[p["form"]], "shape": "gel"}
    mixes = [x for x in cfg.get("products") or [] if (cat.get(x) or {}).get("form") == "drink_mix"]
    slot = MARK_SLOTS[mixes.index(pid) % len(MARK_SLOTS)] if pid in mixes else MARK_SLOTS[-1]
    words = [w for w in (p.get("name") or pid).split() if w[:1].isalpha()]
    return {"slot": slot, "mono": "".join(w[0] for w in words[:2]).upper() or "?", "shape": "bottle"}


def short_name(kind: str, iid: str, cfg: dict, cat: dict) -> str:
    """The product's own name, without its brand: 'Slow Carb Heat', 'Gel 160'."""
    pid = iid if kind == "product" else next((r["product"] for r in cfg.get("recipes") or [] if r.get("id") == iid), iid)
    return (cat.get(pid) or {}).get("name") or iid


def _dress(out: dict, cfg: dict, cat: dict, minutes: float) -> None:
    """The fields the fuel card draws, worked out here so the page adds nothing: each item's mark and
    short name, the cue sheet's lines, the grams in each clock hour, and the next whole-unit option the
    plan turned down, with why."""
    for it in out["items"]:
        it.update(display=display(it["kind"], it["id"], cfg, cat), short=short_name(it["kind"], it["id"], cfg, cat))
    names = {(i["kind"], i["id"]): i["short"] for i in out["items"]}
    grams = {(i["kind"], i["id"]): i["g_each"] for i in out["items"]}
    seen: dict = {}
    cues = []
    for t in out["timeline"]:
        k = (t["kind"], t["id"])
        seen[k] = seen.get(k, 0) + 1
        nth = seen[k]
        lbl = names.get(k, t["id"])
        how = (f"sip it through to {_hm(t['until'])}" if t.get("until") is not None and t["until"] < minutes - 1
               else "sip it to the end") if t["kind"] == "recipe" else "with a mouthful of water"
        cues.append({"at": t["at"], "until": t.get("until"), "kind": t["kind"], "id": t["id"],
                     "label": f"{_ordinal(nth)} {lbl}" if nth > 1 else lbl, "how": how,
                     "display": display(t["kind"], t["id"], cfg, cat)})
    out["cues"] = cues
    hours = []
    for h in range(math.ceil(minutes / 60)):
        a, b = h * 60, min((h + 1) * 60, minutes)
        g = 0.0
        for t in out["timeline"]:
            ge = grams.get((t["kind"], t["id"]), 0)
            if t.get("until") is not None:
                span = max(1e-9, t["until"] - t["at"])
                g += ge * max(0.0, min(b, t["until"]) - max(a, t["at"])) / span
            elif a <= t["at"] < b or (t["at"] == b == minutes):
                g += ge
        hours.append({"from": a, "to": round(b), "g": round(g)})
    out["per_hour_grams"] = hours
    out["over_cap_g_h"] = max(0, out["planned_g_h"] - out["cap_g_h"])
    out["alternatives"] = []
    units = sorted({i["g_each"] for i in out["items"]})
    if units and out["planned_g_h"] < out["target_g_h"]:
        g = out["planned_g"] + units[0]
        gh = round(g / (minutes / 60))
        limit = out["cap_g_h"] + out["slack_g_h"]
        out["alternatives"].append({"grams": g, "g_h": gh, "over_cap_by": gh - out["cap_g_h"],
                                    "rejected": "over_gut" if gh > limit else None})


def _hm(m: float) -> str:
    return f"{int(m) // 60}:{int(m) % 60:02d}"


def _ordinal(n: int) -> str:
    return {2: "2nd", 3: "3rd"}.get(n, f"{n}th")


# --- the gut-training ramp --------------------------------------------------------------------
RAMP_MIN = 90          # a session this long counts toward the gut ramp (docs/DESIGN.md (fuelling and score) §4.1)
RAMP_RIDES_PER_STEP = 1   # approved 2026-11-06: one logged session at the current rate earns the next step


def ramp(cfg: dict, log: dict, activities: dict, race_g_h: tuple[int, int] | None = None) -> dict | None:
    """The gut-training ramp: every logged ride or run of 90 minutes or more (g/h taken, and whether it
    counts — at or above the current rate, since that rate was set), the current rate, the next step,
    the steps up to the race band. None before the gut is set."""
    gut = cfg.get("gut")
    if not gut:
        return None
    rate, since = gut["g_per_h"], gut.get("since") or ""
    hist = []
    for r in log.get("records") or []:
        a = activities.get(r["activity_id"])
        if not a:
            continue
        s = summary(r, a)
        if (s["minutes"] or 0) < RAMP_MIN or a.get("_group") not in DUE_GROUPS:
            continue
        hist.append({"activity_id": r["activity_id"], "date": r["date"], "minutes": s["minutes"], "g_h": s["g_h"],
                     "title": a.get("activityName"), "group": a.get("_group"),
                     "counted": r["date"] >= since and (s["g_h"] or 0) >= rate})
    hist.sort(key=lambda x: x["date"])
    counted = sum(1 for x in hist if x["counted"])
    top = (race_g_h or (60, 90))[1]
    steps = list(range(rate, max(rate, top) + 1, f.GUT_STEP_G_H))
    return {"current_g_h": rate, "since": since, "how": gut.get("how"), "step_g_h": f.GUT_STEP_G_H,
            "rides_per_step": RAMP_RIDES_PER_STEP, "min_minutes": RAMP_MIN, "counted_at_current": counted,
            "next_g_h": rate + f.GUT_STEP_G_H if rate < top else None, "race_band": list(race_g_h or (60, 90)),
            "steps": steps, "history": hist}


# --- what was taken ----------------------------------------------------------------------------
def parse_item(spec: str) -> tuple[str, str, int]:
    """`product:maurten-gel-160:2` → ("product", "maurten-gel-160", 2)."""
    try:
        kind, iid, n = spec.split(":")
        n = int(n)
    except ValueError:
        raise ValueError(f"an item reads kind:id:count, e.g. product:maurten-gel-160:2 — not {spec!r}")
    if kind not in ("product", "recipe") or n <= 0:
        raise ValueError(f"{spec!r}: kind is product or recipe, count is a whole number above 0")
    return kind, iid, n


def parse_custom(spec: str) -> dict:
    """`Clif Bar|44|2` → a custom item: its name, the carbohydrate in one (read off its label by the
    athlete) and the count."""
    try:
        name, g, n = spec.rsplit("|", 2)
        g, n = float(g), int(n)
    except ValueError:
        raise ValueError(f"a custom item reads name|grams of carbohydrate in one|count — not {spec!r}")
    return custom_item(name, g, n)


def custom_item(name: str, g_each: float, n: int) -> dict:
    name = " ".join(str(name).split())
    if not 0 < len(name) <= 60:
        raise ValueError("a custom item needs a name of at most 60 characters")
    if not (0 < g_each <= CUSTOM_MAX_G) or not (isinstance(n, int) and n > 0):
        raise ValueError(f"{name}: carbohydrate in one is 1–{CUSTOM_MAX_G} g, and the count a whole number above 0")
    slug = "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")[:40] or "item"
    return {"kind": "custom", "id": slug, "label": name, "n": n, "g_each": round(g_each)}


def record(activity: dict, items: list[tuple[str, str, int]], cfg: dict, cat: dict, as_planned: bool = False,
           note: str | None = None, source: str = "you", custom: list[dict] | None = None) -> dict:
    """One session's intake, with each item's grams as they are today. `custom` holds what isn't in the
    catalog: its name and the carbohydrate the athlete read off its label — self-reported, like the rest."""
    if source not in LOG_SOURCES:
        raise ValueError(f"source must be one of {LOG_SOURCES}")
    rows = [{"kind": k, "id": i, "n": n, "g_each": item_grams(k, i, cfg, cat)} for k, i, n in items]
    rows += [custom_item(c["label"], c["g_each"], c["n"]) for c in custom or []]
    return {"activity_id": int(activity["activityId"]), "date": activity["startTimeLocal"][:10], "items": rows,
            "as_planned": bool(as_planned), "note": note or None, "source": source,
            "logged_at": dt.datetime.now().replace(microsecond=0).isoformat()}


def summary(rec: dict, activity: dict | None) -> dict:
    """Grams taken, and per hour over the session's moving time."""
    g = sum(r["n"] * r["g_each"] for r in rec["items"])
    secs = (activity or {}).get("movingDuration") or (activity or {}).get("duration") or 0
    return {**rec, "g": g, "minutes": round(secs / 60) if secs else None,
            "g_h": round(g / (secs / 3600)) if secs else None}


# --- for the app's views (scripts/app_data.py) -------------------------------------------------
DUE_MIN = 60                 # a ride or run this long, since setup, with nothing logged, asks to be logged
DUE_GROUPS = ("bike", "run")
DUE_DAYS = 7                 # Today asks about the last week; the Workouts list filters for every one


def pantry(cfg: dict, cat: dict) -> list[dict]:
    """What the log form offers, in the order a plan uses them: each recipe (a bottle), then each
    owned product that isn't a drink mix — with the grams in one."""
    out = [{"kind": "recipe", "id": r["id"], "label": label("recipe", r["id"], cfg, cat), "unit": "bottle",
            "how": f"{r['powder_g']:g} g powder · {r['water_ml']:g} ml", "g_each": recipe_grams(r, cat)}
           for r in cfg.get("recipes") or [] if r.get("product") in cat]
    out += [{"kind": "product", "id": p, "label": label("product", p, cfg, cat), "unit": cat[p]["form"],
             "how": f"{cat[p]['serving_g']:g} g {cat[p]['form']}" if cat[p].get("serving_g") else cat[p]["form"],
             "g_each": item_grams("product", p, cfg, cat)}
            for p in cfg.get("products") or [] if p in cat and cat[p]["form"] != "drink_mix"]
    for x in out:
        x.update(display=display(x["kind"], x["id"], cfg, cat), short=short_name(x["kind"], x["id"], cfg, cat))
    return out


def others(cfg: dict, cat: dict) -> list[dict]:
    """Catalog products the athlete doesn't own but could log one of: a gel, bar or chew, or a drink mix
    with a serving size — with the grams in one."""
    owned = set(cfg.get("products") or [])
    out = []
    for p in cat.values():
        if p["id"] in owned or (p["form"] == "drink_mix" and not p.get("serving_g")):
            continue
        out.append({"kind": "product", "id": p["id"], "label": f"{p['brand']} {p['name']}", "short": p["name"],
                    "unit": "serving" if p["form"] == "drink_mix" else p["form"], "g_each": item_grams("product", p["id"], cfg, cat),
                    "display": display("product", p["id"], cfg, cat)})
    return out


def is_due(activity: dict, group: str, cfg: dict, logged: bool) -> bool:
    """A ride or run of an hour or more, on or after the day the athlete's products were set up, with
    nothing logged for it — not even "nothing"."""
    since = (cfg.get("setup") or {}).get("products")
    secs = activity.get("movingDuration") or activity.get("duration") or 0
    return (not logged and group in DUE_GROUPS and since is not None
            and activity["startTimeLocal"][:10] >= since and secs >= DUE_MIN * 60)


def gut_on(cfg: dict, date: str | None) -> dict:
    """The setup as it stood on `date`: the gut rate in force that day. A rate changes (the ramp goes
    up; a declared rate is corrected), and a past session keeps the plan it was given — read at
    today's rate, the 11-07 ride planned at 60 g/h re-scored itself against 40 the day the rate was
    corrected (app audit 2026-11-10). Before the first rate on record, the earliest one stands."""
    gut = cfg.get("gut")
    if not gut or not date or not gut.get("history") or date >= (gut.get("since") or ""):
        return cfg
    past = sorted(gut["history"], key=lambda h: h.get("since") or "")
    hit = next((h for h in reversed(past) if (h.get("since") or "") <= date), past[0])
    return {**cfg, "gut": {**gut, "g_per_h": hit["g_per_h"], "since": hit.get("since")}}


def for_session(session: dict, cfg: dict, cat: dict) -> dict | None:
    """A planned session's fuel (plan.json), or None when it names no `intent` or no `duration_min`:
    the rule needs both, and guesses neither. At the gut rate in force on the session's own date."""
    import sports
    intent, mins = session.get("intent"), session.get("duration_min")
    if intent not in f.INTENTS or not mins:
        return None
    return plan(mins, intent, sports.group(session.get("sport")), gut_on(cfg, session.get("date")), cat)


def describe(rec: dict, activity: dict | None, cfg: dict, cat: dict) -> dict:
    """A record as the page shows it: grams, g/h, and each item's name — its id, if the recipe has
    since been removed."""
    items = []
    for it in rec["items"]:
        if it["kind"] == "custom":
            words = [w for w in it["label"].split() if w[:1].isalnum()]
            items.append({**it, "short": it["label"], "g": it["n"] * it["g_each"],
                          "display": {"slot": "4", "mono": "".join(w[0] for w in words[:2]).upper() or "?", "shape": "gel"}})
            continue
        try:
            name = label(it["kind"], it["id"], cfg, cat)
        except (KeyError, StopIteration):
            name = it["id"]
        items.append({**it, "label": name, "short": short_name(it["kind"], it["id"], cfg, cat), "display": display(it["kind"], it["id"], cfg, cat),
                      "g": it["n"] * it["g_each"]})
    return {**summary(rec, activity), "items": items}


def log_problems(log: dict, cfg: dict, cat: dict) -> list[str]:
    bad = []
    recs = log.get("records")
    if not isinstance(recs, list):
        return ["logs/fuel.json needs a records list"]
    ids = [r.get("activity_id") for r in recs]
    if len(ids) != len(set(ids)):
        bad.append("one record per activity")
    recipes = {r.get("id") for r in cfg.get("recipes") or []}
    for r in recs:
        aid = r.get("activity_id")
        if not isinstance(aid, int):
            bad.append(f"{aid!r}: activity_id must be an integer")
        try:
            dt.date.fromisoformat(r.get("date") or "")
        except ValueError:
            bad.append(f"{aid}: date")
        if r.get("source") not in LOG_SOURCES:
            bad.append(f"{aid}: source must be one of {LOG_SOURCES}")
        for it in r.get("items") or []:
            if it.get("kind") not in ITEM_KINDS:
                bad.append(f"{aid}: item kind {it.get('kind')!r}")
            elif it["kind"] == "product" and it.get("id") not in cat:
                bad.append(f"{aid}: product {it.get('id')!r} is not in the catalog")
            elif it["kind"] == "recipe" and it.get("id") not in recipes:
                bad.append(f"{aid}: recipe {it.get('id')!r} is not in fuel.json")
            elif it["kind"] == "custom" and not (isinstance(it.get("label"), str) and 0 < len(it["label"]) <= 60
                                                and isinstance(it.get("g_each"), (int, float)) and it["g_each"] <= CUSTOM_MAX_G):
                bad.append(f"{aid}: a custom item needs its name and the carbohydrate in one (at most {CUSTOM_MAX_G} g)")
            if not (isinstance(it.get("n"), int) and it["n"] > 0):
                bad.append(f"{aid}: count must be a whole number above 0")
            if not (isinstance(it.get("g_each"), (int, float)) and it["g_each"] > 0):
                bad.append(f"{aid}: g_each — the grams as they were that day")
    return bad


# --- setup -------------------------------------------------------------------------------------
def apply_setup(cfg: dict, answers: dict, cat: dict, today: dt.date | None = None) -> dict:
    """Record setup answers. Each answered question is dated; anything unknown is refused. Someone who
    takes nothing today starts the gut ramp at 30 g/h, not at zero."""
    today = (today or dt.date.today()).isoformat()
    unknown = set(answers) - set(SETUP) - {"notes"}
    if unknown:
        raise ValueError(f"unknown setup answers {sorted(unknown)} — the questions are {list(SETUP)}")
    cfg = json.loads(json.dumps(cfg))
    if "products" in answers:
        missing = [p for p in answers["products"] if p not in cat]
        if missing:
            raise ValueError(f"not in the catalog: {missing} — look each one up on the maker's page and add it "
                             "with `fuel.py add-product` first")
        cfg["products"] = list(dict.fromkeys(answers["products"]))
        cfg["setup"]["products"] = today
    if "recipes" in answers:
        cfg["recipes"] = [{k: v for k, v in r.items() if k in ("id", "label", "product", "powder_g", "water_ml")}
                          for r in answers["recipes"]]
        cfg["setup"]["recipes"] = today
    if "gut" in answers:
        g = answers["gut"] if isinstance(answers["gut"], dict) else {"g_per_h": answers["gut"]}
        rate = max(GUT_START_G_H, int(g["g_per_h"]))
        prev = cfg.get("gut") or {}
        # Every earlier rate stays, with the day it was set: a session is planned and scored at the
        # rate in force on ITS day (gut_on), never at today's.
        history = (prev.get("history") or []) + ([{"g_per_h": prev["g_per_h"], "since": prev.get("since")}]
                                                  if prev.get("g_per_h") and prev["g_per_h"] != rate else [])
        cfg["gut"] = {"g_per_h": rate, "since": today,
                      "how": g.get("how") or ("setup: takes none today — the ramp starts here" if g["g_per_h"] < GUT_START_G_H
                                              else "setup: what they take on a 2–3 h ride"),
                      "note": g.get("note"), **({"history": history} if history else {})}
        cfg["setup"]["gut"] = today
    if "caffeine" in answers:
        cfg["caffeine"] = answers["caffeine"]
        cfg["setup"]["caffeine"] = today
    if "notes" in answers:
        cfg["notes"] = answers["notes"] or None
    bad = cfg_problems(cfg, cat)
    if bad:
        raise ValueError("; ".join(bad))
    return cfg


# --- CLI ---------------------------------------------------------------------------------------
def _activity(aid: int) -> dict:
    import export_dashboard_data as ed
    a = next((x for x in ed.all_activities() if x.get("activityId") == aid), None)
    if a is None:
        sys.exit(f"no activity {aid} in the cache — refresh first")
    return a


def _print_plan(p: dict) -> None:
    print(f"{p['minutes']} min · {p['intent']} · {p['sport']}: band {p['band'][0]}–{p['band'][1]} g/h, "
          f"gut cap {p['cap_g_h']} → plan {p['target_g_h']} g/h, {p['total_g']} g")
    if not p["needed"]:
        print("  no fuel needed")
    elif p["setup_needed"]:
        print("  in grams only — no products set up yet (scripts/setup_status.py)")
    for it in p["items"]:
        print(f"  {it['n']} × {it['label']} ({it['g_each']} g) = {it['g']} g")
    if p["items"]:
        print("  timeline: " + ", ".join(f"{t['at'] // 60}:{t['at'] % 60:02d} {t['id']}" for t in p["timeline"]))
        print(f"  planned {p['planned_g']} g = {p['planned_g_h']} g/h")
    for n in p.get("notes") or []:
        print(f"  note: {n}")


def sport_group(arg: str) -> str:
    """The rule's sport for a command-line argument: a group as it stands, a Garmin typeKey through the
    sport map. Anything else is refused. Until 2026-11-22 the argument went to the rule raw, so
    `plan 150 endurance cycling` was read as on foot: half the band, and gels in place of his bottles
    (a typeKey the rule cannot tell from a run — CLAUDE.md's defect #1)."""
    import sports
    if arg in f.SPORT_GROUPS:
        return arg
    if arg in sports.SPORT_GROUP:
        return sports.SPORT_GROUP[arg]
    raise argparse.ArgumentTypeError(f"unknown sport {arg!r}: a group ({', '.join(sorted(f.SPORT_GROUPS))}) "
                                     "or a Garmin typeKey from scripts/sports.py")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("products")
    for name in ("need", "plan"):
        s = sub.add_parser(name)
        s.add_argument("minutes", type=float)
        s.add_argument("intent", choices=sorted(f.INTENTS))
        s.add_argument("sport", type=sport_group,
                       help="a group (bike · run · swim · strength · race · other) or a Garmin typeKey (cycling, virtual_ride, running…)")
        s.add_argument("--rehearsal", action="store_true", help="a gut-training session: +10 g/h")
        s.add_argument("--json", action="store_true")
    s = sub.add_parser("log")
    s.add_argument("activity_id", type=int)
    s.add_argument("--item", action="append", default=[], help="kind:id:count")
    s.add_argument("--as-planned", action="store_true")
    s.add_argument("--custom", action="append", default=[], help="something not in the catalog: name|carbs in one (g)|count")
    s.add_argument("--nothing", action="store_true", help="they took nothing: a record of zero, so it stops asking")
    s.add_argument("--note")
    s = sub.add_parser("taken")
    s.add_argument("activity_id", type=int)
    s.add_argument("--json", action="store_true")
    s = sub.add_parser("setup")
    s.add_argument("--answers", required=True, help="JSON: any of products, recipes, gut, caffeine, notes")
    s = sub.add_parser("add-product")
    s.add_argument("--json", required=True)
    args = ap.parse_args()
    cat = catalog()

    if args.cmd == "products":
        for p in cat.values():
            carbs = f"{p['carbs_per_100g']} g/100 g" if p["form"] == "drink_mix" else f"{p['carbs_g']} g"
            print(f"  {p['id']:28} {p['brand']} {p['name']} · {p['form']} · {carbs} · checked {p['checked']} ({p['source_kind']})")
        return
    if args.cmd == "need":
        lo, hi = f.carb_band(args.minutes, args.intent, args.sport)
        out = {"band": [lo, hi], "definition": f.FUEL_DEFINITIONS["carb_band"]}
        print(json.dumps(out) if args.json else f"{lo}–{hi} g/h · {out['definition']}")
        return
    if args.cmd == "add-product":
        p = json.loads(args.json)
        bad = product_problems(p) + ([f"{p['id']} is already in the catalog"] if p.get("id") in cat else [])
        if bad:
            sys.exit("REFUSED: " + "; ".join(bad))
        raw = json.loads(athlete.PRODUCTS_PATH.read_text())
        raw["products"].append(p)
        _write(athlete.PRODUCTS_PATH, raw)
        print(f"added {p['id']} — an engine change: commit it on its own, never with an athlete's files")
        return

    a = athlete.current()
    cfg = load_cfg(a)
    if args.cmd == "plan":
        p = plan(args.minutes, args.intent, args.sport, cfg, cat, args.rehearsal)
        print(json.dumps(p, indent=1)) if args.json else _print_plan(p)
    elif args.cmd == "setup":
        try:
            new = apply_setup(cfg, json.loads(args.answers), cat)
        except ValueError as e:
            sys.exit(f"REFUSED: {e}")
        _write(a.fuel_path, new)
        left = setup_missing(new, cat)
        print(f"{a.display}: fuel setup saved." + (f" Still open: {', '.join(left)}." if left else " Setup complete."))
    elif args.cmd == "log":
        if bool(args.item or args.custom) == args.nothing:
            sys.exit("REFUSED: name what was taken with --item kind:id:count or --custom name|g|n, or --nothing — exactly one")
        act = _activity(args.activity_id)
        try:
            rec = record(act, [parse_item(x) for x in args.item], cfg, cat, args.as_planned, args.note,
                         custom=[parse_custom(x) for x in args.custom])
        except ValueError as e:
            sys.exit(f"REFUSED: {e}")
        log = load_log(a)
        log["records"] = [r for r in log["records"] if r.get("activity_id") != rec["activity_id"]] + [rec]
        log["records"].sort(key=lambda r: (r["date"], r["activity_id"]))
        _write(a.fuel_log_path, log)
        s = summary(rec, act)
        print(f"{a.display} · {rec['date']} · activity {rec['activity_id']}: {s['g']} g"
              + (f" over {s['minutes']} min = {s['g_h']} g/h" if s["g_h"] is not None else ""))
    elif args.cmd == "taken":
        rec = next((r for r in load_log(a)["records"] if r["activity_id"] == args.activity_id), None)
        if rec is None:
            print(json.dumps(None) if args.json else f"nothing logged for activity {args.activity_id}")
            return
        s = summary(rec, _activity(args.activity_id))
        print(json.dumps(s, indent=1) if args.json else
              f"{s['g']} g" + (f" over {s['minutes']} min = {s['g_h']} g/h" if s["g_h"] is not None else ""))


if __name__ == "__main__":
    main()
