/** Strength & progress (board Strength). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useView, type Defs } from '../lib/api';
import { dshort, nf, tip, pl, isoDate } from '../lib/fmt';
import { Bars, Legend, TimeChart } from '../components/Chart';
import { Empty, ErrorBox, Icon, PageTitle, Skeleton } from '../components/ui';

const PALETTE = ['var(--o)', 'var(--b)', 'var(--v)', 'var(--g)', 'var(--y)', 'var(--r)'];
const CLASS_COL: Record<string, string> = { PROGRESSING: 'var(--g)', FLAT: 'var(--tx2)', STALLED: 'var(--y)', REGRESSED: 'var(--r)', '1 POINT': 'var(--tx3)' };

export default function Strength() {
  const { data: s, error, loading } = useView('strength');
  if (error) return <ErrorBox error={error} />;
  if (loading && !s) return <><Skeleton h={100} /><Skeleton h={300} /></>;
  const d: Defs = s.defs;
  const lifts: any[] = s.lifts;
  const progressing = lifts.filter((x) => x.class === 'PROGRESSING').length;
  const kl: Record<string, { date: string; e1rm: number }[]> = s.key_lifts ?? {};
  const allDates = [...new Set(Object.values(kl).flat().map((p) => p.date))].sort();
  return (
    <>
      <PageTitle eyebrow="Strength & progress" title={<span>{pl(lifts.length, 'lift')} · <span style={{ color: 'var(--g)' }}>{progressing} progressing</span></span>} />
      <div className="grid2">
        <section className="card">
          <h2 data-tip={tip(d, 'e1rm')} tabIndex={0} className="l" style={{ color: 'var(--tx)' }}>Estimated 1RM · key lifts</h2>
          {!allDates.length ? <Empty title="No key lifts logged yet.">Key lifts are set in your profile; their e1RM appears after the first session.</Empty> : (<>
            <TimeChart dates={allDates} height={200} ariaLabel="Estimated 1RM per key lift"
              // Each line carries its lift's name, so the hover reads every lift that day — not one "Value" (U13).
              series={Object.entries(kl).map(([lift, pts], i) => { const by = new Map(pts.map((p) => [p.date, p.e1rm])); let lastV: number | null = null; return { label: lift, values: allDates.map((dt) => { if (by.has(dt)) lastV = by.get(dt)!; return lastV; }), color: PALETTE[i % PALETTE.length] }; })} />
            <Legend items={Object.keys(kl).map((k, i) => [k, PALETTE[i % PALETTE.length]] as [string, string])} />
          </>)}
        </section>
        <section className="card">
          <h2 className="l" style={{ color: 'var(--tx)' }}>PR board</h2>
          {!(s.prs ?? []).length && <Empty title="No PRs yet.">A PR is marked the first time you beat an estimated 1RM.</Empty>}
          {(s.prs ?? []).map((p: any) => (
            <div key={p.lift} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--ln)' }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{p.lift}</span>
              <span className="n" style={{ fontSize: 24, fontWeight: 700 }}>{nf(p.e1rm, 1)}<span style={{ fontSize: 12, color: 'var(--tx2)' }}> kg</span></span>
              <span className="m" style={{ color: p.isRecent ? 'var(--g)' : 'var(--tx3)' }}>{dshort(p.date)}{p.isRecent ? ' · new' : ''}</span>
            </div>
          ))}
        </section>
      </div>
      <div className="grid2">
        <section className="card">
          <h2 data-tip={tip(d, 'sets_per_muscle')} tabIndex={0} className="l" style={{ color: 'var(--tx)' }}>Sets per muscle · last 7 days vs target</h2>
          {(s.volume ?? []).map((m: any) => {
            const max = Math.max(25, m.hi ?? 0, m.sets);
            const col = m.noTarget ? 'var(--tx3)' : m.sets < m.lo ? 'var(--y)' : m.sets > m.hi ? 'var(--r)' : 'var(--g)';
            return (
              <div key={m.muscle} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 40px', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{m.muscle}</span>
                <div style={{ position: 'relative', height: 14, borderRadius: 4, background: 'var(--s2)' }}>
                  {!m.noTarget && <div style={{ position: 'absolute', left: `${(m.lo / max) * 100}%`, width: `${((m.hi - m.lo) / max) * 100}%`, top: 0, bottom: 0, background: 'var(--s3)', borderLeft: '1px dashed var(--tx3)', borderRight: '1px dashed var(--tx3)' }} />}
                  <div style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: `${(m.sets / max) * 100}%`, borderRadius: 3, background: col }} />
                </div>
                <span className="n" style={{ fontSize: 16, textAlign: 'right', color: col }}>{m.sets}</span>
              </div>
            );
          })}
          <span style={{ fontSize: 12, color: 'var(--tx3)' }}>Band = your weekly target range · colour: below / in / above.</span>
        </section>
        <section className="card">
          <h2 data-tip={tip(d, 'tonnage')} tabIndex={0} className="l" style={{ color: 'var(--tx)' }}>Weekly tonnage · 16 weeks</h2>
          <Bars labels={(s.weekly ?? []).map((w: any) => `w${w.week.split('-W')[1]}`)} ariaLabel="Weekly tonnage, deload weeks marked"
            fmt={(v) => `${nf(v, v < 10 ? 1 : 0)} t`}
            stacks={[{ values: (s.weekly ?? []).map((w: any) => (w.deload ? 0 : w.tonnage / 1000)), color: 'var(--o)', label: 'Tonnage' }, { values: (s.weekly ?? []).map((w: any) => (w.deload ? w.tonnage / 1000 : 0)), color: 'var(--s3)', label: 'Tonnage · deload week' }]} />
          <Legend items={[['tonnage, t', 'var(--o)', 'box'], ['deload week', 'var(--s3)', 'box']]} />
        </section>
      </div>
      <LiftList lifts={lifts} muscles={s.muscles ?? []} classes={s.classes ?? {}} defs={d} />
    </>
  );
}

/* The lift list, grouped by the muscle the engine attributes each lift to (export_dashboard_data.muscle_of,
   the "Sets per muscle" chart's own attribution) — the app keeps no muscle map. Groups come in the order
   the engine sends (`strength.muscles`: MUSCLE_ORDER, Athletic, then Unattributed last, on purpose: it
   exposes mapping holes). Lifts with no session in six weeks sit apart in a closed group at the end. */
const STALE_DAYS = 42;
const STALE = 'Not trained lately';
const RANK: Record<string, number> = { REGRESSED: 0, STALLED: 1, PROGRESSING: 2, FLAT: 3, '1 POINT': 4 };
const ATTENTION = new Set(['STALLED', 'REGRESSED']);
const COUNTED = ['PROGRESSING', 'STALLED', 'REGRESSED'] as const;
const FILTERS = [['all', 'All'], ['attention', 'Needs attention'], ['progressing', 'Progressing']] as const;
type Filter = (typeof FILTERS)[number][0];
const K_OPEN = 'adn-strength-open';
const K_FILTER = 'adn-strength-filter';

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v == null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* a private window: the list just doesn't remember */ }
}

const keep = (f: Filter, cls: string) => f === 'all' || (f === 'attention' ? ATTENTION.has(cls) : cls === 'PROGRESSING');

function LiftList({ lifts, muscles, classes, defs }: { lifts: any[]; muscles: string[]; classes: Record<string, string>; defs: Defs }) {
  const [filter, setFilterS] = useState<Filter>(() => { const f = load<string>(K_FILTER, 'all'); return FILTERS.some(([k]) => k === f) ? (f as Filter) : 'all'; });
  const [open, setOpenS] = useState<Record<string, boolean>>(() => load(K_OPEN, {}));
  const setFilter = (f: Filter) => { setFilterS(f); save(K_FILTER, f); };
  const setOpen = (o: Record<string, boolean>) => { setOpenS(o); save(K_OPEN, o); };
  const isOpen = (g: string) => open[g] ?? g !== STALE;

  const cut = new Date(); cut.setDate(cut.getDate() - STALE_DAYS);
  const cutoff = isoDate(cut);
  const lastOf = (x: any): string => x.last ?? x.points[x.points.length - 1]?.date ?? '';
  const byGroup = new Map<string, any[]>();
  for (const x of lifts) {
    const g = lastOf(x) < cutoff ? STALE : (x.muscle ?? 'Unattributed');
    byGroup.set(g, [...(byGroup.get(g) ?? []), x]);
  }
  const order = [...muscles.filter((m) => byGroup.has(m)), ...[...byGroup.keys()].filter((g) => g !== STALE && !muscles.includes(g))];
  if (byGroup.has(STALE)) order.push(STALE);
  const groups = order.map((g) => ({ g, rows: byGroup.get(g)!.filter((x) => keep(filter, x.class)).sort((a, b) => (RANK[a.class] ?? 9) - (RANK[b.class] ?? 9)) }))
    .filter((x) => x.rows.length);
  const count = (f: Filter) => lifts.filter((x) => keep(f, x.class)).length;
  const allOpen = groups.length > 0 && groups.every(({ g }) => isOpen(g));

  return (
    <section className="card">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
        <h2 data-tip={tip(defs, 'progression')} tabIndex={0} className="l" style={{ color: 'var(--tx)' }}>Every lift · classified over its sessions</h2>
        <div role="group" aria-label="Show lifts" style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}
              style={{ border: '1px solid var(--ln2)', background: filter === k ? 'var(--tx)' : 'transparent', color: filter === k ? 'var(--on)' : 'var(--tx2)' }}>
              {label} <span className="n" style={{ opacity: 0.7 }}>{count(k)}</span>
            </button>
          ))}
          {groups.length > 1 && (
            <button type="button" className="chip" onClick={() => setOpen(Object.fromEntries(groups.map(({ g }) => [g, !allOpen])))}
              style={{ border: 0, background: 'transparent', color: 'var(--tx2)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>
      </div>
      {!groups.length ? (
        <Empty title={filter === 'attention' ? 'Nothing needs attention.' : filter === 'progressing' ? 'Nothing is progressing yet.' : 'No lifts logged yet.'}>
          {filter === 'all' ? 'Lifts appear here after their first session.' : 'Pick All to see every lift.'}
        </Empty>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table lifts">
            <thead><tr><th className="l">Lift</th><th className="l">Class</th><th className="l">Scored by</th><th className="l">Last 6</th><th className="l">Latest</th></tr></thead>
            {groups.map(({ g, rows }) => {
              const on = isOpen(g);
              const id = `lifts-${g.replace(/[^a-z]/gi, '')}`;
              return (
                <tbody key={g} id={id} data-group={g}>
                  <tr>
                    <th colSpan={5} style={{ padding: 0, background: 'var(--s2)' }}>
                      <button type="button" aria-expanded={on} aria-controls={id} onClick={() => setOpen({ ...open, [g]: !on })} className="hv"
                        data-tip={g === STALE ? 'No session in the last 6 weeks.' : g === 'Unattributed' ? 'Lifts the muscle map does not know yet — each one is a mapping hole.' : undefined}
                        style={{ width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 10px', padding: '9px 10px', border: 0, background: 'transparent', color: 'var(--tx)', textAlign: 'left', fontSize: 13 }}>
                        <Icon d="M9 6l6 6-6 6" size={12} sw={2.4} style={{ alignSelf: 'center', color: 'var(--tx2)', transform: on ? 'rotate(90deg)' : 'none' }} />
                        <span style={{ fontWeight: 700, color: g === STALE || g === 'Unattributed' ? 'var(--tx2)' : 'var(--tx)' }}>{g}</span>
                        <span className="m" style={{ color: 'var(--tx3)' }}>· {pl(rows.length, 'lift')}</span>
                        {COUNTED.map((c) => { const n = rows.filter((x) => x.class === c).length; return n ? <span key={c} className="m" style={{ color: CLASS_COL[c] }}>· {n} {c.toLowerCase()}</span> : null; })}
                      </button>
                    </th>
                  </tr>
                  {on && rows.map((x) => <LiftRow key={`${x.category}/${x.name}/${x.day ?? ''}`} x={x} />)}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
      <span style={{ fontSize: 12, color: 'var(--tx3)' }}>{Object.entries(classes).map(([k, v]) => `${String(k).toLowerCase()}: ${v}`).join(' · ')}.</span>
    </section>
  );
}

function LiftRow({ x }: { x: any }) {
  const pts = x.points.slice(-6);
  const max = Math.max(1, ...pts.map((p: any) => p.score));
  const lastP = pts[pts.length - 1];
  return (
    <tr>
      <td><Link to={`/exercise/${x.category}/${x.name}`} className="link" style={{ color: 'var(--tx)', fontSize: 14 }}>{x.label}{x.day ? ` · ${x.day.toUpperCase()}` : ''}</Link></td>
      <td><span className="l" style={{ fontSize: 10, color: CLASS_COL[x.class] }}>{x.class.toLowerCase()}</span></td>
      <td className="m" style={{ color: 'var(--tx3)' }}>{x.score}</td>
      <td><svg width="90" height="22" aria-hidden="true">{pts.map((p: any, i: number) => { const h = Math.max(2, (p.score / max) * 20); return <rect key={i} x={i * 15} y={22 - h} width={11} height={h} rx={2} style={{ fill: p.annotated ? 'var(--s3)' : CLASS_COL[x.class] }} opacity={i === pts.length - 1 ? 1 : 0.5} />; })}</svg></td>
      <td className="n" style={{ fontSize: 15 }}>{lastP.weight ? `${lastP.weight}×${lastP.reps}` : `BW×${lastP.reps}`} <span className="m" style={{ color: 'var(--tx3)' }}>{dshort(lastP.date)}</span></td>
    </tr>
  );
}
