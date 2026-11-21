/**
 * The component tests' harness (docs/DESIGN.md (app audit) L2): a screen rendered against the committed fixtures
 * (app/fixtures/), with a store of the test's choosing and the clock set to the day the fixtures
 * were generated — so "today's call" is today's in the test too.
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { StoreCtx, ViewCache, type AppState, type Store } from '../lib/api';
import { checkFuelLog, checkFuelSetup, checkRequest } from '../../../channel/requests';

// jsdom lays nothing out, so it has no scrollIntoView; the screens call it to bring a picked item into view.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;

// Every fixture JSON, bundled by Vite at test time — no Node APIs, so the harness typechecks with the app.
const FILES = import.meta.glob('../../../fixtures/*/**/*.json', { eager: true, import: 'default' }) as Record<string, any>;
const read = (rel: string) => {
  const v = FILES[`../../../fixtures/${rel}`];
  if (v === undefined) throw new Error(`no fixture file ${rel} — run app/fixtures/make_demo.py`);
  return structuredClone(v);
};

export function fixtureSet(set = 'demo') {
  const index = read(`${set}/index.json`);
  const view = (name: string, arg: string | null = null) => {
    const e = (index.views[name] ?? []).find((v: { arg: string | null }) => v.arg === arg) ?? (arg ? undefined : index.views[name]?.[0]);
    if (!e) throw new Error(`no fixture view ${name} ${arg ?? ''}`);
    return read(`${set}/${e.file}`);
  };
  const result = (kind: string) => read(`${set}/results/${kind}.json`);
  return { index, view, result };
}

/** Freeze the date (only the date: timers still run) at the fixtures' day, at noon. */
export function atFixtureDay(generatedOn: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${generatedOn}T12:00:00`));
}

/** /api/views/<name>?arg= answered from `views` (name or name|arg → payload). */
export function serveViews(views: Record<string, unknown>) {
  vi.stubGlobal('fetch', async (input: string) => {
    const u = new URL(input, 'http://app.test');
    const name = decodeURIComponent(u.pathname.replace('/api/views/', ''));
    const arg = u.searchParams.get('arg');
    const body = views[arg ? `${name}|${arg}` : name] ?? views[name];
    return new Response(JSON.stringify(body ?? { error: `no view ${name}` }), { status: body ? 200 : 404 });
  });
}

/** The store's `ask` refuses what the server refuses (app/channel/requests.ts) — the same function,
 * so a button whose request the server would turn away fails its test (docs/DESIGN.md (app audit) R1). */
export const askChecked = () => vi.fn(async (kind: string, text: string, params?: Record<string, unknown>) => {
  const bad = checkRequest(kind, params);
  if (bad) throw new Error(bad);
  return { id: 'r1', kind, text, params, state: 'QUEUED', createdAt: Date.now(), progress: [] } as never;
});

/** The store's `fuel` refuses what the server's fuel actions refuse — the same checks (requests.ts). */
export const fuelChecked = () => vi.fn(async (action: 'log' | 'setup', body: unknown) => {
  const bad = action === 'log' ? checkFuelLog(body) : checkFuelSetup(body);
  if (bad) throw new Error(bad);
  return 'Saved';
});

export function store(over: Partial<Store> = {}, state: Partial<AppState> = {}): Store {
  return {
    state: { athlete: 'demo', display: 'Alex', garmin_account: 'Alex M.', mode: 'fixtures', coach: 'online', requests: [],
      status: null, refresh: { state: 'idle' }, ...state },
    error: null, dataVersion: 0, refreshing: false, views: new ViewCache(),
    ask: askChecked(), confirm: vi.fn(async () => ({}) as never), refresh: vi.fn(async () => undefined), fuel: fuelChecked(),
    about: null, setAbout: vi.fn(), askAbout: vi.fn(), askFocus: 0, dockOpen: false, setDockOpen: vi.fn(),
    sendToWatch: null, openSendToWatch: vi.fn(),
    ...over,
  };
}

export function show(ui: ReactNode, s: Store, at = '/', path = '/') {
  return render(
    <StoreCtx.Provider value={s}>
      <MemoryRouter initialEntries={[at]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path={path} element={ui} /></Routes>
      </MemoryRouter>
    </StoreCtx.Provider>,
  );
}
