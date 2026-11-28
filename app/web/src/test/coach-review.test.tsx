/** His three asks of 2026-11-28: a review's table drew as "| | |" lines (Markdown.tsx, CoachReview.tsx); the
 * analysis of a ride runs by itself and sits on top (endurance.tsx Analysis); a planned ride or run draws as
 * Zwift draws a workout (WorkoutProfile.tsx). Synthetic text and steps, shaped as the real ones are. */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Markdown, parseMd } from '../components/Markdown';
import { ReviewDoc } from '../components/CoachReview';
import { WorkoutProfile } from '../components/WorkoutProfile';
import Workout from '../screens/Workout';
import { atFixtureDay, fixtureSet, serveViews, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const REVIEW = `# 2026-11-28 · Ride review · Zwift, a video route (activity 1)

**Verdict:** Z2 exactly as asked, but ended at 72′ of the 90′ planned.
**Intent:** endurance (planned, \`plan.json\` 11-28): a long Z2 ride.
**Execution:** partly. The intensity was right, the dose fell short.

Numbers from \`scripts/endurance_metrics.py 1\`:

| | |
|---|---|
| Time | 72′ (90′ planned) |
| Avg / NP · VI | 163 / 165 W · 1.01 |

| Lap | Pace | HR |
|---|---|---|
| km 1 | 5:40 | **143** |

## What it says

- **Good: almost no drift.** Decoupling 0.5 %.
- **Cadence 82, the third ride running under 90.**

## Context
- This morning: HRV 79.

## Next time
Give the indoor Z2 something to do.

## His feedback
> "maybe we can do some tempo workouts?" — 2026-11-28

## Question
- Is 82 rpm your natural indoor cadence?
`;

describe('Coach text: tables and the rest of markdown', () => {
  it('parses a table with an empty header, one with a header, a quote and a numbered list', () => {
    const b = parseMd('| | |\n|---|---|\n| Time | 72′ |\n\n| A | B |\n|:--|--:|\n| 1 | x \\| y |\n\n> quoted\n\n1. one\n2. two');
    expect(b.map((x) => x.t)).toEqual(['table', 'table', 'quote', 'ol']);
    expect(b[0]).toMatchObject({ head: ['', ''], rows: [['Time', '72′']] });
    expect(b[1]).toMatchObject({ head: ['A', 'B'], rows: [['1', 'x | y']] });
  });

  it('draws no pipes: a table is a table, its empty header left out', () => {
    const { container } = render(<Markdown text={'| | |\n|---|---|\n| Time | **72′** |'} />);
    expect(container.textContent).not.toMatch(/\||---/);
    expect(container.querySelector('thead')).toBeNull();
    expect(within(container.querySelector('td:last-child') as HTMLElement).getByText('72′').tagName).toBe('B');
  });
});

describe('A review drawn as the Coach’s analysis', () => {
  it('verdict, chips, numbers as tiles, findings with their mark, Next time, the quote and the question', () => {
    const { container } = render(<ReviewDoc markdown={REVIEW} />);
    expect(container.textContent).not.toMatch(/\|---|\| \|/);
    expect(screen.getByText('Z2 exactly as asked, but ended at 72′ of the 90′ planned.')).toBeTruthy();
    expect(screen.getByText('Endurance · planned')).toBeTruthy();
    expect(screen.getByText('Partly')).toBeTruthy();
    expect(screen.getByText('The intensity was right, the dose fell short.')).toBeTruthy();
    // the two-column numbers: tiles; the laps keep their header
    expect(screen.getByText('163 / 165 W · 1.01')).toBeTruthy();
    expect(container.querySelectorAll('table').length).toBe(1);
    expect(screen.getByRole('columnheader', { name: 'Pace' })).toBeTruthy();
    // findings: "Good" gets the check
    expect(screen.getByText('✓')).toBeTruthy();
    expect(screen.getByText('Next time')).toBeTruthy();
    expect(container.querySelector('blockquote')?.textContent).toMatch(/tempo workouts/);
    expect(screen.getByText('The coach asks')).toBeTruthy();
    expect(screen.getByText('Is 82 rpm your natural indoor cadence?')).toBeTruthy();
  });
});

const demo = fixtureSet('demo');
const ride = () => demo.view('workout', String(demo.view('sessions').sessions.find((s: any) => s.group === 'bike').id));

describe('A ride’s analysis runs by itself', () => {
  it('queued by the server after a refresh: the page says so, with no button to press', async () => {
    atFixtureDay(demo.index.generated_on);
    const w = ride();
    serveViews({ [`workout|${w.id}`]: { ...w, analysis: null } });
    show(<Workout />, store({}, { requests: [{ id: 'r4', kind: 'workflow', text: 'Analyse this ride', params: { name: 'review', activity_id: String(w.id), date: w.date, auto: true },
      state: 'QUEUED', createdAt: Date.now(), progress: [] }] }), `/workouts/${w.id}`, '/workouts/:id');
    expect(await screen.findByText(/Queued by itself when this ride came in/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Analyse this ride/ })).toBeNull();
  });

  it('kept on disk: the card shows from the workout view once the request list has moved on', async () => {
    atFixtureDay(demo.index.generated_on);
    const w = ride();
    const review = demo.result('endurance_review');
    serveViews({ [`workout|${w.id}`]: { ...w, analysis: { ...review, activity_id: w.id } } });
    show(<Workout />, store(), `/workouts/${w.id}`, '/workouts/:id');
    expect(await screen.findByText(review.verdict)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Analyse again' })).toBeTruthy();
  });
});

describe('A planned ride or run, drawn as Zwift draws a workout', () => {
  const ride = [
    { kind: 'warmup', headline: '10:00', secs: 600, end: 'timer', depth: 0, target: null, ramp: [64, 190], sub: 'Ramp 64 -> 190 W.' },
    { kind: 'interval', headline: '30:00', secs: 1800, end: 'timer', depth: 0, target: { kind: 'power', lo: 158, hi: 172 }, ramp: null },
    { kind: 'cooldown', headline: '10:00', secs: 600, end: 'timer', depth: 0, target: null, ramp: [190, 64] },
  ];
  it('a ride: each block its target watts, coloured by the zone of FTP; ramps from their notes', () => {
    render(<WorkoutProfile steps={ride} est={3000} ctx={{ group: 'bike', ftp: { value: 254, source: 'athlete.json' }, hr_zones: null }} />);
    expect(screen.getByRole('group', { name: 'Ride profile: 3 steps, 50 minutes' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'interval: 158–172 W, 30:00' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'warmup: 64 → 190 W, 10:00' })).toBeTruthy();
    expect(screen.getByText(/of FTP 254 W/)).toBeTruthy();
  });

  it('a run: every round of a repeat drawn out, a Lap step at the plan’s estimate, no-target steps said so', () => {
    const run = [
      { kind: 'interval', headline: '40:00', secs: 2400, end: 'timer', depth: 0, target: { kind: 'hr', lo: 118, hi: 150 }, ramp: null },
      { kind: 'repeat', times: 3, depth: 0 },
      { kind: 'interval', headline: '0:20', secs: 20, end: 'timer', depth: 1, target: null, ramp: null },
      { kind: 'recovery', headline: 'Lap', secs: null, end: 'lap', depth: 1, target: null, ramp: null },
    ];
    const pick = vi.fn();
    render(<WorkoutProfile steps={run} est={2700} pick={pick}
      ctx={{ group: 'run', ftp: null, hr_zones: [{ zone: 1, low: 98 }, { zone: 2, low: 120 }, { zone: 3, low: 139 }] }} />);
    expect(screen.getAllByRole('img', { name: /^interval \d of 3: No target · by feel/ }).length).toBe(3);
    // (2700 − 2400 − 3 × 20) / 3 = 80 s a walk-back: "until Lap"
    expect(screen.getAllByRole('img', { name: /^recovery \d of 3: No target · easy, until Lap/ }).length).toBe(3);
    expect(screen.getByRole('img', { name: 'interval: 118–150 bpm, 40:00' })).toBeTruthy();
    screen.getByRole('img', { name: 'interval: 118–150 bpm, 40:00' }).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(pick).toHaveBeenCalledWith(run[0]);
  });
});
