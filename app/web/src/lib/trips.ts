/**
 * Trips (docs/DESIGN.md (trips)): how the page draws what scripts/trips.py decides. Colours, icons and
 * words only — what each place covers, what a maybe means, what a travel day allows and every clash come
 * from the views (`trips`, `calendar`, `today`) and their `defs`, never from here.
 */
import type { TripAccess, TripBody, TripState } from '../../../channel/requests';
import type { Defs } from './api';
import { shortDay } from './races';

export type { TripAccess, TripBody, TripState };
export type Part = 'morning' | 'afternoon' | 'evening';

export interface TripAccessRow { key: TripAccess; label: string; state: TripState; answered: string | null }
export interface TripDay { date: string; day: number; of: number; travel: 'leave' | 'back' | 'both' | null; home: string | null }
export interface TripClash {
  date: string; source: 'plan' | 'watch' | 'benchmark'; title: string; sport: string | null; needs: TripAccess[] | null;
  missing: TripAccess[]; unsure: TripAccess[]; unknown: boolean; hard: boolean; why: string; trip: string; where: string;
  travel: TripDay['travel']; on_watch: boolean;
}
export interface TripQuestion { trip: string; where: string; from: string; to: string; access: TripAccess; label: string; question: string; ask_from: string; due: boolean }
export interface TripCard {
  id: string; where: string; from: string; to: string; days: number; days_to: number; current: boolean; past: boolean;
  access: TripAccessRow[]; there: Record<TripState, TripAccess[]>; time: 'normal' | 'limited' | null;
  leave: Part | null; back: Part | null; note: string | null; day_list: TripDay[]; clashes: TripClash[]; questions: TripQuestion[];
}
export interface TripPhase {
  away: boolean; trip: { id: string; where: string; from: string; to: string } | null; day: number | null; of: number | null;
  travel: TripDay['travel']; home: string | null; access: Record<TripAccess, TripState> | null; time: string | null; rule: string;
  next: { id: string; where: string; from: string; to: string } | null; days_to: number | null;
}
export interface TripsView {
  home: { where?: string } | null; trips: TripCard[]; today: TripPhase; next: TripCard | null; clashes: TripClash[]; questions: TripQuestion[];
  access: { key: TripAccess; label: string; covers: string }[]; states: Record<TripState, string>; time: Record<string, string>;
  parts: Part[]; ask_days: number; defs: Defs;
}
/** A day on the Plan grids (calendar.trip_days). */
export interface TripDayRow extends TripDay { trip: { id: string; where: string; there: Record<TripState, TripAccess[]>; time: string | null } }

/** Each place's icon: the sport it stands for (components/SportIcon.tsx), the trainer as Zwift's bike on a stand. */
export const ACCESS_ICON: Record<TripAccess, string> = { gym: 'strength', pool: 'swim', bike: 'bike', trainer: 'zwift', run: 'run', courts: 'racket' };

/** How each state looks: there, a maybe still to confirm, not there. */
export const STATE_LOOK: Record<TripState, { c: string; bg: string; mark: string; word: string; dashed?: boolean }> = {
  yes: { c: 'var(--g)', bg: 'var(--gt)', mark: '✓', word: 'Yes' },
  maybe: { c: 'var(--y)', bg: 'var(--yt)', mark: '?', word: 'Maybe', dashed: true },
  no: { c: 'var(--tx3)', bg: 'transparent', mark: '✕', word: 'No' },
};

/** A suitcase: the trip's own mark on the calendar. Our own icon. */
export const TRIP_ICON = 'M4 8h16v12H4zM9 8V5h6v3M4 13h16M9 13v2M15 13v2';

export const TRAVEL_WORD: Record<string, string> = { leave: 'you leave', back: 'you’re back', both: 'out and back' };

/** "Fri 4 – Mon 7 Dec" / "Fri 25 Dec – Sat 2 Jan". */
export const tripSpan = (t: { from: string; to: string }) => {
  const a = shortDay(t.from);
  const b = shortDay(t.to);
  return t.from === t.to ? a : a.slice(-3) === b.slice(-3) ? `${a.slice(0, -4)} – ${b}` : `${a} – ${b}`;
};

/** "gym and bike" — the labels of a list of places, as a sentence. */
export const placeWords = (keys: TripAccess[], labels: Record<string, string>) => {
  const w = keys.map((k) => (labels[k] ?? k).toLowerCase());
  return w.length < 3 ? w.join(' and ') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
};

/** A trip with no place answered yet: the form's starting point — nothing assumed to be there. */
export const blankTrip = (keys: TripAccess[]): TripBody => ({
  where: '', from: '', to: '', access: Object.fromEntries(keys.map((k) => [k, 'no'])) as Record<TripAccess, TripState>,
  time: null, leave: null, back: null, note: null,
});

/** The request that asks the coach to replan around a trip: a plan, about that trip. */
export const replanText = (t: { where: string; from: string; to: string }) => `Replan around my ${t.where} trip (${tripSpan(t)})`;
