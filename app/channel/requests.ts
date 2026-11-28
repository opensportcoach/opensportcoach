/**
 * What the page may ask the coach for, and the parameters each kind takes — checked by the server
 * (http.ts) and, through the same function, by the page's component tests (app/web/src/test/), so a
 * button that sends a shape the server refuses fails a test instead of failing silently.
 *
 * 2026-10-11 (docs/DESIGN.md (app audit) R1): the pending-question buttons sent `question` with `pending_id`, which
 * this list did not allow; the server refused every answer and the page showed the refusal beside
 * a check mark. The hand-kept list of "shapes the page sends" in lib.test.ts had missed it.
 *
 * Confirms go through /api/confirm, never this list.
 */
export const REQUEST_KINDS = ['question', 'workflow', 'plan', 'accept', 'push', 'checkin'] as const;

/**
 * Each kind's parameters (docs/DESIGN.md (app audit) H3, 2026-10-10). Until then `accept` meant four things —
 * accept a plan proposal, accept a pending bump, "send the pending changes" and "retry a failed
 * push" — and the skill documented one. Now each intent has its kind and its parameters, the server
 * refuses anything else, and .claude/skills/osc-app/SKILL.md has a row for each.
 *   question  ask anything             about? flag? pending_id? (the answer to the daily's pending question)
 *   workflow  run a skill              name: daily|week|review|audit|races, activity_id? date? auto?
 *             (races = "Check dates": the coach looks the races up online → a race_check result;
 *             auto = an analysis the server queued itself for a new ride or run, lib.ts dueAnalyses)
 *   plan      propose, no edits        move? to? proposal? (the proposal this asks to change — a new version of it)
 *   accept    apply what was proposed  proposal | pending_id   (exactly one)
 *   push      dry-run what isn't on the watch yet → a push_plan   retry? (the failed plan's hash)
 *   checkin   how they feel            feel (1–5) note?
 * `about` (what the question is about, from "Ask about this") is allowed on every kind.
 */
type ParamType = 'string' | 'number' | 'boolean';
export const REQUEST_PARAMS: Record<string, Record<string, ParamType>> = {
  question: { flag: 'boolean', pending_id: 'string' },
  workflow: { name: 'string', activity_id: 'string', date: 'string', auto: 'boolean' },
  plan: { move: 'string', to: 'string', proposal: 'string' },
  accept: { proposal: 'string', pending_id: 'string' },
  push: { retry: 'string' },
  checkin: { feel: 'number', note: 'string' },
};
const WORKFLOWS = ['daily', 'week', 'review', 'audit', 'races'];

// --- fuel (docs/DESIGN.md (fuelling and score) §7) ---------------------------------------------------------------
// Not requests: the page writes these through the server's own actions, which run scripts/fuel.py with
// no model, as a refresh runs refresh.sh. Checked here so the page's tests hold the same shape.
/** A product or bottle by id — or `custom`: something not in the catalog, named, with the carbohydrate
 * in one read off its label by the athlete (self-reported, like every log). */
export type FuelItem = { kind: 'product' | 'recipe'; id: string; n: number } | { kind: 'custom'; label: string; g_each: number; n: number };
/** POST /api/actions/fuel: what was taken during one session — items, or `nothing`, never both. */
export interface FuelLogBody { activity_id: number; items: FuelItem[]; nothing?: boolean; as_planned?: boolean; note?: string }
/** POST /api/actions/fuel-setup: any of the setup answers. */
export interface FuelSetupBody {
  products?: string[];
  recipes?: { id: string; label?: string; product: string; powder_g: number; water_ml: number }[];
  gut?: number;
  caffeine?: 'never' | 'races' | 'training';
  notes?: string | null;
}
// An id the server passes to fuel.py as `kind:id:n` (an argument, never a shell): no colon, no space.
const FUEL_ID = /^[\w.-]{1,64}$/;

export function checkFuelLog(b: unknown): string | null {
  const x = (b ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(x.activity_id) || (x.activity_id as number) <= 0) return 'activity_id must be a whole number';
  const items = x.items;
  if (!Array.isArray(items) || items.length > 12) return 'items must be a list of at most 12';
  for (const it of items as Record<string, unknown>[]) {
    if (it && it.kind === 'custom') {
      if (typeof it.label !== 'string' || !it.label.trim() || it.label.length > 60 || /[|\n]/.test(it.label)) return 'something else needs a name (at most 60 characters)';
      if (typeof it.g_each !== 'number' || !(it.g_each > 0 && it.g_each <= 150)) return 'something else needs its carbohydrate in one: 1–150 g';
    } else {
      if (!it || (it.kind !== 'product' && it.kind !== 'recipe')) return 'an item is a product, a recipe or something else';
      if (typeof it.id !== 'string' || !FUEL_ID.test(it.id)) return 'an item names its id';
    }
    if (!Number.isInteger(it.n) || (it.n as number) < 1 || (it.n as number) > 30) return 'a count is a whole number from 1 to 30';
  }
  if (!!x.nothing === items.length > 0) return 'name what was taken, or say nothing was — exactly one';
  if (x.as_planned != null && typeof x.as_planned !== 'boolean') return 'as_planned is true or false';
  if (x.note != null && (typeof x.note !== 'string' || x.note.length > 300)) return 'note is text, at most 300 characters';
  for (const k of Object.keys(x)) if (!['activity_id', 'items', 'nothing', 'as_planned', 'note'].includes(k)) return `fuel takes no "${k}"`;
  return null;
}

export function checkFuelSetup(b: unknown): string | null {
  const x = (b ?? {}) as Record<string, unknown>;
  const keys = Object.keys(x);
  if (!keys.length) return 'nothing to save';
  for (const k of keys) if (!['products', 'recipes', 'gut', 'caffeine', 'notes'].includes(k)) return `setup takes no "${k}"`;
  if (x.products !== undefined && !(Array.isArray(x.products) && x.products.length <= 20 && x.products.every((p) => typeof p === 'string' && FUEL_ID.test(p)))) return 'products is a list of product ids';
  if (x.recipes !== undefined) {
    if (!Array.isArray(x.recipes) || x.recipes.length > 10) return 'recipes is a list of at most 10';
    for (const r of x.recipes as Record<string, unknown>[]) {
      if (!r || typeof r.id !== 'string' || !FUEL_ID.test(r.id) || typeof r.product !== 'string' || !FUEL_ID.test(r.product)) return 'a recipe names its id and its product';
      if (typeof r.powder_g !== 'number' || !(r.powder_g > 0 && r.powder_g <= 200)) return 'powder_g is 0–200 g';
      if (typeof r.water_ml !== 'number' || !(r.water_ml >= 100 && r.water_ml <= 1500)) return 'water_ml is 100–1500 ml';
      if (r.label != null && (typeof r.label !== 'string' || r.label.length > 40)) return 'a recipe label is at most 40 characters';
    }
  }
  if (x.gut !== undefined && !(typeof x.gut === 'number' && x.gut >= 0 && x.gut <= 120)) return 'gut is 0–120 g an hour';
  if (x.caffeine !== undefined && !['never', 'races', 'training'].includes(String(x.caffeine))) return 'caffeine is never, races or training';
  if (x.notes != null && (typeof x.notes !== 'string' || x.notes.length > 500)) return 'notes is text, at most 500 characters';
  return null;
}

/** Why a request's parameters are refused, or null. */
export function checkRequest(kind: string, params: Record<string, unknown> | undefined): string | null {
  const spec = REQUEST_PARAMS[kind];
  if (!spec) return `unknown request kind ${kind}`;
  const p = params ?? {};
  for (const [k, v] of Object.entries(p)) {
    const type = k === 'about' ? 'string' : spec[k];
    if (!type) return `${kind} takes no parameter "${k}"`;
    if (typeof v !== type) return `${kind}.${k} must be a ${type}`;
    if (typeof v === 'string' && v.length > 300) return `${kind}.${k} is too long`;
  }
  if (kind === 'workflow' && !WORKFLOWS.includes(String(p.name))) return `workflow.name must be one of ${WORKFLOWS.join(', ')}`;
  if (kind === 'accept' && (p.proposal === undefined) === (p.pending_id === undefined)) return 'accept takes exactly one of proposal, pending_id';
  if (kind === 'checkin' && !(Number.isInteger(p.feel) && (p.feel as number) >= 1 && (p.feel as number) <= 5)) return 'checkin.feel must be 1–5';
  return null;
}

// --- trips (docs/DESIGN.md (trips)) ----------------------------------------------------------------------
// Not requests either: the page writes the athlete's own trips through the server's action, which runs
// scripts/trips.py with no model. trips.py checks the rest (overlaps, dates in order); this holds the shape.
export const TRIP_ACCESS = ['gym', 'pool', 'bike', 'trainer', 'run', 'courts'] as const;
export type TripAccess = (typeof TRIP_ACCESS)[number];
export type TripState = 'yes' | 'maybe' | 'no';
export interface TripBody {
  id?: string;
  where: string;
  from: string;
  to: string;
  access: Record<TripAccess, TripState>;
  time?: 'normal' | 'limited' | null;
  leave?: 'morning' | 'afternoon' | 'evening' | null;
  back?: 'morning' | 'afternoon' | 'evening' | null;
  note?: string | null;
}
/** POST /api/actions/trips: save a trip (add, or replace by id), remove one, or settle a maybe. */
export type TripAction =
  | { action: 'save'; trip: TripBody }
  | { action: 'remove'; id: string }
  | { action: 'answer'; id: string; access: TripAccess; state: 'yes' | 'no' };
const TRIP_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const PARTS = ['morning', 'afternoon', 'evening'];

export function checkTrip(b: unknown): string | null {
  const x = (b ?? {}) as Record<string, unknown>;
  const only = (keys: string[]) => Object.keys(x).find((k) => !keys.includes(k));
  if (x.action === 'remove') {
    if (only(['action', 'id'])) return `remove takes no "${only(['action', 'id'])}"`;
    return typeof x.id === 'string' && TRIP_ID.test(x.id) ? null : 'remove names the trip by its id';
  }
  if (x.action === 'answer') {
    if (only(['action', 'id', 'access', 'state'])) return `answer takes no "${only(['action', 'id', 'access', 'state'])}"`;
    if (typeof x.id !== 'string' || !TRIP_ID.test(x.id)) return 'answer names the trip by its id';
    if (!TRIP_ACCESS.includes(x.access as TripAccess)) return `access is one of ${TRIP_ACCESS.join(', ')}`;
    return x.state === 'yes' || x.state === 'no' ? null : 'an answer is yes or no';
  }
  if (x.action !== 'save') return 'action is save, remove or answer';
  if (only(['action', 'trip'])) return `save takes no "${only(['action', 'trip'])}"`;
  const t = (x.trip ?? {}) as Record<string, unknown>;
  const keys = ['id', 'where', 'from', 'to', 'access', 'time', 'leave', 'back', 'note'];
  const extra = Object.keys(t).find((k) => !keys.includes(k));
  if (extra) return `a trip has no "${extra}"`;
  if (t.id != null && (typeof t.id !== 'string' || !TRIP_ID.test(t.id))) return 'id is a lowercase slug';
  if (typeof t.where !== 'string' || !t.where.trim() || t.where.length > 60) return 'say where (at most 60 characters)';
  if (typeof t.from !== 'string' || !ISO.test(t.from) || typeof t.to !== 'string' || !ISO.test(t.to)) return 'from and to are dates';
  if (t.to < t.from) return 'it ends before it starts';
  const acc = (t.access ?? {}) as Record<string, unknown>;
  if (typeof t.access !== 'object' || t.access === null) return 'say yes, maybe or no for every place';
  for (const k of TRIP_ACCESS) if (!['yes', 'maybe', 'no'].includes(String(acc[k]))) return `say yes, maybe or no for ${k}`;
  const unknown = Object.keys(acc).find((k) => !TRIP_ACCESS.includes(k as TripAccess));
  if (unknown) return `no place "${unknown}"`;
  if (t.time != null && t.time !== 'normal' && t.time !== 'limited') return 'time is normal or limited';
  for (const k of ['leave', 'back']) if (t[k] != null && !PARTS.includes(String(t[k]))) return `${k} is morning, afternoon or evening`;
  if (t.note != null && (typeof t.note !== 'string' || t.note.length > 300)) return 'note is text, at most 300 characters';
  return null;
}
