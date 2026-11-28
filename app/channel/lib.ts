/**
 * The channel server's pure parts — request gating, view-name checks and the request book — with no
 * HTTP or MCP in them, so they can be tested directly (test/*.test.ts). docs/DESIGN.md (the app) → Security,
 * Requests and results.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export const MAX_BODY_BYTES = 64 * 1024;
export const COOKIE = 'adn_t';

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export function sameToken(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Whether a request may be routed at all. Checked before anything else:
 *  - Host must be this server's own loopback name. A DNS-rebinding page arrives with its own
 *    hostname in Host, so it is refused here (the hole found in the Meal Prep bridge).
 *  - A browser labels every request with where it came from: only this page ('same-origin') or a
 *    URL typed into the address bar ('none') pass. A non-browser client sends neither header.
 *  - An Origin, when sent, must be this server — or, in fixtures mode only, the Vite dev server
 *    (`devOrigin`) that proxies to it.
 */
export function gate(headers: IncomingHttpHeaders, port: number, devOrigin?: string): string | null {
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowed.includes(String(headers.host ?? ''))) return 'wrong host';
  const origins = allowed.map((h) => `http://${h}`).concat(devOrigin ? [devOrigin] : []);
  const site = headers['sec-fetch-site'];
  const origin = headers.origin;
  const fromDev = typeof origin === 'string' && devOrigin !== undefined && origin === devOrigin;
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none' && !fromDev) return 'cross-site request';
  if (typeof origin === 'string' && !origins.includes(origin)) return 'foreign origin';
  return null;
}

export function cookieToken(headers: IncomingHttpHeaders): string | undefined {
  for (const part of String(headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return undefined;
}

/** The views the page may ask for, and the shape of each one's argument. Nothing else reaches Python. */
export const VIEWS: Record<string, RegExp | null> = {
  today: null, recovery: null, load: null, strength: null, sessions: null, program: null,
  calendar: null, body: null, journal: null, memory: null, system: null, races: null, fuel: null, trips: null,
  workout: /^\d{1,20}$/,
  exercise: /^[A-Z0-9_]{1,64}\/[A-Z0-9_]{1,96}$/,
  'journal-entry': /^[\w.-]{1,96}\.md$/,
};

export function checkView(name: string, arg: string | null): string | null {
  if (!(name in VIEWS)) return `no view ${name}`;
  const shape = VIEWS[name];
  if (shape === null) return arg ? `${name} takes no argument` : null;
  if (!arg || !shape.test(arg)) return `${name} needs a valid argument`;
  return null;
}

// The request vocabulary lives in requests.ts (no Node imports), so the page's tests check every
// request they send against the server's own rules.
export { REQUEST_KINDS, REQUEST_PARAMS, checkFuelLog, checkFuelSetup, checkRequest, checkTrip } from './requests.ts';

export type RequestState = 'QUEUED' | 'WORKING' | 'DONE' | 'FAILED';

export interface AppRequest {
  id: string;
  kind: string;
  text: string;
  params?: Record<string, unknown>;
  state: RequestState;
  createdAt: number;
  ackedAt?: number;
  finishedAt?: number;
  progress: string[];
  reply?: string;
  result?: { kind: string; payload: unknown };
  error?: string;
}

// --- every new ride and run is analysed without a click (his call, 2026-11-28) ---------------------
// "Analyse this ride" was a button; its result was good enough that it should always be there. After each
// data refresh the server queues one `workflow review` request per ride or run of the last days that no
// review names (the sessions view's `reviewed`) and no request has asked for yet. Older sessions keep the
// button: a refresh never sends the coach the whole history.
export const ANALYSIS_DAYS = 7;
/** The session row the sessions view gives (scripts/app_data.py v_sessions), the fields this reads. */
export interface SessionRow { id: number | string; date: string; group: string; title?: string; reviewed?: boolean }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sat 28 Nov", as the page names a day (app/web/src/lib/fmt.ts day). */
export const dayLabel = (iso: string) => { const d = new Date(`${iso}T12:00:00`); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
/** The session ended before the coach answered: that request never ran, so it doesn't count as asked. */
export const SESSION_ENDED = 'the coach session ended first';

/** The rides and runs to analyse now, oldest first, each as the request the page's button would send. */
export function dueAnalyses(sessions: SessionRow[], requests: AppRequest[], today: string, days = ANALYSIS_DAYS):
  { text: string; params: { name: 'review'; activity_id: string; date: string; auto: true } }[] {
  const from = new Date(`${today}T12:00:00`);
  from.setDate(from.getDate() - (days - 1));
  const since = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
  const asked = new Set(requests.filter((r) => r.kind === 'workflow' && r.params?.activity_id != null && r.error !== SESSION_ENDED)
    .map((r) => String(r.params?.activity_id)));
  return sessions
    .filter((s) => (s.group === 'bike' || s.group === 'run') && s.reviewed === false && s.date >= since && s.date <= today && !asked.has(String(s.id)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((s) => ({ text: `Analyse this ${s.group === 'bike' ? 'ride' : 'run'} · ${s.title ?? (s.group === 'bike' ? 'Ride' : 'Run')} · ${dayLabel(s.date)}`,
      params: { name: 'review' as const, activity_id: String(s.id), date: s.date, auto: true as const } }));
}

/** The requests of one athlete's app, in order. States only move forward. */
export class RequestBook {
  #seq = 0;
  #items = new Map<string, AppRequest>();
  /** Plan hashes the coach published as push_plan IN THIS RUN — the only ones a click may confirm. */
  #plans = new Set<string>();

  /** Earlier requests (a reload, yesterday's session) — shown, never re-opened. */
  load(items: AppRequest[]): void {
    for (const r of items) {
      const done = r.state === 'DONE' || r.state === 'FAILED';
      this.#items.set(r.id, done ? r : { ...r, state: 'FAILED', error: r.error ?? SESSION_ENDED });
      this.#seq = Math.max(this.#seq, Number(r.id.slice(1)) || 0);
    }
  }

  add(kind: string, text: string, params?: Record<string, unknown>, now = Date.now()): AppRequest {
    const r: AppRequest = { id: `r${++this.#seq}`, kind, text, state: 'QUEUED', createdAt: now, progress: [], ...(params ? { params } : {}) };
    this.#items.set(r.id, r);
    return r;
  }

  get(id: string): AppRequest | undefined {
    return this.#items.get(id);
  }

  all(): AppRequest[] {
    return [...this.#items.values()];
  }

  ack(id: string, now = Date.now()): AppRequest {
    const r = this.#open(id);
    if (r.state === 'QUEUED') {
      r.state = 'WORKING';
      r.ackedAt = now;
    }
    return r;
  }

  progress(id: string, text: string): AppRequest {
    const r = this.ack(id);
    r.progress.push(text);
    return r;
  }

  finish(id: string, reply: string, now = Date.now()): AppRequest {
    const r = this.ack(id, now);
    r.state = 'DONE';
    r.reply = reply;
    r.finishedAt = now;
    return r;
  }

  publish(id: string, kind: string, payload: unknown, now = Date.now()): AppRequest {
    const r = this.ack(id, now);
    r.state = 'DONE';
    r.result = { kind, payload };
    r.finishedAt = now;
    if (kind === 'push_plan') {
      const hash = (payload as { plan_hash?: unknown }).plan_hash;
      if (typeof hash === 'string') this.#plans.add(hash);
    }
    return r;
  }

  fail(id: string, error: string, now = Date.now()): AppRequest {
    const r = this.ack(id, now);
    r.state = 'FAILED';
    r.error = error;
    r.finishedAt = now;
    return r;
  }

  isPublishedPlan(hash: string): boolean {
    return this.#plans.has(hash);
  }

  #open(id: string): AppRequest {
    const r = this.#items.get(id);
    if (!r) throw new Error(`no request ${id}`);
    if (r.state === 'DONE' || r.state === 'FAILED') throw new Error(`request ${id} is already ${r.state}`);
    return r;
  }
}
