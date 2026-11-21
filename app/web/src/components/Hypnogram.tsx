/**
 * One night's sleep stages as the watch recorded them (Garmin's sleepLevels, through
 * app_data.hypnogram): a lane per stage — awake on top, deep at the bottom — on the night's own
 * clock, with heart rate across it. The stage code table is proven against Garmin's own totals for
 * every cached night (tests/run_tests.py), so a stage drawn here is the stage Garmin counted.
 */
import { useState } from 'react';
import { hm } from '../lib/fmt';
import { axisFor } from './Chart';
import { rich } from '../lib/tip';

export const STAGES: { key: string; label: string; color: string }[] = [
  { key: 'awake', label: 'Awake', color: 'var(--y)' },
  { key: 'rem', label: 'REM', color: 'var(--v)' },
  { key: 'light', label: 'Light', color: 'var(--b)' },
  { key: 'deep', label: 'Deep', color: 'var(--g)' },
];

const W = 600;
const LANE = 34;
const H = LANE * STAGES.length;

/** "22:54" + minutes → the clock time. */
function clockAt(start: string, min: number): string {
  const [h, m] = start.split(':').map(Number);
  const t = (h * 60 + m + Math.round(min)) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

const HR_H = 72;

/**
 * The night on its own clock: a lane per stage, and — on a strip of its own, with a bpm axis — heart
 * rate. One hover line runs through both and reads the minute: clock time, stage, heart rate (R8,
 * 2026-10-11: the heart rate used to be drawn over the stages with no axis and nothing to read).
 * Arrow keys move the line five minutes at a time.
 */
export function Hypnogram({ night }: { night: any }) {
  const [at, setAt] = useState<number | null>(null);   // minutes from falling asleep
  const len = Math.max(1, night.length_min);
  const x = (m: number) => (m / len) * W;
  const lane = (stage: string) => STAGES.findIndex((s) => s.key === stage);
  const segs: [number, number, string][] = night.segments;
  const step = segs.map(([a, b, st], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)} ${lane(st) * LANE + LANE / 2} H${x(b).toFixed(1)}`).join(' ');
  const [h0, m0] = night.start.split(':').map(Number);
  const firstTick = (60 - m0) % 60;
  const ticks: number[] = [];
  for (let t = firstTick; t <= len; t += 60) ticks.push(t);
  const hr: [number, number][] = night.hr ?? [];
  const ax = axisFor(hr.map((p) => p[1]), (v) => `${Math.round(v)}`, { count: 3 });
  const hy = (v: number) => HR_H - ((v - ax.lo) / (ax.hi - ax.lo)) * HR_H;
  const hrPath = hr.map(([m, v], i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)} ${hy(v).toFixed(1)}`).join(' ');
  const stageAt = (m: number) => segs.find(([a, b]) => m >= a && m < b)?.[2];
  const hrAt = (m: number) => (hr.length ? hr.reduce((best, p) => (Math.abs(p[0] - m) < Math.abs(best[0] - m) ? p : best))[1] : null);
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAt(Math.max(0, Math.min(len, ((e.clientX - r.left) / r.width) * len)));
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setAt((m) => Math.max(0, Math.min(len, (m ?? 0) + (e.key === 'ArrowRight' ? 5 : -5))));
    } else if (e.key === 'Escape') setAt(null);
  };
  const st = at != null ? stageAt(at) : undefined;
  const stage = st ? STAGES[lane(st)] : undefined;
  const bpm = at != null ? hrAt(at) : null;
  const cursor = at != null && <path d={`M${x(at)} 0 V${H}`} style={{ stroke: 'var(--tx)' }} strokeWidth="1.2" vectorEffect="non-scaling-stroke" pointerEvents="none" />;
  const lows = hr.length ? Math.min(...hr.map((p) => p[1])) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div role="status" aria-live="polite" style={{ minHeight: 22, display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13, color: 'var(--tx2)' }}>
        {at == null ? <span>Hover the night — or focus it and use ← → — to read any minute.</span> : (<>
          <b className="n" style={{ fontSize: 18, color: 'var(--tx)' }}>{clockAt(night.start, at)}</b>
          <span style={{ fontWeight: 700, color: stage?.color ?? 'var(--tx3)' }}>{stage?.label ?? 'no stage'}</span>
          {bpm != null && <span><b className="n" style={{ fontSize: 16, color: 'var(--r)' }}>{bpm}</b> bpm</span>}
        </>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr)', columnGap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateRows: `repeat(${STAGES.length}, ${LANE}px)` }}>
            {STAGES.map((s) => <span key={s.key} className="l" style={{ fontSize: 10, alignSelf: 'center', color: s.color }}>{s.label}</span>)}
          </div>
          {hr.length > 0 && (
            <div className="m" style={{ position: 'relative', height: HR_H, color: 'var(--tx3)', fontSize: 10, textAlign: 'right' }}>
              {ax.ticks.map((t) => <span key={t} style={{ position: 'absolute', right: 0, top: hy(t) - 6 }}>{ax.fmt(t)}</span>)}
              <span className="l" style={{ position: 'absolute', left: 0, top: -2, fontSize: 9, color: 'var(--r)' }}>bpm</span>
            </div>
          )}
        </div>
        <div tabIndex={0} role="group" aria-label={`Sleep stages and heart rate from ${night.start} to ${night.end}: ${STAGES.map((s) => `${s.label} ${hm((night.totals_min[s.key] ?? 0) / 60)}`).join(', ')}`}
          onPointerMove={pick} onPointerLeave={() => setAt(null)} onKeyDown={key} style={{ display: 'flex', flexDirection: 'column', gap: 6, cursor: 'crosshair', outlineOffset: 4, touchAction: 'pan-y' }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block' }}>
            {STAGES.map((s, i) => <rect key={s.key} x={0} y={i * LANE} width={W} height={LANE} style={{ fill: i % 2 ? 'transparent' : 'var(--s2)' }} />)}
            {ticks.map((t) => <path key={t} d={`M${x(t)} 0 V${H}`} style={{ stroke: 'var(--ln)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
            <path d={step} fill="none" style={{ stroke: 'var(--tx3)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {segs.map(([a, b, s2], i) => {
              const k = lane(s2);
              return <rect key={i} data-stage={STAGES[k].key} x={x(a)} y={k * LANE + 5} width={Math.max(0.8, x(b) - x(a))} height={LANE - 10} rx={2} style={{ fill: STAGES[k].color }} />;
            })}
            {cursor}
          </svg>
          {hr.length > 0 && (
            <svg viewBox={`0 0 ${W} ${HR_H}`} width="100%" height={HR_H} preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block' }}>
              {ax.ticks.map((t) => <path key={t} d={`M0 ${hy(t)} H${W}`} style={{ stroke: 'var(--ln)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
              {ticks.map((t) => <path key={t} d={`M${x(t)} 0 V${HR_H}`} style={{ stroke: 'var(--ln)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
              <path d={hrPath} fill="none" style={{ stroke: 'var(--r)' }} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {at != null && <path d={`M${x(at)} 0 V${HR_H}`} style={{ stroke: 'var(--tx)' }} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
            </svg>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr)', columnGap: 8 }}>
        <span />
        <div className="m" style={{ position: 'relative', height: 14, color: 'var(--tx3)', fontSize: 10 }}>
          {ticks.map((t) => <span key={t} style={{ position: 'absolute', left: `${(x(t) / W) * 100}%`, transform: 'translateX(-50%)' }}>{String((h0 + Math.round((m0 + t) / 60)) % 24).padStart(2, '0')}:00</span>)}
        </div>
      </div>
      {hr.length > 0 && (
        <span style={{ fontSize: 12, color: 'var(--tx3)' }}>
          <span style={{ display: 'inline-block', width: 14, borderTop: '2px solid var(--r)', verticalAlign: 'middle', marginRight: 6 }} />
          Heart rate asleep, bpm{lows != null ? ` · lowest ${lows}` : ''}
        </span>
      )}
    </div>
  );
}

/** A night's stages in a tile (Today, R3): four thin lanes, no axis, a tip per stage block. */
export function MiniHypnogram({ night, height = 40 }: { night: any; height?: number }) {
  const len = Math.max(1, night.length_min);
  const lane = height / STAGES.length;
  const segs: [number, number, string][] = night.segments ?? [];
  return (
    <svg viewBox={`0 0 600 ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" style={{ display: 'block', marginTop: 4 }}
      aria-label={`Last night's stages, ${night.start} to ${night.end}`}>
      {STAGES.map((st, i) => <rect key={st.key} x={0} y={i * lane} width={600} height={lane} style={{ fill: i % 2 ? 'transparent' : 'var(--s2)' }} />)}
      {segs.map(([a, b, st], i) => {
        const k = STAGES.findIndex((x) => x.key === st);
        return <rect key={i} x={(a / len) * 600} y={k * lane + 1} width={Math.max(1.5, ((b - a) / len) * 600)} height={lane - 2} rx={1.5}
          style={{ fill: STAGES[k].color }} data-tip={rich({ t: STAGES[k].label, c: STAGES[k].color, r: [['From', `${clockAt(night.start, a)}–${clockAt(night.start, b)}`], ['Length', `${Math.round(b - a)} min`]] })} />;
      })}
    </svg>
  );
}
