/**
 * A coach's plan proposal, read for review (boards Plan-Proposal, Plan): what each session becomes and
 * why, the counts, and where the proposal stands — read from the request book, which outlives a reload.
 *
 * Proposals written before 2026-10-16 carry only `changed: boolean` per day; they read as changed /
 * unchanged with their notes as the reason, so an older proposal still renders (and says less).
 */
import type { PlanProposal } from '../contracts';
import type { AppRequest } from './api';
import { dow, dshort } from './fmt';

export type Change = 'changed' | 'moved' | 'added' | 'removed' | 'unchanged';
export type Sport = NonNullable<PlanProposal['days'][number]['sport']>;
export type ProposalDay = PlanProposal['days'][number] & { idx: number; change: Change; reason: string };

/** Each kind of change: its glyph, word, tint, colour, border style. */
export const CH: Record<Change, { i: string; word: string; bg: string; c: string; bs: 'solid' | 'dashed'; bc: string }> = {
  changed: { i: 'Δ', word: 'Changed', bg: 'var(--ot)', c: 'var(--o)', bs: 'solid', bc: 'var(--o)' },
  moved: { i: '→', word: 'Moved', bg: 'var(--bt)', c: 'var(--b)', bs: 'solid', bc: 'var(--b)' },
  added: { i: '+', word: 'Added', bg: 'var(--gt)', c: 'var(--g)', bs: 'solid', bc: 'var(--g)' },
  removed: { i: '−', word: 'Removed', bg: 'var(--rt)', c: 'var(--r)', bs: 'solid', bc: 'var(--r)' },
  unchanged: { i: '=', word: 'Unchanged', bg: 'transparent', c: 'var(--tx3)', bs: 'dashed', bc: 'var(--ln2)' },
};
export const CHANGE_ORDER: Change[] = ['changed', 'moved', 'added', 'removed', 'unchanged'];

/** A sport as the app draws it: the kind's colour (lifting orange, endurance blue…), its icon, its word. */
export const SPORT: Record<Sport, { word: string; icon: string; kind: string }> = {
  strength: { word: 'Strength', icon: 'strength', kind: 'strength' },
  run: { word: 'Run', icon: 'run', kind: 'endurance' },
  bike: { word: 'Ride', icon: 'bike', kind: 'endurance' },
  zwift: { word: 'Zwift', icon: 'zwift', kind: 'endurance' },
  swim: { word: 'Swim', icon: 'swim', kind: 'endurance' },
  circuit: { word: 'Circuit', icon: 'circuit', kind: 'circuit' },
  tennis: { word: 'Tennis', icon: 'racket', kind: 'sport' },
  other: { word: 'Other', icon: 'other', kind: 'sport' },
};
export const sportOf = (d: { sport?: Sport | null; type: string }): Sport => d.sport ?? (d.type === 'session' ? 'strength' : 'other');

export const EVIDENCE: Record<string, { word: string; c: string }> = {
  garmin: { word: 'GARMIN', c: 'var(--b)' }, computed: { word: 'COMPUTED', c: 'var(--tx3)' },
  coach: { word: 'COACH', c: 'var(--v)' }, you: { word: 'YOU', c: 'var(--id)' },
};

export function days(p: PlanProposal): ProposalDay[] {
  return p.days.map((d, idx) => ({
    ...d, idx,
    change: (d.change ?? (d.changed ? 'changed' : 'unchanged')) as Change,
    reason: d.reason ?? d.notes ?? '',
  }));
}

/** "Sat 17" — a day of the proposal's week, as the board writes it. */
export const wd = (d: string) => `${dow(d)} ${Number(d.slice(8, 10))}`;

export const counts = (ds: ProposalDay[]) => Object.fromEntries(CHANGE_ORDER.map((k) => [k, ds.filter((d) => d.change === k).length])) as Record<Change, number>;
/** What the week holds once accepted: every session that isn't rest and isn't removed. */
export const sessionCount = (ds: ProposalDay[]) => ds.filter((d) => d.type !== 'rest' && d.change !== 'removed').length;
export const span = (ds: ProposalDay[]) => {
  const dates = ds.map((d) => d.date).sort();
  return { first: dates[0], last: dates[dates.length - 1] };
};
export const spanText = (ds: ProposalDay[]) => { const s = span(ds); return s.first === s.last ? `${wd(s.first)} ${dshort(s.first).split(' ')[1]}` : `${wd(s.first)} → ${wd(s.last)} ${dshort(s.last).split(' ')[1]}`; };

/** The short form of the diff, for a day cell: "from Thu 15" for a move, "a → b" otherwise. */
export const shortDiff = (d: ProposalDay) =>
  d.change === 'moved' ? (d.from ? `from ${d.from}` : '') : d.change === 'removed' || d.change === 'unchanged' ? '' : d.from && d.to ? `${d.from} → ${d.to.split(' · ')[0]}` : d.to ?? '';

export type Stage = 'waiting' | 'requested' | 'applying' | 'accepted' | 'stale' | 'superseded';

export interface Standing {
  stage: Stage;
  /** The accept request, when there is one. */
  accept?: AppRequest;
  /** The request asking for a new version of this one, while the coach works on it. */
  revision?: AppRequest;
  /** The newer proposal that replaced this one. */
  newer?: AppRequest;
}

const isProposal = (r: AppRequest) => r.state === 'DONE' && r.result?.kind === 'plan_proposal';
export const proposalOf = (r?: AppRequest | null) => (r && r.result?.kind === 'plan_proposal' ? r.result.payload : null);

/** The newest proposal in the book, or the newest with this id. */
export function findProposal(requests: AppRequest[] | undefined, id?: string): AppRequest | undefined {
  return [...(requests ?? [])].reverse().find((r) => isProposal(r) && (!id || proposalOf(r)!.id === id));
}

/**
 * Where a proposal stands. Accepted is read from the accept request (never the page's own memory —
 * 2026-10-16); out of date when the data has moved on a day since it was written (a new night, a new
 * session: same-day refreshes don't count); never a partial accept — a revert is a new request.
 */
export function standing(r: AppRequest, requests: AppRequest[] | undefined, dataAsOf?: string | null): Standing {
  const all = requests ?? [];
  const p = proposalOf(r)!;
  const accept = [...all].reverse().find((x) => x.kind === 'accept' && (x.params as { proposal?: string } | undefined)?.proposal === p.id && x.state !== 'FAILED');
  if (accept) return { stage: accept.state === 'DONE' ? 'accepted' : 'applying', accept };
  const after = all.filter((x) => x.createdAt > r.createdAt && x.id !== r.id);
  const newer = [...after].reverse().find(isProposal);
  if (newer) return { stage: 'superseded', newer };
  const revision = after.find((x) => x.kind === 'plan' && (x.params as { proposal?: string } | undefined)?.proposal === p.id && (x.state === 'QUEUED' || x.state === 'WORKING'));
  if (revision) return { stage: 'requested', revision };
  if (p.based_on_data_as_of && dataAsOf && dataAsOf.slice(0, 10) > p.based_on_data_as_of.slice(0, 10)) return { stage: 'stale' };
  return { stage: 'waiting' };
}

export const STAGE: Record<Stage, { word: string; c: string; bg: string; icon: 'clock' | 'check' | 'spinner' | 'warn' | 'minus' }> = {
  waiting: { word: 'Waiting for you', c: 'var(--v)', bg: 'var(--vt)', icon: 'clock' },
  requested: { word: 'Changes requested · coach working', c: 'var(--b)', bg: 'var(--bt)', icon: 'spinner' },
  applying: { word: 'Accepted · the coach is applying it', c: 'var(--g)', bg: 'var(--gt)', icon: 'spinner' },
  accepted: { word: 'Accepted', c: 'var(--g)', bg: 'var(--gt)', icon: 'check' },
  stale: { word: 'Out of date', c: 'var(--y)', bg: 'var(--yt)', icon: 'warn' },
  superseded: { word: 'Replaced by a newer proposal', c: 'var(--tx3)', bg: 'var(--s2)', icon: 'minus' },
};

/** How a reverted change reads in the request: what the athlete wants kept. */
export const revertPhrase = (d: ProposalDay) =>
  d.change === 'removed' ? `keep ${d.title} (${wd(d.date)})`
  : d.change === 'added' ? `don’t add ${d.title} (${wd(d.date)})`
  : d.change === 'moved' ? `leave ${d.title} where it was${d.from ? ` (${d.from})` : ''}`
  : `keep ${d.title} as it is now${d.from ? ` (${d.from})` : ''}`;

/** The sentence a revision request carries: what was reverted, then the athlete's own words. The coach
 * re-checks the whole week — a revert is never a partial accept. */
export function revisionText(p: PlanProposal, phrases: string[], note: string): string {
  const head = `Change the proposal${p.version ? ` (${p.version.n} of ${p.version.of})` : ''}`;
  return [phrases.length ? `${head}: ${phrases.join('; ')}.` : `${head}.`, note.trim()].filter(Boolean).join(' ');
}
