/**
 * Fuel (docs/DESIGN.md (fuelling and score) §6; boards Fuel-Plan, Fuel-Log, Fuel-States — handoff of 2026-11-07).
 *
 * The plan card says what to pack, when to take it, and why; the log takes what was taken in a tap or
 * two. Every gram, g/h, per-hour figure, cue and "why not more" comes from the view (scripts/fuel.py):
 * the page multiplies, adds and rounds nothing. What was taken is the athlete's own report, labelled
 * "you" — Garmin records none of it. Saving goes through the server's fuel action (no model).
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Defs } from '../lib/api';
import { useStore } from '../lib/api';
import { day, tip } from '../lib/fmt';
import { IC, Icon } from './ui';

export const FUEL_ICON = 'M9 2h6v3l2 3v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8l2-3zM7 12h10';
const SH = { bottle: 'M8 1h8v3.5l3.5 4V28a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V8.5L8 4.5z', gel: 'M3 2h15l3 3v16l-5 7H8l-5-7z' } as const;
const INFO = 'M12 11v6M12 7.5v.01', LIM = 'M5 12h14', OUT = 'M6 6l12 12M18 6 6 18', WARN = IC.warn;

export interface Display { slot: string; mono: string; shape: 'bottle' | 'gel' }
export interface FuelPlanItem { kind: 'product' | 'recipe'; id: string; label: string; short?: string; n: number; g_each: number; g: number; display?: Display }
export interface FuelSlot { at: number; until?: number; kind: 'product' | 'recipe'; id: string }
export interface FuelCue { at: number; until?: number | null; kind: string; id: string; label: string; how: string; display: Display }
export interface FuelPlanT {
  minutes: number; intent: string; sport: string; band: [number, number]; cap_g_h: number; slack_g_h?: number; target_g_h: number; total_g: number;
  gut_g_h: number | null; rehearsal: boolean; items: FuelPlanItem[]; timeline: FuelSlot[]; planned_g: number; planned_g_h: number;
  setup_needed: boolean; needed: boolean; notes?: string[]; cues?: FuelCue[]; per_hour_grams?: { from: number; to: number; g: number }[];
  alternatives?: { grams: number; g_h: number; over_cap_by: number; rejected: string | null }[]; over_cap_g_h?: number;
}
export interface FuelTakenT {
  activity_id: number; date: string; items: FuelPlanItem[]; as_planned: boolean; note: string | null; source: 'you' | 'garmin';
  logged_at: string; g: number; minutes: number | null; g_h: number | null;
}
export interface PantryItem { kind: 'product' | 'recipe'; id: string; label: string; short?: string; unit: string; how?: string; g_each: number; display?: Display }
export interface WorkoutFuelT {
  taken: FuelTakenT | null; plan: FuelPlanT | null; planned_title: string | null; pantry: PantryItem[]; others?: PantryItem[];
  setup_open: string[]; due: boolean; minutes: number; loggable: boolean;
}

/** 95 → "1:35". */
export const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
const nameOf = (x: { short?: string; label: string }) => x.short ?? x.label;
const SRC_YOU = 'Logged by you in the app. Garmin does not record what you eat or drink.';

/** A product's mark: its shape in its slot's colour, the monogram on it. */
export function Mark({ d, w = 26, h = 34, mono = true }: { d?: Display; w?: number; h?: number; mono?: boolean }) {
  const dd = d ?? { slot: 'gel', mono: '?', shape: 'gel' as const };
  return (
    <span className="pm" style={{ '--pc': `var(--f-${dd.slot})`, width: w, height: h } as CSSProperties}>
      <svg viewBox="0 0 24 30" aria-hidden="true"><path d={SH[dd.shape] ?? SH.gel} fill="currentColor" /></svg>
      {mono && w >= 22 && <b>{dd.mono}</b>}
    </span>
  );
}
const tint = (d?: Display) => `var(--f-${d?.slot ?? 'gel'}t)`;
const col = (d?: Display) => `var(--f-${d?.slot ?? 'gel'})`;

/** One line for a narrow day cell: the fuel mark and the rate. The rest is in the tip and the label. */
export function FuelLine({ plan, title, defs, compact, style }: { plan: FuelPlanT; title?: string; defs?: Defs; compact?: boolean; style?: CSSProperties }) {
  const full = !plan.needed ? `No fuel needed — ${hm(plan.minutes)} ${plan.intent}`
    : plan.setup_needed || !plan.items.length ? `Fuel · ${plan.target_g_h} g/h · ${plan.total_g} g — add your products to see what to take`
      : `Fuel · ${plan.planned_g_h} g/h · ${plan.planned_g} g · ${plan.items.map((i) => `${i.n} × ${nameOf(i)}`).join(', ')}`;
  const body = !compact ? full : !plan.needed ? 'No fuel needed' : `${plan.items.length ? plan.planned_g_h : plan.target_g_h} g/h`;
  return (
    <span data-tip={`${full}\n${tip(defs, 'fuel_band') ?? ''}`.trim()} tabIndex={0} aria-label={`${title ? `${title}: ` : ''}${full}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: compact ? 11 : 14, color: plan.needed ? 'var(--tx)' : 'var(--tx2)', minWidth: 0, ...style }}>
      <Icon d={FUEL_ICON} size={compact ? 11 : 14} sw={2.2} style={{ flex: 'none', color: plan.needed ? 'var(--o)' : 'var(--tx3)' }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: compact ? 'nowrap' : 'normal' }}>{body}</span>
    </span>
  );
}

const Note = ({ i, c, bg, h, children, t }: { i: string; c: string; bg: string; h: ReactNode; children?: ReactNode; t?: string }) => (
  <li data-tip={t} tabIndex={t ? 0 : undefined} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.45, color: 'var(--tx2)' }}>
    <span aria-hidden="true" style={{ flex: 'none', marginTop: 2, width: 16, height: 16, borderRadius: 5, display: 'grid', placeItems: 'center', background: bg, color: c }}><Icon d={i} size={10} sw={3} /></span>
    <span><b style={{ color: 'var(--tx)' }}>{h}</b> {children}</span>
  </li>
);

/**
 * The fuel plan card (board Fuel-Plan): the rate and the grams, Pack (counts by product, each with its
 * mark), When (a strip with the cues on top, a bottle lane and gel pins, grams per hour underneath),
 * the limits and the left-out, and Why one tap away. `compact` is the version under Today's call.
 * States: a plan · grams only (no setup) · no fuel needed · no plan (no intent).
 */
export function FuelPlanCard({ plan, ctx, size = 'full', defs, cueHref, noIntent, style }: {
  plan: FuelPlanT | null; ctx?: string; size?: 'full' | 'compact'; defs?: Defs; cueHref?: string; noIntent?: boolean; style?: CSSProperties;
}) {
  const { askAbout } = useStore();
  const [why, setWhy] = useState(false);
  const full = size === 'full';
  const head = (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px' }}>
      <h2 className="l" style={{ margin: 0, color: 'var(--tx)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon d={FUEL_ICON} size={13} sw={2.4} />Fuel</h2>
      {ctx && <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{ctx}</span>}
      {plan?.needed && plan.items.length > 0 && (cueHref || full) && (
        <span className="no-print" style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          {cueHref && <Link to={cueHref} className="btn2 hv" style={{ minHeight: 34, padding: '0 10px', fontSize: 12 }}><Icon d="M7 3h10v18H7zM10 18h4" size={13} sw={2.4} />Cue sheet</Link>}
          {full && <button type="button" className="btn2 hv" aria-expanded={why} onClick={() => setWhy(!why)} style={{ minHeight: 34, padding: '0 10px', fontSize: 12 }}><Icon d={INFO} size={13} sw={2.4} />{why ? 'Hide why' : 'Why this plan'}</button>}
        </span>
      )}
    </div>
  );
  const shell = (body: ReactNode) => (
    <section aria-label={`Fuel${ctx ? ` · ${ctx}` : ''}`} style={{ boxSizing: 'border-box', width: '100%', borderRadius: full ? 20 : 16, border: '1px solid var(--ln)', background: 'var(--s1)',
      padding: full ? '20px 22px' : '14px 16px', display: 'flex', flexDirection: 'column', gap: full ? 16 : 12, ...style }}>{head}{body}</section>
  );
  if (!plan) {
    return noIntent ? shell(
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '12px 14px', borderRadius: 12, border: '1px dashed var(--ln2)' }}>
        <span style={{ flex: '1 1 260px', fontSize: 14, lineHeight: 1.45 }}><b>No fuel plan yet.</b> <span style={{ color: 'var(--tx2)' }}>Fuel follows what the session is for, and the coach hasn’t said what this one is for.</span></span>
        <button type="button" className="btn2 hv" onClick={() => askAbout(`${ctx ?? 'This session'}: what is it for? Give it its intent so it gets a fuel plan.`)}>Ask the coach</button>
      </div>,
    ) : null;
  }
  if (!plan.needed) {
    return shell(<p data-tip={tip(defs, 'fuel_band')} tabIndex={0} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--tx2)' }}>
      <Icon d={LIM} size={14} sw={2.4} style={{ color: 'var(--tx3)' }} />No fuel needed — {hm(plan.minutes)}. Water is enough.</p>);
  }
  const rate = plan.items.length ? plan.planned_g_h : plan.target_g_h;
  const total = plan.items.length ? plan.planned_g : plan.total_g;
  const over = (plan.over_cap_g_h ?? 0) > 0;
  const headline = (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px 22px' }}>
      <div data-tip={`Planned rate: the grams below over ${hm(plan.minutes)}.\nSource: Computed by OpenSportCoach.`} tabIndex={0} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className="n" style={{ fontSize: full ? 56 : 40, lineHeight: 0.9, fontWeight: 700 }}>{rate}</span><span className="n" style={{ fontSize: 18, color: 'var(--tx2)' }}>g/h</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 2 }}>
        <span className="n" style={{ fontSize: 22, lineHeight: 1, fontWeight: 700 }}>{total} g <span style={{ fontSize: 15, color: 'var(--tx2)', fontWeight: 600 }}>over {hm(plan.minutes)}</span></span>
        <span style={{ fontSize: 12, color: 'var(--tx3)' }}>rule {plan.band[0]}–{plan.band[1]} g/h · your gut {plan.cap_g_h} g/h</span>
      </div>
      {plan.items.length > 0 ? (
        <span className="chip" data-tip={`${tip(defs, 'fuel_gut') ?? ''}`} tabIndex={0} style={{ background: over ? 'var(--yt)' : 'var(--gt)', color: over ? 'var(--y)' : 'var(--g)', marginBottom: 4 }}>
          <Icon d={over ? WARN : IC.check} size={11} sw={3} />{over ? `${plan.over_cap_g_h} over your gut · allowed` : 'Within your gut'}</span>
      ) : <span className="chip" style={{ background: 'var(--s2)', color: 'var(--tx2)', marginBottom: 4 }}><Icon d={LIM} size={11} sw={3} />Grams only</span>}
    </div>
  );
  if (!plan.items.length) {
    const hrs = plan.per_hour_grams ?? [];
    return shell(<>
      {headline}
      {hrs.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: `repeat(${hrs.length}, minmax(0, 1fr))`, gap: 4 }}>
        {hrs.map((h) => <div key={h.from} className="hatch" style={{ padding: 10, borderRadius: 10, border: '1px dashed var(--ln2)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="m" style={{ color: 'var(--tx3)' }}>{hm(h.from)}–{hm(h.to)}</span><span className="n" style={{ fontSize: 20, fontWeight: 700 }}>{plan.target_g_h} g/h</span></div>)}
      </div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '12px 14px', borderRadius: 12, background: 'var(--s2)' }}>
        <span style={{ fontSize: 14, flex: '1 1 260px', lineHeight: 1.45 }}>{plan.setup_needed
          ? <>Without your products, the plan can only say how many grams. <b>Finish your setup</b> and it turns into bottles and gels you can pack.</>
          : <>None of your products fits this session, so it’s grams only.</>}</span>
        {plan.setup_needed && <Link to="/fuel/setup" className="btn">Finish setup</Link>}
      </div>
    </>);
  }
  const M = Math.max(plan.minutes, 1);
  const X = (m: number) => `${((m / M) * 100).toFixed(2)}%`;
  const step = M <= 120 ? 30 : 60;
  const ticks = Array.from({ length: Math.floor(M / step) + 1 }, (_, i) => i * step);
  const cues = plan.cues ?? [];
  const byKey = Object.fromEntries(plan.items.map((i) => [`${i.kind}:${i.id}`, i]));
  const bottles = cues.filter((c) => c.kind === 'recipe');
  const gels = cues.filter((c) => c.kind !== 'recipe');
  const geo = full ? { h: 116, laneB: 36, laneH: 40, laneG: 76, mw: 16, mh: 20, pin: 8 } : { h: 70, laneB: 22, laneH: 24, laneG: 46, mw: 12, mh: 15, pin: 3 };
  const alt = (plan.alternatives ?? []).find((a) => a.rejected);
  return shell(<>
    {headline}
    {full ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="l" style={{ fontSize: 10 }}>Pack</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {plan.items.map((x) => (
            <div key={`${x.kind}:${x.id}`} data-tip={`${x.label} × ${x.n} = ${x.g} g.\nSource: Computed by OpenSportCoach from the product's label${x.kind === 'recipe' ? ' and your recipe' : ''}.`} tabIndex={0}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, background: tint(x.display), border: '1px solid var(--ln)' }}>
              <Mark d={x.display} w={32} h={40} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}><span className="n" style={{ fontSize: 28, lineHeight: 1, fontWeight: 700 }}>×{x.n}</span><span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>{nameOf(x)}</span></span>
                <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{x.kind === 'recipe' ? 'bottle' : 'gel'} · {x.g_each} g each</span>
                <span className="n" style={{ fontSize: 14, color: 'var(--tx3)' }}>{x.g} g</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    ) : (
      <div role="list" aria-label="Pack" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {plan.items.map((x) => (
          <span key={`${x.kind}:${x.id}`} role="listitem" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px 5px 7px', borderRadius: 10, background: tint(x.display), border: '1px solid var(--ln)' }}>
            <Mark d={x.display} w={20} h={25} mono={false} />
            <span className="n" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>×{x.n}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{nameOf(x)}</span>
          </span>
        ))}
      </div>
    )}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {full && <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}><span className="l" style={{ fontSize: 10 }}>When</span><span style={{ fontSize: 12, color: 'var(--tx3)' }}>time on the {plan.sport === 'run' ? 'run' : 'bike'} · grams per hour underneath</span></div>}
      <div role="img" aria-label={`Fuel timeline: ${cues.map((c) => `${hm(c.at)} ${c.label}`).join(', ')}`} style={{ position: 'relative', height: geo.h, margin: '0 4px' }}>
        {ticks.map((m) => <span key={m} aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: X(m), borderLeft: '1px dashed var(--ln2)' }} />)}
        {cues.map((q) => (
          <span key={`c${q.at}${q.id}`} aria-hidden="true" style={{ position: 'absolute', top: 0, left: X(q.at), transform: `translateX(${q.at === 0 ? '0' : q.at >= M - 8 ? '-100%' : '-50%'})`, display: 'flex', flexDirection: 'column', alignItems: q.at === 0 ? 'flex-start' : 'center', gap: 1 }}>
            <span className="n" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1 }}>{hm(q.at)}</span>
            {full && <span style={{ fontSize: 11, color: 'var(--tx2)', whiteSpace: 'nowrap' }}>{q.label}</span>}
          </span>
        ))}
        {bottles.map((b) => {
          const it = byKey[`${b.kind}:${b.id}`];
          const until = b.until ?? Math.min(M, b.at + 60);
          return (
            <span key={`b${b.at}`} style={{ position: 'absolute', top: geo.laneB, height: geo.laneH, left: `calc(${X(b.at)} + 2px)`, width: `calc(${X(until - b.at)} - 4px)`, boxSizing: 'border-box', borderRadius: 10,
              background: tint(b.display), border: `1.5px solid ${col(b.display)}`, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', overflow: 'hidden' }}>
              <Mark d={b.display} w={geo.mw} h={geo.mh} mono={false} />
              {full && <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it ? nameOf(it) : b.label}</span>
                <span style={{ fontSize: 11, color: 'var(--tx2)', whiteSpace: 'nowrap' }}>{hm(b.at)}–{hm(until)} · sip through it</span></span>}
            </span>
          );
        })}
        {gels.map((g) => (
          <span key={`g${g.at}`} style={{ position: 'absolute', top: geo.laneG, left: X(g.at), transform: 'translateX(-11px)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span aria-hidden="true" style={{ marginLeft: 10, width: 2, height: geo.pin, background: col(g.display) }} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: full ? '3px 10px 3px 6px' : '2px 5px', borderRadius: 999, background: tint(g.display), border: `1.5px solid ${col(g.display)}` }}>
              <Mark d={g.display} w={geo.mw} h={geo.mh} mono={false} />
              {full && <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{byKey[`${g.kind}:${g.id}`] ? nameOf(byKey[`${g.kind}:${g.id}`]) : g.label} · {hm(g.at)}</span>}
            </span>
          </span>
        ))}
      </div>
      {full && (plan.per_hour_grams ?? []).length > 0 && (
        <div data-tip={'Grams planned in each hour, from the timeline.\nSource: Computed by OpenSportCoach.'} tabIndex={0} style={{ position: 'relative', height: 18, margin: '0 4px' }}>
          {(plan.per_hour_grams ?? []).map((h) => <span key={h.from} className="m" style={{ position: 'absolute', left: X(h.from), width: X(h.to - h.from), textAlign: 'center', color: 'var(--tx3)', fontSize: 11 }}>{h.g} g</span>)}
        </div>
      )}
    </div>
    {full && ((plan.notes ?? []).length > 0 || alt || over) && (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {over && <Note i={WARN} c="var(--y)" bg="var(--yt)" h={`${plan.over_cap_g_h} g/h over your gut — allowed.`}>A whole gel or bottle can take a plan up to {plan.slack_g_h} g/h past your gut, never more.</Note>}
        {(plan.notes ?? []).map((n) => {
          const out = /not on a|not planned|left out|fits/.test(n);
          const [h, ...rest] = n.split(': ');
          return <Note key={n} i={out ? OUT : LIM} c={out ? 'var(--tx)' : 'var(--tx2)'} bg="var(--s3)" h={rest.length ? `${h}:` : n}>{rest.join(': ')}</Note>;
        })}
        {alt && <Note i={INFO} c="var(--tx2)" bg="var(--s3)" h={`Why ${plan.planned_g_h}, not ${plan.target_g_h}.`} t="Source: Computed by OpenSportCoach from the rule, your gut and your products.">
          One more gel or bottle is {alt.grams} g, {alt.g_h} g/h — {alt.over_cap_by} over your gut, past the +{plan.slack_g_h} allowed. So the plan rounds down.</Note>}
      </ul>
    )}
    {why && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 10, paddingTop: 14, borderTop: '1px solid var(--ln)' }}>
        {[['The rule', `${plan.band[0]}–${plan.band[1]} g/h`, tip(defs, 'fuel_band') ?? 'The carbohydrate rule for a session this long and this hard.', 'coach'],
          ['Your gut', `${plan.cap_g_h} g/h`, tip(defs, 'fuel_gut') ?? 'What your gut is trained to.', 'you'],
          ['The plan', `${plan.planned_g_h} g/h`, tip(defs, 'fuel_target') ?? '', 'computed']].map(([h, v, t, src]) => (
          <div key={h} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 14px', borderRadius: 12, background: 'var(--s2)' }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><span className="l" style={{ fontSize: 10, color: 'var(--tx)' }}>{h}</span><span className="m" style={{ color: 'var(--tx3)' }}>{src}</span></span>
            <span className="n" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.05 }}>{v}</span>
            <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--tx2)', whiteSpace: 'pre-line' }}>{t}</span>
          </div>
        ))}
      </div>
    )}
  </>);
}

/** Kept for callers of the earlier name. */
export const FuelPlanBlock = ({ plan, defs }: { plan: FuelPlanT; defs?: Defs; heading?: string }) => <FuelPlanCard plan={plan} defs={defs} />;

/** What was taken (board Fuel-Log, saved): the word, the grams and g/h against the plan, the items, the note. */
export function FuelTaken({ taken, plan, onChange }: { taken: FuelTakenT; plan: FuelPlanT | null; onChange?: () => void }) {
  const vs = plan?.needed && plan.items.length ? plan : null;
  const short = !!vs && taken.items.length > 0 && !taken.as_planned && taken.g < vs.planned_g;
  const word = !taken.items.length ? 'Nothing taken' : taken.as_planned ? 'As planned' : short ? 'Short of the plan' : 'Logged';
  const c = !taken.items.length ? 'var(--tx2)' : taken.as_planned ? 'var(--g)' : short ? 'var(--y)' : 'var(--tx)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="l" style={{ fontSize: 10, color: c }}>{word}</span>
        <span className="chip" data-tip={SRC_YOU} tabIndex={0} style={{ fontSize: 10, padding: '1px 6px', background: 'var(--s2)', color: 'var(--tx2)' }}>you</span>
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="n" style={{ fontSize: 40, lineHeight: 0.9, fontWeight: 700 }}>{taken.g} g</span>
        {taken.g_h != null && <span className="n" style={{ fontSize: 20, color: 'var(--tx2)' }}>· {taken.g_h} g/h</span>}
        {vs && <span style={{ fontSize: 13, color: 'var(--tx3)' }}>planned {vs.planned_g} g · {vs.planned_g_h} g/h</span>}
      </div>
      {taken.items.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {taken.items.map((x) => (
            <span key={`${x.kind}:${x.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px 5px 7px', borderRadius: 10, background: tint(x.display), border: '1px solid var(--ln)' }}>
              <Mark d={x.display} w={18} h={23} mono={false} />
              <span className="n" style={{ fontSize: 18, fontWeight: 700 }}>×{x.n}</span><span style={{ fontSize: 13, fontWeight: 600 }}>{nameOf(x)}</span>
              <span className="n" style={{ fontSize: 13, color: 'var(--tx3)' }}>{x.g} g</span>
            </span>
          ))}
        </div>
      )}
      {taken.note && <span style={{ fontSize: 13, color: 'var(--tx2)' }}>“{taken.note}”</span>}
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--tx3)' }}>
        logged by you · {day(taken.logged_at.slice(0, 10))} {taken.logged_at.slice(11, 16)}
        {onChange && <button type="button" className="link" onClick={onChange} style={{ border: 0, background: 'none', padding: 0, fontSize: 13 }}>Change</button>}
      </span>
    </div>
  );
}

/**
 * Log what you took (board Fuel-Log): the plan it is logged against, As planned and Took nothing in one
 * tap each, or tap the products you took (− takes one away), a note, Save. A failed save keeps every
 * choice and offers Try again. Grams and g/h come back from OpenSportCoach once it's saved.
 */
export function FuelLog({ activityId, pantry, others = [], plan, taken, onDone }: {
  activityId: number; pantry: PantryItem[]; others?: PantryItem[]; plan: FuelPlanT | null; taken?: FuelTakenT | null; onDone?: (summary: string) => void;
}) {
  const { fuel } = useStore();
  const planned = plan?.needed ? plan.items : [];
  const tiles = [...pantry, ...others];
  const start = () => Object.fromEntries(tiles.map((p) => [`${p.kind}:${p.id}`,
    (taken?.items ?? []).find((i) => i.kind === p.kind && i.id === p.id)?.n ?? 0]));
  const startCustom = () => (taken?.items ?? []).filter((i) => i.kind === ('custom' as string)).map((i) => ({ label: i.short ?? i.label, g_each: i.g_each, n: i.n }));
  const [n, setN] = useState<Record<string, number>>(start);
  const [custom, setCustom] = useState<{ label: string; g_each: number; n: number }[]>(startCustom);
  const [showOthers, setShowOthers] = useState(() => others.some((o) => (taken?.items ?? []).some((i) => i.kind === o.kind && i.id === o.id)));
  const [draft, setDraft] = useState({ label: '', g: '', n: 1 });
  const [note, setNote] = useState(taken?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; retry: () => void } | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => { setN(start()); setCustom(startCustom()); setNote(taken?.note ?? ''); }, [activityId]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = [
    ...tiles.map((p) => ({ kind: p.kind, id: p.id, n: n[`${p.kind}:${p.id}`] ?? 0 })).filter((i) => i.n > 0),
    ...custom.map((c) => ({ kind: 'custom' as const, label: c.label, g_each: c.g_each, n: c.n })),
  ];
  const send = (body: Parameters<typeof fuel>[1]) => {
    const go = () => {
      setBusy(true);
      setErr(null);
      fuel('log', body).then((s) => { setOk(s ?? 'Saved.'); onDone?.(s ?? 'Saved.'); })
        .catch((e) => setErr({ text: String(e.message ?? e), retry: go })).finally(() => setBusy(false));
    };
    go();
  };
  const withNote = () => (note.trim() ? { note: note.trim() } : {});
  const draftG = Number(draft.g);
  const draftOk = draft.label.trim().length > 0 && draft.label.length <= 60 && !/[|\n]/.test(draft.label) && draftG > 0 && draftG <= 150;
  const big: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '12px 14px', borderRadius: 14, border: '1px solid var(--ln2)', background: 'var(--bg)', color: 'var(--tx)', textAlign: 'left', flex: '1 1 200px' };
  const field: CSSProperties = { minHeight: 38, padding: '0 10px', borderRadius: 10, border: '1px solid var(--ln2)', background: 'var(--bg)', color: 'var(--tx)', fontSize: 14 };
  const tile = (p: PantryItem) => {
    const k = `${p.kind}:${p.id}`;
    const v = n[k] ?? 0;
    return (
      <div key={k} role="group" aria-label={p.label} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14,
        border: `1.5px solid ${v ? col(p.display) : 'var(--ln2)'}`, background: v ? tint(p.display) : 'transparent' }}>
        <button type="button" aria-label={`One more ${p.label}`} disabled={busy || v >= 30} onClick={() => setN({ ...n, [k]: v + 1 })}
          style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, border: 0, background: 'none', padding: 0, color: 'var(--tx)', textAlign: 'left', minWidth: 0 }}>
          <Mark d={p.display} w={22} h={28} />
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{nameOf(p)}</span>
            <span style={{ fontSize: 11, color: 'var(--tx3)' }}>{p.unit === 'bottle' ? 'bottle' : p.unit} · {p.g_each} g</span>
          </span>
          <span className="n" aria-live="polite" style={{ marginLeft: 'auto', fontSize: 24, fontWeight: 700, color: v ? 'var(--tx)' : 'var(--tx3)' }}>{v}</span>
        </button>
        <button type="button" aria-label={`One fewer ${p.label}`} disabled={busy || v === 0} onClick={() => setN({ ...n, [k]: Math.max(0, v - 1) })}
          style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--ln2)', background: 'transparent', color: 'var(--tx)', fontSize: 16, fontWeight: 700 }}>−</button>
      </div>
    );
  };
  return (
    <form aria-label="Log what you took" onSubmit={(e) => { e.preventDefault(); if (items.length) send({ activity_id: activityId, items, ...withNote() }); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {planned.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: 'var(--tx2)' }}>
          <span className="l" style={{ fontSize: 10 }}>Plan was</span>
          {planned.map((x) => <span key={`${x.kind}:${x.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mark d={x.display} w={12} h={15} mono={false} />×{x.n} {nameOf(x)}</span>)}
          <span className="n">· {plan!.planned_g} g · {plan!.planned_g_h} g/h</span>
        </div>
      )}
      {err && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--r)', background: 'var(--rt)', fontSize: 13 }}>
          <Icon d={WARN} size={14} sw={2.4} style={{ color: 'var(--r)' }} /><span style={{ flex: 1 }}><b>Not saved.</b> {err.text} Your choices and note are kept below.</span>
          <button type="button" className="btn2 hv" onClick={err.retry} disabled={busy}>Try again</button>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {planned.length > 0 && (
          <button type="button" className="hv" disabled={busy} style={{ ...big, borderColor: 'var(--g)' }}
            onClick={() => send({ activity_id: activityId, items: planned.map((i) => ({ kind: i.kind, id: i.id, n: i.n })), as_planned: true, ...withNote() })}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 700 }}><Icon d={IC.check} size={14} sw={3} style={{ color: 'var(--g)' }} />As planned</span>
            <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{planned.map((x) => `${x.n} ${nameOf(x)}`).join(' + ')}</span>
          </button>
        )}
        <button type="button" className="hv" disabled={busy} style={big} onClick={() => send({ activity_id: activityId, items: [], nothing: true, ...withNote() })}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>I took nothing</span><span style={{ fontSize: 12, color: 'var(--tx2)' }}>water only, or forgot</span>
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--tx3)' }}>Or tap what you took — − takes one away</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {pantry.map(tile)}
          {showOthers && others.map(tile)}
          {custom.map((c, i) => (
            <div key={`custom${i}`} role="group" aria-label={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, border: '1.5px solid var(--f-4)', background: 'var(--f-4t)' }}>
              <Mark d={{ slot: '4', mono: c.label.slice(0, 2).toUpperCase(), shape: 'gel' }} w={22} h={28} />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                <span style={{ fontSize: 11, color: 'var(--tx3)' }}>{c.g_each} g each · from its label</span>
              </span>
              <span className="n" style={{ fontSize: 24, fontWeight: 700 }}>{c.n}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button type="button" aria-label={`One more ${c.label}`} disabled={busy || c.n >= 30} onClick={() => setCustom(custom.map((x, j) => (j === i ? { ...x, n: x.n + 1 } : x)))}
                  style={{ width: 26, height: 22, borderRadius: 6, border: '1px solid var(--ln2)', background: 'transparent', color: 'var(--tx)', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>+</button>
                <button type="button" aria-label={`One fewer ${c.label}`} disabled={busy} onClick={() => setCustom(c.n > 1 ? custom.map((x, j) => (j === i ? { ...x, n: x.n - 1 } : x)) : custom.filter((_, j) => j !== i))}
                  style={{ width: 26, height: 22, borderRadius: 6, border: '1px solid var(--ln2)', background: 'transparent', color: 'var(--tx)', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>−</button>
              </span>
            </div>
          ))}
        </div>
        {others.length > 0 && !showOthers && (
          <button type="button" className="link" onClick={() => setShowOthers(true)} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, fontSize: 13 }}>More from the catalog · {others.length}</button>
        )}
        <fieldset style={{ border: '1px dashed var(--ln2)', borderRadius: 14, padding: '10px 12px', margin: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 }}>
          <legend style={{ fontSize: 12, color: 'var(--tx2)', padding: '0 4px' }}>Something else — a bar, a banana, a coke</legend>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--tx3)', flex: '2 1 160px' }}>Name
            <input type="text" value={draft.label} maxLength={60} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Clif Bar" style={field} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--tx3)', flex: '1 1 110px' }}>Carbs in one (g)
            <input type="number" inputMode="decimal" min={1} max={150} value={draft.g} onChange={(e) => setDraft({ ...draft, g: e.target.value })} placeholder="from its label" style={field} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--tx3)', flex: '0 1 70px' }}>How many
            <input type="number" min={1} max={30} value={draft.n} onChange={(e) => setDraft({ ...draft, n: Math.max(1, Math.min(30, Math.round(Number(e.target.value) || 1))) })} style={field} /></label>
          <button type="button" className="btn2 hv" disabled={busy || !draftOk} onClick={() => { setCustom([...custom, { label: draft.label.trim(), g_each: draftG, n: draft.n }]); setDraft({ label: '', g: '', n: 1 }); }}>Add</button>
          <span style={{ flexBasis: '100%', fontSize: 11, color: 'var(--tx3)' }}>Logged as yours, with the carbs you read off its label. Ask the coach to add it to the catalog if you’ll use it again.</span>
        </fieldset>
      </div>
      <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note · optional — the stomach, the heat, a stop" aria-label="Note"
        style={{ minHeight: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--ln2)', background: 'var(--bg)', color: 'var(--tx)', fontSize: 14 }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <button type="submit" className="btn" disabled={busy || !items.length}>{busy ? 'Saving…' : 'Save'}</button>
        <span role={ok ? 'status' : undefined} style={{ fontSize: 12, color: ok ? 'var(--g)' : 'var(--tx3)' }}>{ok ?? 'Grams and g/h appear once it’s saved.'}</span>
      </div>
    </form>
  );
}

/** The session page's Fuel section: the plan card beside what was taken, or the log when nothing is. */
export function FuelCard({ w }: { w: { id: number; group: string; fuel?: WorkoutFuelT; defs?: Defs } }) {
  const f = w.fuel;
  const [edit, setEdit] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => setEdit(false), [w.id, f?.taken?.logged_at]);
  useEffect(() => setSaved(null), [w.id]);
  if (!f?.loggable) return null;
  return (
    <section id="fuel" aria-labelledby="fuel-h" className="card" style={{ gap: 16, scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Icon d={FUEL_ICON} size={16} sw={2.2} style={{ color: 'var(--o)' }} />
        <h2 id="fuel-h" className="l" style={{ color: 'var(--tx)' }} data-tip={tip(w.defs, 'fuel_band')} tabIndex={0}>Fuel</h2>
        {f.due && !f.taken && <span className="chip" style={{ background: 'var(--bt)', color: 'var(--b)', fontSize: 11 }}>to log</span>}
        <Link to="/fuel/setup" className="link" style={{ marginLeft: 'auto', fontSize: 13 }}>Your fuel setup</Link>
      </div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        {f.plan ? <FuelPlanCard plan={f.plan} ctx={f.planned_title ?? undefined} size="compact" defs={w.defs} style={{ border: 0, padding: 0, background: 'transparent' }} />
          : <span style={{ fontSize: 14, color: 'var(--tx2)' }}>No fuel was planned for this session{f.planned_title ? '' : ' — nothing on the plan that day said what it was for'}.</span>}
        <div>
          {!f.pantry.length && (
            <span style={{ display: 'block', fontSize: 13, color: 'var(--tx2)', marginBottom: 10 }}>
              Your products aren’t set up, so log by name below — or <Link to="/fuel/setup" className="link">set up your fuel</Link> for one-tap logging.</span>
          )}
          {f.taken && !edit ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <FuelTaken taken={f.taken} plan={f.plan} onChange={() => { setSaved(null); setEdit(true); }} />
              {saved && <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--g)' }}><Icon d={IC.check} size={13} sw={3} />{saved}</span>}
            </div>
          ) : (
            <FuelLog activityId={w.id} pantry={f.pantry} others={f.others ?? []} plan={f.plan} taken={f.taken} onDone={(s) => { setSaved(s); setEdit(false); }} />
          )}
        </div>
      </div>
    </section>
  );
}

/** A header chip: what was taken per hour, or that it isn't logged yet — a link to the card. */
export function FuelChip({ f }: { f?: WorkoutFuelT }) {
  if (!f?.loggable) return null;
  if (f.taken) return <a href="#fuel" className="chip" style={{ background: 'var(--ot)', color: 'var(--o)' }}><Icon d={FUEL_ICON} size={12} sw={2.4} />Fuel · {f.taken.g_h != null ? `${f.taken.g_h} g/h` : `${f.taken.g} g`}</a>;
  if (f.due) return <a href="#fuel" className="chip" style={{ background: 'var(--yt)', color: 'var(--y)' }}><Icon d={FUEL_ICON} size={12} sw={2.4} />Fuel not logged</a>;
  return null;
}

/** For lists: a link to a session's fuel card. */
export const fuelHref = (id: number | string) => `/workouts/${id}#fuel`;
/** The cue sheet for a planned session. */
export const cueHref = (p: { date: string; title: string }) => `/fuel/cue?date=${encodeURIComponent(p.date)}&title=${encodeURIComponent(p.title)}`;
