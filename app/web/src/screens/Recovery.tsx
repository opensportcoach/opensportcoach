/**
 * Recovery & sleep (board Recovery). One night at a time, picked at the top (R9, 2026-10-11): the
 * score and where its points came from, the night's stages and heart rate, the night against your
 * usual, sleep against need, and the overnight vitals — then the 45-day trends and the calendar,
 * each marking the picked night and able to pick another.
 */
import { useState } from 'react';
import { useView, type Defs } from '../lib/api';
import { day, dshort, hm, line, nf, pointX, pointY, scale, tip, zone, type Scale } from '../lib/fmt';
import { rich } from '../lib/tip';
import { GOOD, SIGNAL, inline, recWord, stateCol, stateTint } from '../lib/recovery';
import { Bars, Legend, TimeChart } from '../components/Chart';
import { Hypnogram, STAGES } from '../components/Hypnogram';
import { NightCard } from '../components/NightCard';
import { Empty, ErrorBox, IC, Icon, PageTitle, Ring, Skeleton } from '../components/ui';

const WINDOW = 14;

export default function Recovery() {
  const { data: r, error, loading } = useView('recovery');
  const [sel, setSel] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (loading && !r) return <><Skeleton h={120} /><Skeleton h={260} /><Skeleton h={260} /></>;
  const d: Defs = r.defs;
  const series: any[] = r.series;
  const nights: any[] = r.nights ?? [];
  const cal: any[] = r.calendar ?? [];
  const days30: string[] = series.slice(-30).map((x) => x.date);
  const latest = nights[nights.length - 1]?.date ?? days30[days30.length - 1];
  const date = sel && days30.includes(sel) ? sel : latest;
  const isLast = date === latest;
  const shown = nights.find((n) => n.date === date);
  const rec = cal.find((c) => c.date === date);
  const score: number | null = rec?.score ?? null;
  const pick = (x: string) => setSel(days30.includes(x) ? x : sel);
  // The 14-day window the strip and "Sleep vs need" show: it ends at the picked night or a week after.
  const end = Math.min(days30.length - 1, Math.max(days30.indexOf(date) + Math.floor(WINDOW / 2), WINDOW - 1));
  const win = days30.slice(Math.max(0, end - WINDOW + 1), end + 1);
  const last45 = series.slice(-45);
  return (
    <>
      <PageTitle eyebrow={`Recovery & sleep · ${isLast ? 'last night' : `night to ${day(date)}`}`} title={
        <span>{score == null ? (r.calibrating?.ready ? 'No score' : 'Calibrating') : <><span style={{ color: zone(score) }}>{recWord(score)}</span> · {score}%</>}</span>
      } right={!r.calibrating?.ready && <span className="chip" style={{ background: 'var(--vt)', color: 'var(--v)' }}>{r.calibrating.nights_with_hrv} of {r.calibrating.needed} nights of HRV — bands switch on as they fill</span>} />
      <NightPicker win={win} all={days30} date={date} latest={latest} series={series} cal={cal} nights={nights} onPick={pick} />
      <RecoveryPoints comps={rec?.components ?? []} score={score} d={d} date={date} isLast={isLast} cal={cal} />
      {shown && shown.segments.length > 0 ? (
        <section aria-labelledby="stages" className="card">
          <h2 id="stages" className="l" style={{ color: 'var(--tx)' }}>Sleep stages · night to {dshort(shown.date)}</h2>
          <Hypnogram night={shown} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            {[...STAGES].reverse().map((st) => {
              const m = shown.totals_min[st.key] ?? 0;
              const asleep = (shown.totals_min.deep ?? 0) + (shown.totals_min.light ?? 0) + (shown.totals_min.rem ?? 0);
              return (
                <div key={st.key}>
                  <span className="l" style={{ fontSize: 10, color: st.color }}>{st.label}</span>
                  <div className="n" style={{ fontSize: 22 }}>{hm(m / 60)}</div>
                  <span className="m" style={{ color: 'var(--tx3)' }}>{st.key === 'awake' ? `${Math.round(m)} min awake` : `${Math.round((m / (asleep || 1)) * 100)} % of sleep`}</span>
                </div>
              );
            })}
          </div>
          <span className="m" style={{ color: 'var(--tx3)' }}>Source: Garmin — the stages your watch recorded, checked against its own totals for the night.</span>
        </section>
      ) : shown ? (
        <section className="card"><Empty title={`No stage timeline for the night to ${dshort(date)}.`}>The watch recorded the night’s totals but not its stages.</Empty></section>
      ) : null}
      <div className="grid2">
        {shown ? <NightCard night={shown} nights={nights} isLast={isLast} debt={r.night?.sleep?.debt7dH} consistency={r.night?.sleep?.consistencyPct} defs={d} />
          : <section className="card"><Empty title={`No night recorded to ${dshort(date)}.`}>Wear the watch to sleep — the night appears here the next morning.</Empty></section>}
        <SleepVsNeed win={win} series={series} nights={nights} date={date} onPick={pick} d={d} />
      </div>
      <Vitals series={series} date={date} days={days30} onPick={pick} flags={isLast ? r.night?.flags ?? [] : []} d={d} />
      <div className="grid2">
        <section className="card">
          <h2 className="l" style={{ color: 'var(--tx)' }} data-tip={`${tip(d, 'hrv_band') ?? ''}\n${tip(d, 'hrv_weekly') ?? ''}`} tabIndex={0}>HRV · 45 days</h2>
          <TimeChart dates={last45.map((x) => x.date)} mark={date} onPick={pick} fmt={(v) => `${Math.round(v)}`}
            series={[{ values: last45.map((x) => x.hrv), color: 'var(--tx)', width: 1.3, opacity: 0.4, label: 'Nightly HRV, ms' },
              { values: last45.map((x) => x.hrv_7d), color: 'var(--tx)', width: 2.8, label: '7-night average' }]}
            bandLo={last45.map((x) => x.hrv_low)} bandHi={last45.map((x) => x.hrv_high)}
            ariaLabel="Nightly HRV and Garmin's 7-night average inside its balanced band"
            marks={last45.map((x, i) => ({ x, i })).filter(({ x }) => x.hrv != null && x.hrv_low != null && (x.hrv < x.hrv_low || x.hrv > x.hrv_high)).map(({ i }) => ({ i, color: 'var(--y)' }))} />
          <Legend items={[['Nightly HRV, ms', 'var(--tx3)'], ['7-night average (Garmin)', 'var(--tx)'], ['Garmin balanced band', 'var(--s3)', 'box'], ['night out of band', 'var(--y)', 'box']]} />
          <span style={{ fontSize: 12, color: 'var(--tx3)', lineHeight: 1.4 }}>How to read it: the grey band is your normal range. While the bold 7-night line stays inside it, Garmin calls your HRV balanced; single nights (faint) wander more.</span>
        </section>
        <section className="card">
          <h2 className="l" style={{ color: 'var(--tx)' }} data-tip={`${tip(d, 'rhr_7d') ?? ''}\n${tip(d, 'rhr_baseline') ?? ''}`} tabIndex={0}>Resting HR · 45 days</h2>
          <TimeChart dates={last45.map((x) => x.date)} mark={date} onPick={pick} fmt={(v) => `${Math.round(v)}`}
            series={[{ values: last45.map((x) => x.rhr), color: 'var(--r)', width: 1.3, opacity: 0.4, label: 'Resting HR, bpm' },
              { values: last45.map((x) => x.rhr_7d), color: 'var(--r)', width: 2.8, label: '7-day average' }]} baseline={r.baselines?.rhr?.baseline}
            ariaLabel="Resting heart rate, its 7-day average and its 30-day baseline" />
          <Legend items={[['Daily resting HR, bpm', 'var(--rt)'], ['7-day average', 'var(--r)'], [`30-day baseline ${nf(r.baselines?.rhr?.baseline, 1)}`, 'var(--tx3)', 'dash']]} />
          <span style={{ fontSize: 12, color: 'var(--tx3)', lineHeight: 1.4 }}>How to read it: lower is better. A 7-day line rising above the dashed baseline for several days means fatigue, stress or illness building.</span>
        </section>
      </div>
      <section className="card">
        <h2 data-tip={tip(d, 'recovery')} tabIndex={0} className="l" style={{ color: 'var(--tx)' }}>Recovery calendar · 5 weeks</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4, maxWidth: 560 }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => <span key={x} className="l" style={{ fontSize: 9, textAlign: 'center' }}>{x}</span>)}
          {(() => {
            const pad = cal.length ? (new Date(`${cal[0].date}T12:00:00`).getDay() + 6) % 7 : 0;
            return [...Array(pad).fill(null), ...cal].map((c, i) => c ? (
              <button key={c.date} type="button" disabled={!days30.includes(c.date)} onClick={() => pick(c.date)} aria-pressed={c.date === date}
                data-tip={rich({ t: day(c.date), r: [['Recovery', c.score != null ? `${c.score} · ${recWord(c.score)}` : '—', c.score != null ? zone(c.score) : undefined]], h: days30.includes(c.date) ? 'Click to show this night' : undefined })}
                style={{ aspectRatio: '1.3', borderRadius: 6, display: 'grid', placeItems: 'center', border: c.date === date ? '2px solid var(--tx)' : '2px solid transparent', padding: 0,
                  background: c.score == null ? 'var(--s2)' : zone(c.score), color: 'var(--on)', fontSize: 12, fontWeight: 700, opacity: c.score == null ? 0.5 : 0.9, cursor: days30.includes(c.date) ? 'pointer' : 'default' }}>{c.score ?? ''}</button>
            ) : <span key={`p${i}`} />);
          })()}
        </div>
        <Legend items={[['≥ 67', 'var(--g)', 'box'], ['34–66', 'var(--y)', 'box'], ['≤ 33', 'var(--r)', 'box']]} />
      </section>
    </>
  );
}

/** The night picker (R9): fourteen nights at a time — each with how much of the need was slept and
 * its recovery colour — arrows to step, and a way back to last night. */
function NightPicker({ win, all, date, latest, series, cal, nights, onPick }: {
  win: string[]; all: string[]; date: string; latest: string; series: any[]; cal: any[]; nights: any[]; onPick: (d: string) => void;
}) {
  const i = all.indexOf(date);
  const arrow = (dir: -1 | 1) => (
    <button type="button" className="btn2 hv" aria-label={dir < 0 ? 'Previous night' : 'Next night'} disabled={i + dir < 0 || i + dir >= all.length}
      onClick={() => onPick(all[i + dir])} style={{ minHeight: 40, minWidth: 40, padding: 0, justifyContent: 'center' }}>
      <Icon d={dir < 0 ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} size={16} />
    </button>
  );
  return (
    <section aria-label="Pick a night" className="card" style={{ padding: '12px 14px', gap: 10, flexDirection: 'row', alignItems: 'center' }}>
      {arrow(-1)}
      <div role="radiogroup" aria-label="Night" style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: `repeat(${win.length}, minmax(34px, 1fr))`, gap: 4, overflowX: 'auto' }}>
        {win.map((dd) => {
          const x = series.find((y) => y.date === dd) ?? {};
          const c = cal.find((y) => y.date === dd);
          const perf = x.sleep_h && x.need_h ? Math.min(1, x.sleep_h / x.need_h) : null;
          const on = dd === date;
          const has = nights.some((n) => n.date === dd) || c?.score != null;
          return (
            <button key={dd} type="button" role="radio" aria-checked={on} aria-label={`Night to ${day(dd)}`} onClick={() => onPick(dd)}
              data-tip={rich({ t: `Night to ${day(dd)}`, r: [['Recovery', c?.score != null ? `${c.score} · ${recWord(c.score)}` : '—', c?.score != null ? zone(c.score) : undefined], ['Slept', `${hm(x.sleep_h)} of ${hm(x.need_h)}`, 'var(--v)']] })}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 2px', borderRadius: 10, border: `1px solid ${on ? 'var(--tx)' : 'transparent'}`,
                background: on ? 'var(--s3)' : 'transparent', color: 'var(--tx)', opacity: has ? 1 : 0.45, cursor: 'pointer' }}>
              <span className="l" style={{ fontSize: 9, color: on ? 'var(--tx)' : 'var(--tx3)' }}>{day(dd).split(' ')[0]}</span>
              <span className="n" style={{ fontSize: 17, lineHeight: 1 }}>{Number(dd.slice(8))}</span>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: c?.score == null ? 'var(--s3)' : zone(c.score) }} />
              <span aria-hidden="true" style={{ width: '70%', height: 3, borderRadius: 2, background: 'var(--s3)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${(perf ?? 0) * 100}%`, background: 'var(--v)' }} />
              </span>
            </button>
          );
        })}
      </div>
      {arrow(1)}
      {date !== latest && <button type="button" className="btn2 hv" onClick={() => onPick(latest)} style={{ minHeight: 40 }}>Last night</button>}
    </section>
  );
}

/**
 * The recovery score, read plainly (round 3 — the points bar was still unclear): the score and a
 * sentence on what holds it down; one card per signal with its reading against your usual, a word
 * for it and thirty days of it; and the score written out as the sum it is.
 */
function RecoveryPoints({ comps, score, d, date, isLast, cal }: { comps: any[]; score: number | null; d: Defs; date: string; isLast: boolean; cal: any[] }) {
  const parts = comps.map((c) => ({ ...c, ...(SIGNAL[c.label] ?? { name: c.label, words: {}, fmt: (v: number) => nf(v, 1) }) }));
  const holding = parts.filter((p) => !GOOD.has(p.state));
  const upto = cal.findIndex((c) => c.date === date);
  const days = cal.slice(Math.max(0, upto - 29), upto + 1);
  const wsum = parts.reduce((a, p) => a + p.weight, 0) || 1;
  return (
    <section aria-labelledby="pts" className="card" style={{ gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 16px' }}>
        <h2 id="pts" data-tip={tip(d, 'recovery')} tabIndex={0} className="l" style={{ color: 'var(--tx)' }}>Recovery score</h2>
        <span className="m" style={{ color: 'var(--tx3)' }}>{isLast ? 'this morning' : day(date)} · OpenSportCoach’s own score, beside Garmin’s readiness</span>
      </div>
      {!parts.length ? <Empty title="No score for this night.">The score needs a night with HRV, sleep or resting HR.</Empty> : (<>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 28px' }}>
          <Ring value={score} color={zone(score)} size={112}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span className="n" style={{ fontSize: 40, lineHeight: 0.9, fontWeight: 700 }}>{score ?? '—'}</span>
              <span className="l" style={{ fontSize: 9, marginTop: 3 }}>of 100</span>
            </div>
          </Ring>
          <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: zone(score) }}>{score == null ? '—' : recWord(score)}</span>
            <span style={{ fontSize: 15, lineHeight: 1.45 }}>
              {!holding.length ? 'Every signal at or better than your usual.' : <>Holding it down: {holding.map((p, i) => (
                <span key={p.label}>{i ? (i === holding.length - 1 ? ' and ' : ', ') : ''}<b style={{ color: stateCol(p.state) }}>{inline(p.name)}</b> ({(p.words[p.state] ?? p.state).toLowerCase()})</span>
              ))}.</>}
            </span>
            <span role="note" aria-label="How the score adds up" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 6px', fontSize: 13, color: 'var(--tx2)' }}>
              <b className="n" style={{ fontSize: 17, color: 'var(--tx)' }}>{score}</b> =
              {parts.map((p, i) => (
                <span key={p.label} data-tip={rich({ t: p.name, c: stateCol(p.state), r: [['Earned', `${nf(p.points, 0)} of ${nf((p.weight / wsum) * 100, 0)} points`], ['Its score', `${p.score} / 100`], ['Counts', `${nf((p.weight / wsum) * 100, 0)} % of the total`]], n: ['Points = its score × its share. A signal the watch didn’t record hands its share to the others.'], s: 'Computed by OpenSportCoach' })} tabIndex={0}
                  style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
                  {i > 0 && <span>+</span>}<b className="n" style={{ fontSize: 16, color: stateCol(p.state) }}>{nf(p.points, 0)}</b><span>{inline(p.name)}</span>
                </span>
              ))}
            </span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 10 }}>
          {parts.map((p) => {
            const series = days.map((c) => c.components?.find((x: any) => x.label === p.label) ?? null);
            return (
              <div key={p.label} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--ln)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                  <span className="l" style={{ fontSize: 10, color: 'var(--tx)' }}>{p.name}</span>
                  <span className="m" data-tip={`Counts ${nf((p.weight / wsum) * 100, 0)} % of the score.`} tabIndex={0} style={{ fontSize: 10, color: 'var(--tx3)' }}>{nf((p.weight / wsum) * 100, 0)} %</span>
                </div>
                <span style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, background: stateTint(p.state), color: stateCol(p.state), fontSize: 12, fontWeight: 700 }}>
                  <Icon d={GOOD.has(p.state) ? IC.check : IC.warn} size={11} sw={3} />{p.words[p.state] ?? p.state}
                </span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span className="n" style={{ fontSize: 28, lineHeight: 1, fontWeight: 700 }}>{p.fmt(p.value)}</span>
                  <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{p.unit === 'h' ? '' : p.unit}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--tx3)' }}>{p.label === 'Sleep perf' ? `need ${p.fmt(p.normal)}` : p.label === 'Skin temp' ? 'vs Garmin’s baseline' : `usual ${p.fmt(p.normal)}`}</span>
                </span>
                <SignalSpark series={series} date={date} days={days.map((c) => c.date)} color={stateCol(p.state)} fmt={p.fmt} unit={p.unit} name={p.name} />
              </div>
            );
          })}
        </div>
        <TrendKey d={d} />
        <details style={{ fontSize: 12, color: 'var(--tx2)', lineHeight: 1.5 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--tx)', fontWeight: 600 }}>How the score works</summary>
          <p style={{ margin: '6px 0 0' }}>
            Five signals, each scored 0–100 against your own usual, then weighted: HRV 40 %, sleep 25 %, resting HR 20 %, respiration 10 %, skin temperature 5 %.
            HRV and resting HR score <b>50 at your usual</b> and more when better — so an ordinary good night lands around 65–75, and 67 or more reads as recovered.
            Sleep scores the percent of your need you slept; respiration and skin temperature score full marks unless they rise. A signal the watch didn’t record hands its share to the others.
            Garmin’s training readiness is a separate number.
          </p>
        </details>
      </>)}
    </section>
  );
}

/** Thirty days of one signal against its usual (dashed): each night faint, its 7-day average bold in
 * the state's colour — as on the HRV and resting-HR charts — and the picked day marked. */
function SignalSpark({ series, date, days, color, fmt, unit, name }: { series: (any | null)[]; date: string; days: string[]; color: string; fmt: (v: number) => string; unit: string; name: string }) {
  const vals = series.map((x) => (x ? x.value : null));
  const avgs = series.map((x) => (x ? x.value_7d ?? null : null));
  const norms = series.map((x) => (x ? x.normal : null));
  const sc: Scale = { w: 100, h: 40, ...scale([...vals, ...norms], 0.15) };
  const u = unit === 'h' ? 'h' : unit;
  const i = days.indexOf(date);
  const n = days.length;
  const step = 100 / Math.max(1, n - 1);
  return (
    <svg viewBox="0 0 100 40" width="100%" height={40} preserveAspectRatio="none" role="img" aria-label={`${name}, 30 days, against your usual`} style={{ display: 'block' }}>
      <path d={line(norms, sc)} fill="none" style={{ stroke: 'var(--tx3)' }} strokeWidth="1" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
      <path d={line(vals, sc)} fill="none" style={{ stroke: color }} strokeWidth="1.2" strokeOpacity="0.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <path d={line(avgs, sc)} fill="none" style={{ stroke: color }} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {i >= 0 && vals[i] != null && <circle cx={pointX(i, n, 100)} cy={pointY(vals[i] as number, sc)} r="2" style={{ fill: color }} />}
      {days.map((dd, k) => (
        <rect key={dd} className="hcol" x={Math.max(0, pointX(k, n, 100) - step / 2)} width={step} y={0} height={40}
          data-tip={rich({ t: day(dd), r: series[k] ? [[name, `${fmt(series[k].value)} ${u}`, color], ['7-day average', series[k].value_7d == null ? '—' : `${fmt(series[k].value_7d)} ${u}`, color], [name === 'Sleep' ? 'Need' : 'Usual', `${fmt(series[k].normal)} ${u}`, 'var(--tx3)']] : [], n: series[k] ? undefined : ['Not recorded.'] })} />
      ))}
    </svg>
  );
}

/** How to read the mini plots: each night faint, its 7-day average bold, the usual dashed. */
function TrendKey({ d }: { d: Defs }) {
  return (
    <span data-tip={tip(d, 'trend_7d')} tabIndex={0} style={{ alignSelf: 'flex-start', display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px', fontSize: 12, color: 'var(--tx3)' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 1.5, background: 'var(--tx2)', opacity: 0.5 }} />each night</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 3, borderRadius: 2, background: 'var(--tx2)' }} />7-day average</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, borderTop: '1.5px dashed var(--tx3)' }} />your usual</span>
    </span>
  );
}

/** Sleep against need, fourteen nights (R9): stages stacked in hours on an axis, the need as a dashed
 * mark, a tip per night; a click picks the night. */
function SleepVsNeed({ win, series, nights, date, onPick, d }: { win: string[]; series: any[]; nights: any[]; date: string; onPick: (x: string) => void; d: Defs }) {
  const xs = win.map((dd) => series.find((y) => y.date === dd) ?? { date: dd });
  const h = (m?: number) => (m ?? 0) / 60;
  const stacks = [
    { values: xs.map((x) => h(x.deep_min)), color: 'var(--g)', label: 'Deep' },
    { values: xs.map((x) => h(x.rem_min)), color: 'var(--v)', label: 'REM' },
    { values: xs.map((x) => h(x.light_min)), color: 'var(--b)', label: 'Light' },
  ];
  return (
    <section aria-labelledby="svn" className="card">
      <h2 id="svn" className="l" style={{ color: 'var(--tx)' }} data-tip={tip(d, 'sleep_performance')} tabIndex={0}>Sleep vs need · {win.length} nights</h2>
      <Bars labels={xs.map((x) => dshort(x.date))} stacks={stacks} height={170} ariaLabel="Hours asleep by stage each night, with the night's sleep need"
        fmt={(v) => `${Math.round(v)} h`} yTicks={5} selected={win.indexOf(date)} onPick={(i) => onPick(win[i])}
        marker={{ values: xs.map((x) => x.need_h ?? null), color: 'var(--tx)', label: 'Need' }}
        tips={xs.map((x) => rich({
          t: `Night to ${day(x.date)}`,
          r: [['Asleep', `${hm(x.sleep_h)}${x.sleep_h && x.need_h ? ` · ${Math.round((x.sleep_h / x.need_h) * 100)} % of need` : ''}`], ['Need', hm(x.need_h), 'var(--tx)'],
            ['Deep', hm(h(x.deep_min)), 'var(--g)'], ['REM', hm(h(x.rem_min)), 'var(--v)'], ['Light', hm(h(x.light_min)), 'var(--b)'], ['Garmin sleep score', String(x.sleep_score ?? '—')]],
          h: nights.some((n) => n.date === x.date) ? 'Click to show this night' : undefined, s: 'Garmin',
        }))}
        xLabels={xs.map((x) => <span>{day(x.date).split(' ')[0].slice(0, 2)}<br />{Number(x.date.slice(8))}</span>)} />
      <Legend items={[['Deep', 'var(--g)', 'box'], ['REM', 'var(--v)', 'box'], ['Light', 'var(--b)', 'box'], ['Sleep need (Garmin)', 'var(--tx)', 'dash']]} />
    </section>
  );
}

/** The overnight vitals (R10): one tile each — the night's value against your usual, and thirty
 * nights on a small chart with the picked night marked. */
function Vitals({ series, date, days, onPick, flags, d }: { series: any[]; date: string; days: string[]; onPick: (x: string) => void; flags: string[]; d: Defs }) {
  const xs = days.map((dd) => series.find((y) => y.date === dd) ?? { date: dd });
  const x = xs.find((y) => y.date === date) ?? {};
  const tiles = [
    { k: 'resp', label: 'Respiration', unit: 'brpm', dg: 1, v: x.resp, base: x.resp_base, baseSeries: xs.map((y) => y.resp_base), color: 'var(--b)',
      flag: x.resp != null && x.resp_base != null && x.resp - x.resp_base >= 1, word: (dv: number) => `${dv >= 0 ? '+' : '−'}${nf(Math.abs(dv), 1)} vs usual ${nf(x.resp_base, 1)}`,
      note: 'Average breaths per minute asleep. 1+ above your usual is an early illness sign. Usual = the 29 nights before.\nSource: Garmin.' },
    { k: 'hr_low', label: 'Lowest heart rate', unit: 'bpm', dg: 0, v: x.hr_low, base: x.hr_low_base, baseSeries: xs.map((y) => y.hr_low_base), color: 'var(--r)',
      flag: x.hr_low != null && x.hr_low_base != null && x.hr_low - x.hr_low_base >= 3, word: (dv: number) => `${dv >= 0 ? '+' : '−'}${nf(Math.abs(dv), 0)} vs usual ${nf(x.hr_low_base, 0)}`,
      note: 'The lowest heart rate the watch recorded asleep. Lower than usual is a well-recovered night. Usual = the 29 nights before.\nSource: Garmin.' },
    { k: 'spo2', label: 'SpO₂', unit: '%', dg: 0, v: x.spo2, base: 94, baseSeries: null, color: 'var(--v)',
      flag: x.spo2 != null && x.spo2 < 94, word: () => (x.spo2 < 94 ? 'below 94 % — recheck tomorrow' : 'normal (94 % and up)'),
      note: 'Average blood-oxygen saturation asleep. Below 94 % is worth a second look.\nSource: Garmin.' },
    { k: 'skin_dev', label: 'Skin temperature', unit: '°C', dg: 1, v: x.skin_dev, base: 0, baseSeries: null, color: 'var(--o)',
      flag: x.skin_dev != null && x.skin_dev >= 1, word: (dv: number) => `${dv >= 0 ? '+' : '−'}${nf(Math.abs(dv), 1)} °C vs Garmin’s baseline`,
      note: 'Overnight skin temperature against Garmin’s own baseline. +1 °C or more can mean illness or overreaching.\nSource: Garmin.' },
  ].filter((t) => xs.some((y) => y[t.k] != null));
  return (
    <section aria-labelledby="vit" className="card">
      <h2 id="vit" className="l" style={{ color: 'var(--tx)' }}>Overnight vitals · night to {dshort(date)}</h2>
      {!tiles.length ? <Empty title="No overnight vitals yet.">Respiration, SpO₂ and skin temperature appear when the watch records them.</Empty> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 12 }}>
          {tiles.map((t) => (
            <div key={t.k} data-tip={t.note} tabIndex={0} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 14, borderRadius: 12, background: 'var(--bg)', border: `1px solid ${t.flag ? 'var(--y)' : 'var(--ln)'}` }}>
              <span className="l" style={{ fontSize: 10 }}>{t.label}</span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span className="n" style={{ fontSize: 30, lineHeight: 1, fontWeight: 700, color: t.flag ? 'var(--y)' : 'var(--tx)' }}>{t.v == null ? '—' : `${t.k === 'skin_dev' && t.v > 0 ? '+' : ''}${nf(t.v, t.dg)}`}</span>
                <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{t.unit}</span>
                {t.flag && <Icon d={IC.warn} size={14} style={{ color: 'var(--y)', marginLeft: 'auto' }} />}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: t.flag ? 'var(--y)' : 'var(--tx2)' }}>{t.v == null ? 'not recorded this night' : t.base == null ? '—' : t.word(t.v - t.base)}</span>
              <TimeChart dates={xs.map((y) => y.date)} height={70} yTicks={2} xTicks={3} mark={date} onPick={onPick} fmt={(v) => nf(v, t.dg)}
                series={[{ values: xs.map((y) => y[t.k] ?? null), color: t.color, width: 1.2, opacity: 0.4, label: t.label },
                  { values: xs.map((y) => y[`${t.k}_7d`] ?? null), color: t.color, width: 2.4, label: '7-night average' },
                  ...(t.baseSeries ? [{ values: t.baseSeries, color: 'var(--tx3)', width: 1, dash: '3 3', label: 'Usual' }] : [])]}
                baseline={t.baseSeries ? null : t.base} ariaLabel={`${t.label}, 30 nights`} />
            </div>
          ))}
        </div>
      )}
      {tiles.length > 0 && <TrendKey d={d} />}
      {flags.map((f, i) => <span key={i} role="note" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--y)' }}><Icon d={IC.warn} size={13} />{f}</span>)}
    </section>
  );
}
