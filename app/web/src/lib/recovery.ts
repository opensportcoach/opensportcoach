/**
 * The recovery score's signals in words (round 3): each signal's name, what its states say (the
 * states are the engine's: export_dashboard_data.component_state) and their colours. Shared by the
 * Recovery screen and Today's ring.
 */
import { hm, nf, zoneWord } from './fmt';

/** The recovery score in words, the same on Today's ring and on Recovery (docs/DESIGN.md (app audit) U14: Today said
 * "Yellow" where Recovery said "Recovering" for the same 55). Thresholds: fmt.zone. */
export const recWord = (s: number | null | undefined) =>
  s == null ? '—' : ({ Green: 'Recovered', Yellow: 'Recovering', Red: 'Run down' } as Record<string, string>)[zoneWord(s)];

/** Each signal's name and what its states say (the states are the engine's: component_state). */
export const SIGNAL: Record<string, { name: string; words: Record<string, string>; fmt: (v: number) => string }> = {
  'HRV vs 30d': { name: 'HRV', fmt: (v) => nf(v), words: { better: 'Above your usual', usual: 'Your usual', below: 'Below your usual', well_below: 'Well below your usual' } },
  'RHR vs 30d': { name: 'Resting HR', fmt: (v) => nf(v, v % 1 ? 1 : 0), words: { better: 'Lower than usual', usual: 'Your usual', below: 'Higher than usual', well_below: 'Well above usual' } },
  'Sleep perf': { name: 'Sleep', fmt: (v) => hm(v), words: { met: 'Need met', short: 'A little short', well_short: 'Short of your need' } },
  Respiration: { name: 'Respiration', fmt: (v) => nf(v, 1), words: { usual: 'Your usual', raised: 'Slightly up', high: 'Raised — an illness sign' } },
  'Skin temp': { name: 'Skin temperature', fmt: (v) => `${v > 0 ? '+' : ''}${nf(v, 1)}`, words: { usual: 'Your usual', raised: 'Slightly warm', high: 'Raised' } },
};
export const GOOD = new Set(['better', 'usual', 'met']);
export const BAD = new Set(['well_below', 'well_short', 'high']);
export const stateCol = (st: string) => (GOOD.has(st) ? 'var(--g)' : BAD.has(st) ? 'var(--r)' : 'var(--y)');
export const stateTint = (st: string) => (GOOD.has(st) ? 'var(--gt)' : BAD.has(st) ? 'var(--rt)' : 'var(--yt)');

/** A signal's name inside a sentence: "resting HR", "HRV". */
export const inline = (name: string) => name.replace(/^(?!HRV)(.)/, (c) => c.toLowerCase());
