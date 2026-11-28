/** Trips (docs/DESIGN.md (trips)), on the committed fixtures: the synthetic Demo athlete leaves for Lakeside
 * next Monday — no gym, no pool, a bike that is still a maybe, limited time — with D1 · Push on the watch that
 * day, and goes to Hill Town three weeks out with a pool, the bike and courts. Every write the page makes
 * is one the server's trips action accepts (requests.ts checkTrip, through the harness's store). */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Season from '../screens/Season';
import Today from '../screens/Today';
import Plan from '../screens/Plan';
import type { TripsView } from '../lib/trips';
import { atFixtureDay, fixtureSet, serveViews, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const demo = fixtureSet('demo');
const fresh = fixtureSet('demo-new');
const calls = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock;

describe('Trips on the Season page', () => {
  it('lists each trip ahead with what its place has, its clash and its open maybe', async () => {
    atFixtureDay(demo.index.generated_on);
    const v: TripsView = demo.view('trips');
    serveViews({ races: demo.view('races'), trips: v });
    show(<Season />, store());
    const lake = await screen.findByRole('article', { name: /^Lakeside/ });
    expect(within(lake).getByText('Gym').closest('.chip')!.textContent).toContain('✕');
    expect(within(lake).getByText('Bike').closest('.chip')!.textContent).toContain('?');
    expect(within(lake).getByText('Running').closest('.chip')!.textContent).toContain('✓');
    expect(within(lake).getByText('Limited time')).toBeTruthy();
    expect(within(lake).getByText('Is your bike coming to Lakeside?')).toBeTruthy();
    expect(within(lake).getByText(/1 session doesn’t fit/)).toBeTruthy();
    expect(within(lake).getByText(/D1 · Push/)).toBeTruthy();
    const hill = screen.getByRole('article', { name: /^Hill Town/ });
    expect(within(hill).getByText(/leave in the evening · back in the morning/)).toBeTruthy();
    expect(within(hill).queryByText(/doesn’t fit/)).toBeNull();
  });

  it('settles a maybe, replans and removes in shapes the server accepts', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ races: demo.view('races'), trips: demo.view('trips') });
    const s = store();
    show(<Season />, s);
    const lake = await screen.findByRole('article', { name: /^Lakeside/ });
    fireEvent.click(within(lake).getByRole('button', { name: 'Yes' }));
    fireEvent.click(within(lake).getByRole('button', { name: 'Replan around it' }));
    fireEvent.click(within(lake).getByRole('button', { name: 'Remove the Lakeside trip' }));
    expect(calls(s.trips).calls.map((c) => c[0])).toEqual([
      { action: 'answer', id: 'lakeside', access: 'bike', state: 'yes' }, { action: 'remove', id: 'lakeside' }]);
    for (const r of calls(s.trips).results) await expect(r.value).resolves.toBeTruthy();
    expect(calls(s.ask).calls.map((c) => [c[0], c[2]])).toEqual([['plan', { about: 'trip lakeside' }]]);
    await expect(calls(s.ask).results[0].value).resolves.toBeTruthy();
  });

  it('adds a trip from the form: every place answered, nothing assumed, saved without the coach', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ races: fresh.view('races'), trips: fresh.view('trips') });
    const s = store();
    show(<Season />, s);
    expect(await screen.findByText(/No trips ahead/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add a trip/ }));
    const form = screen.getByRole('form', { name: 'Add a trip' });
    const save = within(form).getByRole('button', { name: 'Save the trip' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(form).getByPlaceholderText('City or place'), { target: { value: 'Seaport' } });
    fireEvent.change(within(form).getByLabelText('First day'), { target: { value: '2026-12-24' } });
    fireEvent.change(within(form).getByLabelText('Last day'), { target: { value: '2027-01-02' } });
    fireEvent.click(within(within(form).getByRole('radiogroup', { name: 'Running' })).getByRole('radio', { name: /Yes/ }));
    fireEvent.click(within(within(form).getByRole('radiogroup', { name: 'Bike' })).getByRole('radio', { name: /Maybe/ }));
    fireEvent.change(within(form).getByLabelText(/You leave in the/), { target: { value: 'evening' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    const body = calls(s.trips).calls[0][0];
    expect(body).toEqual({ action: 'save', trip: { where: 'Seaport', from: '2026-12-24', to: '2027-01-02', time: null, leave: 'evening', back: null, note: null,
      access: { gym: 'no', pool: 'no', bike: 'maybe', trainer: 'no', run: 'yes', courts: 'no' } } });
    await expect(calls(s.trips).results[0].value).resolves.toBeTruthy();
  });

  it('shows the refusal when the engine refuses a trip, and keeps the form', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ races: fresh.view('races'), trips: fresh.view('trips') });
    const s = store({ trips: vi.fn(async () => { throw new Error('it overlaps Lakeside (2026-11-30 → 2026-12-03): a day is in one trip at most'); }) });
    show(<Season />, s);
    fireEvent.click(await screen.findByRole('button', { name: /Add a trip/ }));
    const form = screen.getByRole('form', { name: 'Add a trip' });
    fireEvent.change(within(form).getByPlaceholderText('City or place'), { target: { value: 'Lakeside again' } });
    fireEvent.change(within(form).getByLabelText('First day'), { target: { value: '2026-12-01' } });
    fireEvent.change(within(form).getByLabelText('Last day'), { target: { value: '2026-12-02' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save the trip' }));
    expect(await within(form).findByRole('alert')).toBeTruthy();
    expect(within(form).getByRole('alert').textContent).toMatch(/overlaps Lakeside/);
  });
});

describe('Trips on Today and Plan', () => {
  it('Today names the trip ahead, its clash, and asks the maybe due an answer', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    serveViews({ today: t });
    const s = store();
    show(<Today />, s);
    const line = await screen.findByRole('region', { name: 'Trip' });
    expect(within(line).getByText(/^Lakeside in \d+ days?$/)).toBeTruthy();
    expect(within(line).getByText(/1 session clashes with it/)).toBeTruthy();
    fireEvent.click(within(line).getByRole('button', { name: 'No' }));
    expect(calls(s.trips).calls[0][0]).toEqual({ action: 'answer', id: 'lakeside', access: 'bike', state: 'no' });
    await expect(calls(s.trips).results[0].value).resolves.toBeTruthy();
  });

  it('Today shows nothing for an athlete with no trip', async () => {
    atFixtureDay(fresh.index.generated_on);
    serveViews({ today: fresh.view('today') });
    show(<Today />, store());
    await screen.findAllByText(/./);
    expect(screen.queryByRole('region', { name: 'Trip' })).toBeNull();
  });

  it('Plan marks the trip days and lists what clashes with the trip, with one request to replan', async () => {
    atFixtureDay(demo.index.generated_on);
    const cal = demo.view('calendar');
    serveViews({ calendar: cal, program: demo.view('program'), races: demo.view('races'), today: demo.view('today') });
    const s = store();
    const first = cal.trip_days[0].date as string;
    show(<Plan />, s, `/plan?date=${first}`, '/plan');
    const banner = await screen.findByText(/1 session doesn’t fit the Lakeside trip/);
    const box = banner.closest('[role="alert"]') as HTMLElement;
    expect(within(box).getByText(/D1 · Push/)).toBeTruthy();
    expect(within(box).getByText(/no gym in Lakeside · on the watch/)).toBeTruthy();
    expect(screen.getAllByText(/^Lakeside \d\/4/).length).toBe(4);
    fireEvent.click(within(box).getByRole('button', { name: 'Replan around it' }));
    expect(calls(s.ask).calls.map((c) => [c[0], c[2]])).toEqual([['plan', { about: 'trip lakeside' }]]);
    await expect(calls(s.ask).results[0].value).resolves.toBeTruthy();
  });
});
