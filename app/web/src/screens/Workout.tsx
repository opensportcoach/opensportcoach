/** One workout, all of it (boards Session-Push and Session-Endurance). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore, useView, type Defs } from '../lib/api';
import { day, dshort, elapsed, kg, mmss, nf, tip } from '../lib/fmt';
import { rich } from '../lib/tip';
import { Legend, XYChart, axisFor } from '../components/Chart';
import { EndurancePanel } from './endurance';
import { Empty, ErrorBox, IC, Icon, Markdown, Skeleton } from '../components/ui';
import { SportTag } from '../components/SportIcon';
import { FuelCard, FuelChip } from '../components/Fuel';
import { ScoreBadge, ScoreCard } from '../components/Score';
import { SessionReview } from '../components/SessionReview';

const SIG: Record<string, [string, string, string]> = {
  bump: ['↑', 'Bump', 'var(--g)'], progressing: ['↑', 'Progressing', 'var(--g)'], flat: ['=', 'Hold', 'var(--tx2)'],
  stalled: ['!', 'Stalled', 'var(--y)'], regressed: ['↓', 'Regressed', 'var(--r)'], '1 point': ['·', 'New', 'var(--tx2)'],
};

export default function Workout() {
  const { id } = useParams();
  const { data: w, error, loading } = useView('workout', id);
  const [flag, setFlag] = useState<string | null>(null);
  const closeFlag = useCallback(() => setFlag(null), []);
  if (error) return <ErrorBox error={error} />;
  if (loading && !w) return <><Skeleton h={180} /><Skeleton h={300} /></>;
  const strength = w.group === 'strength';
  return (
    <>
      <nav aria-label="Breadcrumb" style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--tx2)' }}>
        <Link to="/workouts" className="link">Workouts</Link><span aria-hidden="true">/</span><span aria-current="page" style={{ color: 'var(--tx)' }}>{w.title} · {day(w.date)}</span>
      </nav>
      <Head w={w} onFlag={setFlag} />
      {flag != null && <FlagDialog ctx={flag} close={closeFlag} />}
      <Reviews files={w.reviews} />
      {/* The execution score (docs/DESIGN.md (fuelling and score) §6.1, board Score-Card): under the reviews, every session it has a word for. */}
      {w.score && <ScoreCard s={w.score} defs={w.defs} ctx={`${day(w.date)} · ${w.title}`} />}
      {/* Fuel (docs/DESIGN.md (fuelling and score) §6.1): every ride and run; a gym session only when fuel was planned or logged. */}
      {w.fuel?.loggable && (w.group !== 'strength' || w.fuel.taken || w.fuel.plan) && <FuelCard w={w} />}
      {w.hr?.length > 1 && !w.endurance?.streams?.hr && <HrChart w={w} />}
      {strength ? <Strength w={w} onFlag={setFlag} /> : <Endurance w={w} />}
    </>
  );
}

function Head({ w, onFlag }: { w: any; onFlag: (ctx: string) => void }) {
  const { state, askAbout } = useStore();
  const offline = state?.coach !== 'online';
  const s = w.summary ?? {};
  const d: Defs = w.defs;
  const end = new Date(new Date(w.start.replace(' ', 'T')).getTime() + (s.duration ?? 0) * 1000);
  const strength = w.group === 'strength';
  const stats: [string, string, string, string?, string?][] = strength ? [
    ['Duration', nf((s.duration ?? 0) / 60), 'min'], ['Avg HR', nf(s.averageHR), 'bpm'], ['Max HR', nf(s.maxHR), 'bpm'],
    ['Calories', nf(s.calories), 'kcal'], ['Load', nf(s.activityTrainingLoad), '', 'var(--o)', tip(d, 'load')],
    ['Tonnage', nf(w.tonnage), 'kg', 'var(--o)', tip(d, 'tonnage')],
    ['Sets', nf(w.exercises.reduce((a: number, b: any) => a + b.sets.filter((x: any) => x.type === 'working').length, 0)), 'working'],
    ['Reps', nf(w.exercises.reduce((a: number, b: any) => a + b.sets.reduce((c: number, x: any) => c + (x.reps_logged || 0), 0), 0)), ''],
  ] : [
    ['Duration', s.duration != null ? elapsed(s.duration) : '—', ''],
    // No distance (a circuit, a gym session logged as cardio): no distance or speed tiles.
    ...(s.distance ? [['Distance', w.group === 'swim' ? nf(s.distance) : nf(s.distance / 1000, 2), w.group === 'swim' ? 'm' : 'km'],
      [w.group === 'swim' ? 'Pace' : w.group === 'run' ? 'Pace' : 'Speed', pace(w), w.group === 'swim' ? '/100 m' : w.group === 'run' ? '/km' : 'km/h']] as any : []),
    ['Avg HR', nf(s.averageHR), 'bpm'], ['Max HR', nf(s.maxHR), 'bpm'], ['Load', nf(s.activityTrainingLoad), '', 'var(--b)', tip(d, 'load')],
    ...(s.elevationGain ? [['Elevation', nf(s.elevationGain), 'm']] as any : []), ...(s.calories ? [['Calories', nf(s.calories), 'kcal']] as any : []),
    ...(s.aerobicTrainingEffect ? [['Aerobic TE', nf(s.aerobicTrainingEffect, 1), '']] as any : []),
  ];
  const autos = strength ? w.exercises.reduce((a: number, b: any) => a + b.sets.filter((x: any) => x.auto_detected).length, 0) : 0;
  const prs = strength ? w.exercises.filter((b: any) => b.sets.some((x: any) => x.pr)) : [];
  // The sport's own name (sports.badge): tennis reads Tennis, never "Cardio" or "Circuit" (R5).
  const kind = strength ? 'Strength · gym' : w.stations?.length ? `${w.sport ?? 'Circuit'} · stations` : w.sport ?? 'Cardio';
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px 20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <SportTag b={{ sport: kind, icon: w.icon, kind: w.kind }} size={14} style={{ fontSize: 11 }} />

          </span>
          <h1 className="n" style={{ fontSize: 64, lineHeight: 0.9, fontWeight: 700 }}>{w.title}</h1>
          <span style={{ fontSize: 14, color: 'var(--tx2)' }}>{day(w.date)} · <span className="n" style={{ fontSize: 16, color: 'var(--tx)' }}>{w.start.slice(11, 16)}–{end.toTimeString().slice(0, 5)}</span></span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {w.score && <ScoreBadge s={w.score} size="lg" defs={d} href="#score" />}
          <button type="button" className="btn2 hv" disabled={offline} style={{ minHeight: 44, borderRadius: 12, fontSize: 14 }}
            onClick={() => askAbout(`${w.title} · ${day(w.date)} (activity ${w.id})`)}><Icon d={IC.chat} size={16} sw={2} />Ask about this session</button>
          <button type="button" className="btn2 hv" disabled={offline} style={{ minHeight: 44, borderRadius: 12, fontSize: 14 }}
            onClick={() => onFlag(`${w.title} · ${day(w.date)} · activity ${w.id}`)}><Icon d={IC.flag} size={16} sw={2} />This number looks wrong</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(96px, 100%), 1fr))', gap: 1, background: 'var(--ln)', border: '1px solid var(--ln)', borderRadius: 16 }}>
        {stats.map(([l, v, u, c, t]) => (
          <div key={l} data-tip={t} tabIndex={0} style={{ background: 'var(--s1)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="l" style={{ fontSize: 10, color: c }}>{l}</span>
            <span className="n" style={{ fontSize: 30, lineHeight: 1, fontWeight: 700 }}>{v}<span style={{ fontSize: 14, color: 'var(--tx2)', fontWeight: 500 }}> {u}</span></span>
          </div>
        ))}
      </div>
      {strength && w.active_s + w.rest_s > 0 && (
        <div data-tip="Active = time inside sets (from set durations). Rest = everything between sets.\nSource: Computed by OpenSportCoach from Garmin set data." tabIndex={0} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span><b className="n" style={{ fontSize: 15 }}>{mmss(w.active_s)}</b> <span style={{ color: 'var(--tx2)' }}>active</span></span><span><span style={{ color: 'var(--tx2)' }}>rest</span> <b className="n" style={{ fontSize: 15 }}>{mmss(w.rest_s)}</b></span></div>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 }}><div style={{ flex: w.active_s, background: 'var(--o)' }} /><div style={{ flex: w.rest_s, background: 'var(--s3)' }} /></div>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {autos > 0 && <span className="chip" data-tip="Garmin’s exercise recognition named this set; it wasn’t confirmed on the watch. Never trust an auto-detected name." tabIndex={0} style={{ background: 'var(--yt)', color: 'var(--y)' }}><Icon d={IC.warn} size={12} sw={2.6} />{autos} {autos === 1 ? 'set' : 'sets'} named by the watch — unverified</span>}
        {prs.map((b: any) => <span key={b.label} className="chip" style={{ background: 'var(--gt)', color: 'var(--g)' }}><Icon d={IC.up} size={12} sw={3} />PR · {b.label} e1RM</span>)}
        <FuelChip f={w.fuel} />
      </div>
      {w.annotation && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', borderRadius: 10, background: 'var(--vt)' }}>
          <span className="l" style={{ fontSize: 10, color: 'var(--v)' }}>Coach’s note · {ANNOTATION[w.annotation.type] ?? 'about this session'}</span>
          {w.annotation.note && <span style={{ fontSize: 13, lineHeight: 1.45 }}>{w.annotation.note}</span>}
        </div>
      )}
    </section>
  );
}

function pace(w: any): string {
  const s = w.summary ?? {};
  if (!s.duration || !s.distance) return '—';
  if (w.group === 'swim') return mmss(s.duration / (s.distance / 100));
  if (w.group === 'run') return mmss(s.duration / (s.distance / 1000));
  return nf((s.distance / 1000) / (s.duration / 3600), 1);
}

/** "This number looks wrong". Opened from a set deep in the page, it comes into view ready to type —
 * it used to open under the header, off-screen (docs/DESIGN.md (app audit) U11) — and is sent once. */
function FlagDialog({ ctx, close }: { ctx: string; close: () => void }) {
  const { state, ask } = useStore();
  const offline = state?.coach !== 'online';
  const [why, setWhy] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const box = useRef<HTMLElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSent(false);
    setMsg(null);
    box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    field.current?.focus({ preventScroll: true });
  }, [ctx]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  const send = () => ask('question', `This number looks wrong — check it against Garmin and my history: ${ctx}${why ? `. ${why}` : ''}`, { about: ctx, flag: true })
    .then(() => { setSent(true); setMsg('Sent — the answer lands in the coach panel.'); }).catch((e) => setMsg(String(e.message ?? e)));
  return (
    <section ref={box} role="dialog" aria-labelledby="flg" className="card" style={{ borderColor: 'var(--y)', boxShadow: 'var(--sh)', borderRadius: 16, scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 id="flg" className="l" style={{ color: 'var(--y)' }}>This number looks wrong</h2>
        <button type="button" aria-label="Close" onClick={close} style={{ width: 32, height: 32, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--tx2)' }}>✕</button>
      </div>
      <div className="m" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--s2)', color: 'var(--tx2)', lineHeight: 1.7 }}>{ctx}</div>
      <label htmlFor="why" style={{ fontSize: 13, color: 'var(--tx2)' }}>What looks off? (optional)</label>
      <input ref={field} id="why" type="text" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="I did 10 reps, not 12 — and it was the rope, not the bar"
        onKeyDown={(e) => { if (e.key === 'Enter' && !sent && !offline) send(); }}
        style={{ minHeight: 44, padding: '0 12px', borderRadius: 10, border: '1px solid var(--ln2)', background: 'var(--bg)', color: 'var(--tx)', fontSize: 14 }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn" disabled={sent || offline} onClick={send}>{sent ? <><Icon d={IC.check} size={14} sw={3} />Sent</> : 'Send to coach'}</button>
        <span role={msg ? 'status' : undefined} style={{ fontSize: 12, color: 'var(--tx3)' }}>{msg ?? (offline ? 'Coach offline — start a coach session to send this.' : 'The coach checks it against Garmin and your history. Nothing changes until it answers.')}</span>
      </div>
    </section>
  );
}

function Reviews({ files }: { files: string[] }) {
  if (!files?.length) return null;
  return <>{files.map((f) => <Review key={f} file={f} />)}</>;
}

function Review({ file }: { file: string }) {
  const { data } = useView('journal-entry', file);
  if (!data) return null;
  return (
    <section className="card" style={{ borderRadius: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><h2 className="l" style={{ color: 'var(--v)' }}>Coach review</h2><span className="m" style={{ color: 'var(--tx3)' }}>{file}</span></div>
      <Markdown text={data.markdown.replace(/^# .*\n/, '')} />
    </section>
  );
}

function HrChart({ w }: { w: any }) {
  const pts: [number, number][] = w.hr;
  const s = w.summary ?? {};
  const xs = pts.map((p) => p[0]);
  const hr = pts.map((p) => p[1]);
  const left = axisFor(hr, (v) => String(Math.round(v)));
  const t1 = xs[xs.length - 1];
  // Ticks every 5, 10, 15 or 30 minutes, whichever gives four to six.
  const stepMin = [5, 10, 15, 30, 60].find((m) => t1 / (m * 60) <= 6) ?? 60;
  const xTicks = Array.from({ length: Math.floor(t1 / (stepMin * 60)) + 1 }, (_, i) => i * stepMin * 60);
  return (
    <section aria-labelledby="hr" className="card" style={{ borderRadius: 16, gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
        <h2 id="hr" className="l" style={{ color: 'var(--tx)' }}>Heart rate across the {w.group === 'strength' ? 'session' : w.group === 'run' ? 'run' : w.group === 'bike' ? 'ride' : 'workout'}</h2>
        <span className="m" style={{ color: 'var(--tx3)' }}>bpm · avg {nf(s.averageHR)} · max {nf(s.maxHR)} · x = time from the start</span>
      </div>
      <XYChart x={xs} xFmt={elapsed} xTicks={xTicks} left={left} height={170}
        series={[{ values: hr, color: 'var(--r)', axis: 'left', width: 1.6 }]}
        ariaLabel={`Heart rate across the workout: average ${nf(s.averageHR)}, peak ${nf(s.maxHR ?? Math.max(...hr))} bpm`}>
        {(_px, py) => s.averageHR ? <path d={`M0 ${py(s.averageHR, left)} H600`} style={{ stroke: 'var(--tx3)' }} strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
      </XYChart>
      {s.averageHR && <Legend items={[['Heart rate', 'var(--r)'], [`Average ${nf(s.averageHR)} bpm`, 'var(--tx3)', 'dash']]} />}
    </section>
  );
}

function Strength({ w, onFlag }: { w: any; onFlag: (ctx: string) => void }) {
  const { askAbout, state } = useStore();
  const offline = state?.coach !== 'online';
  const d: Defs = w.defs;
  const planned = new Map((w.planned?.exercises ?? []).map((e: any) => [`${e.category}/${e.name}`, e]));
  const maxSets = Math.max(1, ...w.muscles.map((m: any) => m.sets));
  return (
    <>
      <section aria-labelledby="mw" className="card" style={{ borderRadius: 16, gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 18px' }}>
          <h2 id="mw" className="l" style={{ color: 'var(--tx)' }}>Muscles worked</h2>
          <span style={{ fontSize: 12, color: 'var(--tx2)' }}>Working sets this session · share of the week’s planned sets</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: '10px 28px' }}>
          {w.muscles.map((m: any) => (
            <div key={m.muscle} style={{ display: 'grid', gridTemplateColumns: '96px 1fr 70px', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{m.muscle}</span>
              <div style={{ height: 10, borderRadius: 5, background: 'var(--s3)' }}><div style={{ height: '100%', width: `${(m.sets / maxSets) * 100}%`, borderRadius: 5, background: 'var(--o)' }} /></div>
              <span className="n" style={{ fontSize: 16, textAlign: 'right' }}>{m.sets}{m.planned_week ? <span style={{ color: 'var(--tx3)' }}> · {Math.round((m.sets / m.planned_week) * 100)}%</span> : null}</span>
            </div>
          ))}
        </div>
      </section>
      <section aria-labelledby="pvd" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '8px 18px' }}>
          <h2 id="pvd" className="l" style={{ color: 'var(--tx)' }}>Planned vs done · every set</h2>
          <span data-tip={tip(d, 'e1rm')} tabIndex={0} style={{ fontSize: 12, color: 'var(--tx2)' }}>e1RM: Epley, reps capped at 12 · warm-ups shown, not counted · tap or hover a weight for the logged value</span>
        </div>
        {!w.planned && <Empty title="Not a program day.">This session didn’t match a day of the program, so there is no prescription to compare with.</Empty>}
        {w.exercises.map((b: any, bi: number) => {
          const p: any = planned.get(b.key.join('/'));
          const working = b.sets.filter((x: any) => x.type === 'working');
          const [ic, sigLabel, sigCol] = SIG[b.signal ?? ''] ?? ['·', '—', 'var(--tx3)'];
          const hist: any[] = b.history ?? [];
          const maxTop = Math.max(1, ...hist.map((h) => h.top));
          const maxVol = Math.max(1, ...hist.map((h) => h.volume));
          const hold = isHold(p, working);
          const done = (x: any) => (hold ? x.duration_s : x.reps);
          const missed = p && working.some((x: any) => done(x) < p.value - (hold ? 5 : 2));
          return (
            <article key={bi} style={{ borderRadius: 16, border: '1px solid var(--ln)', background: 'var(--s1)' }}>
              <header style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 24px', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--ln)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 260px', minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                    <Link to={`/exercise/${b.key[0]}/${b.key[1]}`} style={{ fontSize: 19, fontWeight: 700, textDecoration: 'underline', textDecorationColor: 'var(--ln2)', textUnderlineOffset: 4 }}>{p?.routine ?? b.label}</Link>
                    <span className="m" data-tip={b.machine ? 'Logged as the plates added to the machine. No e1RM.' : b.per_hand ? 'Logged as the sum of both dumbbells; shown per hand.' : b.per_side ? 'Reps logged for both sides; shown per side.' : 'Logged as the total load.'} tabIndex={0}
                      style={{ padding: '2px 6px', borderRadius: 5, border: '1px solid var(--ln2)', color: 'var(--tx2)' }}>{b.machine ? 'plates only' : b.per_hand ? 'per hand' : b.per_side ? 'per side' : 'total weight'}</span>
                    {b.signal && <span className="l" data-tip={tip(d, b.signal === 'bump' ? 'bump' : 'progression')} tabIndex={0} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'var(--s2)', color: sigCol }}>{ic} {sigLabel}</span>}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 13 }}>
                    <span><span className="l" style={{ fontSize: 10 }}>Planned</span> <span className="n" style={{ fontSize: 16 }}>{p ? `${p.sets}×${p.value}${hold ? ' s' : ''} @ ${load(p.weight_then ?? p.weight)}` : '—'}</span></span>
                    <span><span className="l" style={{ fontSize: 10 }}>Done</span> <span className="n" style={{ fontSize: 16, color: missed ? 'var(--y)' : 'var(--tx)' }}>{working.map((x: any) => `${done(x)}${hold ? ' s' : ''}`).join(', ')} @ {load(Math.max(0, ...working.map((x: any) => x.weight)))}</span></span>
                    <span style={{ color: 'var(--tx3)' }}>{b.muscle}</span>
                  </div>
                </div>
                {hist.length > 1 && (
                  <div data-tip={rich({ t: `Last ${hist.length} sessions`, r: hist.map((h): [string, string, string] => [dshort(h.date), `${kg(h.top)} kg top · ${nf(h.volume)} kg`, 'var(--o)']), n: ['Bars: the top set. Line: the volume.'] })} tabIndex={0} style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 180 }}>
                    <span className="l" style={{ fontSize: 9 }}>Last {hist.length} · top set · volume</span>
                    <svg viewBox="0 0 180 40" width="180" height="40" aria-hidden="true">
                      {hist.map((h, i) => { const ht = Math.max(2, (h.top / maxTop) * 36); return <rect key={i} x={i * 30 + 4} y={40 - ht} width={20} height={ht} rx={2} style={{ fill: i === hist.length - 1 ? 'var(--o)' : 'var(--s3)' }} />; })}
                      <path d={hist.map((h, i) => `${i ? 'L' : 'M'}${i * 30 + 14} ${(40 - (h.volume / maxVol) * 34).toFixed(1)}`).join(' ')} fill="none" style={{ stroke: 'var(--tx)' }} strokeWidth="1.5" />
                    </svg>
                  </div>
                )}
                <button type="button" className="btn2 hv" style={{ minHeight: 36, fontSize: 12, color: 'var(--tx2)' }}
                  onClick={() => askAbout(`${p?.routine ?? b.label} · ${w.title} · ${day(w.date)}`)}>Ask about this</button>
              </header>
              <div style={{ overflowX: 'auto' }}>
                <div role="table" aria-label={`${b.label} sets`} style={{ minWidth: 760 }}>
                  <div role="row" style={{ ...setGrid, padding: '8px 20px', borderBottom: '1px solid var(--ln)' }}>
                    {['Set', 'Type', 'Planned', b.per_hand ? 'Kg / hand' : b.machine ? 'Plates' : 'Kg', hold ? 'Hold' : b.per_side ? 'Reps / side' : 'Reps', 'Time', 'Rest after', 'e1RM', 'PR', ''].map((h, i) => <span key={i} role="columnheader" className="l" style={{ fontSize: 9 }}>{h}</span>)}
                  </div>
                  {b.sets.map((x: any, i: number) => (
                    <div key={i} role="row" style={{ ...setGrid, alignItems: 'center', padding: '6px 20px', borderBottom: '1px solid var(--ln)', color: x.type === 'warmup' ? 'var(--tx3)' : 'var(--tx)' }}>
                      <span role="cell" className="n" style={{ fontSize: 16, color: 'var(--tx3)' }}>{i + 1}</span>
                      <span role="cell"><span className="l" style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, border: `1px ${x.type === 'warmup' ? 'dashed' : 'solid'} var(--ln2)` }}>{x.type === 'warmup' ? 'Warm-up' : 'Work'}</span></span>
                      <span role="cell" className="n" style={{ fontSize: 15, color: 'var(--tx3)' }}>{p && x.type === 'working' ? `${p.value}${hold ? ' s' : ''} @ ${load(p.weight_then ?? p.weight)}` : '—'}</span>
                      <span role="cell" className="n" data-tip={`Logged: ${kg(x.weight_logged)} kg${b.per_hand ? ' (both dumbbells)' : ''}`} tabIndex={0} style={{ fontSize: 18, fontWeight: 700 }}>{load(x.weight)}</span>
                      <span role="cell" className="n" style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>{hold ? `${x.duration_s} s` : x.reps}
                        {p && x.type === 'working' && done(x) < p.value && <span className="l" style={{ fontSize: 9, color: 'var(--y)' }}>{done(x) - p.value}</span>}</span>
                      <span role="cell" className="n" style={{ fontSize: 15, color: 'var(--tx2)' }}>{x.duration_s}s</span>
                      <span role="cell" className="n" style={{ fontSize: 15, color: 'var(--tx2)' }}>{x.rest_after_s ? mmss(x.rest_after_s) : '—'}</span>
                      <span role="cell" className="n" data-tip={tip(d, 'e1rm')} tabIndex={0} style={{ fontSize: 15 }}>{x.e1rm ?? '—'}</span>
                      <span role="cell">{x.pr && <span className="chip" style={{ background: 'var(--gt)', color: 'var(--g)', padding: '2px 6px', fontSize: 11 }}>PR</span>}</span>
                      <span role="cell">{x.auto_detected
                        ? <button type="button" aria-label="Named by the watch — flag it" data-tip="Named by the watch — unverified. Click to flag it to the coach." disabled={offline} onClick={() => onFlag(`${b.label}, set ${i + 1}: ${kg(x.weight_logged)} kg × ${x.reps_logged} — named by the watch`)} style={{ border: 0, background: 'transparent', color: 'var(--y)', padding: 0 }}><Icon d={IC.warn} size={14} /></button>
                        : null}</span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}

// What an annotation's type means, in words: the page never prints the code (UX review 2026-11-10).
const ANNOTATION: Record<string, string> = {
  data_error: 'logged differently from what was done', machine_change: 'a different machine', backoff: 'lighter on purpose',
  autoregulated: 'adjusted on the day', abandoned: 'session cut short', injury: 'injury', ask_not_seen: 'the new ask wasn’t on the watch yet',
};
// A hold is prescribed and logged in seconds, and a bodyweight set carries no kilos: "0 reps" and
// "@ 0" were both the watch's empty fields read as numbers (UX review 2026-11-10).
const isHold = (p: any, sets: any[]) => p?.kind === 'time' || (sets.length > 0 && sets.every((x) => !x.reps && x.duration_s));
const load = (v: number | null | undefined) => (v ? kg(v) : 'BW');

const setGrid = { display: 'grid', gridTemplateColumns: '40px 70px 110px 1fr 1fr 70px 70px 70px 50px 30px', gap: 8 } as const;

function Endurance({ w }: { w: any }) {
  const s = w.summary ?? {};
  const zones = [1, 2, 3, 4, 5].map((z) => s[`hrTimeInZone_${z}`]).filter((v) => v != null);
  const laps: any[] = w.laps ?? [];
  const lengths = laps.flatMap((l) => l.lengthDTOs ?? []);
  return (
    <>
      {w.endurance && <EndurancePanel w={w} />}
      {w.review && <SessionReview r={w.review} />}
      {zones.length === 5 && !w.endurance?.zones?.hr?.length && (
        <section className="card" style={{ borderRadius: 16 }}>
          <h2 className="l" style={{ color: 'var(--tx)' }}>Time in heart-rate zones</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {zones.map((secs, i) => {
              const max = Math.max(...zones);
              const col = ['var(--tx3)', 'var(--b)', 'var(--g)', 'var(--o)', 'var(--r)'][i];
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 60px', alignItems: 'center', gap: 10 }}>
                  <span className="m" style={{ color: 'var(--tx2)' }}>Z{i + 1}</span>
                  <div style={{ height: 10, borderRadius: 5, background: 'var(--s3)' }}><div style={{ height: '100%', width: `${(secs / max) * 100}%`, borderRadius: 5, background: col }} /></div>
                  <span className="n" style={{ fontSize: 15, textAlign: 'right' }}>{mmss(secs)}</span>
                </div>
              );
            })}
          </div>
          <span className="m" style={{ color: 'var(--tx3)' }}>Source: Garmin</span>
        </section>
      )}
      {w.stations?.length > 0 && <Stations stations={w.stations} />}
      {laps.length > 0 && !lengths.length && <Laps w={w} laps={laps} />}
      {lengths.length > 0 && <Swim laps={laps} lengths={lengths} s={s} />}
      {!laps.length && !w.stations?.length && (
        <Empty title="No laps for this session.">Garmin’s laps are pulled once per session. Sessions older than the 90-day backfill
          (pull_activities.py --days 90) have none; the summary above is complete either way.</Empty>
      )}
    </>
  );
}

/** A circuit — Hyrox, HIIT — as the watch logged it: each station in order (docs/DESIGN.md (app audit) M3). */
function Stations({ stations }: { stations: any[] }) {
  const total = stations.reduce((a, s) => a + (s.duration_s ?? 0), 0);
  const guessed = stations.filter((s) => s.auto_detected).length;
  return (
    <section aria-labelledby="stations" className="card" style={{ borderRadius: 16, gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
        <h2 id="stations" className="l" style={{ color: 'var(--tx)' }}>Stations</h2>
        <span className="m" style={{ color: 'var(--tx3)' }}>{stations.length} · {elapsed(total)} working</span>
        {guessed > 0 && <span className="chip" data-tip="Garmin’s exercise recognition named these; they weren’t confirmed on the watch. Never trust an auto-detected name." tabIndex={0}
          style={{ background: 'var(--yt)', color: 'var(--y)' }}><Icon d={IC.warn} size={12} sw={2.6} />{guessed} named by the watch — unverified</span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th className="l">#</th><th className="l">Station</th><th className="l">Time</th><th className="l">Reps</th><th className="l">Load</th></tr></thead>
          <tbody>
            {stations.map((s, i) => (
              <tr key={i}>
                <td className="m">{i + 1}</td>
                <td>{s.label}{s.auto_detected && <span style={{ color: 'var(--y)' }} title="named by the watch"> ?</span>}</td>
                <td className="n">{mmss(s.duration_s)}</td>
                <td className="n">{s.reps ?? '—'}</td>
                <td className="n">{s.weight != null ? `${kg(s.weight)} kg` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="m" style={{ color: 'var(--tx3)' }}>Source: Garmin, the sets logged on the watch</span>
    </section>
  );
}

/** What each lap is measured by: power on a bike that has it, else speed; pace on foot. */
function lapMetric(group: string, laps: any[]) {
  if (group === 'bike' && laps.some((l) => l.averagePower != null)) {
    return { label: 'Power', unit: 'W', get: (l: any) => l.averagePower ?? null, fmt: (v: number) => String(Math.round(v)), invert: false };
  }
  if (group === 'bike' || group === 'other') {
    return { label: 'Speed', unit: 'km/h', get: (l: any) => (l.averageSpeed ? l.averageSpeed * 3.6 : null), fmt: (v: number) => nf(v, 1), invert: false };
  }
  return { label: 'Pace', unit: '/km', get: (l: any) => (l.duration && l.distance ? l.duration / (l.distance / 1000) : null), fmt: mmss, invert: true };
}

function Laps({ w, laps }: { w: any; laps: any[] }) {
  const m = lapMetric(w.group, laps);
  const vals = laps.map(m.get);
  const hr = laps.map((l) => l.averageHR ?? null);
  // Lap widths in proportion to their length: distance when every lap has one, else time.
  const byDist = laps.every((l) => l.distance > 0);
  const len = laps.map((l) => (byDist ? l.distance / 1000 : l.duration ?? 0));
  const edges = len.reduce<number[]>((acc, v) => [...acc, acc[acc.length - 1] + v], [0]);
  const left = axisFor(vals, m.fmt, { invert: m.invert });
  const right = hr.some((v) => v != null) ? axisFor(hr, (v) => String(Math.round(v))) : undefined;
  const hasPower = laps.some((l) => l.averagePower != null);
  const hasCad = laps.some((l) => l.cadence != null);
  const hasElev = laps.some((l) => l.elevationGain != null);
  const cadUnit = w.group === 'bike' ? 'rpm' : 'spm';
  return (
    <section aria-labelledby="laps" className="card" style={{ borderRadius: 16, gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
        <h2 id="laps" className="l" style={{ color: 'var(--tx)' }}>Laps · {m.label.toLowerCase()} and heart rate</h2>
        <span className="m" style={{ color: 'var(--tx3)' }}>{laps.length} laps · width = {byDist ? 'distance' : 'time'}</span>
      </div>
      {laps.length > 1 && (
        <>
          <XYChart x={edges} xFmt={(v) => (byDist ? `${nf(v, v < 10 ? 1 : 0)} km` : elapsed(v))} left={left} right={right} height={170}
            ariaLabel={`${m.label} per lap with average heart rate`}
            series={right ? [{ values: [...hr, hr[hr.length - 1]], color: 'var(--r)', axis: 'right', step: true, width: 2 }] : []}>
            {(px, py) => laps.map((l, i) => {
              const v = vals[i];
              if (v == null) return null;
              const x0 = px(edges[i]) + 1;
              const x1 = px(edges[i + 1]) - 1;
              const y = py(v, left);
              return (
                <g key={i}>
                  <rect x={x0} y={y} width={Math.max(1, x1 - x0)} height={170 - y} style={{ fill: 'var(--bt)' }} />
                  <path d={`M${x0} ${y} H${x1}`} style={{ stroke: 'var(--b)' }} strokeWidth="3" vectorEffect="non-scaling-stroke" />
                  <rect x={x0} y={0} width={Math.max(1, x1 - x0)} height={170} fill="transparent" tabIndex={0}
                    data-tip={rich({ t: `Lap ${i + 1}`, r: [[m.label ?? 'Value', `${m.fmt(v)} ${m.unit}`, 'var(--b)'], ...(l.averageHR ? [['Heart rate', `${nf(l.averageHR)} bpm`, 'var(--r)'] as [string, string, string]] : []), ...(l.distance ? [['Distance', `${nf(l.distance / 1000, 2)} km`] as [string, string]] : []), ['Time', mmss(l.duration)]] })} />
                </g>
              );
            })}
          </XYChart>
          <Legend items={[[`${m.label} (${m.unit}, left${m.invert ? ', faster is higher' : ''})`, 'var(--b)'], ...(right ? [['Average heart rate (bpm, right)', 'var(--r)'] as [string, string]] : [])]} />
        </>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr>
            <th className="l">#</th><th className="l">Distance</th><th className="l">Time</th><th className="l">{m.label === 'Power' ? 'Speed' : m.label}</th>
            {hasPower && <th className="l">Power</th>}{hasCad && <th className="l">Cadence</th>}
            <th className="l">Avg HR</th><th className="l">Max HR</th>{hasElev && <th className="l">Climb</th>}
          </tr></thead>
          <tbody>
            {laps.map((l, i) => (
              <tr key={i}>
                <td className="m">{i + 1}</td>
                <td className="n">{l.distance ? `${nf(l.distance / 1000, 2)} km` : '—'}</td>
                <td className="n">{mmss(l.duration)}</td>
                <td className="n">{m.label === 'Pace' ? `${mmss(m.get(l))} /km` : l.averageSpeed ? `${nf(l.averageSpeed * 3.6, 1)} km/h` : '—'}</td>
                {hasPower && <td className="n">{l.averagePower != null ? `${Math.round(l.averagePower)} W` : '—'}{l.normalizedPower ? <span className="m" style={{ color: 'var(--tx3)' }}> NP {Math.round(l.normalizedPower)}</span> : null}</td>}
                {hasCad && <td className="n">{l.cadence != null ? `${l.cadence} ${cadUnit}` : '—'}</td>}
                <td className="n">{nf(l.averageHR)}</td>
                <td className="n">{nf(l.maxHR)}</td>
                {hasElev && <td className="n">{l.elevationGain != null ? `+${Math.round(l.elevationGain)} m` : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="m" style={{ color: 'var(--tx3)' }}>Source: Garmin laps{laps.length === 1 ? ' · one lap: the whole session (auto-lap was off)' : ''}</span>
    </section>
  );
}

function Swim({ laps, lengths, s }: { laps: any[]; lengths: any[]; s: any }) {
  const strokes = lengths.filter((l) => l.totalNumberOfStrokes).map((l) => l.totalNumberOfStrokes);
  return (
    <section className="card" style={{ borderRadius: 16 }}>
      <h2 className="l" style={{ color: 'var(--tx)' }}>Pace per 100 m</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {laps.map((l, i) => <div key={i} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--s2)', minWidth: 70 }}><span className="l" style={{ fontSize: 9 }}>#{i + 1}</span><div className="n" style={{ fontSize: 20, fontWeight: 700 }}>{mmss(l.duration / ((l.distance || 100) / 100))}</div></div>)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
        {s.averageSwolf != null && <div data-tip="SWOLF = seconds + strokes per length. Lower is more efficient.\nSource: Garmin." tabIndex={0}><span className="l">SWOLF avg</span><div className="n" style={{ fontSize: 28, fontWeight: 700 }}>{s.averageSwolf}</div></div>}
        {strokes.length > 0 && <div><span className="l">Strokes / length</span><div className="n" style={{ fontSize: 28, fontWeight: 700 }}>{nf(strokes.reduce((a, b) => a + b, 0) / strokes.length)}</div></div>}
        <div><span className="l">Lengths</span><div className="n" style={{ fontSize: 28, fontWeight: 700 }}>{s.activeLengths ?? lengths.length}</div></div>
        {s.poolLength && <div><span className="l">Pool</span><div className="n" style={{ fontSize: 28, fontWeight: 700 }}>{s.poolLength} m</div></div>}
      </div>
    </section>
  );
}

