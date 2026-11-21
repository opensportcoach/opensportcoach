/**
 * A ride or a run, measured (docs/DESIGN.md (rides and runs) Phase 2). Everything here comes from the workout
 * view's `endurance` block — scripts/endurance_metrics.py — so the coach's review cites the same
 * numbers. Every metric shows its source: Garmin's value, or computed by OpenSportCoach.
 */
import { useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { useStore } from '../lib/api';
import type { EnduranceReview } from '../contracts';
import { day, elapsed, mmss, nf } from '../lib/fmt';
import { rich } from '../lib/tip';
import { axisFor, yFrac, type Axis } from '../components/Chart';
import { IC, Icon } from '../components/ui';

const ZONE_COL = ['var(--tx3)', 'var(--b)', 'var(--g)', 'var(--o)', 'var(--r)', 'var(--v)', 'var(--v)'];
const SRC = (s: string) => (s === 'garmin' ? 'Garmin' : s === 'file' ? 'your exported file' : s === 'strava' ? 'Strava' : s === 'athlete.json' ? 'your setting' : 'computed by OpenSportCoach');

export function EndurancePanel({ w }: { w: any }) {
  const e = w.endurance;
  const [hover, setHover] = useState<number | null>(null);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const st = e.streams ?? {};
  const hasStreams = (st.t?.length ?? 0) > 1;
  return (
    <>
      {e.flags?.length > 0 && (
        <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--y)', background: 'var(--yt)', color: 'var(--y)', fontSize: 14 }}>
          <Icon d={IC.warn} size={16} sw={2.4} /><span><b>Worth a look.</b> {e.flags.map((f: any) => f.text).join(' ')}</span>
        </div>
      )}
      <Review w={w} />
      <Performance w={w} />
      {hasStreams && <Linked w={w} hover={hover} setHover={setHover} sel={sel} setSel={setSel} />}
      <div className="grid2">
        {st.lat && <Route w={w} hover={hover} sel={sel} />}
        <Zones e={e} />
        {Object.keys(e.bests ?? {}).length > 0 && <Bests e={e} />}
      </div>
    </>
  );
}

// --- the coach's review (Phase 4) -----------------------------------------------------------------
const RATING: Record<string, [string, string]> = {
  on_target: ['On target', 'var(--g)'], partly: ['Partly', 'var(--y)'], off_target: ['Off target', 'var(--r)'], unclear: ['Unclear', 'var(--tx2)'],
};
const SEVERITY: Record<string, [string, string, string]> = {
  good: ['✓', 'var(--g)', 'var(--gt)'], info: ['i', 'var(--b)', 'var(--bt)'], watch: ['!', 'var(--y)', 'var(--yt)'], act: ['!', 'var(--r)', 'var(--rt)'],
};
const INTENT: Record<string, string> = {
  recovery: 'Recovery', endurance: 'Endurance', tempo: 'Tempo', threshold: 'Threshold', vo2: 'VO₂max', race: 'Race', mixed: 'Mixed', unknown: 'Unknown',
};

/** "Analyse this ride": a review request for THIS activity, and its result once the coach publishes it. */
function Review({ w }: { w: any }) {
  const { state, ask } = useStore();
  const offline = state?.coach !== 'online';
  const mine = (state?.requests ?? []).filter((r) => r.kind === 'workflow' && String(r.params?.activity_id ?? '') === String(w.id));
  const done = [...mine].reverse().find((r) => r.state === 'DONE' && r.result?.kind === 'endurance_review');
  const running = mine.find((r) => r.state === 'QUEUED' || r.state === 'WORKING');
  const failed = !done && !running ? [...mine].reverse().find((r) => r.state === 'FAILED') : null;
  const noun = w.group === 'bike' ? 'ride' : 'run';
  const go = () => ask('workflow', `Analyse this ${noun} · ${w.title} · ${day(w.date)}`, { name: 'review', activity_id: String(w.id), date: w.date });
  if (done?.result?.kind === 'endurance_review') return <ReviewCard p={done.result.payload} again={running ? null : go} offline={offline} />;
  return (
    <section className="card" style={{ borderRadius: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '16px 20px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 260px' }}>
        <span className="l" style={{ color: 'var(--tx)' }}>Coach’s analysis</span>
        <span style={{ fontSize: 14, color: 'var(--tx2)' }}>
          {running ? (running.progress.at(-1) ?? (running.state === 'QUEUED' ? 'Queued — the coach takes one request at a time.' : 'Reading the session…'))
            : failed ? `Not done: ${failed.error ?? 'the coach could not finish'}`
              : `What this ${noun} was for, whether it did its job, and one thing to change — every number from the metrics below.`}
        </span>
      </div>
      <button type="button" className="btn" disabled={offline || !!running} onClick={go} style={{ minHeight: 44 }}>
        {running ? <><Icon className="spin" d={IC.spinner} size={16} />Analysing…</> : <><Icon d={IC.chat} size={16} sw={2} />Analyse this {noun}</>}
      </button>
    </section>
  );
}

function ReviewCard({ p, again, offline }: { p: EnduranceReview; again: (() => void) | null; offline: boolean }) {
  const [label, col] = RATING[p.execution.rating] ?? RATING.unclear;
  return (
    <section aria-labelledby="review" className="card" style={{ borderRadius: 16, gap: 14, borderColor: col }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
        <h2 id="review" className="l" style={{ color: 'var(--tx)' }}>Coach’s analysis</h2>
        <span className="chip" style={{ background: 'var(--s2)', color: 'var(--tx)' }}
          data-tip={`${p.intent.why}
${p.intent.source === 'planned' ? 'From the scheduled workout.' : p.intent.source === 'athlete' ? 'You said so.' : 'Inferred from the data — not planned.'}`} tabIndex={0}>
          {INTENT[p.intent.value] ?? p.intent.value}{p.intent.source === 'inferred' ? ' · inferred' : ''}
        </span>
        <span className="chip" style={{ background: 'var(--s2)', color: col }}>{label}</span>
        {again && <button type="button" className="btn2" disabled={offline} onClick={again} style={{ marginLeft: 'auto', minHeight: 32 }}>Analyse again</button>}
      </div>
      <p style={{ margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>{p.verdict}</p>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--tx2)' }}>{p.execution.summary}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {p.findings.map((f: any, i: number) => {
          const [icon, c, bg] = SEVERITY[f.severity] ?? SEVERITY.info;
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--s2)' }}>
              <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', background: bg, color: c, fontWeight: 700, fontSize: 12 }}>{icon}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 14 }}>{f.claim}</span>
                {f.evidence.length > 0 && (
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {f.evidence.map((e: any, j: number) => (
                      <span key={j} className="m" data-tip={`${e.metric} — checked against the metrics engine before this was shown.`} tabIndex={0}
                        style={{ padding: '2px 6px', borderRadius: 5, border: '1px solid var(--ln2)', color: 'var(--tx2)', fontSize: 11 }}>
                        {e.label ?? e.metric} <b style={{ color: 'var(--tx)' }}>{e.value}</b>
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {(p.context?.length ?? 0) > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--tx2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {p.context?.map((c, i) => <li key={i} data-tip={`Source: ${c.source}`} tabIndex={0}>{c.text}</li>)}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--ln2)' }}>
        <span className="l" style={{ color: 'var(--id)' }}>Next time</span><span style={{ fontSize: 15 }}>{p.next_time}</span>
      </div>
      {p.questions?.length > 0 && <span style={{ fontSize: 13, color: 'var(--tx2)' }}>The coach asks: {p.questions.join(' · ')} <span style={{ color: 'var(--tx3)' }}>— answer in the dock.</span></span>}
      <span className="m" style={{ color: 'var(--tx3)' }}>Coach · {p.generated_at?.slice(0, 16).replace('T', ' ')} · every number checked against the metrics engine</span>
    </section>
  );
}

// --- the numbers -----------------------------------------------------------------------------------
const KPI: Record<string, { label: string; fmt: (v: number) => string; def?: string; text?: string }> = {
  avg_power: { label: 'Avg power', fmt: (v) => String(v), text: 'Average power over moving time.' },
  np: { label: 'Normalized power', fmt: (v) => String(v), def: 'np' },
  if: { label: 'Intensity', fmt: (v) => v.toFixed(2), def: 'if' },
  tss: { label: 'TSS', fmt: (v) => String(v), def: 'tss' },
  vi: { label: 'Variability', fmt: (v) => v.toFixed(2), def: 'vi' },
  kj: { label: 'Work', fmt: (v) => nf(v), text: 'Work: average power × moving time.' },
  gap: { label: 'Grade-adj. pace', fmt: mmss, text: 'Pace adjusted for climbing and descending — what the flat-ground effort was. From Garmin.' },
  cadence: { label: 'Cadence', fmt: (v) => String(v) },
  stride: { label: 'Stride', fmt: (v) => nf(v / 100, 2), text: 'Average stride length.' },
  gct: { label: 'Ground contact', fmt: (v) => String(v), text: 'Average time each foot is on the ground.' },
  vo: { label: 'Vertical osc.', fmt: (v) => v.toFixed(1), text: 'How far you bounce per step.' },
  decoupling: { label: 'Decoupling', fmt: (v) => v.toFixed(1), def: 'decoupling' },
  ef: { label: 'Efficiency', fmt: (v) => v.toFixed(2), def: 'ef' },
};
const UNIT: Record<string, string> = { stride: 'm', 's/km': '/km' };

function Performance({ w }: { w: any }) {
  const e = w.endurance;
  const ride = w.group === 'bike';
  const order = ride ? ['avg_power', 'np', 'if', 'tss', 'vi', 'kj', 'cadence', 'decoupling', 'ef']
    : ['gap', 'cadence', 'stride', 'gct', 'vo', 'decoupling', 'ef'];
  const rows = order.map((k) => [k, e.metrics[k]] as const).filter(([, v]) => v);
  const ftp = e.thresholds?.ftp;
  const lthr = e.thresholds?.threshold_hr;
  const hasPower = !!e.metrics.avg_power;
  return (
    <section aria-labelledby="perf" className="card" style={{ borderRadius: 16, gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
        <h2 id="perf" className="l" style={{ color: 'var(--tx)' }}>{ride ? 'Ride' : 'Run'} metrics</h2>
        {e.virtual && <span className="chip" style={{ background: 'var(--vt)', color: 'var(--v)' }}>Virtual · no route (its coordinates aren’t a real place)</span>}
        {!e.outdoors && !e.virtual && <span className="chip" style={{ background: 'var(--s2)', color: 'var(--tx2)' }}>Indoors</span>}
        {e.weather && (
          <span className="chip" data-tip={`Weather during the session${e.weather.feels_like_c != null ? `: felt like ${Math.round(e.weather.feels_like_c)} °C` : ''}${e.weather.dew_point_c != null ? `, dew point ${Math.round(e.weather.dew_point_c)} °C` : ''}.\nHeat raises heart rate at the same effort — read decoupling with it.\nSource: Garmin.`} tabIndex={0}
            style={{ background: e.weather.temp_c >= 25 ? 'var(--ot)' : 'var(--s2)', color: e.weather.temp_c >= 25 ? 'var(--o)' : 'var(--tx2)' }}>
            {Math.round(e.weather.temp_c)} °C{e.weather.humidity_pct != null ? ` · ${Math.round(e.weather.humidity_pct)} % humidity` : ''}{e.weather.conditions ? ` · ${e.weather.conditions.toLowerCase()}` : ''}
          </span>
        )}
      </div>
      {rows.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(120px, 100%), 1fr))', gap: 1, background: 'var(--ln)', border: '1px solid var(--ln)', borderRadius: 12, overflow: 'hidden' }}>
          {rows.map(([k, v]) => {
            const spec = KPI[k];
            const def = spec.def ? e.definitions?.[spec.def] : spec.text;
            const unit = UNIT[k] ?? UNIT[v.unit] ?? v.unit;
            const basis = v.basis ? `\nBasis: ${v.basis === 'power' ? 'power per heartbeat' : 'speed per heartbeat'}.` : '';
            return (
              <div key={k} data-tip={`${def ?? spec.label}${basis}\nSource: ${SRC(v.source)}.`} tabIndex={0} style={{ background: 'var(--s1)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="l" style={{ fontSize: 10 }}>{spec.label}</span>
                <span className="n" style={{ fontSize: 26, lineHeight: 1, fontWeight: 700, color: k === 'decoupling' && v.value > 5 ? 'var(--y)' : undefined }}>
                  {spec.fmt(v.value)}<span style={{ fontSize: 13, color: 'var(--tx2)', fontWeight: 500 }}> {unit}</span>
                </span>
                <span className="m" style={{ color: 'var(--tx3)', fontSize: 10 }}>{v.source === 'garmin' ? 'Garmin' : v.source === 'file' ? 'file' : v.source === 'strava' ? 'Strava' : 'computed'}{v.basis ? ` · ${v.basis}` : ''}</span>
              </div>
            );
          })}
        </div>
      ) : <span style={{ fontSize: 14, color: 'var(--tx2)' }}>Garmin sent no {ride ? 'power or cadence' : 'running dynamics'} for this session.</span>}
      <span className="m" style={{ color: 'var(--tx3)' }}>
        {ride && hasPower ? (ftp ? `FTP ${ftp.value} W (${SRC(ftp.source)})` : 'No FTP yet — intensity and TSS need one: set ftp_w in athlete.json, or let Garmin estimate it') : ''}
        {ride && hasPower ? ' · ' : ''}{lthr ? `threshold HR ${lthr.value} bpm (${SRC(lthr.source)})` : 'no threshold HR yet'}
      </span>
    </section>
  );
}

// --- linked charts ---------------------------------------------------------------------------------
interface Track { key: string; label: string; unit: string; color: string; vals: (number | null)[]; axis: Axis; area?: boolean }

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

function Linked({ w, hover, setHover, sel, setSel }: {
  w: any; hover: number | null; setHover: (i: number | null) => void; sel: [number, number] | null; setSel: (s: [number, number] | null) => void;
}) {
  const { state, askAbout } = useStore();
  const st = w.endurance.streams;
  const ride = w.group === 'bike';
  const [xMode, setXMode] = useState<'time' | 'distance'>('time');
  const [smooth, setSmooth] = useState(true);
  const hasDist = st.distance?.some((v: number | null) => v != null && v > 0);
  const xs: number[] = xMode === 'distance' && hasDist ? st.distance.map((v: number | null) => (v ?? 0) / 1000) : st.t;

  const tracks = useMemo<Track[]>(() => {
    const out: Track[] = [];
    const add = (key: string, label: string, unit: string, color: string, vals: (number | null)[] | undefined, fmt: (v: number) => string, opts: { invert?: boolean; area?: boolean } = {}) => {
      if (!vals || !vals.some((v) => v != null)) return;
      out.push({ key, label, unit, color, vals, area: opts.area, axis: axisFor(vals, fmt, { invert: opts.invert, count: 3 }) });
    };
    add('hr', 'Heart rate', 'bpm', 'var(--r)', st.hr, (v) => String(Math.round(v)));
    // The 30 s line is the engine's (endurance_metrics.smoothed: NP's own rolling mean over the full
    // 1 Hz stream) — averaging the page's thinned points was three samples, not thirty seconds.
    if (st.power) add('power', smooth && st.power_30s ? 'Power · 30 s' : 'Power', 'W', 'var(--b)', smooth && st.power_30s ? st.power_30s : st.power, (v) => String(Math.round(v)));
    if (ride) add('speed', 'Speed', 'km/h', 'var(--g)', st.speed?.map((v: number | null) => (v == null ? null : v * 3.6)), (v) => nf(v, 0));
    else add('pace', 'Pace', '/km', 'var(--g)', st.speed?.map((v: number | null) => (v != null && v > 1 ? 1000 / v : null)), mmss, { invert: true });
    add('cadence', 'Cadence', ride ? 'rpm' : 'spm', 'var(--v)', st.cadence, (v) => String(Math.round(v)));
    add('elevation', 'Elevation', 'm', 'var(--tx3)', st.elevation, (v) => String(Math.round(v)), { area: true });
    return out;
  }, [st, smooth, ride]);

  // Pointer → nearest sample index; drag → a selected stretch.
  const drag = useRef<number | null>(null);
  const idxAt = (ev: RPointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const xv = xs[0] + ((ev.clientX - r.left) / r.width) * (xs[xs.length - 1] - xs[0]);
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] < xv) lo = mid; else hi = mid; }
    return Math.abs(xs[lo] - xv) <= Math.abs(xs[hi] - xv) ? lo : hi;
  };
  const handlers = {
    onPointerMove: (ev: RPointerEvent<SVGSVGElement>) => {
      const i = idxAt(ev);
      setHover(i);
      if (drag.current != null && Math.abs(i - drag.current) > 1) setSel([Math.min(drag.current, i), Math.max(drag.current, i)]);
    },
    onPointerDown: (ev: RPointerEvent<SVGSVGElement>) => { if (ev.pointerType === 'mouse') { drag.current = idxAt(ev); ev.currentTarget.setPointerCapture(ev.pointerId); } },
    onPointerUp: () => { drag.current = null; },
    onPointerLeave: () => { if (drag.current == null) setHover(null); },
  };

  // The keyboard reads and selects too (docs/DESIGN.md (app audit) L4): arrows move about 1 % of the session,
  // Shift extends a selection from where it started, Escape clears both.
  const anchor = useRef<number | null>(null);
  const onKey = (ev: RKeyboardEvent) => {
    const n = xs.length;
    const step = Math.max(1, Math.round(n / 100)) * (ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0);
    if (ev.key === 'Escape') { setHover(null); setSel(null); anchor.current = null; return; }
    if (!step) return;
    ev.preventDefault();
    const from = hover ?? (step > 0 ? 0 : n - 1);
    const to = Math.min(n - 1, Math.max(0, hover == null ? from : from + step));
    setHover(to);
    if (ev.shiftKey) {
      if (anchor.current == null) anchor.current = from;
      setSel(to === anchor.current ? null : [Math.min(anchor.current, to), Math.max(anchor.current, to)]);
    } else anchor.current = null;
  };
  const at = hover ?? null;
  const xLabel = (v: number) => (xMode === 'distance' && hasDist ? `${nf(v, v < 10 ? 1 : 0)} km` : elapsed(v));
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const pxOf = (v: number) => ((v - x0) / Math.max(1e-9, x1 - x0)) * 600;
  const ticks = (() => {
    const span = x1 - x0;
    const step = xMode === 'distance' && hasDist ? ([1, 2, 5, 10, 20, 50].find((s) => span / s <= 6) ?? 50) : ([300, 600, 900, 1800, 3600].find((s) => span / s <= 6) ?? 3600);
    return Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => x0 + i * step);
  })();

  const selStats = sel && (() => {
    const [a, b] = sel;
    const slice = (k: string, f?: (v: number) => number) => (st[k] ? st[k].slice(a, b + 1).map((v: number | null) => (v == null ? null : f ? f(v) : v)) : null);
    return {
      secs: st.t[b] - st.t[a], km: hasDist ? ((st.distance[b] ?? 0) - (st.distance[a] ?? 0)) / 1000 : null,
      hr: avg(slice('hr') ?? []), power: st.power ? avg(slice('power') ?? []) : null,
      speed: avg(slice('speed') ?? []), cadence: st.cadence ? avg(slice('cadence') ?? []) : null,
    };
  })();
  const askPart = () => {
    if (!sel || !selStats) return;
    const s = selStats;
    const what = [s.power != null && `avg ${Math.round(s.power)} W`, s.hr != null && `HR ${Math.round(s.hr)}`,
      s.speed != null && (ride ? `${nf(s.speed * 3.6, 1)} km/h` : `${mmss(1000 / s.speed)} /km`)].filter(Boolean).join(', ');
    askAbout(`${w.title} · ${day(w.date)} (activity ${w.id}) — the stretch from ${elapsed(st.t[sel[0]])} to ${elapsed(st.t[sel[1]])}: ${what}`);
  };

  return (
    <section aria-labelledby="linked" className="card" style={{ borderRadius: 16, gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
        <h2 id="linked" className="l" style={{ color: 'var(--tx)' }}>Across the {ride ? 'ride' : 'run'}</h2>
        <span className="m" style={{ color: 'var(--tx3)' }}>hover to read · drag to select a stretch</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {hasDist && (['time', 'distance'] as const).map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={xMode === m} onClick={() => setXMode(m)}
              style={{ border: '1px solid var(--ln2)', background: xMode === m ? 'var(--tx)' : 'transparent', color: xMode === m ? 'var(--on)' : 'var(--tx2)' }}>{m === 'time' ? 'Time' : 'Distance'}</button>
          ))}
          {st.power && <button type="button" className="chip" aria-pressed={smooth} onClick={() => setSmooth(!smooth)}
            style={{ border: '1px solid var(--ln2)', background: smooth ? 'var(--bt)' : 'transparent', color: smooth ? 'var(--b)' : 'var(--tx2)' }}>30 s smoothing</button>}
        </div>
      </div>
      <div className="m" aria-live="off" style={{ minHeight: 18, display: 'flex', flexWrap: 'wrap', gap: '4px 14px', color: 'var(--tx2)', fontSize: 12 }}>
        {at != null ? (
          <>
            <b style={{ color: 'var(--tx)' }}>{elapsed(st.t[at])}{hasDist && st.distance[at] != null ? ` · ${nf(st.distance[at] / 1000, 2)} km` : ''}</b>
            {tracks.map((t) => t.vals[at] != null && <span key={t.key} style={{ color: t.color === 'var(--tx3)' ? 'var(--tx2)' : t.color }}>{t.label.split(' ·')[0]} {t.axis.fmt(t.vals[at] as number)} {t.unit}</span>)}
          </>
        ) : <span style={{ color: 'var(--tx3)' }}>—</span>}
      </div>
      <div tabIndex={0} role="group" onKeyDown={onKey} style={{ display: 'flex', flexDirection: 'column', gap: 6, touchAction: 'pan-y', borderRadius: 8 }}
        aria-label={`${ride ? 'Ride' : 'Run'} charts. Left and right arrows move the reading; Shift with an arrow selects a stretch; Escape clears.`}>
        {tracks.map((t) => (
          <div key={t.key} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', columnGap: 8, rowGap: 2, alignItems: 'stretch' }}>
            <span />
            <span className="l" style={{ fontSize: 9, color: t.color === 'var(--tx3)' ? 'var(--tx2)' : t.color }}>{t.label} · {t.unit}</span>
            <div style={{ position: 'relative', height: 74 }}>
              {t.axis.ticks.map((v) => (
                <span key={v} className="m" style={{ position: 'absolute', right: 0, top: 74 - yFrac(v, t.axis) * 74 - 6, fontSize: 9, color: 'var(--tx3)' }}>{t.axis.fmt(v)}</span>
              ))}
            </div>
            <svg viewBox="0 0 600 74" width="100%" height={74} preserveAspectRatio="none" role="img" aria-label={`${t.label} in ${t.unit}`}
              style={{ cursor: 'crosshair', overflow: 'visible' }} {...handlers}>
              {t.axis.ticks.map((v) => <path key={v} d={`M0 ${74 - yFrac(v, t.axis) * 74} H600`} style={{ stroke: 'var(--ln)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
              {sel && <rect x={pxOf(xs[sel[0]])} y={0} width={Math.max(1, pxOf(xs[sel[1]]) - pxOf(xs[sel[0]]))} height={74} style={{ fill: 'var(--idt)' }} />}
              <TrackPath t={t} xs={xs} px={pxOf} />
              {at != null && <path d={`M${pxOf(xs[at])} 0 V74`} style={{ stroke: 'var(--tx2)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />}
            </svg>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', columnGap: 8 }}>
          <span />
          <div className="m" style={{ position: 'relative', height: 14, color: 'var(--tx3)', fontSize: 10 }}>
            {ticks.map((v) => <span key={v} style={{ position: 'absolute', left: `${(pxOf(v) / 600) * 100}%`, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>{xLabel(v)}</span>)}
          </div>
        </div>
      </div>
      {sel && selStats && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '10px 14px', borderRadius: 12, background: 'var(--s2)', fontSize: 13 }}>
          <b>Selected {elapsed(st.t[sel[0]])}–{elapsed(st.t[sel[1]])}</b>
          <span>{mmss(selStats.secs)}{selStats.km != null ? ` · ${nf(selStats.km, 2)} km` : ''}</span>
          {selStats.power != null && <span style={{ color: 'var(--b)' }}>{Math.round(selStats.power)} W</span>}
          {selStats.hr != null && <span style={{ color: 'var(--r)' }}>{Math.round(selStats.hr)} bpm</span>}
          {selStats.speed != null && <span style={{ color: 'var(--g)' }}>{ride ? `${nf(selStats.speed * 3.6, 1)} km/h` : `${mmss(1000 / selStats.speed)} /km`}</span>}
          {selStats.cadence != null && <span style={{ color: 'var(--v)' }}>{Math.round(selStats.cadence)} {ride ? 'rpm' : 'spm'}</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" className="btn2" style={{ minHeight: 34 }} disabled={state?.coach !== 'online'} onClick={askPart}><Icon d={IC.chat} size={14} sw={2} />Ask about this part</button>
            <button type="button" className="btn2" style={{ minHeight: 34 }} onClick={() => setSel(null)}>Clear</button>
          </span>
        </div>
      )}
      <span className="m" style={{ color: 'var(--tx3)' }}>Source: Garmin, the recorded streams{st.power && smooth ? ' · power smoothed over 30 s' : ''}</span>
    </section>
  );
}

function TrackPath({ t, xs, px }: { t: Track; xs: number[]; px: (v: number) => number }) {
  let d = '';
  let pen = false;
  t.vals.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${px(xs[i]).toFixed(1)} ${(74 - yFrac(v, t.axis) * 74).toFixed(1)} `;
    pen = true;
  });
  return (
    <>
      {t.area && d && <path d={`${d} V74 H${px(xs[0])} Z`} style={{ fill: 'var(--s3)' }} />}
      <path d={d} fill="none" style={{ stroke: t.color }} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </>
  );
}

// --- the route -------------------------------------------------------------------------------------
function Route({ w, hover, sel }: { w: any; hover: number | null; sel: [number, number] | null }) {
  const e = w.endurance;
  const st = e.streams;
  const hrZones: any[] = e.zones?.hr ?? [];
  const pts = st.lat.map((la: number | null, i: number) => (la != null && st.lon[i] != null ? [la, st.lon[i]] : null));
  const ok = pts.filter(Boolean) as [number, number][];
  if (ok.length < 2) return null;
  const lats = ok.map((p) => p[0]), lons = ok.map((p) => p[1]);
  const kx = Math.cos(((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI / 180);
  const minX = Math.min(...lons) * kx, maxX = Math.max(...lons) * kx, minY = -Math.max(...lats), maxY = -Math.min(...lats);
  const W = 400, pad = 12;
  const s = (W - 2 * pad) / Math.max(maxX - minX, maxY - minY, 1e-9);
  const H = Math.max(120, (maxY - minY) * s + 2 * pad);
  const P = (p: [number, number]) => [pad + (p[1] * kx - minX) * s, pad + (-p[0] - minY) * s];
  const zoneOf = (hr: number | null) => (hr == null || !hrZones.length ? -1 : hrZones.reduce((z, r, i) => (r.low != null && hr >= r.low ? i : z), 0));
  const segs: { d: string; col: string }[] = [];
  let cur: { d: string; col: string } | null = null;
  pts.forEach((p: [number, number] | null, i: number) => {
    if (!p) { cur = null; return; }
    const z = zoneOf(st.hr?.[i] ?? null);
    const col = z < 0 ? 'var(--b)' : ZONE_COL[z];
    const [x, y] = P(p);
    if (!cur || cur.col !== col) {
      const prev = cur && i > 0 && pts[i - 1] ? P(pts[i - 1]) : null;
      cur = { d: prev ? `M${prev[0].toFixed(1)} ${prev[1].toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)}` : `M${x.toFixed(1)} ${y.toFixed(1)}`, col };
      segs.push(cur);
    } else cur.d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const dot = hover != null && pts[hover] ? P(pts[hover]) : null;
  const start = P(ok[0]), end = P(ok[ok.length - 1]);
  return (
    <section aria-labelledby="route" className="card" style={{ borderRadius: 16, gap: 10 }}>
      <h2 id="route" className="l" style={{ color: 'var(--tx)' }}>Route</h2>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxHeight: 360 }} role="img" aria-label="The route, coloured by heart-rate zone">
        {sel && (() => {
          const part = pts.slice(sel[0], sel[1] + 1).filter(Boolean).map((p: [number, number]) => P(p));
          return part.length > 1 ? <path d={part.map(([x, y]: number[], i: number) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')} fill="none" style={{ stroke: 'var(--id)' }} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" opacity={0.45} /> : null;
        })()}
        {segs.map((sg, i) => <path key={i} d={sg.d} fill="none" style={{ stroke: sg.col }} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}
        <circle cx={start[0]} cy={start[1]} r="6" style={{ fill: 'var(--g)', stroke: 'var(--s1)' }} strokeWidth="2" />
        <circle cx={end[0]} cy={end[1]} r="6" style={{ fill: 'var(--r)', stroke: 'var(--s1)' }} strokeWidth="2" />
        {dot && <circle cx={dot[0]} cy={dot[1]} r="7" style={{ fill: 'var(--tx)', stroke: 'var(--s1)' }} strokeWidth="3" />}
      </svg>
      {hrZones.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, color: 'var(--tx2)' }}>
          {hrZones.map((z, i) => <span key={z.zone} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 3, background: ZONE_COL[i] }} />Z{z.zone}</span>)}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--g)' }} />start</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--r)' }} />finish</span>
        </div>
      )}
      <span className="m" style={{ color: 'var(--tx3)' }}>Coloured by heart-rate zone · your GPS line only — no map tiles, nothing leaves this Mac</span>
    </section>
  );
}

// --- zones and bests -------------------------------------------------------------------------------
function Zones({ e }: { e: any }) {
  const sets = [['Heart-rate zones', e.zones?.hr ?? []], ['Power zones', e.zones?.power ?? []]].filter(([, z]) => (z as any[]).length) as [string, any[]][];
  if (!sets.length) return null;
  return (
    <section aria-labelledby="zones" className="card" style={{ borderRadius: 16, gap: 14 }}>
      <h2 id="zones" className="l" style={{ color: 'var(--tx)' }}>Time in zones</h2>
      {sets.map(([title, zs]) => {
        const max = Math.max(1, ...zs.map((z) => z.pct));
        return (
          <div key={title} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="l" style={{ fontSize: 10 }}>{title} · this session’s own bounds</span>
            {title === 'Heart-rate zones' && e.zones?.hr_below_s >= 60 && (
              <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{mmss(e.zones.hr_below_s)} under zone 1 — Garmin counts it in no zone. Shares are of the whole session.</span>
            )}
            {zs.map((z, i) => (
              <div key={z.zone} data-tip={rich({ t: `Zone ${z.zone}`, c: ZONE_COL[i], r: [['Range', `${z.low ?? '?'}${z.high != null ? `–${z.high}` : '+'} ${z.unit}`], ['Time', mmss(z.secs)], ['Share', `${z.pct} %`]], s: 'Garmin' })} tabIndex={0}
                style={{ display: 'grid', gridTemplateColumns: '28px 92px 1fr 84px', alignItems: 'center', gap: 8 }}>
                <span className="m" style={{ color: 'var(--tx2)' }}>Z{z.zone}</span>
                <span className="m" style={{ color: 'var(--tx3)', fontSize: 10 }}>{z.low ?? '?'}{z.high != null ? `–${z.high}` : '+'} {z.unit}</span>
                <div style={{ height: 10, borderRadius: 5, background: 'var(--s3)' }}><div style={{ height: '100%', width: `${(z.pct / max) * 100}%`, borderRadius: 5, background: ZONE_COL[i] }} /></div>
                <span className="n" style={{ fontSize: 14, textAlign: 'right' }}>{z.pct} % <span style={{ color: 'var(--tx3)', fontSize: 12 }}>{mmss(z.secs)}</span></span>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}

const BEST_LABEL: Record<string, string> = { '5s': '5 s', '60s': '1 min', '300s': '5 min', '1200s': '20 min', '3600s': '60 min', '1k': '1 km', '5k': '5 km', '10k': '10 km' };

function Bests({ e }: { e: any }) {
  const ftp = e.thresholds?.ftp?.value;
  const entries = Object.entries(e.bests) as [string, number][];
  const power = entries.filter(([k]) => k.endsWith('s'));
  const runs = entries.filter(([k]) => k.endsWith('k'));
  const max = Math.max(1, ...power.map(([, v]) => v));
  return (
    <section aria-labelledby="bests" className="card" style={{ borderRadius: 16, gap: 12 }}>
      <h2 id="bests" className="l" style={{ color: 'var(--tx)' }} data-tip={e.definitions?.best_efforts} tabIndex={0}>Best efforts</h2>
      {power.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${power.length}, minmax(0, 1fr))`, gap: 8, alignItems: 'end', height: 150 }}>
          {power.map(([k, v]) => (
            <div key={k} data-tip={rich({ t: `Best ${BEST_LABEL[k]}`, c: 'var(--b)', r: [['Average power', `${v} W`, 'var(--b)'], ...(ftp ? [['Of your FTP', `${Math.round((100 * v) / ftp)} %`] as [string, string]] : [])], s: 'Computed by OpenSportCoach from the power stream' })} tabIndex={0}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
              <span className="n" style={{ fontSize: 15 }}>{v}<span style={{ fontSize: 11, color: 'var(--tx2)' }}> W</span></span>
              <div style={{ width: '70%', height: `${(v / max) * 100}px`, borderRadius: 6, background: 'var(--bt)', borderTop: '3px solid var(--b)' }} />
              <span className="m" style={{ color: 'var(--tx3)' }}>{BEST_LABEL[k]}</span>
            </div>
          ))}
        </div>
      )}
      {runs.length > 0 && (
        <table className="table">
          <thead><tr><th className="l">Distance</th><th className="l">Fastest</th><th className="l">Pace</th></tr></thead>
          <tbody>{runs.map(([k, v]) => (
            <tr key={k}><td className="m">{BEST_LABEL[k]}</td><td className="n">{elapsed(v)}</td><td className="n">{mmss(v / parseInt(k))} /km</td></tr>
          ))}</tbody>
        </table>
      )}
      <span className="m" style={{ color: 'var(--tx3)' }}>{power.length ? 'Highest average power over each duration in this session' : 'Fastest stretch of each distance in this run'}{ftp && power.length ? ` · FTP ${ftp} W` : ''}</span>
    </section>
  );
}
