/** Formatting and the chart language's path maths (the boards' `U` helpers, typed). */
import type { Defs } from './api';

export const nf = (v: number | null | undefined, digits = 0) =>
  v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const kg = (v: number | null | undefined) => (v == null ? '—' : `${nf(v, v % 1 ? 1 : 0)}`);

export function hm(hours: number | null | undefined): string {
  if (hours == null) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export const mmss = (s: number | null | undefined) => {
  if (s == null || !Number.isFinite(s)) return '—';
  const r = Math.round(s);   // round first: 59.6 s is 1:00, never 0:60
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
};

/** Elapsed time for an axis: 45:00, 1:30:00. */
export const elapsed = (s: number) => {
  const r = Math.round(s);
  const h = Math.floor(r / 3600);
  const m = Math.floor((r % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}` : mmss(r);
};

export const clock = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) : '—');

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const day = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
};
export const dshort = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
};
export const dow = (iso: string) => DOW[new Date(`${iso.slice(0, 10)}T12:00:00`).getDay()];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "October 2026". */
export const monthName = (iso: string) => `${MONTH[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const isoWeek = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y.getTime()) / 86400000 + 1) / 7);
};
/** A date as YYYY-MM-DD on this Mac's calendar. Never `toISOString()`, which is UTC: east of UTC (Central Europe, say) it
 * names yesterday until 02:00, and the morning's call read as "last call" (docs/DESIGN.md (app audit) U8). */
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayIso = () => isoDate(new Date());

/** Provenance: the engine's own definition and source for a metric (view `defs`), as tooltip text. */
const SRC = { garmin: 'Garmin', computed: 'Computed by OpenSportCoach', coach: 'Coach', you: 'You' } as const;
export function tip(defs: Defs | undefined, key: string, prefix?: string): string | undefined {
  const d = defs?.[key];
  if (!d) return prefix;
  return `${prefix ? `${prefix}\n` : ''}${d.definition}\nSource: ${SRC[d.source]}.`;
}

/** Recovery zone colour — the boards' thresholds (green ≥ 67, yellow 34–66, red ≤ 33). */
export const zone = (r: number | null | undefined) => (r == null ? 'var(--tx3)' : r >= 67 ? 'var(--g)' : r >= 34 ? 'var(--y)' : 'var(--r)');
export const zoneWord = (r: number | null | undefined) => (r == null ? '—' : r >= 67 ? 'Green' : r >= 34 ? 'Yellow' : 'Red');

// --- chart paths --------------------------------------------------------------------------------
export interface Scale { w: number; h: number; lo: number; hi: number }

export const scale = (vals: (number | null | undefined)[], pad = 0.08, extra: number[] = []): { lo: number; hi: number } => {
  const xs = [...vals, ...extra].filter((v): v is number => v != null && !Number.isNaN(v));
  if (!xs.length) return { lo: 0, hi: 1 };
  let lo = Math.min(...xs);
  let hi = Math.max(...xs);
  if (lo === hi) { lo -= 1; hi += 1; }
  const p = (hi - lo) * pad;
  return { lo: lo - p, hi: hi + p };
};

const y = (v: number, s: Scale) => s.h - ((v - s.lo) / (s.hi - s.lo)) * s.h;
const x = (i: number, n: number, w: number) => (n <= 1 ? w / 2 : (i * w) / (n - 1));

/** A polyline; gaps (null) break the line. */
export function line(vals: (number | null | undefined)[], s: Scale): string {
  let d = '';
  let pen = false;
  vals.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i, vals.length, s.w).toFixed(1)} ${y(v, s).toFixed(1)} `;
    pen = true;
  });
  return d.trim();
}

/** A horizontal band between two values. */
export const band = (a: number, b: number, s: Scale) => `M0 ${y(b, s).toFixed(1)} H${s.w} V${y(a, s).toFixed(1)} H0 Z`;

/** A band that moves per point (e.g. the nightly HRV range). */
export function bandSeries(lo: (number | null)[], hi: (number | null)[], s: Scale): string {
  const pts = lo.map((l, i) => [i, l, hi[i]] as const).filter(([, l, h]) => l != null && h != null) as [number, number, number][];
  if (!pts.length) return '';
  const top = pts.map(([i, , h]) => `${x(i, lo.length, s.w).toFixed(1)} ${y(h, s).toFixed(1)}`);
  const bot = pts.slice().reverse().map(([i, l]) => `${x(i, lo.length, s.w).toFixed(1)} ${y(l, s).toFixed(1)}`);
  return `M${top.join(' L')} L${bot.join(' L')} Z`;
}

export const hline = (v: number, s: Scale) => `M0 ${y(v, s).toFixed(1)} H${s.w}`;

export function area(vals: (number | null)[], s: Scale, base?: number): string {
  const l = line(vals, s);
  if (!l) return '';
  const b = y(base ?? s.lo, s).toFixed(1);
  const n = vals.length;
  const first = vals.findIndex((v) => v != null);
  const last = n - 1 - [...vals].reverse().findIndex((v) => v != null);
  return `${l} L${x(last, n, s.w).toFixed(1)} ${b} L${x(first, n, s.w).toFixed(1)} ${b} Z`;
}

export const pointX = (i: number, n: number, w: number) => x(i, n, w);
export const pointY = (v: number, s: Scale) => y(v, s);

/** `3 sessions`, `1 session` — a new athlete's counts are often 1. */
export const pl = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
