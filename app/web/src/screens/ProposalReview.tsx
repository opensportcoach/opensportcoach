/**
 * A coach's plan proposal, reviewed (board Plan-Proposal; states waiting · accepted · requested · stale):
 * the verdict and the decision, the week now → proposed, every change with its reason and evidence, what
 * the week becomes, the rules it was checked against, and what reaches the watch.
 *
 * Reverting a change never accepts the rest: it becomes a new plan request, and the coach re-checks the
 * whole week (RACES-DATA.md, "Plan proposal").
 */
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore, useView, type AppRequest } from '../lib/api';
import { dow, dshort, hm, isoDate, nf, todayIso } from '../lib/fmt';
import { calendarEntries, type Entry } from '../lib/calendar';
import { CH, CHANGE_ORDER, EVIDENCE, SPORT, STAGE, counts, days as proposalDays, findProposal, revertPhrase, revisionText, sessionCount, shortDiff, span, spanText, sportOf, standing, wd, type Change, type ProposalDay } from '../lib/proposal';
import { kindColor, SportIcon } from '../components/SportIcon';
import { ZwiftWorkoutLine, zwiftMeta } from '../components/ZwiftWorkout';
import { CallStrip } from '../components/Races';
import { WatchSendButton } from '../components/WatchSend';
import { Empty, IC, Icon } from '../components/ui';
import type { PlanProposal } from '../contracts';

const addDays = (s: string, n: number) => isoDate(new Date(new Date(`${s}T12:00:00`).getTime() + n * 864e5));
const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5);
const asOf = (s: string) => (s.length > 10 ? `${dshort(s.slice(0, 10))} ${s.slice(11, 16)}` : dshort(s));
const took = (r: AppRequest) => {
  const s = Math.round(((r.finishedAt ?? r.createdAt) - (r.ackedAt ?? r.createdAt)) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} m ${s % 60} s` : `${s} s`;
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** A calendar entry and a proposed session are the same session: the same workout, or one name inside the other. */
const same = (e: Entry, d: ProposalDay) => {
  if (d.workout_key && e.key === d.workout_key) return true;
  const a = norm(e.title), b = norm(d.title);
  return a.length >= 4 && b.length >= 4 && (a === b || a.includes(b) || b.includes(a));
};
const NOW_WORD: Record<string, string> = { done: 'done', watch: 'on the watch', planned: 'off the watch', upcoming: 'goes on the watch', changed: 'changed · not on the watch', missed: 'not done' };
const CHIPS = ['Lighter week', 'Fewer hard days', 'Keep the week as it is now'];

const METRIC: Record<string, { n: string; c: string; fmt: (v: number) => string; tip: string }> = {
  cardio_load: { n: 'Cardio load', c: 'var(--b)', fmt: (v) => nf(v), tip: 'Planned Garmin load for the cardio sessions — an estimate. Source: coach.' },
  strength_sets: { n: 'Strength sets', c: 'var(--o)', fmt: (v) => nf(v), tip: 'Working sets across the gym days. Source: coach.' },
  hours: { n: 'Hours', c: 'var(--tx)', fmt: (v) => hm(v), tip: 'Planned session time. Source: coach.' },
  hard_days: { n: 'Hard days', c: 'var(--r)', fmt: (v) => nf(v), tip: 'Days with sprints, VO2, threshold or tests. Source: coach.' },
  benchmarks: { n: 'Benchmarks', c: 'var(--y)', fmt: (v) => nf(v), tip: 'Benchmark tests in the week. Source: coach.' },
};
const CHECK: Record<string, { s: string; c: string; i: string }> = {
  holds: { s: 'Holds', c: 'var(--g)', i: IC.check }, near_limit: { s: 'Near limit', c: 'var(--y)', i: IC.warn }, broken: { s: 'Broken', c: 'var(--r)', i: IC.x },
};

export default function ProposalReview() {
  const { id } = useParams();
  const { state } = useStore();
  const r = findProposal(state?.requests, id);
  if (!state) return null;
  if (!r || r.result?.kind !== 'plan_proposal') return (
    <Empty title="No such proposal.">
      <Link to="/plan" className="link">Back to Plan & calendar</Link>
    </Empty>
  );
  // Keyed by the request: a new version under the same id starts clean — no reverts or "sent" carried over.
  return <Review key={r.id} r={r} p={r.result.payload} />;
}

function Review({ r, p }: { r: AppRequest; p: PlanProposal }) {
  const { state: app, ask } = useStore();
  const state = app!;
  const { data: t } = useView('today');
  const { data: cal } = useView('calendar');
  const [rev, setRev] = useState<Record<string, boolean>>({});
  const [askOpen, setAskOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const st = standing(r, state.requests, t?.freshness?.data_as_of);
  const k = STAGE[st.stage];
  const ds = proposalDays(p);
  const n = counts(ds);
  const offline = state.coach !== 'online';
  const waiting = st.stage === 'waiting' && !sent;
  // Program changes sit under the session they belong to; the rest are rows of their own.
  const changed = ds.filter((d) => d.change !== 'unchanged');
  const pcOf = (d: ProposalDay) => (d.workout_key ? p.program_changes.map((c, i) => ({ c, i })).filter(({ c }) => c.workout_key === d.workout_key && changed.find((x) => x.workout_key === c.workout_key) === d) : []);
  const loose = p.program_changes.map((c, i) => ({ c, i })).filter(({ c }) => !changed.some((d) => d.workout_key === c.workout_key));
  const revKeys = Object.keys(rev).filter((x) => rev[x]);
  const phrases = revKeys.map((x) => x.startsWith('d') ? revertPhrase(ds[Number(x.slice(1))]) : (({ c }) => `keep ${c.exercise} ${c.field} at ${String(c.from)}`)({ c: p.program_changes[Number(x.slice(1))] }));
  const revNames = revKeys.map((x) => x.startsWith('d') ? ds[Number(x.slice(1))].title : p.program_changes[Number(x.slice(1))].exercise);
  const toggle = (key: string) => setRev((v) => ({ ...v, [key]: !v[key] }));
  const run = (kind: string, text: string, params: Record<string, unknown>, done: string) => {
    setErr(null);
    ask(kind, text, params).then(() => { setSent(done); setAskOpen(false); }).catch((e) => setErr(String(e.message ?? e)));
  };
  const accept = () => run('accept', `Accept plan ${p.id}`, { proposal: p.id }, 'Accepted — the coach is applying it.');
  const sendAsk = () => run('plan', revisionText(p, phrases, note), { proposal: p.id, about: `Proposal ${p.id}` }, 'Sent — the next version comes back here, checked against the same rules.');
  const recheck = () => run('plan', 'Re-check this proposal with today’s data', { proposal: p.id, about: `Proposal ${p.id}` }, 'Sent — the coach re-checks the week with today’s data.');
  const pending = (cal?.sync?.workouts ?? []).filter((w: any) => w.state === 'changed' || w.state === 'not_pushed');
  const { first } = span(ds);
  return (
    <>
      <CallStrip />
      <nav aria-label="Breadcrumb" style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--tx2)' }}>
        <Link to="/plan" className="link">Plan & calendar</Link><span aria-hidden="true">/</span><span style={{ color: 'var(--tx)' }}>Proposal · week of {dshort(first)}</span>
      </nav>

      {/* 1 · the verdict and the decision */}
      <section aria-labelledby="ph" className="rise card" style={{ borderColor: k.c === 'var(--tx3)' ? 'var(--ln2)' : k.c, padding: '22px 24px', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px' }}>
          <span className="l" style={{ color: 'var(--v)' }}>Plan proposal · from the coach</span>
          <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 7, background: k.bg, color: k.c, fontSize: 12, fontWeight: 700 }}>
            <Icon d={IC[k.icon]} size={12} sw={2.8} className={k.icon === 'spinner' ? 'spin' : undefined} />{k.word}
          </span>
          {p.version && (
            <span data-tip={`Proposal ${p.version.n} of ${p.version.of}.${p.version.note ? `\n${p.version.note}` : ''}\nSource: coach.`} tabIndex={0} className="m"
              style={{ padding: '2px 7px', borderRadius: 5, border: '1px solid var(--ln2)', color: 'var(--tx2)' }}>proposal {p.version.n} of {p.version.of}</span>
          )}
          <span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>coach · {hhmm(r.finishedAt ?? r.createdAt)} · {took(r)}{p.based_on_data_as_of ? ` · data as of ${asOf(p.based_on_data_as_of)}` : ''}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 32px', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h1 id="ph" className="n h1" style={{ margin: 0, fontSize: 46, lineHeight: 1, fontWeight: 700 }}>{p.headline ?? p.title ?? 'Plan proposal'}</h1>
            <span style={{ fontSize: 15, color: 'var(--tx2)' }}>{spanText(ds)} · <b style={{ color: 'var(--tx)' }}>{sessionCount(ds)} {sessionCount(ds) === 1 ? 'session' : 'sessions'}</b> · answers your request</span>
            <span style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 10, background: 'var(--s2)', fontSize: 14 }}>
              <Icon d={IC.chat} size={14} sw={2} style={{ color: 'var(--tx3)' }} />“{r.text}” <span className="m" style={{ color: 'var(--tx3)' }}>you · {hhmm(r.createdAt)}</span>
            </span>
          </div>
          <div role="list" aria-label="What changes" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CHANGE_ORDER.filter((c) => n[c] > 0).map((c) => (
              <span key={c} role="listitem" data-tip={`${n[c]} ${n[c] === 1 ? 'session' : 'sessions'} ${CH[c].word.toLowerCase()}. Computed by comparing the proposal with your current plan.`} tabIndex={0}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: `1px ${CH[c].bs} ${c === 'unchanged' ? CH[c].bc : 'transparent'}`, background: CH[c].bg }}>
                <span aria-hidden="true" className="n" style={{ fontSize: 18, fontWeight: 700, color: CH[c].c }}>{CH[c].i}</span>
                <span className="n" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{n[c]}</span>
                <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{CH[c].word.toLowerCase()}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Just sent: says so until the request book shows the coach on it (then that stage's banner). */}
        {sent && st.stage === 'waiting' ? <Banner c="var(--g)" bg="var(--gt)"><span role="status" style={{ fontSize: 14 }}>{sent}</span></Banner> : <>
          {st.stage === 'waiting' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', paddingTop: 14, borderTop: '1px solid var(--ln)' }}>
              {revKeys.length === 0
                ? <button type="button" className="btn" disabled={offline} onClick={accept} style={{ minHeight: 48, padding: '0 22px', fontSize: 15 }}>Accept plan</button>
                : <button type="button" className="btn" disabled={offline} onClick={() => setAskOpen(true)} style={{ minHeight: 48, padding: '0 22px', fontSize: 15 }}>Ask for changes · {revKeys.length} reverted</button>}
              <button type="button" className="btn2 hv" disabled={offline} onClick={() => setAskOpen(!askOpen)} aria-expanded={askOpen} style={{ minHeight: 48, padding: '0 18px', fontSize: 15 }}>{askOpen ? 'Close' : 'Ask for changes'}</button>
              <span style={{ fontSize: 13, color: 'var(--tx2)', flex: '1 1 260px', lineHeight: 1.4 }}>
                {revKeys.length ? 'Reverting part of a proposal goes back to the coach — the rest of the week has to be re-checked against the rules.' : 'Accepting changes the plan only. The watch is a separate step.'}
              </span>
            </div>
          )}
          {st.stage === 'applying' && (
            <Banner c="var(--g)" bg="var(--gt)">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--g)' }}><Icon d={IC.spinner} size={14} sw={2.6} className="spin" />Plan accepted · {hhmm(st.accept!.createdAt)}</span>
              <span style={{ fontSize: 14, flex: '1 1 280px' }}>The coach is applying it. Anything for the watch comes as a Send-to-watch card.</span>
            </Banner>
          )}
          {st.stage === 'accepted' && (
            <Banner c="var(--g)" bg="var(--gt)">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--g)' }}><Icon d={IC.check} size={14} sw={3} />Plan accepted · {hhmm(st.accept!.createdAt)}</span>
              {pending.length > 0 ? (<>
                <span style={{ fontSize: 14, flex: '1 1 280px' }}><b>{pending.length} {pending.length === 1 ? 'workout is' : 'workouts are'}</b> changed but not on the watch.</span>
                <WatchSendButton showNote />
              </>) : <span style={{ fontSize: 14, flex: '1 1 280px' }}>The calendar holds the week{cal?.sync?.unknown ? '.' : ', and the watch is in sync.'}</span>}
            </Banner>
          )}
          {st.stage === 'requested' && (
            <Banner c="var(--b)" bg="var(--bt)" border="1px solid var(--b)" live>
              <Icon d={IC.spinner} size={16} sw={2.6} className="spin" style={{ color: 'var(--b)' }} />
              <span style={{ fontSize: 14, flex: '1 1 280px' }}><b>A new version is being written</b> — “{st.revision!.text}”. This one stays readable until it lands.</span>
              <span className="m" style={{ color: 'var(--tx2)' }}>asked {hhmm(st.revision!.createdAt)}</span>
            </Banner>
          )}
          {st.stage === 'stale' && (
            <Banner c="var(--y)" bg="var(--yt)" border="1px dashed var(--y)" alert>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--y)' }}><Icon d={IC.warn} size={14} sw={2.6} />Out of date</span>
              <span style={{ fontSize: 14, flex: '1 1 280px' }}>Written from data as of {asOf(p.based_on_data_as_of)}; your data has moved on since{t?.freshness?.data_as_of ? ` (${asOf(t.freshness.data_as_of)})` : ''}. Accepting is off until the coach re-checks.</span>
              <button type="button" className="btn" disabled={offline} onClick={recheck}>Re-check with today’s data</button>
            </Banner>
          )}
          {st.stage === 'superseded' && (
            <Banner c="var(--tx2)" bg="var(--s2)">
              <span style={{ fontSize: 14, flex: '1 1 280px' }}>A newer proposal replaced this one — it is the one to accept.</span>
              <Link to={`/plan/proposal/${encodeURIComponent((st.newer!.result!.payload as PlanProposal).id)}`} className="btn">Open the newer proposal<Icon d={IC.arrow} /></Link>
            </Banner>
          )}
        </>}
        {err && <span role="alert" style={{ fontSize: 13, color: 'var(--r)' }}>Not sent — {err}. Try again.</span>}

        {askOpen && waiting && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 14, border: '1px solid var(--v)', background: 'var(--bg)' }}>
            <label htmlFor="chg" className="l" style={{ color: 'var(--tx)' }}>Ask for changes</label>
            {revKeys.length > 0 && <span style={{ fontSize: 13, color: 'var(--tx2)' }}>Attached: <b style={{ color: 'var(--tx)' }}>{revNames.join(' · ')}</b></span>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CHIPS.map((c) => <button key={c} type="button" className="hv" onClick={() => setNote((v) => (v ? `${v.replace(/\.?\s*$/, '.')} ${c}.` : `${c}.`))}
                style={{ minHeight: 34, padding: '0 12px', borderRadius: 999, border: '1px solid var(--ln2)', background: 'transparent', color: 'var(--tx)', fontSize: 13 }}>{c}</button>)}
            </div>
            <textarea id="chg" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should be different?"
              style={{ boxSizing: 'border-box', width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--ln2)', background: 'var(--s1)', color: 'var(--tx)', fontSize: 14, resize: 'vertical' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn" disabled={offline || (!revKeys.length && !note.trim())} onClick={sendAsk}>Send to the coach</button>
              <span style={{ fontSize: 12, color: 'var(--tx3)' }}>A new plan request — it comes back as {p.version ? `proposal ${p.version.of + 1}` : 'a new proposal'}, checked against the same rules. Seconds to minutes.</span>
            </div>
          </div>
        )}
      </section>

      {/* 2 · the week, now → proposed */}
      <Week ds={ds} p={p} cal={cal} sel={sel} rev={rev} onPick={(i) => {
        setSel(sel === i ? null : i);
        if (sel !== i) document.getElementById(`chg-d${i}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(440px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
        {/* 3 · every change, with its reason */}
        <section aria-labelledby="wy" style={{ borderRadius: 16, border: '1px solid var(--ln)', background: 'var(--s1)', minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px', padding: '16px 20px', borderBottom: '1px solid var(--ln)' }}>
            <h2 id="wy" className="l" style={{ color: 'var(--tx)' }}>Every change · and why</h2>
            {waiting && <span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>revert any — it becomes a request</span>}
          </div>
          {!changed.length && !loose.length && <div style={{ padding: '14px 20px', fontSize: 13, color: 'var(--tx2)' }}>Nothing changes — the week stays as it is.</div>}
          {changed.map((d) => (
            <ChangeRow key={d.idx} id={`chg-d${d.idx}`} change={d.change} when={wd(d.date)} title={d.title} from={d.from} to={d.to} why={d.reason}
              sel={sel === d.idx} reverted={!!rev[`d${d.idx}`]} canRevert={waiting} onRevert={() => toggle(`d${d.idx}`)}
              ev={d.evidence ?? []} extra={[
                ...(d.zwift_workout && d.change !== 'removed' ? [(
                  <span key="zw" style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', fontSize: 13 }}>
                    <ZwiftWorkoutLine w={d.zwift_workout} style={{ fontSize: 13 }} />
                    <span style={{ color: 'var(--tx2)' }}>{zwiftMeta(d.zwift_workout)}</span>
                    <a href={d.zwift_workout.url} target="_blank" rel="noopener noreferrer" className="link">its steps ↗</a>
                  </span>)] : []),
                ...pcOf(d).map(({ c, i }) => (
                  <span key={i} style={{ fontSize: 13 }}><b>{c.exercise}</b> <span className="n" style={{ fontSize: 15 }}>{String(c.from)} → {String(c.to)}</span> {c.field} <span style={{ color: 'var(--tx2)' }}>— {c.reason}</span></span>
                ))]} />
          ))}
          {loose.map(({ c, i }) => (
            <ChangeRow key={`pc${i}`} id={`chg-p${i}`} change="changed" when="Program" title={`${c.exercise} · ${c.field}`} from={String(c.from)} to={String(c.to)} why={c.reason}
              reverted={!!rev[`p${i}`]} canRevert={waiting} onRevert={() => toggle(`p${i}`)} ev={[]} />
          ))}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* 4 · what the week becomes */}
          {(p.impact ?? []).length > 0 && (
            <section aria-labelledby="im" className="card" style={{ borderRadius: 16, padding: '16px 20px', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><h2 id="im" className="l" style={{ color: 'var(--tx)' }}>What the week becomes</h2><span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>now → proposed</span></div>
              {p.impact!.map((m) => {
                const k = METRIC[m.metric];
                const mx = Math.max(m.now, m.proposed, 1) * 1.15;
                return (
                  <div key={m.metric} data-tip={m.note ?? k.tip} tabIndex={0} style={{ display: 'grid', gridTemplateColumns: '112px 1fr 104px', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: k.c }}>{k.n}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--s3)' }}><div style={{ height: '100%', width: `${(m.now / mx) * 100}%`, borderRadius: 3, background: 'var(--ln2)' }} /></div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--s3)' }}><div style={{ height: '100%', width: `${(m.proposed / mx) * 100}%`, borderRadius: 3, background: k.c }} /></div>
                    </div>
                    <span className="n" style={{ fontSize: 16, textAlign: 'right' }}><span style={{ color: 'var(--tx3)' }}>{k.fmt(m.now)} →</span> <b>{k.fmt(m.proposed)}</b></span>
                  </div>
                );
              })}
              <span style={{ fontSize: 12, color: 'var(--tx3)' }}>Cardio load and strength sets stay separate — never one number.</span>
            </section>
          )}

          {/* 5 · the rules it was checked against */}
          {(p.checks ?? []).length > 0 && (
            <section aria-labelledby="ck" className="card" style={{ borderRadius: 16, padding: '16px 20px', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 id="ck" className="l" style={{ color: 'var(--tx)' }}>Checked against the rules</h2>
                <span className="m" style={{ marginLeft: 'auto', color: p.checks!.some((c) => c.status === 'broken') ? 'var(--r)' : 'var(--g)' }}>
                  {(['holds', 'near_limit', 'broken'] as const).map((s) => [s, p.checks!.filter((c) => c.status === s).length] as const).filter(([, v]) => v)
                    .map(([s, v]) => `${v} ${s === 'holds' ? 'hold' : s === 'near_limit' ? 'near limit' : 'broken'}`).join(' · ')}
                </span>
              </div>
              {p.checks!.map((c, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 10, alignItems: 'baseline', padding: '6px 0', borderTop: '1px solid var(--ln)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: CHECK[c.status].c }}><Icon d={CHECK[c.status].i} size={11} sw={3} />{CHECK[c.status].s}</span>
                  <span style={{ fontSize: 13 }}><b>{c.rule}</b> <span style={{ color: 'var(--tx2)' }}>{c.detail}</span></span>
                </div>
              ))}
            </section>
          )}

          {/* 6 · what reaches the watch */}
          <Watch ds={ds} accepted={st.stage === 'accepted' || st.stage === 'applying'} />
        </div>
      </div>
    </>
  );
}

function Banner({ c, bg, border, live, alert, children }: { c: string; bg: string; border?: string; live?: boolean; alert?: boolean; children: ReactNode }) {
  return (
    <div role={alert ? 'alert' : undefined} aria-live={live ? 'polite' : undefined} data-c={c}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', padding: 14, borderRadius: 12, background: bg, border }}>{children}</div>
  );
}

const Glyph = ({ c, size = 18 }: { c: Change; size?: number }) => (
  <span aria-label={CH[c].word} className="n" style={{ minWidth: size, height: size, padding: '0 4px', boxSizing: 'border-box', borderRadius: Math.round(size / 3.6), display: 'grid', placeItems: 'center', flex: 'none',
    fontSize: Math.round(size * 0.66), fontWeight: 700, background: CH[c].bg, color: CH[c].c, border: `1px ${CH[c].bs} ${CH[c].bc}` }}>{CH[c].i}</span>
);

function ChangeRow({ id, change, when, title, from, to, why, ev, extra, sel, reverted, canRevert, onRevert }: {
  id: string; change: Change; when: string; title: string; from?: string | null; to?: string | null; why: string; ev: NonNullable<ProposalDay['evidence']>;
  extra?: ReactNode[]; sel?: boolean; reverted: boolean; canRevert: boolean; onRevert: () => void;
}) {
  return (
    <div id={id} style={{ display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr) auto', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--ln)', background: sel ? 'var(--s2)' : 'transparent', scrollMarginTop: 16 }}>
      <Glyph c={change} size={26} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px' }}>
          <span className="m" style={{ color: 'var(--tx3)' }}>{when}</span>
          <span style={{ fontSize: 15, fontWeight: 700, textDecoration: change === 'removed' ? 'line-through' : 'none' }}>{title}</span>
        </span>
        {(from || to) && (
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 }}>
            <span className="n" style={{ fontSize: 16, color: 'var(--tx3)', textDecoration: 'line-through' }}>{from || '—'}</span>
            <span aria-hidden="true" style={{ color: 'var(--tx3)' }}>→</span>
            <span className="n" style={{ fontSize: 17, fontWeight: 700, color: reverted ? 'var(--tx3)' : 'var(--tx)' }}>{to || '—'}</span>
          </span>
        )}
        {extra}
        <span style={{ fontSize: 13, color: 'var(--tx2)', lineHeight: 1.45 }}>{why}</span>
        {ev.length > 0 && (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {ev.map((e, i) => (
              <span key={i} data-tip={e.detail ?? `Source: ${e.source}.`} tabIndex={0} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 7px', borderRadius: 5, background: 'var(--s2)', fontSize: 11 }}>
                <span className="m" style={{ fontSize: 9, color: EVIDENCE[e.source].c }}>{EVIDENCE[e.source].word}</span><span>{e.text}</span>
              </span>
            ))}
          </span>
        )}
        {reverted && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--r)' }}>↶ you reverted this</span>}
      </div>
      {canRevert && (
        <button type="button" onClick={onRevert} aria-pressed={reverted} className="hv"
          style={{ alignSelf: 'start', minHeight: 34, padding: '0 10px', borderRadius: 9, border: `1px solid ${reverted ? 'var(--r)' : 'var(--ln2)'}`, background: reverted ? 'var(--rt)' : 'transparent', color: reverted ? 'var(--r)' : 'var(--tx)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {reverted ? '↶ Reverted · undo' : change === 'removed' ? 'Keep it' : 'Revert'}
        </button>
      )}
    </div>
  );
}

/** The week as two rows: what the calendar holds now (the calendar view), and what the proposal makes of it. */
function Week({ ds, p, cal, sel, rev, onPick }: { ds: ProposalDay[]; p: PlanProposal; cal: any; sel: number | null; rev: Record<string, boolean>; onPick: (i: number) => void }) {
  const today = todayIso();
  const { first, last } = span(ds);
  const dates: string[] = [];
  for (let d = first; d <= last && dates.length < 21; d = addDays(d, 1)) dates.push(d);
  const entries = cal ? calendarEntries(cal, today) : null;
  const col = (d: string) => dates.indexOf(d);
  const brackets = (p.checks ?? []).filter((c) => c.from && c.to && col(c.from) >= 0 && col(c.to) >= col(c.from));
  const present = CHANGE_ORDER.filter((c) => ds.some((d) => d.change === c));
  return (
    <section aria-labelledby="dw" className="rise card" style={{ animationDelay: '.05s', padding: '18px 20px 20px', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
        <h2 id="dw" className="l" style={{ color: 'var(--tx)' }}>Now → proposed</h2>
        {present.map((c) => <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tx2)' }}><Glyph c={c} />{CH[c].word}</span>)}
      </div>
      <div style={{ overflowX: 'auto', margin: '0 -4px', padding: '0 4px 6px' }}>
        <div style={{ minWidth: 72 + dates.length * 122, display: 'grid', gridTemplateColumns: `72px repeat(${dates.length}, minmax(0, 1fr))`, gap: 8 }}>
          <span />
          {dates.map((d) => (
            <div key={d} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 2px 4px', borderBottom: `2px solid ${d === today ? 'var(--tx)' : 'var(--ln)'}` }}>
              <span className="l" style={{ color: d === today ? 'var(--tx)' : 'var(--tx3)' }}>{dow(d)}{d === today ? ' · today' : ''}</span>
              <span className="n" style={{ fontSize: 15, color: 'var(--tx3)' }}>{Number(d.slice(8))}</span>
            </div>
          ))}

          {entries && <>
            <span className="l" style={{ fontSize: 10, alignSelf: 'start', paddingTop: 10 }}>Now</span>
            {dates.map((d) => {
              const es = entries(d);
              return (
                <div key={d} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {!es.length && <span style={{ padding: '7px 8px', fontSize: 12, color: 'var(--tx3)' }}>—</span>}
                  {es.map((e, i) => {
                    const removed = ds.some((x) => x.change === 'removed' && x.date === d && same(e, x));
                    const moved = ds.find((x) => x.change === 'moved' && x.from_date === d && same(e, x));
                    const noteText = removed ? 'removed' : moved ? `moves → ${wd(moved.date)}` : NOW_WORD[e.kind];
                    return (
                      <div key={i} data-tip={`Now: ${e.title} · ${noteText}.\nSource: your calendar (Garmin) and the coach’s plan.`} tabIndex={0}
                        style={{ padding: '7px 8px', borderRadius: 8, border: `1px ${removed ? 'dashed' : 'solid'} var(--ln2)`, background: 'var(--bg)', opacity: 0.85, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ color: kindColor(e.badge?.kind), display: 'inline-flex' }}><SportIcon icon={e.badge?.icon} size={10} sw={2.4} /></span>
                          <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.2, color: 'var(--tx2)', textDecoration: removed ? 'line-through' : 'none' }}>{e.title}</span>
                        </span>
                        <span className="m" style={{ fontSize: 10, color: removed ? 'var(--r)' : moved ? 'var(--b)' : 'var(--tx3)' }}>{noteText}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>}

          <span className="l" style={{ fontSize: 10, alignSelf: 'start', paddingTop: 12, color: 'var(--v)' }}>Proposed</span>
          {dates.map((d) => (
            <div key={d} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ds.filter((x) => x.date === d).map((x) => {
                const c = CH[x.change];
                const sp = SPORT[sportOf(x)];
                const kc = x.type === 'rest' ? 'var(--tx3)' : kindColor(sp.kind);
                const on = sel === x.idx;
                const r = !!rev[`d${x.idx}`];
                const quiet = x.change === 'unchanged' || x.change === 'removed';
                const diff = shortDiff(x);
                return (
                  <button key={x.idx} type="button" onClick={() => onPick(x.idx)} aria-pressed={on} className="hv"
                    data-tip={`${x.title} · ${c.word.toLowerCase()}.${x.reason ? `\n${x.reason}` : ''}`}
                    style={{ textAlign: 'left', padding: 10, borderRadius: 12, minHeight: 96, display: 'flex', flexDirection: 'column', gap: 5, color: 'var(--tx)', opacity: quiet ? 0.7 : 1,
                      border: `${on ? 2 : 1}px ${quiet ? 'dashed' : 'solid'} ${on ? 'var(--tx)' : r ? 'var(--r)' : c.bc}`, background: x.change === 'unchanged' ? 'transparent' : 'var(--bg)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, width: '100%' }}>
                      <span className="l" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9, color: kc }}>
                        {x.type === 'rest' ? 'Rest' : <><SportIcon icon={sp.icon} size={11} sw={2.4} />{sp.word}</>}
                      </span>
                      <Glyph c={x.change} />
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.15, textDecoration: x.change === 'removed' ? 'line-through' : 'none' }}>{x.title}</span>
                    {diff && <span className="n" style={{ fontSize: 13, lineHeight: 1.2, color: x.change === 'moved' ? 'var(--b)' : 'var(--tx2)' }}>{diff}</span>}
                    {x.zwift_workout && x.change !== 'removed' && <ZwiftWorkoutLine w={x.zwift_workout} style={{ fontSize: 11, maxWidth: '100%' }} />}
                    {x.benchmark && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--y)' }}>★ benchmark</span>}
                    {r && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--r)' }}>↶ you reverted this</span>}
                  </button>
                );
              })}
            </div>
          ))}

          {brackets.map((b, i) => {
            const k = CHECK[b.status];
            return (
              <div key={i} data-tip={`${b.rule} ${b.detail}\nSource: coach — checked against your standing rules.`} tabIndex={0}
                style={{ gridColumn: `${col(b.from!) + 2} / span ${col(b.to!) - col(b.from!) + 1}`, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div aria-hidden="true" style={{ height: 8, border: `1.5px solid ${k.c}`, borderTop: 0, borderRadius: '0 0 6px 6px' }} />
                <span style={{ textAlign: 'center', fontSize: 11, color: 'var(--tx2)' }}><b style={{ color: k.c }}>{b.status === 'holds' ? '✓' : '!'}</b> {b.rule}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** What reaches the watch: the proposal's watch workouts (those with a workout_key) by change. */
function Watch({ ds, accepted }: { ds: ProposalDay[]; accepted: boolean }) {
  const onWatch = ds.filter((d) => d.workout_key);
  const changes = onWatch.filter((d) => d.change === 'changed' || d.change === 'moved' || d.change === 'added').length;
  const removed = onWatch.filter((d) => d.change === 'removed');
  const stay = onWatch.filter((d) => d.change === 'unchanged').length;
  const off = ds.filter((d) => !d.workout_key && d.type !== 'rest' && d.change !== 'removed');
  return (
    <section aria-labelledby="wt" className="card" style={{ borderRadius: 16, padding: '16px 20px', gap: 8 }}>
      <h2 id="wt" className="l" style={{ color: 'var(--tx)' }}>{accepted ? 'On the watch' : 'On the watch, if you accept'}</h2>
      <span style={{ fontSize: 14, lineHeight: 1.5 }}>
        <b className="n" style={{ fontSize: 18 }}>{changes}</b> {changes === 1 ? 'workout changes' : 'workouts change'}
        {removed.length > 0 && <> · <b className="n" style={{ fontSize: 18 }}>{removed.length}</b> removed ({removed.map((d) => d.title).join(', ')})</>}
        {' · '}<b className="n" style={{ fontSize: 18 }}>{stay}</b> {stay === 1 ? 'stays' : 'stay'}.
        {' '}Accepting changes the plan only — they reach the watch through <b>Send to watch</b>, which you confirm.
      </span>
      <span style={{ fontSize: 12, color: 'var(--tx3)' }}>
        {off.length > 0 && `${off.length} ${off.length === 1 ? 'session runs' : 'sessions run'} off the watch (${off.map((d) => d.title).join(', ')}). `}Protected workouts are never touched.
      </span>
    </section>
  );
}
