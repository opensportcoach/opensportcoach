/** About me — what the coach knows (board About): the athlete's memory, typed and dated, with what enforces it. */
import { useView } from '../lib/api';
import { day, pl } from '../lib/fmt';
import { Empty, ErrorBox, IC, Icon, PageTitle, Skeleton } from '../components/ui';

const TYPE: Record<string, [string, string]> = {
  athlete: ['Goals & who you are', 'var(--id)'], medical: ['Medical', 'var(--r)'], equipment: ['Equipment', 'var(--b)'],
  preference: ['Preferences', 'var(--v)'], convention: ['How you log', 'var(--o)'], incident: ['Incidents', 'var(--y)'],
};

export default function About() {
  const { data: m, error, loading } = useView('memory');
  if (error) return <ErrorBox error={error} />;
  if (loading && !m) return <Skeleton h={300} />;
  const facts: any[] = m.facts;
  const groups = Object.keys(TYPE).map((t) => [t, facts.filter((f) => f.type === t)] as const).filter(([, fs]) => fs.length);
  return (
    <>
      <PageTitle eyebrow="About me" title="What the coach knows" right={<span style={{ fontSize: 14, color: 'var(--tx2)' }}>{pl(facts.length, 'memory', 'memories')} · changes go through the coach</span>} />
      {!facts.length && <Empty title="Nothing yet.">The coach writes what it learns at the intake — goals, injuries, equipment, preferences.</Empty>}
      {groups.map(([t, fs]) => (
        <section key={t} className="card">
          <h2 className="l" style={{ color: TYPE[t][1] }}>{TYPE[t][0]}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 10 }}>
            {fs.map((f) => (
              <article key={f.file} style={{ padding: 14, borderRadius: 12, background: 'var(--s2)', border: f.status && f.status !== 'active' ? '1px dashed var(--ln2)' : '1px solid var(--ln)', display: 'flex', flexDirection: 'column', gap: 6, opacity: f.status && f.status !== 'active' ? 0.65 : 1 }}>
                <span style={{ fontWeight: 700, fontSize: 15, display: 'flex', gap: 8, alignItems: 'center' }}>{t === 'medical' && <Icon d={IC.lock} size={14} style={{ color: 'var(--r)' }} />}{f.title}</span>
                <span className="m" style={{ color: 'var(--tx3)' }}>{f.since ? `since ${day(f.since)}` : ''}{f.source ? ` · ${f.source}` : ''}{f.status && f.status !== 'active' ? ` · ${f.status}` : ''}</span>
                {f.enforced_by && (
                  <span className="chip" data-tip={`Enforced by an automated check:\n${f.enforced_by}`} tabIndex={0} style={{ alignSelf: 'flex-start', background: 'var(--gt)', color: 'var(--g)' }}>
                    <Icon d={IC.check} size={11} sw={3} />Enforced by a check
                  </span>
                )}
                {t === 'medical' && <span style={{ fontSize: 12, color: 'var(--tx2)' }}>The coach can’t prescribe around this. Changing it is a medical decision.</span>}
              </article>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
