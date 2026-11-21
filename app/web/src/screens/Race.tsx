/** One race (board Race, variants Race-Hyrox / Race-703 / Race-Result-* / Race-Hyrox-Light / Race-Narrow):
 * what and when, the result once it is run, the target and how you are tracking, the days around it,
 * its format — for HYROX, who takes each station — and every check of its date. */
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore, useView, type Defs } from '../lib/api';
import { elapsed, tip, todayIso } from '../lib/fmt';
import { CallStrip, CheckBlock, CheckChip, RaceWordmark, WinLegend } from '../components/Races';
import { ErrorBox, IC, Icon, Skeleton, Spark } from '../components/ui';
import { CHECK, KIND_COL, SPLITS_FROM, WIN, checkState, checkingNow, daysWord, longDay, prioWord, shortDay, signed, splitColour, type RaceCard, type Split } from '../lib/races';

const DAY = 864e5;
const at = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const monday = (s: string) => iso(at(s) - ((new Date(at(s)).getDay() + 6) % 7) * DAY);
const SOURCE: Record<string, string> = { official: 'the organiser’s site', entry: 'your entry', listing: 'race-calendar listings' };

export default function Race() {
  const { id } = useParams();
  const { data, error, loading } = useView<{ races: RaceCard[]; defs: Defs }>('races');
  const { state, ask, askAbout } = useStore();
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <><Skeleton h={60} /><Skeleton h={240} /><Skeleton h={300} /></>;
  const r = data!.races.find((x) => x.id === id);
  if (!r) return <ErrorBox error="No such race in your season." />;
  const defs = data!.defs;
  const offline = state?.coach !== 'online';
  const checking = checkingNow(state?.requests);
  const cs = checkState(r, checking);
  const isA = r.priority === 'A';
  return (
    <>
      <CallStrip />
      <nav aria-label="Breadcrumb" style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--tx2)' }}>
        <Link to="/season" className="link">Season</Link><span aria-hidden="true">/</span><span style={{ color: 'var(--tx)' }}>{r.name}</span>
      </nav>

      <section aria-labelledby="rh" className="rise card" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: '20px 28px', alignItems: 'flex-start', padding: '22px 24px', border: `${isA ? 2 : 1}px solid ${isA ? 'var(--tx)' : 'var(--ln)'}` }}>
        <RaceWordmark race={r} />
        <div style={{ flex: '1 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span data-tip={tip(defs, 'race_priority')} tabIndex={0} className="n"
              style={{ height: 26, padding: '0 9px', borderRadius: 7, display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 700, background: isA ? 'var(--tx)' : 'transparent', color: isA ? 'var(--on)' : 'var(--tx)', border: '1px solid var(--tx)' }}>{prioWord(r.priority)}</span>
            <span className="l" style={{ color: KIND_COL[r.kind] ?? 'var(--tx2)' }}>{r.kind_label}{r.format?.division ? ` · ${r.format.division}` : ''}</span>
            <CheckChip race={r} state={cs} defs={defs} />
            <span data-tip="Entry status. Source: you." tabIndex={0} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--tx2)' }}>
              <Icon d={IC.check} size={12} sw={2.6} />{r.entry === 'entered' ? 'Entered' : r.entry === 'done' ? 'Raced' : r.entry}
            </span>
          </div>
          <h1 id="rh" className="n" style={{ margin: 0, fontSize: 52, lineHeight: 0.95, fontWeight: 700 }}>{r.name}</h1>
          {r.official_name && r.official_name !== r.name && <span style={{ fontSize: 14, color: 'var(--tx2)' }}>{r.official_name}</span>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', paddingTop: 4 }}>
            <Fact label="Date" tipText={`${longDay(r.date)}. Checked against ${SOURCE[r.verified.source_kind] ?? r.verified.source_kind}.`}><span className="n" style={{ fontSize: 20, fontWeight: 700 }}>{longDay(r.date)}</span></Fact>
            <Fact label="Start" tipText={r.start_note ?? 'Start time.'}><span className="n" style={{ fontSize: 20, fontWeight: 700 }}>{r.start ?? '—'}</span></Fact>
            {r.where && <Fact label="Where" tipText="Venue. Source: organiser (via the coach’s check)."><span style={{ fontSize: 15, fontWeight: 600 }}>{[r.where.venue, r.where.city].filter(Boolean).join(' · ')}</span></Fact>}
          </div>
          {r.start_note && <span style={{ fontSize: 12, color: 'var(--tx3)' }}>{r.start_note}</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          <div data-tip={`${daysWord(r.days_to)} — ${longDay(r.date)}.\n${tip(defs, 'race_countdown') ?? ''}`} tabIndex={0} style={{ textAlign: 'right' }}>
            <div className="n" style={{ fontSize: 72, fontWeight: 700, lineHeight: 0.85 }}>{r.days_to === 0 ? 'Today' : Math.abs(r.days_to)}</div>
            <div className="l" style={{ fontSize: 10 }}>{r.days_to === 0 ? 'race day' : r.past ? 'days ago' : 'days to go'}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="btn2 hv" disabled={offline} onClick={() => askAbout(`${r.name} (${longDay(r.date)})`)}>Ask about this</button>
            <button type="button" className="btn2 hv" disabled={offline} onClick={() => ask('plan', `Propose how to prepare for ${r.name}`, { about: `race ${r.id}` })}>Propose a change</button>
            {!r.past && <button type="button" className="btn2 hv" disabled={offline || checking} onClick={() => ask('workflow', `Check the date of ${r.name}`, { name: 'races', about: `race ${r.id}` })}>
              <Icon d={checking ? IC.spinner : IC.refresh} size={13} className={checking ? 'spin' : undefined} />{checking ? 'Checking…' : 'Check dates'}</button>}
          </div>
        </div>
      </section>

      {r.result && <Result r={r} defs={defs} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 16 }}>
        <Tracking r={r} defs={defs} />
        <Around r={r} defs={defs} />
      </div>

      <Format r={r} />

      <section aria-labelledby="ch" className="card" style={{ padding: 0, gap: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px', padding: '16px 20px', borderBottom: '1px solid var(--ln)' }}>
          <h2 id="ch" className="l" style={{ color: 'var(--tx)' }}>Date check · history</h2>
          <span className="m" style={{ marginLeft: 'auto', color: r.check_due ? 'var(--y)' : 'var(--tx3)' }} data-tip={tip(defs, 'race_check')} tabIndex={0}>
            {r.check_due ? `check due — ${r.check_due.why}` : 'no check due'}
          </span>
        </div>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--ln)' }}><CheckBlock race={r} state={cs} defs={defs} /></div>
        <HistoryRow d={r.verified.checked} k={r.verified.status === 'confirmed' ? 'ok' : r.verified.status === 'differs' ? 'warn' : 'q'}
          title={r.verified.status === 'confirmed' ? `Confirmed by ${SOURCE[r.verified.source_kind]}` : r.verified.status === 'differs' ? 'The organiser names another date' : 'Couldn’t confirm'}
          src={r.verified.source} found={r.verified.found?.date ? `${longDay(r.verified.found.date)}${r.verified.found.start ? ` · ${r.verified.found.start}` : ''}` : '—'} note={r.verified.note} />
        {(r.verified.listings ?? []).length > 0 && (
          <HistoryRow d={r.verified.checked} k="list" title={`${r.verified.listings!.length} listings`} src={r.verified.listings!.map((u) => u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]).join(' · ')}
            found="—" note="Third-party race calendars: never authoritative on their own." />
        )}
        {(r.verified.history ?? []).map((h, i) => (
          <HistoryRow key={i} d={null} k="old" title="Earlier value" src={h.from ?? ''} found={longDay(h.date)} struck note={h.why} />
        ))}
      </section>
    </>
  );
}

const Fact = ({ label, tipText, children }: { label: string; tipText: string; children: ReactNode }) => (
  <span data-tip={tipText} tabIndex={0}><span className="l" style={{ fontSize: 9 }}>{label}</span><br />{children}</span>
);

function HistoryRow({ d, k, title, src, found, note, struck }: { d: string | null; k: 'ok' | 'warn' | 'q' | 'list' | 'old'; title: string; src: string | null; found: string; note?: string; struck?: boolean }) {
  const [bg, c, i] = ({ ok: ['var(--gt)', 'var(--g)', CHECK.confirmed.i], warn: ['var(--rt)', 'var(--r)', CHECK.differs.i], q: ['var(--yt)', 'var(--y)', CHECK.unconfirmed.i],
    list: ['var(--s3)', 'var(--tx2)', CHECK.listings.i], old: ['var(--s3)', 'var(--tx3)', IC.minus] } as Record<string, [string, string, string]>)[k];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '72px 26px minmax(0, 1fr) minmax(0, 1fr)', gap: 12, alignItems: 'start', padding: '12px 20px', borderBottom: '1px solid var(--ln)' }}>
      <span className="n" style={{ fontSize: 15, color: 'var(--tx2)' }}>{d ? shortDay(d).split(' ').slice(1).join(' ') : ''}</span>
      <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', background: bg, color: c }}><Icon d={i} size={12} sw={2.8} /></span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{title}</span>
        <span className="m" style={{ color: 'var(--tx3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src}</span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="n" style={{ fontSize: 16, fontWeight: 700, textDecoration: struck ? 'line-through' : 'none', color: struck ? 'var(--tx3)' : 'var(--tx)' }}>{found}</span>
        {note && <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{note}</span>}
      </span>
    </div>
  );
}

/** After the race: the time, against the target, and the Garmin activity; then its splits by discipline,
 * read from that activity, and each against the race's reference. */
function Result({ r, defs }: { r: RaceCard; defs: Defs }) {
  const res = r.result!;
  const met = res.vs_target_s != null ? res.vs_target_s < 0 : null;
  const c = met == null ? 'var(--tx)' : met ? 'var(--g)' : 'var(--r)';
  return (
    <section aria-labelledby="rs" className="rise card" style={{ border: `2px solid ${c}`, padding: '22px 24px', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '14px 32px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 id="rs" className="l" style={{ color: 'var(--tx)' }}>Result</h2>
          <span data-tip="Finish time from the Garmin activity. Source: Garmin." tabIndex={0} className="n" style={{ fontSize: 96, fontWeight: 700, lineHeight: 0.85 }}>{res.time}</span>
        </div>
        {met != null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 700, color: c }}><Icon d={met ? IC.check : IC.x} size={20} sw={2.8} />{met ? 'Target met' : 'Target missed'}</span>
            <span data-tip={`Result minus target. Computed.\n${tip(defs, 'race_target') ?? ''}`} tabIndex={0} className="n" style={{ fontSize: 22 }}>
              {signed(res.vs_target_s!)} <span style={{ fontSize: 15, color: 'var(--tx2)' }}>vs target sub {r.target?.under}</span>
            </span>
          </div>
        )}
        {res.note && <span style={{ fontSize: 14, color: 'var(--tx2)', flex: '1 1 240px' }}>{res.note}</span>}
        {res.activity_id && <Link to={`/workouts/${res.activity_id}`} className="btn2 hv" style={{ marginLeft: 'auto', minHeight: 44 }}><Icon d={IC.watch} size={15} sw={2} />Garmin activity</Link>}
      </div>
      {res.splits && <Splits r={r} defs={defs} />}
    </section>
  );
}

/** The result's splits as one bar, each discipline as wide as its time, and — when the race has a
 * reference — each discipline against it (board Race, the result section). All from the view. */
function Splits({ r, defs }: { r: RaceCard; defs: Defs }) {
  const res = r.result!;
  const parts = res.splits!;
  const ref = r.reference;
  const words = [...new Set(parts.map((s) => (/^T\d$/.test(s.label) ? 'transitions' : s.label.toLowerCase())))].join(', ');
  const from = res.splits_from ? SPLITS_FROM[res.splits_from] : 'the Garmin activity';
  const label = (s: Split) => (s.n > 1 && s.discipline !== 'roxzone'
    ? `${s.label} · ${s.discipline === 'runs' && r.format?.run_km ? `${r.format.run_km} km` : s.n}` : s.label);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="l" style={{ fontSize: 10 }}>Splits · {words}</span>
      <div role="img" aria-label={`Splits: ${parts.map((s) => `${s.label} ${elapsed(s.seconds)}`).join(', ')}`} style={{ display: 'flex', height: 40, gap: 2, borderRadius: 8, overflow: 'hidden' }}>
        {parts.map((s) => {
          const col = splitColour(s.discipline);
          return (
            <div key={s.discipline} className="split" data-tip={`${label(s)} ${elapsed(s.seconds)}. Source: ${from}.\n${tip(defs, 'race_splits') ?? ''}`} tabIndex={0}
              style={{ flex: `${s.seconds} 1 0`, minWidth: 0, background: col.fill, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8px', overflow: 'hidden' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: col.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label(s)}</span>
              <span className="n" style={{ fontSize: 14, color: col.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{elapsed(s.seconds)}</span>
            </div>
          );
        })}
      </div>
      {res.vs_reference && ref && (<>
        <span className="l" style={{ fontSize: 9, paddingTop: 4 }}>Against {ref.name} · {ref.time}</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 1, background: 'var(--ln)', borderRadius: 10, overflow: 'hidden' }}>
          {res.vs_reference.map((c) => (
            <div key={c.key} data-tip={`${c.label} ${elapsed(c.seconds)} against ${elapsed(c.reference_s)} at ${ref.name}. Computed.`} tabIndex={0} style={{ background: 'var(--s2)', padding: '10px 12px' }}>
              <div className="l" style={{ fontSize: 9 }}>{c.label}</div>
              <div className="n" style={{ fontSize: 20, fontWeight: 700 }}>{elapsed(c.seconds)}</div>
              <div className="n" style={{ fontSize: 14, color: c.delta_s <= 0 ? 'var(--g)' : 'var(--r)' }}>{signed(c.delta_s)}</div>
            </div>
          ))}
        </div>
      </>)}
    </div>
  );
}

/** The target, and how you are tracking: Garmin's prediction where one exists, the reference result
 * the target is read against, and the benchmarks that predict the race. Never a guess. */
function Tracking({ r, defs }: { r: RaceCard; defs: Defs }) {
  const p = r.prediction;
  const ref = r.reference;
  const under = r.target?.seconds ?? null;
  return (
    <section aria-labelledby="tt" className="card" style={{ padding: '18px 20px' }}>
      <h2 id="tt" className="l" style={{ color: 'var(--tx)' }}>Target · how you’re tracking</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 28px', alignItems: 'flex-end' }}>
        <div data-tip={tip(defs, 'race_target')} tabIndex={0}><div className="l" style={{ fontSize: 9 }}>Target</div><div className="n" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }}>{r.target ? `sub ${r.target.under}` : '—'}</div></div>
        <div data-tip={tip(defs, 'race_prediction')} tabIndex={0} style={{ minWidth: 0 }}>
          <div className="l" style={{ fontSize: 9 }}>Predicted</div>
          {p ? (<>
            <div className="n" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: p.vs_target_s != null && p.vs_target_s <= 0 ? 'var(--g)' : 'var(--y)' }}>
              {elapsed(p.value_s)}{p.vs_target_s != null && <span style={{ fontSize: 16, color: 'var(--tx2)' }}> {signed(p.vs_target_s)}</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--tx2)' }}>Garmin, {shortDay(p.as_of)} · best {elapsed(p.best.value_s)} on {shortDay(p.best.date)}</div>
          </>) : (<>
            <div className="n" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: 'var(--tx3)' }}>not tested yet</div>
            <div style={{ fontSize: 12, color: 'var(--tx2)' }}>No predictor for this race yet — never a guess.</div>
          </>)}
        </div>
      </div>
      {p && p.trend.length > 1 && (
        <div data-tip={`Garmin's predicted time, one point a week for the past year; up is faster, the dashed line is the target.\n${tip(defs, 'race_prediction') ?? ''}`} tabIndex={0}>
          <span className="l" style={{ fontSize: 9 }}>Prediction · past year · faster ↑</span>
          <Spark values={p.trend.map((x) => -x.value_s)} base={under != null ? -under : null} h={44} color={p.vs_target_s != null && p.vs_target_s <= 0 ? 'var(--g)' : 'var(--y)'} />
        </div>
      )}
      {ref && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="l" style={{ fontSize: 9 }}>Reference · {ref.name}, {shortDay(ref.date)} {ref.date.slice(0, 4)} · {ref.time}</span>
          <div role="img" aria-label={`${ref.name} splits: ${ref.splits.map((s) => `${s.name} ${s.time}`).join(', ')}`} style={{ display: 'flex', height: 28, gap: 2, borderRadius: 6, overflow: 'hidden' }}>
            {ref.splits.map((s) => {
              const col = splitColour(s.discipline);
              return (
                <div key={s.name} className="split" data-tip={`${s.name} ${s.time}. Source: ${ref.splits_from ? SPLITS_FROM[ref.splits_from] : 'typed in with the reference'}.${ref.note ? `\n${ref.note}` : ''}`} tabIndex={0}
                  style={{ flex: `${s.seconds} 1 0`, minWidth: 0, background: col.fill, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, color: col.text, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name.split(' ')[0]} {s.time.split(':').length === 3 ? s.time.replace(/:00$/, '') : s.time}</span>
                </div>
              );
            })}
          </div>
          {ref.target_gap_s != null && ref.target_gap_s > 0 && (
            <span style={{ fontSize: 13, color: 'var(--tx2)' }}>Sub {r.target?.under} is <b className="n" style={{ fontSize: 15, color: 'var(--tx)' }}>{elapsed(ref.target_gap_s)}</b> faster than {ref.name}.</span>
          )}
        </div>
      )}
      {r.benchmarks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="l" style={{ fontSize: 9 }}>Benchmarks that predict it</span>
          {r.benchmarks.map((b) => (
            <div key={b.id} data-tip={`${b.name}: next ${longDay(b.next)}${b.last ? `, last ${b.last.value} on ${shortDay(b.last.date)}` : ', not done yet'}${b.in_window ? ` — inside the race’s ${b.in_window} days, flagged: it moves` : ''}.\nSource: Coach (program.py BENCHMARKS).`} tabIndex={0}
              style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center', padding: '8px 10px', borderRadius: 8, background: 'var(--s2)' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>★ {b.name}</span>
              <span className="n" style={{ fontSize: 15, color: b.last ? 'var(--tx)' : 'var(--tx3)' }}>{b.last ? `${b.last.value}${b.unit && b.unit !== 'time' ? ` ${b.unit}` : ''}` : 'not yet'}</span>
              <span className="m" style={{ color: b.in_window ? 'var(--r)' : 'var(--tx2)' }}>{shortDay(b.next)}{b.in_window ? ` ! ${b.in_window}` : ''}{!b.last && b.timing === 'overdue' ? ' · not done' : !b.last && b.timing === 'after_race' ? ' · after the race' : ''}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** The weeks around the race, each day in its window: easy or taper before, the race, recovery after. */
function Around({ r, defs }: { r: RaceCard; defs: Defs }) {
  const w = r.windows;
  const today = todayIso();
  const firstWin = w.before?.from ?? r.date;
  const lastWin = w.recovery?.to ?? r.date;
  const start = iso(at(monday(firstWin)) - 7 * DAY);
  const end = iso(at(monday(lastWin)) + 6 * DAY);
  const days: string[] = [];
  for (let t = at(start); t <= at(end); t += DAY) days.push(iso(t));
  const bench = Object.fromEntries(r.benchmarks.map((b) => [b.next, b]));
  const winOf = (d: string): string | null => (d === r.date ? 'race' : w.before && d >= w.before.from && d <= w.before.to ? w.before.window
    : w.recovery && d >= w.recovery.from && d <= w.recovery.to ? 'recovery' : null);
  const legend = [w.before?.window, 'recovery', 'race'].filter(Boolean) as string[];
  return (
    <section aria-labelledby="wc" className="card" style={{ padding: '18px 20px', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}>
        <h2 id="wc" className="l" style={{ color: 'var(--tx)' }}>Days around the race</h2>
        <WinLegend windows={legend} defs={defs} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="l" style={{ fontSize: 9, textAlign: 'center' }}>{d}</span>)}
        {days.map((d) => {
          const k = winOf(d);
          const race = k === 'race';
          const b = bench[d];
          const isToday = d === today;
          const calm = k === 'recovery' && w.recovery && w.recovery.no_intensity_to !== w.recovery.to && d <= w.recovery.no_intensity_to;
          const lab = race ? `${r.priority} · RACE` : k ? `${WIN[k].word}${calm ? ' · no int.' : ''}` : b ? `★ ${b.name.split(' ').slice(0, 2).join(' ')}` : '';
          const ruleKey = k === 'easy' ? 'race_easy' : k === 'taper' ? 'race_taper' : k === 'recovery' ? 'race_recovery' : k === 'race' ? 'race_day' : null;
          return (
            <div key={d} tabIndex={0} className={k ? WIN[k].cls : undefined}
              data-tip={`${longDay(d)}${k ? ` · ${WIN[k].word.toLowerCase()}` : ''}${b ? ` · benchmark ${b.name}${b.in_window ? ' — inside the window, flagged' : ''}` : ''}.${ruleKey ? `\n${tip(defs, ruleKey) ?? ''}` : ''}`}
              style={{ minHeight: 54, borderRadius: 8, padding: '5px 6px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                background: race ? 'var(--tx)' : k && !WIN[k].cls ? WIN[k].bg : k ? undefined : 'var(--s2)', border: `${isToday ? 2 : 1}px solid ${race ? 'var(--tx)' : k ? WIN[k].bc : isToday ? 'var(--id)' : 'var(--ln)'}` }}>
              <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="n" style={{ fontSize: 14, fontWeight: race ? 700 : 500, color: race ? 'var(--on)' : 'var(--tx)' }}>{Number(d.slice(8))}{d.slice(8) === '01' ? ` ${shortDay(d).split(' ')[2]}` : ''}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: b?.in_window ? 'var(--r)' : b ? 'var(--y)' : 'var(--id)' }}>{b ? (b.in_window ? '★!' : '★') : isToday ? '●' : ''}</span>
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1.1, color: race ? 'var(--on)' : 'var(--tx)' }}>{lab}</span>
            </div>
          );
        })}
      </div>
      <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{tip(defs, r.priority === 'A' ? 'race_taper' : 'race_easy')?.split('\n')[0]} {w.text}.</span>
    </section>
  );
}

/** The format: for HYROX, who takes each station; for a triathlon, its three legs; otherwise the facts. */
function Format({ r }: { r: RaceCard }) {
  const f = r.format ?? {};
  const legs = [['Swim', f.swim_km, 'var(--swim)'], ['Bike', f.bike_km, 'var(--ride)'], ['Run', f.run_km, 'var(--run)']].filter(([, km]) => km != null) as [string, number, string][];
  const facts = [
    f.distance_km != null && ['Distance', `${Number(f.distance_km).toLocaleString('en-GB', { maximumFractionDigits: 1 })} km`],
    f.elevation_gain_m != null && ['Climbing', `+${Number(f.elevation_gain_m).toLocaleString('en-GB')} m`],
    f.unpaved_pct != null && ['Unpaved', `${f.unpaved_pct} %`],
    f.cutoff && ['Cut-off', String(f.cutoff)],
  ].filter(Boolean) as [string, string][];
  const summary = r.stations.length ? `${f.run_km ?? 8} × 1 km run + ${r.stations.length} stations${f.division ? ` · ${f.division}` : ''}${r.split?.runs ? ` · runs ${r.split.runs}` : ''}`
    : legs.length ? legs.map(([n, km]) => `${km} km ${n.toLowerCase()}`).join(' · ') : facts.map(([k, x]) => `${k} ${x}`).join(' · ');
  return (
    <section aria-labelledby="fm" className="card" style={{ padding: '18px 20px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'baseline' }}>
        <h2 id="fm" className="l" style={{ color: 'var(--tx)' }}>Format</h2>
        <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{summary}{f._note ? ` · ${f._note}` : ''}</span>
      </div>
      {r.stations.length > 0 && (<>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 900, display: 'grid', gridTemplateColumns: `96px repeat(${r.stations.length}, minmax(0, 1fr))`, gap: 6 }}>
            <span className="l" style={{ fontSize: 9, alignSelf: 'end' }}>Order</span>
            {r.stations.map((s, i) => (
              <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 4, borderBottom: '2px solid var(--run)' }}>
                <span className="m" style={{ color: 'var(--run)' }}>1 km run · together</span>
                <span className="n" style={{ fontSize: 16, fontWeight: 700 }}>{i + 1} · {s.name.replace('Burpee broad jumps', 'BBJ').replace('Sandbag lunges', 'Lunges').replace('Farmers carry', 'Farmers')}</span>
              </div>
            ))}
            <span className="l" style={{ fontSize: 10, alignSelf: 'center' }}>Partner</span>
            {r.stations.map((s) => (
              <div key={s.key} style={{ minHeight: 64 }}>
                {s.who === 'partner' && (
                  <Link to="/program#cn" data-tip={`${s.name} — your partner takes it. Removed from your program for a medical reason; locked by the same tests. Changing it is a medical decision.`}
                    style={{ height: '100%', minHeight: 64, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 3, padding: 8, borderRadius: 10, background: 'var(--s2)', border: '1px solid var(--ln2)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--tx2)' }}><Icon d={IC.lock} size={10} sw={2.6} />Locked</span>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{s.name} · {s.distance}</span>
                    <span className="m" style={{ color: 'var(--tx3)' }}>{s.load ?? '—'}</span>
                  </Link>
                )}
              </div>
            ))}
            <span className="l" style={{ fontSize: 10, alignSelf: 'center' }}>You or shared</span>
            {r.stations.map((s) => (
              <div key={s.key} style={{ minHeight: 64 }}>
                {s.who !== 'partner' && (
                  <div data-tip={`${s.name} ${s.distance}${s.load ? ` · ${s.load}` : ''} — you take it or share it with your partner.`} tabIndex={0}
                    style={{ height: '100%', minHeight: 64, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 3, padding: 8, borderRadius: 10, background: 'var(--vt)', border: '1px dashed var(--circ)' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--circ)' }}>{s.who === 'mine' ? 'YOU' : 'YOU OR SHARED'}</span>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{s.name} · {s.distance}</span>
                    <span className="m" style={{ color: 'var(--tx3)' }}>{s.load ?? '—'}</span>
                    <span style={{ marginTop: 'auto', fontSize: 10, color: 'var(--tx2)' }}>split decided on the day</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        {r.stations.some((s) => s.who === 'partner') && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center', fontSize: 12, color: 'var(--tx2)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" size={12} sw={2.4} style={{ color: 'var(--g)' }} />
              The split is held by the same automated tests as your program’s constraint — changing it is a medical decision.</span>
            <Link to="/program#cn" className="link" style={{ fontSize: 12 }}>See the constraint</Link>
          </div>
        )}
      </>)}
      {!r.stations.length && legs.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 10 }}>
          {legs.map(([n, km, c]) => (
            <div key={n} style={{ padding: 14, borderRadius: 12, background: 'var(--s2)', borderTop: `3px solid ${c}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="l" style={{ fontSize: 10, color: c }}>{n}</span>
              <span className="n" style={{ fontSize: 32, fontWeight: 700, lineHeight: 1 }}>{km} km</span>
              {n === 'Swim' && r.where?.venue && <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{r.where.venue}</span>}
            </div>
          ))}
        </div>
      )}
      {!r.stations.length && !legs.length && facts.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: 10 }}>
          {facts.map(([k, x]) => (
            <div key={k} style={{ padding: 14, borderRadius: 12, background: 'var(--s2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="l" style={{ fontSize: 10 }}>{k}</span>
              <span className="n" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{x}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
