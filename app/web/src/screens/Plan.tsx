/** Plan & calendar (board Plan, 2026-10-17): week / month, the session detail panel under them, the coach's
 * proposals, sync status. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStore, useView, type AppRequest } from '../lib/api';
import { day, dow, dshort, isoDate, monthName, tip, todayIso } from '../lib/fmt';
import { ErrorBox, IC, Icon, PageTitle, Skeleton } from '../components/ui';
import { SportIcon, SportTag } from '../components/SportIcon';
import { RaceTile, WinLegend, WinSwatch } from '../components/Races';
import { TripClashes, TripDayTag } from '../components/Trips';
import type { TripDayRow } from '../lib/trips';
import { WIN, shortDay, type RaceCard } from '../lib/races';
import { calendarEntries, plannedKey, type Entry, type EntryKind } from '../lib/calendar';
import { ZwiftWorkoutLine } from '../components/ZwiftWorkout';
import { FuelLine } from '../components/Fuel';
import { SessionPanel } from '../components/SessionPanel';
import { WatchSendButton } from '../components/WatchSend';
import { CH, CHANGE_ORDER, STAGE, counts, days as proposalDays, findProposal, sessionCount, spanText, standing, wd } from '../lib/proposal';

const addDays = (s: string, n: number) => isoDate(new Date(new Date(`${s}T12:00:00`).getTime() + n * 864e5));
const mondayOf = (s: string) => addDays(s, -((new Date(`${s}T12:00:00`).getDay() + 6) % 7));
const weeksBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / (7 * 864e5));
const monthIdx = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
const monthStart = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`;
const weekWord = (n: number) => (n === 0 ? 'this week' : n === 1 ? 'next week' : n === -1 ? 'last week' : n > 0 ? `in ${n} weeks` : `${-n} weeks ago`);

const KIND_STYLE: Record<string, { col: string; bg: string; icon: string; word: string; dashed?: boolean }> = {
  done: { col: 'var(--g)', bg: 'var(--gt)', icon: IC.check, word: 'Done' },
  watch: { col: 'var(--b)', bg: 'var(--bt)', icon: IC.watch, word: 'On the watch' },
  planned: { col: 'var(--tx2)', bg: 'var(--s2)', icon: IC.clock, word: 'Planned · off the watch' },
  // An accepted week's watch session beyond the watch's horizon (today and the next two days): it goes on
  // the watch as its day comes near, and this entry gives way to the watch's own then (plan.json `workout`).
  upcoming: { col: 'var(--b)', bg: 'var(--bt)', icon: IC.watch, word: 'Planned · goes on the watch', dashed: true },
  changed: { col: 'var(--y)', bg: 'var(--yt)', icon: IC.warn, word: 'Changed · not on the watch', dashed: true },
  missed: { col: 'var(--tx3)', bg: 'var(--s2)', icon: IC.minus, word: 'Not done', dashed: true },
};

export default function Plan() {
  const cal = useView('calendar');
  const prog = useView('program');
  const rv = useView<{ races: RaceCard[] }>('races');
  const { state, ask } = useStore();
  const [params] = useSearchParams();
  const watchParam = params.get('watch');
  const dateParam = params.get('date')?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? watchParam?.match(/^plan:(\d{4}-\d{2}-\d{2}):/)?.[1];
  const [mode, setMode] = useState<'week' | 'month'>('week');
  // Which week or month is shown, from this one: a planned session linked from Today opens on its own week.
  // …and a link may name the day (Today's Next: a watch session next week used to open on this one).
  const [shift, setShift] = useState(() => (dateParam ? weeksBetween(mondayOf(todayIso()), mondayOf(dateParam)) : 0));
  // The picked session: its identity on the calendar (a done one by its activity, the rest by workout or
  // plan key) and, when known, its day — the panel opens under the week, its notch on that day.
  const [sel, setSel] = useState<{ id: string; date?: string } | null>(watchParam ? { id: watchParam, date: dateParam } : null);
  const [msg, setMsg] = useState<string | null>(null);
  const detail = useRef<HTMLDivElement>(null);
  const picked = useRef(false);
  // A session picked on the calendar comes into view — under a month it is a long way down.
  useEffect(() => {
    if (picked.current) detail.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    picked.current = false;
  }, [sel]);
  const offline = state?.coach !== 'online';
  const proposal = useMemo(() => findProposal(state?.requests), [state]);
  if (cal.error || prog.error) return <ErrorBox error={cal.error ?? prog.error ?? ''} />;
  if (!cal.data || !prog.data) return <><Skeleton h={80} /><Skeleton h={320} /></>;
  const c = cal.data;
  const p = prog.data;
  const today = todayIso();
  const thisMonday = mondayOf(today);
  // How far the calendar can go: the view holds six weeks of sessions and the scheduled month.
  // …and every day a race shapes, so a race months ahead is one click away.
  const dates = [...c.done, ...c.scheduled, ...(c.planned ?? []), ...(c.race_days ?? []), ...(c.trip_days ?? [])].map((x: any) => x.date as string).filter(Boolean).sort();
  const first = dates[0] ?? today;
  const last = dates[dates.length - 1] ?? today;
  const range = mode === 'week'
    ? [Math.min(0, weeksBetween(thisMonday, mondayOf(first))), Math.max(1, weeksBetween(thisMonday, mondayOf(last)))]
    : [Math.min(0, monthIdx(first) - monthIdx(today)), Math.max(0, monthIdx(last) - monthIdx(today))];
  const monday = addDays(thisMonday, 7 * shift);
  const pending = (c.sync?.workouts ?? []).filter((w: any) => w.state === 'changed' || w.state === 'not_pushed');
  const byName = new Map<string, any>([...p.days.map((d: any) => [d.name, d]), ...p.other_workouts.map((o: any) => [o.name, { ...o, exercises: [] }])]);
  const entries = calendarEntries(c, today);
  const keyOf = (e: any) => e.key ?? byName.get(e.title)?.key ?? e.title;
  const idOf = (e: Entry) => (e.kind === 'done' && e.id ? `done:${e.id}` : keyOf(e));
  // The days a race shapes (calendar.race_days, from scripts/races.py): one row per day per race.
  const raceDay: Record<string, any> = Object.fromEntries((c.race_days ?? []).map((x: any) => [x.date, x]));
  const raceCard = (id: string) => rv.data?.races.find((r) => r.id === id);
  // The days away (calendar.trip_days, from scripts/trips.py): a day is in one trip at most.
  const tripDay: Record<string, TripDayRow> = Object.fromEntries((c.trip_days ?? []).map((x: TripDayRow) => [x.date, x]));
  // A benchmark due inside a race's window: the tests forbid it, so this shows only while a move is pending.
  const clashes = (p.benchmarks ?? []).filter((b: any) => raceDay[b.next]);
  const pick = (e: Entry, date: string) => { picked.current = true; setSel({ id: idOf(e), date }); };
  // Every session the view shows, in order: what prev / next walk through.
  const monthFirst = monthStart(monthIdx(today) + shift);
  const shown = mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(monday, i))
    : Array.from({ length: new Date(Number(monthFirst.slice(0, 4)), Number(monthFirst.slice(5, 7)), 0).getDate() }, (_, i) => addDays(monthFirst, i));
  const list = shown.flatMap((d) => entries(d).map((e) => ({ entry: { ...e, key: keyOf(e) }, date: d })));
  const at = sel ? (list.findIndex((x) => idOf(x.entry) === sel.id && x.date === sel.date) + 1
    || list.findIndex((x) => idOf(x.entry) === sel.id && !sel.date && x.date >= today) + 1
    || list.findIndex((x) => idOf(x.entry) === sel.id && !sel.date) + 1) - 1 : -1;
  // Picked from a link, not on the days shown (a gym day with nothing on the calendar): the session alone.
  const loose = sel && at < 0 && !sel.id.startsWith('done:') ? (() => {
    const d = p.days.find((x: any) => x.key === sel.id) ?? p.other_workouts.find((x: any) => x.key === sel.id);
    const planned = (c.planned ?? []).find((x: any) => plannedKey(x) === sel.id);
    if (planned) return { entry: { kind: 'planned' as const, title: planned.title, badge: planned.badge, key: sel.id }, date: planned.date };
    if (!d) return null;
    const st = (c.sync?.workouts ?? []).find((w: any) => w.key === d.key)?.state;
    return { entry: { kind: (st === 'changed' || st === 'not_pushed' ? 'changed' : 'watch') as EntryKind, title: d.name, key: d.key, badge: d.badge ?? { sport: 'Strength', icon: 'strength', kind: 'strength' } }, date: sel.date ?? '' };
  })() : null;
  const cur = at >= 0 ? list[at] : loose;
  const isOn = (e: Entry, d: string) => !!cur && idOf(cur.entry) === idOf(e) && cur.date === d;
  const send = (kind: string, text: string, prm?: Record<string, unknown>) => {
    setMsg(null);
    // Say where the answer lands (2026-10-17, the flow review): a plan comes back here, as a proposal
    // card; a new daily, as today's call on Today. Not "the coach panel" for either.
    const where = kind === 'plan' || prm?.name === 'week' ? 'Sent — the coach’s proposal appears here on Plan, and on Today, when it’s ready.'
      : prm?.name === 'daily' ? 'Sent — today’s call updates on Today when the coach is done.' : 'Sent — the answer lands in the coach panel.';
    ask(kind, text, prm).then(() => setMsg(where)).catch((e) => setMsg(String(e.message ?? e)));
  };
  const setView = (m: 'week' | 'month') => { setMode(m); setShift(0); };
  const span = mode === 'week'
    ? `${dshort(monday)} – ${dshort(addDays(monday, 6))} · ${weekWord(shift)}`
    : monthName(monthFirst);
  const sent = lastPush(state?.requests);
  const sameDay = cur ? list.find((x) => x.date === cur.date && idOf(x.entry) !== idOf(cur.entry)) : undefined;
  const nav = (i: number) => (list[i] ? { title: list[i].entry.title, go: () => pick(list[i].entry, list[i].date) } : null);
  return (
    <>
      <PageTitle eyebrow="Plan" title="Plan & calendar" right={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn" disabled={offline} onClick={() => send('workflow', 'Plan my week', { name: 'week' })}>Plan my week</button>
          <button type="button" className="btn2 hv" disabled={offline} onClick={() => send('workflow', 'Re-run today’s analysis', { name: 'daily' })}>Re-run today’s analysis</button>
        </div>
      } />
      {msg && <span role="status" style={{ fontSize: 13, color: 'var(--tx2)' }}>{msg}</span>}
      {pending.length > 0 ? (
        <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '12px 16px', borderRadius: 14, border: '1px solid var(--y)', background: 'var(--yt)' }}>
          <Icon d={IC.warn} size={18} sw={2.2} style={{ color: 'var(--y)' }} />
          <span style={{ fontSize: 15, flex: '1 1 260px' }}><b className="n" style={{ fontSize: 18 }}>{pending.length} {pending.length === 1 ? 'change' : 'changes'}</b> not on the watch — {pending.map((w: any) => w.workout).join(', ')}.</span>
          <WatchSendButton showNote />
        </div>
      ) : (
        <span role="status" data-tip={tip(c.defs, 'watch_sync')} tabIndex={0} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, color: c.sync?.unknown ? 'var(--tx2)' : 'var(--g)' }}>
          <Icon d={IC.check} sw={3} />{c.sync?.unknown ? 'Watch status unknown until the next push records it' : 'Watch in sync'}
          {sent && !c.sync?.unknown && <span className="m" style={{ color: 'var(--tx3)' }}>sent {sent} · verified</span>}
        </span>
      )}
      {/* Which week or month: arrows within what the calendar holds, and back to now (docs/DESIGN.md (app audit) U9, U10). */}
      <div role="toolbar" aria-label="Calendar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px' }}>
        <div role="radiogroup" aria-label="View" style={{ display: 'flex', padding: 3, borderRadius: 12, background: 'var(--s2)', border: '1px solid var(--ln)' }}>
          {(['week', 'month'] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setView(m)}
            style={{ minHeight: 36, padding: '0 16px', borderRadius: 9, border: 0, background: mode === m ? 'var(--tx)' : 'transparent', color: mode === m ? 'var(--on)' : 'var(--tx2)', fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>{m}</button>)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" className="btn2 hv" aria-label={`Previous ${mode}`} disabled={shift <= range[0]} onClick={() => setShift(shift - 1)} style={{ minHeight: 36, minWidth: 36, padding: 0 }}><Icon d="M15 6l-6 6 6 6" size={15} /></button>
          <h2 aria-live="polite" className="n" style={{ fontSize: 22, fontWeight: 700, minWidth: mode === 'week' ? 220 : 160, textAlign: 'center' }}>{span}</h2>
          <button type="button" className="btn2 hv" aria-label={`Next ${mode}`} disabled={shift >= range[1]} onClick={() => setShift(shift + 1)} style={{ minHeight: 36, minWidth: 36, padding: 0 }}><Icon d="M9 6l6 6-6 6" size={15} /></button>
        </div>
        {shift !== 0 && <button type="button" className="link" onClick={() => setShift(0)} style={{ border: 0, background: 'none', padding: 0 }}>Back to {mode === 'week' ? 'this week' : 'this month'}</button>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', fontSize: 12, color: 'var(--tx2)' }}>
        {Object.entries(KIND_STYLE).map(([kind, k]) => (
          <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {kind === 'done' || kind === 'watch' ? <Icon d={k.icon} size={12} sw={2.8} style={{ color: k.col }} /> : <span style={{ width: 12, height: 12, borderRadius: 3, border: `1px ${k.dashed ? 'dashed' : 'solid'} ${k.col}` }} />}{k.word}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, border: '1px dashed var(--ln2)' }} />Rest</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, border: '2px solid var(--tx)', boxSizing: 'border-box' }} />Open below</span>
        {(c.trip_days ?? []).length > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, border: '1px dashed var(--c)', background: 'var(--ct)' }} />Away</span>}
        {(c.race_days ?? []).length > 0 && <WinLegend windows={['easy', 'taper', 'recovery', 'race']} defs={rv.data ? (rv.data as any).defs : undefined} />}
      </div>
      {/* Sessions planned where a trip can't hold them (scripts/trips.py → clashes): one request replans around it. */}
      <TripClashes clashes={c.trip_clashes ?? []} defs={c.defs} offline={offline} send={send} />
      {clashes.map((b: any) => {
        const rd = raceDay[b.next];
        return (
          <div key={b.id} role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px', padding: '12px 16px', borderRadius: 12, border: '1px solid var(--r)', background: 'var(--rt)' }}>
            <span style={{ fontWeight: 700, color: 'var(--r)' }}>★! Benchmark inside a window</span>
            <span style={{ fontSize: 14, flex: '1 1 300px' }}>{b.name} is planned {shortDay(b.next)} — {rd.window === 'race' ? 'race day' : `${WIN[rd.window].word.toLowerCase()} day ${rd.day} of ${rd.of}`} for {rd.race.name}. Tests don’t belong there.</span>
            <button type="button" className="btn2 hv" disabled={offline} onClick={() => send('plan', `Move the ${b.name} out of the ${rd.race.name} window`, { about: `benchmark ${b.id}` })}>Propose a change</button>
          </div>
        );
      })}
      {mode === 'week' ? (
        <section aria-label={`Week ${span}`} style={{ overflowX: 'auto', paddingBottom: 2 }}>
          <div style={{ minWidth: 760, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8, alignItems: 'start' }}>
            {Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((d) => {
              const es = entries(d);
              return (
                <div key={d} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px 6px', borderBottom: `2px solid ${d === today ? 'var(--tx)' : 'transparent'}` }}>
                    <span className="l" style={{ color: d === today ? 'var(--tx)' : 'var(--tx3)' }}>{day(d).split(' ')[0]}{d === today ? ' · today' : ''}</span>
                    <span className="n" style={{ fontSize: 18, color: d === today ? 'var(--tx)' : 'var(--tx3)' }}>{Number(d.slice(8))}</span>
                  </div>
                  {raceDay[d] && <RaceDayTag rd={raceDay[d]} card={raceCard(raceDay[d].race.id)} />}
                  {tripDay[d] && <TripDayTag td={tripDay[d]} defs={c.defs} />}
                  {!es.length && !raceDay[d] && <div style={{ minHeight: 112, borderRadius: 12, border: '1px dashed var(--ln2)', display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--tx3)' }}>{d < today ? 'Rested' : 'Rest'}</div>}
                  {es.map((e: any, i: number) => {
                    const k = KIND_STYLE[e.kind] ?? KIND_STYLE.watch;
                    const on = isOn(e, d);
                    // Every session opens below the week — a done one as it was logged, the rest as planned.
                    return (
                      <button key={i} type="button" className="sp-card" onClick={() => pick(e, d)} aria-pressed={on} aria-controls="detail"
                        style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 12, color: 'var(--tx)', opacity: e.kind === 'missed' ? 0.7 : 1,
                          background: on ? 'var(--s2)' : 'var(--s1)', border: `${on ? 2 : 1}px ${k.dashed ? 'dashed' : 'solid'} ${on ? 'var(--tx)' : k.dashed ? k.col : 'var(--ln2)'}`, boxShadow: on ? 'var(--sh)' : 'none' }}>
                        <SportTag b={e.badge} />
                        <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{e.title}</span>
                        {e.zwift && <ZwiftWorkoutLine w={e.zwift} style={{ maxWidth: '100%' }} />}
                        {e.fuel?.needed && <FuelLine plan={e.fuel} compact style={{ maxWidth: '100%' }} />}
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: k.col }}>
                          <Icon d={k.icon} size={12} sw={2.6} />{k.word}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
      ) : <Month first={monthFirst} today={today} entries={entries} isOn={isOn} pick={pick} raceDay={raceDay} raceCard={raceCard} tripDay={tripDay} />}
      <div ref={detail} style={{ display: 'flex', flexDirection: 'column', gap: 20, scrollMarginTop: 16 }}>
        {cur ? (
          <SessionPanel key={`${idOf(cur.entry)}@${cur.date}`} picked={cur} look={KIND_STYLE[cur.entry.kind] ?? KIND_STYLE.watch}
            index={cur.date ? (new Date(`${cur.date}T12:00:00`).getDay() + 6) % 7 : 3}
            prev={at > 0 ? nav(at - 1) : null} next={at >= 0 ? nav(at + 1) : null} close={() => setSel(null)} prog={p} cal={c}
            same={sameDay ? { label: cur.date === today ? 'Also today' : 'Same day', entry: sameDay.entry, look: KIND_STYLE[sameDay.entry.kind] ?? KIND_STYLE.watch, go: () => pick(sameDay.entry, sameDay.date) } : null} />
        ) : (
          <div style={{ padding: '22px 24px', borderRadius: 16, border: '1px dashed var(--ln2)', fontSize: 14, color: 'var(--tx2)' }}>
            {sel ? 'That session isn’t on the days shown. ' : ''}Pick a session in the {mode} to see it here — what it is, why it’s there, and how the watch will run it.
          </div>
        )}
      </div>
      <Proposal r={proposal} />
    </>
  );
}

/** When the watch was last sent to and verified: the newest successful push result. */
function lastPush(requests: AppRequest[] | undefined): string | null {
  const r = [...(requests ?? [])].reverse().find((q) => q.state === 'DONE' && q.result?.kind === 'push_result' && (q.result.payload as any).ok);
  if (!r?.finishedAt) return null;
  const at = new Date(r.finishedAt);
  return `${dow(isoDate(at))} ${at.toTimeString().slice(0, 5)}`;
}

/** A month, its own name above it: each session opens like the week's do (docs/DESIGN.md (app audit) U9). */
/** A day a race shapes, on the week: race day as the race itself (its mark, opens it); a window as its word. */
function RaceDayTag({ rd, card }: { rd: any; card?: RaceCard }) {
  if (rd.window === 'race') return (
    <Link to={`/race/${encodeURIComponent(rd.race.id)}`} className="hv" data-tip={`${rd.race.name} · race day${rd.race.start ? ` · ${rd.race.start}` : ''}.`}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, border: '2px solid var(--tx)', background: 'var(--s2)' }}>
      {card && <RaceTile race={card} size={30} />}
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span className="l" style={{ fontSize: 9, color: 'var(--tx)' }}>{rd.race.priority} · race</span>
        <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.15 }}>{rd.race.name}</span>
        {rd.race.start && <span className="m" style={{ color: 'var(--tx3)' }}>{rd.race.start}</span>}
      </span>
    </Link>
  );
  const k = WIN[rd.window];
  return (
    <span data-tip={`${k.word} day ${rd.day} of ${rd.of} · ${rd.race.name}.`} tabIndex={0} className={k.cls}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: k.cls ? undefined : k.bg, border: `1px solid ${k.bc}` }}>
      <WinSwatch w={rd.window} size={10} />{k.word} {rd.day}/{rd.of} · {rd.race.name}
    </span>
  );
}

function Month({ first, today, entries, isOn, pick, raceDay, raceCard, tripDay }: {
  first: string; today: string; entries: (d: string) => Entry[]; isOn: (e: Entry, d: string) => boolean; pick: (e: Entry, d: string) => void;
  raceDay: Record<string, any>; raceCard: (id: string) => RaceCard | undefined; tripDay: Record<string, TripDayRow>;
}) {
  const start = mondayOf(first);
  const lead = (new Date(`${first}T12:00:00`).getDay() + 6) % 7;   // days of the previous month in the first row
  const days = new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0).getDate();
  const weeks = Math.ceil((lead + days) / 7);   // only the rows the month needs
  return (
    <div role="grid" aria-label={monthName(first)} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="l" style={{ fontSize: 10, textAlign: 'center' }}>{d}</span>)}
      {Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i)).map((d) => {
        const es = entries(d);
        const other = d.slice(0, 7) !== first.slice(0, 7);
        const rd = raceDay[d];
        const k = rd && rd.window !== 'race' ? WIN[rd.window] : null;
        const card = rd?.window === 'race' ? raceCard(rd.race.id) : undefined;
        return (
          <div key={d} className={k?.cls} data-tip={rd ? `${rd.race.name} · ${rd.window === 'race' ? 'race day' : `${WIN[rd.window].word.toLowerCase()} day ${rd.day} of ${rd.of}`}.` : undefined}
            style={{ minHeight: 76, padding: 6, borderRadius: 10, border: `${rd?.window === 'race' ? 2 : 1}px ${tripDay[d] && !rd ? 'dashed' : 'solid'} ${d === today ? 'var(--tx)' : rd ? (k ? k.bc : 'var(--tx)') : tripDay[d] ? 'var(--c)' : 'var(--ln)'}`, background: k && !k.cls ? k.bg : k ? undefined : other ? 'transparent' : 'var(--s1)', opacity: other ? 0.45 : 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="n" style={{ fontSize: 13, color: d === today ? 'var(--tx)' : 'var(--tx3)' }}>{Number(d.slice(8))}</span>
              {k && <span className="l" style={{ fontSize: 8, color: k.bc }}>{k.word}</span>}
              {!k && tripDay[d] && <span className="l" data-tip={`${tripDay[d].trip.where} · day ${tripDay[d].day} of ${tripDay[d].of}.`} style={{ fontSize: 8, color: 'var(--c)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tripDay[d].trip.where}</span>}
            </span>
            {rd?.window === 'race' && (
              <Link to={`/race/${encodeURIComponent(rd.race.id)}`} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                {card && <RaceTile race={card} size={22} />}
                <span style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rd.race.name}</span>
              </Link>
            )}
            {es.slice(0, 3).map((e, i) => {
              const k = KIND_STYLE[e.kind] ?? KIND_STYLE.watch;
              const style = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '1px 4px', borderRadius: 4, border: 0, textAlign: 'left' as const,
                background: k.bg, color: k.col, minWidth: 0, outline: isOn(e, d) ? '2px solid var(--tx)' : undefined };
              const body = <><SportIcon icon={e.badge?.icon} size={11} sw={2.4} /><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span></>;
              const tipText = `${e.badge?.sport ?? ''} · ${e.title}${e.zwift ? `\nZwift workout: ${e.zwift.name}` : ''}\n${k.word}`;
              return <button key={i} type="button" data-tip={tipText} aria-pressed={isOn(e, d)} aria-controls="detail" onClick={() => pick(e, d)} style={style}>{body}</button>;
            })}
            {es.length > 3 && <span className="m" style={{ color: 'var(--tx3)' }}>+{es.length - 3} more</span>}
          </div>
        );
      })}
    </div>
  );
}

/** The coach's proposal, compact (board Plan): where it stands, the week in a sentence, what changes and
 * the first reasons, the rule checks. The full review — every change with its reason — is its own page. */
function Proposal({ r }: { r?: AppRequest }) {
  const { state, ask } = useStore();
  const { data: t } = useView('today');
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!r || r.result?.kind !== 'plan_proposal') return null;
  const p = r.result.payload;
  const st = standing(r, state?.requests, t?.freshness?.data_as_of);
  // Accepted and applied: the calendar holds the week now, so the card goes (2026-10-16).
  if (st.stage === 'accepted') return null;
  const ds = proposalDays(p);
  const n = counts(ds);
  const reasons = ds.filter((d) => d.change !== 'unchanged' && d.reason).slice(0, 2);
  const checks = p.checks ?? [];
  const near = checks.filter((k) => k.status === 'near_limit');
  const broken = checks.filter((k) => k.status === 'broken');
  const k = STAGE[st.stage];
  const offline = state?.coach !== 'online';
  const canAccept = st.stage === 'waiting' && !done && !offline;
  const href = `/plan/proposal/${encodeURIComponent(p.id)}`;
  return (
    <section aria-labelledby="pp" className="card" style={{ borderColor: 'var(--v)', padding: '18px 22px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px' }}>
        <span className="l" style={{ color: 'var(--v)' }}>Plan proposal{p.version ? ` · ${p.version.n} of ${p.version.of}` : ''}</span>
        <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 7, background: k.bg, color: k.c, fontSize: 12, fontWeight: 700 }}>
          <Icon d={IC[k.icon]} size={12} sw={2.6} className={k.icon === 'spinner' ? 'spin' : undefined} />{done ? 'Accepted · sending to the coach' : k.word}
        </span>
        <span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>coach · {new Date(r.finishedAt ?? r.createdAt).toTimeString().slice(0, 5)} · answers “{r.text}”</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px', alignItems: 'center' }}>
        <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 id="pp" className="n" style={{ fontSize: 30, lineHeight: 1.05, fontWeight: 700 }}>{p.headline ?? p.title ?? 'Plan proposal'}</h2>
          <span style={{ fontSize: 14, color: 'var(--tx2)' }}>{spanText(ds)} · {sessionCount(ds)} {sessionCount(ds) === 1 ? 'session' : 'sessions'}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CHANGE_ORDER.filter((c) => n[c] > 0).map((c) => (
            <span key={c} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '6px 10px', borderRadius: 9, fontSize: 13,
              background: c === 'unchanged' ? 'transparent' : CH[c].bg, border: c === 'unchanged' ? '1px dashed var(--ln2)' : '1px solid transparent' }}>
              <b className="n" style={{ fontSize: 16, color: CH[c].c }}>{CH[c].i} {n[c]}</b> {CH[c].word.toLowerCase()}
            </span>
          ))}
        </div>
      </div>
      {(reasons.length > 0 || checks.length > 0 || p.program_changes.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {reasons.map((d) => (
            <div key={d.idx} style={{ display: 'grid', gridTemplateColumns: '74px 1fr', gap: 10, fontSize: 13 }}>
              <span className="m" style={{ color: 'var(--tx3)' }}>{wd(d.date)}</span>
              <span><b>{d.change === 'removed' ? `${d.title} removed` : d.from && d.to && d.change === 'changed' ? `${d.from} → ${d.to}` : d.title}</b> <span style={{ color: 'var(--tx2)' }}>— {d.reason}</span></span>
            </div>
          ))}
          {p.program_changes.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '74px 1fr', gap: 10, fontSize: 13 }}>
              <span className="m" style={{ color: 'var(--tx3)' }}>Program</span>
              <span>{p.program_changes.map((c, i) => <span key={i}>{i > 0 && ' · '}<b>{c.exercise}</b> {String(c.from)} → {String(c.to)} {c.field}</span>)}</span>
            </div>
          )}
          {checks.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '74px 1fr', gap: 10, fontSize: 13 }}>
              <span className="m" style={{ color: 'var(--tx3)' }}>Rules</span>
              <span>
                <span style={{ color: 'var(--g)' }}>✓ <span style={{ color: 'var(--tx)' }}>{checks.length - near.length - broken.length} hold</span></span>
                {near.length > 0 && <span style={{ color: 'var(--y)' }}> · ! {near.length} near limit</span>}
                {broken.length > 0 && <span style={{ color: 'var(--r)' }}> · ✕ {broken.length} broken</span>}
                {[...broken, ...near][0] && <span style={{ color: 'var(--tx2)' }}> ({[...broken, ...near][0].rule.replace(/\.$/, '').toLowerCase()})</span>}
              </span>
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Link to={href} className="btn" style={{ minHeight: 44, padding: '0 18px' }}>Review the proposal<Icon d={IC.arrow} /></Link>
        {/* A refusal is shown, not swallowed (docs/DESIGN.md (app audit) U12). Out of date, or a new version on its way: no accept. */}
        <button type="button" className="btn2 hv" disabled={!canAccept} style={{ minHeight: 44, padding: '0 16px', fontSize: 14 }} onClick={() => {
          setErr(null);
          ask('accept', `Accept plan ${p.id}`, { proposal: p.id })
            .then(() => setDone(`Plan accepted.${p.needs_push ? ' The coach applies it and prepares the watch — you confirm that on the Send-to-watch card.' : ''}`))
            .catch((e) => setErr(String(e.message ?? e)));
        }}>Accept as is</button>
        <span style={{ fontSize: 12, color: 'var(--tx3)', flex: '1 1 240px' }}>
          {done ?? (st.stage === 'stale' ? 'Written before your latest data — review it to have the coach re-check.' : st.stage === 'requested' ? 'The coach is writing a new version; this one stays readable.' : 'Accepting changes the plan only. The watch is a separate step.')}
        </span>
      </div>
      {err && <span role="alert" style={{ fontSize: 13, color: 'var(--r)' }}>Not sent — {err}. Try again.</span>}
    </section>
  );
}
