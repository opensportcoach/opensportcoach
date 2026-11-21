/** Races (docs/DESIGN.md (races); boards Season, Race, Race-Card, Today-Races), on the committed fixtures: the
 * synthetic Demo athlete has a half already run, a gravel race whose date check differs, and an A race. */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Season from '../screens/Season';
import Race from '../screens/Race';
import Today from '../screens/Today';
import { elapsed } from '../lib/fmt';
import { signed, type RaceCard, type Split, type VsReference } from '../lib/races';
import { atFixtureDay, fixtureSet, serveViews, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const demo = fixtureSet('demo');
const fresh = fixtureSet('demo-new');
const asked = (s: ReturnType<typeof store>) => (s.ask as ReturnType<typeof vi.fn>).mock;
const views = () => ({ races: demo.view('races'), today: demo.view('today'), calendar: demo.view('calendar') });

describe('Season', () => {
  it('leads with the next race and the A race the season peaks for, then every race as a card', async () => {
    atFixtureDay(demo.index.generated_on);
    const v = demo.view('races');
    serveViews(views());
    show(<Season />, store());
    expect(await screen.findByText(/peaking for the 70\.3/)).toBeTruthy();
    expect(screen.getByText('Next race')).toBeTruthy();
    expect(screen.getByText(new RegExp(`${v.next.name} · ${v.next.priority}`))).toBeTruthy();
    expect(screen.getByText('Season peaks · A race')).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(v.races.length);
    // One axis, four lanes; a race in range is a pin on its date, its card under it (board Season, 2026-10-16).
    expect(screen.getByRole('heading', { name: 'Season' })).toBeTruthy();
    for (const lane of ['Blocks', 'Windows', 'Races', 'Tests']) expect(screen.getByText(lane)).toBeTruthy();
    for (const r of v.races) expect(screen.getAllByRole('link', { name: new RegExp(`^${r.name}`) }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Season timeline')).toBeNull();
  });

  it('a date the organiser names differently shows both, and either choice is a request the server accepts — never a silent change', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews(views());
    const s = store();
    show(<Season />, s);
    expect(await screen.findByText('Yours')).toBeTruthy();
    expect(screen.getByText('Organiser')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use the official date' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    expect(asked(s).calls.map((c) => [c[0], c[2]])).toEqual([['question', { about: 'race hill-country-gravel' }], ['question', { about: 'race hill-country-gravel' }]]);
    for (const r of asked(s).results) await expect(r.value).resolves.toBeTruthy();
  });

  it('Check dates asks the coach to look the races up, and every race ahead says so while it runs', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews(views());
    const s = store();
    show(<Season />, s);
    fireEvent.click(await screen.findByRole('button', { name: /Check dates/ }));
    expect(asked(s).calls.map((c) => [c[0], c[2]])).toEqual([['workflow', { name: 'races' }]]);
    await expect(asked(s).results[0].value).resolves.toBeTruthy();
    cleanup();
    const running = { id: 'r9', kind: 'workflow', text: 'Check my race dates online', params: { name: 'races' }, state: 'WORKING' as const, createdAt: Date.now(), progress: [] };
    show(<Season />, store({}, { requests: [running] }));
    expect(await screen.findByText('Checking dates…')).toBeTruthy();
    const ahead = demo.view('races').races.filter((r: { past: boolean }) => !r.past).length;
    expect(screen.getAllByText('Checking…')).toHaveLength(ahead);
  });

  it('a new athlete with no races sees the empty state, with Add a race', async () => {
    atFixtureDay(fresh.index.generated_on);
    serveViews({ races: fresh.view('races'), today: fresh.view('today') });
    show(<Season />, store({}, { display: 'Sam' }));
    expect(await screen.findByText('No races yet.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Add a race/ }).length).toBeGreaterThan(0);
  });
});

describe('Race', () => {
  it('a race that is run shows its result against its target, and opens the Garmin activity', async () => {
    atFixtureDay(demo.index.generated_on);
    const r = demo.view('races').races.find((x: { result: unknown }) => x.result);
    serveViews(views());
    show(<Race />, store(), `/race/${r.id}`, '/race/:id');
    expect(await screen.findByText(r.result.time)).toBeTruthy();
    expect(screen.getByText(r.result.vs_target_s < 0 ? 'Target met' : 'Target missed')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Garmin activity/ }).getAttribute('href')).toBe(`/workouts/${r.result.activity_id}`);
    expect(r.result.splits).toBeNull();   // a half is one discipline: no splits bar, never an invented one
    expect(screen.queryByRole('img', { name: /^Splits: / })).toBeNull();
  });

  it('a run 70.3 splits its time by discipline, read from its Garmin legs, and holds each against the reference', async () => {
    atFixtureDay(demo.index.generated_on);
    const r = demo.view('races').races.find((x: RaceCard) => x.result?.splits);
    const parts: Split[] = r.result.splits;
    expect(r.result.splits_from).toBe('legs');
    expect(parts.map((s) => s.discipline)).toEqual(['swim', 't1', 'bike', 't2', 'run']);
    expect(parts.reduce((t, s) => t + s.seconds, 0)).toBe(r.result.seconds);   // the parts make the whole
    serveViews(views());
    show(<Race />, store(), `/race/${r.id}`, '/race/:id');
    const bar = await screen.findByRole('img', { name: /^Splits: / });
    expect(bar.getAttribute('aria-label')).toBe(`Splits: ${parts.map((s) => `${s.label} ${elapsed(s.seconds)}`).join(', ')}`);
    expect([...bar.children].map((c) => (c as HTMLElement).style.flexGrow)).toEqual(parts.map((s) => String(s.seconds)));
    expect(bar.firstElementChild!.getAttribute('data-tip')).toMatch(/Source: the legs of the Garmin multisport activity/);
    expect(screen.getByText('Splits · swim, transitions, bike, run')).toBeTruthy();
    const grid = screen.getByText(`Against ${r.reference.name} · ${r.reference.time}`).nextElementSibling!;
    const vs: VsReference[] = r.result.vs_reference;
    expect(vs.map((c) => c.label)).toEqual(['Swim', 'Bike', 'Run', 'T1 + T2']);
    expect([...grid.children].map((c) => c.textContent)).toEqual(vs.map((c) => `${c.label}${elapsed(c.seconds)}${signed(c.delta_s)}`));
    expect([...grid.children].map((c) => (c.lastElementChild as HTMLElement).style.color)).toEqual(vs.map((c) => (c.delta_s <= 0 ? 'var(--g)' : 'var(--r)')));
  });

  it('a race ahead shows the days around it and never guesses a prediction', async () => {
    atFixtureDay(demo.index.generated_on);
    const r = demo.view('races').races.find((x: { id: string }) => x.id === 'hill-country-gravel');
    serveViews(views());
    show(<Race />, store(), `/race/${r.id}`, '/race/:id');
    expect(await screen.findByText('Days around the race')).toBeTruthy();
    expect(screen.getByText('not tested yet')).toBeTruthy();
    expect(screen.getByText(`${r.priority} · RACE`)).toBeTruthy();
    expect(screen.getAllByText('Easy').length).toBeGreaterThanOrEqual(r.windows.before.days);
  });
});

describe('Today — the race line', () => {
  it('names the next race under the call once it is 8 weeks out, with today’s window and the date check', async () => {
    atFixtureDay(demo.index.generated_on);
    const v = demo.view('races');
    serveViews(views());
    show(<Today />, store());
    const line = await screen.findByRole('link', { name: new RegExp(`^${v.next.name}:`) });
    expect(line.getAttribute('href')).toBe(`/race/${v.next.id}`);
    expect(line.textContent).toMatch(/Build · no window yet/);
  });
});
