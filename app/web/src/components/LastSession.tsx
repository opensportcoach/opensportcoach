/**
 * Today's Last session card (board Last-Session, handoff 2026-10-23; states on Last-Session-States).
 * It answers, in order: did it go as planned · what happened in it · what does it change. One tab per
 * session of the last training day (`today.last_day`), opening on the latest; each tab reads that
 * session's own `workout` view — the same one Plan's panel and the session page read.
 *
 * Strength rows are grouped by what the work is for (the plan's phase, else the lift's own role):
 * core counts sets, power counts reps, strength counts kilos — never "0 kg" on body-weight, timed or
 * unnamed work. Strength load and Garmin's cardio load are shown apart, never added. "It changes"
 * points at the decision in Waiting for you (#pd); the card never holds the decision.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, useView, type Defs } from '../lib/api';
import { day, kg, mmss, nf, pl, tip } from '../lib/fmt';
import { Empty, IC, Icon } from './ui';
import { SportIcon, kindColor } from './SportIcon';
import { Legend, XYChart, axisFor } from './Chart';
import { ScoreBadge } from './Score';

const EQ = 'M6 9h12M6 15h12';

interface Look { word: string; col: string; bg: string; icon: string }
const G: Look = { word: '', col: 'var(--g)', bg: 'var(--gt)', icon: IC.check };
const Y: Look = { word: '', col: 'var(--y)', bg: 'var(--yt)', icon: IC.warn };
const N: Look = { word: '', col: 'var(--tx2)', bg: 'var(--s2)', icon: IC.check };
const look = (l: Look, word: string, icon = l.icon): Look => ({ ...l, word, icon });

/** The card's groups, in order. Hypertrophy is strength work here: both are counted in kilos. */
const GROUPS: { id: string; t: string; c: string; sub: (sets: number, kgs: number) => string }[] = [
  { id: 'core', t: 'Core', c: 'var(--v)', sub: (n) => `${pl(n, 'set')} · counted as done, not in kilos` },
  { id: 'power', t: 'Power', c: 'var(--b)', sub: (n) => `${pl(n, 'set')} · speed matters here, not kilos` },
  { id: 'strength', t: 'Strength', c: 'var(--o)', sub: (n, k) => `${pl(n, 'set')}${k ? ` · ${nf(k)} kg` : ''}` },
  { id: 'functional', t: 'Functional', c: 'var(--tx2)', sub: (n) => `${pl(n, 'set')} · time and work, not kilos` },
];
const groupOf = (phase: string | null | undefined) => (phase === 'hypertrophy' ? 'strength' : phase ?? null);

const isTime = (e: any) => String(e?.base ?? e?.kind ?? '').replace(/_per_side$/, '') === 'time';

export function LastSession({ t }: { t: any }) {
  const ld = t.last_day;
  const sessions: any[] = ld?.sessions ?? [];
  const latest = sessions.length ? sessions[sessions.length - 1].id : null;
  const [sel, setSel] = useState<number | null>(latest);
  useEffect(() => { setSel(latest); }, [ld?.date, latest]);
  const cur = sessions.find((s) => s.id === sel) ?? sessions[sessions.length - 1];
  const isToday = ld?.date && ld.date === t.today?.date;
  return (
    <section aria-labelledby="ls-h" className="card ls" style={{ gap: 14, padding: '20px 22px 18px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px' }}>
        <h2 id="ls-h" className="l" style={{ color: 'var(--tx)' }}>Last session</h2>
        {ld && <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{isToday ? 'Today · ' : ''}{day(ld.date)} · {pl(sessions.length, 'session')}</span>}
        <Link to="/workouts" className="link" style={{ marginLeft: 'auto' }}>All workouts</Link>
      </div>
      {!cur ? (
        <Empty title="No finished session yet.">
          After your first workout syncs from the watch, this card shows how it went against the plan, what the coach made of it, and anything it changes. <Link to="/plan" className="link">See what’s planned</Link>
        </Empty>
      ) : (
        <>
          {sessions.length > 1 && (
            <div role="tablist" aria-label={`Sessions on ${day(ld.date)}`} style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
              {sessions.map((s, i) => {
                const on = s.id === cur.id;
                const syncing = s.has_sets === false;
                return (
                  <button key={s.id} type="button" role="tab" aria-selected={on} onClick={() => setSel(s.id)}
                    style={{ flex: '1 0 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '6px 12px', borderRadius: 12,
                      border: `1px solid ${on ? 'var(--tx)' : 'var(--ln)'}`, background: on ? 'var(--s2)' : 'transparent', color: 'var(--tx)', textAlign: 'left' }}>
                    <SportIcon icon={s.icon} size={14} sw={2.4} style={{ flex: 'none', color: kindColor(s.kind) }} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{s.title}</span>
                      <span className="m" style={{ color: 'var(--tx3)' }}>{s.start}{i === sessions.length - 1 ? ' · latest' : ''}</span>
                    </span>
                    <span aria-label={syncing ? 'syncing' : 'done'} style={{ marginLeft: 'auto', display: 'inline-flex', color: syncing ? 'var(--b)' : 'var(--g)' }}>
                      <Icon d={syncing ? IC.spinner : IC.check} size={12} sw={3} className={syncing ? 'spin' : undefined} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <Panel key={cur.id} s={cur} t={t} />
        </>
      )}
    </section>
  );
}

function Panel({ s, t }: { s: any; t: any }) {
  const { askAbout, state } = useStore();
  const offline = state?.coach !== 'online';
  const pending = s.has_sets === false;
  const { data: w, error } = useView('workout', pending ? null : String(s.id));
  return (
    <div role="tabpanel" aria-label={s.title} style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 14, borderTop: '1px solid var(--ln)' }}>
      <span className="l" style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 6, color: kindColor(s.kind) }}>
        <SportIcon icon={s.icon} size={12} sw={2.4} />{s.sport}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', marginTop: -8 }}>
        <span className="n" style={{ fontSize: 32, lineHeight: 1.05, fontWeight: 700 }}>{s.title}</span>
        <span className="m" data-tip={`Start and end from the watch; ${s.durationMin} min of activity. Source: Garmin.`} tabIndex={0} style={{ color: 'var(--tx3)' }}>{s.start} – {s.end} · {s.durationMin} min</span>
      </div>
      {pending ? (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, background: 'var(--s2)' }}>
          <Icon d={IC.spinner} size={18} className="spin" style={{ color: 'var(--b)', flex: 'none' }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <b style={{ fontSize: 14 }}>Finished on the watch at {s.end} — its sets haven’t synced from Garmin yet.</b>
            <span style={{ fontSize: 13, color: 'var(--tx2)' }}>How it went against the plan appears here once a refresh brings them in.</span>
          </span>
        </div>
      ) : !w ? (
        <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{error ? `Couldn’t read this session here (${error}). The full session page has it.` : 'Reading the session…'}</span>
      ) : w.group === 'strength' ? <Strength w={w} t={t} /> : <Cardio w={w} t={t} />}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Link to={`/workouts/${s.id}`} className="btn2 hv" style={{ minHeight: 40 }}>Open the full session<Icon d={IC.arrow} size={13} sw={2.6} /></Link>
        <button type="button" className="btn2 hv" disabled={offline} style={{ minHeight: 40, border: 0, color: 'var(--tx2)' }}
          onClick={() => askAbout(`${s.title} · ${day(w?.date ?? t.last_day.date)} (activity ${s.id})`)}>Ask about it</button>
      </div>
    </div>
  );
}

// --- the verdict, the numbers, and what it changes ---------------------------------------------------
function Verdict({ v, what, text, stamp, stampTip, score, defs }: { v: Look; what: string; text?: string | null; stamp?: string; stampTip?: string; score?: any; defs?: Defs }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <span aria-hidden="true" style={{ flex: 'none', width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', background: v.bg, color: v.col }}><Icon d={v.icon} size={16} sw={3} /></span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px' }}>
          <b className="n" style={{ fontSize: 22, lineHeight: 1, color: v.col }}>{v.word}</b>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{what}</span>
          {/* The execution score beside the verdict (board Score-Badge, medium); the engine's, never this card's. */}
          {score && !score.excluded && <ScoreBadge s={score} size="md" defs={defs} />}
        </span>
        {text && <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--tx2)', textWrap: 'pretty' } as any}>{text}{stamp && <> <span className="m" data-tip={stampTip} tabIndex={stampTip ? 0 : undefined} style={{ color: 'var(--tx3)', whiteSpace: 'nowrap' }}>{stamp}</span></>}</span>}
      </span>
    </div>
  );
}

interface Num { l: string; v: string; u?: string; sub?: string; col?: string; tip?: string }
function Nums({ items }: { items: Num[] }) {
  return (
    <div className="nums" style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, borderRadius: 12, border: '1px solid var(--ln)', overflow: 'hidden' }}>
      {items.map((k) => (
        <div key={k.l} data-tip={k.tip} tabIndex={k.tip ? 0 : undefined} style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 3, boxShadow: '-1px 0 0 var(--ln), 0 -1px 0 var(--ln)' }}>
          <span className="l" style={{ fontSize: 9 }}>{k.l}</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="n" style={{ fontSize: 24, lineHeight: 1, fontWeight: 700, color: k.col ?? 'var(--tx)' }}>{k.v}</span>
            {k.u && <span className="n" style={{ fontSize: 13, color: 'var(--tx2)' }}>{k.u}</span>}
          </span>
          {k.sub && <span style={{ fontSize: 11, lineHeight: 1.3, color: 'var(--tx3)' }}>{k.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** A pointer to the decision in Waiting for you — never the decision itself. */
function Changes({ kind, title, sub, more }: { kind: string; title: string; sub?: string; more: number }) {
  return (
    <a href="#pd" className="hv" data-tip="The decision itself lives in “Waiting for you” at the top of Today. Accepting changes the plan only; the watch is a separate step."
      onClick={(e) => { e.preventDefault(); document.getElementById('pd')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, border: '1px solid var(--g)', background: 'var(--gt)' }}>
      <span aria-hidden="true" style={{ flex: 'none', width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--s1)', color: 'var(--g)' }}><Icon d={IC.up} size={14} sw={2.8} /></span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <span className="l" style={{ fontSize: 9, color: 'var(--g)' }}>{kind}</span>
        <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{title}</span>
        {(sub || more > 0) && <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{sub}{more > 0 ? `${sub ? ' · ' : ''}+ ${more} more` : ''}</span>}
      </span>
      <span style={{ flex: 'none', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>Decide above<Icon d={IC.up} size={12} sw={2.6} /></span>
    </a>
  );
}

/** The coach's review of this session, first paragraph — read only when one was written. */
function useReview(files?: string[]): { text: string; file: string } | null {
  const { data } = useView('journal-entry', files?.length ? files[0] : null);
  const body = data?.markdown ? String(data.markdown).replace(/^# .*\n/, '').trim().split(/\n\s*\n/)[0] : '';
  return body && files?.length ? { text: body, file: files[0] } : null;
}

// --- strength --------------------------------------------------------------------------------------
interface Row { key: string; name: string; sub: string; unnamed: boolean; pips: { bg: string; bc: string }[]; pipsLabel: string; v: string; vSub: string; vTip?: string; c: Look; cTip?: string }

function Strength({ w, t }: { w: any; t: any }) {
  const defs: Defs = w.defs ?? {};
  const review = useReview(w.reviews);
  const planned: any[] = w.planned?.exercises ?? [];
  const pByKey = new Map(planned.map((p) => [`${p.category}/${p.name}`, p]));
  // A lift logged in two blocks (supersets, a return to it) is one row.
  const merged: any[] = [];
  const at = new Map<string, any>();
  for (const b of w.exercises ?? []) {
    const k = b.key.join('/');
    if (at.has(k)) at.get(k).sets = [...at.get(k).sets, ...b.sets];
    else { const m = { ...b, sets: [...b.sets] }; at.set(k, m); merged.push(m); }
  }
  let pS = 0, dS = 0, shortAll = 0, allWorking = 0;
  planned.forEach((p) => { pS += p.sets; });
  const groups = new Map<string, { rows: Row[]; sets: number; kgs: number }>();
  const put = (g: string, r: Row, sets: number, kgs: number) => {
    const x = groups.get(g) ?? { rows: [], sets: 0, kgs: 0 };
    x.rows.push(r); x.sets += sets; x.kgs += kgs;
    groups.set(g, x);
  };
  let lastGroup = 'strength';
  for (const b of merged) {
    const k = b.key.join('/');
    const p = pByKey.get(k);
    const ws = b.sets.filter((x: any) => x.type === 'working');
    const sets = ws.length ? ws : b.sets;
    allWorking += ws.length;
    const g = groupOf(b.phase) ?? lastGroup;
    lastGroup = g;
    const kgs = b.sets.reduce((a: number, x: any) => a + (x.weight_logged ?? 0) * (x.reps_logged ?? 0), 0);
    const timed = p ? isTime(p) : sets.every((x: any) => !x.reps && x.duration_s);
    const target = p?.value;
    const missing = p ? Math.max(0, p.sets - ws.length) : 0;
    const short = p && !timed ? ws.reduce((a: number, x: any) => a + Math.max(0, target - x.reps), 0) : 0;
    if (p) { dS += Math.min(ws.length, p.sets); shortAll += short; }
    const top = Math.max(0, ...sets.map((x: any) => x.weight ?? 0));
    const repsTop = Math.max(0, ...sets.filter((x: any) => (x.weight ?? 0) === top).map((x: any) => x.reps));
    const every = sets.every((x: any) => x.weight === sets[0].weight && x.reps === sets[0].reps);
    const reps = sets.map((x: any) => x.reps);
    let v: string, vSub: string, vTip: string | undefined;
    if (b.unnamed) { v = pl(sets.length, 'set'); vSub = 'logged'; vTip = `${pl(sets.length, 'set')} with no exercise name the plan knows. Source: Garmin.`; }
    else if (timed) { v = `${sets.length} × ${mmss(sets.reduce((a: number, x: any) => a + x.duration_s, 0) / sets.length)}`; vSub = 'hold'; vTip = 'Average time per set as logged. Source: Garmin.'; }
    else if (top > 0) {
      v = `${kg(top)} × ${repsTop}`;
      vSub = `${b.per_hand ? 'kg/hand' : b.machine ? 'plates kg' : 'kg'} × reps · ${every ? 'every set' : 'top set'}`;
      vTip = `Working sets: ${sets.map((x: any) => `${kg(x.weight)} × ${x.reps}`).join(', ')}${b.per_hand ? ` — per hand; logged as ${sets.map((x: any) => kg(x.weight_logged)).join(', ')} kg for both` : ''}. Source: Garmin.`;
    } else { v = every && reps.length ? `${reps.length} × ${reps[0]}` : reps.join(' · '); vSub = 'reps'; }
    const prev = (b.history ?? []).filter((h: any) => h.date < w.date).pop();
    let c: Look, cTip: string | undefined;
    if (b.unnamed) { c = look(Y, 'Unnamed'); cTip = 'Unnamed sets can’t be matched to the plan or counted for progress.'; }
    else if (!p && w.planned) { c = look(N, 'Not in the plan', IC.minus); cTip = 'Logged on the day; the program day has no such lift.'; }
    else if (b.signal === 'bump') { c = look(G, 'Bump signal', IC.up); cTip = 'Top of the rep range on every working set — the progression rule’s signal. Source: computed by OpenSportCoach.'; }
    else if (sets.some((x: any) => x.pr)) { c = look(G, 'Best', IC.up); cTip = tip(defs, 'e1rm'); }
    else if (missing) { c = look(Y, `−${pl(missing, 'set')}`); cTip = `${ws.length} of ${p.sets} planned sets logged.`; }
    else if (short) { c = look(Y, `−${pl(short, 'rep')}`); cTip = `Short of ${target} reps across the working sets.`; }
    else if (g === 'core') { c = look(N, 'Done'); }
    else if (prev && top > 0 && prev.top) {
      const d = Math.round((top - prev.top) * 100) / 100;
      c = d > 0 ? look(G, `+${kg(d)} kg`, IC.up) : d < 0 ? look(N, `−${kg(-d)} kg`, IC.down) : look(N, 'Same as last', EQ);
      cTip = `Top working set against the last session with this lift, ${day(prev.date)} (${kg(prev.top)} kg${b.per_hand ? ' per hand' : ''}). Source: Garmin.`;
    } else c = look(N, p ? 'As planned' : 'Logged');
    const pips = b.unnamed ? sets.map(() => ({ bg: 'transparent', bc: 'var(--y)' }))
      : !p ? sets.map(() => ({ bg: 'var(--tx2)', bc: 'var(--tx2)' }))
        : [...ws.map((x: any) => (timed || x.reps >= target ? { bg: 'var(--g)', bc: 'var(--g)' } : { bg: 'var(--y)', bc: 'var(--y)' })),
          ...Array.from({ length: missing }, () => ({ bg: 'transparent', bc: 'var(--tx3)' }))];
    const sub = b.unnamed ? 'no exercise name on the watch'
      : [kgs > 0 ? `${nf(kgs)} kg` : timed ? 'timed' : 'body weight', b.per_hand && top > 0 ? `${kg(top)} kg per hand` : null, b.machine ? 'plate-loaded' : null].filter(Boolean).join(' · ');
    put(g, { key: k, name: p?.routine ?? b.label, sub, unnamed: b.unnamed, pips, pipsLabel: `${pl(sets.length, 'set')}${b.unnamed ? ', not matched' : ' done'}`, v, vSub, vTip, c, cTip }, sets.length, b.unnamed ? 0 : kgs);
  }
  // Planned and not logged at all: shown, never hidden.
  planned.filter((p) => !at.has(`${p.category}/${p.name}`)).forEach((p) => {
    put(groupOf(p.phase) ?? 'strength', { key: `${p.category}/${p.name}`, name: p.routine ?? p.label, sub: 'not logged', unnamed: false,
      pips: Array.from({ length: p.sets }, () => ({ bg: 'transparent', bc: 'var(--tx3)' })), pipsLabel: `0 of ${p.sets} sets`,
      v: '—', vSub: `planned ${p.sets} × ${p.value}${isTime(p) ? ' s' : ''}`, c: look(N, 'Not logged', IC.minus) }, 0, 0);
  });
  const missingAll = pS - dS;
  const verdict = !w.planned ? { v: look(N, 'Logged'), what: `${pl(allWorking, 'working set')} · no program day matched` }
    : !missingAll && !shortAll ? { v: look(G, 'As planned'), what: `${dS} of ${pS} sets` }
      : missingAll ? { v: look(Y, 'Cut short'), what: `${dS} of ${pS} sets` }
        : { v: look(Y, 'Reps short'), what: `${dS} of ${pS} sets · ${pl(shortAll, 'rep')} short` };
  const dr = t.daily?.review?.session_date === w.date ? t.daily.review : null;
  const fallback = dr ? [...(dr.bumps ?? []).map((x: string) => `Bump: ${x}.`), ...(dr.misses ?? []).map((x: string) => `Missed: ${x}.`)].join(' ') : '';
  const text = review?.text ?? (fallback || null);
  // The same items Waiting for you lists: the daily's, else the engine's bump rows when no daily ran.
  const bumps: any[] = t.daily?.pending
    ? t.daily.pending.filter((p: any) => p.kind === 'bump' && p.bump?.evidence_dates?.includes(w.date))
    : (t.bumps ?? []).filter((b: any) => b.earned_on === w.date)
      .map((b: any) => ({ text: `${b.sets_done} sets, all ≥ ${b.reps_target} reps`, bump: { exercise: String(b.name).split('_').map((x) => x[0] + x.slice(1).toLowerCase()).join(' '), from: b.weight, to: null } }));
  const s = w.summary ?? {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Verdict v={verdict.v} what={verdict.what} text={text} score={w.score} defs={defs} stamp={review ? 'coach · review' : dr ? 'coach · daily' : undefined}
        stampTip={review ? `The coach’s review of this session (${review.file}). Source: coach.` : 'From the coach’s daily. Source: coach.'} />
      <Nums items={[
        { l: 'Time', v: nf((s.duration ?? 0) / 60), u: 'min', sub: 'from the watch', tip: 'Activity duration. Source: Garmin.' },
        { l: 'Sets', v: nf(allWorking), sub: w.planned ? `${dS} of ${pS} planned` : 'working sets', col: w.planned && dS < pS ? 'var(--y)' : undefined, tip: 'Working sets logged on the watch, warm-ups out. Source: Garmin + program.' },
        { l: 'Strength load', v: nf(w.tonnage), u: 'kg', sub: 'kg × reps · loaded moves', tip: `${tip(defs, 'tonnage') ?? 'Kilos × reps for the moves that carry load.'}\nBody-weight, timed and unnamed sets add nothing. Never added to cardio load.` },
        { l: 'Avg HR', v: nf(s.averageHR), u: 'bpm', sub: s.activityTrainingLoad != null ? `Garmin load ${nf(s.activityTrainingLoad)} · own scale` : undefined,
          tip: `${tip(defs, 'load') ?? 'Garmin training load.'}\nA heart-rate scale, kept apart from kilos. Source: Garmin.` },
      ]} />
      {groups.size ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {GROUPS.filter((g) => groups.has(g.id)).map((g) => {
            const x = groups.get(g.id)!;
            return (
              <div key={g.id} role="group" aria-label={g.t} style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px', padding: '10px 0 4px' }}>
                  <span className="l" style={{ fontSize: 10, color: g.c }}>{g.t}</span>
                  <span style={{ fontSize: 11, color: 'var(--tx3)' }}>{g.sub(x.sets, x.kgs)}</span>
                </div>
                {x.rows.map((r) => (
                  <div key={r.key} className="lrow" style={{ padding: '8px 10px', margin: '0 -10px', borderRadius: 10, background: r.unnamed ? 'var(--yt)' : 'transparent' }}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25, color: r.unnamed ? 'var(--y)' : 'var(--tx)' }}>{r.name}</span>
                      <span style={{ fontSize: 11, lineHeight: 1.3, color: 'var(--tx3)' }}>{r.sub}</span>
                    </span>
                    <span aria-label={r.pipsLabel} style={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                      {r.pips.map((p, i) => <span key={i} style={{ width: 8, height: 8, borderRadius: 2, background: p.bg, border: `1.5px solid ${p.bc}`, boxSizing: 'border-box' }} />)}
                    </span>
                    <span data-tip={r.vTip} tabIndex={r.vTip ? 0 : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end', textAlign: 'right' }}>
                      <span className="n" style={{ fontSize: 18, lineHeight: 1, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.v}</span>
                      <span style={{ fontSize: 10, color: 'var(--tx3)', whiteSpace: 'nowrap' }}>{r.vSub}</span>
                    </span>
                    <span data-tip={r.cTip} tabIndex={r.cTip ? 0 : undefined} style={{ justifySelf: 'end', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 7, background: r.c.bg, color: r.c.col, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      <Icon d={r.c.icon} size={10} sw={3} />{r.c.word}
                    </span>
                    {r.unnamed && (
                      <span className="fix" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', fontSize: 12, color: 'var(--tx2)' }}>
                        The watch logged these sets without an exercise name, so they can’t be matched to the plan or counted for progress.
                        <Link to="/coach" className="link" style={{ color: 'var(--tx)', fontWeight: 700 }}>Tell the coach what it was</Link>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : <span style={{ fontSize: 14, color: 'var(--tx2)' }}>No sets were logged for this session.</span>}
      {bumps.length > 0 && (
        <Changes kind="It changes · progression" more={bumps.length - 1}
          title={bumps[0].bump.to != null ? `${bumps[0].bump.exercise} ${kg(bumps[0].bump.from)} → ${kg(bumps[0].bump.to)} kg` : `${bumps[0].bump.exercise} ${kg(bumps[0].bump.from)} kg is ready to go up`}
          sub={bumps[0].text} />
      )}
    </div>
  );
}

// --- rides, runs, swims, sports ---------------------------------------------------------------------
const RATE: Record<string, Look> = {
  on_target: look(G, 'As planned'), partly: look(Y, 'Partly'), off_target: { word: 'Off target', col: 'var(--r)', bg: 'var(--rt)', icon: IC.x },
};

function Cardio({ w, t }: { w: any; t: any }) {
  const { state } = useStore();
  const defs: Defs = w.defs ?? {};
  const s = w.summary ?? {};
  const m = w.endurance?.metrics ?? {};
  const er = [...(state?.requests ?? [])].reverse().find((r) => r.state === 'DONE' && r.result?.kind === 'endurance_review' && String((r.result.payload as any).activity_id) === String(w.id));
  const p: any = er?.result?.payload;
  const line = (t.daily?.endurance ?? []).find((x: any) => String(x.activity_id) === String(w.id));
  const v = p ? { v: RATE[p.execution?.rating] ?? RATE.partly, what: p.intent?.value ? `${p.intent.value[0].toUpperCase()}${p.intent.value.slice(1)}${p.intent.source === 'inferred' ? ' (inferred)' : ''}` : 'against its intent',
    text: p.verdict ?? p.execution?.summary, stamp: er?.finishedAt ? `coach · ${new Date(er.finishedAt).toTimeString().slice(0, 5)}` : 'coach' }
    : line ? { v: line.flag ? look(Y, 'Worth a look') : look(G, 'Done'), what: 'from the coach’s daily', text: line.line, stamp: 'coach · daily' }
      : { v: look(G, 'Done'), what: 'counted in the week', text: 'It counts toward the week’s cardio load. Ask for a review to check it against its intent.', stamp: undefined };
  const swim = w.group === 'swim';
  const speed: Num | null = !s.duration || !s.distance ? null
    : swim ? { l: 'Pace', v: mmss(s.duration / (s.distance / 100)), u: '/100 m' } : w.group === 'run' ? { l: 'Pace', v: mmss(s.duration / (s.distance / 1000)), u: '/km' }
      : m.avg_power?.value ? { l: 'Avg power', v: nf(m.avg_power.value), u: 'W' } : { l: 'Speed', v: nf((s.distance / 1000) / (s.duration / 3600), 1), u: 'km/h' };
  const items: Num[] = [
    { l: 'Time', v: nf((s.duration ?? 0) / 60), u: 'min', sub: 'from the watch', tip: 'Source: Garmin.' },
    ...(s.distance ? [{ l: 'Distance', v: swim ? nf(s.distance) : nf(s.distance / 1000, 1), u: swim ? 'm' : 'km', sub: 'from the watch', tip: 'Source: Garmin.' }] : []),
    ...(speed ? [{ ...speed, sub: 'average', tip: 'Source: Garmin.' }] : []),
    ...(s.averageHR ? [{ l: 'Avg HR', v: nf(s.averageHR), u: 'bpm', sub: s.maxHR ? `max ${nf(s.maxHR)}` : undefined, tip: 'Source: Garmin.' }] : []),
  ].slice(0, s.activityTrainingLoad != null ? 3 : 4);
  if (s.activityTrainingLoad != null) items.push({ l: 'Cardio load', v: nf(s.activityTrainingLoad), sub: 'never added to kilos', tip: `${tip(defs, 'load') ?? 'Garmin training load.'}\nKept apart from strength sets and kilos. Source: Garmin.` });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Verdict v={v.v} what={v.what} text={v.text} stamp={v.stamp} stampTip="Source: coach." score={w.score} defs={defs} />
      <Nums items={items} />
      <Trace w={w} />
    </div>
  );
}

/** Means over equal time buckets: a readable line from a 1 s stream, and a smoothed power trace. */
function buckets(x: number[], vals: (number | null)[], n = 200): (number | null)[] {
  const x0 = x[0], x1 = x[x.length - 1], width = (x1 - x0) / n || 1;
  const sum = new Array(n).fill(0), cnt = new Array(n).fill(0);
  vals.forEach((v, i) => { if (v == null || !Number.isFinite(v)) return; const b = Math.min(n - 1, Math.floor((x[i] - x0) / width)); sum[b] += v; cnt[b] += 1; });
  return sum.map((s, i) => (cnt[i] ? s / cnt[i] : null));
}

/** The one chart that answers the session: its effort (power or pace) under heart rate. */
function Trace({ w }: { w: any }) {
  const st = w.endurance?.streams;
  let x: number[] = [], hr: (number | null)[] = [], a: (number | null)[] | null = null, aLabel = '', aFmt = (v: number) => nf(v), invert = false;
  if ((st?.t?.length ?? 0) > 1 && st.hr) {
    x = st.t; hr = st.hr;
    if (st.power) { a = st.power; aLabel = 'Power · W'; }
    else if (st.speed && w.group === 'run') { a = st.speed.map((v: number | null) => (v && v > 0.5 ? 1000 / v : null)); aLabel = 'Pace · /km'; aFmt = (v) => mmss(v); invert = true; }
    else if (st.speed) { a = st.speed.map((v: number | null) => (v == null ? null : v * 3.6)); aLabel = 'Speed · km/h'; }
  } else if ((w.hr?.length ?? 0) > 1) { x = w.hr.map((p: number[]) => p[0]); hr = w.hr.map((p: number[]) => p[1]); }
  else return null;
  const n = 200;
  const xs = Array.from({ length: n }, (_, i) => x[0] + ((i + 0.5) / n) * (x[x.length - 1] - x[0]));
  const hrB = buckets(x, hr, n);
  const aB = a ? buckets(x, a, n) : null;
  const left = aB ? axisFor(aB, aFmt, { invert }) : axisFor(hrB, (v) => nf(v));
  const right = aB ? axisFor(hrB, (v) => nf(v)) : undefined;
  const mins = Math.round((x[x.length - 1] - x[0]) / 60);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px' }}>
        <span className="l" style={{ fontSize: 10 }}>{aB ? `${aLabel.split(' ·')[0]} and heart rate` : 'Heart rate'} · {mins} min</span>
        <Legend items={[...(aB ? [[aLabel, 'var(--b)'] as [string, string]] : []), ['Heart rate · bpm', 'var(--r)']]} />
      </div>
      <XYChart x={xs} xFmt={(v) => mmss(v - x[0])} height={120} ariaLabel={`${aB ? `${aLabel} and heart` : 'Heart'} rate across the session`}
        left={left} right={right}
        series={[...(aB ? [{ values: aB, color: 'var(--b)', axis: 'left' as const, width: 2 }] : []), { values: hrB, color: 'var(--r)', axis: aB ? 'right' as const : 'left' as const, width: 1.6 }]} />
      <span className="m" style={{ color: 'var(--tx3)' }}>Source: Garmin, the recorded streams{aB ? ' · averaged into 200 slices' : ''}</span>
    </div>
  );
}

