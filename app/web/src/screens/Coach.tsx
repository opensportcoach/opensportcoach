/** Coach (board Coach): every request and its result, newest first, with live progress. */
import { Link, useLocation } from 'react-router-dom';
import { useStore, type AppRequest } from '../lib/api';
import { day, mmss, pl } from '../lib/fmt';
import { days as changes } from '../lib/proposal';
import { Empty, IC, Icon, Markdown, PageTitle } from '../components/ui';

const KIND: Record<string, string> = { question: 'Question', workflow: 'Run', plan: 'Plan request', accept: 'Accept', push: 'Watch update', confirm: 'Send to watch', checkin: 'Check-in' };
const FIND: Record<string, [string, string]> = { up: ['↑', 'var(--g)'], warn: ['!', 'var(--y)'], question: ['?', 'var(--v)'] };
const SRC: Record<string, string> = { garmin: 'Garmin', computed: 'computed', coach: 'coach' };

export default function Coach() {
  const { state, openSendToWatch } = useStore();
  const loc = useLocation();
  const reqs = [...(state?.requests ?? [])].reverse();
  const running = reqs.filter((r) => r.state === 'WORKING').length;
  const queued = reqs.filter((r) => r.state === 'QUEUED').length;
  // A #request opens scrolled to it: the layout's scroll manager (main.tsx) does it for every page.
  return (
    <>
      <PageTitle eyebrow={`Coach · ${state?.mode === 'coach' ? 'runs in your coach session on this Mac' : state?.mode === 'fixtures' ? 'mock coach (synthetic data)' : 'offline'}`} title="Requests & results"
        right={<span style={{ fontSize: 14, color: 'var(--tx2)' }}>one at a time · {running} running · {queued} queued</span>} />
      {!reqs.length && <Empty title="Nothing asked yet.">Ask from the dock on the right — questions, plans, reviews. Answers take seconds to minutes and land here.</Empty>}
      {reqs.map((r) => <Item key={r.id} r={r} highlight={loc.hash === `#${r.id}`} onSend={() => openSendToWatch(r)} />)}
    </>
  );
}

function Item({ r, highlight, onSend }: { r: AppRequest; highlight: boolean; onSend: () => void }) {
  const took = r.finishedAt ? Math.round((r.finishedAt - (r.ackedAt ?? r.createdAt)) / 1000) : Math.round((Date.now() - (r.ackedAt ?? r.createdAt)) / 1000);
  const col = r.state === 'DONE' ? 'var(--g)' : r.state === 'FAILED' ? 'var(--r)' : r.state === 'WORKING' ? 'var(--b)' : 'var(--tx3)';
  const res = r.result;
  return (
    <article id={r.id} className="card" style={{ borderColor: highlight ? 'var(--id)' : r.state === 'WORKING' ? 'var(--b)' : 'var(--ln)', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px' }}>
        <span className="l" style={{ color: col, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {r.state === 'WORKING' && <Icon className="spin" d={IC.spinner} size={12} />}{r.state === 'DONE' ? 'Done' : r.state === 'FAILED' ? 'Failed' : r.state === 'WORKING' ? 'Working' : 'Queued'}{r.state !== 'QUEUED' ? ` · ${mmss(took)}` : ''}
        </span>
        <span className="l" style={{ fontSize: 10 }}>{KIND[r.kind] ?? r.kind}{res ? ` → ${res.kind.replace('_', ' ')}` : ''}</span>
        <span className="m" style={{ color: 'var(--tx3)', marginLeft: 'auto' }}>asked {new Date(r.createdAt).toTimeString().slice(0, 5)} · {r.id}</span>
      </div>
      <span style={{ fontSize: 16, fontWeight: 600 }}>“{r.text}”</span>
      {r.state === 'QUEUED' && <span style={{ fontSize: 13, color: 'var(--tx3)' }}>Starts when the request ahead of it finishes. Requests can’t be cancelled from the app.</span>}
      {r.progress.length > 0 && r.state !== 'DONE' && (
        <div className="m" style={{ display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--tx2)' }}>
          {r.progress.map((x, i) => <span key={i}>{i === r.progress.length - 1 && r.state === 'WORKING' ? '→' : '✓'} {x}</span>)}
        </div>
      )}
      {r.error && <span style={{ fontSize: 14, color: 'var(--r)' }}>{r.error}</span>}
      {r.reply && <Markdown text={r.reply} />}
      {res?.kind === 'answer' && ((p) => <>
        <Markdown text={p.markdown} />
        {(p.facts?.length ?? 0) > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            {p.facts?.map((f, i) => <div key={i} style={{ padding: 10, borderRadius: 10, background: 'var(--s2)' }}><span className="l" style={{ fontSize: 9 }}>{f.label}</span><div className="n" style={{ fontSize: 22, fontWeight: 700 }}>{f.value}</div><span className="m" style={{ color: 'var(--tx3)' }}>{SRC[f.source]}</span></div>)}
          </div>
        )}
        {p.sources?.length > 0 && <span className="m" style={{ color: 'var(--tx3)' }}>Sources: {p.sources.map((s: any) => `${SRC[s.kind]} · ${s.text}`).join(' — ')}</span>}
      </>)(res.payload)}
      {res?.kind === 'plan_proposal' && ((p) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14 }}>{p.headline ?? p.title ?? 'Plan proposal'} · {pl(changes(p).filter((d) => d.change !== 'unchanged').length, 'change')}{p.program_changes.length ? ` · ${pl(p.program_changes.length, 'program change')}` : ''}</span>
          <Link to={`/plan/proposal/${encodeURIComponent(p.id)}`} className="btn">Review the proposal</Link>
        </div>
      ))(res.payload)}
      {res?.kind === 'push_plan' && ((p) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14 }}>{p.actions.filter((a: any) => a.verb !== 'in_sync').length} changes for {p.garmin_account} · plan <span className="m">{p.plan_hash}</span></span>
          <button type="button" className="btn" onClick={onSend}>Open the Send-to-watch card</button>
        </div>
      ))(res.payload)}
      {res?.kind === 'push_result' && ((p) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 700, color: p.ok ? 'var(--g)' : 'var(--r)' }}>{p.ok ? 'Watch in sync ✓' : 'Not all changes verified'} — {p.message}</span>
          {p.actions.map((a: any, i: number) => <span key={i} style={{ color: a.status === 'verified' ? 'var(--g)' : 'var(--r)' }}>{a.status === 'verified' ? '✓' : '✕'} {a.workout}{a.date ? ` · ${day(a.date)}` : ''}{a.error ? ` — ${a.error}` : ''}</span>)}
        </div>
      ))(res.payload)}
      {(res?.kind === 'review' || res?.kind === 'recap') && ((p: any) => <>
        {res.kind === 'recap' && !p.findings.length && <span className="n" style={{ fontSize: 24, fontWeight: 700, color: 'var(--g)' }}>No findings this week.</span>}
        {p.markdown && <Markdown text={p.markdown} />}
        {p.findings?.map((f: any, i: number) => <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 10px', borderRadius: 8, background: 'var(--s2)' }}><span className="n" style={{ color: FIND[f.kind][1], fontSize: 18, width: 14 }}>{FIND[f.kind][0]}</span><span style={{ fontSize: 14 }}>{f.text}</span></div>)}
        {p.checks && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{p.checks.map((c: any) => <span key={c.name} className="chip" style={{ background: c.ok ? 'var(--gt)' : 'var(--yt)', color: c.ok ? 'var(--g)' : 'var(--y)' }}>{c.ok ? '✓' : '!'} {c.name}</span>)}</div>}
      </>)(res.payload)}
      {res?.kind === 'endurance_review' && <span style={{ fontSize: 14 }}><b>{res.payload.verdict}</b> <Link to={`/workouts/${res.payload.activity_id}`} className="link">Open the full analysis</Link></span>}
      {res?.kind === 'daily' && <span style={{ fontSize: 14 }}>Today’s call: <b>{res.payload.recommendation.verb} · {res.payload.recommendation.title}</b> — {res.payload.recommendation.why} <Link to="/" className="link">Open Today</Link></span>}
    </article>
  );
}
