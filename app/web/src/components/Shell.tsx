/** Header · Sidebar · Dock — the boards' shared components (Header, Sidebar, Dock). */
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { coachOf, openRequests, useStore, useView, type AppRequest } from '../lib/api';
import { clock, day, todayIso } from '../lib/fmt';
import { IC, Icon } from './ui';
import { Logo } from './Logo';
import { useWatchSend } from './WatchSend';

export function Header() {
  const { state } = useStore();
  const today = useView('today');
  const open = openRequests(state);
  const { offline, connecting } = coachOf(state);
  const f = today.data?.freshness;
  const asOf: string | null = f?.data_as_of ?? null;
  const stale = !!asOf && (asOf.slice(0, 10) < todayIso() || (f?.warnings?.length ?? 0) > 0);
  const name = state?.display ?? '…';
  return (
    <header className="hd" style={{ boxSizing: 'border-box', width: '100%', minHeight: 72, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 24px', padding: '12px 24px', background: 'var(--bg)', borderTop: '2px solid var(--id)', borderBottom: '1px solid var(--ln)' }}>
      <NavLink to="/" aria-label="OpenSportCoach — Today" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Logo />
      </NavLink>
      <div className="hd-x" style={{ width: 1, height: 32, background: 'var(--ln)' }} />
      <div data-tip={`This app belongs to ${name}.\nGarmin account: ${state?.garmin_account ?? 'not bound'}\nTo switch athlete, quit and start a new coach session.`} tabIndex={0}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 12px 4px 4px', borderRadius: 999, background: 'var(--idt)', border: '1px solid var(--id)' }}>
        <span className="n" aria-hidden="true" style={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--id)', color: 'var(--on)', fontSize: 16, fontWeight: 700 }}>{name[0]}</span>
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{name}</span>
          <span style={{ fontSize: 12, color: 'var(--tx2)', display: 'flex', alignItems: 'center', gap: 4 }}><Icon d={IC.watch} size={12} sw={2} />Garmin · {state?.garmin_account ?? '—'}</span>
        </span>
      </div>
      <div style={{ flex: '1 1 40px' }} />
      {asOf && !stale && (
        <div data-tip={`Garmin data rebuilt ${asOf.replace('T', ' ')}. ${f?.cache ?? ''}${f?.coach_ran ? `\nCoach analysis: ${f.coach_ran.replace('T', ' ')}` : ''}`} tabIndex={0}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--tx2)' }}>
          <Icon d="M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" sw={2} />
          <span><span className="hd-long">Data as of </span><b className="n" style={{ fontSize: 15, color: 'var(--tx)' }}>{clock(asOf)}</b>{f?.coach_ran && <span className="hd-long"> · coach ran <b className="n" style={{ fontSize: 15, color: 'var(--tx)' }}>{f.coach_ran.slice(0, 10) === todayIso() ? clock(f.coach_ran) : day(f.coach_ran.slice(0, 10))}</b></span>}</span>
        </div>
      )}
      {asOf && stale && (
        <div data-tip={(f?.warnings ?? []).join('\n') || 'The data was not rebuilt today. Refresh to pull again.'} tabIndex={0}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--y)', padding: '6px 10px', border: '1px dashed var(--y)', borderRadius: 8, background: 'var(--yt)' }}>
          <Icon d={IC.warn} sw={2} />
          <span><b>Stale</b><span className="hd-long"> · data as of</span>{asOf.slice(0, 10) < todayIso() ? ` ${asOf.slice(0, 10)}` : ''} <b className="n" style={{ fontSize: 15 }}>{clock(asOf)}</b></span>
        </div>
      )}
      {connecting ? (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--ln2)', fontSize: 13, fontWeight: 600, color: 'var(--tx2)' }}>
          <Icon className="spin" d={IC.spinner} />Connecting…
        </div>
      ) : offline ? (
        <div data-tip="The coach is not running. The app is read-only until a coach session starts (scripts/coach.sh)." tabIndex={0}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, border: '1px dashed var(--ln2)', fontSize: 13, fontWeight: 600, color: 'var(--tx2)' }}>
          <Icon d={IC.offline + 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18'} sw={2} />Coach offline · read-only
        </div>
      ) : open.length || state?.status ? (
        <div data-tip={[...(state?.status ? [`Running: ${state.status.text}`] : []), ...open.map((r) => `${r.state === 'WORKING' ? 'Running' : 'Queued'}: ${r.text}`)].join('\n')} tabIndex={0}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--b)', background: 'var(--bt)', fontSize: 13, fontWeight: 600, color: 'var(--b)' }}>
          <Icon className="spin" d={IC.spinner} />{!open.length ? 'Coach analysing' : `Coach working${open.length > 1 ? ` · ${open.length - 1} queued` : ''}`}
        </div>
      ) : (
        <div data-tip="The coach session is running and accepting requests." tabIndex={0}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--ln2)', fontSize: 13, fontWeight: 600 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--g)' }} />Coach online
        </div>
      )}
      <RefreshControl />
    </header>
  );
}

/** Refresh: one state for every tab (the server's), so a refresh started by the coach or another
 * window shows here too — running with its time, then what it pulled, or why it failed. */
function RefreshControl() {
  const { state, refresh } = useStore();
  const r = state?.refresh ?? { state: 'idle' as const };
  const [, tick] = useState(0);
  const running = r.state === 'running';
  const recent = r.finishedAt != null && Date.now() - r.finishedAt < 60_000;
  useEffect(() => {
    if (!running && !recent) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [running, recent]);
  const secs = r.startedAt ? Math.round((Date.now() - r.startedAt) / 1000) : 0;
  const at = r.finishedAt ? new Date(r.finishedAt).toTimeString().slice(0, 5) : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {r.state === 'failed' && (
        <span role="alert" data-tip={`${r.error ?? 'The refresh failed.'}\nNothing was changed — the data shown is from before.`} tabIndex={0}
          style={{ maxWidth: 260, fontSize: 12, color: 'var(--r)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Refresh failed · {r.error ?? 'see the terminal'}
        </span>
      )}
      {r.state === 'done' && recent && (
        <span role="status" data-tip={`${r.summary ?? 'Refreshed'}${r.by === 'coach' ? '\nStarted by the coach.' : ''}\nEvery screen reloaded with the new data.`} tabIndex={0}
          style={{ fontSize: 12, color: 'var(--g)', whiteSpace: 'nowrap' }}>
          <Icon d={IC.check} size={12} sw={3} /> Updated {at}{r.summary ? ` · ${r.summary}` : ''}
        </span>
      )}
      <button type="button" className="btn2" disabled={running || state?.mode === undefined} aria-label={running ? 'Refreshing data' : 'Refresh data'}
        data-tip={running ? `Pulling from Garmin and rebuilding${r.by === 'coach' ? ' (started by the coach)' : ''} — usually under a minute.` : 'Pull Garmin and rebuild the data. No model involved.'}
        onClick={() => { refresh().catch(() => undefined); }}
        style={{ background: 'var(--s1)', color: 'var(--tx)' }}>
        <Icon d={IC.refresh} className={running ? 'spin' : undefined} sw={2} />
        <span className="hd-long">{running ? 'Refreshing… ' : 'Refresh data'}</span>{running ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : ''}
      </button>
    </div>
  );
}

const NAV: [string, string][] = [
  ['/', 'Today'], ['/season', 'Season · races'], ['/workouts', 'Workouts'], ['/plan', 'Plan & calendar'], ['/fuel', 'Fuel'], ['/recovery', 'Recovery & sleep'],
  ['/load', 'Training load'], ['/strength', 'Strength & progress'], ['/program', 'Program'], ['/coach', 'Coach'],
  ['/body', 'Body'], ['/about', 'About me'],
];

export function Sidebar({ theme, setTheme }: { theme: string; setTheme: (t: string) => void }) {
  const { state } = useStore();
  const today = useView('today');
  const badges: Record<string, [number, string]> = {
    '/plan': [today.data?.sync?.pending ?? 0, ' not on the watch'],
    '/coach': [openRequests(state).length, ' requests in progress'],
    // docs/DESIGN.md (fuelling and score) (board Sidebar, 2026-11-07): rides and runs that ask what was taken.
    '/fuel': [today.data?.fuel?.due?.length ?? 0, ' to log'],
  };
  return (
    <nav aria-label="Main" style={{ boxSizing: 'border-box', width: '100%', display: 'flex', flexDirection: 'column', gap: 20, padding: '20px 12px', background: 'var(--bg)', position: 'sticky', top: 0 }}>
      <div className="nav" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className="hv"
            style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: 12, minHeight: 40, whiteSpace: 'nowrap', padding: '0 12px', borderRadius: 10, fontSize: 14, fontWeight: isActive ? 700 : 500, color: isActive ? 'var(--tx)' : 'var(--tx2)', background: isActive ? 'var(--s2)' : 'transparent' })}>
            {({ isActive }) => (<>
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: isActive ? 'var(--id)' : 'transparent' }} />
              <span style={{ flex: 1 }}>{label}</span>
              {badges[to]?.[0] ? (
                <span className="n" aria-label={`${badges[to][0]}${badges[to][1]}`} style={{ minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 13, background: 'var(--s3)', color: 'var(--tx)' }}>{badges[to][0]}</span>
              ) : null}
            </>)}
          </NavLink>
        ))}
      </div>
      <div className="nav-x" style={{ borderTop: '1px solid var(--ln)', padding: '16px 12px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="l">Session</span>
        <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--tx2)' }}>This window belongs to <b style={{ color: 'var(--tx)' }}>{state?.display ?? '…'}</b>. To switch athlete, quit and start a new coach session.</span>
        {state?.mode === 'fixtures' && <span className="chip" style={{ background: 'var(--vt)', color: 'var(--v)', alignSelf: 'flex-start' }}>Synthetic demo data</span>}
        <button type="button" className="btn2" style={{ alignSelf: 'flex-start', minHeight: 32, fontSize: 12 }} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          {theme === 'light' ? 'Dark theme' : 'Light theme'}
        </button>
      </div>
    </nav>
  );
}

const QUICK: [string, string, Record<string, unknown> | undefined][] = [
  ['What should I do today?', 'question', undefined],
  ['Plan my week', 'workflow', { name: 'week' }],
  ['Review my last session', 'workflow', { name: 'review' }],
  ['Re-run today’s analysis', 'workflow', { name: 'daily' }],
];

function since(r: AppRequest) {
  const s = Math.round(((r.finishedAt ?? Date.now()) - (r.ackedAt ?? r.createdAt)) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Markdown as one line of plain text, for a preview. */
const plain = (md: string) => md.replace(/^#+\s*/gm, '').replace(/^\s*[-*]\s+/gm, '· ').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();

/** What a finished request came to, in a sentence or two: the dock's newest answer is read where it
 * was asked, not on another screen (docs/DESIGN.md (app audit) U3). */
export function outcome(r: AppRequest): string {
  if (r.state === 'FAILED') return r.error ?? 'The coach could not finish this.';
  const res = r.result;
  if (res?.kind === 'answer') return plain(res.payload.markdown);
  if (r.reply) return plain(r.reply);
  switch (res?.kind) {
    case 'daily': return `Today’s call: ${res.payload.recommendation.verb} · ${res.payload.recommendation.title}. ${res.payload.recommendation.why}`;
    case 'plan_proposal': return `A plan to review: ${res.payload.headline ?? plural(res.payload.days.length, 'day')}`.replace(/([^.!?])$/, '$1.');
    case 'push_plan': return `Ready to send ${plural(res.payload.actions.filter((a) => a.verb !== 'in_sync').length, 'change')} to the watch — confirm on the card.`;
    case 'push_result': return res.payload.ok ? `Watch in sync. ${res.payload.message}` : `Not all changes verified — ${res.payload.message}`;
    case 'review': return plain(res.payload.markdown) || res.payload.findings.map((f) => f.text).join(' · ');
    case 'recap': return res.payload.findings.length ? res.payload.findings.map((f) => f.text).join(' · ') : 'No findings this week.';
    case 'endurance_review': return res.payload.verdict;
    default: return 'Done.';
  }
}

/** Where the newest result is read (2026-10-17, the flow review): a proposal opens its review, a dry
 * run still waiting reopens its confirm card, anything else reads in full on Coach. The line used to say
 * "review on Plan" and link to Coach. */
function ResultLink({ r }: { r: AppRequest }) {
  const { openSendToWatch } = useStore();
  const watch = useWatchSend();
  const st = { alignSelf: 'flex-start' as const, fontSize: 12 };
  if (r.result?.kind === 'plan_proposal') return <Link to={`/plan/proposal/${encodeURIComponent(r.result.payload.id)}`} className="link" style={st}>Review it</Link>;
  if (r.result?.kind === 'push_plan' && watch.stage === 'ready') return (
    <button type="button" className="link" onClick={() => openSendToWatch(r)} style={{ ...st, border: 0, background: 'none', padding: 0 }}>Open the card</button>
  );
  return <Link to={`/coach#${r.id}`} className="link" style={st}>Read it all</Link>;
}

export function Dock() {
  const { state, ask, about, setAbout, askFocus, dockOpen, setDockOpen } = useStore();
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLElement>(null);
  const { online, offline } = coachOf(state);
  const open = openRequests(state);
  const working = open.find((r) => r.state === 'WORKING');
  const queued = open.filter((r) => r.state === 'QUEUED');
  const done = [...(state?.requests ?? [])].reverse().filter((r) => r.state === 'DONE' || r.state === 'FAILED').slice(0, 3);
  // "Ask about this": the box comes up where it is — the page behind it doesn't move (U2).
  useEffect(() => {
    if (!askFocus) return;
    if (panel.current) panel.current.scrollTop = 0;
    box.current?.focus({ preventScroll: true });
  }, [askFocus]);
  // Opening the panel puts the cursor in the question box. It stayed on the button, so typing went
  // nowhere and Enter closed the panel again (UX review 2026-11-10).
  useEffect(() => {
    if (!dockOpen) return;
    const id = window.setTimeout(() => box.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(id);
  }, [dockOpen]);
  const send = (kind: string, text: string, params?: Record<string, unknown>) => {
    setErr(null);
    ask(kind, text, about ? { ...params, about } : params).then(() => { setDraft(''); setAbout(null); }).catch((e) => setErr(String(e.message ?? e)));
  };
  return (
    <aside ref={panel} aria-label="Coach dock" className="dock-panel" style={{ boxSizing: 'border-box', width: '100%', display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="l" style={{ color: 'var(--tx)' }}>Coach</span>
        <span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>{offline ? 'offline' : !online ? 'connecting' : working ? `1 running · ${queued.length} queued` : queued.length ? `${queued.length} queued` : 'idle'}</span>
        <button type="button" className="dock-x hv" aria-label="Close the coach panel" onClick={() => setDockOpen(false)}
          style={{ width: 32, height: 32, border: '1px solid var(--ln)', borderRadius: 8, background: 'transparent', color: 'var(--tx2)', placeItems: 'center' }}><Icon d={IC.x} size={13} /></button>
      </div>
      {offline && (
        <div role="status" style={{ display: 'flex', gap: 10, padding: 12, borderRadius: 10, border: '1px dashed var(--ln2)', background: 'var(--s2)', fontSize: 13, lineHeight: 1.45, color: 'var(--tx2)' }}>
          <Icon d={IC.lock} size={16} sw={2} style={{ marginTop: 2 }} />
          <span><b style={{ color: 'var(--tx)' }}>Coach offline — read-only.</b> Start the coach on your Mac (scripts/coach.sh) to ask questions, accept plans or send to the watch.</span>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor="ask" className="l">Ask the coach</label>
        {about && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 10px', borderRadius: 8, background: 'var(--idt)', border: '1px solid var(--ln2)', fontSize: 12 }}>
            <Icon d={IC.clip} size={12} sw={2} /><span style={{ flex: 1 }}>About: <b>{about}</b></span>
            <button type="button" aria-label="Remove attached context" onClick={() => setAbout(null)} style={{ width: 24, height: 24, border: 0, borderRadius: 6, background: 'transparent', color: 'var(--tx2)', display: 'grid', placeItems: 'center' }}><Icon d={IC.x} size={12} /></button>
          </div>
        )}
        <textarea ref={box} id="ask" rows={3} maxLength={4000} disabled={!online} value={draft} aria-describedby="ask-hint"
          placeholder={offline ? 'Coach offline — read-only' : about ? 'Your question about it' : 'Ask your coach about training, recovery or the plan'}
          onChange={(e) => setDraft(e.target.value)}
          // Enter sends, Shift+Enter is a new line — never while an input method is composing (U5).
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (draft.trim()) send('question', draft.trim());
          }}
          style={{ boxSizing: 'border-box', width: '100%', resize: 'vertical', minHeight: 84, padding: 12, borderRadius: 10, border: '1px solid var(--ln2)', background: 'var(--bg)', color: 'var(--tx)', fontSize: 14, lineHeight: 1.4 }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span id="ask-hint" style={{ fontSize: 12, color: 'var(--tx3)', lineHeight: 1.35 }}>
            {draft.length > 3600 ? `${4000 - draft.length} characters left` : <>Enter to send · Shift+Enter for a new line</>}
          </span>
          <button type="button" className="btn" disabled={!online || !draft.trim()} onClick={() => send('question', draft.trim())}>Ask</button>
        </div>
        {err && <span role="alert" style={{ fontSize: 12, color: 'var(--r)' }}>{err}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="l">Quick actions</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
          {QUICK.map(([label, kind, params]) => (
            <button key={label} type="button" className="hv" disabled={!online} onClick={() => send(kind, label, params)}
              style={{ minHeight: 44, padding: '8px 10px', textAlign: 'left', borderRadius: 10, border: '1px solid var(--ln)', background: 'transparent', color: 'var(--tx)', fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="l">Activity</span>
          <NavLink to="/coach" className="link" style={{ fontSize: 12 }}>All requests</NavLink>
        </div>
        {working && (
          <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 12, background: 'var(--s2)', border: '1px solid var(--b)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon className="spin" d={IC.spinner} style={{ color: 'var(--b)' }} sw={2.6} />
              <span className="l" style={{ color: 'var(--b)' }}>Working</span>
              <span className="n" style={{ marginLeft: 'auto', fontSize: 15, color: 'var(--tx2)' }}>{since(working)}</span>
            </div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{working.text}</span>
            <div className="m" style={{ display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--tx2)', lineHeight: 1.5 }}>
              {working.progress.map((p, i) => (
                <span key={i} className={i === working.progress.length - 1 ? 'pulse' : undefined} style={i === working.progress.length - 1 ? { color: 'var(--tx)' } : undefined}>
                  {i === working.progress.length - 1 ? '→' : '✓'} {p}
                </span>
              ))}
            </div>
            <span style={{ fontSize: 11, color: 'var(--tx3)' }}>Keeps running while you browse. Can’t be cancelled from the app.</span>
          </div>
        )}
        {queued.map((j, i) => (
          <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, border: '1px dashed var(--ln2)' }}>
            <span className="n" aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--s3)', fontSize: 13, color: 'var(--tx2)' }}>{i + (working ? 2 : 1)}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{j.text}</span>
              <span className="l" style={{ fontSize: 10 }}>{working ? 'Queued · waits for the running request' : 'Queued · waiting for the coach'}</span>
            </span>
          </div>
        ))}
        {done.map((r, i) => {
          const ok = r.state === 'DONE';
          const status = (
            <span aria-hidden="true" style={{ width: 22, height: 22, flex: 'none', borderRadius: '50%', display: 'grid', placeItems: 'center', background: ok ? 'var(--gt)' : 'var(--rt)', color: ok ? 'var(--g)' : 'var(--r)' }}>
              <Icon d={ok ? IC.check : IC.x} size={12} sw={3} />
            </span>
          );
          const meta = <span className="l" style={{ fontSize: 10 }}>{ok ? 'Done' : 'Failed'} · {new Date(r.finishedAt ?? r.createdAt).toTimeString().slice(0, 5)} · {since(r)}</span>;
          // The newest one reads in place; older ones are a line each, opened on Coach.
          return i === 0 ? (
            <article key={r.id} aria-label={`Latest: ${r.text}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 12, border: `1px solid ${ok ? 'var(--ln2)' : 'var(--r)'}`, background: 'var(--s2)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{status}<span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{r.text}</span>{meta}</span></span>
              <p className="clamp" style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: ok ? 'var(--tx)' : 'var(--r)' }}>{outcome(r)}</p>
              <ResultLink r={r} />
            </article>
          ) : (
            <Link key={r.id} to={`/coach#${r.id}`} className="hv"
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--ln)', background: 'transparent', color: 'var(--tx)' }}>
              {status}
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.text}</span>
                {meta}
              </span>
              <span style={{ fontSize: 12, color: 'var(--tx2)' }}>Open</span>
            </Link>
          );
        })}
        {!working && !queued.length && !done.length && <span style={{ fontSize: 13, color: 'var(--tx3)' }}>Nothing asked yet.</span>}
      </div>
    </aside>
  );
}

/**
 * The coach on a narrow window (docs/DESIGN.md (app audit) U1): below 1180 px the dock is a panel this button opens,
 * instead of a column wrapped under every card. It carries what the dock would show at a glance — the
 * coach working, how many requests wait.
 */
export function CoachButton() {
  const { state, dockOpen, setDockOpen } = useStore();
  const open = openRequests(state);
  const busy = open.length > 0 || !!state?.status;
  return (
    <button type="button" className="coach-fab" aria-expanded={dockOpen} aria-controls="dock" onClick={() => setDockOpen(!dockOpen)}
      aria-label={busy ? `Coach — ${open.length ? plural(open.length, 'request') + ' in progress' : 'working'}` : 'Ask the coach'}>
      <Icon className={busy ? 'spin' : undefined} d={busy ? IC.spinner : IC.chat} size={18} sw={2.2} />
      <span className="coach-fab-word">{busy ? 'Coach working' : 'Ask the coach'}</span>
      {open.length > 0 && <span className="n" aria-hidden="true" style={{ minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 13, background: 'var(--b)', color: 'var(--on)' }}>{open.length}</span>}
    </button>
  );
}
