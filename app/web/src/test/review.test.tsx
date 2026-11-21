/** Swim and circuit reviews on the workout page (scripts/session_review.py → the view's `review`), on the
 * committed demo fixtures: Alex's latest swim followed "Swim · Aerobic 1800" and skipped one 100; the
 * conditioning circuit followed its workout with one stray lap press. */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Workout from '../screens/Workout';
import { fixtureSet, serveViews, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const demo = fixtureSet('demo');
const sessions = demo.view('sessions').sessions;
const page = (pick: (s: any) => boolean) => demo.view('workout', String(sessions.find(pick).id));

describe('The workout page’s session review', () => {
  it('a swim shows the workout it followed, each rep beside the planned swim, and the missed rep', async () => {
    const w = page((s) => s.group === 'swim');
    expect(w.review.planned.name).toBe('Swim · Aerobic 1800');
    serveViews({ [`workout|${w.id}`]: w });
    show(<Workout />, store(), `/workouts/${w.id}`, '/workouts/:id');
    const card = await screen.findByRole('region', { name: 'Swim review' });
    expect(within(card).getByText('Swim · Aerobic 1800')).toBeTruthy();
    expect(within(card).getByText(new RegExp(`${w.review.planned.done} of ${w.review.planned.swims} planned swims`))).toBeTruthy();
    expect(within(card).getByRole('note').textContent).toMatch(/no matching lap/);
    expect(within(card).getAllByText('Steady, same time each').length).toBe(w.review.planned.done - 3);
    expect(within(card).getByText(/8 × 100 m/)).toBeTruthy();
  });

  it('a circuit shows each step the watch recorded and flags the stray lap press', async () => {
    const w = page((s) => s.kind === 'circuit');
    serveViews({ [`workout|${w.id}`]: w });
    show(<Workout />, store(), `/workouts/${w.id}`, '/workouts/:id');
    const card = await screen.findByRole('region', { name: 'Circuit review' });
    expect(within(card).getByText('Circuit · Conditioning')).toBeTruthy();
    expect(within(card).getByRole('note').textContent).toMatch(/pressed twice/);
    expect(within(card).getAllByRole('row').length).toBe(w.review.intervals.length + 1);
    expect(within(card).getByText('Stray laps')).toBeTruthy();
  });
});
