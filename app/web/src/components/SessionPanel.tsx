/** The session detail panel (board Plan, 2026-10-17): opens under the week when a session is picked, its
 * notch on the session's day. Header (what, when, status and its provenance, prev/next, close, actions) ·
 * the numbers that describe it · the coach's context and the same-day session · the body: a planned gym
 * day in order with its watch steps beside it, a done gym day planned vs done per set, a done ride or run
 * planned → done with time in zone and its heart rate. Every number comes from a view; cardio load and
 * strength kilos and sets are never summed (CLAUDE.md, Data rules). */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useStore, useView, type AppRequest, type Defs } from '../lib/api';
import { day, dow, dshort, isoDate, kg, mmss, nf, pl, tip, todayIso } from '../lib/fmt';
import { IC, Icon, Markdown } from './ui';
import { SportTag } from './SportIcon';
import { WatchSendButton } from './WatchSend';
import { ZWIFT_RULE_FROM, ZwiftWorkoutCard, ZwiftWorkoutMissing } from './ZwiftWorkout';
import { FUEL_ICON, FuelPlanCard, cueHref, fuelHref } from './Fuel';
import { badgeTip, bandOf } from './Score';
import type { Entry } from '../lib/calendar';

export interface Look { col: string; bg: string; icon: string; word: string; dashed?: boolean }
export interface Picked { entry: Entry; date: string }
interface Nav { title: string; go: () => void }

const ICS = {
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  move: 'M8 7h12M16 3l4 4-4 4M16 17H4M8 13l-4 4 4 4',
  rep: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  work: 'M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12',
  rest: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  lap: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
};
const TONE: Record<string, [string, string, string]> = {
  good: ['var(--gt)', 'var(--g)', IC.check], warn: ['var(--yt)', 'var(--y)', IC.warn], bad: ['var(--rt)', 'var(--r)', IC.x], neutral: ['var(--s3)', 'var(--tx2)', IC.minus],
};
const ZONE_COL = ['var(--tx3)', 'var(--b)', 'var(--g)', 'var(--o)', 'var(--r)'];
const SYNC: Record<string, [string, string, string]> = {
  in_sync: ['Matches the plan', 'var(--g)', IC.check], changed: ['Old version on the watch', 'var(--y)', IC.warn],
  not_pushed: ['Not on the watch yet', 'var(--y)', IC.warn], unknown: ['Not verified yet', 'var(--tx2)', IC.minus],
};

interface Kpi { l: string; v: string; u?: string; sub?: string; col?: string; tip?: string }
interface Cell { v: ReactNode; sub?: string; col?: string; tip?: string }
interface Row {
  code: string; name: string; note?: string; exid?: string; pips: { bg: string; bc: string }[]; pipsLabel: string;
  a: Cell; b: Cell; c: Cell & { bg: string; icon: string };
}
interface Block { code: string; title: string; sub: string; col: string; rows: Row[] }
interface Why { label: string; stamp?: string; tip?: string; text: string; link?: [string, string]; signals?: any[] }

/** The panel. `index` is the session's weekday (0 = Monday) — where the notch points. */
export function SessionPanel({ picked, look, index, prev, next, close, prog, cal, same }: {
  picked: Picked; look: Look; index: number; prev: Nav | null; next: Nav | null; close: () => void;
  prog: any; cal: any; same: { label: string; entry: Entry; look: Look; go: () => void } | null;
}) {
  const { entry, date } = picked;
  const done = entry.kind === 'done' && entry.id;
  const key = entry.key ?? entry.title;
  const dayView = prog.days.find((d: any) => d.key === key || d.name === entry.title);
  const other = !dayView ? prog.other_workouts.find((o: any) => o.key === key || o.name === entry.title) : null;
  const plan = !dayView && !other ? (cal.planned ?? []).find((x: any) => x.date === date && x.title === entry.title) : null;
  const head = { look, date, entry, index, prev, next, close };
  return (
    <section id="detail" aria-labelledby="sp-t" className="sp" style={{ position: 'relative', marginTop: 6, borderRadius: 20, border: '1px solid var(--ln2)', background: 'var(--s1)', boxShadow: 'var(--sh)' }}>
      <span aria-hidden="true" className="sp-notch" style={{ left: `calc(${(((index + 0.5) / 7) * 100).toFixed(2)}% - 8px)` }} />
      {done ? <DonePanel id={String(entry.id)} head={head} same={same} />
        : dayView ? <PlannedGym d={dayView} head={head} same={same} prog={prog} />
          : other ? <PlannedWatch w={other} head={head} same={same} prog={prog} />
            : <PlannedOff plan={plan} head={head} same={same} />}
    </section>
  );
}

type Head = { look: Look; date: string; entry: Entry; index: number; prev: Nav | null; next: Nav | null; close: () => void };

function Header({ h, title, stamp, stampTip, actions }: { h: Head; title: string; stamp?: string; stampTip?: string; actions: ReactNode }) {
  const today = h.date === todayIso();
  return (
    <header style={{ padding: '20px 24px 18px', display: 'flex', flexWrap: 'wrap', gap: '16px 24px', alignItems: 'flex-start', borderBottom: '1px solid var(--ln)' }}>
      <div style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
          <SportTag b={h.entry.badge} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 7, background: 'var(--s2)' }} />
          {h.date && <span style={{ fontSize: 14, color: 'var(--tx2)' }}>{day(h.date)}{today ? ' · today' : ''}</span>}
        </div>
        <h2 id="sp-t" className="n" style={{ fontSize: 40, lineHeight: 1, fontWeight: 700, overflowWrap: 'anywhere' }}>{title}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
          <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: h.look.bg, color: h.look.col, fontSize: 13, fontWeight: 700 }}>
            <Icon d={h.look.icon} size={13} sw={2.6} />{h.look.word}
          </span>
          {stamp && <span className="m" data-tip={stampTip} tabIndex={stampTip ? 0 : undefined} style={{ color: 'var(--tx3)' }}>{stamp}</span>}
        </div>
      </div>
      <div className="sp-hdr-r" style={{ flex: '0 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12, marginLeft: 'auto' }}>
        <div className="sp-pg" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" className="hv sp-nav" disabled={!h.prev} onClick={h.prev?.go} aria-label={h.prev ? `Previous session: ${h.prev.title}` : 'No earlier session this week'}>
            <Icon d="M15 6l-6 6 6 6" size={13} sw={2.6} style={{ flex: 'none' }} /><span>{h.prev?.title ?? 'Previous'}</span>
          </button>
          <button type="button" className="hv sp-nav" disabled={!h.next} onClick={h.next?.go} aria-label={h.next ? `Next session: ${h.next.title}` : 'No later session this week'}>
            <span>{h.next?.title ?? 'Next'}</span><Icon d="M9 6l6 6-6 6" size={13} sw={2.6} style={{ flex: 'none' }} />
          </button>
          <button type="button" className="hv" onClick={h.close} aria-label="Close session detail"
            style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--ln)', background: 'transparent', color: 'var(--tx2)', display: 'grid', placeItems: 'center' }}>
            <Icon d={IC.x} size={14} sw={2.6} />
          </button>
        </div>
        <div className="sp-acts" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>{actions}</div>
      </div>
    </header>
  );
}

/** The compact score (docs/DESIGN.md (fuelling and score) §6.4): the engine's number and band, as one KPI. Nothing when the
 * session isn't scored — the full page says why. */
function scoreKpi(w: any, defs: Defs): Kpi[] {
  const sc = w.score;
  if (!sc || sc.excluded) return [];
  const b = bandOf(sc);
  return [{ l: 'Score', v: sc.total != null ? String(sc.total) : '—', sub: `${b.word}${sc.headline ? ` · ${sc.headline}` : ''}`, col: b.c, tip: badgeTip(sc, defs) }];
}

function Kpis({ items }: { items: Kpi[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', borderBottom: '1px solid var(--ln)' }}>
      {items.map((k) => (
        <div key={k.l} data-tip={k.tip} tabIndex={k.tip ? 0 : undefined} style={{ padding: '14px 24px', display: 'flex', flexDirection: 'column', gap: 4, boxShadow: '-1px 0 0 var(--ln)' }}>
          <span className="l" style={{ fontSize: 10 }}>{k.l}</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span className="n" style={{ fontSize: 32, lineHeight: 1, fontWeight: 700, color: k.col ?? 'var(--tx)' }}>{k.v}</span>
            {k.u && <span className="n" style={{ fontSize: 15, color: 'var(--tx2)' }}>{k.u}</span>}
          </span>
          {k.sub && <span style={{ fontSize: 12, color: 'var(--tx3)', lineHeight: 1.3 }}>{k.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** The coach's word on the session, and the other session that day. */
function Context({ why, same }: { why: Why | null; same: { label: string; entry: Entry; look: Look; go: () => void } | null }) {
  if (!why && !same) return null;
  return (
    <div style={{ padding: '16px 24px', display: 'flex', flexWrap: 'wrap', gap: '14px 32px', borderBottom: '1px solid var(--ln)', background: 'var(--s2)' }}>
      {why && (
        <div style={{ flex: '2 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="l" style={{ color: 'var(--tx)' }}>{why.label}</span>
            {why.stamp && <span className="m" data-tip={why.tip} tabIndex={why.tip ? 0 : undefined} style={{ color: 'var(--tx3)' }}>{why.stamp}</span>}
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.5, maxWidth: '72ch' }}>
            <Markdown text={why.text} />
            {why.link && <Link to={why.link[0]} className="link" style={{ whiteSpace: 'nowrap' }}>{why.link[1]}</Link>}
          </div>
        </div>
      )}
      <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {why?.signals?.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {why.signals.map((g: any, i: number) => {
              const [tint, c, icon] = TONE[g.tone] ?? TONE.neutral;
              return (
                <span key={i} data-tip={`${g.label}: ${g.value}\nSource: Coach.`} tabIndex={0} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: 8, background: tint, fontSize: 12, color: 'var(--tx2)' }}>
                  <Icon d={icon} size={11} sw={3} style={{ color: c }} /><b className="n" style={{ fontSize: 15, color: 'var(--tx)' }}>{g.value}</b>{g.label}
                </span>
              );
            })}
          </div>
        ) : null}
        {same && (
          <button type="button" onClick={same.go} className="hv" data-tip={`Open ${same.entry.title}. Cardio load and strength sets are shown separately and never added together.`}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--ln)', background: 'transparent', color: 'var(--tx)', textAlign: 'left' }}>
            <span className="l" style={{ fontSize: 9, whiteSpace: 'nowrap' }}>{same.label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{same.entry.title}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: same.look.col }}><Icon d={same.look.icon} size={11} sw={2.8} />{same.look.word}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** The session's rows, grouped by block. Selectable rows tie to the watch rail. */
function Table({ title, hint, cols, blocks, sel, pick, foot }: {
  title: string; hint: string; cols: string[]; blocks: Block[]; sel?: string | null; pick?: (exid: string) => void; foot?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px' }}>
        <h3 className="l" style={{ color: 'var(--tx)' }}>{title}</h3>
        <span style={{ fontSize: 12, color: 'var(--tx3)' }}>{hint}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div role="table" aria-label={`${title} — exercises`} className="sp-tbl" style={{ minWidth: 660, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div role="row" className="sp-rx sp-rxh" style={{ padding: '0 12px 6px' }}>
            {cols.map((h, i) => <span key={i} role="columnheader" className="l" style={{ fontSize: 9 }}>{h}</span>)}
          </div>
          {blocks.map((b) => (
            <div key={b.code} role="rowgroup" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 12px', padding: '10px 12px 4px' }}>
                <span className="n" style={{ fontSize: 15, fontWeight: 700, color: b.col }}>{b.code}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{b.title}</span>
                <span style={{ fontSize: 12, color: 'var(--tx3)' }}>{b.sub}</span>
              </div>
              {b.rows.map((r) => {
                const on = !!r.exid && r.exid === sel;
                const can = !!(pick && r.exid);
                return (
                  <div key={r.code} role="row" tabIndex={can ? 0 : undefined} aria-selected={can ? on : undefined} className="sp-rx sp-row"
                    onClick={can ? () => pick!(r.exid!) : undefined} onKeyDown={can ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick!(r.exid!); } } : undefined}
                    style={{ padding: '10px 12px', borderRadius: 12, background: on ? 'var(--s2)' : 'transparent', border: `1px solid ${on ? 'var(--ln2)' : 'transparent'}`, cursor: can ? 'pointer' : 'default' }}>
                    <span role="cell" className="n" style={{ fontSize: 15, fontWeight: 700, color: b.col }}>{r.code}</span>
                    <span role="cell" style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>{r.name}</span>
                      {r.note && <span style={{ fontSize: 12, color: 'var(--tx3)', lineHeight: 1.3 }}>{r.note}</span>}
                    </span>
                    <span role="cell" aria-label={r.pipsLabel} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                      {r.pips.map((p, i) => <span key={i} style={{ width: 10, height: 10, borderRadius: 3, background: p.bg, border: `1.5px solid ${p.bc}`, boxSizing: 'border-box' }} />)}
                    </span>
                    <CellView c={r.a} big />
                    <CellView c={r.b} big />
                    <span role="cell" data-tip={r.c.tip} style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start', minWidth: 0 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 7, background: r.c.bg, color: r.c.col, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <Icon d={r.c.icon} size={11} sw={2.8} style={{ flex: 'none' }} />{r.c.v}
                      </span>
                      {r.c.sub && <span style={{ fontSize: 11, color: 'var(--tx3)', lineHeight: 1.3 }}>{r.c.sub}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {foot}
    </div>
  );
}

function CellView({ c, big }: { c: Cell; big?: boolean }) {
  return (
    <span role="cell" data-tip={c.tip} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      {/* Long values (four sets of double-digit reps) step down and may wrap rather than run into the next column. */}
      <span className="n" style={{ fontSize: big && String(c.v).length <= 10 ? 20 : 16, lineHeight: 1.05, fontWeight: 700, whiteSpace: String(c.v).length > 12 ? 'normal' : 'nowrap', color: c.col ?? 'var(--tx)' }}>{c.v}</span>
      {c.sub && <span style={{ fontSize: 11, color: 'var(--tx3)', lineHeight: 1.3 }}>{c.sub}</span>}
    </span>
  );
}

function Body({ main, rail, railLabel }: { main: ReactNode; rail?: ReactNode; railLabel?: string }) {
  return (
    <div className="sp-body">
      <div className="sp-main">{main}</div>
      {rail && <aside aria-label={railLabel} className="sp-rt">{rail}</aside>}
    </div>
  );
}

// --- what a prescription reads as -------------------------------------------------------------

const loadCell = (e: any, w = e.weight): Cell => {
  if (w == null) return { v: 'BW', sub: 'body weight', tip: 'Body weight — no load.' };
  if (e.load === 'plates' || e.machine) return { v: `+${kg(w)} kg`, sub: 'plates · no e1RM', tip: 'Plates added on a machine. No e1RM — disc load only.' };
  if (e.load === 'added' || String(e.name ?? '').startsWith('WEIGHTED_')) return { v: `+${kg(w)} kg`, sub: 'added to body weight', tip: `Body weight plus ${kg(w)} kg added.` };
  if (e.per_hand) return { v: `${kg(w)} kg`, sub: `per hand · ${kg(w * 2)} kg logged`, tip: `Per hand. Logged in Garmin as ${kg(w * 2)} kg — both dumbbells.` };
  return { v: `${kg(w)} kg`, sub: e.load === 'cable' ? 'cable' : e.load === 'machine' ? 'stack' : e.load === 'barbell' ? 'barbell' : undefined, tip: 'Prescribed load. Source: program.' };
};
const isTime = (e: any) => (e.base ?? e.kind?.replace(/_per_side$/, '')) === 'time';
/** Reps × external kg, as Garmin logs it: both dumbbells, both sides; timed and body-weight work excluded. */
const plannedKg = (e: any, w = e.weight) => (w == null || isTime(e) ? 0 : e.sets * e.value * w * (e.per_hand ? 2 : 1) * (String(e.kind).endsWith('_per_side') ? 2 : 1));
const loadTxt = (e: any, w: number) => (e.load === 'plates' ? `+${kg(w)} kg` : e.load === 'added' ? `BW +${kg(w)}` : `${kg(w)} kg${e.per_hand ? ' / hand' : ''}`);

/** Last → to beat: the number the next session has to beat (the same rule as Program's anatomy). */
function beat(e: any, core: boolean, defs: Defs): Row['c'] {
  const a = e.audit;
  const last = a?.last && a.last > '1971' ? `last ${dshort(a.last)}` : undefined;
  if (core) return { v: 'Quality first', sub: 'core · no load race', col: 'var(--tx2)', bg: 'var(--s2)', icon: IC.minus, tip: 'Core block: anti-movement only — quality, not load. Not counted in working sets or kilos.' };
  if (a?.impossible) return { v: 'Re-prescribe', sub: `implies e1RM ${kg(a.implied_e1rm)} vs best ${kg(a.best_e1rm)}`, col: 'var(--r)', bg: 'var(--rt)', icon: IC.x, tip: `${a.verdict ?? ''}\nSource: Computed by OpenSportCoach.` };
  if (a?.status === 'stale') return { v: `All ${e.sets} at ${e.value}`, sub: `${pl(a.sessions, 'try', 'tries')}, none met`, col: 'var(--y)', bg: 'var(--yt)', icon: IC.warn, tip: tip(defs, 'audit') };
  if (e.base === 'power') return { v: 'Speed', sub: 'every rep crisp — never by load', col: 'var(--tx2)', bg: 'var(--s2)', icon: IC.minus, tip: 'Power work progresses by quality and speed only.' };
  if (e.per_side) return { v: 'Time first', sub: `${e.value} s / side, then load`, col: 'var(--tx2)', bg: 'var(--s2)', icon: IC.minus, tip: 'Time per side: time first, then load.' };
  if (isTime(e)) return { v: 'Hold', sub: last ?? 'the week’s intensity', col: 'var(--tx2)', bg: 'var(--s2)', icon: IC.minus, tip: 'Timed work progresses with the week’s intensity.' };
  if (e.next_weight != null && e.weight != null) return { v: `+${kg(e.next_weight - e.weight)} kg${e.per_hand ? ' / hand' : ''}`, sub: `all ${e.sets} at ${e.range?.[1] ?? e.value} → ${loadTxt(e, e.next_weight)}${last ? ` · ${last}` : ''}`, col: 'var(--g)', bg: 'var(--gt)', icon: IC.up, tip: tip(defs, 'next_target') };
  return { v: 'Add reps', sub: last ?? 'then load', col: 'var(--g)', bg: 'var(--gt)', icon: IC.up, tip: tip(defs, 'next_target') };
}

function plannedRow(e: any, code: string, core: boolean, defs: Defs): Row {
  const time = isTime(e);
  const notes = [e.routine && e.label && e.routine !== e.label ? e.label : null, e.why ?? e.note, e.warmup?.length ? `+ ${pl(e.warmup.length, 'warm-up set')} first` : null].filter(Boolean);
  return {
    code, exid: e.exid, name: e.routine ?? e.label, note: notes.join(' · ') || undefined,
    pips: Array.from({ length: e.sets }, () => ({ bg: 'transparent', bc: 'var(--tx3)' })), pipsLabel: `${e.sets} ${core ? 'rounds' : 'sets'}`,
    a: { v: `${e.sets} × ${e.value}${time ? ' s' : ''}`, sub: `${e.per_side ? 'per side · ' : ''}rest ${e.rest_s} s`, tip: `${e.range ? `Range ${e.range[0]}–${e.range[1]}. ` : ''}From the program.` },
    b: loadCell(e), c: beat(e, core, defs),
  };
}

// --- planned: a gym day ---------------------------------------------------------------------

function PlannedGym({ d, head, same, prog }: { d: any; head: Head; same: any; prog: any }) {
  const { state, askAbout } = useStore();
  const { data: t } = useView('today');
  const offline = state?.coach !== 'online';
  const defs: Defs = prog.defs ?? {};
  const sync = (prog.sync?.workouts ?? []).find((w: any) => w.key === d.key);
  const changed = head.entry.kind === 'changed' || sync?.state === 'changed' || sync?.state === 'not_pushed';
  const steps: any[] = d.watch ?? [];
  const lead: any[] = d.lead ?? [];
  const main: any[] = d.exercises ?? [];
  const sets = main.reduce((a, e) => a + e.sets, 0);
  const tonnage = main.reduce((a, e) => a + plannedKg(e), 0);
  const work = steps.filter((s) => s.kind !== 'repeat');
  const [step, setStep] = useState(0);
  const [move, setMove] = useState(false);
  useEffect(() => { setStep(0); setMove(false); }, [d.key, head.date]);
  const blocks: Block[] = [
    ...(lead.length ? [{ code: 'A', title: 'Core block', sub: `runs first on the watch · ≈ ${Math.round(lead.reduce((a, e) => a + e.est_s, 0) / 60)} min · not counted in sets or kg`, col: 'var(--v)',
      rows: lead.map((e, i) => plannedRow(e, `A${i + 1}`, true, defs)) }] : []),
    { code: 'B', title: `Main · ${pl(main.length, 'exercise')}`, sub: `${pl(sets, 'working set')}`, col: 'var(--o)', rows: main.map((e, i) => plannedRow(e, `B${i + 1}`, false, defs)) },
  ];
  const codeOf = Object.fromEntries(blocks.flatMap((b) => b.rows.map((r) => [r.exid, r.code])));
  const cur = work[Math.min(step, Math.max(0, work.length - 1))];
  const rec = t?.daily?.recommendation;
  const isCall = t?.daily?.date === head.date && rec?.workout_key === d.key;
  const why: Why | null = isCall
    ? { label: 'Why today', stamp: t.daily.generated_at ? `coach · ${t.daily.generated_at.slice(11, 16)}` : 'coach', tip: `Today’s call${t.daily.data_as_of ? `, on data pulled ${t.daily.data_as_of.slice(11, 16)}` : ''}. Source: Coach.`,
      text: `**${rec.verb}** · ${rec.reasoning ?? rec.why ?? ''}`, link: ['/', 'Read it all on Today'], signals: rec.signals }
    : d.why ? { label: 'What it’s for', stamp: 'program', tip: 'The day’s description in the program. Source: Coach.', text: d.why } : null;
  const sent = lastSent(state?.requests, d.name);
  const stamp = changed ? 'plan changed · the watch has the earlier version' : sent ? `sent ${sent} · verified` : sync?.id ? `on the watch · Garmin workout ${sync.id}` : undefined;
  return (
    <>
      <Header h={head} title={d.name} stamp={stamp} stampTip={tip(defs, 'watch_sync')} actions={<>
        {changed && <WatchSendButton style={{ minHeight: 40 }} />}
        {!changed && head.entry.kind !== 'missed' && <button type="button" className="btn2 hv" disabled={offline} onClick={() => setMove(true)}><Icon d={ICS.move} size={14} />Move this session</button>}
        <button type="button" className="btn2 hv" disabled={offline} onClick={() => askAbout(`${d.name}${head.date ? ` · ${day(head.date)}` : ''}`)}><Icon d={IC.chat} size={14} sw={2} />Ask about it</button>
      </>} />
      {changed && (
        <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '12px 24px', background: 'var(--yt)', borderBottom: '1px solid var(--ln)' }}>
          <Icon d={IC.warn} size={16} style={{ color: 'var(--y)' }} />
          <span style={{ fontSize: 14, flex: '1 1 300px' }}><b>The plan changed since it was sent; the watch still has the earlier version.</b> <span style={{ color: 'var(--tx2)' }}>Sending replaces the workout on the watch.</span></span>
        </div>
      )}
      {move && <MoveForm name={d.name} close={() => setMove(false)} />}
      <Kpis items={[
        { l: 'Estimated time', v: `≈ ${d.est_min}`, u: 'min', sub: lead.length ? `core block + ${pl(main.length, 'exercise')}` : pl(main.length, 'exercise'), tip: tip(defs, 'est_time') },
        { l: 'Working sets', v: String(sets), u: 'sets', sub: `${pl(main.length, 'exercise')}${lead.length ? ' · core not counted' : ''}`, tip: 'Sets of the main block, from the program. Source: Coach.' },
        { l: 'Planned strength load', v: nf(tonnage), u: 'kg', sub: 'reps × external kg · timed work excluded', tip: 'Sum of reps × external load, as Garmin logs it: both dumbbells, both sides; plates on a machine; timed and body-weight work left out. Strength only — never added to cardio load.\nSource: Computed by OpenSportCoach from the program.' },
        ...(work.length ? [{ l: 'On the watch', v: String(work.length), u: 'steps', sub: changed ? 'the new version' : SYNC[sync?.state ?? 'unknown']?.[0].toLowerCase(), col: changed ? 'var(--y)' : undefined, tip: 'Steps in the generated workout file, numbered as the watch numbers them (repeat headers are not steps).\nSource: the workout file.' }] : []),
      ]} />
      <Context why={why} same={same} />
      <Body railLabel="How the watch runs it" main={
        <Table title="The session in order" hint={work.length ? 'Click an exercise to see it on the watch' : 'No workout file yet — nothing to step through'}
          cols={['', 'Exercise', 'Sets', 'Reps / time', 'Load', 'Last → to beat']} blocks={blocks} sel={cur?.row} pick={work.some((s) => s.row) ? (exid) => setStep(Math.max(0, work.findIndex((s) => s.row === exid))) : undefined}
          foot={<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', alignItems: 'center', fontSize: 12, color: 'var(--tx3)' }}>
            <span>{lead.length ? 'Every block the watch runs is listed here, the core block first.' : 'Every block the watch runs is listed here.'}</span>
            <Link to={`/program?day=${encodeURIComponent(d.key)}#anatomy`} className="link" style={{ marginLeft: 'auto', fontSize: 12 }}>History and numbers to beat — on Program</Link>
          </div>} />
      } rail={<WatchRail steps={steps} step={step} setStep={setStep} codeOf={codeOf} changed={changed} sync={sync} defs={defs} name={d.name} />} />
    </>
  );
}

/** When this workout was last sent and verified: the newest push result naming it. */
function lastSent(requests: AppRequest[] | undefined, name: string): string | null {
  const r = [...(requests ?? [])].reverse().find((q) => q.state === 'DONE' && q.result?.kind === 'push_result'
    && (q.result.payload as any).actions?.some((a: any) => a.workout === name && a.status === 'verified'));
  if (!r?.finishedAt) return null;
  const at = new Date(r.finishedAt);
  return `${dow(isoDate(at))} ${at.toTimeString().slice(0, 5)}`;
}

function MoveForm({ name, close }: { name: string; close: () => void }) {
  const { ask } = useStore();
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const today = todayIso();
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', padding: '12px 24px', background: 'var(--s2)', borderBottom: '1px solid var(--ln)' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="l" style={{ fontSize: 10 }}>Move to</span>
        <input type="date" value={to} min={today} onChange={(e) => setTo(e.target.value)} style={{ minHeight: 38, padding: '0 10px', borderRadius: 10, border: '1px solid var(--ln2)', background: 'var(--bg)', color: 'var(--tx)' }} /></label>
      <button type="button" className="btn" disabled={!to} onClick={() => ask('plan', `Move ${name} to ${day(to)} — prepare the calendar move`, { move: name, to })
        .then(() => setMsg('Sent — the coach’s proposal appears here on Plan, and on Today, when it’s ready.')).catch((e) => setMsg(String(e.message ?? e)))}>Ask the coach to move it</button>
      <button type="button" className="btn2 hv" onClick={close}>Cancel</button>
      <span role={msg ? 'status' : undefined} style={{ fontSize: 12, color: 'var(--tx3)', flex: '1 1 220px' }}>{msg ?? 'The coach prepares the move; you confirm it on the Send-to-watch card.'}</span>
    </div>
  );
}

/** The watch, step by step, tied to the selected row: the face, the counter, and how the row runs. */
function WatchRail({ steps, step, setStep, codeOf, changed, sync, defs, name }: {
  steps: any[]; step: number; setStep: (n: number) => void; codeOf: Record<string, string>; changed: boolean; sync: any; defs: Defs; name: string;
}) {
  const work = steps.filter((s) => s.kind !== 'repeat');
  const sy = changed ? SYNC.changed : SYNC[sync?.state ?? 'unknown'] ?? SYNC.unknown;
  if (!work.length) return (
    <>
      <h3 className="l" style={{ color: 'var(--tx)' }}>On the watch</h3>
      <span style={{ fontSize: 13, color: 'var(--tx2)' }}>No generated workout for {name} yet.</span>
    </>
  );
  const i = Math.min(step, work.length - 1);
  const cur = work[i];
  const nx = work[i + 1];
  // The rounds of the repeat a step sits in: the nearest repeat header above it, one level up.
  const rounds = (s: any) => {
    const at = steps.indexOf(s);
    for (let j = at - 1; j >= 0; j--) if (steps[j].kind === 'repeat' && steps[j].depth < s.depth) return steps[j].times;
    return 1;
  };
  const rest = (s: any) => s.kind === 'rest';
  const row = cur.row;
  const mine = row ? steps.filter((s) => s.row === row) : steps;
  const nums = mine.filter((s) => s.kind !== 'repeat').map((s) => work.indexOf(s) + 1);
  const meta = [cur.weight ? `${kg(cur.weight)} kg` : null, rounds(cur) > 1 ? `× ${rounds(cur)}` : 'once'].filter(Boolean).join(' · ');
  return (
    <div className="sp-watch">
      <div className="sp-watch-g">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 className="l" style={{ color: 'var(--tx)' }}>On the watch</h3>
        <span data-tip={tip(defs, 'watch_sync')} tabIndex={0} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: sy[1] }}><Icon d={sy[2]} size={12} sw={2.8} />{sy[0]}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div aria-label="Watch face" role="img" style={{ flex: 'none', width: 176, height: 176, borderRadius: '50%', background: '#000', border: '8px solid #23272B', boxShadow: '0 0 0 2px #3A3F44, var(--sh)', display: 'grid', placeItems: 'center', textAlign: 'center', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, maxWidth: 128 }}>
            <span style={{ font: '600 10px/1 Barlow, sans-serif', letterSpacing: '.12em', color: '#8F98A0' }}>{changed ? 'ON THE WATCH NOW' : `STEP ${i + 1}/${work.length}`}</span>
            <span className="n" style={{ fontSize: changed || cur.headline.length <= 9 ? 34 : 20, lineHeight: 1.02, fontWeight: 700, color: changed ? '#F2C14E' : rest(cur) ? '#7FBFFF' : '#FFFFFF', overflowWrap: 'anywhere' }}>{changed ? 'OLD' : cur.headline.toUpperCase()}</span>
            <span style={{ font: '600 12px/1.15 Barlow, sans-serif', color: '#FFFFFF' }}>{changed ? 'the earlier version' : rest(cur) ? 'Rest' : (cur.sub ?? '').split(' · ')[0].slice(0, 40)}</span>
            <span style={{ font: '500 11px/1.2 Barlow, sans-serif', color: '#B9C0C6' }}>{changed ? 'Send to watch to replace' : meta}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: '1 1 120px' }}>
          <span className="l" style={{ fontSize: 9 }}>Step</span>
          <span className="n" style={{ fontSize: 28, lineHeight: 1, fontWeight: 700 }}>{i + 1} <span style={{ fontSize: 16, color: 'var(--tx3)' }}>/ {work.length}</span></span>
          <span style={{ fontSize: 12, color: 'var(--tx2)', lineHeight: 1.35 }}>{nx ? `Next · ${nx.headline}${rest(nx) ? ' rest' : ''}` : 'Last step · the workout ends'}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="hv" aria-label="Previous watch step" disabled={i === 0} onClick={() => setStep(i - 1)} style={stepBtn}><Icon d="M15 6l-6 6 6 6" size={14} sw={2.6} /></button>
            <button type="button" className="hv" aria-label="Next watch step" disabled={i >= work.length - 1} onClick={() => setStep(i + 1)} style={stepBtn}><Icon d="M9 6l6 6-6 6" size={14} sw={2.6} /></button>
          </div>
        </div>
      </div>
      {changed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: 12, border: '1px dashed var(--y)' }}>
          <span style={{ fontSize: 13, lineHeight: 1.45 }}>The steps below are the <b>new version</b> — what the watch runs once you send. Until then it runs the earlier one.</span>
          <WatchSendButton style={{ alignSelf: 'flex-start' }} />
        </div>
      )}
      </div>
      <div className="sp-watch-g">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="l" style={{ fontSize: 10 }}>{row ? <>How <span style={{ color: 'var(--tx)' }}>{codeOf[row] ?? row}</span> runs · steps {nums[0]}–{nums[nums.length - 1]}</> : `Every step · ${work.length}`}</span>
        <ol aria-label="Watch steps" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', borderRadius: 12, border: '1px solid var(--ln)', overflow: 'hidden', maxHeight: row ? undefined : 360, overflowY: row ? undefined : 'auto' }}>
          {mine.map((s, k) => {
            const rep = s.kind === 'repeat';
            const n = rep ? '' : work.indexOf(s) + 1;
            const now = s === cur;
            const lap = s.end === 'lap' && rest(s);
            const ic = rep ? ICS.rep : lap ? ICS.lap : rest(s) ? ICS.rest : ICS.work;
            return (
              <li key={k} onClick={rep ? undefined : () => setStep(work.indexOf(s))} style={{ display: 'grid', gridTemplateColumns: '26px 18px 1fr auto', gap: 8, alignItems: 'center', padding: `8px 10px 8px ${rep || s.depth === 0 ? 10 : 26}px`, background: now ? 'var(--s2)' : 'transparent', boxShadow: `inset 3px 0 0 ${now ? 'var(--b)' : 'transparent'}`, borderBottom: '1px solid var(--ln)', cursor: rep ? 'default' : 'pointer' }}>
                <span className="m" style={{ color: 'var(--tx3)' }}>{n}</span>
                <Icon d={ic} size={14} style={{ color: rest(s) ? 'var(--b)' : rep ? 'var(--tx3)' : 'var(--tx)' }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span className="n" style={{ fontSize: 17, lineHeight: 1.05, fontWeight: 700 }}>{rep ? `Repeat × ${s.times}` : s.headline}</span>
                  <span style={{ fontSize: 12, color: 'var(--tx3)', lineHeight: 1.25 }}>{rep ? `the steps below, ${s.times} times` : [rest(s) ? (lap ? 'Rest — ends when you press Lap' : 'Rest') : s.sub, s.weight ? `${kg(s.weight)} kg` : null].filter(Boolean).join(' · ')}</span>
                </span>
                {!rep && s.end && <span style={{ padding: '2px 6px', borderRadius: 6, border: '1px solid var(--ln)', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: 'var(--tx2)', whiteSpace: 'nowrap' }}>{s.end === 'timer' ? 'TIMER' : s.end === 'lap' ? 'LAP' : s.end.toUpperCase()}</span>}
              </li>
            );
          })}
        </ol>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px', alignItems: 'center', fontSize: 12, color: 'var(--tx2)' }}>
        <span style={endTag}>TIMER</span><span>The step ends on its own when the time runs out.</span>
        <span style={endTag}>LAP</span><span>The step waits until you press Lap — after your reps, or when you’re ready.</span>
      </div>
      </div>
    </div>
  );
}

const stepBtn = { width: 40, height: 36, borderRadius: 10, border: '1px solid var(--ln2)', background: 'transparent', color: 'var(--tx)', display: 'grid', placeItems: 'center' } as const;
const endTag = { padding: '1px 6px', borderRadius: 5, border: '1px solid var(--ln)', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', justifySelf: 'start' } as const;

// --- planned: a watch workout that isn't a gym day (a pool swim) ---------------------------------

function PlannedWatch({ w, head, same, prog }: { w: any; head: Head; same: any; prog: any }) {
  const { state, askAbout } = useStore();
  const offline = state?.coach !== 'online';
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [w.key, head.date]);
  const sync = (prog.sync?.workouts ?? []).find((x: any) => x.key === w.key);
  const changed = head.entry.kind === 'changed' || sync?.state === 'changed' || sync?.state === 'not_pushed';
  const steps: any[] = w.watch ?? [];
  const work = steps.filter((s) => s.kind !== 'repeat');
  const sent = lastSent(state?.requests, w.name);
  return (
    <>
      <Header h={head} title={w.name} stamp={changed ? 'plan changed · the watch has the earlier version' : sent ? `sent ${sent} · verified` : sync?.id ? `on the watch · Garmin workout ${sync.id}` : undefined} stampTip={tip(prog.defs, 'watch_sync')} actions={<>
        {changed && <WatchSendButton style={{ minHeight: 40 }} />}
        <button type="button" className="btn2 hv" disabled={offline} onClick={() => askAbout(`${w.name}${head.date ? ` · ${day(head.date)}` : ''}`)}><Icon d={IC.chat} size={14} sw={2} />Ask about it</button>
      </>} />
      <Kpis items={work.length ? [{ l: 'On the watch', v: String(work.length), u: 'steps', sub: SYNC[sync?.state ?? 'unknown']?.[0].toLowerCase(), tip: 'Steps in the generated workout file. Source: the workout file.' }] : []} />
      <Context why={null} same={same} />
      <Body railLabel="How the watch runs it" main={
        <span style={{ fontSize: 14, color: 'var(--tx2)' }}>{w.badge?.sport ?? w.sport?.replace(/_/g, ' ')} workout — the watch runs it step by step; every step is on the right. Cardio load stays its own number, never added to strength sets or kilos.</span>
      } rail={<WatchRail steps={steps} step={step} setStep={setStep} codeOf={{}} changed={changed} sync={sync} defs={prog.defs ?? {}} name={w.name} />} />
    </>
  );
}

// --- planned off the watch (plan.json): Zwift, the long ride, tennis ------------------------------

function PlannedOff({ plan, head, same }: { plan: any; head: Head; same: any }) {
  const { state, askAbout } = useStore();
  const offline = state?.coach !== 'online';
  return (
    <>
      <Header h={head} title={head.entry.title} stamp={plan ? 'coach · planned off the watch' : undefined} actions={
        <button type="button" className="btn2 hv" disabled={offline} onClick={() => askAbout(`${head.entry.title}${head.date ? ` · ${day(head.date)}` : ''}`)}><Icon d={IC.chat} size={14} sw={2} />Ask about it</button>
      } />
      <Context why={plan?.why ? { label: 'Why it’s there', stamp: 'coach', text: plan.why } : null} same={same} />
      <Body main={<>
        {plan?.detail ? <span style={{ fontSize: 15 }}>{plan.detail}</span>
          : !plan && <span style={{ fontSize: 14, color: 'var(--tx2)' }}>On your Garmin calendar, but not one of the workouts OpenSportCoach builds — so there is no prescription or step list to show here.</span>}
        {/* A Zwift ride names the workout to open in Zwift's menu (his rule, 2026-11-05). */}
        {plan?.zwift_workout ? <ZwiftWorkoutCard w={plan.zwift_workout} />
          : plan?.platform === 'zwift' && plan.date >= ZWIFT_RULE_FROM && plan.date >= todayIso() && <ZwiftWorkoutMissing />}
        {/* Its fuel (docs/DESIGN.md (fuelling and score) §6.4): what to pack and when, from its intent — or why there is none. */}
        {/* Board Plan (sel="gravel"): the fuel plan card — what to pack, when, why — and the cue sheet. */}
        {plan?.fuel ? <FuelPlanCard plan={plan.fuel} ctx={`${plan.title} · ${plan.intent}`} cueHref={cueHref(plan)} />
          : plan && !plan.intent && (plan.duration_min ?? 0) >= 60 && <FuelPlanCard plan={null} noIntent ctx={plan.title} />}
        {plan && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tx3)' }}><Icon d={IC.clock} size={12} />Planned by the coach — not a watch workout, so nothing is sent to the watch for it.</span>}
      </>} />
    </>
  );
}

// --- done -----------------------------------------------------------------------------------

function DonePanel({ id, head, same }: { id: string; head: Head; same: any }) {
  const { data: w, error } = useView('workout', id);
  const { state, askAbout } = useStore();
  const offline = state?.coach !== 'online';
  const actions = <>
    <Link to={`/workouts/${id}`} className="btn" style={{ minHeight: 40 }}><Icon d={ICS.open} size={14} />Open the full session</Link>
    <button type="button" className="btn2 hv" disabled={offline} onClick={() => askAbout(`${head.entry.title}${head.date ? ` · ${day(head.date)}` : ''} (activity ${id})`)}><Icon d={IC.chat} size={14} sw={2} />Ask about it</button>
  </>;
  if (!w) return (
    <>
      <Header h={head} title={head.entry.title} actions={actions} />
      <div style={{ padding: '20px 24px', fontSize: 13, color: 'var(--tx2)' }}>{error ? `Couldn’t read this session here (${error}). The full session page has it.` : 'Reading the session…'}</div>
    </>
  );
  const stamp = `Garmin · ${w.start?.slice(11, 16) ?? ''}`.trim();
  return (
    <WithReview files={w.reviews}>{(review) => w.group === 'strength'
      ? <DoneGym w={w} head={head} same={same} actions={actions} stamp={stamp} why={review} />
      : <DoneCardio w={w} head={head} same={same} actions={actions} stamp={stamp} review={review} />}
    </WithReview>
  );
}

/** The first paragraph of the coach's review of this session, if one was written — read only when there is one. */
function WithReview({ files, children }: { files?: string[]; children: (why: Why | null) => ReactNode }) {
  return files?.length ? <ReviewOf file={files[0]}>{children}</ReviewOf> : <>{children(null)}</>;
}

function ReviewOf({ file, children }: { file: string; children: (why: Why | null) => ReactNode }) {
  const { data } = useView('journal-entry', file);
  const body = data?.markdown ? String(data.markdown).replace(/^# .*\n/, '').trim().split(/\n\s*\n/)[0] : '';
  return <>{children(body ? { label: 'Coach’s review', stamp: file, tip: 'The coach’s review of this session. Source: Coach.', text: body } : null)}</>;
}

function DoneGym({ w, head, same, actions, stamp, why }: { w: any; head: Head; same: any; actions: ReactNode; stamp: string; why: Why | null }) {
  const defs: Defs = w.defs ?? {};
  const planned: any[] = w.planned?.exercises ?? [];
  const blocksLogged: any[] = w.exercises ?? [];
  const working = (b: any) => (b?.sets ?? []).filter((x: any) => x.type === 'working');
  const byKey = new Map(blocksLogged.map((b) => [b.key.join('/'), b]));
  const used = new Set<string>();
  let pS = 0, dS = 0, pKg = 0;
  const rows: Row[] = planned.map((p, i) => {
    const k = `${p.category}/${p.name}`;
    const b = byKey.get(k);
    used.add(k);
    const ws = working(b);
    pS += p.sets; dS += Math.min(ws.length, p.sets); pKg += plannedKg(p, p.weight_then ?? p.weight);
    const target = p.value;
    const short = ws.reduce((a: number, x: any) => a + Math.max(0, target - x.reps), 0);
    const missing = Math.max(0, p.sets - ws.length);
    const pr = ws.some((x: any) => x.pr);
    const c: Row['c'] = !ws.length ? { v: 'Not logged', sub: `planned ${p.sets} × ${target}`, col: 'var(--tx3)', bg: 'var(--s2)', icon: IC.minus }
      : pr ? { v: 'Best', sub: 'a new e1RM best', col: 'var(--g)', bg: 'var(--gt)', icon: IC.up, tip: tip(defs, 'e1rm') }
        : missing ? { v: `−${pl(missing, 'set')}`, sub: `${ws.length} of ${p.sets} logged`, col: 'var(--y)', bg: 'var(--yt)', icon: IC.warn }
          : short ? { v: `−${pl(short, 'rep')}`, sub: 'short of the target', col: 'var(--y)', bg: 'var(--yt)', icon: IC.warn }
            : { v: 'As planned', sub: 'every set at target', col: 'var(--g)', bg: 'var(--gt)', icon: IC.check };
    const top = Math.max(0, ...ws.map((x: any) => x.weight ?? 0));
    return {
      code: `B${i + 1}`, name: p.routine ?? p.label, note: b?.muscle,
      pips: [...ws.map((x: any) => (x.reps >= target ? { bg: 'var(--g)', bc: 'var(--g)' } : { bg: 'var(--y)', bc: 'var(--y)' })),
        ...Array.from({ length: missing }, () => ({ bg: 'transparent', bc: 'var(--tx3)' }))],
      pipsLabel: `${ws.length} of ${p.sets} sets logged`,
      a: { v: ws.length ? ws.map((x: any) => x.reps).join(' · ') : '—', sub: `planned ${p.sets} × ${target}${isTime(p) ? ' s' : ''}`, tip: 'Reps per working set as logged on the watch. Source: Garmin.' },
      b: ws.length ? { ...loadCell({ ...p, machine: b.machine, per_hand: b.per_hand }, top || null), tip: `Top working set as logged. Source: Garmin.` } : loadCell(p, p.weight_then ?? p.weight),
      c,
    };
  });
  // Logged but not in the plan: shown, never hidden.
  blocksLogged.filter((b) => !used.has(b.key.join('/'))).forEach((b) => {
    const ws = working(b);
    rows.push({
      code: `+${rows.length + 1}`, name: b.label, note: b.muscle,
      pips: ws.map(() => ({ bg: 'var(--tx2)', bc: 'var(--tx2)' })), pipsLabel: `${ws.length} sets logged`,
      a: { v: ws.map((x: any) => x.reps).join(' · ') || '—', sub: 'logged' }, b: loadCell(b, Math.max(0, ...ws.map((x: any) => x.weight ?? 0)) || null),
      c: { v: w.planned ? 'Not in the plan' : '—', sub: w.planned ? 'logged on the day' : undefined, col: 'var(--tx2)', bg: 'var(--s2)', icon: IC.minus },
    });
  });
  const s = w.summary ?? {};
  const allWorking = blocksLogged.reduce((a, b) => a + working(b).length, 0);
  return (
    <>
      <Header h={head} title={w.title} stamp={stamp} stampTip="The activity as synced from the watch. Source: Garmin." actions={actions} />
      <Kpis items={[
        { l: 'Time', v: nf((s.duration ?? 0) / 60), u: 'min', sub: 'from the watch', tip: 'Activity duration. Source: Garmin.' },
        w.planned ? { l: 'Sets logged', v: `${dS}/${pS}`, u: 'sets', sub: 'against the plan', col: dS >= pS ? 'var(--g)' : 'var(--y)', tip: 'Working sets logged against the sets the program planned. Source: Garmin + program.' }
          : { l: 'Sets logged', v: String(allWorking), u: 'sets', sub: 'no program day matched', tip: 'Working sets logged. Source: Garmin.' },
        { l: 'Strength load', v: nf(w.tonnage), u: 'kg', sub: w.planned ? `of ${nf(pKg)} kg planned` : 'reps × kg', tip: `${tip(defs, 'tonnage') ?? ''}\nStrength only — never added to cardio load.` },
        { l: 'Avg heart rate', v: nf(s.averageHR), u: 'bpm', sub: s.maxHR ? `max ${nf(s.maxHR)}` : undefined, tip: 'Source: Garmin.' },
        ...scoreKpi(w, defs),
      ]} />
      <Context why={why} same={same} />
      <Body railLabel="What Garmin recorded" main={
        rows.length ? <Table title="Planned vs done" hint="One square per set · green on target, yellow short, hollow not logged"
          cols={['', 'Exercise', 'Sets', 'Reps done', 'Load', 'Against plan']} blocks={[{ code: 'B', title: `Main · ${pl(rows.length, 'exercise')}`, sub: `${dS || allWorking} of ${pS || allWorking} sets logged`, col: 'var(--o)', rows }]}
          foot={<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', alignItems: 'center', fontSize: 12, color: 'var(--tx3)' }}>
            <span>Set-by-set weights, rest and e1RM live on the full session page.</span>
            <Link to={`/workouts/${w.id}`} className="link" style={{ marginLeft: 'auto', fontSize: 12 }}>Open the full session</Link>
          </div>} />
          : <span style={{ fontSize: 14, color: 'var(--tx2)' }}>No sets were logged for this session.</span>
      } rail={<Recorded w={w} stamp={stamp} rows={[
        ...(s.calories ? [['Calories', `${nf(s.calories)} kcal`]] : []),
        ...(w.active_s + w.rest_s > 0 ? [['Active · rest', `${mmss(w.active_s)} · ${mmss(w.rest_s)}`]] : []),
        ...(w.planned ? [['Sets matched to the plan', `${dS} of ${pS}`]] : []),
      ] as [string, string][]} link="Every set, rest and e1RM — full session" />} />
    </>
  );
}

function DoneCardio({ w, head, same, actions, stamp, review }: { w: any; head: Head; same: any; actions: ReactNode; stamp: string; review: Why | null }) {
  const { state } = useStore();
  const defs: Defs = w.defs ?? {};
  const s = w.summary ?? {};
  const m = w.endurance?.metrics ?? {};
  const er = [...(state?.requests ?? [])].reverse().find((r) => r.state === 'DONE' && r.result?.kind === 'endurance_review' && String((r.result.payload as any).activity_id) === String(w.id));
  const p: any = er?.result?.payload;
  const swim = w.group === 'swim';
  const speed = !s.duration || !s.distance ? null
    : swim ? [mmss(s.duration / (s.distance / 100)), '/100 m', 'Pace'] : w.group === 'run' ? [mmss(s.duration / (s.distance / 1000)), '/km', 'Pace']
      : m.avg_power?.value ? [nf(m.avg_power.value), 'W', 'Avg power'] : [nf((s.distance / 1000) / (s.duration / 3600), 1), 'km/h', 'Speed'];
  const zs: number[] = w.endurance?.zones?.hr?.length ? w.endurance.zones.hr.map((z: any) => z.secs)
    : [1, 2, 3, 4, 5].map((z) => s[`hrTimeInZone_${z}`]).every((v) => v != null) ? [1, 2, 3, 4, 5].map((z) => s[`hrTimeInZone_${z}`]) : [];
  const total = zs.reduce((a, x) => a + x, 0) || 1;
  const RATE: Record<string, [string, string, string, string]> = {
    on_target: ['As planned', 'var(--g)', 'var(--gt)', IC.check], partly: ['Partly', 'var(--y)', 'var(--yt)', IC.warn], off_target: ['Off target', 'var(--r)', 'var(--rt)', IC.x],
  };
  let check = p ? { plan: `${p.intent?.value ? `${p.intent.value[0].toUpperCase()}${p.intent.value.slice(1)}` : 'The intent'} ${p.intent?.source === 'inferred' ? '(inferred)' : ''} →`, r: RATE[p.execution?.rating] ?? RATE.partly, sub: p.execution?.summary, tip: p.intent?.why }
    : { plan: 'Not reviewed against a plan yet →', r: ['Counted', 'var(--g)', 'var(--gt)', IC.check] as [string, string, string, string], sub: 'It counts toward the week’s cardio load. Ask for a review to check it against its intent.', tip: undefined };
  const sc = w.score && !w.score.excluded ? w.score : null;
  if (sc) {
    const b = bandOf(sc);
    const intent = sc.intent ? `${sc.intent[0].toUpperCase()}${sc.intent.slice(1)}` : 'The plan';
    check = { plan: `${intent} →`, r: [`${b.word}${sc.total != null ? ` · ${sc.total}` : ''}`, b.c, b.bg, sc.band === 'as_planned' ? IC.check : IC.warn],
      sub: p?.execution?.summary ?? sc.summary, tip: badgeTip(sc, defs) };
  }
  const why: Why | null = p ? { label: 'Coach’s read', stamp: er?.finishedAt ? `coach · ${new Date(er.finishedAt).toTimeString().slice(0, 5)}` : 'coach', tip: 'The coach’s analysis of this session. Source: Coach.', text: p.verdict } : review;
  return (
    <>
      <Header h={head} title={w.title} stamp={stamp} stampTip="The activity as synced from the watch. Source: Garmin." actions={actions} />
      <Kpis items={[
        { l: 'Time', v: nf((s.duration ?? 0) / 60), u: 'min', sub: 'from the watch', tip: 'Source: Garmin.' },
        ...(s.distance ? [{ l: 'Distance', v: swim ? nf(s.distance) : nf(s.distance / 1000, 1), u: swim ? 'm' : 'km', sub: 'from the watch', tip: 'Source: Garmin.' }] : []),
        ...(speed ? [{ l: speed[2], v: speed[0], u: speed[1], sub: 'from the watch', tip: 'Source: Garmin.' }] : []),
        ...(s.averageHR ? [{ l: 'Avg HR', v: nf(s.averageHR), u: 'bpm', sub: s.maxHR ? `max ${nf(s.maxHR)}` : undefined, tip: 'Source: Garmin.' }] : []),
        ...(s.activityTrainingLoad != null ? [{ l: 'Cardio load', v: nf(s.activityTrainingLoad), sub: 'cardio only · never added to strength', tip: `${tip(defs, 'load') ?? 'Garmin training load.'}\nKept apart from strength sets and kilos.` }] : []),
        // What was taken (docs/DESIGN.md (fuelling and score) §6.4): the athlete's own log, or that it's still to log.
        ...(w.fuel?.taken ? [{ l: 'Fuel', v: w.fuel.taken.g_h != null ? nf(w.fuel.taken.g_h) : nf(w.fuel.taken.g), u: w.fuel.taken.g_h != null ? 'g/h' : 'g',
          sub: w.fuel.plan?.needed && w.fuel.plan.items.length ? `${w.fuel.plan.planned_g_h} g/h planned` : `${w.fuel.taken.g} g taken`, tip: `${tip(defs, 'fuel_taken') ?? ''}\nSource: You.` }]
          : w.fuel?.due ? [{ l: 'Fuel', v: '—', sub: 'not logged yet', tip: 'Log what you took on the full session page.' }] : []),
        ...scoreKpi(w, defs),
      ]} />
      {w.fuel?.due && !w.fuel.taken && (
        <Link to={fuelHref(w.id)} className="link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '0 24px' }}><Icon d={FUEL_ICON} size={13} sw={2.2} />Log what you took</Link>
      )}
      <Context why={why} same={same} />
      <Body railLabel="What Garmin recorded" main={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div data-tip={check.tip} tabIndex={check.tip ? 0 : undefined} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14, border: '1px solid var(--ln)' }}>
            <span aria-hidden="true" style={{ flex: 'none', width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', background: check.r[2], color: check.r[1] }}><Icon d={check.r[3]} size={14} sw={3} /></span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span className="l" style={{ fontSize: 10 }}>Planned → done</span>
              <span style={{ fontSize: 15 }}><span style={{ color: 'var(--tx2)' }}>{check.plan}</span> <b style={{ color: check.r[1] }}>{check.r[0]}</b></span>
              {check.sub && <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{check.sub}</span>}
            </span>
          </div>
          {zs.length === 5 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}><h3 className="l" style={{ color: 'var(--tx)' }}>Time in heart-rate zone</h3><span style={{ fontSize: 12, color: 'var(--tx3)' }}>minutes · Garmin’s zones</span></div>
              {zs.map((secs, i) => (
                <div key={i} data-tip={`Z${i + 1}: ${Math.round(secs / 60)} min, ${Math.round((secs / total) * 100)}% of the session.\nSource: Garmin.`} tabIndex={0} style={{ display: 'grid', gridTemplateColumns: '34px 1fr 64px', gap: 12, alignItems: 'center' }}>
                  <span className="n" style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx2)' }}>Z{i + 1}</span>
                  <span style={{ height: 14, borderRadius: 4, background: 'var(--s2)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${(secs / Math.max(...zs, 1)) * 100}%`, borderRadius: 4, background: ZONE_COL[i] }} /></span>
                  <span className="n" style={{ fontSize: 16, textAlign: 'right' }}>{Math.round(secs / 60)} <span style={{ color: 'var(--tx3)', fontSize: 13 }}>min</span></span>
                </div>
              ))}
            </div>
          )}
          <span style={{ fontSize: 12, color: 'var(--tx3)' }}>Cardio load stays its own number — it is never added to strength sets or kilos.</span>
        </div>
      } rail={<Recorded w={w} stamp={stamp} rows={[
        ...(s.elevationGain ? [['Elevation', `${nf(s.elevationGain)} m`]] : []),
        ...(m.np?.value ? [['Normalized power', `${nf(m.np.value)} W`]] : []),
        ...(m.cadence?.value ? [['Cadence', `${nf(m.cadence.value)} ${m.cadence.unit ?? ''}`.trim()]] : []),
        ...(s.averageSwolf ? [['SWOLF', nf(s.averageSwolf)]] : []),
        ...(s.calories ? [['Calories', `${nf(s.calories)} kcal`]] : []),
      ] as [string, string][]} link={swim ? 'Lengths and SWOLF — full session' : 'Laps, splits and map — full session'} />} />
    </>
  );
}

/** What Garmin recorded: the heart-rate trace with its average, and a few facts. */
function Recorded({ w, stamp, rows, link }: { w: any; stamp: string; rows: [string, string][]; link: string }) {
  const s = w.summary ?? {};
  const pts: [number, number][] = w.hr ?? [];
  const W = 360, H = 110;
  let trace: ReactNode = null;
  if (pts.length > 1) {
    const t1 = pts[pts.length - 1][0] || 1;
    const lo = Math.min(...pts.map((p) => p[1])) - 5, hi = Math.max(...pts.map((p) => p[1])) + 5;
    const y = (v: number) => (H - ((v - lo) / (hi - lo)) * H).toFixed(1);
    const line = `M${pts.map((p) => `${((p[0] / t1) * W).toFixed(1)} ${y(p[1])}`).join(' L')}`;
    trace = (
      <div data-tip={`Heart rate across the ${w.group === 'strength' ? 'session — the peaks are the working sets' : 'activity'}; dashed line = average.\nSource: Garmin.`} tabIndex={0} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--tx3)' }}><span>Heart rate</span><span><b className="n" style={{ fontSize: 15, color: 'var(--tx)' }}>{nf(s.averageHR)}</b> avg · <b className="n" style={{ fontSize: 15, color: 'var(--tx)' }}>{nf(s.maxHR)}</b> max bpm</span></span>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-label={`Heart rate: average ${nf(s.averageHR)}, peak ${nf(s.maxHR)} bpm`} role="img" style={{ display: 'block' }}>
          <path d={`${line} L${W} ${H} L0 ${H} Z`} style={{ fill: 'var(--rt)' }} />
          <path d={line} fill="none" style={{ stroke: 'var(--r)' }} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          {s.averageHR && <path d={`M0 ${y(s.averageHR)} L${W} ${y(s.averageHR)}`} fill="none" style={{ stroke: 'var(--tx3)' }} strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
        </svg>
        <span className="m" style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--tx3)' }}><span>0:00</span><span>{mmss(t1)}</span></span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 className="l" style={{ color: 'var(--tx)' }}>What Garmin recorded</h3>
        <span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>{stamp}</span>
      </div>
      {trace ?? <span style={{ fontSize: 13, color: 'var(--tx2)' }}>No heart-rate trace was pulled for this session.</span>}
      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--ln)' }}><span style={{ fontSize: 13, color: 'var(--tx2)' }}>{l}</span><span className="n" style={{ fontSize: 18, fontWeight: 700 }}>{v}</span></div>
          ))}
        </div>
      )}
      <Link to={`/workouts/${w.id}`} className="link" style={{ alignSelf: 'flex-start' }}>{link}</Link>
    </div>
  );
}
