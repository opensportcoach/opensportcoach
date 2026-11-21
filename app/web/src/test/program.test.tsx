/** The Program screen (board Program v2): the week, a gym day's anatomy, and the sparse athlete. */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Program from '../screens/Program';
import { atFixtureDay, fixtureSet, serveViews, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const demo = fixtureSet('demo');
const fresh = fixtureSet('demo-new');

describe('Program v2', () => {
  it('draws the template week, a gym day in its phases with the number to beat, and removed lifts where they were', async () => {
    atFixtureDay(demo.index.generated_on);
    const p = demo.view('program');
    serveViews({ program: p });
    show(<Program />, store());
    expect(await screen.findByText(/The week · template/)).toBeTruthy();
    const anatomy = screen.getByRole('table', { name: /exercises in order/ });
    expect(within(anatomy).getByText('Core block')).toBeTruthy();
    expect(within(anatomy).getByText('Strength')).toBeTruthy();
    // every loaded reps lift names its next weight: the top of the range on all sets → + one step
    const lift = p.days[0].exercises.find((e: any) => e.next_weight != null && !e.per_hand && e.load !== 'plates'
      && !['stale', 'watch'].includes(e.audit?.status) && !e.audit?.impossible && !e.audit?.abandoned);
    expect(within(anatomy).getByText(`all ${lift.sets} sets at ${lift.range[1]} → ${lift.next_weight} kg`)).toBeTruthy();
    for (const r of p.days[0].removed) expect(within(anatomy).getByText(r.name)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Show removed lifts'));
    for (const r of p.days[0].removed) expect(within(anatomy).queryByText(r.name)).toBeNull();
  });

  it('heads the screen with the block and its cardio arc — one bar when they line up, the block\'s own when not', async () => {
    atFixtureDay(demo.index.generated_on);
    const p = demo.view('program');
    serveViews({ program: p });
    show(<Program />, store());
    const n = p.cardio.weeks.length;
    expect(await screen.findByText(new RegExp(`Block · week \\d+ of ${p.block.weeks} · cardio arc · ${n} weeks`))).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(`Block week \\d+ of ${p.block.weeks}`))).toBeTruthy();
    cleanup();
    const aligned = { ...p, block: { ...p.block, start: p.cardio.start, weeks: n, week: (p.cardio.current ?? 0) + 1 } };
    serveViews({ program: aligned });
    show(<Program />, store());
    expect(await screen.findByText(new RegExp(`Block · week \\d+ of ${n} · cardio arc$`))).toBeTruthy();
    expect(screen.queryByLabelText(/Block week/)).toBeNull();
  });

  it('opens the watch drawer, and Send to watch asks for a push plan — never a write', async () => {
    atFixtureDay(demo.index.generated_on);
    const p = demo.view('program');
    serveViews({ program: p });
    const s = store();
    show(<Program />, s);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Watch/ }))[0]);
    const drawer = screen.getByRole('dialog', { name: /Watch sync/ });
    expect(within(drawer).getByLabelText('Watch step list')).toBeTruthy();
    if (p.sync.pending) {
      fireEvent.click(within(drawer).getByRole('button', { name: 'Send to watch' }));
      expect(s.ask).toHaveBeenCalledWith('push', expect.any(String));
    }
  });

  it('Propose a change sends a plan request the server accepts', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ program: demo.view('program') });
    const s = store();
    show(<Program />, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Propose a change' }));
    expect(s.ask).toHaveBeenCalledWith('plan', expect.stringMatching(/^Propose a change/), { about: 'my program' });
  });

  it('still reads for a new athlete: no template, no cardio, no benchmarks, no constraints', async () => {
    atFixtureDay(fresh.index.generated_on);
    serveViews({ program: fresh.view('program') });
    show(<Program />, store());
    expect((await screen.findAllByText(/this week’s calendar/)).length).toBeGreaterThan(0);
    expect(screen.getByText('No cardio template yet.')).toBeTruthy();
    expect(screen.getByText('No benchmarks yet.')).toBeTruthy();
    expect(screen.getByText('No constraints recorded.')).toBeTruthy();
    expect(screen.getByRole('table', { name: /exercises in order/ })).toBeTruthy();
  });

  it('opens on the gym day a link names — Today\'s "Open D2 · Pull" (docs/DESIGN.md (app audit) U6)', async () => {
    atFixtureDay(demo.index.generated_on);
    const p = demo.view('program');
    serveViews({ program: p });
    const target = p.days[p.days.length - 1];
    show(<Program />, store(), `/program?day=${target.key}`, '/program');
    expect((await screen.findByRole('tab', { selected: true })).textContent).toContain(target.title);
  });

  it('the watch drawer takes focus when it opens and gives it back when it closes (docs/DESIGN.md (app audit) U24)', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ program: demo.view('program') });
    show(<Program />, store());
    const opener = (await screen.findAllByRole('button', { name: /^Watch/ }))[0];
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close watch drawer');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });
});
