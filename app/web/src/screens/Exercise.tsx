/** One lift, all of it (board Exercise). Every number from the exercise view; the e1RM definition from the engine. */
import { Link, useParams } from 'react-router-dom';
import { useStore, useView, type Defs } from '../lib/api';
import { day, dshort, kg, nf, tip, pl } from '../lib/fmt';
import { Empty, ErrorBox, IC, Icon, Skeleton } from '../components/ui';

const STATUS: Record<string, [string, string, string]> = {
  ok: ['On track', 'var(--g)', 'Prescribed and achieved recently.'],
  watch: ['Watch', 'var(--y)', 'Missed once at this load.'],
  stale: ['Stale', 'var(--r)', 'Asked for 2+ sessions and never met.'],
  skipped: ['Skipped', 'var(--y)', 'Its day ran 2+ times since the ask and it was never done.'],
  fresh: ['New', 'var(--tx2)', 'Not tried yet at this load.'],
  no_history: ['New', 'var(--tx2)', 'First exposure — nothing to check against yet.'],
};
const LOGGED: [string, string, string][] = [
  ['total', 'Total weight', 'Bar + plates as one number. e1RM on.'],
  ['per_hand', 'Summed', 'Two dumbbells or both sides; shown per hand.'],
  ['per_side', 'Per side', 'Reps logged for both sides; shown per side.'],
  ['plates', 'Plates only', 'Machine added load. No e1RM.'],
];

export default function Exercise() {
  const { cat, name } = useParams();
  const { data: e, error, loading } = useView('exercise', `${cat}/${name}`);
  const { state, askAbout } = useStore();
  if (error) return <ErrorBox error={error} />;
  if (loading && !e) return <><Skeleton h={160} /><Skeleton h={300} /></>;
  const d: Defs = e.defs;
  const sessions: any[] = e.sessions;
  const rx = e.prescriptions[0];
  const audit = e.audit[0];
  const st = audit ? STATUS[audit.status] ?? STATUS.fresh : null;
  const trend = e.trend[0];
  const best = Math.max(0, ...sessions.map((s) => s.best_e1rm ?? 0));
  const last = sessions[sessions.length - 1];
  const name_ = rx?.routine ?? e.label;
  const plates = e.logged_as === 'plates';
  return (
    <>
      <nav aria-label="Breadcrumb" style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--tx2)' }}>
        <Link to="/strength" className="link">Strength</Link><span aria-hidden="true">/</span><span style={{ color: 'var(--tx)' }}>{name_}</span>
      </nav>
      <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px 20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="l">Exercise{rx ? ` · ${rx.day.toUpperCase()}` : ''}</span>
            <span className="m" style={{ padding: '2px 6px', borderRadius: 5, border: '1px solid var(--ln2)', color: 'var(--tx2)' }}>{LOGGED.find(([k]) => k === e.logged_as)?.[1] ?? e.logged_as}</span>
            {st && <span className="chip" data-tip={tip(d, 'audit')} tabIndex={0} style={{ background: 'var(--s2)', color: st[1] }}>{st[0]}</span>}
          </span>
          <h1 className="n" style={{ fontSize: 64, lineHeight: 0.9, fontWeight: 700 }}>{name_}</h1>
          <span style={{ fontSize: 14, color: 'var(--tx2)' }}>{e.label} · {e.muscle}</span>
        </div>
        <button type="button" className="btn2 hv" disabled={state?.coach !== 'online'} style={{ marginLeft: 'auto', minHeight: 44, borderRadius: 12, fontSize: 14 }}
          onClick={() => askAbout(`${name_} (${e.category}/${e.name})`)}><Icon d={IC.chat} size={16} sw={2} />Ask about this lift</button>
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))', gap: 1, background: 'var(--ln)', border: '1px solid var(--ln)', borderRadius: 16 }}>
        {[
          [plates ? 'Best load' : 'Best e1RM', plates ? kg(Math.max(0, ...sessions.map((s) => s.top.weight))) : nf(best, 1), 'kg', plates ? undefined : tip(d, 'e1rm')],
          ['Last top set', last ? `${kg(last.top.weight)} × ${last.top.reps}` : '—', '', undefined],
          ['Prescribed', rx ? `${rx.sets}×${rx.value} @ ${kg(rx.weight)}` : '—', rx?.per_hand ? '/ hand' : '', undefined],
          ['Trend', trend ? trend.class.toLowerCase() : '—', '', tip(d, 'progression')],
          ['Sessions', nf(sessions.length), '', undefined],
          ['Working sets', nf(sessions.reduce((a, s) => a + s.sets.length, 0)), '', undefined],
        ].map(([l, v, u, t]) => (
          <div key={l} data-tip={t} tabIndex={0} style={{ background: 'var(--s1)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="l" style={{ fontSize: 10 }}>{l}</span>
            <span className="n" style={{ fontSize: 28, lineHeight: 1, fontWeight: 700, textTransform: l === 'Trend' ? 'capitalize' : undefined }}>{v}<span style={{ fontSize: 13, color: 'var(--tx2)', fontWeight: 500 }}> {u}</span></span>
          </div>
        ))}
      </div>
      {!sessions.length ? <Empty title="Not logged yet.">The first session with this lift starts its history.</Empty> : (
        <div className="grid2">
          <E1rmChart sessions={sessions} best={best} plates={plates} defs={d} />
          <TopVolume sessions={sessions.slice(-12)} />
        </div>
      )}
      <div className="grid2">
        <section className="card">
          <h2 className="l" style={{ color: 'var(--tx)' }}>Safety check</h2>
          {Object.entries(STATUS).filter(([k]) => k !== 'no_history').map(([k, [label, col, def]]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 10, background: audit?.status === k ? 'var(--s2)' : 'transparent', border: audit?.status === k ? `1px solid ${col}` : '1px solid transparent' }}>
              <span className="l" style={{ fontSize: 10, minWidth: 70, color: col }}>{label}</span>
              <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{def}</span>
            </div>
          ))}
          {audit && (
            <span style={{ fontSize: 13, lineHeight: 1.45 }}>
              This lift: prescribed {kg(audit.weight)} kg × {audit.value} since {day(audit.since)} · {audit.sessions} session{audit.sessions === 1 ? '' : 's'}, met {audit.met}. {audit.best_e1rm ? `Implied e1RM ${audit.implied_e1rm} vs your best ${audit.best_e1rm}.` : ''}
              {audit.impossible && <b style={{ color: 'var(--r)' }}> Impossible — above anything you have lifted. The coach re-prescribes it.</b>}
            </span>
          )}
        </section>
        <section className="card">
          <h2 className="l" style={{ color: 'var(--tx)' }}>Prescription history</h2>
          {e.history.flatMap((h: any) => (h.changes ?? []).map((c: any) => ({ ...c, day: h.day }))).reverse().map((c: any, i: number) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 60px', gap: 10, alignItems: 'baseline', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--ln)' }}>
              <span className="m" style={{ color: 'var(--tx2)' }}>{dshort(c.date)}</span>
              <span className="n" style={{ fontSize: 17 }}>{kg(c.from)} <span style={{ color: 'var(--tx3)' }}>→</span> <span style={{ color: c.to > c.from ? 'var(--g)' : 'var(--y)' }}>{kg(c.to)} kg</span> × {c.reps}</span>
              <span className="m" style={{ color: 'var(--tx3)' }}>{c.day?.toUpperCase()}</span>
            </div>
          ))}
          {!e.history.some((h: any) => h.changes?.length) && <span style={{ fontSize: 13, color: 'var(--tx2)' }}>No load changes recorded yet.</span>}
          <span style={{ fontSize: 12, color: 'var(--tx3)' }}>Changes record the date and the loads; the reasons live in the coach’s logs.</span>
          <h2 className="l" style={{ color: 'var(--tx)', marginTop: 8 }}>How it’s logged</h2>
          {LOGGED.map(([k, label, def]) => (
            <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 10px', borderRadius: 10, background: e.logged_as === k ? 'var(--s2)' : 'transparent' }}>
              <span style={{ fontWeight: 700, fontSize: 13, minWidth: 90, color: e.logged_as === k ? 'var(--tx)' : 'var(--tx3)' }}>{label}{e.logged_as === k ? ' ✓' : ''}</span>
              <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{def}</span>
            </div>
          ))}
        </section>
      </div>
      <section className="card">
        <h2 className="l" style={{ color: 'var(--tx)' }}>Full set log · {pl(sessions.length, 'session')} · {pl(sessions.reduce((a, s) => a + s.sets.length, 0), 'working set')}</h2>
        {[...sessions].reverse().map((s) => (
          <div key={s.date + s.activity_id} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 110px', gap: 12, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--ln)' }}>
            <Link to={`/workouts/${s.activity_id}`} className="link" style={{ fontSize: 13 }}>{dshort(s.date)}{s.day ? ` · ${s.day.toUpperCase()}` : ''}</Link>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {s.sets.map((x: any, i: number) => <span key={i} className="n" data-tip={`Logged ${kg(x.weight_logged)} × ${x.reps_logged}`} tabIndex={0} style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--s2)', fontSize: 15 }}>{kg(x.weight)}×{x.reps}</span>)}
              {s.annotated && <span className="chip" style={{ background: 'var(--vt)', color: 'var(--v)' }}>annotated</span>}
            </span>
            <span className="n" style={{ fontSize: 15, textAlign: 'right', color: 'var(--tx2)' }}>{plates ? `vol ${nf(s.volume)}` : `e1RM ${s.best_e1rm ?? '—'}`}</span>
          </div>
        ))}
      </section>
    </>
  );
}

function E1rmChart({ sessions, best, plates, defs }: { sessions: any[]; best: number; plates: boolean; defs: Defs }) {
  const vals = sessions.map((s) => (plates ? s.top.weight : s.best_e1rm) ?? null);
  const lo = Math.min(...vals.filter((v): v is number => v != null)) * 0.95;
  const hi = Math.max(best + 8, ...vals.filter((v): v is number => v != null)) * 1.02;
  const x = (i: number) => (sessions.length < 2 ? 300 : (i * 600) / (sessions.length - 1));
  const y = (v: number) => 200 - ((v - lo) / (hi - lo)) * 200;
  let run = 0;
  const prs = vals.map((v) => { const p = v != null && v > run; if (v != null) run = Math.max(run, v); return p; });
  return (
    <section className="card">
      <h2 data-tip={plates ? 'Top added load per session (machine: no e1RM).' : tip(defs, 'e1rm')} tabIndex={0} className="l" style={{ color: 'var(--tx)' }}>{plates ? 'Top load' : 'Estimated 1RM'} · since mid-June</h2>
      <svg viewBox="0 0 600 200" width="100%" height="200" preserveAspectRatio="none" role="img" aria-label="Estimated 1RM per session">
        {!plates && <path d={`M0 ${y(best + 8).toFixed(1)} H600`} style={{ stroke: 'var(--r)' }} strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        <path d={`M0 ${y(best).toFixed(1)} H600`} style={{ stroke: 'var(--tx3)' }} strokeDasharray="2 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={vals.map((v, i) => (v == null ? '' : `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)).join(' ')} fill="none" style={{ stroke: 'var(--o)' }} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {vals.map((v, i) => v != null && <circle key={i} cx={x(i)} cy={y(v)} r={prs[i] ? 4 : 2.5} style={{ fill: prs[i] ? 'var(--g)' : 'var(--o)' }} />)}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: 'var(--tx2)' }}>
        <span><span style={{ color: 'var(--g)' }}>●</span> PR</span>
        <span>┄ lifetime best {nf(best, 1)}</span>
        {!plates && <span style={{ color: 'var(--r)' }}>┄ impossible above {nf(best + 8, 1)}</span>}
        <span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>{dshort(sessions[0].date)} → {dshort(sessions[sessions.length - 1].date)}</span>
      </div>
    </section>
  );
}

function TopVolume({ sessions }: { sessions: any[] }) {
  const maxTop = Math.max(1, ...sessions.map((s) => s.top.weight));
  const maxVol = Math.max(1, ...sessions.map((s) => s.volume));
  const w = 600 / Math.max(1, sessions.length);
  return (
    <section className="card">
      <h2 className="l" style={{ color: 'var(--tx)' }}>Top set & volume · last {sessions.length}</h2>
      <svg viewBox="0 0 600 200" width="100%" height="200" preserveAspectRatio="none" role="img" aria-label="Top set (bars) and volume (line) per session">
        {sessions.map((s, i) => { const h = Math.max(4, (s.top.weight / maxTop) * 170); return <rect key={i} x={i * w + w * 0.2} y={200 - h} width={w * 0.6} height={h} rx={3} style={{ fill: i === sessions.length - 1 ? 'var(--o)' : 'var(--s3)' }} />; })}
        <path d={sessions.map((s, i) => `${i ? 'L' : 'M'}${(i * w + w / 2).toFixed(1)} ${(200 - (s.volume / maxVol) * 180).toFixed(1)}`).join(' ')} fill="none" style={{ stroke: 'var(--tx)' }} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--tx2)' }}>
        <span>bars: top set (kg) · line: volume</span>
        <span className="m" style={{ color: 'var(--tx3)' }}>{dshort(sessions[0].date)} → {dshort(sessions[sessions.length - 1].date)}</span>
      </div>
    </section>
  );
}
