/**
 * Training load (board Load), rebuilt 2026-10-11 (R11). Never one number (CLAUDE.md): this week
 * against your usual — time, cardio load, strength — then twelve weeks of training time by kind (the
 * one measure tennis, rides and lifting share), cardio load by sport, strength by tonnage and sets
 * with its ratio, and fitness, fatigue and form with form's zones.
 */
import { useView, type Defs } from '../lib/api';
import { day, dshort, hm, nf, tip } from '../lib/fmt';
import { rich } from '../lib/tip';
import { FORM_ZONES, formZone } from '../lib/form';
import { Bars, Legend, TimeChart } from '../components/Chart';
import { kindColor } from '../components/SportIcon';
import { ErrorBox, PageTitle, Skeleton } from '../components/ui';

const KINDS: [string, string][] = [['strength', 'Strength'], ['endurance', 'Endurance'], ['circuit', 'Circuit'], ['sport', 'Other sports']];
const shade = (pct: number) => `color-mix(in srgb, var(--b) ${pct}%, transparent)`;
/** Cardio load buckets: the endurance sports in shades of blue, then circuits and other sports in their kind's colour. */
const BUCKETS: [string, string, string][] = [['run', 'Runs', 'var(--b)'], ['bike', 'Rides', shade(62)], ['swim', 'Swims', shade(36)], ['race', 'Multisport', 'var(--r)'],
  ['circuit', 'Circuits', 'var(--v)'], ['sport', 'Other sports', 'var(--c)']];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ratioWord = (v: number | null, safe: [number, number]) => (v == null ? 'not enough history' : v > safe[1] ? 'ramping fast' : v < safe[0] ? 'easing off' : 'steady');

export default function Load() {
  const { data: l, error, loading } = useView('load');
  if (error) return <ErrorBox error={error} />;
  if (loading && !l) return <><Skeleton h={100} /><Skeleton h={220} /><Skeleton h={260} /></>;
  const d: Defs = l.defs;
  const m: any[] = l.model;
  const last = m[m.length - 1] ?? {};
  const weeks: any[] = l.weeks;
  const cur = weeks[weeks.length - 1] ?? { minutes: {}, cardio: {}, sports: {} };
  const prev = weeks.slice(-5, -1);   // the four whole weeks before this one
  const n: number = l.days_so_far ?? 7;
  const wk = (w: any, i: number) => (i === weeks.length - 1 ? 'this wk' : dshort(w.monday));
  const tot = (w: any) => Object.values(w.minutes ?? {}).reduce((a: number, b: any) => a + b, 0) as number;
  const safe: [number, number] = l.acwr?.safe ?? [0.8, 1.3];
  const garminAcwr = l.acwr?.cardio != null ? l.acwr.cardio / 100 : null;
  const strengthAcwr = l.acwr?.strength?.at(-1)?.ratio ?? null;
  const fz = formZone(last.form);
  const status = (l.status ?? '').replace(/_\d+$/, '').replace(/_/g, ' ').toLowerCase();
  const signed = (x: number | null | undefined) => (x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${nf(Math.abs(x))}`);
  const usedBuckets = BUCKETS.filter(([k]) => weeks.some((w) => w.cardio[k]));
  const usedKinds = KINDS.filter(([k]) => weeks.some((w) => w.minutes?.[k]));
  return (
    <>
      <PageTitle eyebrow="Training load" title={<span><span style={{ color: fz?.col }}>{fz?.word ?? 'Form'}</span> · form {signed(last.form)}</span>} right={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-end' }}>
          {[['Fitness', nf(last.fitness), tip(d, 'fitness')], ['Fatigue', nf(last.fatigue), tip(d, 'fatigue')], ['VO₂max', nf(l.vo2?.run, 1), 'Garmin VO₂max (running).\nSource: Garmin.']].map(([k, v, t]) => (
            <div key={k} data-tip={t} tabIndex={0}><div className="l">{k}</div><div className="n" style={{ fontSize: 30, fontWeight: 700 }}>{v}</div></div>
          ))}
          {status && <span className="chip" data-tip={'Garmin’s training status.\nSource: Garmin.'} tabIndex={0} style={{ background: 'var(--s2)', color: 'var(--tx)', textTransform: 'capitalize' }}>Garmin: {status}</span>}
        </div>
      } />

      <section aria-labelledby="usual" className="card" style={{ gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 14px' }}>
          <h2 id="usual" className="l" style={{ color: 'var(--tx)' }}>This week vs your usual</h2>
          <span className="m" style={{ color: 'var(--tx3)' }}>{n} of 7 days · usual = the average of the 4 weeks before</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(250px, 100%), 1fr))', gap: 12 }}>
          <Meter label="Training time · all sports" color="var(--tx)" value={tot(cur)} usual={mean(prev.map(tot))} n={n} show={(v) => hm(v / 60)}
            foot={Object.entries(cur.sports ?? {}).slice(0, 4).map(([sp, mins]) => `${sp} ${hm((mins as number) / 60)}`).join(' · ') || 'nothing yet this week'}
            tipText="Every session's duration, whatever the sport — the one measure lifting, rides and tennis share." />
          <Meter label="Cardio · Garmin load" color="var(--b)" value={cur.cardio_total} usual={mean(prev.map((w) => w.cardio_total))} n={n} show={(v) => nf(v)}
            target={l.cardio?.load?.band} tipText={tip(d, 'load')}
            foot={<>
              <span data-tip={tip(d, 'acwr_cardio')} tabIndex={0}>Ratio <b className="n" style={{ fontSize: 15, color: garminAcwr == null ? 'var(--tx3)' : garminAcwr > safe[1] || garminAcwr < safe[0] ? 'var(--y)' : 'var(--g)' }}>{garminAcwr == null ? '—' : nf(garminAcwr, 2)}</b> · {ratioWord(garminAcwr, safe)}</span>
              {l.cardio && Object.entries(l.cardio.sessions).map(([g, v]: [string, any]) => <span key={g}> · {({ run: 'runs', swim: 'swims', bike: 'rides' } as any)[g]} {v.done}/{v.target}</span>)}
            </>} />
          <Meter label="Strength · tonnage" color="var(--o)" value={cur.tonnage} usual={mean(prev.map((w) => w.tonnage))} n={n} show={(v) => `${nf(v / 1000, 1)} t`}
            tipText={tip(d, 'tonnage')}
            foot={<>
              <span>{nf(cur.sets)} working sets (usual {nf(mean(prev.map((w) => w.sets)))})</span>
              <span data-tip={tip(d, 'acwr_strength')} tabIndex={0}> · ratio <b className="n" style={{ fontSize: 15, color: strengthAcwr == null ? 'var(--tx3)' : strengthAcwr > safe[1] || strengthAcwr < safe[0] ? 'var(--y)' : 'var(--g)' }}>{strengthAcwr == null ? '—' : nf(strengthAcwr, 2)}</b> · {ratioWord(strengthAcwr, safe)}</span>
            </>} />
        </div>
      </section>

      <section aria-labelledby="time" className="card">
        <h2 id="time" className="l" style={{ color: 'var(--tx)' }}>Training time by kind · 12 weeks</h2>
        <Bars labels={weeks.map(wk)} labelEvery={2} height={180} ariaLabel="Weekly training hours by kind" fmt={(v) => (v < 1 ? `${Math.round(v * 60)}′` : hm(v))} yTicks={4}
          stacks={usedKinds.map(([k, label]) => ({ values: weeks.map((w) => (w.minutes?.[k] ?? 0) / 60), color: kindColor(k), label }))}
          selected={weeks.length - 1}
          tips={weeks.map((w, i) => rich({
            t: `Week of ${dshort(w.monday)}${i === weeks.length - 1 ? ` · ${n} of 7 days so far` : ''}`,
            r: [...Object.entries(w.sports ?? {}).map(([sp, mins]): [string, string, string] => [sp, hm((mins as number) / 60), kindColor(w.sport_kind?.[sp])]),
              ['Total', `${hm(tot(w) / 60)} · ${w.sessions} sessions`]],
            n: Object.keys(w.sports ?? {}).length ? undefined : ['Rest week.'],
          }))} />
        <Legend items={usedKinds.map(([k, label]) => [label, kindColor(k), 'box'] as [string, string, 'box'])} />
      </section>

      <div className="grid2">
        <section className="card">
          <h2 data-tip={tip(d, 'load')} tabIndex={0} className="l" style={{ color: 'var(--b)' }}>Cardio · Garmin load by sport · 12 weeks</h2>
          <Bars labels={weeks.map(wk)} labelEvery={3} ariaLabel="Weekly cardio load by sport" target={l.cardio?.load?.band} fmt={(v) => nf(v)}
            stacks={usedBuckets.map(([k, label, c]) => ({ values: weeks.map((w) => w.cardio[k] ?? 0), color: c, label }))} selected={weeks.length - 1}
            tips={weeks.map((w, i) => rich({
              t: `Week of ${dshort(w.monday)}${i === weeks.length - 1 ? ` · ${n} of 7 days` : ''}`,
              r: [...usedBuckets.filter(([k]) => w.cardio[k]).map(([k, label, c]): [string, string, string] => [label, nf(w.cardio[k]), c]),
                ['Total', `${nf(w.cardio_total)}${w.km ? ` · ${nf(w.km, 1)} km` : ''}`],
                ...(l.cardio?.load?.band ? [['Target', `${l.cardio.load.band[0]}–${l.cardio.load.band[1]}`, 'var(--s3)'] as [string, string, string]] : [])],
              s: 'Garmin',
            }))} />
          <Legend items={[...usedBuckets.map(([, label, c]) => [label, c, 'box'] as [string, string, 'box']), ...(l.cardio?.load?.band ? [[`target ${l.cardio.load.band[0]}–${l.cardio.load.band[1]}`, 'var(--s3)', 'box'] as [string, string, 'box']] : [])]} />
          <span style={{ fontSize: 12, color: 'var(--tx3)' }}>Garmin’s load reads heart rate (EPOC). Lifting ({nf(cur.strength_load)} this week) is left out here — it barely registers.</span>
        </section>
        <section className="card">
          <h2 data-tip={tip(d, 'tonnage')} tabIndex={0} className="l" style={{ color: 'var(--o)' }}>Strength · tonnage and sets · 12 weeks</h2>
          <Bars labels={weeks.map(wk)} ariaLabel="Weekly tonnage in tonnes" fmt={(v) => `${nf(v, v < 10 ? 1 : 0)} t`} selected={weeks.length - 1}
            stacks={[{ values: weeks.map((w) => w.tonnage / 1000), color: 'var(--o)', label: 'Tonnage' }]}
            tips={weeks.map((w, i) => rich({ t: `Week of ${dshort(w.monday)}${i === weeks.length - 1 ? ` · ${n} of 7 days` : ''}`,
              r: [['Tonnage', `${nf(w.tonnage / 1000, 1)} t`, 'var(--o)'], ['Working sets', nf(w.sets)]], s: 'Computed by OpenSportCoach' }))}
            xLabels={weeks.map((w) => <span style={{ color: 'var(--tx2)' }}>{w.sets || ''}</span>)} />
          <Legend items={[['tonnage, t', 'var(--o)', 'box'], ['numbers under the bars: working sets', 'var(--tx2)', 'dash']]} />
          <div data-tip={tip(d, 'acwr_strength')} tabIndex={0} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="l" style={{ fontSize: 10 }}>Acute : chronic tonnage · safe {safe[0]}–{safe[1]}</span>
            <TimeChart dates={(l.acwr?.strength ?? []).map((x: any) => x.end)} height={90} yTicks={3} bandConst={safe} fmt={(v) => nf(v, 1)} xTicks={4}
              ariaLabel="Strength acute to chronic ratio, weekly" series={[{ values: (l.acwr?.strength ?? []).map((x: any) => x.ratio), color: 'var(--o)', label: 'Ratio' }]} />
          </div>
        </section>
      </div>

      <section aria-labelledby="ff" className="card">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 14px' }}>
          <h2 id="ff" data-tip={tip(d, 'form')} tabIndex={0} className="l" style={{ color: 'var(--tx)' }}>Fitness · fatigue · form · 90 days</h2>
          {fz && <span style={{ fontSize: 13, color: 'var(--tx2)' }}><b style={{ color: fz.col }}>{fz.word}</b> — {fz.means}.</span>}
        </div>
        <TimeChart dates={m.map((x) => x.date)} height={170} ariaLabel="Fitness and fatigue over 90 days" fmt={(v) => nf(v)}
          series={[{ values: m.map((x) => x.fitness), color: 'var(--b)', label: 'Fitness (42-day)' }, { values: m.map((x) => x.fatigue), color: 'var(--r)', label: 'Fatigue (7-day)' }]} />
        <Legend items={[['fitness — 42-day load', 'var(--b)'], ['fatigue — 7-day load', 'var(--r)']]} />
        <TimeChart dates={m.map((x) => x.date)} height={110} yTicks={3} baseline={0} ariaLabel="Form over 90 days, with its zones" fmt={(v) => signed(v)}
          zones={FORM_ZONES.filter((z) => z.tint !== 'transparent').map((z) => ({ from: z.from, to: z.to, color: z.tint, label: z.word }))}
          series={[{ values: m.map((x) => x.form), color: 'var(--tx)', width: 1.8, label: 'Form' }]}
          tip={(i) => { const z = formZone(m[i].form); return rich({ t: day(m[i].date), r: [['Form', `${signed(m[i].form)}${z ? ` · ${z.word}` : ''}`, z?.col ?? 'var(--tx)'], ['Fitness', nf(m[i].fitness), 'var(--b)'], ['Fatigue', nf(m[i].fatigue), 'var(--r)']], n: z ? [z.means] : undefined }); }} />
        <Legend items={FORM_ZONES.filter((z) => z.tint !== 'transparent').map((z) => [`${z.word} ${z.from > -1e8 ? (z.to < 1e8 ? `${z.from} to ${z.to}` : `above ${z.from}`) : `below ${z.to}`}`, z.tint, 'box'] as [string, string, 'box'])} />
        <span style={{ fontSize: 12, color: 'var(--tx3)' }}>Form = fitness − fatigue, from Garmin’s heart-rate load — so it follows your cardio; strength is read by tonnage and sets above.</span>
      </section>
    </>
  );
}

/** This week against the usual week: the value so far, a bar with the usual week marked and where
 * the usual week would be by today, and a word for the pace. */
function Meter({ label, color, value, usual, n, show, target, foot, tipText }: {
  label: string; color: string; value: number; usual: number | null; n: number; show: (v: number) => string;
  target?: [number, number] | null; foot?: React.ReactNode; tipText?: string;
}) {
  const byNow = usual != null ? (usual * n) / 7 : null;
  const max = Math.max(1, value, usual ?? 0, target?.[1] ?? 0) * 1.12;
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const pace = byNow == null || byNow === 0 ? null : value / byNow;
  // Day one with nothing logged is the week starting, not falling behind (U15: Monday morning read yellow).
  const starting = n <= 1 && !value;
  const word = pace == null ? 'no usual yet' : starting ? 'the week has just started' : pace > 1.15 ? 'ahead of your usual pace' : pace < 0.85 ? 'behind your usual pace' : 'on your usual pace';
  return (
    <div data-tip={tipText} tabIndex={0} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--ln)' }}>
      <span className="l" style={{ fontSize: 10, color }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span className="n" style={{ fontSize: 36, lineHeight: 1, fontWeight: 700 }}>{show(value ?? 0)}</span>
        <span style={{ fontSize: 13, color: 'var(--tx2)' }}>usual week {usual == null ? '—' : show(usual)}</span>
      </span>
      <div style={{ position: 'relative', height: 12, borderRadius: 6, background: 'var(--s3)' }}>
        {target && <div title={`Target ${target[0]}–${target[1]}`} style={{ position: 'absolute', left: pct(target[0]), width: `calc(${pct(target[1])} - ${pct(target[0])})`, top: -3, bottom: -3, border: '1px dashed var(--tx3)', borderRadius: 4 }} />}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct(value ?? 0), borderRadius: 6, background: color === 'var(--tx)' ? 'var(--tx2)' : color }} />
        {byNow != null && <div title="Where a usual week is by today" style={{ position: 'absolute', left: pct(byNow), top: -4, bottom: -4, width: 2, background: 'var(--tx3)' }} />}
        {usual != null && <div title="A usual whole week" style={{ position: 'absolute', left: pct(usual), top: -6, bottom: -6, width: 2, background: 'var(--tx)' }} />}
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: pace == null || starting ? 'var(--tx3)' : pace < 0.85 ? 'var(--y)' : 'var(--tx2)' }}>{word}{byNow != null ? ` (usual by today: ${show(byNow)})` : ''}</span>
      {foot && <span style={{ fontSize: 12, color: 'var(--tx2)', lineHeight: 1.5 }}>{foot}</span>}
    </div>
  );
}
