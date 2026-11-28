/** Small shared pieces: icons (the boards' paths), rings, sparklines, skeletons, empty and error states. */
import type { CSSProperties, ReactNode } from 'react';
import { band, hline, line, pointX, pointY, scale, type Scale } from '../lib/fmt';

export const IC = {
  check: 'M5 12l5 5 9-10', up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M6 13l6 6 6-6', warn: 'M12 3 2 21h20L12 3zM12 10v5',
  clock: 'M12 7v5l3 2', minus: 'M5 12h14', moon: 'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z', arrow: 'M5 12h14M13 6l6 6-6 6',
  watch: 'M7 7h10v10H7zM9 7l1-4h4l1 4M9 17l1 4h4l1-4', chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  x: 'M6 6l12 12M18 6 6 18', flag: 'M5 21V4h11l-2 4 2 4H5', clip: 'M21 12l-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8',
  cut: 'M8.1 8.1 20 20M8.1 15.9 20 4', spinner: 'M21 12a9 9 0 1 1-9-9', offline: 'M5.6 5.6l12.8 12.8',
  heart: 'M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6C19 16.5 12 21 12 21z',
};

export function Icon({ d, size = 14, sw = 2.4, style, className }: { d: string; size?: number; sw?: number; style?: CSSProperties; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', ...style }}>
      <path d={d} />
    </svg>
  );
}

export function Ring({ value, max = 100, size = 148, color, children }: { value: number | null; max?: number; size?: number; color: string; children?: ReactNode }) {
  const C = 2 * Math.PI * 52;
  const p = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="none" style={{ stroke: 'var(--ln)' }} strokeWidth="9" />
        {value != null && (
          <circle className="ring" cx="60" cy="60" r="52" fill="none" style={{ stroke: color }} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={`${(C * p).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 60 60)" />
        )}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{children}</div>
    </div>
  );
}

/** The KPI tile sparkline: a line, an optional band and baseline, and a dot on the last point.
 * With `avg`, the daily values draw faint and the average bold (R2); `zones` shade value ranges. */
export function Spark({ values, color = 'var(--tx)', bandLo, bandHi, base, h = 34, avg, zones }: {
  values: (number | null)[]; color?: string; bandLo?: number | null; bandHi?: number | null; base?: number | null; h?: number;
  avg?: (number | null)[]; zones?: { from: number; to: number; color: string }[];
}) {
  const extra = [bandLo, bandHi, base].filter((v): v is number => v != null);
  const s: Scale = { w: 100, h, ...scale([...values, ...(avg ?? [])], 0.1, extra) };
  const main = avg ?? values;
  const lastI = main.length - 1 - [...main].reverse().findIndex((v) => v != null);
  const last = main[lastI];
  return (
    <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" width="100%" height={h} aria-hidden="true" style={{ display: 'block', marginTop: 4 }}>
      {zones?.filter((z) => z.to > s.lo && z.from < s.hi).map((z, k) => <path key={k} d={band(Math.max(z.from, s.lo), Math.min(z.to, s.hi), s)} style={{ fill: z.color }} />)}
      {bandLo != null && bandHi != null && <path d={band(bandLo, bandHi, s)} style={{ fill: 'var(--s3)' }} />}
      {base != null && <path d={hline(base, s)} fill="none" style={{ stroke: 'var(--tx3)' }} strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
      <path d={line(values, s)} fill="none" style={{ stroke: color }} strokeWidth={avg ? 1.1 : 1.6} opacity={avg ? 0.4 : 1} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {avg && <path d={line(avg, s)} fill="none" style={{ stroke: color }} strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      {last != null && <circle cx={pointX(lastI, main.length, 100)} cy={pointY(last, s)} r="1.6" style={{ fill: color }} />}
    </svg>
  );
}

export function Skeleton({ h = 120, style }: { h?: number; style?: CSSProperties }) {
  return <div className="skel" style={{ height: h, ...style }} aria-busy="true" aria-label="Loading" />;
}

export function ErrorBox({ error }: { error: string }) {
  return (
    <div role="alert" className="card" style={{ borderColor: 'var(--r)', background: 'var(--rt)', flexDirection: 'row', alignItems: 'center' }}>
      <Icon d={IC.warn} style={{ color: 'var(--r)' }} />
      <span style={{ fontSize: 14 }}>{error}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ padding: '18px 16px', borderRadius: 12, border: '1px dashed var(--ln2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
      {children && <span style={{ fontSize: 13, color: 'var(--tx2)', lineHeight: 1.45 }}>{children}</span>}
    </div>
  );
}

export function SectionHead({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <h2 className="l" style={{ color: 'var(--tx)' }}>{title}</h2>
      {right}
    </div>
  );
}

export function PageTitle({ eyebrow, title, right }: { eyebrow?: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {eyebrow && <span className="l">{eyebrow}</span>}
        <h1 className="n" style={{ fontSize: 44, lineHeight: 1, fontWeight: 700 }}>{title}</h1>
      </div>
      {right}
    </div>
  );
}
