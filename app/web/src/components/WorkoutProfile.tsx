/**
 * A ride or a run on the watch, drawn as Zwift draws a workout (his ask, 2026-11-28: "the plot Zwift usually
 * puts, the one with power" — for the runs too). One block per step, in order: as wide as the step lasts, as
 * tall as its target, coloured by its zone. Repeats are drawn out, every round.
 *
 * Every height is the workout file's own number (scripts/app_data.py _watch_steps): a power range's middle
 * on a ride, against the FTP the ride metrics use; a heart-rate range's middle, against the zones Garmin used
 * on the latest session of the same sport. A ramp is the watts its note states ("Ramp 64 -> 190 W"). A step
 * with no target has no height to draw, so it draws as what it is — grey and low for an easy step, hatched for
 * work done by feel — and says so; a step that ends on Lap has no length, so its width is the plan's estimate
 * shared out, marked ≈. Nothing here is computed beyond placing those numbers.
 */
import { useId, useMemo, useState } from 'react';
import { elapsed, mmss } from '../lib/fmt';
import { rich } from '../lib/tip';

export interface ProfileCtx { group: 'bike' | 'run'; ftp?: { value: number; source: string } | null; hr_zones?: { zone: number; low: number }[] | null }

// Zwift's power zones (share of FTP) and its colours, in the app's palette.
const PZ: [number, string, string][] = [[0, 'Z1', 'var(--tx3)'], [0.6, 'Z2', 'var(--b)'], [0.76, 'Z3', 'var(--g)'], [0.9, 'Z4', 'var(--y)'], [1.05, 'Z5', 'var(--o)'], [1.19, 'Z6', 'var(--r)']];
// Heart-rate zones as the ride and run pages colour them (screens/endurance.tsx ZONE_COL).
const HZ = ['var(--tx3)', 'var(--b)', 'var(--g)', 'var(--o)', 'var(--r)'];
const EASY = new Set(['warmup', 'cooldown', 'recovery', 'rest']);
const W = 600, H = 150;

interface Seg {
  step: any; t0: number; secs: number; est: boolean; round: [number, number] | null;
  from: number; to: number;          // the drawn level at the start and the end (equal but for a ramp)
  look: 'target' | 'ramp' | 'easy' | 'feel';
}

/** The watch's flat step list (repeat headers with `times`, children one level deeper) drawn out in order. */
function drawOut(steps: any[]): { step: any; round: [number, number] | null }[] {
  const out: { step: any; round: [number, number] | null }[] = [];
  const walk = (from: number, depth: number, round: [number, number] | null): number => {
    let i = from;
    while (i < steps.length && steps[i].depth >= depth) {
      const s = steps[i];
      if (s.kind === 'repeat') {
        let end = i + 1;
        for (let k = 0; k < (s.times || 1); k++) end = walk(i + 1, s.depth + 1, [k + 1, s.times || 1]);
        i = end;
      } else {
        out.push({ step: s, round });
        i++;
      }
    }
    return i;
  };
  walk(0, 0, null);
  return out;
}

const mid = (t: { lo: number; hi: number }) => (t.lo + t.hi) / 2;

export function WorkoutProfile({ steps, est, ctx, sel, pick }: {
  steps: any[]; est?: number | null; ctx: ProfileCtx; sel?: any; pick?: (step: any) => void;
}) {
  const pid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const ftp = ctx.group === 'bike' ? ctx.ftp?.value ?? null : null;
  const zones = ctx.hr_zones ?? null;

  const model = useMemo(() => {
    const flat = drawOut(steps);
    const power = flat.some((x) => x.step.target?.kind === 'power' || (ctx.group === 'bike' && x.step.ramp));
    const mode: 'power' | 'hr' | 'none' = power ? 'power' : flat.some((x) => x.step.target?.kind === 'hr') ? 'hr' : 'none';
    // A Lap step's length: the plan's estimate left over after the timed steps, shared out (≈).
    const timed = flat.reduce((a, x) => a + (x.step.secs ?? 0), 0);
    const laps = flat.filter((x) => !x.step.secs).length;
    const lapS = laps ? Math.max(30, est && est > timed ? (est - timed) / laps : Math.max(60, timed * 0.05)) : 0;
    const vals = flat.flatMap((x) => {
      const t = x.step.target;
      if (mode === 'power') return [...(t?.kind === 'power' ? [t.hi] : []), ...(x.step.ramp ?? [])];
      if (mode === 'hr') return t?.kind === 'hr' ? [t.lo, t.hi] : [];
      return [];
    });
    let lo = 0, hi = 1;
    if (mode === 'power') hi = Math.max(...vals, ftp ? ftp * 1.2 : 0) * 1.08;
    if (mode === 'hr') {
      const zl = (zones ?? []).map((z) => z.low);
      lo = Math.max(40, Math.min(...vals, ...(zl.length ? [zl[0]] : [])) - 12);
      hi = Math.max(...vals, ...(zl.length ? [zl[zl.length - 1]] : [])) + 8;
    }
    // A step with no target: low and grey when easy by its kind, hatched and higher when it is work by feel.
    const easyLvl = lo + (hi - lo) * 0.22, feelLvl = lo + (hi - lo) * 0.6;
    let t0 = 0;
    const segs: Seg[] = flat.map(({ step, round }) => {
      const secs = step.secs ?? lapS;
      const t = step.target;
      const own = (mode === 'power' && t?.kind === 'power') || (mode === 'hr' && t?.kind === 'hr');
      const ramp = mode === 'power' && step.ramp && !own ? step.ramp as [number, number] : null;
      const level = own ? mid(t) : EASY.has(step.kind) ? easyLvl : feelLvl;
      const seg: Seg = { step, t0, secs, est: !step.secs, round, from: ramp ? ramp[0] : level, to: ramp ? ramp[1] : level,
        look: own ? 'target' : ramp ? 'ramp' : EASY.has(step.kind) ? 'easy' : 'feel' };
      t0 += secs;
      return seg;
    });
    return { segs, total: t0, mode, lo, hi, anyEst: laps > 0 };
  }, [steps, est, ctx.group, ftp, zones]);

  const { segs, total, mode, lo, hi } = model;
  if (!segs.length || total <= 0) return null;
  const x = (t: number) => (t / total) * W;
  const y = (v: number) => H - ((v - lo) / Math.max(1e-9, hi - lo)) * H;
  const colour = (v: number) => {
    if (mode === 'power') return ftp ? [...PZ].reverse().find(([p]) => v / ftp >= p)![2] : 'var(--b)';
    if (mode === 'hr' && zones?.length) return HZ[Math.max(0, zones.reduce((z, r, i) => (v >= r.low ? i : z), 0))] ?? 'var(--b)';
    return 'var(--b)';
  };
  const zoneName = (v: number) => {
    if (mode === 'power' && ftp) return `${[...PZ].reverse().find(([p]) => v / ftp >= p)![1]} · ${Math.round((100 * v) / ftp)} % of FTP`;
    if (mode === 'hr' && zones?.length) return `Z${zones.reduce((z, r) => (v >= r.low ? r.zone : z), zones[0].zone)}`;
    return null;
  };
  const unit = mode === 'power' ? 'W' : 'bpm';
  const what = (s: Seg) => {
    const t = s.step.target;
    if (s.look === 'target') return `${t.lo}–${t.hi} ${unit}`;
    if (s.look === 'ramp') return `${s.from} → ${s.to} W`;
    if (t?.kind === 'hr') return `HR ${t.lo}–${t.hi} bpm`;
    return s.look === 'easy' ? 'No target · easy' : 'No target · by feel';
  };
  const tipOf = (s: Seg, i: number) => rich({
    t: `${s.step.kind === 'interval' ? 'Work' : s.step.kind[0].toUpperCase() + s.step.kind.slice(1)}${s.round ? ` · ${s.round[0]} of ${s.round[1]}` : ''}`,
    c: s.look === 'target' || s.look === 'ramp' ? colour((s.from + s.to) / 2) : 'var(--tx3)',
    r: [['Target', what(s)], ...(s.look === 'target' && zoneName(mid(s.step.target)) ? [['Zone', zoneName(mid(s.step.target))!] as [string, string]] : []),
      ['Length', s.est ? `until Lap · ≈ ${mmss(s.secs)}` : mmss(s.secs)], ['Starts at', `${s.est || segs.slice(0, i).some((q) => q.est) ? '≈ ' : ''}${elapsed(s.t0)}`]],
    n: s.step.sub ? [s.step.sub] : undefined, s: 'the workout file on the watch',
  });
  const on = (s: Seg) => s.step === sel;
  const shown = hover != null ? segs[hover] : segs.find(on) ?? null;
  // Ticks: every 5, 10, 15 or 30 minutes, whichever gives four to seven.
  const stepMin = [5, 10, 15, 30, 60].find((m) => total / (m * 60) <= 7) ?? 60;
  const ticks = Array.from({ length: Math.floor(total / (stepMin * 60)) + 1 }, (_, i) => i * stepMin * 60);
  const yTicks: [number, string][] = mode === 'power'
    ? (ftp ? [0.5, 0.75, 1].map((p): [number, string] => [ftp * p, `${Math.round(ftp * p)}`]) : [])
    : mode === 'hr' ? (zones ?? []).filter((z) => z.low > lo && z.low < hi).map((z): [number, string] => [z.low, `Z${z.zone} ${z.low}`]) : [];
  const label = `${ctx.group === 'bike' ? 'Ride' : 'Run'} profile: ${segs.length} steps, ${model.anyEst ? 'about ' : ''}${Math.round(total / 60)} minutes`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 14px' }}>
        <h3 className="l" style={{ color: 'var(--tx)' }}>The workout</h3>
        <span style={{ fontSize: 12, color: 'var(--tx3)' }}>
          {mode === 'power' ? (ftp ? `height = target watts · colour = Zwift’s power zone, of FTP ${ftp} W` : 'height = target watts · no FTP yet for the zones')
            : mode === 'hr' ? `height = target heart rate · colour = your ${ctx.group === 'bike' ? 'ride' : 'run'} heart-rate zone` : 'no step has a target — each drawn by its kind'}
        </span>
      </div>
      <div className="m" aria-live="off" style={{ minHeight: 18, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12, color: 'var(--tx2)' }}>
        {shown ? (
          <>
            <b style={{ color: 'var(--tx)' }}>{shown.est ? `until Lap · ≈ ${mmss(shown.secs)}` : mmss(shown.secs)}{shown.round ? ` · ${shown.round[0]} of ${shown.round[1]}` : ''}</b>
            <span style={{ color: shown.look === 'target' || shown.look === 'ramp' ? colour((shown.from + shown.to) / 2) : 'var(--tx2)' }}>{what(shown)}</span>
            {shown.look === 'target' && zoneName(mid(shown.step.target)) && <span>{zoneName(mid(shown.step.target))}</span>}
            {shown.step.sub && <span style={{ color: 'var(--tx3)', fontFamily: 'Barlow, sans-serif', fontSize: 13 }}>{shown.step.sub}</span>}
          </>
        ) : <span style={{ color: 'var(--tx3)' }}>{model.anyEst ? '≈ ' : ''}{elapsed(total)} · {segs.length} steps · hover or tap a block to read it</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: yTicks.length ? '44px minmax(0, 1fr)' : 'minmax(0, 1fr)', columnGap: 8, rowGap: 4 }}>
        {yTicks.length > 0 && (
          <div aria-hidden="true" style={{ position: 'relative', height: H }}>
            {yTicks.map(([v, l]) => <span key={l} className="m" style={{ position: 'absolute', right: 0, top: y(v) - 6, fontSize: 9, color: 'var(--tx3)', whiteSpace: 'nowrap' }}>{l}</span>)}
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="group" aria-label={label}
          onPointerLeave={() => setHover(null)} style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <pattern id={`feel${pid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" style={{ fill: 'var(--s3)' }} /><path d="M0 0V6" style={{ stroke: 'var(--tx2)' }} strokeWidth="3" />
            </pattern>
          </defs>
          {yTicks.map(([v, l]) => <path key={l} d={`M0 ${y(v)} H${W}`} style={{ stroke: 'var(--ln)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          {segs.map((s, i) => {
            const x0 = x(s.t0), x1 = x(s.t0 + s.secs);
            const gap = Math.min(0.6, (x1 - x0) * 0.15);
            const lit = hover === i || on(s);
            const dim = hover != null && hover !== i;   // the picked step is outlined; only a hover dims the rest
            const parts = s.look === 'ramp'
              // A ramp in slices, each in its own zone, as Zwift colours one.
              ? Array.from({ length: Math.max(4, Math.min(24, Math.round(s.secs / 30))) }, (_, k) => k).map((k, _, a) => {
                const f0 = k / a.length, f1 = (k + 1) / a.length;
                const v0 = s.from + (s.to - s.from) * f0, v1 = s.from + (s.to - s.from) * f1;
                const xa = x0 + (x1 - x0) * f0, xb = x0 + (x1 - x0) * f1;
                return <path key={k} d={`M${xa} ${H} L${xa} ${y(v0)} L${xb} ${y(v1)} L${xb} ${H} Z`} style={{ fill: colour((v0 + v1) / 2) }} />;
              })
              : [<rect key="b" x={x0 + gap} y={y(s.from)} width={Math.max(0.6, x1 - x0 - 2 * gap)} height={Math.max(1, H - y(s.from))}
                style={{ fill: s.look === 'target' ? colour(s.from) : s.look === 'feel' ? `url(#feel${pid})` : 'var(--s3)' }} />];
            return (
              <g key={i} opacity={dim ? 0.45 : s.est ? 0.8 : 1} style={{ cursor: pick ? 'pointer' : 'default' }}
                onPointerEnter={() => setHover(i)} onClick={pick ? () => pick(s.step) : undefined}>
                {parts}
                {s.est && <path d={`M${x0 + gap} ${y(s.from)} H${x1 - gap}`} style={{ stroke: 'var(--tx2)' }} strokeDasharray="3 3" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
                {lit && <path d={`M${x0} ${H} V${Math.min(y(s.from), y(s.to)) - 3} H${x1} V${H}`} fill="none" style={{ stroke: 'var(--tx)' }} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
                <rect x={x0} y={0} width={Math.max(1, x1 - x0)} height={H} fill="transparent" tabIndex={0} role="img"
                  aria-label={`${s.step.kind}${s.round ? ` ${s.round[0]} of ${s.round[1]}` : ''}: ${what(s)}, ${s.est ? 'until Lap' : mmss(s.secs)}`}
                  data-tip={tipOf(s, i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  onKeyDown={pick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(s.step); } } : undefined} />
              </g>
            );
          })}
          {mode === 'power' && ftp && <path d={`M0 ${y(ftp)} H${W}`} style={{ stroke: 'var(--tx2)' }} strokeDasharray="5 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        </svg>
        {yTicks.length > 0 && <span />}
        <div className="m" aria-hidden="true" style={{ position: 'relative', height: 14, color: 'var(--tx3)', fontSize: 10 }}>
          {ticks.map((v) => <span key={v} style={{ position: 'absolute', left: `${(x(v) / W) * 100}%`, transform: v ? 'translateX(-50%)' : undefined, whiteSpace: 'nowrap' }}>{model.anyEst && v ? '≈' : ''}{Math.round(v / 60)}′</span>)}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 11, color: 'var(--tx2)' }}>
        {mode === 'power' && ftp && PZ.map(([p, z, c], i) => (
          <span key={z} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{z} {i === 0 ? `< ${Math.round(PZ[1][0] * 100)}` : i === PZ.length - 1 ? `≥ ${Math.round(p * 100)}` : `${Math.round(p * 100)}–${Math.round(PZ[i + 1][0] * 100) - 1}`} %</span>
        ))}
        {mode === 'power' && ftp && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, borderTop: '1px dashed var(--tx2)' }} />FTP {ftp} W</span>}
        {mode === 'hr' && zones?.map((z, i) => (
          <span key={z.zone} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: HZ[i] ?? 'var(--b)' }} />Z{z.zone} {z.low}{zones[i + 1] ? `–${zones[i + 1].low - 1}` : '+'}</span>
        ))}
        {segs.some((s) => s.look === 'easy') && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--s3)', border: '1px solid var(--ln2)' }} />no target · easy</span>}
        {segs.some((s) => s.look === 'feel') && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><svg width="10" height="10" aria-hidden="true"><rect width="10" height="10" fill={`url(#feel${pid})`} /></svg>no target · work by feel</span>}
        {model.anyEst && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, borderTop: '1px dashed var(--tx2)' }} />until Lap · width ≈ the plan’s estimate</span>}
      </div>
    </div>
  );
}
