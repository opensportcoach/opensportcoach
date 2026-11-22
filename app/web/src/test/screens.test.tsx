/** The flows a person sees, on the committed fixtures (docs/DESIGN.md (app audit) L2). */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Today from '../screens/Today';
import Workout from '../screens/Workout';
import Recovery from '../screens/Recovery';
import Workouts from '../screens/Workouts';
import Load from '../screens/Load';
import { SendToWatch } from '../components/SendToWatch';
import { atFixtureDay, fixtureSet, serveViews, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const demo = fixtureSet('demo');
const fresh = fixtureSet('demo-new');
/** The fixture workout of a sport group ('bike'), or of a kind ('circuit', 'sport'). */
const workout = (set: ReturnType<typeof fixtureSet>, group: string) =>
  set.index.views.workout.map((e: { arg: string }) => set.view('workout', e.arg)).find((w: { group: string; kind: string }) => w.group === group || w.kind === group);

describe('Today — the call', () => {
  it("shows today's call with the call's own workout, and says when the watch has another (H2)", async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    serveViews({ today: t });
    show(<Today />, store());
    expect(await screen.findByText('TRAIN')).toBeTruthy();
    expect(screen.getByText(new RegExp(`Open ${t.call_program.name}`))).toBeTruthy();
    if (t.plan_today?.day && t.plan_today.day !== t.call_program.key) {
      expect(screen.getByText(/Your watch has/)).toBeTruthy();
    }
  });

  it("never shows yesterday's call as today's (H2)", async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    const y = new Date(`${demo.index.generated_on}T12:00:00`); y.setDate(y.getDate() - 1);
    serveViews({ today: { ...t, daily: { ...t.daily, date: y.toISOString().slice(0, 10) }, call_program: null } });
    show(<Today />, store());
    expect(await screen.findByText('No call yet today')).toBeTruthy();
    expect(screen.getByText(/Last call/)).toBeTruthy();
    expect(screen.queryByText('TRAIN')).toBeNull();
  });

  it('says DONE once a session is logged today, and labels yesterday\'s overnight numbers (M2)', async () => {
    atFixtureDay(fresh.index.generated_on);
    serveViews({ today: fresh.view('today') });
    show(<Today />, store({}, { display: 'Sam' }));
    expect(await screen.findByText('DONE')).toBeTruthy();
    expect(screen.getByText(/this morning’s reading hasn’t reached Garmin yet/)).toBeTruthy();
    expect(screen.getByText(/lifted .* t/)).toBeTruthy();   // M1: strength beside the cardio strain
  });

  it("shows the coach's startup work instead of a stale call", async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    const now = Date.now();
    serveViews({ today: { ...t, daily: null, call_program: null } });
    show(<Today />, store({}, { status: { text: 'Pulling today’s Garmin data', since: now, updated: now } }));
    expect(await screen.findByText('The coach is on it')).toBeTruthy();
    expect(screen.getByText('Pulling today’s Garmin data')).toBeTruthy();
  });
});

describe('Today — how do you feel', () => {
  it('asks it on Today when the coach waits on it, and sends the answer as a check-in', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    const now = Date.now();
    serveViews({ today: { ...t, daily: null, call_program: null } });
    const s = store({}, { status: { text: 'How do you feel? Answer on Today — or here in the terminal.', since: now, updated: now, ask: 'feel' } });
    show(<Today />, s);
    expect(await screen.findByText('The coach is on it')).toBeTruthy();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);   // in the hero only — the check-in card waits
    fireEvent.click(screen.getByRole('radio', { name: /4\s*Good/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(s.ask).toHaveBeenCalledWith('checkin', 'Feeling 4/5 — Good', { feel: 4 });
    expect(screen.getByText(/The coach is waiting for your answer/)).toBeTruthy();
  });

  it('asks it in the hero while the coach works, even before the coach says it waits (2026-11-22)', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    const now = Date.now();
    serveViews({ today: { ...t, daily: null, call_program: null } });
    const s = store({}, { status: { text: 'Data refreshed — analysing your last session', since: now, updated: now } });
    show(<Today />, s);
    expect(await screen.findByText('The coach is on it')).toBeTruthy();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);   // in the hero, not twice
    expect(screen.getByText(/the coach won’t have to stop to ask/)).toBeTruthy();
    expect(screen.queryByText(/The coach is waiting for your answer/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /2\s*Tired/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(s.ask).toHaveBeenCalledWith('checkin', 'Feeling 2/5 — Tired', { feel: 2 });
  });

  it("doesn't ask in the hero when today already has an answer — the card shows it", async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    const now = Date.now();
    serveViews({ today: { ...t, daily: null, call_program: null } });
    show(<Today />, store({}, {
      status: { text: 'Re-weighing today’s call', since: now - 60_000, updated: now },
      requests: [{ id: 'r3', kind: 'checkin', text: 'Feeling 4/5 — Good', params: { feel: 4 }, state: 'DONE', createdAt: now - 3_600_000, progress: [] }],
    }));
    expect(await screen.findByText('The coach is on it')).toBeTruthy();
    expect(screen.getByText('Today you told the coach')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('stops asking once the coach moves on — the answer came in the terminal', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    const now = Date.now();
    serveViews({ today: { ...t, daily: null, call_program: null } });
    show(<Today />, store({}, { status: { text: 'Writing today’s call', since: now - 60_000, updated: now, answered: true } }));
    expect(await screen.findByText('The coach is on it')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText(/Got it — the coach has it/)).toBeTruthy();
  });
});

describe('Today — the tiles and the week (R2 R3 R4 R6)', () => {
  it('leads HRV and resting HR with their 7-day trend, draws last night\'s stages, names the form zone, and compares the week', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    serveViews({ today: t });
    show(<Today />, store());
    await screen.findByText('TRAIN');
    const hrv7 = t.vitals.at(-1).hrv_7d;
    const tile = screen.getByText('HRV · 7-day').parentElement!;
    expect(tile.textContent).toContain(String(hrv7));
    expect(tile.textContent).toContain(`last night ${t.today.hrv.value}`);
    expect(screen.getByRole('img', { name: /Last night's stages/ })).toBeTruthy();
    expect(screen.getByText('Form').parentElement!.textContent).toMatch(/Detraining|Fresh|Neutral|Building|Overreaching/);
    const table = screen.getByRole('table', { name: /This week against last week, like for like/ });
    expect(table.textContent).toContain('Training time');
    expect(table.textContent).toContain(`${(t.week_compare.this.to_date.tonnage / 1000).toFixed(1)} t`);
  });
});

describe('Today — pending decisions (R1)', () => {
  it('sends each answer in a shape the server accepts', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ today: demo.view('today') });
    const s = store();
    show(<Today />, s);
    fireEvent.click(await screen.findByRole('button', { name: 'It was hot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Send to watch/ }).at(-1)!);
    const calls = (s.ask as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => [c[0], c[2]])).toEqual([['question', { pending_id: 'p2' }], ['accept', { pending_id: 'p1' }], ['push', undefined]]);
    // askChecked refuses what the server refuses: every call resolved.
    for (const r of (s.ask as ReturnType<typeof vi.fn>).mock.results) await expect(r.value).resolves.toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an item answered earlier stays answered after a reload, from the request book', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    serveViews({ today: t });
    const q = t.daily.pending.find((p: { kind: string }) => p.kind === 'question');
    show(<Today />, store({}, { requests: [{ id: 'r4', kind: 'question', text: `${q.text} — It was hot`, params: { pending_id: q.id },
      state: 'DONE', createdAt: Date.parse(t.daily.generated_at) + 60_000, progress: [], reply: 'Noted.' }] }));
    expect(await screen.findByText(/Answered: It was hot · the coach has it/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'It was hot' })).toBeNull();
  });

  it('a refused answer says so and offers the buttons again', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ today: demo.view('today') });
    const s = store({ ask: vi.fn(async () => { throw new Error('question takes no parameter "pending_id"'); }) });
    show(<Today />, s);
    fireEvent.click(await screen.findByRole('button', { name: 'It was hot' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Not sent — question takes no parameter/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'It was hot' })).toBeTruthy();
  });
});

describe('Today — asked once a day (round 3)', () => {
  it("shows today's answer instead of asking again, and asks again only when they choose to", async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    serveViews({ today: t });
    show(<Today />, store());
    await screen.findByText('TRAIN');
    expect(screen.getByText('Today you told the coach')).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: /How do you feel/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Feeling different\? Update it/ }));
    expect(screen.getByRole('radiogroup', { name: /How do you feel/ })).toBeTruthy();
  });

  it('a check-in sent today counts as the answer, and the coach\'s question stops asking', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    const now = Date.now();
    serveViews({ today: { ...t, daily: null, call_program: null } });
    show(<Today />, store({}, {
      status: { text: 'How do you feel?', since: now - 60_000, updated: now - 60_000, ask: 'feel' },
      requests: [{ id: 'r9', kind: 'checkin', text: 'Feeling 3/5 — OK', params: { feel: 3 }, state: 'DONE', createdAt: now - 30_000, progress: [] }],
    }));
    expect(await screen.findByText('The coach is on it')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getAllByText(/Got it/).length).toBeGreaterThan(0);
  });

  it('an answer to an older daily still counts — matched since the daily was written, not by day', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    const y = new Date(Date.now() - 86_400_000);
    const yIso = y.toLocaleDateString('en-CA');
    const daily = { ...t.daily, date: yIso, generated_at: `${yIso}T08:00:00` };
    serveViews({ today: { ...t, daily, call_program: null } });
    const q = daily.pending.find((p: { kind: string }) => p.kind === 'question');
    show(<Today />, store({}, { requests: [{ id: 'r5', kind: 'question', text: `${q.text} — Neither`, params: { pending_id: q.id }, state: 'QUEUED', createdAt: Date.now(), progress: [] }] }));
    await screen.findByText('Waiting for you');
    // Today's check-in is open too, and open items come first: the answered one may sit past the first three.
    const more = screen.queryByRole('button', { name: /^\+ \d+ more$/ });
    if (more) fireEvent.click(more);
    expect(screen.getByText(/Answered: Neither · sent to the coach/)).toBeTruthy();
  });
});

describe('Workout pages', () => {
  it('a ride: laps on proportional widths with a table, and its own analysis (H/E)', async () => {
    atFixtureDay(demo.index.generated_on);
    const w = workout(demo, 'bike');
    const review = demo.result('endurance_review');
    serveViews({ [`workout|${w.id}`]: w });
    show(<Workout />, store({}, { requests: [{ id: 'r9', kind: 'workflow', text: 'Analyse this ride', params: { name: 'review', activity_id: String(w.id) },
      state: 'DONE', createdAt: 0, progress: [], result: { kind: 'endurance_review', payload: { ...review, activity_id: w.id } } }] }),
    `/workouts/${w.id}`, '/workouts/:id');
    expect(await screen.findByText(review.verdict)).toBeTruthy();
    expect(screen.getAllByText(/Decoupling/).length).toBeGreaterThan(0);
    expect(screen.getByText(/width = distance/)).toBeTruthy();
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(w.laps.length + 1);
  });

  it('the linked charts read and select from the keyboard (L4)', async () => {
    atFixtureDay(demo.index.generated_on);
    const w = workout(demo, 'bike');
    serveViews({ [`workout|${w.id}`]: w });
    show(<Workout />, store(), `/workouts/${w.id}`, '/workouts/:id');
    const charts = await screen.findByRole('group', { name: /Ride charts/ });
    fireEvent.keyDown(charts, { key: 'ArrowRight' });
    for (let i = 0; i < 5; i++) fireEvent.keyDown(charts, { key: 'ArrowRight', shiftKey: true });
    expect(screen.getByText(/^Selected /)).toBeTruthy();
    fireEvent.keyDown(charts, { key: 'Escape' });
    expect(screen.queryByText(/^Selected /)).toBeNull();
  });

  it('a circuit: its stations, the watch\'s guess marked (M3)', async () => {
    atFixtureDay(demo.index.generated_on);
    const w = workout(demo, 'circuit');
    serveViews({ [`workout|${w.id}`]: w });
    show(<Workout />, store(), `/workouts/${w.id}`, '/workouts/:id');
    expect(await screen.findByText('Sled Push')).toBeTruthy();
    expect(screen.getByText(/named by the watch — unverified/)).toBeTruthy();
    expect(screen.queryByText('Distance')).toBeNull();
  });
});

describe('Sports by their own names (R5)', () => {
  it('tennis is Tennis on Workouts — never "Circuit" — and the Circuit filter keeps only circuits', async () => {
    atFixtureDay(demo.index.generated_on);
    const v = demo.view('sessions');
    serveViews({ sessions: v });
    show(<Workouts />, store());
    const tennis = v.sessions.filter((x: { sport: string }) => x.sport === 'Tennis');
    expect(tennis.length).toBeGreaterThan(0);
    expect(tennis.every((x: { kind: string }) => x.kind === 'sport')).toBe(true);
    await screen.findByRole('toolbar', { name: 'Filters' });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2000-01-01' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Circuit' }));
    const rows = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/workouts/'));
    const circuits = v.sessions.filter((x: { kind: string }) => x.kind === 'circuit');
    expect(rows).toHaveLength(circuits.length);
    expect(rows.every((a) => !/Tennis/.test(a.textContent ?? ''))).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Other sports' }));
    expect(screen.getAllByText('Tennis').length).toBeGreaterThan(0);
  });

  it("Today's week names each day's sport", async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    serveViews({ today: t });
    show(<Today />, store());
    const sports = (t.week.days as { items: { sport: string }[] }[]).flatMap((d) => d.items.slice(0, 1).map((i) => i.sport));
    await screen.findByText('TRAIN');
    for (const sp of new Set(sports)) expect(screen.getAllByText(new RegExp(`^${sp}( · today)?$`)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Activity/)).toBeNull();
  });
});

describe('Recovery — one night, picked at the top (R7–R10)', () => {
  it("shows last night, and every card follows a night picked on the strip or the chart", async () => {
    atFixtureDay(demo.index.generated_on);
    const r = demo.view('recovery');
    serveViews({ recovery: r });
    show(<Recovery />, store());
    const last = r.nights[r.nights.length - 1];
    const heading = await screen.findByText(/Sleep stages · night to/);
    expect(document.querySelectorAll('[data-stage]').length).toBe(last.segments.length);
    // The score read plainly: a card per signal with its state in words, and the score as the sum of
    // the signals' points (the engine's, never recomputed here).
    const rec = r.calendar.find((c: { date: string }) => c.date === last.date);
    const sum = screen.getByRole('note', { name: 'How the score adds up' });
    expect(sum.textContent).toContain(String(rec.score));
    for (const c of rec.components) expect(sum.textContent).toContain(String(Math.round(c.points)));
    expect(screen.getAllByRole('img', { name: /30 days, against your usual/ })).toHaveLength(rec.components.length);
    expect(screen.getAllByText(/Your usual|Need met|Above your usual|Lower than usual/).length).toBeGreaterThan(0);
    // The heart rate has its own strip and axis; the hover readout starts with how to use it.
    expect(screen.getByText(/Hover the night/)).toBeTruthy();
    // Pick an older night on the strip: the stages, the night card and the vitals follow.
    const other = r.nights[r.nights.length - 4];
    const label = (iso: string) => { const d = new Date(`${iso}T12:00:00`); return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`; };
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(`Night to .* ${label(other.date)}`) }));
    expect(heading.textContent).toContain(label(other.date));
    expect(screen.getByRole('heading', { name: /^Night to / })).toBeTruthy();
    expect(screen.getByText(new RegExp(`Overnight vitals · night to ${label(other.date)}`))).toBeTruthy();
    expect(screen.getAllByText(/vs usual|as usual/).length).toBeGreaterThanOrEqual(4);
    fireEvent.click(screen.getByRole('button', { name: 'Last night' }));
    expect(heading.textContent).toContain(label(last.date));
    // The arrows step one night.
    fireEvent.click(screen.getByRole('button', { name: 'Previous night' }));
    expect(heading.textContent).toContain(label(r.nights[r.nights.length - 2].date));
  });
});

describe('Training load (R11)', () => {
  it('compares this week with the usual one, counts time for every sport, and keeps tennis out of the circuits', async () => {
    atFixtureDay(demo.index.generated_on);
    const l = demo.view('load');
    serveViews({ load: l });
    show(<Load />, store());
    expect(await screen.findByText('This week vs your usual')).toBeTruthy();
    for (const label of ['Training time · all sports', 'Cardio · Garmin load', 'Strength · tonnage']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getAllByText(/on your usual pace|ahead of your usual pace|behind your usual pace|the week has just started/).length).toBe(3);
    // U15: on day one, a meter with nothing logged says the week is starting — not "behind" in yellow.
    const cur = l.weeks[l.weeks.length - 1];
    const empty = [Object.values(cur.minutes ?? {}).reduce((a: number, b) => a + Number(b), 0), cur.cardio_total, cur.tonnage].filter((v) => !v).length;
    if ((l.days_so_far ?? 7) <= 1) expect(screen.queryAllByText(/the week has just started/)).toHaveLength(empty);
    // Twelve calendar weeks, rest weeks included; tennis is "Other sports", never a circuit.
    expect(l.weeks).toHaveLength(12);
    const tennisWeeks = l.weeks.filter((w: { sports: Record<string, number> }) => w.sports.Tennis);
    expect(tennisWeeks.length).toBeGreaterThan(0);
    for (const w of tennisWeeks) expect(w.cardio.sport).toBeGreaterThan(0);
    expect(screen.getAllByText('Other sports').length).toBeGreaterThan(0);
    // Form's zones: the page names the current one.
    expect(screen.getByText(/Fitness · fatigue · form/).parentElement!.textContent).toMatch(/Detraining|Fresh|Neutral|Building|Overreaching/);
  });
});

describe('Send to watch', () => {
  it('names the athlete and the account, and counts the changes', () => {
    const plan = demo.result('push_plan');
    show(<SendToWatch />, store({ sendToWatch: { plan, request: { id: 'r1', kind: 'push', text: 'x', state: 'DONE', createdAt: 0, progress: [] } } }));
    expect(screen.getByRole('heading', { name: 'Send to watch' })).toBeTruthy();
    expect(screen.getByText(plan.garmin_account)).toBeTruthy();
    const n = plan.actions.filter((a: { verb: string }) => a.verb !== 'in_sync').length;
    expect(screen.getByText(new RegExp(`Changes on the watch · ${n}`, 'i'))).toBeTruthy();
  });
});
