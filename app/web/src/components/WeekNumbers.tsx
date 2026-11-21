/**
 * Today's This week (board Week-Numbers, states on Week-Numbers-States; data WEEK-DATA.md, handoff
 * 2026-10-25). The old card set six days of this week against all seven of last week, so every row
 * read as a drop. Now every comparison is like for like — this week to its last finished day against
 * last week to the same day (`week_compare.cut`, the engine's) — what's still planned is hatched,
 * change arrows are neutral, and colour appears only against a coach target, with an icon and a word.
 * Garmin load and the lifting's kilos and sets are never added together (CLAUDE.md).
 */
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { Defs } from '../lib/api';
import { day, hm, nf, tip } from '../lib/fmt';
import { IC, Icon } from './ui';
import { SportIcon, kindColor } from './SportIcon';

const FULL: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const KINDS: [string, string][] = [['strength', 'Strength'], ['endurance', 'Endurance'], ['circuit', 'Circuit'], ['sport', 'Other sport']];
const GROUP: Record<string, [string, string]> = { bike: ['Ride', 'var(--b)'], run: ['Run', 'var(--c)'], swim: ['Swim', 'var(--v)'], race: ['Race', 'var(--y)'] };
const HATCH = 'repeating-linear-gradient(135deg, var(--ln2) 0 2px, transparent 2px 6px)';
const VT = 'Bar = this week so far · hatched = what is still planned · tick = last week at the same point · green = the coach’s target.';

const hmin = (m: number | null | undefined) => (m == null ? '—' : hm(m / 60));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const doneMin = (d: any): number => sum(d.sports.map((x: any) => x.min));
const planMin = (d: any): number => sum((d.planned ?? []).map((p: any) => p.min ?? 0));
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);
const arrow = (c: number | null) => (c == null ? '' : c > 0 ? '▲' : c < 0 ? '▼' : '=');
/** A percent change with a neutral arrow; no change reads "same". */
const chgPct = (a: number, b: number) => { const c = pct(a, b); return c == null ? '' : c === 0 ? 'same' : `${arrow(c)} ${Math.abs(c)}%`; };
const signed = (v: number, show: (x: number) => string) => (v > 0 ? `+${show(v)}` : v < 0 ? `−${show(-v)}` : 'same');

type Tone = 'g' | 'y' | 'n';
type Status = [string, Tone];
interface Row {
  l: string; v: string; u?: string; tip?: string; chg: string; cmp: string; note: string; vizTip?: string; s: Status; c: string;
  now?: number; plan?: number; last?: number | null; band?: number[] | null; mix?: { l: string; parts: [number, string][] }[];
}

/** Against a coach band: where the week lands once what is planned is done. */
function banded(v: number, band: number[] | null | undefined, words: { in: string; under: string; over: string }, reachable: boolean): Status | null {
  if (!band) return null;
  if (v > band[1]) return [words.over, 'y'];
  if (v >= band[0]) return [words.in, 'g'];
  return reachable ? ['Building', 'n'] : [words.under, 'y'];
}
const moved = (a: number, b: number, up: string, down: string, same = 'Same'): Status => {
  const c = pct(a, b);
  return [c == null || Math.abs(c) < 3 ? same : c > 0 ? up : down, 'n'];
};

export function WeekNumbers({ t }: { t: any }) {
  const wc = t.week_compare;
  const d: Defs = t.defs;
  if (!wc) return null;
  const days: any[] = wc.this.days;
  const lastDays: any[] = wc.last.days;
  const cut: number = wc.cut;
  const ti: number = wc.today_index;
  const a = wc.this.to_date;
  const b = wc.last.to_date;
  const full = wc.last.full;
  const since = wc.this.since ?? {};
  const plan = wc.this.planned;
  const tg = wc.targets ?? {};
  const day1 = cut < 0;
  // Still to come: what today logged after the cut, plus every session still planned.
  const add = (k: string) => (since[k] ?? 0) + (plan[k] ?? 0);
  const anyAhead = plan.sessions > 0 || (since.sessions ?? 0) > 0;
  const withWord = plan.sessions === 0 || plan.today_only ? 'with today' : 'with the plan';
  const cutDow: string = day1 ? '' : days[cut].dow;

  const first = day(days[0].date).split(' ');
  const lastD = day(days[6].date).split(' ');
  const range = `${first[0]} ${first[1]}${first[2] === lastD[2] ? '' : ` ${first[2]}`} – ${lastD.join(' ')} · ${ti === 6 ? 'last day' : ti === 0 ? 'day 1' : `day ${ti + 1}`}`;
  const todayPlan = (days[ti].planned ?? []).map((p: any) => p.title);
  const tgt = (band: number[] | null | undefined, show: (v: number) => string) => (band ? `target ${show(band[0])}–${show(band[1])}` : '');

  // The verdict: the one comparison that is fair, in a sentence.
  let verdict: string;
  let verdictSub: string;
  if (day1) {
    verdict = plan.sessions
      ? `A new week: ${hmin(plan.minutes)} planned in ${plan.sessions} ${plan.sessions === 1 ? 'session' : 'sessions'}, against ${hmin(full.minutes)} last week.`
      : 'A new week, with nothing planned yet.';
    verdictSub = 'Nothing finished yet. Bars are hatched until a session syncs; the running total starts at zero and is compared day by day with last week.';
  } else {
    const near = Math.abs(a.minutes - b.minutes) <= Math.max(10, b.minutes * 0.05);
    const when = `by ${FULL[cutDow]}`;
    const avgA = a.sessions ? a.minutes / a.sessions : 0;
    const avgB = b.sessions ? b.minutes / b.sessions : 0;
    const shape = a.sessions < b.sessions && avgA > avgB * 1.1 ? ' — in fewer, longer sessions.'
      : a.sessions > b.sessions && avgB && avgA < avgB / 1.1 ? ' — in more, shorter sessions.' : '.';
    verdict = `${near ? 'Same training time as' : a.minutes > b.minutes ? 'More training time than' : 'Less training time than'} last week ${when}${shape}`;
    const parts = [`${hmin(a.minutes)} vs ${hmin(b.minutes)}`];
    if (cut < 6 && a.minutes < full.minutes * 0.95) {
      const drop = pct(a.minutes, full.minutes);
      const left = cut === 5 ? 'Sunday hasn’t' : `${FULL[days[cut + 1].dow]} ${cut === 4 ? 'and' : 'to'} Sunday haven’t`;
      parts[0] += `, so the ${Math.abs(drop ?? 0)}% drop against last week’s full total isn’t a real drop: ${left} happened yet.`;
    } else parts[0] += '.';
    if (anyAhead) {
      const proj = a.minutes + add('minutes');
      const who = plan.today_only && todayPlan.length ? `${todayPlan.join(' and ')} today takes` : plan.sessions ? 'The rest of the plan takes' : 'Today takes';
      const vs = tg.minutes ? (proj < tg.minutes[0] ? `, under the target of ${hmin(tg.minutes[0])}–${hmin(tg.minutes[1])}.` : proj > tg.minutes[1] ? `, over the target of ${hmin(tg.minutes[0])}–${hmin(tg.minutes[1])}.` : ', inside the target.') : '.';
      parts.push(`${who} the week to ≈ ${hmin(proj)}${vs}`);
    }
    verdictSub = parts.join(' ');
  }

  // The rows: each number against the same point last week and, where the coach set one, a band.
  let groups: { t: string; c: string; rows: Row[] }[];
  if (day1) {
    const r: Row[] = [{
      l: 'Training time', v: hmin(plan.minutes), now: 0, plan: plan.minutes, last: full.minutes, band: tg.minutes, c: 'var(--tx)',
      chg: chgPct(plan.minutes, full.minutes), cmp: `vs ${hmin(full.minutes)} last week`,
      note: ['all planned', tgt(tg.minutes, hmin)].filter(Boolean).join(' · '), tip: tip(d, 'week_planned'), vizTip: VT,
      s: banded(plan.minutes, tg.minutes, { in: 'Plan on target', under: 'Plan under target', over: 'Plan over target' }, false) ?? ['Planned', 'n'],
    }, {
      l: 'Sessions', v: nf(plan.sessions), now: 0, plan: plan.sessions, last: full.sessions, c: 'var(--tx)',
      chg: signed(plan.sessions - full.sessions, nf), cmp: `vs ${full.sessions} last week`, note: 'all planned', tip: tip(d, 'week_planned'), vizTip: VT, s: ['Planned', 'n'],
    }];
    groups = [{ t: 'Volume', c: 'var(--tx)', rows: r }];
    if (plan.sets) groups.push({ t: 'Strength', c: 'var(--o)', rows: [{
      l: 'Working sets', v: nf(plan.sets), now: 0, plan: plan.sets, last: full.sets, band: tg.sets, c: 'var(--o)',
      chg: chgPct(plan.sets, full.sets), cmp: `vs ${full.sets} last week`,
      note: ['all planned', tgt(tg.sets, nf)].filter(Boolean).join(' · '), tip: tip(d, 'week_planned'), vizTip: VT,
      s: banded(plan.sets, tg.sets, { in: 'Plan on target', under: 'Plan under target', over: 'Plan over target' }, false) ?? ['Planned', 'n'],
    }] });
  } else {
    const onTarget = { in: anyAhead ? `On target ${withWord}` : 'On target', under: 'Under target', over: 'Over target' };
    const avg = (m: number, n: number) => (n ? Math.round(m / n) : 0);
    const gym = (days[ti].planned ?? []).find((p: any) => p.tonnage);
    const volume: Row[] = [{
      l: 'Training time', v: hmin(a.minutes), now: a.minutes, plan: add('minutes'), last: b.minutes, band: tg.minutes, c: 'var(--tx)',
      chg: chgPct(a.minutes, b.minutes), cmp: `vs ${hmin(b.minutes)} · full week was ${hmin(full.minutes)}`,
      note: [anyAhead ? `${withWord} ≈ ${hmin(a.minutes + add('minutes'))}` : 'nothing else planned', tgt(tg.minutes, hmin)].filter(Boolean).join(' · '),
      tip: tip(d, 'week_like_for_like', 'Activity time to the last finished day.'), vizTip: VT,
      s: banded(a.minutes + add('minutes'), tg.minutes, onTarget, false) ?? moved(a.minutes, b.minutes, 'More', 'Less'),
    }, {
      l: 'Sessions', v: nf(a.sessions), now: a.sessions, plan: add('sessions'), last: b.sessions, c: 'var(--tx)',
      chg: signed(a.sessions - b.sessions, nf), cmp: `vs ${b.sessions} · avg ${avg(a.minutes, a.sessions)} min vs ${avg(b.minutes, b.sessions)}`,
      note: `${anyAhead ? `${withWord} ${a.sessions + add('sessions')} · ` : ''}last full week ${full.sessions}`, tip: tip(d, 'week_like_for_like', 'Activities to the last finished day.'), vizTip: VT,
      s: a.sessions < b.sessions && avg(a.minutes, a.sessions) > avg(b.minutes, b.sessions) ? ['Fewer, longer', 'n']
        : a.sessions > b.sessions && avg(a.minutes, a.sessions) < avg(b.minutes, b.sessions) ? ['More, shorter', 'n'] : moved(a.sessions, b.sessions, 'More', 'Fewer'),
    }];
    const strength: Row[] = [{
      l: 'Tonnage', v: nf(a.tonnage / 1000, 1), u: ' t', now: a.tonnage, plan: add('tonnage'), last: b.tonnage, c: 'var(--o)',
      chg: chgPct(a.tonnage, b.tonnage), cmp: `vs ${nf(b.tonnage / 1000, 1)} t · full week ${nf(full.tonnage / 1000, 1)} t`,
      note: add('tonnage') ? `${withWord} ${nf((a.tonnage + add('tonnage')) / 1000, 1)} t${gym ? ` (${gym.title} ${nf(gym.tonnage / 1000, 1)} t last time)` : ''}` : 'no gym session planned',
      tip: tip(d, 'tonnage', 'Planned kilos are what that day moved the last time it was done.'), vizTip: VT,
      s: moved(a.tonnage, b.tonnage, 'Heavier', 'Lighter'),
    }, {
      l: 'Working sets', v: nf(a.sets), now: a.sets, plan: add('sets'), last: b.sets, band: tg.sets, c: 'var(--o)',
      chg: chgPct(a.sets, b.sets), cmp: `vs ${b.sets} · full week ${full.sets}`,
      note: [add('sets') ? `${withWord} ${a.sets + add('sets')}` : 'no sets planned', tgt(tg.sets, nf)].filter(Boolean).join(' · '),
      tip: tip(d, 'week_target', 'Sets logged on strength sessions, warm-ups stripped.'), vizTip: VT,
      s: banded(a.sets + add('sets'), tg.sets, onTarget, false) ?? moved(a.sets, b.sets, 'More', 'Fewer'),
    }];
    const load = a.cardio_load + (since.cardio_load ?? 0);
    const cardioAhead = days.slice(ti).some((x) => (x.planned ?? []).some((p: any) => p.kind !== 'strength'));
    const kmLine = (by: Record<string, number>) => Object.entries(by).map(([g, v]) => `${GROUP[g]?.[0] ?? g} ${nf(v, 1)}`).join(' · ') || 'none';
    const top = Object.entries(a.km_by as Record<string, number>).sort((x, y) => y[1] - x[1])[0];
    const cardio: Row[] = [{
      l: 'Garmin load', v: nf(a.cardio_load), now: a.cardio_load, plan: since.cardio_load ?? 0, last: b.cardio_load, band: tg.cardio_load, c: 'var(--b)',
      chg: chgPct(a.cardio_load, b.cardio_load), cmp: `vs ${nf(b.cardio_load)} · full week ${nf(full.cardio_load)}`,
      note: [cardioAhead ? 'planned cardio adds load once it is done' : 'nothing cardio planned', tgt(tg.cardio_load, nf)].filter(Boolean).join(' · '),
      tip: tip(d, 'load'), vizTip: VT,
      s: banded(load, tg.cardio_load, { in: 'In band', under: 'Under band', over: 'Over band' }, cardioAhead) ?? moved(a.cardio_load, b.cardio_load, 'Higher', 'Lower'),
    }];
    if (a.km || b.km) {
      const parts = (by: Record<string, number>): [number, string][] => Object.entries(by).map(([g, v]) => [v, GROUP[g]?.[1] ?? 'var(--tx3)']);
      cardio.push({
        l: 'Distance', v: nf(a.km, 1), u: ' km', c: 'var(--b)', chg: '', cmp: `${kmLine(a.km_by)} — last week ${kmLine(b.km_by)}`,
        mix: [{ l: 'This', parts: parts(a.km_by) }, { l: 'Last', parts: parts(b.km_by) }],
        note: 'km across sports don’t compare — split by sport', tip: 'Distance by sport, to the last finished day. Source: Garmin.',
        vizTip: Object.entries(GROUP).map(([, [l]]) => l).join(', ') + ' — a km on the bike is not a km running, so the total is split, not compared.',
        s: top && a.km && top[1] / a.km >= 0.6 ? [`Mostly the ${(GROUP[top[0]]?.[0] ?? top[0]).toLowerCase()}`, 'n'] : ['Mixed', 'n'],
      });
    }
    const recovery: Row[] = [];
    if (a.sleep_h != null) {
      const need: number | null = tg.sleep_need_h;
      recovery.push({
        l: 'Sleep · nightly avg', v: hm(a.sleep_h), now: a.sleep_h * 60, last: b.sleep_h != null ? b.sleep_h * 60 : null, band: need ? [need * 60, need * 60 + 60] : null, c: 'var(--v)',
        chg: b.sleep_h != null ? signed(Math.round((a.sleep_h - b.sleep_h) * 60), (m) => hmin(m)) : '', cmp: `vs ${b.sleep_h != null ? hm(b.sleep_h) : '—'} last week`,
        note: need ? `your need ≈ ${hm(need)} · green = at or above it` : 'Garmin’s sleep, averaged',
        tip: tip(d, 'sleep_need', 'Average sleep per night, the nights so far.'), vizTip: 'Bar = this week’s average · tick = last week · green = at or above your sleep need.',
        s: need ? (a.sleep_h >= need ? ['Meets need', 'g'] : ['Below need', 'y']) : moved(a.sleep_h, b.sleep_h ?? a.sleep_h, 'Longer', 'Shorter'),
      });
    }
    if (a.recovery != null) recovery.push({
      l: 'Recovery · avg', v: nf(a.recovery), u: '%', now: a.recovery, last: b.recovery, c: 'var(--v)',
      chg: b.recovery != null ? `${signed(Math.round(a.recovery - b.recovery), nf)}${a.recovery !== b.recovery ? ' pts' : ''}` : '', cmp: `vs ${b.recovery != null ? `${nf(b.recovery)}%` : '—'} last week`,
      note: 'daily recovery score, averaged', tip: tip(d, 'recovery'), vizTip: 'Bar = this week · tick = last week.',
      s: moved(a.recovery, b.recovery ?? a.recovery, 'Higher', 'Lower'),
    });
    groups = [{ t: 'Volume', c: 'var(--tx)', rows: volume }, { t: 'Strength', c: 'var(--o)', rows: strength },
      { t: 'Cardio', c: 'var(--b)', rows: cardio }, ...(recovery.length ? [{ t: 'Recovery', c: 'var(--v)', rows: recovery }] : [])];
  }

  const kinds = KINDS.filter(([k]) => days.some((x) => x.minutes[k] || (x.planned ?? []).some((p: any) => p.kind === k)));
  return (
    <section aria-labelledby="wk-h" className="card wk" style={{ gap: 18 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 14px' }}>
        <h2 id="wk-h" className="l" style={{ color: 'var(--tx)' }}>This week</h2>
        <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{range}</span>
        <Link to="/load" className="link" style={{ marginLeft: 'auto' }}>Training load</Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p style={{ margin: 0, fontSize: 20, lineHeight: 1.3, fontWeight: 600, maxWidth: '60ch', textWrap: 'pretty' } as CSSProperties}>{verdict}</p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--tx2)', maxWidth: '80ch' }}>{verdictSub}</p>
      </div>
      <div className="wk-charts">
        <Daily days={days} lastDays={lastDays} ti={ti} kinds={kinds} />
        <Running days={days} lastDays={lastDays} cut={cut} ti={ti} band={tg.minutes} d={d} />
      </div>
      <div role="table" aria-label="This week against last week, like for like" style={{ display: 'flex', flexDirection: 'column' }}>
        <div role="row" className="mrow mhead" style={{ padding: '0 0 6px', borderBottom: '1px solid var(--ln)' }}>
          {['', day1 ? 'Planned' : `By ${cutDow}`, day1 ? 'Last week, full' : `Last week, Mon${cut ? `–${cutDow}` : ''}`, 'Against last week and the target', 'Status'].map((h, i) => (
            <span key={i} role="columnheader" className="l" style={{ fontSize: 9, textAlign: i === 1 || i === 4 ? 'right' : 'left' }}>{h}</span>
          ))}
        </div>
        {groups.map((g) => (
          <div key={g.t} role="rowgroup" aria-label={g.t} style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="l" style={{ fontSize: 10, padding: '12px 0 2px', color: g.c }}>{g.t}</span>
            {g.rows.map((r) => <MetricRow key={r.l} r={r} />)}
          </div>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--tx3)' }}>
        {!day1 && `Compared like for like: Mon–${cutDow} this week against Mon–${cutDow} last week. `}
        Garmin load reads heart rate and barely registers lifting, so strength counts in kilos and sets and is never added to it.
      </p>
    </section>
  );
}

/** Training time by day: done solid by kind, still planned hatched with its kind's dashed edge. */
function Daily({ days, lastDays, ti, kinds }: { days: any[]; lastDays: any[]; ti: number; kinds: [string, string][] }) {
  const maxM = Math.max(120, Math.ceil(Math.max(...days.map((x) => doneMin(x) + planMin(x))) / 60) * 60);
  const step = maxM <= 240 ? 60 : 120;
  const grid = Array.from({ length: maxM / step + 1 }, (_, i) => i * step);
  const aria = `Training time by day: ${days.map((x, i) => `${i === ti ? 'today' : x.dow} ${doneMin(x) + planMin(x) ? hmin(doneMin(x) + planMin(x)) : 'nothing'}${planMin(x) ? ' (some planned)' : ''}`).join(', ')}`;
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 14px 10px', borderRadius: 14, background: 'var(--s2)', minWidth: 0 }}>
      <figcaption style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '4px 12px' }}>
        <span className="l" style={{ fontSize: 10, color: 'var(--tx)' }}>Training time by day</span>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11, color: 'var(--tx2)' }}>
          {kinds.map(([k, l]) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: kindColor(k) }} />{l}</span>)}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, border: '1px dashed var(--tx3)', boxSizing: 'border-box', backgroundImage: HATCH }} />Planned</span>
        </span>
      </figcaption>
      <div role="img" aria-label={aria} style={{ position: 'relative', height: 190, display: 'grid', gridTemplateColumns: '30px repeat(7, minmax(0, 1fr))', gap: '0 6px', alignItems: 'end' }}>
        <div aria-hidden="true" style={{ position: 'absolute', left: 36, right: 0, top: 0, bottom: 0, pointerEvents: 'none' }}>
          {grid.map((m) => <div key={m} style={{ position: 'absolute', left: 0, right: 0, bottom: `${(m / maxM) * 100}%`, borderTop: `1px ${m ? 'dashed' : 'solid'} var(--ln)` }} />)}
        </div>
        <div aria-hidden="true" style={{ position: 'relative', height: '100%' }}>
          {grid.map((m) => <span key={m} className="m" style={{ position: 'absolute', right: 0, bottom: `calc(${(m / maxM) * 100}% - 6px)`, color: 'var(--tx3)', fontSize: 10 }}>{m ? `${m / 60} h` : '0'}</span>)}
        </div>
        {days.map((x, i) => {
          const dm = doneMin(x);
          const tot = dm + planMin(x);
          const parts = [...x.sports.map((s: any) => `${s.title} ${hmin(s.min)}`),
            ...(x.planned ?? []).map((p: any) => `${p.title} ${p.min == null ? '' : `${p.min_source === 'typical' ? '≈ ' : ''}${hmin(p.min)} `}(planned)`)];
          const lt = doneMin(lastDays[i]);
          return (
            <div key={x.date} data-tip={`${day(x.date)}: ${parts.length ? parts.join(' · ') : i < ti ? 'rest' : 'nothing planned'}. Last week the same day: ${lt ? hmin(lt) : 'rest'}. Source: Garmin activities${(x.planned ?? []).length ? ' + plan' : ''}.`} tabIndex={0}
              style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', borderRadius: 8, background: i === ti ? 'var(--s3)' : 'transparent' }}>
              <span className="n" style={{ fontSize: 13, fontWeight: 700, color: dm ? 'var(--tx)' : 'var(--tx3)', marginBottom: 3 }}>{tot ? hmin(tot) : i < ti ? 'Rest' : ''}</span>
              <div style={{ width: 'min(34px, 70%)', height: `${(tot / maxM) * 100}%`, display: 'flex', flexDirection: 'column-reverse', gap: 2 }}>
                {x.sports.map((s: any, k: number) => <div key={`d${k}`} style={{ flex: `${s.min} 0 0`, minHeight: 3, borderRadius: 4, background: kindColor(s.kind) }} />)}
                {(x.planned ?? []).filter((p: any) => p.min).map((p: any, k: number) => (
                  <div key={`p${k}`} data-planned="" style={{ flex: `${p.min} 0 0`, minHeight: 3, borderRadius: 4, backgroundImage: HATCH, border: `1.5px dashed ${kindColor(p.kind)}`, boxSizing: 'border-box' }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '30px repeat(7, minmax(0, 1fr))', gap: '0 6px' }}>
        <span />
        {days.map((x, i) => (
          <span key={x.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: i === ti ? 700 : 500, color: i === ti ? 'var(--tx)' : 'var(--tx3)' }}>{i === ti ? 'Today' : x.dow}</span>
            <span style={{ display: 'flex', gap: 2, height: 12 }}>
              {[...x.sports.map((s: any) => [s, 1]), ...(x.planned ?? []).map((p: any) => [p, 0.5])].slice(0, 3).map(([s, o]: any, k: number) => (
                <SportIcon key={k} icon={s.icon} size={12} sw={2.4} style={{ color: kindColor(s.kind), opacity: o }} />
              ))}
            </span>
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Running total vs last week: this week to the cut, last week dashed, what is planned dotted. */
function Running({ days, lastDays, cut, ti, band, d }: { days: any[]; lastDays: any[]; cut: number; ti: number; band: number[] | null; d: Defs }) {
  const W = 300;
  const H = 190;
  const cumLast: number[] = [];
  lastDays.reduce((acc, x) => { const v = acc + doneMin(x); cumLast.push(v); return v; }, 0);
  const cumThis: number[] = [];
  days.slice(0, cut + 1).reduce((acc, x) => { const v = acc + doneMin(x); cumThis.push(v); return v; }, 0);
  const atCut = cut >= 0 ? cumThis[cut] : 0;
  const ahead: number[] = [];
  days.slice(cut + 1).reduce((acc, x, k) => { const v = acc + (cut + 1 + k <= ti ? doneMin(x) : 0) + planMin(x); ahead.push(v); return v; }, atCut);
  const end = ahead.length ? ahead[ahead.length - 1] : atCut;
  const top = Math.max(120, Math.ceil((Math.max(cumLast[6], end, band?.[1] ?? 0) * 1.12) / 60) * 60);
  const X = (i: number) => ((i + 1) / 7) * W;   // the end of day i; the week starts at x = 0
  const Y = (m: number) => H - (m / top) * H;
  const pts = (vals: number[], from = 0) => vals.map((m, k) => `${X(from + k).toFixed(1)} ${Y(m).toFixed(1)}`);
  const path = (p: string[], start = `0 ${H}`) => `M${[start, ...p].join(' L')}`;
  const step = top <= 360 ? 60 : top <= 720 ? 120 : 240;
  const ticks = Array.from({ length: Math.floor(top / step) }, (_, i) => (i + 1) * step).filter((m) => m < top);
  const thisP = cut >= 0 ? path(pts(cumThis)) : '';
  const planP = ahead.length ? path(pts(ahead, cut + 1), cut >= 0 ? `${X(cut).toFixed(1)} ${Y(atCut).toFixed(1)}` : `0 ${H}`) : '';
  const nowLabel = cut >= 0 ? `${days[cut].dow} ${hmin(atCut)} vs ${hmin(cumLast[cut])}` : 'Week starts';
  return (
    <figure data-tip={`Training time added up day by day. Solid = this week to its last finished day, dashed = last week, dotted = what is still planned.${band ? ' The green band is the coach’s weekly target.' : ''} Sources: Garmin activities, plan.`} tabIndex={0}
      style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 14px 10px', borderRadius: 14, background: 'var(--s2)', minWidth: 0 }}>
      <figcaption style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '4px 12px' }}>
        <span className="l" style={{ fontSize: 10, color: 'var(--tx)' }}>Running total vs last week</span>
        <span style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--tx2)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 3, borderRadius: 2, background: 'var(--tx)' }} />This week</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, borderTop: '2px dashed var(--tx3)' }} />Last week</span>
        </span>
      </figcaption>
      <div style={{ position: 'relative', height: H }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
          <path d={ticks.map((m) => `M0 ${Y(m).toFixed(1)} L${W} ${Y(m).toFixed(1)}`).join(' ')} fill="none" style={{ stroke: 'var(--ln)' }} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {band && <path data-band="" d={`M${X(5.6)} ${Y(band[1])} L${W} ${Y(band[1])} L${W} ${Y(band[0])} L${X(5.6)} ${Y(band[0])} Z`} style={{ fill: 'var(--gt)' }} />}
          <path data-line="last" d={path(pts(cumLast))} fill="none" style={{ stroke: 'var(--tx3)' }} strokeWidth={2} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          {thisP && <path d={`${thisP} L${X(cut)} ${H} Z`} style={{ fill: 'var(--ln)' }} />}
          {thisP && <path data-line="this" d={thisP} fill="none" style={{ stroke: 'var(--tx)' }} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
          {planP && <path data-line="plan" d={planP} fill="none" style={{ stroke: 'var(--tx)' }} strokeWidth={2} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />}
          {cut >= 0 && <path d={`M${X(cut)} ${Y(atCut)} L${X(cut)} ${Y(cumLast[cut])}`} fill="none" style={{ stroke: 'var(--tx2)' }} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        </svg>
        {ticks.map((m) => <span key={m} className="m" style={{ position: 'absolute', left: 0, top: `${(Y(m) / H) * 100}%`, transform: 'translateY(-120%)', color: 'var(--tx3)', fontSize: 10 }}>{m / 60} h</span>)}
        {band && <span className="m" style={{ position: 'absolute', right: 2, top: `${(Y(band[1]) / H) * 100}%`, transform: 'translateY(-100%)', color: 'var(--g)', fontSize: 10 }}>target {hmin(band[0])}–{hmin(band[1])}</span>}
        <span style={{ position: 'absolute', left: `${Math.max(cut >= 0 ? (X(cut) / W) * 100 : 0, 34)}%`, top: `${(Y(cut >= 0 ? Math.max(atCut, cumLast[cut]) : 0) / H) * 100}%`, transform: `translate(${cut >= 0 ? '-100%' : '-50%'}, -130%)`, padding: '3px 7px', borderRadius: 6, background: 'var(--s1)', border: '1px solid var(--ln2)', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}
          data-tip={tip(d, 'week_like_for_like')}>{nowLabel}</span>
      </div>
      <div className="m" style={{ position: 'relative', height: 12, color: 'var(--tx3)', fontSize: 10 }}>
        {[0, 2, 4, 6].map((i) => <span key={i} style={{ position: 'absolute', left: `${(X(i) / W) * 100}%`, transform: i === 6 ? 'translateX(-100%)' : 'translateX(-50%)' }}>{days[i].dow}</span>)}
      </div>
    </figure>
  );
}

const TONES: Record<Tone, [string, string, string]> = { g: ['var(--gt)', 'var(--g)', IC.check], y: ['var(--yt)', 'var(--y)', IC.warn], n: ['var(--s2)', 'var(--tx2)', IC.minus] };

function MetricRow({ r }: { r: Row }) {
  const [bg, col, icon] = TONES[r.s[1]];
  const max = Math.max(1, (r.now ?? 0) + (r.plan ?? 0), r.last ?? 0, r.band?.[1] ?? 0) * 1.15;
  const w = Math.min(100, ((r.now ?? 0) / max) * 100);
  const pw = Math.min(100 - w, ((r.plan ?? 0) / max) * 100);
  const mixMax = r.mix ? Math.max(1, ...r.mix.map((x) => sum(x.parts.map((p) => p[0])))) : 1;
  return (
    <div role="row" className="mrow" style={{ padding: '9px 0', borderBottom: '1px solid var(--ln)' }}>
      <span role="rowheader" style={{ fontSize: 14, color: 'var(--tx)' }}>{r.l}</span>
      <span role="cell" data-tip={r.tip} tabIndex={r.tip ? 0 : undefined} className="n" style={{ fontSize: 22, lineHeight: 1, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {r.v}{r.u && <span style={{ fontSize: 13, color: 'var(--tx2)', fontWeight: 600 }}>{r.u}</span>}
      </span>
      <span role="cell" style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--tx2)' }}>{r.chg && <span className="n" style={{ fontSize: 14, color: 'var(--tx2)' }}>{r.chg} </span>}{r.cmp}</span>
      <span role="cell" data-tip={r.vizTip} tabIndex={r.vizTip ? 0 : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        {r.mix ? r.mix.map((x) => (
          <span key={x.l} style={{ display: 'grid', gridTemplateColumns: '30px 1fr', gap: 6, alignItems: 'center' }}>
            <span className="m" style={{ fontSize: 10, color: 'var(--tx3)' }}>{x.l}</span>
            <span style={{ display: 'flex', height: 8, gap: 1, width: `${(sum(x.parts.map((p) => p[0])) / mixMax) * 100}%` }}>
              {x.parts.map(([f, c], k) => <span key={k} style={{ flex: `${f} 0 0`, background: c, borderRadius: 2 }} />)}
            </span>
          </span>
        )) : (
          <span style={{ position: 'relative', display: 'block', height: 12, borderRadius: 4, background: 'var(--s3)' }}>
            {r.band && <span style={{ position: 'absolute', top: 0, bottom: 0, left: `${(r.band[0] / max) * 100}%`, width: `${((Math.min(r.band[1], max) - r.band[0]) / max) * 100}%`, background: 'var(--gt)', borderLeft: '1px solid var(--g)', borderRight: '1px solid var(--g)' }} />}
            <span style={{ position: 'absolute', top: 2, bottom: 2, left: 0, width: `${w}%`, borderRadius: 3, background: r.c }} />
            {pw > 0 && <span data-planned="" style={{ position: 'absolute', top: 2, bottom: 2, left: `${w}%`, width: `${pw}%`, borderRadius: '0 3px 3px 0', border: `1px dashed ${r.c}`, boxSizing: 'border-box', backgroundImage: HATCH }} />}
            {r.last != null && <span style={{ position: 'absolute', top: -3, bottom: -3, left: `${Math.min(100, (r.last / max) * 100)}%`, width: 2, marginLeft: -1, borderRadius: 1, background: 'var(--tx)' }} />}
          </span>
        )}
        <span style={{ fontSize: 10, color: 'var(--tx3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.note}</span>
      </span>
      <span role="cell" style={{ justifySelf: 'end', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 7, background: bg, color: col, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
        <Icon d={icon} size={10} sw={3} />{r.s[0]}
      </span>
    </div>
  );
}
