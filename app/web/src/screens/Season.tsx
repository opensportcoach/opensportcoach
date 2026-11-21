/** Season (board Season, variants Season-Light / Season-Narrow / Season-Empty): the next race and what
 * today owes it, and the season: blocks, the days around each race, the races as pins, the tests — and
 * every race as a card under its pin. */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useStore, useView, type Defs } from '../lib/api';
import { tip, todayIso } from '../lib/fmt';
import { CallStrip, RaceCardView, WinLegend } from '../components/Races';
import { SportIcon } from '../components/SportIcon';
import { ErrorBox, IC, Icon, Skeleton } from '../components/ui';
import { KIND_COL, MONTHS, WIN, checkingNow, daysWord, longDay, shortDay, type RaceCard, type Season as SeasonData } from '../lib/races';

const DAY = 864e5;
const at = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const monthFirst = (s: string) => `${s.slice(0, 7)}-01`;
const monthLast = (s: string) => iso(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)), 0) + 12 * 3600e3);

interface RacesView { races: RaceCard[]; next: RaceCard | null; today: any; season: (SeasonData & { planned?: boolean }) | null; due: any[]; defs: Defs }

export default function Season() {
  const { data, error, loading } = useView<RacesView>('races');
  const { state, ask, askAbout } = useStore();
  const [zoom, setZoom] = useState<'season' | 'next'>('season');
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <><Skeleton h={60} /><Skeleton h={240} /><Skeleton h={330} /></>;
  const v = data!;
  const races = v.races;
  const offline = state?.coach !== 'online';
  const checking = checkingNow(state?.requests);
  const upcoming = races.filter((r) => !r.past);
  const a = v.season?.race ?? null;
  // The season's span: from today, or the block in force if it began earlier, to the last recovery day.
  const first = [todayIso(), ...(v.season?.blocks ?? []).filter((b) => b.current).map((b) => b.start), ...(races.length ? [races[0].date] : [])].sort()[0];
  const last = races.length ? (races[races.length - 1].windows.recovery?.to ?? races[races.length - 1].date) : todayIso();
  const span = races.length ? `${MONTHS[Number(first.slice(5, 7)) - 1]} ${first.slice(0, 4)} – ${MONTHS[Number(last.slice(5, 7)) - 1]} ${last.slice(0, 4)}` : '';
  const title = !races.length ? 'No races yet' : `${races.length} ${races.length === 1 ? 'race' : 'races'}${a ? ` · peaking for the ${a.kind === 'triathlon_70_3' ? '70.3' : a.name}` : ''}`;
  const checkDates = () => {
    setMsg(null);
    ask('workflow', 'Check my race dates online', { name: 'races' })
      .then(() => setMsg('The coach is looking the races up online — each card says so until it is done.'))
      .catch((e) => setMsg(String(e.message ?? e)));
  };
  return (
    <>
      <CallStrip />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px 20px' }}>
        <div>
          <span className="l">Season{span ? ` · ${span}` : ''}</span>
          <h1 className="n" style={{ margin: '4px 0 0', fontSize: 48, lineHeight: 1, fontWeight: 700 }}>{title}</h1>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn2 hv" disabled={offline || checking || !upcoming.length} onClick={checkDates} style={{ minHeight: 44, fontSize: 14 }}
            data-tip={tip(v.defs, 'race_check')}>
            <Icon d={checking ? IC.spinner : IC.refresh} size={15} sw={2.2} className={checking ? 'spin' : undefined} />{checking ? 'Checking dates…' : 'Check dates'}
          </button>
          <button type="button" className="btn2 hv" disabled={offline} onClick={() => askAbout('My race season')} style={{ minHeight: 44, fontSize: 14 }}>
            <Icon d={IC.chat} size={15} sw={2} />Ask about this
          </button>
          <button type="button" className="btn" disabled={offline} onClick={() => askAbout('Add a race: ')} style={{ minHeight: 44, fontSize: 14 }}>
            <Icon d="M12 5v14M5 12h14" size={15} sw={2.4} />Add a race
          </button>
        </div>
      </div>
      {msg && <span role="status" style={{ fontSize: 13, color: 'var(--tx2)' }}>{msg}</span>}
      {races.length ? (
        <>
          {v.next && <NextRace v={v} />}
          <Timeline v={v} zoom={zoom} setZoom={setZoom} />
        </>
      ) : <EmptySeason offline={offline} onAdd={() => askAbout('Add a race: ')} />}
    </>
  );
}

/** The next race, big: the days to it, what today owes it, and the A race the season peaks for. */
function NextRace({ v }: { v: RacesView }) {
  const n = v.next!;
  const today = v.today;
  const a = v.season?.race ? v.races.find((r) => r.id === v.season!.race!.id) ?? null : null;
  const before = n.windows.before;
  const word = today?.window && today.window !== 'build' ? WIN[today.window]?.word : null;
  const fmt = n.format?.division ?? n.kind_label;
  return (
    <section aria-labelledby="nx" className="rise card" style={{ padding: '22px 26px', flexDirection: 'row', flexWrap: 'wrap', gap: '20px 32px', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 300px' }}>
        <span id="nx" className="l" style={{ color: 'var(--tx)' }}>Next race</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span data-tip={`${daysWord(n.days_to)} to ${longDay(n.date)}.\n${tip(v.defs, 'race_countdown') ?? ''}`} tabIndex={0} className="n big" style={{ fontSize: 120, lineHeight: 0.82, fontWeight: 700 }}>{n.days_to}</span>
          <span className="n" style={{ fontSize: 26, fontWeight: 600, color: 'var(--tx2)' }}>{n.days_to === 1 ? 'day to' : 'days to'}</span>
        </div>
        <Link to={`/race/${encodeURIComponent(n.id)}`} className="n" style={{ fontSize: 30, fontWeight: 700 }}>{n.name} · {n.priority}</Link>
        <span style={{ fontSize: 14, color: 'var(--tx2)' }}>
          {shortDay(n.date)} · {fmt}{n.target && <> · target <b className="n" style={{ fontSize: 16, color: 'var(--tx)' }}>sub {n.target.under}</b></>}
        </span>
      </div>
      <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="l">What today owes it</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Owe tip={today?.rule ?? tip(v.defs, 'race_windows')} mark={word ? <WinDot w={today.window} /> : <span aria-hidden="true" style={{ color: 'var(--o)', fontWeight: 700 }}>▲</span>}>
            {word ? <><b>{word} day{today.day && today.of ? ` ${today.day} of ${today.of}` : ''}.</b> {today.rule}</> : <><b>Build day.</b> No window yet — train as planned.</>}
          </Owe>
          {before && before.from > todayIso() && (
            <Owe tip={tip(v.defs, before.window === 'taper' ? 'race_taper' : 'race_easy')} mark={<WinDot w={before.window} />}>
              {WIN[before.window].word} from <b>{shortDay(before.from)}</b> · in {daysWord(n.days_to - before.days)}
            </Owe>
          )}
          {(n.benchmarks ?? []).length > 0 && (
            <Owe tip="The benchmarks that predict this race, from your program. Source: coach." mark={<span aria-hidden="true" style={{ color: 'var(--y)', fontWeight: 700 }}>★</span>}>
              Predictors: {n.benchmarks.map((b, i) => (
                <span key={b.id}>{i > 0 && ' · '}<b>{b.name}</b> ({b.last ? `last ${b.last.value}` : b.timing === 'overdue' ? `not done · was due ${shortDay(b.next)}` : b.timing === 'after_race' ? `${shortDay(b.next)}, after the race` : shortDay(b.next)}{b.in_window ? <span style={{ color: 'var(--r)' }}> — inside the {b.in_window} days, flagged</span> : ''})</span>
              ))}
            </Owe>
          )}
        </div>
      </div>
      {a && a.id !== n.id && (
        <Link to={`/race/${encodeURIComponent(a.id)}`} data-tip={`${daysWord(a.days_to)} to ${longDay(a.date)}.\n${tip(v.defs, 'race_priority') ?? ''}`}
          style={{ flex: '0 1 220px', padding: '14px 16px', borderRadius: 14, border: '2px solid var(--tx)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="l" style={{ color: 'var(--tx)' }}>Season peaks · A race</span>
          <span className="n" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }}>{a.days_to} <span style={{ fontSize: 16, color: 'var(--tx2)' }}>days</span></span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{a.name}</span>
          {a.windows.before && <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{WIN[a.windows.before.window].word} from {shortDay(a.windows.before.from)}</span>}
        </Link>
      )}
    </section>
  );
}
const WinDot = ({ w }: { w: string }) => (
  <span aria-hidden="true" className={WIN[w]?.cls} style={{ width: 12, height: 12, flex: 'none', borderRadius: 3, background: WIN[w]?.cls ? undefined : WIN[w]?.bg, border: `1px solid ${WIN[w]?.bc}` }} />
);
const Owe = ({ tip: t, mark, children }: { tip?: string | null; mark: ReactNode; children: ReactNode }) => (
  <div data-tip={t ?? undefined} tabIndex={0} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 10, background: 'var(--s2)', fontSize: 14 }}>{mark}<span>{children}</span></div>
);

/** The season on one time axis, in four lanes — blocks, the days around each race, the races, the tests —
 * and the races as equal cards below, in date order, each joined to its pin by a leader (board Season,
 * 2026-10-16). A race is a point in time, so it is a pin on its date, never a box. "Next 8 weeks" zooms in;
 * a race beyond the range keeps its card, and its leader points off the edge. */
function Timeline({ v, zoom, setZoom }: { v: RacesView; zoom: 'season' | 'next'; setZoom: (z: 'season' | 'next') => void }) {
  const today = todayIso();
  const races = v.races;
  const blocks = v.season?.blocks ?? [];
  const starts = [today, ...races.map((r) => r.windows.before?.from ?? r.date), ...blocks.map((b) => b.start)].sort();
  const ends = [today, ...races.map((r) => r.windows.recovery?.to ?? r.date), ...blocks.map((b) => b.end)].sort();
  const [a, z] = zoom === 'season' ? [monthFirst(starts[0]), monthLast(ends[ends.length - 1])] : [iso(at(today) - 7 * DAY), iso(at(today) + 56 * DAY)];
  const A = at(a), Z = at(z) + DAY, spanMs = Z - A;
  const X = (s: string) => Math.max(0, Math.min(100, ((at(s) - A) / spanMs) * 100));
  const W = (s: string, e: string) => Math.max(0, Math.min(100 - X(s), ((at(e) + DAY - at(s)) / spanMs) * 100));
  const inR = (s: string) => at(s) >= A && at(s) < Z;
  const ticks: { x: number; n: string }[] = [];
  if (zoom === 'season') {
    for (let t = at(a); t < Z; t = at(monthFirst(iso(t + 32 * DAY)))) {
      const d = iso(t);
      ticks.push({ x: X(d), n: `${MONTHS[Number(d.slice(5, 7)) - 1]}${d.slice(5, 7) === '01' ? ` ’${d.slice(2, 4)}` : ''}` });
    }
  } else {
    for (let t = at(a) - (((new Date(at(a)).getDay() + 6) % 7) * DAY); t < Z; t += 7 * DAY) if (t >= A) ticks.push({ x: X(iso(t)), n: `Mon ${shortDay(iso(t)).split(' ').slice(1).join(' ')}` });
  }
  const wins = races.flatMap((r) => [
    r.windows.before && { k: r.windows.before.window, s: r.windows.before.from, e: r.windows.before.to, r },
    r.windows.recovery && { k: 'recovery', s: r.windows.recovery.from, e: r.windows.recovery.to, r },
  ].filter(Boolean) as { k: string; s: string; e: string; r: RaceCard }[]).filter((w) => at(w.e) >= A && at(w.s) < Z);
  const bench = Object.values(Object.fromEntries(races.flatMap((r) => r.benchmarks ?? []).map((b) => [`${b.id}:${b.next}`, b]))).filter((b) => inR(b.next));
  const planned = (v.season as any)?.planned;
  // Leaders: from each pin straight down, then across to the middle of its card. Off the range: from the edge.
  const N = races.length;
  const lead = races.map((r, i) => {
    const sx = inR(r.date) ? X(r.date) : at(r.date) < A ? 0 : 100;
    return { r, inside: inR(r.date), d: `M${sx.toFixed(2)} 0 V16 H${(((i + 0.5) * 100) / N).toFixed(2)} V40` };
  });
  const paths = (f: (l: (typeof lead)[number]) => boolean) => lead.filter(f).map((l) => l.d).join(' ');
  const range = zoom === 'season'
    ? `${MONTHS[Number(a.slice(5, 7)) - 1]} ${a.slice(0, 4)} – ${MONTHS[Number(z.slice(5, 7)) - 1]} ${z.slice(0, 4)}`
    : `${shortDay(a).split(' ').slice(1).join(' ')} – ${shortDay(z).split(' ').slice(1).join(' ')}${races.some((r) => !inR(r.date)) ? ' · races beyond the range point off the edge' : ''}`;
  const lane = (n: string) => <span className="l" style={{ fontSize: 9 }}>{n}</span>;
  return (
    <section aria-labelledby="tl" className="rise card" style={{ animationDelay: '.06s', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
        <h2 id="tl" className="l" style={{ color: 'var(--tx)' }}>Season</h2>
        <div role="radiogroup" aria-label="Range" style={{ display: 'flex', padding: 3, borderRadius: 10, background: 'var(--s2)', border: '1px solid var(--ln)' }}>
          {([['season', 'Season'], ['next', 'Next 8 weeks']] as const).map(([k, n]) => (
            <button key={k} type="button" role="radio" aria-checked={zoom === k} onClick={() => setZoom(k)}
              style={{ minHeight: 32, padding: '0 12px', border: 0, borderRadius: 8, background: zoom === k ? 'var(--tx)' : 'transparent', color: zoom === k ? 'var(--on)' : 'var(--tx2)', fontSize: 12, fontWeight: 600 }}>{n}</button>
          ))}
        </div>
        <WinLegend windows={['easy', 'taper', 'recovery']} defs={v.defs} />
        <span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>{range}</span>
      </div>
      <div style={{ overflowX: 'auto', margin: '0 -6px', padding: '0 6px 6px' }}>
        <div style={{ minWidth: Math.max(1000, 84 + N * 250), display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)' }}>
            <div style={{ display: 'grid', gridTemplateRows: '22px 54px 26px 52px 22px', alignItems: 'center' }}>
              <span />{lane('Blocks')}{lane('Windows')}{lane('Races')}{lane('Tests')}
            </div>
            <div style={{ position: 'relative', height: 176 }}>
              {ticks.map((m) => (
                <div key={`${m.x}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${m.x}%`, borderLeft: '1px solid var(--ln)' }}>
                  <span className="m" style={{ position: 'absolute', top: 3, left: 6, color: 'var(--tx3)', whiteSpace: 'nowrap' }}>{m.n}</span>
                </div>
              ))}
              {blocks.filter((b) => at(b.end) >= A && at(b.start) < Z).map((b) => {
                const s = at(b.start) < A ? a : b.start;
                const e = at(b.end) >= Z ? z : b.end;
                return (
                  <div key={b.name + b.start} tabIndex={0} data-tip={`${b.name} · ${longDay(b.start)} – ${longDay(b.end)} · ${b.weeks} weeks${b.emphasis ? ` · ${b.emphasis}` : ''}${b.current ? ` · week ${b.week} now` : ''}.\nSource: Coach (program.py).`}
                    style={{ position: 'absolute', top: 24, height: 48, left: `${X(s)}%`, width: `calc(${W(s, e)}% - 3px)`, boxSizing: 'border-box', padding: '6px 8px', borderRadius: 8, overflow: 'hidden',
                      background: b.current ? 'var(--ot)' : 'var(--s2)', border: `${b.current ? 2 : 1}px solid ${b.current ? 'var(--o)' : 'var(--ln)'}` }}>
                    <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}{b.current ? ` · week ${b.week} now` : ''}</div>
                    <div className="m" style={{ fontSize: 10, color: 'var(--tx3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortDay(b.start).split(' ').slice(1).join(' ')} → {shortDay(b.end).split(' ').slice(1).join(' ')}</div>
                  </div>
                );
              })}
              <div style={{ position: 'absolute', left: 0, right: 0, top: 89, borderTop: '1px dashed var(--ln)' }} />
              {wins.map((w) => (
                <div key={`${w.r.id}${w.k}${w.s}`} tabIndex={0} className={WIN[w.k].cls}
                  data-tip={`${WIN[w.k].word} · ${w.r.name} · ${shortDay(w.s)} – ${shortDay(w.e)}.\n${tip(v.defs, w.k === 'recovery' ? 'race_recovery' : w.k === 'taper' ? 'race_taper' : 'race_easy') ?? ''}`}
                  style={{ position: 'absolute', top: 82, height: 14, left: `${X(w.s)}%`, width: `${W(w.s, w.e)}%`, minWidth: 5, boxSizing: 'border-box', borderRadius: 3, background: WIN[w.k].cls ? undefined : WIN[w.k].bg, border: `1px solid ${WIN[w.k].bc}` }} />
              ))}
              <div style={{ position: 'absolute', left: 0, right: 0, top: 128, borderTop: '1px solid var(--ln2)' }} />
              {races.filter((r) => inR(r.date)).map((r) => {
                const isA = r.priority === 'A';
                const sz = isA ? 40 : 30;
                const kc = KIND_COL[r.kind] ?? 'var(--tx)';
                return (
                  <span key={r.id}>
                    <div aria-hidden="true" style={{ position: 'absolute', top: 140, bottom: 0, left: `${X(r.date)}%`, marginLeft: -1, borderLeft: `${isA ? 2 : 1.5}px solid ${isA ? 'var(--tx)' : 'var(--ln2)'}` }} />
                    <Link to={`/race/${encodeURIComponent(r.id)}`} aria-label={`${r.name}, ${longDay(r.date)}, priority ${r.priority}, ${r.past ? `${-r.days_to} days ago` : `in ${daysWord(r.days_to)}`}`}
                      data-tip={`${r.name} · ${longDay(r.date)} · ${r.priority} · ${r.past ? `${-r.days_to} days ago` : daysWord(r.days_to)}${r.target ? ` · target sub ${r.target.under}` : ''}.`}
                      style={{ position: 'absolute', top: isA ? 108 : 113, left: `${X(r.date)}%`, transform: 'translateX(-50%)', width: sz, height: sz, borderRadius: '50%', boxSizing: 'border-box', display: 'grid', placeItems: 'center',
                        background: isA ? 'var(--tx)' : 'var(--s2)', border: `2px solid ${isA ? 'var(--tx)' : kc}`, color: isA ? 'var(--on)' : kc, boxShadow: '0 0 0 3px var(--s1)' }}>
                      <SportIcon icon={r.fallback.icon} size={isA ? 20 : 15} sw={1.9} />
                    </Link>
                  </span>
                );
              })}
              {bench.map((b) => (
                <span key={`${b.id}${b.next}`} tabIndex={0} data-tip={`${b.name} · ${longDay(b.next)}${b.in_window ? ` — inside the ${b.in_window} days around a race, flagged: it moves` : ''}.\nSource: Coach (program.py BENCHMARKS).`}
                  style={{ position: 'absolute', top: 156, left: `${X(b.next)}%`, transform: 'translateX(-50%)', fontSize: 13, lineHeight: 1, fontWeight: 700, color: b.in_window ? 'var(--r)' : 'var(--y)' }}>{b.in_window ? '★!' : '★'}</span>
              ))}
              {inR(today) && <>
                <div aria-hidden="true" style={{ position: 'absolute', top: 20, bottom: 0, left: `${X(today)}%`, borderLeft: '2px solid var(--id)' }} />
                <span className="l" style={{ position: 'absolute', top: 3, left: `${X(today)}%`, transform: 'translateX(-50%)', fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'var(--id)', color: 'var(--on)', whiteSpace: 'nowrap' }}>Today</span>
              </>}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)' }}>
            <span />
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="40" aria-hidden="true" style={{ display: 'block' }}>
              <path d={paths((l) => l.inside && l.r.priority !== 'A')} fill="none" style={{ stroke: 'var(--ln2)' }} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              <path d={paths((l) => !l.inside)} fill="none" style={{ stroke: 'var(--ln2)' }} strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
              <path d={paths((l) => l.inside && l.r.priority === 'A')} fill="none" style={{ stroke: 'var(--tx)' }} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)' }}>
            <span />
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))`, gap: 12 }}>
              {races.map((r) => <RaceCardView key={r.id} race={r} defs={v.defs} next={r.id === v.next?.id} />)}
            </div>
          </div>
        </div>
      </div>
      <span style={{ fontSize: 12, color: 'var(--tx3)' }}>
        A race is a point in time, so it is a pin on its date; its details live in the card it points to, in date order.
        {' '}{planned ? 'Each block is written for real at the end of the one before.' : 'Only the block in force is written; each next one is planned at the end of the one before, backward from the A race.'}
        {' '}The days around each race are the coach’s rules: tap or hover a window for what it allows.{v.due.length ? ` ${v.due.length} ${v.due.length === 1 ? 'date is' : 'dates are'} due a check.` : ''}
      </span>
    </section>
  );
}

function EmptySeason({ offline, onAdd }: { offline: boolean; onAdd: () => void }) {
  return (
    <section className="card" style={{ borderStyle: 'dashed', borderColor: 'var(--ln2)', padding: 28, gap: 18 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 28px', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 360px' }}>
          <span className="n" style={{ fontSize: 30, fontWeight: 700 }}>No races yet.</span>
          <span style={{ fontSize: 14, color: 'var(--tx2)', lineHeight: 1.5 }}>
            Add one and the coach looks it up online, confirms the date, sets easy and recovery days around it, and shapes the blocks
            before it. Training continues as it is until then.
          </span>
        </div>
        <button type="button" className="btn" disabled={offline} onClick={onAdd} style={{ minHeight: 48, padding: '0 20px', fontSize: 15 }}>Add a race</button>
      </div>
      <span style={{ fontSize: 12, color: 'var(--tx3)' }}>Adding is a request: the coach asks for the details, looks the race up and adds it. It takes a minute or two.</span>
    </section>
  );
}
