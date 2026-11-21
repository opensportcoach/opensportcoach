/** Workouts — history (board Workouts): totals, a 6-week timeline, filters and the list. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useView } from '../lib/api';
import { day, dshort, isoDate, nf, tip, todayIso } from '../lib/fmt';
import { rich } from '../lib/tip';
import { Empty, ErrorBox, IC, Icon, PageTitle, Skeleton } from '../components/ui';
import { KIND_COLOR, SportIcon, kindColor } from '../components/SportIcon';
import { FUEL_ICON } from '../components/Fuel';
import { ScoreBadge } from '../components/Score';

// Filters by sport group, then by kind: "Circuit" is only Garmin's circuit types (sports.CIRCUIT) —
// tennis, walks and the rest are "Other sports" (docs/DESIGN.md (app audit) R5).
const TYPES: [string, string, (s: any) => boolean][] = [
  ['all', 'All', () => true], ['strength', 'Strength', (s) => s.group === 'strength'], ['run', 'Run', (s) => s.group === 'run'],
  ['bike', 'Ride', (s) => s.group === 'bike'], ['swim', 'Swim', (s) => s.group === 'swim'], ['circuit', 'Circuit', (s) => s.kind === 'circuit'],
  ['sport', 'Other sports', (s) => s.kind === 'sport' || s.group === 'race'],
];

function metrics(s: any): [string, string, string, string] {
  const min = s.duration_min || 0;
  if (s.group === 'strength') return [nf(s.tonnage), 'kg tonnage', nf(s.sets), 'working sets'];
  if (s.group === 'swim' && s.distance_km) { const p = (min * 60) / (s.distance_km * 10); return [`${nf(s.distance_km * 1000)} m`, 'distance', `${Math.floor(p / 60)}:${String(Math.round(p % 60)).padStart(2, '0')}`, '/ 100 m']; }
  if (s.group === 'run' && s.distance_km) { const p = (min * 60) / s.distance_km; return [`${nf(s.distance_km, 1)} km`, 'distance', `${Math.floor(p / 60)}:${String(Math.round(p % 60)).padStart(2, '0')}`, '/ km']; }
  if (s.distance_km) return [`${nf(s.distance_km, 1)} km`, 'distance', nf((s.distance_km / min) * 60, 1), 'km/h'];
  return [nf(s.avg_hr), 'avg HR', nf(s.max_hr), 'max HR'];
}

const keyValue = (s: any) => (s.group === 'strength' ? s.tonnage : s.distance_km ?? s.load) ?? 0;

const daysAgo = (n: number) => isoDate(new Date(Date.now() - n * 864e5));
/** Quick ranges (U23): most of the history sat behind a date field nobody edits. */
const RANGES: [string, number | null][] = [['6 weeks', 42], ['3 months', 91], ['1 year', 365], ['All', null]];

export default function Workouts() {
  const { data, error, loading } = useView('sessions');
  const [type, setType] = useState('all');
  const [dayKey, setDayKey] = useState('all');
  const [from, setFrom] = useState(() => daysAgo(42));
  const [to, setTo] = useState(todayIso);
  const [shown, setShown] = useState(30);
  // docs/DESIGN.md (fuelling and score) §6.3: the rides and runs that still ask what was taken.
  const [fuelDue, setFuelDue] = useState(false);
  const all: any[] = data?.sessions ?? [];
  const days = useMemo(() => [...new Set(all.map((s) => s.day).filter(Boolean))].sort() as string[], [all]);
  const typeOk = TYPES.find(([k]) => k === type)?.[2] ?? (() => true);
  const rows = all.filter((s) => typeOk(s) && (dayKey === 'all' || s.day === dayKey) && s.date >= from && s.date <= to && (!fuelDue || s.fuel_due));
  const dueCount = all.filter((s) => s.fuel_due).length;
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <><Skeleton h={90} /><Skeleton h={220} /><Skeleton h={400} /></>;
  const today = todayIso();
  const earliest = all.reduce((m, s) => (s.date < m ? s.date : m), today);
  const rangeFrom = (n: number | null) => (n == null ? earliest : daysAgo(n));
  const setRange = (n: number | null) => { setFrom(rangeFrom(n)); setTo(today); setShown(30); };
  const older = all.some((s) => s.date < from && typeOk(s));
  const sum = (f: (s: any) => number) => rows.reduce((a, s) => a + (f(s) || 0), 0);
  const cardio = sum((s) => (s.group === 'strength' ? 0 : s.load));
  const strength = sum((s) => (s.group === 'strength' ? s.load : 0));
  const tonnage = sum((s) => (s.group === 'strength' ? s.tonnage : 0));
  return (
    <>
      <PageTitle eyebrow={`History · ${dshort(from)} – ${dshort(to)}`} title="Workouts" right={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
          <Stat label="Sessions" v={nf(rows.length)} tipText="Sessions recorded by Garmin in the selected range." />
          <Stat label="Cardio load" v={nf(cardio)} col="var(--b)" tipText={tip(data.defs, 'load')} />
          <Stat label="Strength load" v={nf(strength)} col="var(--o)" tipText={tip(data.defs, 'load')} />
          <Stat label="Tonnage" v={`${nf(tonnage / 1000, 1)} t`} col="var(--o)" tipText={tip(data.defs, 'tonnage')} />
        </div>
      } />
      <Timeline all={all} />
      <div role="toolbar" aria-label="Filters" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px 16px' }}>
        <div role="radiogroup" aria-label="Type" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {TYPES.filter(([k, , f]) => k === 'all' || all.some(f)).map(([k, label]) => {
            const on = type === k;
            return <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setType(k)}
              style={{ minHeight: 38, padding: '0 14px', borderRadius: 999, border: `1px solid ${on ? 'var(--tx)' : 'var(--ln2)'}`, background: on ? 'var(--tx)' : 'transparent', color: on ? 'var(--on)' : 'var(--tx)', fontSize: 13, fontWeight: 600 }}>{label}</button>;
          })}
        </div>
        {(dueCount > 0 || fuelDue) && (
          <button type="button" aria-pressed={fuelDue} onClick={() => { setFuelDue(!fuelDue); setShown(30); }}
            data-tip="Rides and runs of an hour or more, since your fuel setup, with nothing logged — not even “nothing”." tabIndex={0}
            style={{ minHeight: 38, padding: '0 14px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${fuelDue ? 'var(--o)' : 'var(--ln2)'}`, background: fuelDue ? 'var(--ot)' : 'transparent', color: fuelDue ? 'var(--o)' : 'var(--tx)', fontSize: 13, fontWeight: 600 }}>
            <Icon d={FUEL_ICON} size={13} sw={2.4} />Fuel not logged · {dueCount}
          </button>
        )}
        <Field label="Program day">
          <select value={dayKey} onChange={(e) => setDayKey(e.target.value)} style={input}>
            <option value="all">All days</option>
            {days.map((d) => <option key={d} value={d}>{d.toUpperCase()}</option>)}
          </select>
        </Field>
        {/* The range: quick picks, and the two dates kept together — "To" used to wrap away on its own. */}
        <div role="group" aria-label="Date range" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '8px 12px' }}>
          <div role="radiogroup" aria-label="Range" style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 10, border: '1px solid var(--ln)', alignSelf: 'flex-end' }}>
            {RANGES.map(([label, n]) => {
              const on = to === today && from === rangeFrom(n);
              return <button key={label} type="button" role="radio" aria-checked={on} onClick={() => setRange(n)}
                style={{ minHeight: 30, padding: '0 10px', borderRadius: 7, border: 0, background: on ? 'var(--s3)' : 'transparent', color: on ? 'var(--tx)' : 'var(--tx2)', fontSize: 12, fontWeight: 600 }}>{label}</button>;
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <Field label="From"><input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} style={input} /></Field>
            <span aria-hidden="true" style={{ paddingBottom: 10, color: 'var(--tx3)' }}>–</span>
            <Field label="To"><input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} style={input} /></Field>
          </div>
        </div>
      </div>
      <section aria-label="Workout list" style={{ borderRadius: 16, border: '1px solid var(--ln)', background: 'var(--s1)', overflowX: 'auto' }}>
        <div style={{ minWidth: 824 }}>
          <div style={{ ...grid, padding: '12px 20px', borderBottom: '1px solid var(--ln)' }}>
            {['Date', 'Workout', 'Time', 'Key metric', 'Second', 'Load', 'Trend · same sport', ''].map((h, i) => <span key={i} className="l" style={{ fontSize: 10 }}>{h}</span>)}
          </div>
          {rows.slice(0, shown).map((s) => {
            const [k1, k1l, k2, k2l] = metrics(s);
            const same = all.filter((x) => x.type === s.type && x.date <= s.date).slice(0, 8).reverse();
            const max = Math.max(1, ...same.map(keyValue));
            const col = kindColor(s.kind);
            return (
              <Link key={s.id} to={`/workouts/${s.id}`} className="hv" style={{ ...grid, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--ln)' }}>
                <span style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 13, fontWeight: 600 }}>{dshort(s.date)}</span><span className="m" style={{ color: 'var(--tx3)' }}>{s.start.slice(11, 16)}</span></span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span aria-hidden="true" style={{ width: 30, height: 30, flex: 'none', borderRadius: 9, display: 'grid', placeItems: 'center', background: KIND_COLOR[s.kind]?.[1] ?? 'var(--ct)', color: col }}><SportIcon icon={s.icon} size={17} /></span>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
                      <span className="l" style={{ fontSize: 10, color: col }}>{s.sport}</span>
                    </span>
                  </span>
                  {/* The score (docs/DESIGN.md (fuelling and score) §6.3): every gym session, ride and run, a dash with its reason when not scored. */}
                  {s.score && ['strength', 'bike', 'run'].includes(s.group) && <span style={{ alignSelf: 'flex-start' }}><ScoreBadge s={s.score} size="sm" defs={data.defs} /></span>}
                  {s.group === 'strength' && s.has_sets === false && <span className="chip" style={{ alignSelf: 'flex-start', background: 'var(--yt)', color: 'var(--y)', fontSize: 11, padding: '2px 6px' }}><Icon d={IC.warn} size={10} sw={3} />No set data yet</span>}
                  {s.fuel_g != null
                    ? <span className="chip" data-tip={`${s.fuel_g} g of carbohydrate taken${s.fuel_g_h != null ? `, ${s.fuel_g_h} g an hour` : ''}.\nSource: You.`} style={{ alignSelf: 'flex-start', background: 'var(--ot)', color: 'var(--o)', fontSize: 11, padding: '2px 6px' }}><Icon d={FUEL_ICON} size={10} sw={2.6} />Fuel {s.fuel_g_h != null ? `${s.fuel_g_h} g/h` : `${s.fuel_g} g`}</span>
                    : s.fuel_due && <span className="chip" style={{ alignSelf: 'flex-start', background: 'var(--yt)', color: 'var(--y)', fontSize: 11, padding: '2px 6px' }}><Icon d={FUEL_ICON} size={10} sw={2.6} />Fuel not logged</span>}
                </span>
                <span className="n" style={{ fontSize: 17 }}>{s.duration_min} min</span>
                <span style={{ display: 'flex', flexDirection: 'column' }}><span className="n" style={{ fontSize: 18, fontWeight: 700 }}>{k1}</span><span className="l" style={{ fontSize: 9 }}>{k1l}</span></span>
                <span style={{ display: 'flex', flexDirection: 'column' }}><span className="n" style={{ fontSize: 18 }}>{k2}</span><span className="l" style={{ fontSize: 9 }}>{k2l}</span></span>
                <span style={{ display: 'flex', flexDirection: 'column' }}><span className="n" style={{ fontSize: 18, color: col }}>{s.load}</span><span className="l" style={{ fontSize: 9 }}>{s.group === 'strength' ? 'strength axis' : 'cardio axis'}</span></span>
                <svg viewBox="0 0 120 28" width="120" height="28" aria-hidden="true">
                  {same.map((x, i) => { const h = Math.max(2, (keyValue(x) / max) * 26); return <rect key={x.id} x={i * 15} y={28 - h} width={11} height={h} rx={2} style={{ fill: col }} opacity={x.id === s.id ? 1 : 0.45} />; })}
                </svg>
                <Icon d="M9 6l6 6-6 6" size={16} sw={2} style={{ color: 'var(--tx3)' }} />
              </Link>
            );
          })}
          {!rows.length && <div style={{ padding: 20 }}><Empty title="No workouts in this range.">Widen the dates or pick another type.</Empty></div>}
          {(rows.length > shown || older) && (
            <div style={{ padding: '14px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              {rows.length > shown
                ? <button type="button" className="btn2 hv" onClick={() => setShown((n) => n + 30)}>Show {Math.min(30, rows.length - shown)} more · {rows.length - shown} left in this range</button>
                : <button type="button" className="btn2 hv" onClick={() => setFrom(isoDate(new Date(Date.parse(`${from}T12:00:00`) - 42 * 864e5)))}>Show 6 weeks before {dshort(from)}</button>}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

// Fits a 1440 px window beside the dock without a sideways scroll (its minimum: 824 px).
const grid = { display: 'grid', gridTemplateColumns: '90px minmax(180px, 1.6fr) 72px repeat(3, minmax(76px, 1fr)) 120px 24px', gap: 10 } as const;
const input = { minHeight: 38, padding: '0 10px', borderRadius: 10, border: '1px solid var(--ln2)', background: 'var(--s1)', color: 'var(--tx)', fontSize: 13 } as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="l" style={{ fontSize: 10 }}>{label}</span>{children}</label>;
}

function Stat({ label, v, col, tipText }: { label: string; v: string; col?: string; tipText?: string }) {
  return <div data-tip={tipText} tabIndex={0}><div className="l" style={{ color: col }}>{label}</div><div className="n" style={{ fontSize: 30, fontWeight: 700 }}>{v}</div></div>;
}

function Timeline({ all }: { all: any[] }) {
  const today = new Date(`${todayIso()}T12:00:00`);
  const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * 864e5);
  const weeks = Array.from({ length: 6 }, (_, w) => new Date(monday.getTime() - (5 - w) * 7 * 864e5));
  const byDay = new Map<string, any[]>();
  for (const s of all) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  return (
    <section aria-label="Timeline, last 6 weeks" className="card" style={{ padding: '16px 20px', gap: 10, borderRadius: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 18px' }}>
        <span className="l" style={{ color: 'var(--tx)' }}>Last 6 weeks</span>
        {[['Strength', 'strength', 'strength'], ['Endurance', 'endurance', 'run'], ['Circuit', 'circuit', 'circuit'], ['Other sports', 'sport', 'racket']]
          .filter(([, k]) => all.some((s) => s.kind === k)).map(([l, k, icon]) => (
            <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tx2)' }}><SportIcon icon={icon} size={13} style={{ color: kindColor(k) }} />{l}</span>
          ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 640, display: 'grid', gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))', gap: 4, alignItems: 'center' }}>
          <span />
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="l" style={{ fontSize: 10, textAlign: 'center' }}>{d}</span>)}
          {weeks.map((wk) => [
            <span key={`w${wk.getTime()}`} className="m" style={{ color: 'var(--tx3)' }}>{dshort(isoDate(wk))}</span>,
            ...Array.from({ length: 7 }, (_, i) => {
              const d = isoDate(new Date(wk.getTime() + i * 864e5));
              const items = byDay.get(d) ?? [];
              const future = d > todayIso();
              return (
                <span key={d} data-tip={items.length ? rich({ t: day(d), r: items.map((s): [string, string, string] => [`${s.sport} · ${s.title}`, `${s.duration_min} min`, kindColor(s.kind)]) })
                  : future ? undefined : rich({ t: day(d), n: ['Rest day.'] })} tabIndex={items.length ? 0 : -1}
                  style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 6, background: d === todayIso() ? 'var(--s3)' : future ? 'transparent' : 'var(--s2)' }}>
                  {items.slice(0, 3).map((s) => <SportIcon key={s.id} icon={s.icon} size={15} sw={2.2} style={{ color: kindColor(s.kind) }} />)}
                </span>
              );
            }),
          ])}
        </div>
      </div>
    </section>
  );
}
