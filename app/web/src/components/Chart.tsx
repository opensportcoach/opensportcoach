/** The chart language (board Charts): one style for lines, bands, baselines and bars, in both themes. */
import type { ReactNode } from 'react';
import { band, bandSeries, day, dshort, hline, line, nf, type Scale } from '../lib/fmt';
import { rich } from '../lib/tip';

export interface Series { values: (number | null)[]; color: string; width?: number; dash?: string; label?: string; opacity?: number }

/** A shaded value range with its name (form zones, the HRV band's words). */
export interface Zone { from: number; to: number; color: string; label?: string }

/** Up to five evenly spaced indices for date labels: first, last, and between. */
const labelIdx = (n: number, k = 5) => (n <= k ? [...Array(n).keys()] : [...new Set(Array.from({ length: k }, (_, j) => Math.round((j * (n - 1)) / (k - 1))))]);

/**
 * A daily series chart (R12, 2026-10-11): a value axis with round ticks and gridlines, dated x
 * labels, and a hover column per day whose tip reads every labelled series that day. `mark` draws
 * the picked day; `onPick` makes the columns pick one. Bands, a baseline and shaded zones as before.
 */
export function TimeChart({ dates, series, bandLo, bandHi, bandConst, baseline, height = 180, yUnit = '', ariaLabel, marks, fmt, tip, mark, onPick, zones, yTicks = 4, xTicks = 5 }: {
  dates: string[]; series: Series[]; bandLo?: (number | null)[]; bandHi?: (number | null)[]; bandConst?: [number, number];
  baseline?: number | null; height?: number; yUnit?: string; ariaLabel: string; marks?: { i: number; color: string }[];
  fmt?: (v: number) => string; tip?: (i: number) => string; mark?: string | null; onPick?: (date: string) => void; zones?: Zone[]; yTicks?: number; xTicks?: number;
}) {
  const all = series.flatMap((s) => s.values);
  const extra = [...(bandConst ?? []), ...(baseline != null ? [baseline] : []), ...((bandLo ?? []).filter((v) => v != null) as number[]), ...((bandHi ?? []).filter((v) => v != null) as number[])];
  const finite = [...all, ...extra].filter((v): v is number => v != null && Number.isFinite(v));
  const span = finite.length ? Math.max(...finite) - Math.min(...finite) : 1;
  const f = fmt ?? ((v: number) => `${nf(v, span < 8 ? 1 : 0)}${yUnit}`);
  const ax = axisFor([...all, ...extra], f, { count: yTicks });
  const sc: Scale = { w: 600, h: height, lo: ax.lo, hi: ax.hi };
  const n = dates.length;
  const px = (i: number) => (n <= 1 ? 300 : (i * 600) / (n - 1));
  const py = (v: number) => height - ((v - sc.lo) / (sc.hi - sc.lo)) * height;
  const step = n <= 1 ? 600 : 600 / (n - 1);
  const labelled = series.filter((s) => s.label);
  const tipAt = (i: number) => tip?.(i) ?? rich({
    t: day(dates[i]),
    r: [...(labelled.length ? labelled : series.slice(0, 1)).map((s): [string, string, string] => [s.label ?? 'Value', s.values[i] == null ? '—' : f(s.values[i] as number), s.color]),
      ...(bandLo?.[i] != null && bandHi?.[i] != null ? [['Normal range', `${f(bandLo[i] as number)}–${f(bandHi[i] as number)}`, 'var(--s3)'] as [string, string, string]] : []),
      ...(bandConst ? [['Range', `${f(bandConst[0])}–${f(bandConst[1])}`, 'var(--s3)'] as [string, string, string]] : []),
      ...(baseline != null ? [['Baseline', f(baseline), 'var(--tx3)'] as [string, string, string]] : [])],
    h: onPick ? 'Click to show this day' : undefined,
  });
  const mi = mark ? dates.indexOf(mark) : -1;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr)', columnGap: 8 }}>
      <div className="m" style={{ position: 'relative', height, color: 'var(--tx3)', fontSize: 10, textAlign: 'right' }}>
        {ax.ticks.map((t) => <span key={t} style={{ position: 'absolute', right: 0, top: py(t) - 6, whiteSpace: 'nowrap' }}>{f(t)}</span>)}
      </div>
      <svg viewBox={`0 0 600 ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={ariaLabel} style={{ overflow: 'visible' }}>
        {ax.ticks.map((t) => <path key={t} d={`M0 ${py(t)} H600`} style={{ stroke: 'var(--ln)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {zones?.filter((z) => z.to > sc.lo && z.from < sc.hi).map((z, k) => <path key={k} d={band(Math.max(z.from, sc.lo), Math.min(z.to, sc.hi), sc)} style={{ fill: z.color }} />)}
        {bandConst && <path d={band(bandConst[0], bandConst[1], sc)} style={{ fill: 'var(--s3)' }} />}
        {bandLo && bandHi && <path d={bandSeries(bandLo, bandHi, sc)} style={{ fill: 'var(--s3)' }} />}
        {baseline != null && <path d={hline(baseline, sc)} style={{ stroke: 'var(--tx3)' }} strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" fill="none" />}
        {mi >= 0 && <path d={`M${px(mi)} 0 V${height}`} style={{ stroke: 'var(--tx)' }} strokeWidth="1.5" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
        {series.map((s, i) => <path key={i} d={line(s.values, sc)} fill="none" style={{ stroke: s.color }} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} opacity={s.opacity} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
        {marks?.map((m, k) => {
          const v = series[0].values[m.i];
          if (v == null) return null;
          return <circle key={k} cx={px(m.i)} cy={py(v)} r={3.5} style={{ fill: m.color }} />;
        })}
        {dates.map((d, i) => (
          <rect key={d} className={`hcol${onPick ? ' pick' : ''}`} x={Math.max(0, px(i) - step / 2)} width={Math.min(600, px(i) + step / 2) - Math.max(0, px(i) - step / 2)} y={0} height={height}
            data-tip={tipAt(i)} onClick={onPick ? () => onPick(d) : undefined} />
        ))}
      </svg>
      <span />
      <div className="m" style={{ position: 'relative', height: 14, color: 'var(--tx3)', fontSize: 10 }}>
        {labelIdx(n, xTicks).map((i) => (
          <span key={i} style={{ position: 'absolute', left: `${(px(i) / 600) * 100}%`, transform: i === 0 ? 'none' : i === n - 1 ? 'translateX(-100%)' : 'translateX(-50%)', whiteSpace: 'nowrap', color: i === mi ? 'var(--tx)' : undefined }}>{dshort(dates[i])}</span>
        ))}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: [string, string, ('line' | 'dash' | 'box')?][] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: 'var(--tx2)' }}>
      {items.map(([label, color, kind = 'line']) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {kind === 'box' ? <span style={{ width: 12, height: 10, borderRadius: 2, background: color }} />
            : <span style={{ width: 16, height: 0, borderTop: `2px ${kind === 'dash' ? 'dashed' : 'solid'} ${color}` }} />}
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * Stacked bars, one per period, drawn bottom-up — with a value axis, gridlines, and a hover tip per
 * bar listing its stacks (R12). `selected` outlines one bar; `onPick` makes bars pick.
 */
export function Bars({ labels, stacks, height = 160, ariaLabel, target, foot, fmt = (v) => nf(v, v < 10 ? 1 : 0), tips, selected, onPick, marker, xLabels, yTicks = 4, labelEvery }: {
  labels: string[]; stacks: { values: number[]; color: string; label?: string }[]; height?: number; ariaLabel: string; target?: [number, number]; foot?: ReactNode;
  fmt?: (v: number) => string; tips?: string[]; selected?: number | null; onPick?: (i: number) => void;
  /** A short mark per bar (a need, a target) drawn as a tick across it. */ marker?: { values: (number | null)[]; color: string; label: string };
  xLabels?: ReactNode[]; yTicks?: number; /** Label every k-th bar (and the last); default fits ~12. */ labelEvery?: number;
}) {
  const totals = labels.map((_, i) => stacks.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const ax = axisFor([0, ...totals, target?.[1] ?? 0, ...(marker?.values ?? [])], fmt, { zero: true, count: yTicks });
  const lo = 0;
  const hi = ax.hi;
  const py = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  const w = 600 / Math.max(1, labels.length);
  const every = labelEvery ?? Math.ceil(labels.length / 12);
  const tipAt = (i: number) => tips?.[i] ?? rich({
    t: labels[i],
    r: [...stacks.filter((s) => (s.values[i] ?? 0) > 0).map((s): [string, string, string] => [s.label ?? 'Value', fmt(s.values[i]), s.color]),
      // A total only adds something when two stacks have a value that period.
      ...(stacks.filter((s) => (s.values[i] ?? 0) > 0).length > 1 ? [['Total', fmt(totals[i])] as [string, string]] : []),
      ...(marker && marker.values[i] != null ? [[marker.label, fmt(marker.values[i] as number), marker.color] as [string, string, string]] : []),
      ...(target ? [['Target', `${fmt(target[0])}–${fmt(target[1])}`, 'var(--s3)'] as [string, string, string]] : [])],
    h: onPick ? 'Click to show it' : undefined,
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr)', columnGap: 8 }}>
        <div className="m" style={{ position: 'relative', height, color: 'var(--tx3)', fontSize: 10, textAlign: 'right' }}>
          {ax.ticks.filter((t) => t >= 0).map((t) => <span key={t} style={{ position: 'absolute', right: 0, top: py(t) - 6, whiteSpace: 'nowrap' }}>{fmt(t)}</span>)}
        </div>
        <svg viewBox={`0 0 600 ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={ariaLabel} style={{ overflow: 'visible' }}>
          {ax.ticks.filter((t) => t >= 0).map((t) => <path key={t} d={`M0 ${py(t)} H600`} style={{ stroke: 'var(--ln)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          {target && <rect x="0" width="600" y={py(target[1])} height={py(target[0]) - py(target[1])} style={{ fill: 'var(--s3)' }} />}
          {labels.map((_, i) => {
            let y = height;
            return stacks.map((s, k) => {
              const h = ((s.values[i] ?? 0) / (hi - lo)) * height;
              y -= h;
              return <rect key={`${i}-${k}`} x={i * w + w * 0.18} y={y} width={w * 0.64} height={Math.max(0, h)} rx={2} style={{ fill: s.color }} opacity={onPick && selected != null && selected !== i ? 0.55 : 1} />;
            });
          })}
          {marker?.values.map((v, i) => v == null ? null : <path key={`m${i}`} d={`M${i * w + w * 0.08} ${py(v)} H${i * w + w * 0.92}`} style={{ stroke: marker.color }} strokeWidth="2" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />)}
          {selected != null && selected >= 0 && <rect x={selected * w + w * 0.1} y={1} width={w * 0.8} height={height - 2} rx={4} fill="none" style={{ stroke: 'var(--tx)' }} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
          {labels.map((l, i) => (
            <rect key={`h${i}`} className={`hcol${onPick ? ' pick' : ''}`} x={i * w} y={0} width={w} height={height} data-tip={tipAt(i)}
              onClick={onPick ? () => onPick(i) : undefined} aria-label={onPick ? `${l}` : undefined} />
          ))}
        </svg>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr)', columnGap: 8 }}>
        <span />
        <div className="m" style={{ display: 'grid', gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))`, color: 'var(--tx3)', fontSize: 9, textAlign: 'center' }}>
          {labels.map((l, i) => <span key={i} style={{ color: selected === i ? 'var(--tx)' : undefined, overflow: 'hidden' }}>{xLabels?.[i] ?? ((labels.length - 1 - i) % every === 0 ? l : '')}</span>)}
        </div>
      </div>
      {foot}
    </div>
  );
}

/** Round tick values covering [lo, hi]: 1, 2 or 5 × a power of ten apart. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export interface Axis { lo: number; hi: number; ticks: number[]; fmt: (v: number) => string; invert?: boolean }

/** An axis for values: padded, rounded to nice ticks; `invert` puts the smallest at the top (pace). */
export function axisFor(vals: (number | null | undefined)[], fmt: (v: number) => string, opts: { invert?: boolean; zero?: boolean; count?: number } = {}): Axis {
  const xs = vals.filter((v): v is number => v != null && Number.isFinite(v));
  let lo = xs.length ? Math.min(...xs) : 0;
  let hi = xs.length ? Math.max(...xs) : 1;
  if (opts.zero) lo = Math.min(0, lo);
  if (lo === hi) { lo -= Math.max(1, Math.abs(lo) * 0.05); hi += Math.max(1, Math.abs(hi) * 0.05); }
  const pad = (hi - lo) * 0.12;
  lo = opts.zero && lo >= 0 ? 0 : lo - pad;
  hi += pad;
  const ticks = niceTicks(lo, hi, opts.count ?? 4).filter((t) => t >= lo && t <= hi);
  return { lo, hi, ticks, fmt, invert: opts.invert };
}

/** 0..1 from the bottom of the plot (or from the top when the axis is inverted). */
export const yFrac = (v: number, a: Axis) => {
  const f = (v - a.lo) / (a.hi - a.lo);
  return a.invert ? 1 - f : f;
};

/**
 * A chart over a numeric x (elapsed seconds, kilometres): gridlines from the left axis, a labelled
 * axis on each side that has a series, and x ticks. The plot is drawn in a 600-unit box; the axes
 * are HTML so their text never stretches. `children` draws extra marks (lap blocks) in the same box.
 */
export function XYChart({ x, xFmt, series, left, right, height = 180, ariaLabel, children, xTicks }: {
  x: number[]; xFmt: (v: number) => string; series: { values: (number | null)[]; color: string; axis: 'left' | 'right'; width?: number; step?: boolean }[];
  left: Axis; right?: Axis; height?: number; ariaLabel: string; children?: (px: (xv: number) => number, py: (v: number, a: Axis) => number) => ReactNode; xTicks?: number[];
}) {
  const x0 = x[0] ?? 0;
  const x1 = x[x.length - 1] ?? 1;
  const px = (xv: number) => ((xv - x0) / Math.max(1e-9, x1 - x0)) * 600;
  const py = (v: number, a: Axis) => height - yFrac(v, a) * height;
  const path = (vals: (number | null)[], a: Axis, step?: boolean) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { pen = false; return; }
      const X = px(x[i]).toFixed(1);
      const Y = py(v, a).toFixed(1);
      d += step && pen ? `H${X} V${Y} ` : `${pen ? 'L' : 'M'}${X} ${Y} `;
      pen = true;
    });
    return d.trim();
  };
  const xt = xTicks ?? niceTicks(x0, x1, 5);
  const axisCol = (a: Axis, side: 'left' | 'right') => (
    <div className="m" style={{ position: 'relative', height, color: 'var(--tx3)', fontSize: 10, textAlign: side === 'left' ? 'right' : 'left' }}>
      {a.ticks.map((t) => (
        <span key={t} style={{ position: 'absolute', [side === 'left' ? 'right' : 'left']: 0, top: py(t, a) - 6, whiteSpace: 'nowrap' }}>{a.fmt(t)}</span>
      ))}
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `40px minmax(0, 1fr)${right ? ' 40px' : ''}`, columnGap: 8 }}>
      {axisCol(left, 'left')}
      <svg viewBox={`0 0 600 ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={ariaLabel} style={{ overflow: 'visible' }}>
        {left.ticks.map((t) => <path key={t} d={`M0 ${py(t, left)} H600`} style={{ stroke: 'var(--ln)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {children?.(px, py)}
        {series.map((s, i) => (
          <path key={i} d={path(s.values, s.axis === 'right' && right ? right : left, s.step)} fill="none" style={{ stroke: s.color }}
            strokeWidth={s.width ?? 1.8} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {right && axisCol(right, 'right')}
      <span />
      <div className="m" style={{ position: 'relative', height: 14, color: 'var(--tx3)', fontSize: 10 }}>
        {xt.map((t) => <span key={t} style={{ position: 'absolute', left: `${(px(t) / 600) * 100}%`, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>{xFmt(t)}</span>)}
      </div>
    </div>
  );
}
