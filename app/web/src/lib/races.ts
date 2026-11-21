/**
 * Races (docs/DESIGN.md (races); boards Season, Race, Race-Card, Today-Races, Plan-Races): how the page draws
 * what scripts/races.py decides. Colours and words only — every rule (what an easy day allows, when a
 * date is due a check, the windows themselves) comes from the view and its `defs`, never from here.
 */
import type { AppRequest } from './api';
import { elapsed } from './fmt';

export interface RaceBrief {
  id: string; name: string; kind: string; kind_label: string; icon: string; priority: 'A' | 'B';
  entry: string; date: string; dow: string; start: string | null; days_to: number; weeks_to: number;
  past: boolean; countdown: boolean; target: { under: string; seconds: number } | null;
}
export interface MarkPart { file: string; draw: 'mask' | 'image' }
export interface Mark { label: string; wordmark: MarkPart | null; icon: MarkPart | null; colours: string[]; source: string; note: string; suffix?: string | null }
export interface RaceCard extends RaceBrief {
  official_name: string | null; series: string | null; start_note: string | null;
  where: { city?: string; venue?: string; country?: string } | null; format: Record<string, any> | null;
  split: { partner_only: string[]; shared: string[]; runs?: string } | null;
  windows: { before: { window: 'easy' | 'taper'; from: string; to: string; days: number } | null; race: string;
    recovery: { from: string; to: string; days: number; no_intensity_to: string } | null; text: string };
  verified: { status: 'confirmed' | 'differs' | 'unconfirmed'; checked: string | null; source_kind: 'official' | 'entry' | 'listing';
    source: string | null; listings?: string[]; found?: { date?: string | null; start?: string | null; venue?: string | null };
    note?: string; history?: { date: string; from?: string; why?: string }[]; days_since: number | null };
  check_due: { due: string; why: string } | null;
  prediction: { value_s: number; source: string; as_of: string; vs_target_s: number | null; best: { value_s: number; date: string };
    trend: { date: string; value_s: number }[] } | null;
  result: { time: string; activity_id: number | null; note?: string; seconds: number; vs_target_s: number | null;
    splits: Split[] | null; splits_from: SplitsFrom | null; vs_reference: VsReference[] | null } | null;
  benchmarks: { id: string; name: string; unit: string | null; next: string; last: { date: string; value: string | number } | null; in_window: string | null; timing?: 'after_race' | 'overdue' | null }[];
  reference: { name: string; date: string; time: string; seconds: number; target_gap_s: number | null; note?: string;
    splits: { name: string; time: string; seconds: number; discipline: string | null }[]; splits_from: SplitsFrom | null } | null;
  stations: { key: string; name: string; distance: string; load: string | null; who: 'partner' | 'shared' | 'mine' }[];
  mark: Mark | null; fallback: { icon: string; monogram: string; label: string | null };
}
/** A result's time in one discipline (scripts/races.py → splits): swim, t1, bike, t2, run for a triathlon;
 * runs, stations, roxzone for HYROX. `n` is how many legs, laps or sets it is made of. */
export interface Split { discipline: string; label: string; seconds: number; n: number }
export type SplitsFrom = 'legs' | 'laps' | 'sets';
/** One discipline (or group: T1 + T2) of a result against the race's reference; delta_s < 0 is faster. */
export interface VsReference { key: string; label: string; seconds: number; reference_s: number; delta_s: number }
export interface Phase { window: 'race' | 'taper' | 'easy' | 'recovery' | 'build' | null; race: RaceBrief | null; days_to: number | null;
  day: number | null; of: number | null; from: string | null; to: string | null; intensity: boolean | null; rule: string | null; also: Phase[] }
export interface SeasonBlock { name: string; start: string; end: string; weeks: number; emphasis?: string; current: boolean; week: number | null;
  races: { id: string; at: 'opens' | 'in' | 'ends' }[] }
export interface Season { race: RaceBrief | null; blocks: SeasonBlock[]; current: SeasonBlock | null; races: RaceBrief[]; next: RaceBrief | null }

/** A window's colour pair and its word. Taper is a hatch (the .win-taper class), never a flat tint. */
export const WIN: Record<string, { bg: string; bc: string; word: string; cls?: string }> = {
  easy: { bg: 'var(--ezt)', bc: 'var(--ez)', word: 'Easy' },
  taper: { bg: 'transparent', bc: 'var(--tp)', word: 'Taper', cls: 'win-taper' },
  recovery: { bg: 'var(--rct)', bc: 'var(--rc)', word: 'Recovery' },
  race: { bg: 'var(--tx)', bc: 'var(--tx)', word: 'Race' },
};
export const winDef = (w: string) => ({ easy: 'race_easy', taper: 'race_taper', recovery: 'race_recovery', race: 'race_day' } as Record<string, string>)[w];

/** The colour of a race's kind: what it is made of (the boards' --run, --ride, --circ). */
export const KIND_COL: Record<string, string> = { hyrox: 'var(--circ)', half_marathon: 'var(--run)', gravel: 'var(--ride)', triathlon_70_3: 'var(--tx)' };

/** A split's fill and the text on it, by discipline (board Race, the result's splits): the sport it is,
 * or the neutral surface for the time between — the transitions, the roxzone. Text on a sport fill is
 * --on, which each theme sets against its own fills. */
const SPLIT_FILL: Record<string, string> = { swim: 'var(--swim)', bike: 'var(--ride)', run: 'var(--run)', runs: 'var(--run)', stations: 'var(--circ)' };
export const splitColour = (discipline: string | null | undefined) => {
  const fill = (discipline && SPLIT_FILL[discipline]) || 'var(--s3)';
  return { fill, text: fill === 'var(--s3)' ? 'var(--tx)' : 'var(--on)' };
};
/** Where a result's splits were read from, for its tooltip. */
export const SPLITS_FROM: Record<SplitsFrom, string> = {
  legs: 'the legs of the Garmin multisport activity', laps: 'the Garmin activity’s laps', sets: 'the Garmin activity’s exercise sets',
};

export type CheckState = 'confirmed' | 'listings' | 'differs' | 'unconfirmed' | 'checking' | 'due';
const PATH = {
  ok: 'M5 12l5 5 9-10', warn: 'M12 3 2 21h20L12 3zM12 10v5M12 18v.01', q: 'M12 8v5M12 16v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  spin: 'M21 12a9 9 0 1 1-9-9', clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
};
/** Each date-check state as the Race-Card board draws it: colour, icon, word, outline. */
export const CHECK: Record<CheckState, { word: string; c: string; i: string; bg: string; bc: string; bs: 'solid' | 'dashed'; spin?: boolean }> = {
  confirmed: { word: 'Confirmed', c: 'var(--g)', i: PATH.ok, bg: 'transparent', bc: 'var(--ln)', bs: 'solid' },
  listings: { word: 'Listings only', c: 'var(--tx2)', i: PATH.ok, bg: 'transparent', bc: 'var(--ln2)', bs: 'dashed' },
  differs: { word: 'Differs', c: 'var(--r)', i: PATH.warn, bg: 'var(--rt)', bc: 'var(--r)', bs: 'solid' },
  unconfirmed: { word: 'Unconfirmed', c: 'var(--y)', i: PATH.q, bg: 'var(--yt)', bc: 'var(--y)', bs: 'dashed' },
  checking: { word: 'Checking…', c: 'var(--b)', i: PATH.spin, bg: 'var(--bt)', bc: 'var(--b)', bs: 'solid', spin: true },
  due: { word: 'Check due', c: 'var(--y)', i: PATH.clock, bg: 'transparent', bc: 'var(--y)', bs: 'dashed' },
};
const SOURCE: Record<string, string> = { official: 'organiser’s site', entry: 'your entry', listing: 'listings only' };

/** A "Check dates" request in flight — every card shows it as checking until the result lands. */
export const checkingNow = (requests: AppRequest[] | undefined) =>
  (requests ?? []).some((r) => r.kind === 'workflow' && (r.params as { name?: string } | undefined)?.name === 'races' && (r.state === 'QUEUED' || r.state === 'WORKING'));

/** The state a card shows: checking while a request runs; then what the last check recorded; a
 * confirmation that rests on listings alone is weaker, and says so; a check the rules call due, last. */
export function checkState(r: RaceCard, checking: boolean): CheckState {
  if (checking && !r.past) return 'checking';
  if (r.verified.status === 'differs') return 'differs';
  if (r.verified.status === 'unconfirmed') return 'unconfirmed';
  if (r.verified.source_kind === 'listing') return 'listings';
  if (r.check_due && !r.past) return 'due';
  return 'confirmed';
}
/** Who confirmed it, in a few words: "organiser’s site · 15 Oct". */
export const checkedBy = (r: RaceCard) => [SOURCE[r.verified.source_kind] ?? r.verified.source_kind, r.verified.checked && shortDay(r.verified.checked)].filter(Boolean).join(' · ');

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const at = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
/** "Thu 12 Nov" */
export const shortDay = (iso: string) => { const d = at(iso); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
/** "Thu 12 Nov 2026" */
export const longDay = (iso: string) => `${shortDay(iso)} ${iso.slice(0, 4)}`;
/** "12 Nov" */
export const dayMonth = (iso: string) => { const d = at(iso); return `${d.getDate()} ${MON[d.getMonth()]}`; };
export const MONTHS = MON;

/** A gap in seconds, signed: "+1:53", "−17:36". */
export const signed = (s: number) => `${s > 0 ? '+' : s < 0 ? '−' : '±'}${elapsed(Math.abs(s))}`;
/** "28 days", "1 day", "today", "3 days ago". */
export const daysWord = (n: number) => (n === 0 ? 'today' : n > 0 ? `${n} ${n === 1 ? 'day' : 'days'}` : `${-n} ${n === -1 ? 'day' : 'days'} ago`);
export const prioWord = (p: string) => (p === 'A' ? 'A · season peak' : 'B');
