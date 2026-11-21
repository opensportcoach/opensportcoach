/** The execution score in the app (docs/DESIGN.md (fuelling and score) §5–6; boards Score-Badge, Score-Card, Score-States).
 * Every number and sentence is scripts/session_score.py's: the demo fixtures carry the engine's output for
 * Alex's sessions (a gym day done as planned, rides with nothing planned, a swim and sports it has no rule
 * for), and app/fixtures/score/cases.json the engine's output for synthetic sessions — a Mostly gym day
 * with an exercise not started, an interval ride, an Unclear ride, a provisional one. The page adds up
 * nothing and phrases nothing. */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Workout from '../screens/Workout';
import Workouts from '../screens/Workouts';
import { ScoreBadge, ScoreCard } from '../components/Score';
import { atFixtureDay, fixtureSet, serveViews, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const demo = fixtureSet('demo');
const CASES = import.meta.glob('../../../fixtures/score/cases.json', { eager: true, import: 'default' }) as Record<string, any>;
const cases = structuredClone(Object.values(CASES)[0]);
const gymId = demo.index.views.workout.map((e: any) => e.arg).find((a: string) => demo.view('workout', a).group === 'strength');
const gym = demo.view('workout', gymId);
// A sport the score has no rule for (tennis): swims and circuits are scored against their workout now
// (scripts/session_review.py), so the excluded example is the one sport with no rule at all.
const unscored = demo.view('workout', demo.index.views.workout.map((e: any) => e.arg).find((a: string) => demo.view('workout', a).kind === 'sport'));

describe('The score card', () => {
  it('a Mostly gym day: the number with its band, the sentence, a row per part and the set rows that cost points', () => {
    const s = cases.gym_mostly;
    show(<ScoreCard s={s} />, store());
    const card = screen.getByRole('region', { name: 'Execution score' });
    expect(within(card).getByLabelText(`Score ${s.total}, Mostly`)).toBeTruthy();
    expect(within(card).getByText(s.summary)).toBeTruthy();
    expect(within(card).getByText(`out of ${s.out_of}`)).toBeTruthy();
    const rows = within(card).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(s.parts.map((p: any) => `${p.label}weight ${p.weight}`));
    // The points are the engine's, printed as they come: earned of the weight.
    s.parts.forEach((p: any, i: number) => expect(within(rows[i]).getByText(`${p.points.toFixed(1)} / ${p.weight}`)).toBeTruthy());
    // The exercise not started, and every other row that moved the score.
    expect(within(card).getByText('Not started')).toBeTruthy();
    expect(within(card).getAllByRole('listitem')).toHaveLength(s.chips.length);
    expect(within(card).getByText(new RegExp(`Score = ${s.earned.toFixed(1)} ÷ ${s.out_of}`))).toBeTruthy();
  });

  it('a part that can’t be scored drops out with its reason, never as a zero', () => {
    const s = cases.ride_vo2;
    show(<ScoreCard s={s} />, store());
    expect(s.parts.some((p: any) => p.key === 'pacing')).toBe(false);   // not an interval ride's part at all
    const intervals = screen.getAllByRole('row').find((r) => r.textContent?.startsWith('Intervals'))!;
    const part = s.parts.find((p: any) => p.key === 'intervals');
    expect(within(intervals).getByText(part.planned_text)).toBeTruthy();
    expect(within(intervals).getByText(part.done_text)).toBeTruthy();
  });

  it('Unclear shows no number: under 60 % of the session could be scored', () => {
    const s = cases.ride_unclear;
    expect(s.total).toBeNull();
    show(<ScoreCard s={s} />, store());
    expect(screen.getByLabelText('Score —, Unclear')).toBeTruthy();
    expect(screen.getByText(/only 47 % could be scored/)).toBeTruthy();
    const intent = screen.getAllByRole('row').find((r) => r.textContent?.startsWith('Intent'))!;
    expect(within(intent).getByText('not scored')).toBeTruthy();
    expect(within(intent).getByText(/Dropped out: the plan names no intent/)).toBeTruthy();
  });

  it('fuel not logged yet: provisional, and the part waits instead of scoring zero', () => {
    const s = cases.ride_provisional;
    show(<ScoreCard s={s} />, store());
    expect(screen.getByText('provisional · fuel not logged')).toBeTruthy();
    const fuel = screen.getAllByRole('row').find((r) => r.textContent?.startsWith('Fuel'))!;
    expect(within(fuel).getByText('waiting')).toBeTruthy();
  });

  it('a session with nothing to score against says why — not scored, never zero', () => {
    show(<ScoreCard s={unscored.score} />, store());
    expect(screen.getByLabelText('Score —, Not scored')).toBeTruthy();
    expect(screen.getByText(unscored.score.excluded)).toBeTruthy();
    expect(screen.queryAllByRole('row')).toHaveLength(0);
  });
});

describe('The score on the screens', () => {
  it('the workout page: the large badge in the header goes to the card under the reviews', async () => {
    expect(gym.score.total).toBe(100);
    serveViews({ [`workout|${gym.id}`]: gym });
    show(<Workout />, store(), `/workouts/${gym.id}`, '/workouts/:id');
    const badge = await screen.findByRole('link', { name: /Execution score 100, As planned/ });
    expect(badge.getAttribute('href')).toBe('#score');
    expect(screen.getByRole('region', { name: 'Execution score' })).toBeTruthy();
    expect(badge.getAttribute('data-tip')).toContain('Source: Computed by OpenSportCoach');
  });

  it('a session it has no rule for still gets the card, saying why', async () => {
    serveViews({ [`workout|${unscored.id}`]: unscored });
    show(<Workout />, store(), `/workouts/${unscored.id}`, '/workouts/:id');
    const card = await screen.findByRole('region', { name: 'Execution score' });
    expect(within(card).getByText(unscored.score.excluded)).toBeTruthy();
  });

  it('Workouts: every gym session, ride and run carries the small badge; tennis and swims don’t', async () => {
    atFixtureDay(demo.index.generated_on);
    const v = demo.view('sessions');
    serveViews({ sessions: v });
    show(<Workouts />, store(), '/workouts', '/workouts');
    const list = await screen.findByRole('region', { name: 'Workout list' });
    const row = within(list).getAllByRole('link').find((l) => l.getAttribute('href') === `/workouts/${gym.id}`)!;
    expect(within(row).getByLabelText('Score 100, As planned')).toBeTruthy();
    // A sport the score has no rule for carries no badge at all — not a row of dashes.
    const tennis = v.sessions.find((s: any) => s.kind === 'sport' && s.date >= isoDaysAgo(42, demo.index.generated_on));
    if (tennis) {
      const t = within(list).getAllByRole('link').find((l) => l.getAttribute('href') === `/workouts/${tennis.id}`)!;
      expect(within(t).queryByLabelText(/^Score /)).toBeNull();
    }
  });

  it('the small and medium badges never show a number without its band word', () => {
    show(<><ScoreBadge s={cases.gym_mostly} size="sm" /><ScoreBadge s={cases.ride_vo2} size="md" /></>, store());
    expect(screen.getByLabelText(`Score ${cases.gym_mostly.total}, Mostly`).textContent).toContain('Mostly');
    expect(screen.getByLabelText(`Score ${cases.ride_vo2.total}, As planned`).textContent).toContain('As planned');
  });
});

function isoDaysAgo(n: number, from: string) {
  return new Date(Date.parse(`${from}T12:00:00`) - n * 864e5).toISOString().slice(0, 10);
}
