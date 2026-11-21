/** Fuel in the app (docs/DESIGN.md (fuelling and score) §6): the workout page's Fuel card — planned beside taken, the log
 * form that sends what the server accepts — Today's fuel items and the planned long ride's line, the setup
 * for a new athlete, and the Workouts list. On the committed demo fixtures (2026-10-17): Rocky owns a Maurten
 * Gel 160 and a MNSTRY Fast Carb bottle, logged the latest ride, and hasn't logged the one before it. */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Today from '../screens/Today';
import Workout from '../screens/Workout';
import Workouts from '../screens/Workouts';
import { FuelLine, FuelPlanBlock } from '../components/Fuel';
import Fuel from '../screens/Fuel';
import FuelSetup from '../screens/FuelSetup';
import FuelCue from '../screens/FuelCue';
import { checkFuelLog, checkFuelSetup } from '../../../channel/requests';
import { atFixtureDay, fixtureSet, fuelChecked, serveViews, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const demo = fixtureSet('demo');
const fresh = fixtureSet('demo-new');
const sessions = demo.view('sessions').sessions;
const rides = sessions.filter((s: any) => s.group === 'bike');
const logged = demo.view('workout', String(rides[0].id));
const dueRow = sessions.find((s: any) => s.fuel_due);
// The unlogged ride has no workout fixture of its own: the latest ride's page, as it read before it was logged.
const unlogged = { ...logged, fuel: { ...logged.fuel, taken: null, due: true } };
const longRide = demo.view('calendar').planned.find((p: any) => p.intent === 'endurance');

describe('The workout page’s Fuel card', () => {
  it('a logged ride shows what was taken, per hour, as the athlete’s own report', async () => {
    expect(logged.fuel.taken.g).toBe(80);
    serveViews({ [`workout|${logged.id}`]: logged });
    show(<Workout />, store(), `/workouts/${logged.id}`, '/workouts/:id');
    const card = await screen.findByRole('region', { name: 'Fuel' });
    expect(within(card).getByText('Logged')).toBeTruthy();   // no plan that day, so neither as planned nor short
    expect(within(card).getByText('you')).toBeTruthy();
    expect(within(card).getByText(`· ${logged.fuel.taken.g_h} g/h`)).toBeTruthy();
    expect(within(card).getAllByText('Gel 160').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: new RegExp(`Fuel · ${logged.fuel.taken.g_h} g/h`) })).toBeTruthy();
  });

  it('an unlogged ride asks, and the form sends a log the server accepts', async () => {
        const fuel = fuelChecked();
    serveViews({ [`workout|${unlogged.id}`]: unlogged });
    show(<Workout />, store({ fuel }), `/workouts/${unlogged.id}`, '/workouts/:id');
    const card = await screen.findByRole('region', { name: 'Fuel' });
    expect(within(card).getByText('to log')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'One more Maurten Gel 160' }));
    fireEvent.click(within(card).getByRole('button', { name: 'One more Maurten Gel 160' }));
    fireEvent.click(within(card).getByRole('button', { name: 'One more Bottle · MNSTRY Fast Carb Mango' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fuel).toHaveBeenCalled());
    const [action, body] = fuel.mock.calls[0];
    expect(action).toBe('log');
    expect(body).toEqual({ activity_id: unlogged.id, items: [{ kind: 'recipe', id: 'bottle', n: 1 }, { kind: 'product', id: 'maurten-gel-160', n: 2 }] });
    expect(await within(card).findByRole('status')).toBeTruthy();
  });

  it('"I took nothing" is a log too, so the session stops asking', async () => {
    const fuel = fuelChecked();
    serveViews({ [`workout|${unlogged.id}`]: unlogged });
    show(<Workout />, store({ fuel }), `/workouts/${unlogged.id}`, '/workouts/:id');
    const card = await screen.findByRole('region', { name: 'Fuel' });
    fireEvent.click(within(card).getByRole('button', { name: /I took nothing/ }));
    await waitFor(() => expect(fuel).toHaveBeenCalledWith('log', { activity_id: unlogged.id, items: [], nothing: true }));
  });

  it('something not in the catalog — today’s bars — logs by name and the carbs off its label', async () => {
    const fuel = fuelChecked();
    serveViews({ [`workout|${unlogged.id}`]: unlogged });
    show(<Workout />, store({ fuel }), `/workouts/${unlogged.id}`, '/workouts/:id');
    const card = await screen.findByRole('region', { name: 'Fuel' });
    fireEvent.change(within(card).getByLabelText('Name'), { target: { value: 'Clif Bar' } });
    fireEvent.change(within(card).getByLabelText('Carbs in one (g)'), { target: { value: '44' } });
    fireEvent.change(within(card).getByLabelText('How many'), { target: { value: '2' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Add' }));
    expect(within(card).getByRole('group', { name: 'Clif Bar' })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fuel).toHaveBeenCalled());
    expect(fuel.mock.calls[0]).toEqual(['log', { activity_id: unlogged.id, items: [{ kind: 'custom', label: 'Clif Bar', g_each: 44, n: 2 }] }]);
  });

  it('the server’s checks refuse what the page must never send', () => {
    expect(checkFuelLog({ activity_id: 1, items: [] })).toMatch(/exactly one/);
    expect(checkFuelLog({ activity_id: 1, items: [{ kind: 'product', id: 'a:b', n: 1 }] })).toMatch(/id/);
    expect(checkFuelLog({ activity_id: 1, items: [{ kind: 'snack', id: 'gel', n: 1 }] })).toMatch(/a product, a recipe or something else/);
    expect(checkFuelLog({ activity_id: 1, items: [{ kind: 'product', id: 'gel', n: 1 }], nothing: true })).toMatch(/exactly one/);
    expect(checkFuelLog({ activity_id: 1, items: [{ kind: 'custom', label: 'Clif Bar', g_each: 44, n: 2 }] })).toBeNull();
    expect(checkFuelLog({ activity_id: 1, items: [{ kind: 'custom', label: 'Bar|x', g_each: 44, n: 1 }] })).toMatch(/name/);
    expect(checkFuelLog({ activity_id: 1, items: [{ kind: 'custom', label: 'Bar', g_each: 400, n: 1 }] })).toMatch(/1–150/);
    expect(checkFuelSetup({})).toMatch(/nothing/);
    expect(checkFuelSetup({ caffeine: 'lots' })).toMatch(/caffeine/);
    expect(checkFuelSetup({ products: ['maurten-gel-160'], gut: 60, caffeine: 'races' })).toBeNull();
  });
});

describe('A planned session’s fuel', () => {
  it('the long ride: the rate, the grams, what to take, the timeline — every number from the view', () => {
    const p = longRide.fuel;
    show(<FuelPlanBlock plan={p} />, store());
    expect(screen.getByText(String(p.planned_g_h))).toBeTruthy();
    expect(document.body.textContent).toContain(`${p.planned_g} g over`);
    expect(screen.getAllByText('Fast Carb Mango').length).toBeGreaterThan(0);
    expect(screen.getByText(`${p.per_hour_grams[1].g} g`)).toBeTruthy();   // grams per hour, from the view
    expect(screen.getByRole('img', { name: /Fuel timeline/ })).toBeTruthy();
  });

  it('a ride the rule doesn’t fuel says so in one line', () => {
    const vo2 = demo.view('calendar').planned.find((p: any) => p.intent === 'vo2');
    show(<FuelLine plan={vo2.fuel} />, store());
    expect(screen.getByText(/No fuel needed/)).toBeTruthy();
  });
});

describe('Today and the list', () => {
  it('the call carries a fuel line for a session planned today that the rule fuels', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    // No session in the fixtures is planned on their own day: the long ride, moved to it.
    t.planned = [...t.planned, { ...longRide, date: demo.index.generated_on }];
    serveViews({ today: t });
    show(<Today />, store());
    const line = await screen.findByRole('group', { name: 'Fuel for today' });
    expect(within(line).getByText(/Long ride · Z2/)).toBeTruthy();
    expect(line.textContent).toContain(`${longRide.fuel.planned_g_h}g/h${longRide.fuel.planned_g} g over`);
    expect(line.textContent).toContain('Fast Carb Mango');
    expect(within(line).getByRole('link', { name: /Cue sheet/ }).getAttribute('href')).toContain('/fuel/cue?date=');
  });

  it('Today asks to log an unlogged ride, and "I took nothing" logs it', async () => {
    atFixtureDay(demo.index.generated_on);
    const t = demo.view('today');
    expect(t.fuel.due).toEqual([]);   // the unlogged ride is 27 days old on the fixtures' day: older than Today asks about
    t.fuel.due = [{ id: dueRow.id, date: dueRow.date, title: dueRow.title, group: dueRow.group, minutes: dueRow.duration_min, icon: dueRow.icon }];
    const fuel = fuelChecked();
    serveViews({ today: t });
    show(<Today />, store({ fuel }));
    const item = (await screen.findAllByText(/Log your fuel/))[0].closest('div')!.parentElement!.parentElement!;
    expect(within(item).getByRole('link', { name: 'Log it' }).getAttribute('href')).toBe(`/workouts/${dueRow.id}#fuel`);
    fireEvent.click(within(item).getByRole('button', { name: 'I took nothing' }));
    await waitFor(() => expect(fuel).toHaveBeenCalledWith('log', { activity_id: dueRow.id, items: [], nothing: true }));
  });

  it('a new athlete is asked to finish the setup, and the form sends answers the server accepts', async () => {
    atFixtureDay(fresh.index.generated_on);
    const fuel = fuelChecked();
    serveViews({ today: fresh.view('today'), fuel: fresh.view('fuel') });
    show(<Today />, store({ fuel }));
    expect((await screen.findByRole('link', { name: 'Answer' })).getAttribute('href')).toBe('/fuel/setup');
    cleanup();
    show(<FuelSetup />, store({ fuel }), '/fuel/setup', '/fuel/setup');
    const dialog = document.body;
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /Maurten Gel 160/ }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'About 60 g/h' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Races only' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save my setup' }));
    await waitFor(() => expect(fuel).toHaveBeenCalled());
    expect(fuel.mock.calls[0]).toEqual(['setup', { products: ['maurten-gel-160'], gut: 60, caffeine: 'races', notes: null }]);
  });

  it('the Workouts list marks what was taken and filters what still asks', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ sessions: demo.view('sessions') });
    show(<Workouts />, store());
    expect((await screen.findAllByText(`Fuel ${logged.fuel.taken.g_h} g/h`)).length).toBe(1);
    const filter = screen.getByRole('button', { name: /Fuel not logged · 1/ });
    fireEvent.click(filter);
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/workouts/')).map((a) => a.getAttribute('href'))).toEqual([`/workouts/${dueRow.id}`]);
  });
});

describe('The Fuel screen and the cue sheet', () => {
  it('shows the gut, the ramp, what is coming up and the setup — every number from the fuel view', async () => {
    atFixtureDay(demo.index.generated_on);
    const v = demo.view('fuel');
    serveViews({ fuel: v });
    show(<Fuel />, store(), '/fuel', '/fuel');
    expect(await screen.findByText(`${v.ramp.current_g_h} g/h`)).toBeTruthy();
    expect(screen.getByText(`${v.ramp.next_g_h} g/h`)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Gut training' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Long sessions/ })).toBeTruthy();   // the demo's logged 90-minute ride
    expect(screen.getByText('Long ride · Z2')).toBeTruthy();
    expect(screen.getByText('Races only')).toBeTruthy();
  });

  it('the cue sheet lists every cue of the plan, with its time and how', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ calendar: demo.view('calendar') });
    show(<FuelCue />, store(), `/fuel/cue?date=${longRide.date}&title=${encodeURIComponent(longRide.title)}`, '/fuel/cue');
    const sheet = await screen.findByRole('region', { name: /Cue sheet/ });
    for (const c of longRide.fuel.cues) expect(within(sheet).getAllByText(c.label).length).toBeGreaterThan(0);
    expect(within(sheet).getAllByText(/sip it|mouthful of water/).length).toBe(longRide.fuel.cues.length);
  });
});
