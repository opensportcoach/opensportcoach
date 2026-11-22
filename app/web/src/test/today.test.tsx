/** Today's hero (board Main, 2026-10-16; Today-Rest): the call on the left; on the right the signals,
 * then everything waiting for the athlete — never below the fold — then what comes next. */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Today from '../screens/Today';
import type { AppRequest } from '../lib/api';
import { atFixtureDay, fixtureSet, serveViews, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const demo = fixtureSet('demo');
const plan = demo.result('plan_proposal');
const proposed: AppRequest = { id: 'r2', kind: 'workflow', text: 'Plan my week', state: 'DONE', createdAt: 1, finishedAt: 2, progress: [], result: { kind: 'plan_proposal', payload: plan } };
const hero = () => screen.getByRole('heading', { level: 1 }).closest('section')!;
const asked = (s: ReturnType<typeof store>) => (s.ask as ReturnType<typeof vi.fn>).mock;

describe('Today’s hero', () => {
  it('holds the decisions in its right rail, most urgent first, three shown and the rest one click away', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ today: demo.view('today') });
    const s = store({}, { requests: [proposed] });
    show(<Today />, s);
    await screen.findByRole('heading', { level: 1 });
    const rail = within(hero());
    expect(rail.getByRole('heading', { name: 'Waiting for you' })).toBeTruthy();
    expect(rail.getByLabelText('4 decisions waiting')).toBeTruthy();
    expect(rail.getByText('Progression')).toBeTruthy();
    expect(rail.getByText(plan.headline)).toBeTruthy();
    expect(rail.getByRole('link', { name: 'Review' }).getAttribute('href')).toBe(`/plan/proposal/${plan.id}`);
    expect(rail.queryByText('Not on the watch')).toBeNull();
    fireEvent.click(rail.getByRole('button', { name: '+ 1 more' }));
    expect(rail.getByText('Not on the watch')).toBeTruthy();
    fireEvent.click(rail.getByRole('button', { name: 'Accept as is' }));
    expect(asked(s).calls[0].slice(0, 1).concat(asked(s).calls[0][2])).toEqual(['accept', { proposal: plan.id }]);
    await expect(asked(s).results[0].value).resolves.toBeTruthy();
    expect(screen.queryByText('Pending decisions')).toBeNull();
  });

  it('says there is nothing to decide when nothing is', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    t.daily.pending = [];
    t.sync = { ...t.sync, pending: 0, workouts: t.sync.workouts.map((w: any) => ({ ...w, state: 'in_sync' })) };
    serveViews({ today: t });
    show(<Today />, store());
    await screen.findByRole('heading', { level: 1 });
    expect(within(hero()).getByText('Nothing to decide.')).toBeTruthy();
    expect(within(hero()).getByText(/No plan waiting, watch in sync\./)).toBeTruthy();
  });

  it('asks how you feel in the rail when today has no answer — never "Nothing to decide" with the check-in open (2026-11-22)', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    t.daily.pending = [];
    t.daily.feel = { ...t.daily.feel, answer: null, note: null };
    t.sync = { ...t.sync, pending: 0, workouts: t.sync.workouts.map((w: any) => ({ ...w, state: 'in_sync' })) };
    serveViews({ today: t });
    const s = store();
    show(<Today />, s);
    await screen.findByRole('heading', { level: 1 });
    const rail = within(hero());
    expect(rail.queryByText('Nothing to decide.')).toBeNull();
    expect(rail.getByLabelText('1 decision waiting')).toBeTruthy();
    expect(rail.getByText('Check-in')).toBeTruthy();
    expect(rail.getByText(/made without it/)).toBeTruthy();
    expect(screen.getAllByRole('radiogroup', { name: /How do you feel/ })).toHaveLength(1);   // the card below steps aside
    expect(screen.queryByRole('heading', { name: 'Check-in' })).toBeNull();
    fireEvent.click(rail.getByRole('radio', { name: /3\s*OK/ }));
    fireEvent.click(rail.getByRole('button', { name: 'Send' }));
    expect(asked(s).calls[0]).toEqual(['checkin', 'Feeling 3/5 — OK', { feel: 3 }]);
  });

  it('a check-in sent today stays answered in the rail, and the card shows it', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    t.daily.feel = { ...t.daily.feel, answer: null, note: null };
    t.daily.pending = [];   // answered items sort after open ones: keep it in the first three
    serveViews({ today: t });
    const sent: AppRequest = { id: 'r8', kind: 'checkin', text: 'Feeling 2/5 — Tired', params: { feel: 2 }, state: 'WORKING', createdAt: Date.parse(t.daily.generated_at) + 60_000, progress: [] };
    show(<Today />, store({}, { requests: [sent] }));
    await screen.findByRole('heading', { level: 1 });
    expect(within(hero()).getByText(/You told the coach 2\/5 · Tired · it’s re-weighing/)).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText('Today you told the coach')).toBeTruthy();
  });

  it('offline, the rail does not ask — the check-in card stays, read-only', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    t.daily.feel = { ...t.daily.feel, answer: null, note: null };
    serveViews({ today: t });
    show(<Today />, store({}, { coach: 'offline' }));
    await screen.findByRole('heading', { level: 1 });
    expect(within(hero()).queryByText('Check-in')).toBeNull();
    expect(screen.getByText(/Coach offline — check-in is read-only/)).toBeTruthy();
  });

  it('opens the full reasoning on demand, and points to the next session', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    serveViews({ today: t });
    show(<Today />, store());
    await screen.findByRole('heading', { level: 1 });
    const why = t.daily.recommendation.reasoning;
    expect(screen.queryByText(why)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'The full reasoning' }));
    expect(screen.getByText(why)).toBeTruthy();
    expect(within(hero()).getByText('Next')).toBeTruthy();
  });

  it('a rest call reads as a sentence, with nothing on the watch', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    t.daily.recommendation = { verb: 'REST', workout_key: null, title: 'Rest today, your call.', why: 'You feel 3/5 and HRV agrees.', cut: null, signals: t.daily.recommendation.signals };
    t.call_program = null;
    t.plan_today = { ...t.plan_today, day: null, name: null, scheduled: false };
    serveViews({ today: t });
    show(<Today />, store());
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('RESTRest today, your call.');
    expect(screen.getByText('Rest day · nothing on the watch')).toBeTruthy();
  });
});

/** Last session (board Last-Session, 2026-10-23; states on Last-Session-States): every session of the
 * last training day, one tab each, opening on the latest; strength grouped by role, never "0 kg". */
describe('Last session', () => {
  const card = () => within(screen.getByRole('heading', { name: 'Last session' }).closest('section')!);
  const gym = demo.view('workout', '21000000101');
  const dayOf = (t: any, sessions: any[]) => ({ ...t, last_day: { date: gym.date, sessions } });
  const gymTab = { id: gym.id, title: gym.title, sport: 'Strength', icon: 'strength', kind: 'strength', group: 'strength', start: '18:04', end: '18:40', durationMin: 36, has_sets: true };

  it('has a tab per session of the day and opens on the latest', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    const [first, last] = t.last_day.sessions;
    serveViews({ today: t, [`workout|${first.id}`]: demo.view('workout', String(first.id)), [`workout|${last.id}`]: demo.view('workout', String(last.id)) });
    show(<Today />, store());
    await screen.findByRole('heading', { level: 1 });
    const tabs = card().getAllByRole('tab');
    expect(tabs.map((x) => x.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(tabs[1].textContent).toContain('latest');
    expect(card().getByRole('tabpanel').getAttribute('aria-label')).toBe(last.title);
    fireEvent.click(tabs[0]);
    expect(card().getByRole('tabpanel').getAttribute('aria-label')).toBe(first.title);
    expect(await card().findByText('Cardio load')).toBeTruthy();
  });

  it('reads a gym session against its plan, by role, and points at the decision it changes', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = dayOf(demo.view('today'), [gymTab]);
    t.daily.pending = [{ id: 'p1', kind: 'bump', text: 'Lat pulldown up a step', bump: { exercise: 'Lat pulldown', from: 60, to: 62.5, evidence_dates: [gym.date] } }];
    const w = structuredClone(gym);
    w.exercises.push({ key: [null, null], label: 'Exercise', muscle: 'Unattributed', unnamed: true, phase: null, per_hand: false, per_side: false, machine: false, history: [], signal: null,
      sets: [{ type: 'working', weight: 0, reps: 8, weight_logged: 0, reps_logged: 8, duration_s: 30, pr: false }] });
    serveViews({ today: t, [`workout|${gym.id}`]: w });
    show(<Today />, store());
    await screen.findByRole('heading', { level: 1 });
    expect(await card().findByText('Strength load')).toBeTruthy();
    expect(card().queryAllByRole('tab')).toHaveLength(0);
    expect(card().getByRole('group', { name: 'Strength' })).toBeTruthy();
    expect(card().getByText('Unnamed')).toBeTruthy();
    expect(card().getByRole('link', { name: 'Tell the coach what it was' })).toBeTruthy();
    expect(card().queryByText(/^0 kg/)).toBeNull();
    expect(card().getByText('It changes · progression')).toBeTruthy();
    expect(card().getByText('Lat pulldown 60 → 62.5 kg')).toBeTruthy();
    expect(card().getByRole('link', { name: /Decide above/ }).getAttribute('href')).toBe('#pd');
  });

  it('waits for the sets when Garmin has the session but not them yet', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ today: dayOf(demo.view('today'), [{ ...gymTab, has_sets: false }]) });
    show(<Today />, store());
    await screen.findByRole('heading', { level: 1 });
    expect(card().getByRole('status').textContent).toContain('haven’t synced from Garmin yet');
  });

  it('says so before the first session', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ today: { ...demo.view('today'), last_day: null } });
    show(<Today />, store());
    await screen.findByRole('heading', { level: 1 });
    expect(card().getByText('No finished session yet.')).toBeTruthy();
  });
});
