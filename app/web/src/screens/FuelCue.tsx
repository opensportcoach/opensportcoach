/**
 * The cue sheet (board Fuel-Cue, handoff 2026-11-07): what to pack and when to take it, for a planned
 * ride or run — big type for a phone on the bars, and a card that prints for the bar bag. The cues come
 * from the plan (scripts/fuel.py → plan.cues); the page only lays them out.
 */
import { Link, useSearchParams } from 'react-router-dom';
import { useView } from '../lib/api';
import { day } from '../lib/fmt';
import { Empty, ErrorBox, Icon, Skeleton } from '../components/ui';
import { Mark, hm, type FuelPlanT } from '../components/Fuel';

export default function FuelCue() {
  const [q] = useSearchParams();
  const date = q.get('date') ?? '', title = q.get('title') ?? '';
  const { data, error, loading } = useView('calendar');
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Skeleton h={480} />;
  const s = (data?.planned ?? []).find((p: any) => p.date === date && p.title === title);
  const f: FuelPlanT | undefined = s?.fuel;
  const back = <Link to="/fuel" className="link no-print" style={{ fontSize: 13 }}>Back to Fuel</Link>;
  if (!s || !f?.needed || !f.items.length) {
    return <>{back}<Empty title="No cue sheet for this session.">{!s ? 'It isn’t on the plan any more.' : 'It has no fuel plan in your products.'}</Empty></>;
  }
  const cues = f.cues ?? [];
  return (
    <>
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {back}
        <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => window.print()}><Icon d="M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z" size={14} sw={2.2} />Print</button>
      </div>
      <section aria-label={`Cue sheet · ${title}`} className="cue-print" style={{ maxWidth: 520, width: '100%', alignSelf: 'center', boxSizing: 'border-box', borderRadius: 24, border: '1px solid var(--ln)', background: 'var(--s1)', boxShadow: 'var(--sh)', padding: '22px 22px 26px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="l" style={{ fontSize: 11 }}>{day(date)} · fuel</span>
          <span className="n" style={{ fontSize: 30, lineHeight: 1.05, fontWeight: 700 }}>{title}</span>
          <span className="n" style={{ fontSize: 18, color: 'var(--tx2)' }}>{f.planned_g} g · {f.planned_g_h} g/h · {hm(f.minutes)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="l" style={{ fontSize: 10 }}>Pack</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {f.items.map((x) => (
              <span key={`${x.kind}:${x.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Mark d={x.display} w={22} h={28} mono={false} />
                <span className="n" style={{ fontSize: 26, fontWeight: 700 }}>×{x.n}</span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{x.short ?? x.label}</span>
              </span>
            ))}
          </div>
        </div>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
          {cues.map((c, i) => (
            <li key={`${c.at}${c.id}`} style={{ display: 'grid', gridTemplateColumns: '78px 30px 1fr', alignItems: 'center', gap: 12, padding: '14px 0', borderTop: i ? '1px solid var(--ln)' : 0 }}>
              <span className="n" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{hm(c.at)}</span>
              <Mark d={c.display} w={24} h={30} mono={false} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{c.label}</span>
                <span style={{ fontSize: 14, color: 'var(--tx2)' }}>{c.how}</span>
              </span>
            </li>
          ))}
        </ol>
        <span style={{ fontSize: 12, color: 'var(--tx3)' }}>From your fuel plan · computed by OpenSportCoach from each product’s label and your gut, {f.cap_g_h} g/h.</span>
      </section>
    </>
  );
}
