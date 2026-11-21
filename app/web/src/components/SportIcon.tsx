/**
 * A sport's icon and colour, from the engine's badge (scripts/sports.py: badge() → {sport, icon,
 * kind}). The labels are Garmin's own sport names; the page never guesses one from a group
 * (docs/DESIGN.md (app audit) R5: tennis read "Activity" on Today and "Circuit" on Workouts).
 */
import type { CSSProperties } from 'react';

export interface Badge { type?: string; sport: string; icon: string; kind: string }

/** Stroke paths on a 24-unit grid, drawn like the rest of the icon set (components/ui.tsx IC). */
const PATHS: Record<string, string> = {
  strength: 'M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11',
  run: 'M14.5 4.5a1.6 1.6 0 1 0 0.01 0M8 20.5l2.6-5 3 2.2V21M10.6 15.5l1.4-6 3.2 2.6 3.3.9M12 9.5l-3.6.8-2 3',
  bike: 'M5.5 17.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M18.5 17.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M5.5 17.5 9 10h6.5l3 7.5M9 10 8 7H6M12.2 17.5 15.5 10',
  swim: 'M2 18c2 0 2-1.4 4-1.4s2 1.4 4 1.4 2-1.4 4-1.4 2 1.4 4 1.4 2-1.4 4-1.4M5 13.5 10 9l3 3 3-2.5M17.5 6.5m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0',
  race: 'M5 21V4h11l-2 4 2 4H5',
  circuit: 'M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5l1-8z',
  racket: 'M9.5 9.5m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M13.8 13.8 20.5 20.5M5.5 7.5l8 4M7.5 4.5l4 8M19 5m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0',
  walk: 'M12.5 4.5a1.6 1.6 0 1 0 0.01 0M9.5 21l2-6.5 2.5 2.5v4M11.5 14.5l1-5.5-3 1.2-1.5 3.3M12.5 9l2.5 3h3',
  hike: 'M3 20 9.5 9l4 6.5 3-4.5L21 20H3z',
  yoga: 'M12 4.5m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M4 18.5c3 0 5-1 8-1s5 1 8 1M6.5 13.5 12 10l5.5 3.5M12 10v7.5',
  sail: 'M12 3v15M12 4.5l7 11.5h-7M11 7.5 5.5 16H11M3 19.5c3 1.8 15 1.8 18 0',
  ski: 'M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 4l2.5 2 2.5-2M9.5 20l2.5-2 2.5 2',
  other: 'M3 12h4l2.5-6 5 12 2.5-6h4',
  /** A ride on an indoor trainer or app (Zwift and the like): a bike on a stand. Our own icon — no brand marks. */
  zwift: 'M5.5 15.5m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M5.5 15.5 9 9.5h6l2.5 6M9 9.5 8 7H6M11.5 15.5 15 9.5M17.5 15.5l2.5 5.5M17.5 15.5l-2.5 5.5M13 21h9',
};

/** Each kind's colour: lifting orange, endurance blue, circuits violet, every other sport teal. */
export const KIND_COLOR: Record<string, [string, string]> = {
  strength: ['var(--o)', 'var(--ot)'], endurance: ['var(--b)', 'var(--bt)'], circuit: ['var(--v)', 'var(--vt)'], sport: ['var(--c)', 'var(--ct)'],
};
export const kindColor = (kind?: string) => (KIND_COLOR[kind ?? ''] ?? KIND_COLOR.sport)[0];

export function SportIcon({ icon, size = 14, sw = 2, style, title }: { icon?: string; size?: number; sw?: number; style?: CSSProperties; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={{ flex: 'none', ...style }}>
      <path d={PATHS[icon ?? ''] ?? PATHS.other} />
    </svg>
  );
}

/** The sport as a tag: its icon and its name, in its kind's colour. */
export function SportTag({ b, size = 12, today, style }: { b?: Partial<Badge> | null; size?: number; today?: boolean; style?: CSSProperties }) {
  const col = kindColor(b?.kind);
  return (
    <span className="l" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: col, ...style }}>
      <SportIcon icon={b?.icon} size={size} sw={2.2} />{b?.sport ?? 'Other'}{today ? ' · today' : ''}
    </span>
  );
}
