/** Body (board Body): weight over 120 days against the target range. */
import { useView } from '../lib/api';
import { day, nf, tip } from '../lib/fmt';
import { Legend, TimeChart } from '../components/Chart';
import { Empty, ErrorBox, IC, Icon, PageTitle, Skeleton } from '../components/ui';

export default function Body() {
  const { data: b, error, loading } = useView('body');
  if (error) return <ErrorBox error={error} />;
  if (loading && !b) return <Skeleton h={300} />;
  const last = b.latest;
  const t = b.target as [number, number] | null;
  const off = last && t ? (last.kg > t[1] ? last.kg - t[1] : last.kg < t[0] ? last.kg - t[0] : 0) : null;
  const stale = b.days_since != null && b.days_since >= 4;
  return (
    <>
      <PageTitle eyebrow="Body" title={last ? `${nf(last.kg, 1)} kg` : 'No weigh-in yet'} right={t && last && (
        <span style={{ fontSize: 15, color: off ? 'var(--y)' : 'var(--g)' }}>{off ? `${nf(Math.abs(off), 1)} kg ${off > 0 ? 'above' : 'below'}` : 'In'} target {t[0]}–{t[1]}</span>
      )} />
      <section className="card" style={{ opacity: stale ? 0.8 : 1 }}>
        <h2 data-tip={tip(b.defs, 'weight')} tabIndex={0} className="l" style={{ color: 'var(--tx)' }}>Body weight · 120 days</h2>
        {!b.series.length ? <Empty title="No weigh-ins in the last 120 days." /> : (<>
          <TimeChart dates={b.series.map((p: any) => p.date)} height={220} bandConst={t ?? undefined} yUnit="" ariaLabel="Body weight with its 7-day average and the target range"
            series={[{ values: b.series.map((p: any) => p.kg), color: 'var(--tx3)', width: 1 }, { values: b.series.map((p: any) => p.avg7), color: 'var(--tx)', width: 2.2 }]} />
          <Legend items={[['weigh-in', 'var(--tx3)'], ['7-day average', 'var(--tx)'], ...(t ? [[`target ${t[0]}–${t[1]}`, 'var(--s3)', 'box'] as [string, string, 'box']] : [])]} />
        </>)}
      </section>
      <section className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div><span className="l">Days since last weigh-in</span><div className="n" style={{ fontSize: 44, fontWeight: 700, color: stale ? 'var(--y)' : 'var(--tx)' }}>{b.days_since ?? '—'}</div></div>
        <span style={{ fontSize: 14, color: 'var(--tx2)' }}>{last ? `Last: ${day(last.date)} · ${nf(last.kg, 1)} kg · from your scale via Garmin.` : 'Step on a Garmin-connected scale to start.'}</span>
        {stale && <span className="chip" style={{ background: 'var(--yt)', color: 'var(--y)' }}><Icon d={IC.warn} size={12} />Weigh-in is {b.days_since} days old</span>}
      </section>
    </>
  );
}
