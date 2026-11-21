/** Every planned Zwift ride names a workout from Zwift's library (his rule, 2026-11-05): the session panel
 * shows it with its page, a day cell names it, and a proposal's Zwift day carries it. On the committed
 * demo fixtures, whose workouts were read off whatsonzwift.com by scripts/zwift_workouts.py. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZwiftWorkoutCard, ZwiftWorkoutLine, ZwiftWorkoutMissing } from '../components/ZwiftWorkout';
import ProposalReview from '../screens/ProposalReview';
import type { AppRequest } from '../lib/api';
import { atFixtureDay, fixtureSet, serveViews, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const demo = fixtureSet('demo');
const planned = demo.view('calendar').planned.find((x: any) => x.platform === 'zwift');

describe('A planned Zwift ride names its workout', () => {
  it('the panel card: the name, where it sits in Zwift, its minutes, how to ride it, and its page', () => {
    const w = planned.zwift_workout;
    render(<ZwiftWorkoutCard w={w} />);
    expect(screen.getByRole('group', { name: `Zwift workout: ${w.name}` })).toBeTruthy();
    expect(screen.getByText(w.name)).toBeTruthy();
    expect(screen.getByText(w.collection)).toBeTruthy();
    expect(screen.getByText(/38 min · 47 stress points/)).toBeTruthy();
    expect(screen.getByText(w.adjust)).toBeTruthy();
    const link = screen.getByRole('link', { name: /What’s on Zwift/ });
    expect(link.getAttribute('href')).toBe(w.url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('a day cell names it without a nested link', () => {
    render(<ZwiftWorkoutLine w={planned.zwift_workout} />);
    expect(screen.getByText(planned.zwift_workout.name)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a ride with none says so', () => {
    render(<ZwiftWorkoutMissing />);
    expect(screen.getByRole('note').textContent).toMatch(/No Zwift workout named yet/);
  });

  it("a proposal's Zwift day shows its workout and links its steps", async () => {
    const plan = demo.result('plan_proposal');
    const day = plan.days.find((d: any) => d.sport === 'zwift');
    expect(day.zwift_workout.name).toBe('Cadence Kicks XL');
    atFixtureDay(demo.index.generated_on);
    serveViews({ today: demo.view('today'), calendar: demo.view('calendar') });
    const req: AppRequest = { id: 'r2', kind: 'workflow', text: 'Plan my week', state: 'DONE', createdAt: 10, ackedAt: 11, finishedAt: 140_000, progress: [],
      result: { kind: 'plan_proposal', payload: plan } } as AppRequest;
    show(<ProposalReview />, store({}, { requests: [req] }), `/plan/proposal/${plan.id}`, '/plan/proposal/:id');
    expect((await screen.findAllByText('Cadence Kicks XL')).length).toBeGreaterThanOrEqual(2);   // its change row and its day cell
    expect(screen.getByRole('link', { name: 'its steps ↗' }).getAttribute('href')).toBe(day.zwift_workout.url);
  });
});
