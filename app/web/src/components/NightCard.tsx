/**
 * One night's sleep, measured (Recovery): how much of what you needed you got, then the numbers that
 * say how good it was — each against your own last 14 nights, so "52 %" means something. Every
 * number is the engine's (app_data.hypnogram → export.sleep_metrics, the brief's own definitions).
 * "Usual" is the 14 nights before the one shown.
 */
import type { Defs } from '../lib/api';
import { dshort, hm, nf, tip } from '../lib/fmt';
import { IC, Icon } from './ui';

type Better = 'up' | 'down' | 'none';

/** "22:54" → minutes since 18:00, so a night's times average without wrapping at midnight. */
const fromSix = (t?: string | null) => (t ? (((+t.slice(0, 2) - 18 + 24) % 24) * 60 + +t.slice(3, 5)) : null);
const clockOf = (m: number) => { const t = (Math.round(m) + 18 * 60) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const mean = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => x != null); return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export function NightCard({ night, nights, isLast, debt, consistency, defs }: {
  night: any; nights: any[]; isLast: boolean; debt?: number | null; consistency?: number | null; defs: Defs;
}) {
  // Your usual: the 14 nights before this one (a later night is not "usual" for an earlier one).
  const others = nights.filter((n) => n.date < night.date).slice(-14);
  const avg = (k: string) => mean(others.map((n) => n[k]));
  const perf = night.performance_pct;
  const short = night.need_min && night.asleep_min ? night.need_min - night.asleep_min : null;
  const col = perf == null ? 'var(--tx)' : perf >= 85 ? 'var(--g)' : perf >= 70 ? 'var(--y)' : 'var(--r)';
  const tiles: { k: string; label: string; v: number | null; show: (v: number) => string; unit?: string; better: Better; tip?: string }[] = [
    { k: 'asleep_min', label: 'Asleep', v: night.asleep_min, show: (v) => hm(v / 60), better: 'up' },
    { k: 'restorative_pct', label: 'Restorative', v: night.restorative_pct, show: (v) => `${Math.round(v)}`, unit: '%', better: 'up', tip: tip(defs, 'sleep_restorative') },
    { k: 'efficiency_pct', label: 'Efficiency', v: night.efficiency_pct, show: (v) => `${Math.round(v)}`, unit: '%', better: 'up', tip: tip(defs, 'sleep_efficiency') },
    { k: 'hr_low', label: 'Lowest HR', v: night.hr_low, show: (v) => `${Math.round(v)}`, unit: 'bpm', better: 'down', tip: 'The lowest heart rate the watch recorded asleep — lower than usual is a well-recovered night.\nSource: Garmin.' },
    { k: 'awakenings', label: 'Awakenings', v: night.awakenings, show: (v) => `${Math.round(v)}`, better: 'down', tip: tip(defs, 'awakenings') },
    { k: 'hrv_avg', label: 'Overnight HRV', v: night.hrv_avg, show: (v) => `${Math.round(v)}`, unit: 'ms', better: 'up', tip: tip(defs, 'hrv') },
    { k: 'respiration', label: 'Respiration', v: night.respiration, show: (v) => nf(v, 1), unit: 'brpm', better: 'none', tip: 'Average breaths per minute asleep. A jump of 1+ over your usual is an early illness signal.\nSource: Garmin.' },
    { k: 'body_battery_change', label: 'Body battery', v: night.body_battery_change, show: (v) => `+${Math.round(v)}`, better: 'up', tip: 'How much Garmin’s body battery recharged overnight.\nSource: Garmin.' },
  ];
  const shown = tiles.filter((t) => t.v != null);
  const bedAvg = mean(others.map((n) => fromSix(n.start)));
  const upAvg = mean(others.map((n) => fromSix(n.end)));
  const drift = (t: string | null, a: number | null) => {
    const m = fromSix(t);
    if (m == null || a == null) return null;
    const dm = Math.round(m - a);
    return Math.abs(dm) < 10 ? 'as usual' : `${Math.abs(dm)} min ${dm > 0 ? 'later' : 'earlier'} than usual`;
  };
  return (
    <section aria-labelledby="night" className="card" style={{ gap: 16 }}>
      <h2 id="night" data-tip={tip(defs, 'sleep_performance')} tabIndex={0} className="l" style={{ color: 'var(--tx)' }}>{isLast ? 'Last night' : `Night to ${dshort(night.date)}`}</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 14px' }}>
        <span className="n" style={{ fontSize: 52, lineHeight: 0.9, fontWeight: 700, color: col }}>{perf ?? '—'}<span style={{ fontSize: 24 }}>%</span></span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15 }}><b className="n" style={{ fontSize: 18 }}>{hm((night.asleep_min ?? 0) / 60)}</b> asleep of <b className="n" style={{ fontSize: 18 }}>{night.need_min ? hm(night.need_min / 60) : '—'}</b> needed</span>
          <span style={{ fontSize: 13, color: short != null && short > 10 ? 'var(--y)' : 'var(--g)' }}>
            {short == null ? 'Garmin sent no sleep need' : short > 10 ? `${hm(short / 60)} short` : 'Need met'}
          </span>
        </span>
        {night.score != null && <span className="chip" data-tip={tip(defs, 'sleep_score')} tabIndex={0} style={{ marginLeft: 'auto', background: 'var(--s2)', color: 'var(--tx)' }}>Garmin score {night.score}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(118px, 100%), 1fr))', gap: 1, background: 'var(--ln)', border: '1px solid var(--ln)', borderRadius: 12, overflow: 'hidden' }}>
        {shown.map((t) => {
          const a = avg(t.k);
          const delta = a == null || t.v == null ? null : t.v - a;
          const usual = delta == null || Math.abs(delta) < (t.k === 'asleep_min' ? 5 : 0.5);
          // Better or worse than your usual — colour only when it is either; "as usual" stays neutral.
          const good = usual || t.better === 'none' ? null : (delta! > 0) === (t.better === 'up');
          return (
            <div key={t.k} data-tip={`${t.tip ? `${t.tip}\n` : ''}Your 14-night average: ${a == null ? 'not enough nights yet' : `${t.show(a)}${t.unit ? ` ${t.unit}` : ''}`}.`} tabIndex={0}
              style={{ background: 'var(--s1)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span className="l" style={{ fontSize: 10 }}>{t.label}</span>
              <span className="n" style={{ fontSize: 24, lineHeight: 1, fontWeight: 700 }}>{t.show(t.v as number)}<span style={{ fontSize: 12, color: 'var(--tx2)', fontWeight: 500 }}>{t.unit ? ` ${t.unit}` : ''}</span></span>
              <span className="m" style={{ fontSize: 10, color: good == null ? 'var(--tx3)' : good ? 'var(--g)' : 'var(--y)' }}>
                {a == null ? '—' : usual ? 'as usual' : `${delta! > 0 ? '+' : '−'}${t.k === 'asleep_min' ? hm(Math.abs(delta!) / 60) : t.show(Math.abs(delta!)).replace('+', '')} vs usual`}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', fontSize: 13, color: 'var(--tx2)' }}>
        <span data-tip={bedAvg != null ? `Usual over 14 nights: ${clockOf(bedAvg)}` : undefined} tabIndex={0}>
          <Icon d={IC.moon} size={12} sw={2} /> Asleep <b className="n" style={{ fontSize: 16, color: 'var(--tx)' }}>{night.start ?? '—'}</b>{drift(night.start, bedAvg) ? ` · ${drift(night.start, bedAvg)}` : ''}
        </span>
        <span data-tip={upAvg != null ? `Usual over 14 nights: ${clockOf(upAvg)}` : undefined} tabIndex={0}>
          Up <b className="n" style={{ fontSize: 16, color: 'var(--tx)' }}>{night.end ?? '—'}</b>{drift(night.end, upAvg) ? ` · ${drift(night.end, upAvg)}` : ''}
        </span>
        {isLast && debt != null && <span>Debt 7 d <b className="n" style={{ fontSize: 16, color: debt >= 4 ? 'var(--y)' : 'var(--tx)' }}>{hm(debt)}</b></span>}
        {isLast && consistency != null && <span data-tip="How regular your bed and wake times were over the last 5 nights (100 = the same every night)." tabIndex={0}>Consistency <b className="n" style={{ fontSize: 16, color: 'var(--tx)' }}>{consistency}%</b></span>}
      </div>
    </section>
  );
}
