/**
 * Fuel (board Fuel, handoff 2026-11-07; docs/DESIGN.md (fuelling and score)): carbohydrate in training and racing on
 * one screen — today's plan, what's left to log, what's coming up, the gut-training ramp, the next A
 * race, and the setup. Every number comes from the `fuel` view (scripts/fuel.py).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, useView } from '../lib/api';
import { day, dshort, tip } from '../lib/fmt';
import { Empty, ErrorBox, IC, Icon, PageTitle, Skeleton } from '../components/ui';
import { FUEL_ICON, FuelPlanCard, Mark, cueHref, fuelHref, hm, type FuelPlanT } from '../components/Fuel';
import { SportIcon } from '../components/SportIcon';

export default function Fuel() {
  const { data: v, error, loading } = useView('fuel');
  if (error) return <ErrorBox error={error} />;
  if (loading && !v) return <><Skeleton h={90} /><Skeleton h={320} /><Skeleton h={220} /></>;
  const ramp = v.ramp;
  const openQs = (v.questions ?? []).filter((q: any) => q.open).length;
  const tops: { l: string; v: string; s: string; href: string; c?: string; t?: string }[] = [
    { l: 'Your gut', v: ramp ? `${ramp.current_g_h} g/h` : '—', s: ramp ? `since ${dshort(ramp.since)} · you` : 'not set yet', href: '/fuel/setup', t: tip(v.defs, 'fuel_gut') },
    ...(ramp?.next_g_h ? [{ l: 'Next step', v: `${ramp.next_g_h} g/h`, s: `${ramp.counted_at_current} of ${ramp.rides_per_step} logged session${ramp.rides_per_step > 1 ? 's' : ''} at ${ramp.current_g_h}`, href: '#ramp' }] : []),
    { l: 'To log', v: `${v.to_log.length}`, s: v.to_log.length ? `${v.to_log.length === 1 ? 'session' : 'sessions'} · last 7 days` : 'all logged', href: '#log', c: v.to_log.length ? 'var(--b)' : undefined },
  ];
  return (
    <>
      <PageTitle eyebrow="Fuel" title="Carbohydrate in training and racing" />
      {openQs > 0 && (
        <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderRadius: 14, border: '1px solid var(--o)', background: 'var(--ot)' }}>
          <Icon d={FUEL_ICON} size={16} sw={2.2} style={{ color: 'var(--o)' }} />
          <span style={{ flex: 1, fontSize: 14 }}><b>Finish your fuel setup</b> — {openQs} of 4 questions open. Until then every plan is in grams only.</span>
          <Link to="/fuel/setup" className="btn">Finish setup</Link>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 10 }}>
        {tops.map((x) => {
          const st = { display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', borderRadius: 14, border: `1px solid ${x.c ?? 'var(--ln)'}`, background: 'var(--s1)', color: 'var(--tx)' } as const;
          const body = <>
            <span className="l" style={{ fontSize: 10, color: x.c }}>{x.l}</span>
            <span className="n" style={{ fontSize: 30, lineHeight: 1, fontWeight: 700 }}>{x.v}</span>
            <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{x.s}</span>
          </>;
          return x.href.startsWith('#') ? <a key={x.l} href={x.href} data-tip={x.t} className="hv" style={st}>{body}</a>
            : <Link key={x.l} to={x.href} data-tip={x.t} className="hv" style={st}>{body}</Link>;
        })}
      </div>

      <section aria-labelledby="fu-today" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 id="fu-today" className="l" style={{ color: 'var(--tx)' }}>Today · {day(new Date().toISOString().slice(0, 10))}</h2>
        {v.today_plans.length ? v.today_plans.map((p: any) => (
          <FuelPlanCard key={p.title} plan={p.fuel as FuelPlanT} ctx={`${p.title}${p.duration_min ? ` · ${hm(p.duration_min)}` : ''} · ${p.intent}`} defs={v.defs} cueHref={cueHref(p)} />
        )) : <span style={{ fontSize: 14, color: 'var(--tx2)' }}>Nothing planned today needs fuel.</span>}
      </section>

      <ToLog v={v} />

      <section aria-labelledby="fu-next" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 id="fu-next" className="l" style={{ color: 'var(--tx)' }}>Coming up · 14 days</h2>
        {v.upcoming.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 16, border: '1px solid var(--ln)', background: 'var(--s1)' }}>
            {v.upcoming.map((p: any, i: number) => {
              const f: FuelPlanT | null = p.fuel;
              return (
                <Link key={`${p.date}${p.title}`} to={`/plan?watch=${encodeURIComponent(p.workout ?? `plan:${p.date}:${p.title}`)}`} className="hv"
                  style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr) auto', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? '1px solid var(--ln)' : 0, color: 'var(--tx)' }}>
                  <span className="n" style={{ fontSize: 15, fontWeight: 700 }}>{day(p.date)}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700 }}><SportIcon icon={p.badge?.icon} size={14} />{p.title}</span>
                    {f?.needed && f.items.length ? (
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--tx2)' }}>
                        {f.items.map((x) => <span key={`${x.kind}:${x.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mark d={x.display} w={11} h={14} mono={false} />×{x.n} {x.short ?? x.label}</span>)}
                        {(f.notes ?? []).length > 0 && <span style={{ color: 'var(--tx3)' }}>· {f.notes!.length} note{f.notes!.length > 1 ? 's' : ''}</span>}
                      </span>
                    ) : <span style={{ fontSize: 12, color: 'var(--tx3)' }}>{!f ? 'No fuel plan — the coach hasn’t said what it’s for' : !f.needed ? `No fuel needed — ${hm(f.minutes)}` : 'Grams only — finish setup'}</span>}
                  </span>
                  <span className="n" style={{ fontSize: 20, fontWeight: 700, color: f?.needed ? 'var(--tx)' : 'var(--tx3)' }}>{f?.needed ? `${f.items.length ? f.planned_g_h : f.target_g_h} g/h` : '—'}</span>
                </Link>
              );
            })}
          </div>
        ) : <span style={{ fontSize: 14, color: 'var(--tx2)' }}>No rides or runs planned off the watch in the next two weeks.</span>}
      </section>

      <Ramp ramp={ramp} />

      {v.a_race && (
        <section aria-labelledby="fu-race" className="card" style={{ gap: 8 }}>
          <h2 id="fu-race" className="l" style={{ color: 'var(--tx)' }}>Race fuelling · next A race</h2>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{v.a_race.name} · {day(v.a_race.date)}</span>
          <span style={{ fontSize: 13, color: 'var(--tx2)' }}>The race plan by leg — carb load, race morning, bike and run — is the next piece to build. Until then the ramp above is the work toward it.</span>
          <Link to={`/race/${encodeURIComponent(v.a_race.id)}`} className="link" style={{ fontSize: 13, alignSelf: 'flex-start' }}>Open the race</Link>
        </section>
      )}

      <section aria-labelledby="fu-setup" className="card" style={{ gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 id="fu-setup" className="l" style={{ color: 'var(--tx)' }}>Your setup</h2>
          <span style={{ fontSize: 12, color: 'var(--tx3)' }}>{4 - openQs} of 4 answered</span>
          <Link to="/fuel/setup" className="btn2 hv" style={{ marginLeft: 'auto', minHeight: 34 }}>Change</Link>
        </div>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', fontSize: 14 }}>
          <dt style={{ color: 'var(--tx2)' }}>Products</dt><dd style={{ margin: 0 }}>{(v.pantry ?? []).filter((p: any) => p.kind === 'product').map((p: any) => p.short).concat((v.catalog ?? []).filter((c: any) => v.products.includes(c.id) && c.form === 'drink_mix').map((c: any) => c.name)).join(' · ') || '—'}</dd>
          <dt style={{ color: 'var(--tx2)' }}>Bottles</dt><dd style={{ margin: 0 }}>{(v.recipes ?? []).map((r: any) => `${r.powder_g} g in ${r.water_ml} ml${r.g_each != null ? ` · ${r.g_each} g` : ''}`).join(' · ') || '—'}</dd>
          <dt style={{ color: 'var(--tx2)' }}>Your gut</dt><dd style={{ margin: 0 }}>{v.gut ? `${v.gut.g_per_h} g/h · since ${dshort(v.gut.since)}` : '—'}</dd>
          <dt style={{ color: 'var(--tx2)' }}>Caffeine</dt><dd style={{ margin: 0 }}>{({ never: 'Never', races: 'Races only', training: 'Training too' } as Record<string, string>)[v.caffeine] ?? '—'}</dd>
        </dl>
      </section>
    </>
  );
}

/** Rides and runs that ask what was taken: As planned and Took nothing in one tap, anything else on its page. */
function ToLog({ v }: { v: any }) {
  const { fuel } = useStore();
  const [said, setSaid] = useState<Record<number, { ok: boolean; text: string }>>({});
  const send = (id: number, body: any) => fuel('log', body)
    .then(() => setSaid((x) => ({ ...x, [id]: { ok: true, text: body.nothing ? 'Logged: nothing taken' : 'Logged as planned' } })))
    .catch((e) => setSaid((x) => ({ ...x, [id]: { ok: false, text: `Not saved — ${String(e.message ?? e)}` } })));
  return (
    <section id="log" aria-labelledby="fu-log" style={{ display: 'flex', flexDirection: 'column', gap: 10, scrollMarginTop: 16 }}>
      <h2 id="fu-log" className="l" style={{ color: 'var(--tx)' }}>To log</h2>
      {!v.to_log.length ? <span style={{ fontSize: 14, color: 'var(--tx2)' }}>Nothing to log — every ride and run of an hour or more since your setup has a record.</span>
        : v.to_log.map((a: any) => {
          const p: FuelPlanT | null = a.plan;
          const s = said[a.id];
          return (
            <div key={a.id} className="card" style={{ gap: 10, borderColor: 'var(--b)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{a.title} · {day(a.date)}</span>
                <span className="n" style={{ color: 'var(--tx2)' }}>{hm(a.minutes)}</span>
                {p?.needed && p.items.length > 0 && <span style={{ fontSize: 13, color: 'var(--tx2)' }}>· plan was {p.items.map((x) => `${x.n} ${x.short ?? x.label}`).join(' + ')} · {p.planned_g} g</span>}
              </div>
              {s?.ok ? <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--g)' }}><Icon d={IC.check} size={13} sw={3} />{s.text}</span> : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  {p?.needed && p.items.length > 0 && <button type="button" className="btn" onClick={() => send(a.id, { activity_id: a.id, items: p.items.map((x) => ({ kind: x.kind, id: x.id, n: x.n })), as_planned: true })}>As planned</button>}
                  <button type="button" className="btn2 hv" onClick={() => send(a.id, { activity_id: a.id, items: [], nothing: true })}>Took nothing</button>
                  <Link to={fuelHref(a.id)} className="btn2 hv">Something else</Link>
                  {s && !s.ok && <span role="alert" style={{ fontSize: 12, color: 'var(--r)' }}>{s.text}</span>}
                </div>
              )}
            </div>
          );
        })}
      <span style={{ fontSize: 12, color: 'var(--tx3)' }}>Swims can’t be logged. What you log is yours — source “you”, never Garmin.</span>
    </section>
  );
}

/** The gut-training ramp (board Fuel-Ramp): the steps from now to the race band, and every long session's g/h. */
function Ramp({ ramp }: { ramp: any }) {
  if (!ramp) {
    return <section id="ramp" className="card"><Empty title="No gut rate yet.">Answer “what does your gut take” in the setup, and the ramp to race rate starts here.</Empty></section>;
  }
  const hist: any[] = ramp.history ?? [];
  const top = Math.max(100, ...hist.map((x) => x.g_h ?? 0));
  const W = 600, H = 160, Y = (v: number) => H - (v / top) * H;
  return (
    <section id="ramp" aria-labelledby="fu-ramp" className="card" style={{ gap: 14, scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 id="fu-ramp" className="l" style={{ color: 'var(--tx)' }}>Gut training</h2>
        <span style={{ fontSize: 13, color: 'var(--tx2)' }}>
          {ramp.next_g_h ? <>+{ramp.step_g_h} g/h after {ramp.rides_per_step - ramp.counted_at_current > 0 ? `${ramp.rides_per_step - ramp.counted_at_current} more` : 'this'} logged session{ramp.rides_per_step > 1 ? 's' : ''} of {ramp.min_minutes} min+ at {ramp.current_g_h}</> : 'At the top of the race band.'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        {ramp.steps.map((s: number, i: number) => {
          const race = s >= ramp.race_band[0];
          const now = i === 0;
          return (
            <div key={s} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2, minWidth: 90, height: 60 + i * 22, padding: '8px 12px', boxSizing: 'border-box', borderRadius: 12,
              border: now ? '1.5px solid var(--tx)' : `1.5px dashed ${race ? 'var(--g)' : 'var(--ln2)'}`, background: now ? 'var(--s3)' : 'transparent' }}>
              <span className="n" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{s}</span>
              <span style={{ fontSize: 11, color: now ? 'var(--tx)' : race ? 'var(--g)' : 'var(--tx2)' }}>{now ? 'Now' : i === 1 ? 'Next' : race ? 'Race band' : 'Step'}</span>
            </div>
          );
        })}
      </div>
      {hist.length ? (
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <svg role="img" aria-label={`Long sessions: ${hist.map((x) => `${x.date} ${x.g_h} g/h`).join(', ')}`} viewBox={`0 0 ${W} ${H + 18}`} width="100%" style={{ display: 'block', maxHeight: 200 }}>
            {[20, 40, 60, 80, 100].filter((g) => g <= top).map((g) => <g key={g}><line x1={28} x2={W} y1={Y(g)} y2={Y(g)} style={{ stroke: 'var(--ln)' }} />
              <text x={0} y={Y(g) + 4} fontSize={10} style={{ fill: 'var(--tx3)' }}>{g}</text></g>)}
            <rect x={28} y={Y(ramp.race_band[1])} width={W - 28} height={Y(ramp.race_band[0]) - Y(ramp.race_band[1])} style={{ fill: 'var(--gt)' }} />
            <text x={W - 4} y={Y(ramp.race_band[1]) + 12} fontSize={10} textAnchor="end" style={{ fill: 'var(--g)' }}>race band</text>
            <line x1={28} x2={W} y1={Y(ramp.current_g_h)} y2={Y(ramp.current_g_h)} strokeDasharray="4 4" strokeWidth={1.5} style={{ stroke: 'var(--tx)' }} />
            <text x={W - 4} y={Y(ramp.current_g_h) - 4} fontSize={10} textAnchor="end" style={{ fill: 'var(--tx)' }}>your gut {ramp.current_g_h}</text>
            {hist.map((x, i) => {
              const bw = Math.min(40, (W - 28) / hist.length - 10), cx = 28 + (i + 0.5) * ((W - 28) / hist.length);
              return <g key={x.activity_id}><text x={cx} y={Y(x.g_h ?? 0) - 4} fontSize={11} fontWeight={700} textAnchor="middle" style={{ fill: 'var(--tx)' }}>{x.g_h}</text><rect x={cx - bw / 2} y={Y(x.g_h ?? 0)} width={bw} height={H - Y(x.g_h ?? 0)} rx={4} style={{ fill: x.counted ? 'var(--g)' : 'var(--o)' }} opacity={x.counted ? 1 : 0.6}><title>{`${x.title ?? ''} · ${x.date} · ${x.minutes} min · ${x.g_h} g/h${x.counted ? ' · counts' : ''}`}</title></rect>
                <text x={cx} y={H + 14} fontSize={10} textAnchor="middle" style={{ fill: 'var(--tx3)' }}>{dshort(x.date)}</text></g>;
            })}
          </svg>
          <figcaption style={{ fontSize: 12, color: 'var(--tx3)' }}>g/h taken on every logged ride or run of {ramp.min_minutes} min or more (you) · dashed: your gut, {ramp.current_g_h} · shaded: the race band, {ramp.race_band[0]}–{ramp.race_band[1]} · green counts toward the next step</figcaption>
        </figure>
      ) : <span style={{ fontSize: 13, color: 'var(--tx2)' }}>No logged session of {ramp.min_minutes} min or more yet. Log your next long ride and it starts the ramp.</span>}
    </section>
  );
}
