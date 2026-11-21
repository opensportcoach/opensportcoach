/** Round 4, the UX audit (docs/DESIGN.md (app audit) U1–U26): the coach within reach, states that say what is true,
 * one calendar date, and every button going somewhere of its own. On the committed fixtures. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Today from '../screens/Today';
import Plan from '../screens/Plan';
import Workout from '../screens/Workout';
import Workouts from '../screens/Workouts';
import { Dock, Header, Sidebar, outcome } from '../components/Shell';
import { StoreCtx, type AppRequest, type Store } from '../lib/api';
import { isoDate, monthName, todayIso } from '../lib/fmt';
import { atFixtureDay, fixtureSet, serveViews, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const demo = fixtureSet('demo');
const req = (over: Partial<AppRequest>): AppRequest => ({ id: 'r1', kind: 'question', text: 'Why?', state: 'DONE', createdAt: 1, finishedAt: 2, progress: [], ...over });

describe('The coach dock', () => {
  it('sends on Enter and keeps Shift+Enter for a new line (U5)', async () => {
    const s = store();
    show(<Dock />, s);
    const box = screen.getByLabelText('Ask the coach');
    fireEvent.change(box, { target: { value: 'Why is bench flat?' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(s.ask).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    expect(s.ask).toHaveBeenCalledWith('question', 'Why is bench flat?', undefined);
    expect(screen.getByText(/Enter to send/)).toBeTruthy();
  });

  it('reads the newest answer where it was asked; older ones open on Coach (U3)', () => {
    const answer = demo.result('answer');
    show(<Dock />, store({}, { requests: [
      req({ id: 'r1', text: 'An older one', reply: 'Older reply.' }),
      req({ id: 'r2', text: 'Why is bench flat?', createdAt: 3, finishedAt: 4, result: { kind: 'answer', payload: answer } }),
    ] }));
    const latest = screen.getByRole('article', { name: /Latest: Why is bench flat\?/ });
    expect(within(latest).getByText(outcome(req({ result: { kind: 'answer', payload: answer } })))).toBeTruthy();
    expect(within(latest).getByRole('link', { name: 'Read it all' }).getAttribute('href')).toBe('/coach#r2');
    expect(screen.getByRole('link', { name: /An older one/ }).getAttribute('href')).toBe('/coach#r1');
  });

  it('says what a result came to in a sentence, and why a request failed', () => {
    const plan = demo.result('plan_proposal');
    expect(outcome(req({ result: { kind: 'plan_proposal', payload: plan } }))).toMatch(/^A plan to review: /);
    expect(outcome(req({ state: 'FAILED', error: 'the coach session ended' }))).toBe('the coach session ended');
    expect(outcome(req({ reply: '**Bold** and `code`\n- a point' }))).toBe('Bold and code · a point');
  });
});

describe('Connecting is not offline (U4)', () => {
  it('says "Connecting…" until the server answers, and only then whether the coach is offline', () => {
    serveViews({ today: demo.view('today') });
    show(<><Header /><Dock /></>, { ...store(), state: null });
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect(screen.queryByText(/offline/i)).toBeNull();
    cleanup();
    show(<><Header /><Dock /></>, store({}, { coach: 'offline' }));
    expect(screen.getAllByText(/Coach offline/).length).toBeGreaterThan(0);
  });
});

describe('One view, one request (U17)', () => {
  it('fetches today once for the header, the sidebar and the screen — and shows it again at once', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => { calls.push(input); return new Response(JSON.stringify(t), { status: 200 }); });
    const s = store();
    show(<><Header /><Sidebar theme="dark" setTheme={() => undefined} /><Today /></>, s);
    expect(await screen.findByText('TRAIN')).toBeTruthy();
    expect(calls.filter((u) => u.includes('/api/views/today'))).toHaveLength(1);
    cleanup();
    show(<Today />, s);   // the same store: the screen opened again
    expect(screen.getByText('TRAIN')).toBeTruthy();   // at once — no skeleton, no second request
    expect(calls.filter((u) => u.includes('/api/views/today'))).toHaveLength(1);
  });
});

/** Where a link or a navigation landed. */
function Landed() {
  const l = useLocation();
  return <span data-testid="landed">{l.pathname}{l.search}</span>;
}

describe("Today's hero", () => {
  it("opens the day's anatomy and the watch's steps from two different buttons, and asks about the call in place (U6, U2)", async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    serveViews({ today: t });
    const s = store();
    render(
      <StoreCtx.Provider value={s}>
        <MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes><Route path="/" element={<Today />} /><Route path="*" element={<Landed />} /></Routes>
        </MemoryRouter>
      </StoreCtx.Provider>,
    );
    const open = await screen.findByRole('link', { name: new RegExp(`Open ${t.call_program.name}`) });
    expect(open.getAttribute('href')).toBe(`/program?day=${t.call_program.key}#anatomy`);
    fireEvent.click(screen.getByRole('button', { name: /Ask why/ }));
    expect(s.askAbout).toHaveBeenCalledWith(`Today’s call: ${t.daily.recommendation.verb} · ${t.daily.recommendation.title}`);
    fireEvent.click(screen.getByRole('button', { name: /See it as the watch shows it/ }));
    expect((await screen.findByTestId('landed')).textContent).toBe(`/plan?watch=${t.call_program.key}`);
  });
});

describe('Plan & calendar (U9, U10)', () => {
  it('steps through the weeks the calendar holds, names the month, and opens a session from either view', async () => {
    atFixtureDay(demo.index.generated_on);
    const p = demo.view('program');
    serveViews({ calendar: demo.view('calendar'), program: p });
    show(<Plan />, store(), '/plan', '/plan');
    expect(await screen.findByRole('heading', { name: /· this week$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByRole('heading', { name: /· last week$/ })).toBeTruthy();
    // last week was trained: a done session opens below the week, with the way to all of it
    const done = demo.view('calendar').done.find((x: { date: string }) => x.date < isoDate(new Date(Date.now() - ((new Date().getDay() + 6) % 7) * 864e5)));
    fireEvent.click(screen.getAllByRole('button', { pressed: false }).find((b) => b.textContent?.includes(done.title))!);
    expect((await screen.findAllByRole('link', { name: /Open the full session/ }))[0].getAttribute('href')).toBe(`/workouts/${done.id}`);
    fireEvent.click(screen.getByRole('radio', { name: 'month' }));
    const month = monthName(demo.index.generated_on);
    expect(screen.getByRole('heading', { name: month })).toBeTruthy();
    const d3 = p.days.find((d: { key: string }) => d.key === 'd3');
    // the one still ahead, not last week's logged D3
    const entry = within(screen.getByRole('grid', { name: month })).getAllByRole('button').find((b) => b.textContent?.includes(d3.name) && !b.getAttribute('data-tip')?.includes('Done'));
    fireEvent.click(entry!);
    expect(screen.getByRole('heading', { name: d3.name })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'On the watch' })).toBeTruthy();
  });
});

describe('The session detail panel (board Plan, 2026-10-17)', () => {
  it('lists a planned gym day in order, core block first, and ties each row to its watch steps', async () => {
    atFixtureDay(demo.index.generated_on);
    const p = demo.view('program');
    const d3 = p.days.find((d: { key: string }) => d.key === 'd3');
    serveViews({ calendar: demo.view('calendar'), program: p, today: demo.view('today') });
    show(<Plan />, store(), '/plan?watch=d3', '/plan');
    const panel = (await screen.findByRole('heading', { name: d3.name })).closest('section')!;
    const q = within(panel);
    // changed since it was sent: said so, with the send beside it — accepting never sends
    expect(q.getByText(/the watch still has the earlier version/)).toBeTruthy();
    expect(q.getAllByRole('button', { name: /Send to watch/ }).length).toBeGreaterThan(0);
    const rows = q.getAllByRole('row').filter((r) => r.getAttribute('aria-selected') != null);
    expect(rows.length).toBe(d3.lead.length + d3.exercises.length);
    expect(rows[0].textContent).toContain('A1');
    expect(q.getByText('Core block')).toBeTruthy();
    // the watch rail follows the row picked
    const b2 = rows.find((r) => r.textContent?.startsWith('B2'))!;
    fireEvent.click(b2);
    expect(b2.getAttribute('aria-selected')).toBe('true');
    expect(q.getByText(/runs · steps/).textContent).toContain('B2');
    const steps = d3.watch.filter((x: { kind: string }) => x.kind !== 'repeat').length;
    expect(q.getByText(`/ ${steps}`)).toBeTruthy();
    // the session's numbers: time, sets, kilos — strength only
    expect(q.getByText('Working sets')).toBeTruthy();
    expect(q.getByText('Planned strength load')).toBeTruthy();
    expect(q.getByRole('link', { name: /numbers to beat — on Program/ }).getAttribute('href')).toBe('/program?day=d3#anatomy');
  });

  it('opens a done gym day as planned vs done, and a run with its zones — never summed', async () => {
    atFixtureDay(demo.index.generated_on);
    const cal = demo.view('calendar');
    const gym = cal.done.find((x: { group: string; id: number }) => x.group === 'strength' && demo.index.views.workout.some((v: { arg: string }) => v.arg === String(x.id)));
    const run = cal.done.find((x: { group: string; id: number }) => x.group === 'run' && demo.index.views.workout.some((v: { arg: string }) => v.arg === String(x.id)));
    serveViews({ calendar: cal, program: demo.view('program'), today: demo.view('today'),
      [`workout|${gym.id}`]: demo.view('workout', String(gym.id)), [`workout|${run.id}`]: demo.view('workout', String(run.id)) });
    show(<Plan />, store(), `/plan?date=${gym.date}`, '/plan');
    await screen.findByRole('heading', { name: /Plan & calendar/ });
    fireEvent.click(screen.getAllByRole('button').find((b) => b.getAttribute('aria-controls') === 'detail' && b.textContent?.includes(gym.title))!);
    expect(await screen.findByText('Planned vs done')).toBeTruthy();
    expect(screen.getByText('Sets logged')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'What Garmin recorded' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Open the full session/ }).every((a) => a.getAttribute('href') === `/workouts/${gym.id}`)).toBe(true);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.getAttribute('aria-controls') === 'detail' && b.textContent?.includes(run.title))!);
    expect(await screen.findByText('Time in heart-rate zone')).toBeTruthy();
    expect(screen.getByText('cardio only · never added to strength')).toBeTruthy();
    expect(screen.queryByText('Planned vs done')).toBeNull();
  });

  it('walks to the next session and closes', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ calendar: demo.view('calendar'), program: demo.view('program'), today: demo.view('today') });
    show(<Plan />, store(), '/plan?watch=d3', '/plan');
    const next = await screen.findByRole('button', { name: /^Next session: / });
    const name = next.getAttribute('aria-label')!.replace('Next session: ', '');
    fireEvent.click(next);
    expect(await screen.findByRole('heading', { level: 2, name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close session detail' }));
    expect(screen.getByText(/Pick a session in the week/)).toBeTruthy();
  });
});

describe('An accepted proposal (2026-10-16)', () => {
  it('leaves the Plan screen once accepted — after a reload too — and says so while it is applied', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ calendar: demo.view('calendar'), program: demo.view('program') });
    const plan = demo.result('plan_proposal');
    const proposed = req({ id: 'r2', kind: 'question', text: 'Plan next week', result: { kind: 'plan_proposal', payload: plan } });
    show(<Plan />, store({}, { requests: [proposed] }), '/plan', '/plan');
    expect(await screen.findByRole('button', { name: 'Accept as is' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Review the proposal/ }).getAttribute('href')).toBe(`/plan/proposal/${plan.id}`);
    cleanup();
    const accepting = req({ id: 'r3', kind: 'accept', text: `Accept plan ${plan.id}`, params: { proposal: plan.id }, state: 'WORKING' });
    show(<Plan />, store({}, { requests: [proposed, accepting] }), '/plan', '/plan');
    expect(await screen.findByText(/the coach is applying it/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Accept as is' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    show(<Plan />, store({}, { requests: [proposed, { ...accepting, state: 'DONE' }] }), '/plan', '/plan');
    await screen.findByRole('heading', { name: 'Plan & calendar' });
    expect(screen.queryByText(/Plan proposal/)).toBeNull();
  });
});

describe('Workouts (U23)', () => {
  it('reaches the whole history from a range chip, and says how much is left', async () => {
    atFixtureDay(demo.index.generated_on);
    const v = demo.view('sessions');
    serveViews({ sessions: v });
    show(<Workouts />, store());
    await screen.findByRole('heading', { name: 'Workouts' });
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Range' })).getByRole('radio', { name: 'All' }));
    const total = v.sessions.length;
    expect(screen.getByRole('button', { name: `Show ${Math.min(30, total - 30)} more · ${total - 30} left in this range` })).toBeTruthy();
  });
});

describe('The flag dialog (U11)', () => {
  it('takes focus when it opens, and is sent once', async () => {
    atFixtureDay(demo.index.generated_on);
    const w = demo.index.views.workout.map((e: { arg: string }) => demo.view('workout', e.arg)).find((x: { group: string }) => x.group === 'strength');
    serveViews({ [`workout|${w.id}`]: w });
    const s: Store = store();
    show(<Workout />, s, `/workouts/${w.id}`, '/workouts/:id');
    fireEvent.click(await screen.findByRole('button', { name: /This number looks wrong/ }));
    const dialog = screen.getByRole('dialog', { name: 'This number looks wrong' });
    expect(document.activeElement?.id).toBe('why');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Send to coach' })); });
    expect(s.ask).toHaveBeenCalledTimes(1);
    expect((within(dialog).getByRole('button', { name: /Sent/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Dates (U8)', () => {
  it("today is this Mac's calendar date, not UTC's", () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 0, 30));   // 00:30 local — east of UTC, still the 11th in UTC
    expect(todayIso()).toBe('2026-10-12');
    expect(isoDate(new Date(2026, 9, 12, 23, 59))).toBe('2026-10-12');
  });
});
