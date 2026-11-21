/** Strength & progress: every lift, grouped by the engine's muscle attribution, filterable and collapsible.
 * On the committed demo fixtures. */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Strength from '../screens/Strength';
import { isoDate } from '../lib/fmt';
import { atFixtureDay, fixtureSet, serveViews, show, store } from './harness';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

const demo = fixtureSet('demo');

async function render(view = demo.view('strength')) {
  atFixtureDay(demo.index.generated_on);
  serveViews({ strength: view });
  const r = show(<Strength />, store());
  await screen.findByText('Every lift · classified over its sessions');
  return r;
}
const groupsOf = (c: HTMLElement) => [...c.querySelectorAll('tbody[data-group]')].map((t) => t.getAttribute('data-group'));
const group = (c: HTMLElement, g: string) => c.querySelector(`tbody[data-group="${g}"]`) as HTMLElement;
const lifts = (c: HTMLElement, g: string) => within(group(c, g)).queryAllByRole('link').map((a) => a.textContent);
const header = (c: HTMLElement, g: string) => within(group(c, g)).getAllByRole('button')[0];
const daysBefore = (n: number) => { const d = new Date(`${demo.index.generated_on}T12:00:00`); d.setDate(d.getDate() - n); return isoDate(d); };

describe('Strength — every lift, by muscle', () => {
  it("groups lifts in the engine's muscle order, with counts, stalled and regressed first", async () => {
    const v = demo.view('strength');
    const { container } = await render(v);
    const present = new Set(v.lifts.map((x: { muscle: string }) => x.muscle));
    expect(groupsOf(container)).toEqual(v.muscles.filter((m: string) => present.has(m)));
    const back = v.lifts.filter((x: { muscle: string }) => x.muscle === 'Back');
    const backProg = back.filter((x: { class: string }) => x.class === 'PROGRESSING').length;
    expect(header(container, 'Back').textContent).toContain(`${back.length} lifts`);
    expect(header(container, 'Back').textContent).toContain(`${backProg} progressing`);
    // The demo's lateral raise is its stalled lift: it leads Delts.
    const stalled = v.lifts.find((x: { class: string }) => x.class === 'STALLED');
    expect(lifts(container, stalled.muscle)[0]).toBe(stalled.label);
    expect(header(container, stalled.muscle).textContent).toContain('1 stalled');
  });

  it('puts Athletic after the muscles, Unattributed last, and lifts not trained in six weeks in a closed group', async () => {
    const v = demo.view('strength');
    v.lifts[0].muscle = 'Unattributed';
    v.lifts[1].muscle = 'Athletic';
    const old = v.lifts[2];
    old.last = daysBefore(60);
    const { container } = await render(v);
    const order = groupsOf(container);
    expect(order.slice(-3)).toEqual(['Athletic', 'Unattributed', 'Not trained lately']);
    expect(header(container, 'Not trained lately').getAttribute('aria-expanded')).toBe('false');
    expect(lifts(container, 'Not trained lately')).toEqual([]);
    fireEvent.click(header(container, 'Not trained lately'));
    expect(lifts(container, 'Not trained lately')).toEqual([old.label]);
  });

  it('filters to the lifts that need attention, or that progress, and remembers the choice', async () => {
    const v = demo.view('strength');
    v.lifts[0].class = 'REGRESSED';
    const { container, unmount } = await render(v);
    fireEvent.click(screen.getByRole('button', { name: /Needs attention/ }));
    const shown = [...container.querySelectorAll('tbody a')].map((a) => a.textContent);
    const want = v.lifts.filter((x: { class: string }) => x.class === 'STALLED' || x.class === 'REGRESSED');
    expect(shown.sort()).toEqual(want.map((x: { label: string }) => x.label).sort());
    expect(localStorage.getItem('adn-strength-filter')).toBe('"attention"');
    unmount();
    const again = show(<Strength />, store());
    await screen.findByText('Every lift · classified over its sessions');
    expect(screen.getByRole('button', { name: /Needs attention/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^Progressing/ }));
    const prog = [...again.container.querySelectorAll('tbody a')].map((a) => a.textContent);
    expect(prog.length).toBe(v.lifts.filter((x: { class: string }) => x.class === 'PROGRESSING').length);
  });

  it('collapses a group, remembers it, and says so when a filter leaves nothing', async () => {
    const v = demo.view('strength');
    v.lifts = v.lifts.map((x: { class: string }) => ({ ...x, class: x.class === 'STALLED' ? 'FLAT' : x.class }));
    const { container, unmount } = await render(v);
    expect(lifts(container, 'Back').length).toBeGreaterThan(0);
    fireEvent.click(header(container, 'Back'));
    expect(header(container, 'Back').getAttribute('aria-expanded')).toBe('false');
    expect(lifts(container, 'Back')).toEqual([]);
    unmount();
    const again = show(<Strength />, store());
    await screen.findByText('Every lift · classified over its sessions');
    expect(lifts(again.container, 'Back')).toEqual([]);
    expect(lifts(again.container, 'Chest').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Needs attention/ }));
    expect(screen.getByText('Nothing needs attention.')).toBeTruthy();
  });

  it('still works when storage throws (a private window)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { container } = await render();
    fireEvent.click(screen.getByRole('button', { name: /Needs attention/ }));
    expect(screen.getByRole('button', { name: /Needs attention/ }).getAttribute('aria-pressed')).toBe('true');
    expect(groupsOf(container).length).toBeGreaterThan(0);
  });
});
