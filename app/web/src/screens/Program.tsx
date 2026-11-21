/**
 * Program (board Program v2): where the athlete goes to
 * understand and trust the program — the week, each gym day's anatomy in order with the number to
 * beat, the cardio arc and benchmarks, the balance, the rules and constraints, the history, and
 * what is on the watch. Everything comes from the `program` view (scripts/app_data.py); fields the
 * program does not declare are left out, so a new athlete's screen still reads (board Program-Sparse).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStore, useView } from '../lib/api';
import { day, dshort, kg, mmss, pl, tip, todayIso } from '../lib/fmt';
import { ErrorBox, IC, Icon, Skeleton } from '../components/ui';
import { SportIcon, kindColor } from '../components/SportIcon';
import { WatchSendButton } from '../components/WatchSend';

// Status of a prescription (prescription_audit.py) — word, icon, tint, colour, meaning.
const ST: Record<string, [string, string, string, string, string]> = {
  ok: ['OK', '✓', 'var(--gt)', 'var(--g)', 'Met at this prescription.'],
  watch: ['Watch', '!', 'var(--yt)', 'var(--y)', 'Missed once at this prescription.'],
  stale: ['Stale', '⧗', 'var(--yt)', 'var(--y)', 'Asked 2+ sessions, never met — the coach must lower or rethink it.'],
  impossible: ['Impossible', '✕', 'var(--rt)', 'var(--r)', 'Implies an e1RM more than 8 kg above your best — re-prescribe before it reaches the watch.'],
  abandoned: ['Abandoned', '–', 'var(--s3)', 'var(--tx2)', 'No session in 21+ days.'],
  skipped: ['Skipped', '↷', 'var(--yt)', 'var(--y)', 'Its day ran 2+ times since the ask and it was never done — usually the last slot, cut for time.'],
  new: ['New', '+', 'var(--s3)', 'var(--tx)', 'No history at this prescription yet.'],
  speed: ['Speed', '⚡', 'var(--s3)', 'var(--tx2)', 'Power work — judged by speed and quality, never by load.'],
};
const SYNC: Record<string, [string, string, string]> = {
  in_sync: ['In sync', 'var(--g)', IC.check], changed: ['Changed — not on the watch', 'var(--y)', IC.warn],
  not_pushed: ['Not on the watch yet', 'var(--y)', IC.warn], unknown: ['Watch status unknown', 'var(--tx3)', IC.minus],
  external: ['Runs in its app', 'var(--tx3)', IC.minus], none: ['Not a watch workout', 'var(--tx3)', IC.minus],
};
const KIND: Record<string, [string, string]> = {
  reps: ['×', 'reps — sets × top-of-range reps @ load; double progression'],
  fixed: ['×', 'fixed — one target for every set; all clean → add weight'],
  power: ['⚡', 'power — sets × count at max speed; never progressed by load'],
  time: ['⏱', 'time — sets × seconds; progresses with the week’s intensity'],
  side: ['⇄', 'time per side — sets × seconds per side; time first, then load'],
  core: ['◷', 'core — anti-movement only'],
};
const DOWS: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const STRENGTH = 'var(--o)';

const syncOf = (s: string | null | undefined, platform?: string | null): [string, string, string] =>
  s === 'external' && platform ? [`${platform[0].toUpperCase()}${platform.slice(1)} runs it`, 'var(--tx3)', IC.minus] : SYNC[s ?? 'none'] ?? SYNC.none;
// The day's short name as the athlete says it: "D2" — from a label "D2 · Pull" or "D2 Pull+Carry". Only
// a label with no such prefix falls back to the program's key, and never as "D2_PULL · D2 Pull+Carry"
// (UX review 2026-11-10).
const dayKey = (d: any) => (d.label.includes(' · ') ? d.label.split(' · ')[0] : /^D\d+\b/.exec(d.label)?.[0] ?? d.key.toUpperCase());
const dayTitle = (d: any) => String(d.title ?? '').replace(/^D\d+\s+/, '');

function status(e: any): string | null {
  const a = e.audit;
  if (!a) return e.base === 'power' ? 'speed' : null;
  if (a.impossible) return 'impossible';
  if (a.abandoned) return 'abandoned';
  return a.status === 'fresh' || a.status === 'no_history' ? 'new' : a.status;
}

function loadTxt(e: any, w = e.weight): string {
  if (w == null) return 'body weight';
  if (e.load === 'plates') return `+${kg(w)} kg plates`;
  if (e.load === 'added') return `BW +${kg(w)} kg`;
  return `${kg(w)} kg${e.per_hand ? ' / hand' : ''}`;
}

function loadTip(e: any): string {
  if (e.weight == null) return 'Body weight — no load.';
  if (e.load === 'plates') return 'Plates added on a machine. No e1RM — disc load only.';
  if (e.load === 'added') return `Body weight plus ${kg(e.weight)} kg added.`;
  if (e.per_hand) return `Per hand. Logged in Garmin as ${kg(e.weight * 2)} kg — both dumbbells.`;
  return 'Prescribed load.';
}

const rxTxt = (e: any) => `${e.sets} × ${e.value}${e.base === 'time' ? ' s' : ''}${e.per_side ? ' / side' : ''}`;
const kindOf = (e: any) => (e.per_side ? 'side' : e.phase === 'core' ? 'core' : KIND[e.base] ? e.base : 'reps');

export default function Program() {
  const { data: p, error, loading } = useView('program');
  const { state, ask, askAbout } = useStore();
  // ?day=d2 opens on that gym day's anatomy — Today's "Open D2 · Pull" lands here (docs/DESIGN.md (app audit) U6);
  // links add #anatomy, and the layout's scroll manager (main.tsx) brings it into view once it renders.
  const [params] = useSearchParams();
  const deep = params.get('day');
  const [sel, setSel] = useState<string | null>(deep);
  const [drawer, setDrawer] = useState(false);
  const [wsel, setWsel] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);
  if (error) return <ErrorBox error={error} />;
  if (loading && !p) return <><Skeleton h={140} /><Skeleton h={300} /><Skeleton h={500} /></>;
  const offline = state?.coach !== 'online';
  const days: any[] = p.days;
  const firstStarved = days.find((d) => !d.optional && d.rotation?.starved && d.rotation?.age != null);
  const cur = days.find((d) => d.key === sel) ?? firstStarved ?? days.find((d) => !d.optional) ?? days[0];
  const propose = (ctx: string) => {
    setMsg(null);
    ask('plan', `Propose a change · ${ctx}`, { about: ctx })
      .then(() => setMsg('Sent to the coach — the proposal comes back on Plan, to accept. Nothing reaches the watch without your click.'))
      .catch((e) => setMsg(String(e.message ?? e)));
  };
  const openWatch = (key: string | null) => { setWsel(key); setDrawer(true); };
  const pickDay = (key: string) => { setSel(key); document.getElementById('anatomy')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const ctx = { p, offline, askAbout, propose, openWatch };
  return (
    <>
      <BlockHeader {...ctx} onWatch={() => openWatch(null)} drawer={drawer} />
      {msg && <span role="status" style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx2)' }}>{msg}</span>}
      <Week {...ctx} cur={cur} pickDay={pickDay} />
      {cur && <Anatomy {...ctx} cur={cur} setSel={setSel} />}
      <Cardio {...ctx} />
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 16 }}>
        <Benchmarks {...ctx} />
        <Balance {...ctx} />
      </div>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 16 }}>
        <Constraint {...ctx} />
        <Rules {...ctx} />
      </div>
      <History {...ctx} />
      {drawer && <WatchDrawer {...ctx} cur={cur} wsel={wsel} setWsel={setWsel} close={() => setDrawer(false)} />}
    </>
  );
}

type Ctx = { p: any; offline: boolean; askAbout: (ctx: string) => void; propose: (ctx: string) => void; openWatch: (key: string | null) => void };

// --- 1 · block header ----------------------------------------------------------------------------
function BlockHeader({ p, offline, askAbout, propose, onWatch, drawer }: Ctx & { onWatch: () => void; drawer: boolean }) {
  const b = p.block;
  const gym = p.days.filter((d: any) => !d.optional);
  const ver = (p.versions ?? []).find((v: any) => v.id);
  const title = b ? `${b.name} block · week ${Math.min(b.week, b.weeks)}${ver ? ` · ${ver.id}` : ''}` : ver ? `Program ${ver.id}` : 'Your program';
  const sub = [pl(gym.length, 'gym day'), p.cardio && `cardio on a ${p.cardio.weeks.length}-week arc`,
    p.benchmarks.length && `benchmarks retest every ${Math.round(p.benchmarks[0].retest_days / 7)} weeks`].filter(Boolean).join(' · ');
  const next = p.benchmarks[0];
  const lastLoad = p.changes[0];
  const last = ver && (!lastLoad || ver.date >= lastLoad.date)
    ? { head: `${ver.id} · ${dshort(ver.date)}`, sub: ver.title, tip: `${ver.title}\n${ver.rationale ?? ''}\nSource: Coach.` }
    : lastLoad ? { head: `${pretty(lastLoad.name)} · ${dshort(lastLoad.date)}`, sub: `${kg(lastLoad.from)} → ${kg(lastLoad.to)} kg × ${lastLoad.reps}`, tip: 'The latest load change. Source: prescription history.' }
      : null;
  const pending = p.sync.pending;
  const about = `Program · ${title}`;
  return (
    <section aria-labelledby="blk" className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '14px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span className="l">Program{b ? ` · started ${dshort(b.start)}` : ''}{b?.over ? ' · block over' : ''}</span>
          <h1 id="blk" className="n" style={{ fontSize: 'clamp(36px, 5vw, 52px)', lineHeight: 0.95, fontWeight: 700 }}>{title}</h1>
          <span data-tip={b ? `Block ${b.name} started ${b.start}, ${b.weeks} weeks.${ver ? `\nLatest version ${ver.id}, ${ver.date}.` : ''}\nSource: Coach.` : undefined} tabIndex={b ? 0 : undefined}
            style={{ fontSize: 14, color: 'var(--tx2)' }}>{ver?.rationale ?? sub}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn2 hv" disabled={offline} onClick={() => askAbout(about)}><Icon d={IC.chat} size={15} sw={2} />Ask about this</button>
          <button type="button" className="btn2 hv" disabled={offline} onClick={() => propose('my program')}><Icon d={EDIT} size={15} sw={2} />Propose a change</button>
          <button type="button" className="btn" onClick={onWatch} aria-expanded={drawer} aria-controls="watchdrawer">
            <Icon d={IC.watch} size={15} sw={2} />Watch
            {pending > 0 && <span className="n" aria-label={`${pl(pending, 'workout')} changed — not on the watch`} style={{ minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 999, display: 'grid', placeItems: 'center', background: 'var(--y)', color: '#07090B', fontSize: 14 }}>{pending}</span>}
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1, background: 'var(--ln)', border: '1px solid var(--ln)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ background: 'var(--s1)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, flex: '2 1 380px', minWidth: 0 }}>
          {p.cardio ? (<>
            {/* A block and a cardio arc together: the block is the frame, the arc its cardio, week for week.
                When the two do not line up, the arc names its own length and the block keeps its bar. */}
            <span className="l" style={{ fontSize: 10 }}>
              {b ? `Block · week ${Math.min(b.week, b.weeks)} of ${b.weeks} · cardio arc${p.cardio.weeks.length !== b.weeks || p.cardio.start !== b.start ? ` · ${p.cardio.weeks.length} weeks` : ''}`
                : `Cardio arc · ${p.cardio.weeks.length} weeks`}{p.cardio.upcoming ? ` · starts ${dshort(p.cardio.start)}` : ''}
            </span>
            {b && (p.cardio.weeks.length !== b.weeks || p.cardio.start !== b.start) && (
              <div style={{ display: 'flex', gap: 3 }} aria-label={`Block week ${b.week} of ${b.weeks}`}>
                {Array.from({ length: b.weeks }, (_, i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < b.week - 1 ? 'var(--id)' : i === b.week - 1 ? 'var(--tx)' : 'var(--s3)' }} />)}
              </div>
            )}
            <Arc cardio={p.cardio} />
          </>) : b ? (<>
            <span className="l" style={{ fontSize: 10 }}>Block · week {Math.min(b.week, b.weeks)} of {b.weeks}</span>
            <div style={{ display: 'flex', gap: 3 }} aria-label={`Week ${b.week} of ${b.weeks}`}>
              {Array.from({ length: b.weeks }, (_, i) => <span key={i} style={{ flex: 1, height: 8, borderRadius: 4, background: i < b.week - 1 ? 'var(--id)' : i === b.week - 1 ? 'var(--tx)' : 'var(--s3)' }} />)}
            </div>
            <span style={{ fontSize: 12, color: 'var(--tx3)' }}>No cardio arc yet — the coach builds one when cardio is added.</span>
          </>) : (<>
            <span className="l" style={{ fontSize: 10 }}>Cardio arc</span>
            <span style={{ fontSize: 13, color: 'var(--tx2)' }}>No cardio arc yet — the coach builds one when cardio is added.</span>
          </>)}
        </div>
        <div data-tip={next ? `${next.name}: due ${day(next.next)}, retest every ${next.retest_days} days.\nSource: Coach.` : 'No benchmarks scheduled.'} tabIndex={0}
          style={{ background: 'var(--s1)', padding: '12px 14px', flex: '1 1 140px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="l" style={{ fontSize: 10 }}>Next benchmark</span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{next?.name ?? 'None yet'}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: next ? (next.overdue ? 'var(--r)' : 'var(--y)') : 'var(--tx3)' }}>
            <Icon d={IC.clock} size={11} sw={2.6} />{next ? `${next.overdue ? 'overdue · ' : ''}${day(next.next)}${next.last && next.last.date >= next.due ? '' : ' · not yet done'}` : 'come with a cardio arc'}
          </span>
        </div>
        <div data-tip={last?.tip ?? 'No changes recorded yet.'} tabIndex={0} style={{ background: 'var(--s1)', padding: '12px 14px', flex: '1 1 140px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="l" style={{ fontSize: 10 }}>Last change</span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{last?.head ?? 'None recorded'}</span>
          <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{last?.sub ?? ''}</span>
        </div>
        <button type="button" onClick={onWatch} className="hv" data-tip={tip(p.defs, 'watch_sync')}
          style={{ textAlign: 'left', border: 0, background: 'var(--s1)', padding: '12px 14px', flex: '1 1 140px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--tx)' }}>
          <span className="l" style={{ fontSize: 10 }}>Watch</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 700, color: pending ? 'var(--y)' : 'var(--g)' }}>
            <Icon d={pending ? IC.warn : IC.check} size={13} sw={2.8} />{pending ? `${pending} changed` : 'In sync'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{pending ? `${p.sync.workouts.filter((w: any) => w.state === 'changed' || w.state === 'not_pushed').map((w: any) => w.workout).join(' · ')} · send to watch` : 'Every workout matches the watch'}</span>
        </button>
      </div>
    </section>
  );
}

const EDIT = 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z';
const pretty = (n: string | null | undefined) => (n ?? '').replace(/_/g, ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase());

function Arc({ cardio }: { cardio: any }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cardio.weeks.length}, minmax(0, 1fr))`, gap: 4 }}>
      {cardio.weeks.map((w: any, i: number) => {
        const on = cardio.current === i;
        const what = cardio.tracks.map((t: any) => t.cells[i]?.title).filter(Boolean).join(' · ');
        return (
          <div key={w.n} data-tip={`Week ${w.n} · ${dshort(w.start)}–${dshort(w.end)}\n${what}\nSource: Coach.`} tabIndex={0}
            style={{ padding: '6px 8px', borderRadius: 8, background: on ? 'var(--s2)' : 'transparent', border: `1px solid ${on ? 'var(--tx)' : 'var(--ln)'}`, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden' }}><span className="n" style={{ fontSize: 15, fontWeight: 700 }}>Wk {w.n}</span><span className="m" style={{ fontSize: 9, color: 'var(--tx3)' }}>{dshort(w.start)}</span></span>
            <span style={{ fontSize: 11, color: 'var(--tx2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{what}</span>
          </div>
        );
      })}
    </div>
  );
}

// --- 2 · the week --------------------------------------------------------------------------------
function Week({ p, cur, pickDay, openWatch }: Ctx & { cur: any; pickDay: (k: string) => void }) {
  const byKey = new Map(p.days.map((d: any) => [d.key, d]));
  const wk = p.week;
  const empty = wk.days.every((d: any) => !d.sessions.length);
  const marks = p.rules.filter((r: any) => r.span?.length === 2);
  const legend = new Map<string, any>();
  for (const d of wk.days) for (const s of d.sessions) legend.set(s.day ? 'gym' : s.badge.sport, s.day ? { sport: 'Gym', icon: 'strength', kind: 'strength' } : s.badge);
  return (
    <section aria-labelledby="wk" className="card rise" style={{ animationDelay: '.06s' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
        <h2 id="wk" className="l" style={{ color: 'var(--tx)' }}>The week · {wk.source === 'template' ? 'template' : 'this week’s calendar'}</h2>
        {[...legend.values()].map((b) => (
          <span key={b.sport} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tx2)' }}>
            <SportIcon icon={b.icon} size={12} style={{ color: kindColor(b.kind) }} />{b.sport}
          </span>
        ))}
      </div>
      <div style={{ overflowX: 'auto', margin: '0 -4px', padding: '0 4px 6px' }}>
        <div style={{ minWidth: 770, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}>
          {wk.days.map((d: any) => (
            <div key={d.dow} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 2px 2px', borderBottom: `2px solid ${d.today ? 'var(--tx)' : 'var(--ln)'}` }}>
                <span className="l" style={{ color: d.today ? 'var(--tx)' : 'var(--tx3)' }}>{DOWS[d.dow]}</span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  {d.sessions.length > 1 && <span data-tip="Two sessions this day — morning and evening." tabIndex={0} className="l" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, border: '1px solid var(--ln2)', color: 'var(--tx2)' }}>×{d.sessions.length}</span>}
                  <span className="m" style={{ fontSize: 10, color: 'var(--tx3)' }}>{d.today ? 'today' : dshort(d.date)}</span>
                </span>
              </div>
              {!d.sessions.length && (
                <div style={{ flex: 1, minHeight: 118, boxSizing: 'border-box', padding: '10px 10px 9px', borderRadius: 12, border: '1px dashed var(--ln2)', borderTop: '3px solid var(--ln2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="l" style={{ fontSize: 9, color: 'var(--tx3)' }}>{wk.source === 'template' ? 'Rest' : 'Open'}</span>
                  <span style={{ fontSize: 12, color: 'var(--tx3)' }}>{wk.source === 'template' ? 'No session' : 'Nothing planned'}</span>
                </div>
              )}
              {d.sessions.map((s: any, i: number) => {
                const g: any = s.day ? byKey.get(s.day) : null;
                const selected = g && g.key === cur?.key;
                const col = s.day ? STRENGTH : kindColor(s.badge.kind);
                const watchKey = s.day ?? s.workout;
                const [sy, syC, syI] = syncOf(s.sync, s.platform);
                const rot = g?.rotation;
                const body = (<>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, width: '100%' }}>
                    <span className="l" style={{ fontSize: 9, color: s.day ? STRENGTH : 'var(--tx2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <SportIcon icon={s.day ? 'strength' : s.badge.icon} size={11} style={{ color: col }} />{g ? `Gym · ${dayKey(g)}` : s.badge.sport}
                    </span>
                    <span className="m" style={{ fontSize: 9, color: 'var(--tx3)' }}>{s.slot ?? ''}</span>
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.15 }}>{s.title}</span>
                  {(s.detail || g) && <span className="n" style={{ fontSize: 14, color: 'var(--tx2)', lineHeight: 1.2 }}>{s.detail ?? g.exercises.filter((e: any) => e.phase === 'power' || e.phase === 'strength').slice(0, 2).map((e: any) => e.routine ?? e.label).join(' · ')}</span>}
                  <span style={{ marginTop: 'auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 4, width: '100%', paddingTop: 4 }}>
                    {s.duration && <span data-tip={g ? tip(p.defs, 'est_time') : 'Planned duration.\nSource: Coach.'} tabIndex={0} className="n" style={{ fontSize: 14, color: 'var(--tx3)' }}>{s.duration}</span>}
                    {rot && <RotChip r={rot} small />}
                  </span>
                  {s.sync !== 'none' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: syC }}><Icon d={syI} size={10} sw={3} />{sy}</span>}
                </>);
                const style = {
                  textAlign: 'left' as const, flex: d.sessions.length === 1 ? 1 : undefined, minHeight: d.sessions.length === 1 ? 244 : 118, boxSizing: 'border-box' as const,
                  display: 'flex', flexDirection: 'column' as const, gap: 4, padding: '10px 10px 9px', borderRadius: 12, color: 'var(--tx)',
                  background: selected ? 'var(--s2)' : 'var(--bg)', border: `${selected ? 2 : 1}px solid ${selected ? STRENGTH : 'var(--ln2)'}`, borderTop: `3px solid ${col}`,
                };
                return g ? <button key={i} type="button" className="hv" aria-pressed={selected} onClick={() => pickDay(g.key)} style={style}>{body}</button>
                  : watchKey ? <button key={i} type="button" className="hv" onClick={() => openWatch(watchKey)} style={style}>{body}</button>
                    : <div key={i} style={style}>{body}</div>;
              })}
            </div>
          ))}
          {marks.map((k: any) => {
            const a = Object.keys(DOWS).indexOf(k.span[0]);
            const b = Object.keys(DOWS).indexOf(k.span[1]);
            if (a < 0 || b < a) return null;
            const c = k.badge ? kindColor(k.badge.kind) : STRENGTH;
            return (
              <div key={k.label} data-tip={`${k.label}\n${k.detail}\nSource: Coach.`} tabIndex={0} style={{ gridColumn: `${a + 1} / span ${b - a + 1}`, display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                <div aria-hidden="true" style={{ height: 8, border: `1.5px solid ${c}`, borderTop: 0, borderRadius: '0 0 6px 6px' }} />
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, color: 'var(--tx2)', textAlign: 'center' }}>
                  <span className="n" style={{ fontSize: 14, fontWeight: 700, color: c }}>{k.mark ?? k.key}</span>{k.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 10px', paddingTop: 10, borderTop: '1px solid var(--ln)' }}>
        {p.floor.length > 0 && <span className="l" style={{ fontSize: 10 }}>Weekly floor</span>}
        {p.floor.map((f: any) => {
          const ok = f.planned >= f.min;
          return (
            <span key={f.sport} data-tip={`Weekly floor: at least ${f.min} ${f.label.toLowerCase()}. Planned: ${f.planned}.\nSource: Coach.`} tabIndex={0}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 6, background: ok ? 'var(--gt)' : 'var(--yt)', color: ok ? 'var(--g)' : 'var(--y)', fontSize: 12, fontWeight: 600 }}>
              <Icon d={ok ? IC.check : IC.warn} size={11} sw={3} />{f.label} {f.planned} / {f.min}
            </span>
          );
        })}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--tx3)' }}>
          {wk.source === 'template' ? 'A template — the coach rewrites each day from HRV, readiness and how you feel. A starved day outranks it.'
            : empty ? 'No weekly template yet, and nothing on this week’s calendar. Ask the coach to plan the week.'
              : 'No weekly template yet — this is what this week’s calendar holds. Ask the coach to plan the rest.'}
        </span>
      </div>
    </section>
  );
}

function RotChip({ r, small }: { r: any; small?: boolean }) {
  const [txt, ic, bg, c, t] = r.age == null ? ['no history', '+', 'var(--s3)', 'var(--tx2)', 'No session of this day in the window.']
    : r.starved ? [`${r.age} d · starved`, '!', 'var(--rt)', 'var(--r)', `${r.age} days since this day was trained. Starved after 7 — a starved day outranks the template.`]
      : [`${r.age} d ago`, '✓', 'var(--s3)', 'var(--tx2)', `${r.age} days since this day was trained. Starved after 7.`];
  return (
    <span data-tip={`${t}\nSource: Computed by OpenSportCoach.`} tabIndex={0}
      style={{ display: 'inline-flex', alignItems: 'center', gap: small ? 3 : 4, fontSize: small ? 10 : 12, fontWeight: 700, padding: small ? '1px 5px' : '2px 7px', borderRadius: small ? 5 : 6, background: bg, color: c }}>
      <span aria-hidden="true">{ic}</span>{txt}
    </span>
  );
}

// --- 3 · session anatomy -------------------------------------------------------------------------
const GRID = '30px minmax(190px, 1.5fr) 130px minmax(180px, 1.3fr) 70px 118px 32px';

function Anatomy({ p, cur, setSel, offline, askAbout, propose }: Ctx & { cur: any; setSel: (k: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(true);
  const all: any[] = [...cur.lead, ...cur.exercises];
  const phases: { key: string; s: number; list: string[] }[] = [];
  for (const e of all) {
    const last = phases[phases.length - 1];
    if (!last || last.key !== e.phase) phases.push({ key: e.phase, s: 0, list: [] });
    phases[phases.length - 1].s += e.est_s;
    phases[phases.length - 1].list.push(e.routine ?? e.label);
  }
  const label = (k: string) => p.phases.find((x: any) => x.key === k)?.label ?? k;
  const total = cur.est_min;
  const cap = p.cap_min;
  const span = Math.max(total, cap ?? 0) * 1.07 || 1;
  const when = p.week.days.flatMap((d: any) => d.sessions.filter((s: any) => s.day === cur.key).map((s: any) => `${DOWS[d.dow]}${s.slot ? ` ${s.slot}` : ''}`));
  const sync = p.sync.workouts.find((w: any) => w.key === cur.key);
  const [sy, syC, syI] = syncOf(sync?.state ?? 'none');
  const ghostsAfter = (exid: string | null) => (showRemoved ? cur.removed.filter((r: any) => (r.after ?? null) === exid) : []);
  let idx = 0;
  let lastPhase: string | null = null;
  const rows: ReactNode[] = [];
  const ghost = (r: any) => {
    const med = r.removed_in === 'medical';
    rows.push(
      <div key={`g-${r.name}`} role="row" style={{ display: 'grid', gridTemplateColumns: '30px minmax(190px, 1.5fr) 1fr', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 10, border: '1px dashed var(--ln2)', margin: '2px 0', opacity: 0.75 }}>
        <span role="cell" aria-hidden="true" style={{ color: 'var(--tx3)', display: 'grid', placeItems: 'center' }}><Icon d={med ? IC.lock : SWAP} size={13} sw={2.2} /></span>
        <span role="cell" style={{ fontSize: 14, fontWeight: 600, color: 'var(--tx3)', textDecoration: 'line-through' }}>{r.name}</span>
        <span role="cell" style={{ fontSize: 12, color: 'var(--tx2)' }}>
          <b className="l" style={{ fontSize: 9, color: med ? 'var(--r)' : 'var(--tx3)' }}>Removed · {med ? 'medical' : r.removed_in}</b> {r.reason}{r.replaced_by?.length ? ` → ${r.replaced_by.join(', ')}` : ''}
        </span>
      </div>,
    );
  };
  for (const e of all) {
    if (e.phase !== lastPhase) {
      const ph = phases.find((x) => x.key === e.phase && x.list.includes(e.routine ?? e.label));
      rows.push(
        <div key={`p-${e.exid}`} role="row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 10px 6px' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: e.phase === 'strength' ? STRENGTH : 'var(--ot)', border: '1px solid var(--o)' }} />
          <span role="cell" className="l" style={{ color: 'var(--tx)' }}>{label(e.phase)}</span>
          <span className="m" style={{ color: 'var(--tx3)' }}>{ph ? `≈ ${Math.round(ph.s / 60)} min · ` : ''}{e.phase === 'core' ? `rest ${mmss(p.rest.core_s)}` : `rest ${mmss(e.rest_s)} · lap between exercises`}</span>
        </div>,
      );
      lastPhase = e.phase;
      // a lift removed before the day's first exercise sits where the day used to start
      if (!cur.lead.includes(e) && e === cur.exercises[0]) ghostsAfter(null).forEach(ghost);
    }
    idx += 1;
    rows.push(<ExerciseRow key={e.exid} e={e} i={idx} p={p} open={open === e.exid} toggle={() => setOpen(open === e.exid ? null : e.exid)}
      offline={offline} askAbout={askAbout} propose={propose} day={cur} />);
    ghostsAfter(e.exid).forEach(ghost);
  }
  const startOver = total > (cap ?? Infinity);
  return (
    <section id="anatomy" aria-labelledby="an" className="rise" style={{ animationDelay: '.1s', borderRadius: 20, border: '1px solid var(--ln)', background: 'var(--s1)', minWidth: 0, scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', padding: '16px 22px', borderBottom: '1px solid var(--ln)' }}>
        <h2 id="an" className="l" style={{ color: 'var(--tx)' }}>Session anatomy</h2>
        <div role="tablist" aria-label="Gym day" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 3, borderRadius: 12, background: 'var(--s2)', border: '1px solid var(--ln)' }}>
          {p.days.map((d: any) => {
            const on = d.key === cur.key;
            const starved = d.rotation?.starved && d.rotation?.age != null && !d.optional;
            return (
              <button key={d.key} type="button" role="tab" aria-selected={on} onClick={() => setSel(d.key)}
                style={{ minHeight: 40, padding: '0 12px', border: 0, borderRadius: 9, background: on ? 'var(--tx)' : 'transparent', color: on ? 'var(--on)' : 'var(--tx2)', opacity: d.optional && !on ? 0.55 : 1, display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600 }}>
                <span className="n" style={{ fontSize: 17, fontWeight: 700 }}>{dayKey(d)}</span>{dayTitle(d)}
                {starved && <span aria-label="starved" style={{ color: on ? 'var(--on)' : 'var(--r)', fontWeight: 700 }}>!</span>}
              </button>
            );
          })}
        </div>
        {(p.removed ?? []).length > 0 && (
          <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--tx2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showRemoved} onChange={() => setShowRemoved(!showRemoved)} style={{ width: 16, height: 16, accentColor: 'var(--tx)' }} />Show removed lifts
          </label>
        )}
      </div>
      <div style={{ padding: '18px 22px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span className="l" style={{ color: STRENGTH }}>{cur.optional ? 'optional · rarely run' : when.length ? when.join(' · ') : 'not on the week'}</span>
              {cur.rotation && <RotChip r={cur.rotation} />}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: syC }}><Icon d={syI} size={11} sw={2.8} />{sy}</span>
            </span>
            <span className="n" style={{ fontSize: 38, lineHeight: 1, fontWeight: 700 }}>{dayKey(cur)} · {dayTitle(cur)}</span>
            {cur.why && <span style={{ fontSize: 14, color: 'var(--tx2)' }}>{cur.why}</span>}
          </div>
          <div data-tip={tip(p.defs, 'est_time', cap ? `Cap ${cap} min, set by the coach.` : undefined)} tabIndex={0} style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <span className="l" style={{ fontSize: 10 }}>Estimated{cap ? ` · cap ${cap}` : ''}</span>
            <div className="n" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, color: startOver ? 'var(--r)' : 'var(--tx)' }}>{total}<span style={{ fontSize: 16, color: 'var(--tx3)' }}>{cap ? ` / ${cap}` : ''} min</span></div>
          </div>
        </div>

        {all.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ position: 'relative' }}>
              <div role="img" aria-label={`${dayKey(cur)} phases in order: ${phases.map((x) => `${label(x.key)} ${Math.max(1, Math.round(x.s / 60))} min`).join(', ')}. Total ${total}${cap ? ` of a ${cap}-minute cap` : ' minutes'}.`}
                style={{ display: 'flex', gap: 2, height: 46, width: `${Math.min(100, (total / span) * 100)}%` }}>
                {phases.map((x, i) => {
                  const min = Math.max(1, Math.round(x.s / 60));
                  const main = x.key === 'strength';
                  return (
                    <div key={i} data-tip={`${label(x.key)} · ≈ ${min} min\n${x.list.join(', ')}\nSource: Computed by OpenSportCoach.`} tabIndex={0}
                      style={{ flex: `${x.s} 1 0`, minWidth: 0, borderRadius: 7, padding: '6px 8px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: main ? STRENGTH : 'var(--ot)', border: '1px solid var(--o)', overflow: 'hidden' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: main ? 'var(--on)' : 'var(--tx)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label(x.key)}</span>
                      <span className="n" style={{ fontSize: 13, color: main ? 'var(--on)' : 'var(--tx)', whiteSpace: 'nowrap' }}>{min}′</span>
                    </div>
                  );
                })}
              </div>
              {cap && <div aria-hidden="true" style={{ position: 'absolute', top: -6, bottom: -6, left: `${(cap / span) * 100}%`, width: 2, background: 'var(--tx)' }} />}
            </div>
            <div className="m" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--tx3)', fontSize: 10 }}>
              <span>0′</span><span style={{ textAlign: 'center' }}>Order is the prescription: core → power → first main lift → functional → the rest → isolation last</span><span>{cap ? `cap ${cap}′` : `${total}′`}</span>
            </div>
          </div>
        )}

        {all.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <div role="table" aria-label={`${dayKey(cur)} exercises in order`} style={{ minWidth: 820, display: 'flex', flexDirection: 'column' }}>
              <div role="row" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 10, padding: '8px 10px', borderBottom: '1px solid var(--ln)' }}>
                {['#', 'Exercise · on the watch', 'Prescribed', 'Range · number to beat', 'Trend', 'Check'].map((h) => <span key={h} role="columnheader" className="l" style={{ fontSize: 9 }}>{h}</span>)}
                <span role="columnheader" style={{ fontSize: 0 }}>Expand</span>
              </div>
              {rows}
            </div>
          </div>
        ) : (
          <div style={{ padding: 24, borderRadius: 14, border: '1px dashed var(--ln2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontWeight: 700 }}>No exercises on this day.</span>
            <span style={{ fontSize: 13, color: 'var(--tx2)' }}>Ask the coach to build it.</span>
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 12, color: 'var(--tx3)' }}>
          <span><b className="m" style={{ color: 'var(--tx2)' }}>×</b> reps · double progression</span>
          <span><b className="m" style={{ color: 'var(--tx2)' }}>⚡</b> power · speed, never load</span>
          <span><b className="m" style={{ color: 'var(--tx2)' }}>⏱</b> time · the week’s intensity</span>
          <span><b className="m" style={{ color: 'var(--tx2)' }}>⇄</b> time per side · time, then load</span>
          <span><b className="m" style={{ color: 'var(--tx2)' }}>◷</b> core · anti-movement, {mmss(p.rest.core_s)} rest</span>
        </div>
      </div>
    </section>
  );
}

const SWAP = 'M7 7h11l-3-3M17 17H6l3 3';

function ExerciseRow({ e, i, p, open, toggle, offline, askAbout, propose, day: d }: {
  e: any; i: number; p: any; open: boolean; toggle: () => void; offline: boolean; askAbout: (c: string) => void; propose: (c: string) => void; day: any;
}) {
  const a = e.audit;
  const s = status(e);
  const st = s ? ST[s] : null;
  const k = kindOf(e);
  const name = e.routine ?? e.label;
  let beat: string;
  let beatI = '→';
  let beatC = 'var(--o)';
  let beatTip = tip(p.defs, 'next_target') ?? '';
  if (s === 'impossible') { beat = `Re-prescribe — ${loadTxt(e)} implies e1RM ${kg(a.implied_e1rm)} vs best ${kg(a.best_e1rm)}`; beatI = '✕'; beatC = 'var(--r)'; beatTip = `${ST.impossible[4]}\nSource: Computed by OpenSportCoach.`; }
  else if (s === 'stale') { beat = `First: all ${e.sets} sets at ${e.value} — ${a.sessions} tries, none met`; beatI = '⧗'; beatC = 'var(--y)'; }
  else if (s === 'skipped') { beat = `Do it — skipped the last ${a.skipped} times its day ran`; beatI = '↷'; beatC = 'var(--y)'; beatTip = ST.skipped[4]; }
  else if (k === 'core') { beat = 'quality first · anti-movement, no load race'; beatI = '◷'; beatC = 'var(--tx2)'; beatTip = 'Core block: anti-movement only — quality, not load.'; }
  else if (e.base === 'power') { beat = `${e.note ?? 'max speed'} · every rep crisp — never by load`; beatI = '⚡'; beatC = 'var(--tx2)'; beatTip = 'Power work progresses by quality and speed only.'; }
  else if (e.per_side) { beat = `time first (${e.value} s / side), then load`; beatI = '⇄'; beatC = 'var(--tx2)'; beatTip = 'Time per side: time first, then load.'; }
  else if (e.base === 'time') { beat = e.note ?? 'the week’s intensity'; beatI = '⏱'; beatC = 'var(--tx2)'; beatTip = 'Timed work progresses with the week’s intensity.'; }
  else if (e.next_weight != null) beat = `all ${e.sets} sets at ${e.range?.[1] ?? e.value} → ${loadTxt(e, e.next_weight)}`;
  else beat = `all ${e.sets} sets at ${e.value} → add reps or load`;
  const reached = a && a.sessions > 0 && a.met === a.sessions;
  const fill = !a || !a.sessions ? 0 : reached ? 100 : s === 'stale' ? 50 : Math.round((a.met / a.sessions) * 100) || 25;
  const fillC = s === 'stale' || s === 'watch' ? 'var(--y)' : 'var(--o)';
  const tr: number[] = (e.trend ?? []).filter((v: any) => v != null);
  const mn = Math.min(...tr);
  const mx = Math.max(...tr);
  const Y = (v: number) => 22 - (mx === mn ? 9 : ((v - mn) / (mx - mn)) * 18);
  const X = (j: number) => 3 + j * (64 / Math.max(1, tr.length - 1));
  const tl = tr.length ? tr.map((v, j) => `${j ? 'L' : 'M'}${X(j).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ') : 'M3 13 H67';
  const scoreWord = e.trend_score === 'disc load' ? 'disc load' : e.trend_score === 'reps' ? 'reps' : 'e1RM';
  const facts: [string, string, string, string?][] = [];
  if (a) {
    facts.push(['Since', a.since && a.since > '1971' ? dshort(a.since) : '—', 'var(--tx)', 'Date of the current prescription.']);
    facts.push(['Sessions · met', `${a.sessions} · ${a.met}`, reached ? 'var(--g)' : 'var(--tx)', 'Sessions at this prescription and how many met it.']);
    if (a.best_e1rm != null && !e.machine) {
      facts.push(['Implied e1RM', `${kg(a.implied_e1rm)} kg`, a.impossible ? 'var(--r)' : 'var(--tx)', tip(p.defs, 'e1rm')]);
      facts.push(['Best e1RM', `${kg(a.best_e1rm)} kg`, 'var(--tx)', 'Best e1RM logged for this lift.']);
    } else facts.push(['e1RM', e.machine ? '— plates' : e.weight == null ? '— body weight' : '— no history', 'var(--tx3)', 'No e1RM for plate-loaded machines or body-weight work.']);
    if (a.last) facts.push(['Last done', dshort(a.last), 'var(--tx)']);
  } else facts.push(['Progress by', k === 'core' ? 'hold quality' : e.base === 'power' ? 'speed' : e.per_side ? 'time → load' : e.base === 'time' ? 'intensity' : 'reps → load', 'var(--tx)', 'How this kind of work progresses.']);
  const watchNote = [e.note, e.range && `Range ${e.range[0]}–${e.range[1]} · all sets at ${e.range[1]} → +weight`,
    e.warmup?.length && `warm-up ${e.warmup.map((w: number[]) => `${kg(w[0])}×${w[1]}`).join(', ')}`].filter(Boolean).join(' · ');
  const about = `${dayKey(d)} ${dayTitle(d)} · ${name} (${rxTxt(e)} · ${loadTxt(e)})`;
  return (
    <div role="rowgroup" style={{ display: 'flex', flexDirection: 'column' }}>
      <div role="row" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 10, alignItems: 'center', padding: '9px 10px', borderBottom: '1px solid var(--ln)', background: s === 'impossible' ? 'var(--rt)' : 'transparent' }}>
        <span role="cell" className="n" style={{ fontSize: 16, color: 'var(--tx3)' }}>{i}</span>
        <span role="cell" style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span data-tip={e.why ? `${e.why}\nSource: Coach.` : undefined} tabIndex={e.why ? 0 : undefined} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 700 }}>
            <span data-tip={`Kind: ${KIND[k][1]}`} className="m" style={{ flex: 'none', minWidth: 22, height: 18, padding: '0 4px', boxSizing: 'border-box', borderRadius: 4, display: 'grid', placeItems: 'center', border: '1px solid var(--ln2)', color: 'var(--tx2)', fontSize: 10 }}>{KIND[k][0]}</span>{name}
          </span>
          <span className="m" style={{ color: 'var(--tx3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>⌚ {e.label}</span>
        </span>
        <span role="cell" data-tip={`Prescribed: ${rxTxt(e)} · ${loadTxt(e)}\n${loadTip(e)}\nSource: Coach.`} tabIndex={0} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span className="n" style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.05 }}>{rxTxt(e)}</span>
          <span className="n" style={{ fontSize: 14, color: 'var(--tx2)' }}>{loadTxt(e)}</span>
        </span>
        <span role="cell" style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
          {e.range && (
            <span data-tip={`Range ${e.range[0]}–${e.range[1]}. Double progression: the top of the range on ALL sets → add weight, drop to ${e.range[0]}.${a ? `\nMet in ${a.met} of ${a.sessions} sessions at this prescription.` : ''}\nSource: Computed by OpenSportCoach.`} tabIndex={0}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="n" style={{ fontSize: 13, color: 'var(--tx3)' }}>{e.range[0]}</span>
              <span aria-hidden="true" style={{ position: 'relative', flex: 1, maxWidth: 90, height: 6, borderRadius: 3, background: 'var(--s3)' }}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${fill}%`, borderRadius: 3, background: fillC }} />
              </span>
              <span className="n" style={{ fontSize: 13, color: 'var(--tx3)' }}>{e.range[1]}</span>
              {a && a.sessions > 0 && <span className="m" style={{ color: 'var(--tx2)' }}>met {a.met}/{a.sessions}</span>}
            </span>
          )}
          <span data-tip={beatTip} tabIndex={0} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 13, lineHeight: 1.3 }}>
            <span aria-hidden="true" style={{ color: beatC, fontWeight: 700 }}>{beatI}</span><b>{beat}</b>
          </span>
        </span>
        <span role="cell" data-tip={tr.length ? `${scoreWord} over the last ${pl(tr.length, 'session')}: ${tr.map((v) => kg(v)).join(' → ')}\nSource: Computed by OpenSportCoach.` : 'No history yet.'} tabIndex={0}>
          <svg viewBox="0 0 70 26" width="70" height="26" aria-hidden="true">
            <path d={tl} fill="none" style={{ stroke: tr.length ? 'var(--tx2)' : 'var(--ln2)' }} strokeWidth="1.6" strokeLinejoin="round" strokeDasharray={tr.length ? undefined : '2 3'} />
            {tr.length > 0 && <circle cx={X(tr.length - 1)} cy={Y(tr[tr.length - 1])} r="2.5" style={{ fill: st ? st[3] : 'var(--tx2)' }} />}
          </svg>
        </span>
        <span role="cell">
          {st ? (
            <span data-tip={`${st[4]}${a ? `\nSince ${a.since > '1971' ? a.since : '—'} · ${pl(a.sessions, 'session')} · ${a.met} met.` : ''}\nSource: Computed by OpenSportCoach.`} tabIndex={0}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 6, background: st[2], color: st[3], fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
              <span aria-hidden="true">{st[1]}</span>{st[0]}
            </span>
          ) : <span data-tip="Not checked per session — no load to check." tabIndex={0} className="m" style={{ color: 'var(--tx3)' }}>—</span>}
        </span>
        <span role="cell">
          <button type="button" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`} onClick={toggle} className="hv"
            style={{ width: 32, height: 32, border: 0, borderRadius: 8, background: 'transparent', display: 'grid', placeItems: 'center', color: 'var(--tx2)' }}>
            <Icon d="M6 9l6 6 6-6" size={14} sw={2.2} style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
          </button>
        </span>
      </div>
      {open && (
        <div role="row" style={{ display: 'grid', gridTemplateColumns: '30px 1fr', gap: 10, padding: '12px 10px 14px', borderBottom: '1px solid var(--ln)', background: 'var(--s2)' }}>
          <span />
          <div role="cell" style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 28px' }}>
            <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="l" style={{ fontSize: 9 }}>Why it’s here</span>
              <span style={{ fontSize: 14, lineHeight: 1.45, color: e.why ? 'var(--tx)' : 'var(--tx3)' }}>{e.why ?? 'No reason recorded yet — ask the coach.'}</span>
              {watchNote && <span className="m" style={{ color: 'var(--tx3)' }}>Watch note: {watchNote}</span>}
            </div>
            <div style={{ flex: '1 1 260px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 14px', fontSize: 12 }}>
              {facts.map(([l, v, c, t]) => (
                <div key={l} data-tip={t ? `${t}${t.includes('Source:') ? '' : '\nSource: Computed by OpenSportCoach.'}` : undefined} tabIndex={t ? 0 : undefined}>
                  <div className="l" style={{ fontSize: 9 }}>{l}</div>
                  <div className="n" style={{ fontSize: 17, fontWeight: 700, color: c }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end' }}>
              <button type="button" className="btn2 hv" style={{ minHeight: 36, fontSize: 12 }} disabled={offline} onClick={() => askAbout(about)}>Ask about this</button>
              <button type="button" className="btn2 hv" style={{ minHeight: 36, fontSize: 12 }} disabled={offline} onClick={() => propose(about)}>Propose a change</button>
              <Link to={`/exercise/${e.category}/${e.name}`} className="link" style={{ fontSize: 12, textAlign: 'center' }}>Exercise page</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- 4 · cardio ----------------------------------------------------------------------------------
function Cardio({ p, offline, propose, openWatch }: Ctx) {
  const c = p.cardio;
  return (
    <section id="cardio" aria-labelledby="cd" className="rise" style={{ animationDelay: '.14s', borderRadius: 20, border: '1px solid var(--ln)', background: 'var(--s1)', minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '16px 22px', borderBottom: '1px solid var(--ln)' }}>
        <h2 id="cd" className="l" style={{ color: 'var(--tx)' }}>Cardio{c ? ` · ${pl(c.tracks.length, 'track')} on a ${c.weeks.length}-week arc` : ''}</h2>
        {c && <span style={{ fontSize: 12, color: 'var(--tx3)' }}>★ = benchmark{c.upcoming ? ` · starts ${day(c.start)}` : ''}</span>}
      </div>
      {c ? (<>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 860 }}>
            <div style={{ display: 'grid', gridTemplateColumns: `170px repeat(${c.weeks.length}, minmax(0, 1fr))`, padding: '0 22px' }}>
              <span />
              {c.weeks.map((w: any, i: number) => (
                <div key={w.n} style={{ padding: '10px 8px', display: 'flex', justifyContent: 'space-between', borderBottom: `2px solid ${c.current === i ? 'var(--tx)' : 'var(--ln)'}` }}>
                  <span className="l" style={{ color: c.current === i ? 'var(--tx)' : 'var(--tx3)' }}>Wk {w.n}{c.current === i ? ' · now' : ''}</span>
                  <span className="m" style={{ fontSize: 10, color: 'var(--tx3)' }}>{dshort(w.start)}–{dshort(w.end)}</span>
                </div>
              ))}
            </div>
            {c.tracks.map((t: any) => {
              const [sy, syC, syI] = syncOf(t.sync, t.platform);
              return (
                <div key={t.name} style={{ display: 'grid', gridTemplateColumns: `170px repeat(${c.weeks.length}, minmax(0, 1fr))`, padding: '0 22px', borderBottom: '1px solid var(--ln)' }}>
                  <div style={{ padding: '12px 8px 12px 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SportIcon icon={t.badge.icon} size={14} style={{ color: kindColor(t.badge.kind) }} /><span style={{ fontWeight: 700, fontSize: 15 }}>{t.name}</span></span>
                    {t.when && <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{t.when}</span>}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: syC }}><Icon d={syI} size={10} sw={3} />{sy}</span>
                  </div>
                  {c.weeks.map((w: any, i: number) => {
                    const cell = t.cells[i];
                    if (!cell) return <span key={w.n} />;
                    const on = c.current === i;
                    const style = { textAlign: 'left' as const, margin: '8px 4px', padding: 10, borderRadius: 10, border: `1px solid ${on ? 'var(--tx)' : 'var(--ln)'}`, background: on ? 'var(--s2)' : 'transparent', display: 'flex', flexDirection: 'column' as const, gap: 3, color: 'var(--tx)' };
                    const inner = (<>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, fontWeight: 700 }}>{cell.benchmark && <span aria-label="benchmark" style={{ color: 'var(--y)' }}>★</span>}{cell.title}</span>
                      {cell.rx && <span className="n" style={{ fontSize: 14, color: 'var(--tx2)' }}>{cell.rx}</span>}
                    </>);
                    const tipTxt = `${t.name} · week ${w.n}: ${cell.title}${cell.rx ? ` · ${cell.rx}` : ''}${cell.workout ? '\nClick to see it as the watch shows it.' : ''}\nSource: Coach.`;
                    return cell.workout
                      ? <button key={w.n} type="button" className="hv" data-tip={tipTxt} onClick={() => openWatch(cell.workout)} style={style}>{inner}</button>
                      : <div key={w.n} data-tip={tipTxt} tabIndex={0} style={style}>{inner}</div>;
                  })}
                </div>
              );
            })}
          </div>
        </div>
        {c.notes.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', padding: '12px 22px 16px', fontSize: 12, color: 'var(--tx2)' }}>
            {c.notes.map((n: string) => <span key={n}>{n}</span>)}
          </div>
        )}
      </>) : (
        <div style={{ padding: '24px 22px', display: 'flex', flexWrap: 'wrap', gap: '12px 24px', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 320px' }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>No cardio template yet.</span>
            <span style={{ fontSize: 13, color: 'var(--tx2)' }}>Runs, rides and swims you log still count on Training load. Tracks appear here once the coach builds an arc.</span>
          </div>
          <button type="button" className="btn2 hv" disabled={offline} onClick={() => propose('add cardio to my program')}>Propose a change · add cardio</button>
        </div>
      )}
    </section>
  );
}

// --- 5 · benchmarks ------------------------------------------------------------------------------
function Benchmarks({ p }: Ctx) {
  const today = todayIso();
  return (
    <section aria-labelledby="bm" style={{ borderRadius: 16, border: '1px solid var(--ln)', background: 'var(--s1)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px', padding: '16px 20px', borderBottom: '1px solid var(--ln)' }}>
        <h2 id="bm" className="l" style={{ color: 'var(--tx)' }}>Benchmarks · numbers to beat</h2>
        {p.benchmarks.length > 0 && <span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>retest every {Math.round(p.benchmarks[0].retest_days / 7)} weeks</span>}
      </div>
      {p.benchmarks.map((b: any) => {
        const soon = !b.overdue && (new Date(`${b.next}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 864e5 <= 7;
        return (
          <div key={b.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 12, alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--ln)' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SportIcon icon={b.badge.icon} size={13} style={{ color: kindColor(b.badge.kind) }} /><span style={{ fontWeight: 700, fontSize: 14 }}>{b.name}</span></span>
              <span data-tip={`When the next test is due.\nSource: Coach.`} tabIndex={0} className="m" style={{ color: b.overdue ? 'var(--r)' : soon ? 'var(--y)' : 'var(--tx2)' }}>{b.overdue ? 'overdue · ' : 'due '}{day(b.next)}</span>
            </span>
            <span data-tip={b.last ? `Last result, ${b.last.date}.\nSource: Coach.` : 'No result recorded yet.'} tabIndex={0} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="l" style={{ fontSize: 9 }}>Last</span>
              <span className="n" style={{ fontSize: 20, fontWeight: 700, color: b.last ? 'var(--tx)' : 'var(--tx3)' }}>{b.last ? `${b.last.value}${b.unit ? ` ${b.unit}` : ''}` : 'Not yet'}</span>
            </span>
            <span data-tip="Each result becomes the next target." tabIndex={0} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="l" style={{ fontSize: 9 }}>To beat · retest</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{b.last ? `${b.last.value}${b.unit ? ` ${b.unit}` : ''}` : 'The first test sets the baseline'}</span>
              <span className="m" style={{ color: 'var(--tx3)' }}>retest {day(b.retest)}</span>
            </span>
          </div>
        );
      })}
      {!p.benchmarks.length && <div style={{ padding: 20, fontSize: 13, color: 'var(--tx2)' }}><b style={{ color: 'var(--tx)' }}>No benchmarks yet.</b> They come with a cardio arc. Gym lifts already have their numbers to beat above.</div>}
      <Link to="/strength" className="link" style={{ padding: '12px 20px', fontSize: 12 }}>Gym strength keeps its own scoreboard — e1RM per lift on Strength</Link>
    </section>
  );
}

// --- 6 · balance ---------------------------------------------------------------------------------
function Balance({ p }: Ctx) {
  const bal = p.balance;
  const mx = Math.max(26, ...bal.muscles.map((m: any) => Math.max(m.sets, m.hi) + 2));
  const ath = bal.athletic.reduce((s: number, a: any) => s + a.sets, 0);
  const gymDays = p.days.filter((d: any) => bal.days.includes(d.key)).map(dayKey);
  return (
    <section aria-labelledby="bl" style={{ borderRadius: 16, border: '1px solid var(--ln)', background: 'var(--s1)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px' }}>
        <h2 id="bl" className="l" data-tip={tip(p.defs, 'planned_volume')} tabIndex={0} style={{ color: 'var(--tx)' }}>Balance · working sets per week</h2>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--tx2)' }}><span style={{ width: 16, height: 10, borderRadius: 2, background: 'var(--ln2)' }} />band</span>
        <span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>{gymDays.join(' · ')} once</span>
      </div>
      {bal.muscles.map((m: any) => {
        const noBand = !m.lo && !m.hi;
        const [s, i, c] = noBand ? ['No band', '·', 'var(--tx3)']
          : m.sets < m.lo && m.on_purpose ? ['Below · on purpose', '◇', 'var(--tx2)']
            : m.sets < m.lo ? ['Below', '↓', 'var(--y)'] : m.sets > m.hi ? ['Above', '↑', 'var(--b)'] : ['In band', '✓', 'var(--g)'];
        return (
          <div key={m.muscle} data-tip={`${m.muscle}: ${m.sets} working sets a week${noBand ? '' : ` vs band ${m.lo}–${m.hi}`}.${m.on_purpose ? `\nUnder on purpose — ${m.on_purpose}.` : ''}\nSource: Computed by OpenSportCoach.`} tabIndex={0}
            style={{ display: 'grid', gridTemplateColumns: '92px 1fr 26px 112px', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{m.muscle.replace('/', ' / ')}</span>
            <div style={{ position: 'relative', height: 16, borderRadius: 4, background: 'var(--s2)' }}>
              {!noBand && <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(m.lo / mx) * 100}%`, width: `${((m.hi - m.lo) / mx) * 100}%`, background: 'var(--ln2)', borderRadius: 3 }} />}
              <div style={{ position: 'absolute', top: 5, height: 6, left: 0, width: `${(m.sets / mx) * 100}%`, background: c, borderRadius: 3 }} />
            </div>
            <span className="n" style={{ fontSize: 16, textAlign: 'right' }}>{m.sets}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: c }}><span aria-hidden="true">{i}</span>{s}</span>
          </div>
        );
      })}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10, borderTop: '1px solid var(--ln)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="l" style={{ fontSize: 10, color: 'var(--tx)' }}>Athletic bucket · not muscle volume</span>
          <span data-tip={tip(p.defs, 'planned_volume')} tabIndex={0} className="n" style={{ fontSize: 18, fontWeight: 700 }}>{pl(ath, 'set')}</span>
        </div>
        {ath > 0 ? (<>
          <div style={{ display: 'flex', height: 22, gap: 2, borderRadius: 6, overflow: 'hidden' }}>
            {bal.athletic.map((a: any, k: number) => (
              <div key={a.part} data-tip={`${a.part}: ${a.sets} sets a week in the Athletic bucket.\nSource: Computed by OpenSportCoach.`} tabIndex={0}
                style={{ flex: a.sets, background: 'var(--o)', opacity: Math.max(0.38, 1 - k * 0.15), display: 'grid', placeItems: 'center' }}>
                <span className="n" style={{ fontSize: 12, color: 'var(--on)' }}>{a.sets}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11, color: 'var(--tx2)' }}>{bal.athletic.map((a: any) => <span key={a.part}>{a.part} {a.sets}</span>)}</div>
        </>) : <span style={{ fontSize: 12, color: 'var(--tx2)' }}>No athletic work in this program yet.</span>}
      </div>
    </section>
  );
}

// --- 7 · constraint and standing rules -----------------------------------------------------------
function Constraint({ p }: Ctx) {
  const cons: any[] = p.constraints;
  const medical = (p.removed ?? []).filter((r: any) => r.removed_in === 'medical');
  const added = [...new Set(medical.flatMap((r: any) => r.replaced_by ?? []))] as string[];
  const enforced = cons.some((c) => c.enforced_by);
  return (
    <section aria-labelledby="cn" style={{ borderRadius: 16, border: `1px solid ${cons.length ? 'var(--ln2)' : 'var(--ln)'}`, background: 'var(--s1)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--ln)' }}>
        <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--s3)', color: 'var(--tx2)' }}><Icon d={IC.lock} size={15} sw={2.2} /></span>
        <h2 id="cn" className="l" style={{ color: 'var(--tx)' }}>{cons.length > 1 ? 'Locked constraints' : 'Locked constraint'}</h2>
        {enforced && (
          <span data-tip="An automated test refuses any program that breaks it — the coach can’t prescribe around it." tabIndex={0}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 5, background: 'var(--gt)', color: 'var(--g)', fontSize: 11, fontWeight: 700 }}>
            <Icon d={SHIELD} size={10} sw={3} />Enforced by tests
          </span>
        )}
      </div>
      {cons.length ? (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {cons.map((c) => (
            <div key={c.file}>
              <div className="n" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>{c.title}</div>
              <div style={{ fontSize: 13, color: 'var(--tx2)', marginTop: 4 }}>{c.since ? `Since ${day(c.since)}. ` : ''}{c.enforced_by ? 'The coach cannot get around the tests.' : 'Recorded as a medical fact.'}</div>
            </div>
          ))}
          {medical.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="l" style={{ fontSize: 9 }}>Removed permanently</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {medical.map((r: any) => <span key={r.name} data-tip={r.reason} tabIndex={0} style={{ padding: '3px 8px', borderRadius: 6, border: '1px dashed var(--ln2)', fontSize: 12, color: 'var(--tx2)', textDecoration: 'line-through' }}>{r.name}</span>)}
              </div>
            </div>
          )}
          {added.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="l" style={{ fontSize: 9, color: 'var(--g)' }}>Added to compensate</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {added.map((x) => <span key={x} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, background: 'var(--gt)', color: 'var(--g)', fontSize: 12, fontWeight: 600 }}>+ {x}</span>)}
              </div>
            </div>
          )}
          <span style={{ fontSize: 13, color: 'var(--tx2)', paddingTop: 10, borderTop: '1px solid var(--ln)' }}>Reinstating any removed lift is a <b style={{ color: 'var(--tx)' }}>medical decision</b>, not a programming one.</span>
        </div>
      ) : (
        <div style={{ padding: 20, fontSize: 13, color: 'var(--tx2)' }}><b style={{ color: 'var(--tx)' }}>No constraints recorded.</b> If something hurts or a doctor limits a movement, tell the coach — it becomes a locked rule here and in About me.</div>
      )}
    </section>
  );
}

const SHIELD = 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z';

function Rules({ p, offline, askAbout }: Ctx) {
  return (
    <section aria-labelledby="sr" style={{ borderRadius: 16, border: '1px solid var(--ln)', background: 'var(--s1)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--ln)' }}>
        <h2 id="sr" className="l" style={{ color: 'var(--tx)' }}>Standing rules</h2>
        <span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>checked on every rewrite</span>
      </div>
      {p.rules.map((r: any) => (
        <div key={r.label} className="hv" style={{ display: 'grid', gridTemplateColumns: '74px 1fr auto', gap: 12, alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid var(--ln)' }}>
          <span className="n" data-tip={r.source === 'engine' ? 'Built into every workout OpenSportCoach generates.' : 'A rule of this program.\nSource: Coach.'} tabIndex={0}
            style={{ fontSize: 17, fontWeight: 700, color: r.badge ? kindColor(r.badge.kind) : r.key.endsWith(' d') ? 'var(--r)' : 'var(--tx)' }}>{r.key}</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</span><span style={{ fontSize: 12, color: 'var(--tx2)' }}>{r.detail}</span></span>
          <button type="button" aria-label={`Ask about this rule: ${r.label}`} disabled={offline} onClick={() => askAbout(`Program rule · ${r.label}`)} className="hv"
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--ln)', background: 'transparent', display: 'grid', placeItems: 'center', color: 'var(--tx2)' }}>
            <Icon d={IC.chat} size={13} sw={2} />
          </button>
        </div>
      ))}
    </section>
  );
}

// --- 8 · history ---------------------------------------------------------------------------------
const CHANGE: Record<string, [string, string]> = { structural: ['Change', 'var(--v)'], added: ['Added', 'var(--g)'], removed: ['Removed', 'var(--tx3)'] };

function History({ p }: Ctx) {
  const [more, setMore] = useState<Record<string, boolean>>({});
  const vs: any[] = p.versions;
  const named = vs.filter((v) => v.id).length;
  return (
    <section aria-labelledby="hi" style={{ borderRadius: 16, border: '1px solid var(--ln)', background: 'var(--s1)', minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px', padding: '16px 20px', borderBottom: '1px solid var(--ln)' }}>
        <h2 id="hi" className="l" style={{ color: 'var(--tx)' }}>History · {named ? 'versions and why' : 'load changes'}</h2>
        <span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>{named ? `${pl(named, 'version')} · ` : ''}{pl(p.changes.length, 'load change')}</span>
      </div>
      {!vs.length && <div style={{ padding: 20, fontSize: 13, color: 'var(--tx2)' }}>No changes recorded yet.</div>}
      <ol style={{ listStyle: 'none', margin: 0, padding: '8px 20px 16px' }}>
        {vs.map((v, n) => {
          const k = v.id ?? 'before';
          const curV = n === 0 && v.id;
          const vc = curV ? 'var(--o)' : 'var(--tx2)';
          const loads = more[k] ? v.loads : v.loads.slice(0, 6);
          return (
            <li key={k} style={{ display: 'grid', gridTemplateColumns: '96px 24px 1fr', gap: 12 }}>
              <span style={{ paddingTop: 14, display: 'flex', flexDirection: 'column' }}>
                <span className="n" style={{ fontSize: 20, fontWeight: 700, color: vc }}>{v.id ?? (named ? 'earlier' : 'loads')}</span>
                <span className="m" style={{ color: 'var(--tx3)' }}>{v.id ? dshort(v.date) : `≤ ${dshort(v.loads[0]?.date ?? v.date)}`}</span>
              </span>
              <span aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ width: 1, height: 16, background: 'var(--ln2)' }} />
                <span style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${vc}`, background: curV ? 'var(--o)' : 'var(--s1)', flex: 'none' }} />
                <span style={{ width: 1, flex: 1, background: 'var(--ln2)' }} />
              </span>
              <div style={{ padding: '12px 0 16px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--ln)', minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{v.id ? v.title : named ? 'Before the recorded versions' : 'Every load change, newest first'}</span>
                {v.rationale && <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{v.rationale}</span>}
                {v.changes.map((x: any, j: number) => {
                  const [w, c] = CHANGE[x.kind] ?? CHANGE.structural;
                  return (
                    <div key={j} style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 10, alignItems: 'baseline', padding: '6px 10px', borderRadius: 8, background: 'var(--s2)', fontSize: 13 }}>
                      <span className="l" style={{ fontSize: 9, color: c }}>{w}</span>
                      <span><b>{x.text}</b> {x.why && <span style={{ color: 'var(--tx2)' }}>{x.why}</span>}</span>
                    </div>
                  );
                })}
                {loads.map((x: any, j: number) => (
                  <div key={`l${j}`} style={{ display: 'grid', gridTemplateColumns: '70px 1fr auto', gap: 10, alignItems: 'baseline', padding: '6px 10px', borderRadius: 8, background: 'var(--s2)', fontSize: 13 }}>
                    <span className="l" style={{ fontSize: 9, color: 'var(--o)' }}>Load</span>
                    <span><b>{pretty(x.name)}</b> <span className="n" style={{ fontSize: 15 }}>{kg(x.from)} → <span style={{ color: x.to > x.from ? 'var(--g)' : 'var(--y)' }}>{kg(x.to)}</span> kg × {x.reps}</span></span>
                    <span className="m" style={{ color: 'var(--tx3)' }}>{dshort(x.date)}</span>
                  </div>
                ))}
                {v.loads.length > 6 && (
                  <button type="button" className="link" onClick={() => setMore({ ...more, [k]: !more[k] })} style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0 }}>
                    {more[k] ? 'Show fewer' : `${v.loads.length - 6} more load changes`}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// --- 9 · watch drawer ----------------------------------------------------------------------------
function WatchDrawer({ p, cur, wsel, setWsel, close }: Ctx & { cur: any; wsel: string | null; setWsel: (k: string) => void; close: () => void }) {
  const { state } = useStore();
  // A dialog takes focus when it opens and gives it back when it closes (docs/DESIGN.md (app audit) U24).
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeBtn.current?.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
  }, []);
  const state_ = new Map(p.sync.workouts.map((w: any) => [w.key, w.state]));
  const whenOf = (key: string) => p.week.days.flatMap((d: any) => d.sessions.filter((s: any) => (s.day ?? s.workout) === key).map(() => DOWS[d.dow])).join(' · ');
  const items: { key: string; name: string; sub: string; icon: string; kind: string; sync: string; platform?: string | null; steps: any[] | null }[] = [
    ...p.days.map((d: any) => ({ key: d.key, name: `Gym · ${d.label}`, sub: d.optional ? 'optional' : whenOf(d.key) || '—', icon: 'strength', kind: 'strength', sync: (state_.get(d.key) as string) ?? 'none', steps: d.watch })),
    ...p.other_workouts.map((o: any) => ({ key: o.key, name: o.name, sub: whenOf(o.key) || (o.badge?.sport ?? ''), icon: o.badge?.icon ?? 'other', kind: o.badge?.kind ?? 'sport', sync: (state_.get(o.key) as string) ?? 'none', steps: o.watch })),
  ];
  const seen = new Set(items.map((x) => x.key));
  for (const d of p.week.days) for (const s of d.sessions) {
    if (s.day || (s.workout && seen.has(s.workout)) || seen.has(`off:${s.title}`)) continue;
    seen.add(`off:${s.title}`);
    items.push({ key: `off:${s.title}`, name: s.title, sub: DOWS[d.dow], icon: s.badge.icon, kind: s.badge.kind, sync: s.sync, platform: s.platform, steps: null });
  }
  const selKey = wsel ?? cur?.key;
  const selected = items.find((x) => x.key === selKey) ?? items[0];
  const pending = p.sync.workouts.filter((w: any) => w.state === 'changed' || w.state === 'not_pushed');
  let n = 0;
  return (
    <aside id="watchdrawer" className="drawer slide" role="dialog" aria-label="Watch sync and preview"
      style={{ position: 'fixed', top: 84, right: 16, width: 420, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 100px)', overflowY: 'auto', boxSizing: 'border-box', zIndex: 40, borderRadius: 20, border: '1px solid var(--ln2)', background: 'var(--s1)', boxShadow: 'var(--sh)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--ln)', position: 'sticky', top: 0, background: 'var(--s1)', zIndex: 1 }}>
        <h2 className="l" style={{ color: 'var(--tx)' }}>Watch · {state?.display}{state?.garmin_account ? ` · Garmin ${state.garmin_account}` : ''}</h2>
        <button ref={closeBtn} type="button" onClick={close} aria-label="Close watch drawer" className="hv"
          style={{ marginLeft: 'auto', width: 36, height: 36, borderRadius: 10, border: '1px solid var(--ln)', background: 'transparent', display: 'grid', placeItems: 'center', color: 'var(--tx)' }}><Icon d={IC.x} size={14} /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((w) => {
          const [sy, syC, syI] = syncOf(w.sync, w.platform);
          const on = w.key === selected?.key;
          return (
            <button key={w.key} type="button" onClick={() => setWsel(w.key)} aria-pressed={on} className="hv"
              style={{ textAlign: 'left', display: 'grid', gridTemplateColumns: '14px 1fr auto', gap: 10, alignItems: 'center', padding: '9px 18px', border: 0, borderBottom: '1px solid var(--ln)', background: on ? 'var(--s2)' : 'transparent', color: 'var(--tx)' }}>
              <SportIcon icon={w.icon} size={13} style={{ color: kindColor(w.kind) }} />
              <span style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 13, fontWeight: 600 }}>{w.name}</span><span className="m" style={{ color: 'var(--tx3)' }}>{w.sub}</span></span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: syC }}><Icon d={syI} size={10} sw={3} />{sy}</span>
            </button>
          );
        })}
      </div>
      {pending.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', padding: '12px 18px', background: 'var(--yt)', borderBottom: '1px solid var(--ln)' }}>
          <span style={{ fontSize: 13, flex: '1 1 200px' }}>{pending.map((w: any) => w.workout).join(' · ')} changed — the watch still has the previous copy.</span>
          <WatchSendButton showNote />
        </div>
      )}
      <div style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="l" style={{ fontSize: 10 }}>As the watch shows it · {selected?.name}</span>
        <ol aria-label="Watch step list" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 460, overflowY: 'auto', borderRadius: 12, background: '#000', color: '#FFFFFF' }}>
          {!selected?.steps?.length && (
            <li style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="n" style={{ fontSize: 18, fontWeight: 700 }}>Not on the watch</span>
              <span style={{ font: '500 11px/1.25 Barlow, sans-serif', color: '#9AA3AB' }}>
                {selected?.platform ? `${selected.platform[0].toUpperCase()}${selected.platform.slice(1)} runs this workout itself.` : selected?.steps === null && selected?.key.startsWith('off:') ? 'Planned off the watch — logged, not prescribed step by step.' : 'No generated workout for it yet.'}
              </span>
            </li>
          )}
          {(selected?.steps ?? []).map((s: any, k: number) => {
            if (s.kind === 'repeat') {
              n += 1;
              return (
                <li key={k} style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 10, alignItems: 'center', padding: `8px 12px 8px ${12 + s.depth * 14}px`, borderBottom: '1px solid #1E2226' }}>
                  <span style={{ font: "500 10px/1 'JetBrains Mono', monospace", color: '#7F8992' }}>{n}</span>
                  <span className="n" style={{ fontSize: 18, lineHeight: 1.05, fontWeight: 700 }}>Repeat × {s.times}</span><span />
                </li>
              );
            }
            const rest = s.kind === 'rest';
            const tag = s.headline === 'Lap' ? 'LAP' : rest ? 'REST' : s.kind === 'warmup' ? 'WARM-UP' : /^\d+:\d\d$/.test(s.headline) ? 'TIME' : 'SET';
            if (s.depth === 0) n += 1;
            return (
              <li key={k} style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 10, alignItems: 'center', padding: `8px 12px 8px ${12 + s.depth * 14}px`, borderBottom: '1px solid #1E2226' }}>
                <span style={{ font: "500 10px/1 'JetBrains Mono', monospace", color: '#7F8992' }}>{s.depth === 0 ? n : ''}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span className="n" style={{ fontSize: 18, lineHeight: 1.05, fontWeight: 700, color: rest ? '#7FBFFF' : '#FFFFFF' }}>{s.headline}</span>
                  {(s.sub || s.weight) && <span style={{ font: '500 11px/1.25 Barlow, sans-serif', color: '#9AA3AB' }}>{[s.sub, s.weight ? `${kg(s.weight)} kg` : null].filter(Boolean).join(' · ')}</span>}
                </span>
                <span style={{ font: '600 9px/1 Barlow, sans-serif', letterSpacing: '.12em', color: '#7F8992' }}>{tag}</span>
              </li>
            );
          })}
        </ol>
        <span style={{ fontSize: 11, color: 'var(--tx3)' }}>Headline = what ends the step: a time, a distance, or the exercise name. “Lap” = press for next.</span>
      </div>
    </aside>
  );
}

