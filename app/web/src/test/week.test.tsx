/** Today's This week (board Week-Numbers, handoff 2026-10-25): like for like, planned work hatched,
 * colour only against a coach target. On the committed demo fixtures (Sat 17 Oct: Legs still planned,
 * so the comparison runs Mon–Fri). */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeekNumbers } from '../components/WeekNumbers';
import { atFixtureDay, fixtureSet, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const demo = fixtureSet('demo');
const hmin = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;

function render(t = demo.view('today')) {
  atFixtureDay(demo.index.generated_on);
  const r = show(<WeekNumbers t={t} />, store());
  const row = (label: string) => screen.getByRole('rowheader', { name: label }).closest('[role="row"]') as HTMLElement;
  return { ...r, t, row };
}

describe('This week — like for like', () => {
  it('compares to the last finished day, with last week cut at the same day and its full total as context', () => {
    const { t, row } = render();
    const wc = t.week_compare;
    const cutDow = wc.this.days[wc.cut].dow;
    expect(wc.cut).toBeLessThan(wc.today_index);   // today's Legs is still planned
    expect(screen.getByRole('columnheader', { name: `By ${cutDow}` })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: `Last week, Mon–${cutDow}` })).toBeTruthy();
    const time = row('Training time');
    expect(time.textContent).toContain(hmin(wc.this.to_date.minutes));
    expect(time.textContent).toContain(`vs ${hmin(wc.last.to_date.minutes)} · full week was ${hmin(wc.last.full.minutes)}`);
    expect(row('Tonnage').textContent).toContain(`${(wc.this.to_date.tonnage / 1000).toFixed(1)} t`);
    expect(screen.getByText(/last week by Friday/)).toBeTruthy();
    expect(screen.getByText(/Compared like for like: Mon–Fri this week against Mon–Fri last week/)).toBeTruthy();
  });

  it('hatches what is still planned and projects the week with it', () => {
    const { t, container, row } = render();
    const plan = t.week_compare.this.days[t.week_compare.today_index].planned;
    expect(plan.map((p: { title: string }) => p.title)).toContain('D3 · Legs');
    const ahead = t.week_compare.this.days.flatMap((d: { planned: { min: number | null }[] }) => d.planned);
    expect(container.querySelectorAll('[role="img"] [data-planned]').length).toBe(ahead.filter((p: { min: number | null }) => p.min).length);
    expect(row('Training time').querySelector('[data-planned]')).toBeTruthy();
    const proj = t.week_compare.this.to_date.minutes + t.week_compare.this.planned.minutes;
    expect(screen.getByText(new RegExp(`takes the week to ≈ ${hmin(proj)}`))).toBeTruthy();
    expect(container.querySelector('path[data-line="plan"]')).toBeTruthy();
  });

  it('colours a status only against a coach target, always with a word', () => {
    const { t, row } = render();
    const tg = t.week_compare.targets;
    expect(tg.minutes).toBeTruthy();
    const proj = t.week_compare.this.to_date.minutes + t.week_compare.this.planned.minutes;
    const word = proj < tg.minutes[0] ? 'Under target' : proj > tg.minutes[1] ? 'Over target' : 'On target with the plan';
    expect(within(row('Training time')).getByText(word)).toBeTruthy();
    expect(row('Training time').textContent).toContain(`target ${hmin(tg.minutes[0])}–${hmin(tg.minutes[1])}`);
    cleanup();
    const bare = demo.view('today');
    bare.week_compare.targets = { minutes: null, sets: null, cardio_load: null, sleep_need_h: null };
    const again = render(bare);
    expect(again.row('Training time').textContent).not.toMatch(/target/);
    expect(within(again.row('Training time')).getByText(/^(More|Less|Same)$/)).toBeTruthy();
    expect(again.container.querySelector('path[data-band]')).toBeNull();
  });

  it('splits distance by sport and never adds Garmin load to the kilos', () => {
    const { t, row } = render();
    const by = t.week_compare.this.to_date.km_by;
    for (const [g, v] of Object.entries(by as Record<string, number>)) {
      expect(row('Distance').textContent).toContain(`${{ run: 'Run', swim: 'Swim', bike: 'Ride' }[g] ?? g} ${(v as number).toFixed(1)}`);
    }
    expect(row('Garmin load').textContent).toContain(String(t.week_compare.this.to_date.cardio_load));
    expect(screen.getByText(/never added to it/)).toBeTruthy();
  });

  it('on day 1, shows everything as planned and the verdict is about the plan', () => {
    const t = demo.view('today');
    const wc = t.week_compare;
    const planned = wc.this.days.flatMap((d: { planned: unknown[] }) => d.planned);
    wc.cut = -1;
    wc.today_index = 0;
    wc.this.days = wc.this.days.map((d: object, i: number) => ({ ...d, sports: [], minutes: {}, planned: i === 0 ? planned : [] }));
    wc.this.to_date = { ...wc.this.to_date, minutes: 0, sessions: 0, tonnage: 0, sets: 0, cardio_load: 0, km: 0, km_by: {} };
    wc.this.since = null;
    const { container } = render(t);
    expect(screen.getByText(new RegExp(`^A new week: ${hmin(wc.this.planned.minutes)} planned in ${wc.this.planned.sessions} sessions`))).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Planned' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Last week, full' })).toBeTruthy();
    expect(screen.queryByRole('rowheader', { name: 'Garmin load' })).toBeNull();
    expect(container.querySelector('path[data-line="this"]')).toBeNull();
    expect(screen.getByText('Week starts')).toBeTruthy();
  });
});
