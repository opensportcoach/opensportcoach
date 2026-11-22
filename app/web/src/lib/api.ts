/**
 * The page's side of the server (app/channel/http.ts): /api/state, /api/views/*, /api/events (SSE),
 * /api/requests, /api/confirm, /api/actions/refresh. One store holds who, the coach's status and every
 * request; views live in one cache (ViewCache) and are refetched when the server says the data changed.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import type { Answer, Daily, EnduranceReview, PlanProposal, PushPlan, PushResult, Recap, Review } from '../contracts';
import type { FuelLogBody, FuelSetupBody } from '../../../channel/requests';

export type RequestState = 'QUEUED' | 'WORKING' | 'DONE' | 'FAILED';

/** A coach result, typed from app/contracts/ (docs/DESIGN.md (app audit) L1): a screen that reads a field the
 * contract doesn't have fails the typecheck, instead of rendering undefined. */
export type Result =
  | { kind: 'answer'; payload: Answer }
  | { kind: 'daily'; payload: Daily }
  | { kind: 'plan_proposal'; payload: PlanProposal }
  | { kind: 'push_plan'; payload: PushPlan }
  | { kind: 'push_result'; payload: PushResult }
  | { kind: 'review'; payload: Review }
  | { kind: 'recap'; payload: Recap }
  | { kind: 'endurance_review'; payload: EnduranceReview };

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
  result?: Result;
  error?: string;
}

export interface AppState {
  athlete: string;
  display: string;
  garmin_account: string | null;
  accent?: string | null;
  mode: 'coach' | 'standalone' | 'fixtures';
  coach: 'online' | 'offline';
  requests: AppRequest[];
  /** What the coach is doing outside any request — the daily it runs at start — or null. */
  status?: { text: string; since: number; updated?: number; ask?: 'feel'; answered?: true } | null;
  /** The data refresh as every tab sees it: started by this page or by the coach. */
  refresh?: RefreshState;
  /** The server's code changed after this coach session started: restart it to use the new version. */
  outdated?: boolean;
}

export interface RefreshState {
  state: 'idle' | 'running' | 'done' | 'failed';
  by?: 'page' | 'coach';
  startedAt?: number;
  finishedAt?: number;
  summary?: string;
  error?: string;
}

export type Defs = Record<string, { source: 'garmin' | 'computed' | 'coach' | 'you'; definition: string }>;

/** The server answers 401 when this window's token is not the current one: its coach session ended
 * and a newer one owns the app (docs/DESIGN.md (app audit) M6). The page says so in words, not as an error. */
export const ENDED = 'session_ended';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error(ENDED);
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  state: () => fetch('/api/state', { cache: 'no-store' }).then((r) => json<AppState>(r)),
  view: <T = any>(name: string, arg?: string | null) =>
    fetch(`/api/views/${encodeURIComponent(name)}${arg ? `?arg=${encodeURIComponent(arg)}` : ''}`, { cache: 'no-store' }).then((r) => json<T>(r)),
  post: <T = any>(path: string, body: unknown) =>
    fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<T>(r)),
};

/** The coach as the page can act on it (docs/DESIGN.md (app audit) U4). Until the server has answered once, the
 * page is `connecting` — never "offline", which is a claim about the coach the page can't make yet. */
export function coachOf(s: AppState | null): { online: boolean; offline: boolean; connecting: boolean } {
  return { connecting: s == null, online: s?.coach === 'online', offline: s != null && s.coach !== 'online' };
}

interface ViewEntry { data: unknown; error: string | null; version: number; at: number; loading: boolean }

/** How long a view stays fresh without a data change: the server's own view cache (server.ts). */
const VIEW_MAX_AGE_MS = 60_000;

/**
 * Every view the page has read, in one place (docs/DESIGN.md (app audit) U17). A view is fetched once per data
 * version however many components read it — the header, the sidebar and Today all read `today`, which
 * was three requests per load — and a screen opened again shows its last data at once while it
 * refreshes behind it, instead of a skeleton on every visit.
 */
export class ViewCache {
  #entries = new Map<string, ViewEntry>();
  #subs = new Map<string, Set<() => void>>();
  #inflight = new Set<string>();

  static key = (name: string, arg: string | null) => `${name}|${arg ?? ''}`;

  peek = (key: string): ViewEntry | undefined => this.#entries.get(key);

  subscribe = (key: string, fn: () => void): (() => void) => {
    const subs = this.#subs.get(key) ?? new Set();
    subs.add(fn);
    this.#subs.set(key, subs);
    return () => { subs.delete(fn); };
  };

  /** Fetch the view for this data version, unless it is already fresh or on its way. */
  load(name: string, arg: string | null, version: number): void {
    const key = ViewCache.key(name, arg);
    const e = this.#entries.get(key);
    if (e && e.version === version && !e.error && !e.loading && Date.now() - e.at < VIEW_MAX_AGE_MS) return;
    const flight = `${key}@${version}`;
    if (this.#inflight.has(flight)) return;
    this.#inflight.add(flight);
    this.#set(key, { ...(e ?? { data: null, error: null, version: -1, at: 0 }), loading: true });
    api.view(name, arg)
      .then((data) => ({ data, error: null }), (err) => ({ data: undefined, error: String(err?.message ?? err) }))
      .then(({ data, error }) => {
        this.#inflight.delete(flight);
        const cur = this.#entries.get(key);
        if (cur && cur.version > version) return;   // a newer version landed first
        const loading = [...this.#inflight].some((f) => f.startsWith(`${key}@`));
        // A failed refresh keeps the last data beside its error; the screens show the error.
        this.#set(key, { data: data === undefined ? cur?.data ?? null : data, error, version, at: Date.now(), loading });
      });
  }

  #set(key: string, e: ViewEntry) {
    this.#entries.set(key, e);
    this.#subs.get(key)?.forEach((fn) => fn());
  }
}

export interface Store {
  state: AppState | null;
  error: string | null;
  /** Bumped whenever the data behind the views may have changed (a refresh, a published daily). */
  dataVersion: number;
  refreshing: boolean;
  /** Every view read so far (useView). */
  views: ViewCache;
  ask: (kind: string, text: string, params?: Record<string, unknown>) => Promise<AppRequest>;
  confirm: (planHash: string) => Promise<AppRequest>;
  refresh: () => Promise<void>;
  /** Writes the athlete's fuel — a session's log or the setup answers — through the server's own action
   * (scripts/fuel.py, no model). Resolves to the script's one-line summary; throws its refusal. */
  fuel: (action: 'log' | 'setup', body: FuelLogBody | FuelSetupBody) => Promise<string | null>;
  /** Context for the next question ("Ask about this"), shown in the dock. */
  about: string | null;
  setAbout: (about: string | null) => void;
  /** "Ask about this" (docs/DESIGN.md (app audit) U2): attach the context and bring up the dock's question box —
   * opening the coach panel on a narrow window — without moving the page. */
  askAbout: (about: string) => void;
  /** Bumped by askAbout: the dock focuses its question box. */
  askFocus: number;
  /** The coach panel on a narrow window (wide windows always show the dock). */
  dockOpen: boolean;
  setDockOpen: (open: boolean) => void;
  sendToWatch: { plan: PushPlan; request: AppRequest } | null;
  openSendToWatch: (request: AppRequest | null) => void;
}

/** Exported for the component tests (src/test/), which supply a store of their own. */
export const StoreCtx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [about, setAbout] = useState<string | null>(null);
  const [askFocus, setAskFocus] = useState(0);
  const [dockOpen, setDockOpen] = useState(false);
  const [views] = useState(() => new ViewCache());
  const [stw, setStw] = useState<Store['sendToWatch']>(null);
  const upsert = useRef((r: AppRequest) => setState((s) => s && ({
    ...s, requests: s.requests.some((x) => x.id === r.id) ? s.requests.map((x) => (x.id === r.id ? r : x)) : [...s.requests, r],
  })));

  useEffect(() => {
    let es: EventSource | null = null;
    let stop = false;
    const load = () => api.state().then((s) => { setState(s); setError(null); }).catch((e) => setError(String(e.message ?? e)));
    load();
    const connect = () => {
      if (stop) return;
      es = new EventSource('/api/events');
      es.addEventListener('request', (ev) => {
        const r = JSON.parse((ev as MessageEvent).data) as AppRequest;
        upsert.current(r);
        if (r.state === 'DONE') setDataVersion((v) => v + 1);
        // A dry-run plan just arrived: open the confirm card over whatever screen is showing.
        const res = r.result;
        if (r.state === 'DONE' && res?.kind === 'push_plan') setStw((cur) => cur ?? { plan: res.payload, request: r });
      });
      es.addEventListener('daily', () => { setState((s) => s && { ...s, status: null }); setDataVersion((v) => v + 1); });
      es.addEventListener('status', (ev) => {
        const st = JSON.parse((ev as MessageEvent).data);
        setState((s) => s && { ...s, status: st });
      });
      // Data written outside a request — a fuel log, the fuel setup — in this window or another.
      es.addEventListener('data', () => setDataVersion((v) => v + 1));
      es.addEventListener('refresh', (ev) => {
        const d = JSON.parse((ev as MessageEvent).data) as RefreshState;
        setState((s) => s && { ...s, refresh: d });
        if (d.state === 'done') setDataVersion((v) => v + 1);
      });
      es.onopen = () => load();
      es.onerror = () => {
        setState((s) => s && { ...s, coach: 'offline' });
        es?.close();
        // Ask again: the server may be gone (offline), back, or owned by a newer session (ENDED —
        // then stop retrying; this window can't be revived).
        api.state().then((s) => { setState(s); setError(null); setTimeout(connect, 1000); })
          .catch((e) => { const m = String(e.message ?? e); setError(m); if (m !== ENDED) setTimeout(connect, 3000); });
      };
    };
    connect();
    return () => { stop = true; es?.close(); };
  }, []);

  const ask = useCallback(async (kind: string, text: string, params?: Record<string, unknown>) => {
    const r = await api.post<AppRequest>('/api/requests', { kind, text, params });
    upsert.current(r);
    return r;
  }, []);
  const confirm = useCallback(async (planHash: string) => {
    const r = await api.post<AppRequest>('/api/confirm', { plan_hash: planHash });
    upsert.current(r);
    return r;
  }, []);
  // The server owns the refresh's state and broadcasts it; this only starts one (or joins it).
  const refresh = useCallback(async () => {
    setState((s) => s && { ...s, refresh: { state: 'running', by: 'page', startedAt: Date.now() } });
    const r = await fetch('/api/actions/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = (await r.json().catch(() => ({}))) as RefreshState & { error?: string };
    if (!r.ok && body.state !== 'failed') {
      setState((s) => s && { ...s, refresh: { state: 'failed', error: body.error ?? `HTTP ${r.status}`, finishedAt: Date.now() } });
    }
  }, []);
  const fuel = useCallback(async (action: 'log' | 'setup', body: FuelLogBody | FuelSetupBody) => {
    const r = await api.post<{ ok: boolean; summary: string | null }>(action === 'log' ? '/api/actions/fuel' : '/api/actions/fuel-setup', body);
    setDataVersion((v) => v + 1);
    return r.summary;
  }, []);
  const refreshing = state?.refresh?.state === 'running';
  const openSendToWatch = useCallback((request: AppRequest | null) => {
    setStw(request && request.result?.kind === 'push_plan' ? { plan: request.result.payload, request } : null);
  }, []);
  const askAbout = useCallback((ctx: string) => {
    setAbout(ctx);
    setDockOpen(true);
    setAskFocus((n) => n + 1);
  }, []);

  const value = useMemo<Store>(() => ({
    state, error, dataVersion, refreshing, views, ask, confirm, refresh, fuel, about, setAbout, askAbout, askFocus, dockOpen, setDockOpen,
    sendToWatch: stw, openSendToWatch,
  }), [state, error, dataVersion, refreshing, views, ask, confirm, refresh, fuel, about, askAbout, askFocus, dockOpen, stw, openSendToWatch]);
  return createElement(StoreCtx.Provider, { value }, children);
}

export function useStore(): Store {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

/** A view from the cache: its last data at once (null the first time), refetched when the data changed. */
export function useView<T = any>(name: string, arg?: string | null): { data: T | null; error: string | null; loading: boolean } {
  const { dataVersion, views } = useStore();
  const key = ViewCache.key(name, arg ?? null);
  const subscribe = useCallback((fn: () => void) => views.subscribe(key, fn), [views, key]);
  const e = useSyncExternalStore(subscribe, () => views.peek(key));
  useEffect(() => { views.load(name, arg ?? null, dataVersion); }, [views, name, arg, dataVersion]);
  return { data: (e?.data as T) ?? null, error: e?.error ?? null, loading: !e || e.loading || e.version !== dataVersion };
}

/** Requests still waiting on the coach, oldest first. */
export const openRequests = (s: AppState | null) => (s?.requests ?? []).filter((r) => r.state === 'QUEUED' || r.state === 'WORKING');
