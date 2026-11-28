/**
 * Trips (docs/DESIGN.md (trips)): the days away from the usual setup. Today's trip line, a trip day on the
 * Plan grids, the clashes banner, and the Trips section of the Season page with its form. Every rule —
 * what a place covers, what a maybe means, what a travel day allows, which session clashes — comes from
 * scripts/trips.py through the views; the page draws it and writes the athlete's own answers back.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useStore, useView } from '../lib/api';
import { tip } from '../lib/fmt';
import { daysWord, shortDay } from '../lib/races';
import {
  ACCESS_ICON, STATE_LOOK, TRAVEL_WORD, TRIP_ICON, blankTrip, placeWords, replanText, tripSpan,
  type Part, type TripAccess, type TripBody, type TripCard, type TripClash, type TripDayRow, type TripQuestion, type TripState, type TripsView,
} from '../lib/trips';
import { SportIcon } from './SportIcon';
import { ErrorBox, Icon, IC, Skeleton } from './ui';

const field: CSSProperties = { minHeight: 38, padding: '0 10px', borderRadius: 10, border: '1px solid var(--ln2)', background: 'var(--bg)', color: 'var(--tx)', fontSize: 14 };

/** One place and its state: "✓ Gym", "? Bike", "✕ Pool". */
export function PlaceChip({ k, label, state, title }: { k: TripAccess; label: string; state: TripState; title?: string }) {
  const s = STATE_LOOK[state];
  return (
    <span className="chip" data-tip={title} tabIndex={title ? 0 : undefined}
      style={{ color: s.c, background: s.bg, border: `1px ${s.dashed ? 'dashed' : 'solid'} ${state === 'no' ? 'var(--ln2)' : s.c}`, textDecoration: state === 'no' ? 'line-through' : undefined }}>
      <SportIcon icon={ACCESS_ICON[k]} size={12} sw={2.2} /><span aria-hidden="true">{s.mark}</span>{label}
      <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>: {s.word.toLowerCase()}</span>
    </span>
  );
}

function Places({ t, defs }: { t: TripCard; defs?: TripsView['defs'] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {t.access.map((a) => (
        <PlaceChip key={a.key} k={a.key} label={a.label} state={a.state}
          title={a.state === 'maybe' ? tip(defs, 'trip_maybe') : a.answered ? `Confirmed ${shortDay(a.answered)}.` : undefined} />
      ))}
    </div>
  );
}

/** Today's trip line (under the race line): the trip under way or within three weeks — what it has, the
 * day you're on, the sessions that clash with it — and each maybe due an answer, answered here. */
export function TripLine({ t }: { t: any }) {
  const tr = t.trip as { today: any; trip: TripCard | null; questions: TripQuestion[]; clashes: number } | null;
  const { state, ask, trips } = useStore();
  const [msg, setMsg] = useState<string | null>(null);
  if (!tr) return null;
  const card = tr.trip;
  const p = tr.today;
  const offline = state?.coach !== 'online';
  const labels = Object.fromEntries((card?.access ?? []).map((a) => [a.key, a.label]));
  const mine = card ? card.clashes : [];
  const answer = (q: TripQuestion, s: 'yes' | 'no') => {
    setMsg(null);
    trips({ action: 'answer', id: q.trip, access: q.access, state: s })
      .then((r) => setMsg(r ?? 'Saved.')).catch((e) => setMsg(`Not saved — ${String(e.message ?? e)}`));
  };
  return (
    <section aria-label="Trip" className="rise card" style={{ padding: '14px 18px', gap: 10, borderColor: mine.length ? 'var(--y)' : undefined }}>
      {card && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
          <Icon d={TRIP_ICON} size={22} sw={2} />
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>
              {p.away ? `In ${card.where} · day ${p.day} of ${p.of}${p.travel ? ` · ${TRAVEL_WORD[p.travel]}` : ''}` : `${card.where} in ${daysWord(card.days_to)}`}
            </span>
            <span className="m" style={{ color: 'var(--tx3)' }}>{tripSpan(card)}{card.time === 'limited' ? ' · limited time' : ''}{p.home ? ` · home setup ${p.home}` : ''}</span>
          </span>
          <Places t={card} defs={t.defs} />
          {p.away && <span data-tip={p.rule} tabIndex={0} style={{ fontSize: 13, color: 'var(--tx2)', flex: '1 1 220px' }}>
            {card.there.yes.length ? `Only ${placeWords(card.there.yes, labels)} here.` : 'Nothing to train with here: rest and walk.'}
          </span>}
        </div>
      )}
      {mine.length > 0 && (
        <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', fontSize: 14 }}>
          <span style={{ color: 'var(--y)', fontWeight: 700 }}><Icon d={IC.warn} size={13} /> {mine.length} {mine.length === 1 ? 'session clashes' : 'sessions clash'} with it</span>
          <span style={{ color: 'var(--tx2)', flex: '1 1 240px' }}>{mine.slice(0, 2).map((c) => `${shortDay(c.date)} ${c.title}`).join(' · ')}{mine.length > 2 ? ' …' : ''}</span>
          <Link to="/plan" className="link">See them on Plan</Link>
          <button type="button" className="btn2 hv" disabled={offline} onClick={() => card && ask('plan', replanText(card), { about: `trip ${card.id}` })
            .then(() => setMsg('Sent — the coach’s proposal appears on Plan when it’s ready.')).catch((e) => setMsg(String(e.message ?? e)))}>Replan around it</button>
        </div>
      )}
      {tr.questions.map((q) => (
        <div key={`${q.trip}:${q.access}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', padding: '8px 10px', borderRadius: 10, background: 'var(--yt)' }}>
          <span style={{ fontSize: 14, fontWeight: 600, flex: '1 1 240px' }} data-tip={tip(t.defs, 'trip_maybe')}>{q.question} <span className="m" style={{ color: 'var(--tx3)' }}>{tripSpan(q)}</span></span>
          <button type="button" className="btn2 hv" onClick={() => answer(q, 'yes')}>Yes</button>
          <button type="button" className="btn2 hv" onClick={() => answer(q, 'no')}>No</button>
        </div>
      ))}
      {msg && <span role="status" style={{ fontSize: 13, color: 'var(--tx2)' }}>{msg}</span>}
    </section>
  );
}

/** A trip day on the Plan week: where, which day of it, the travel part. Its tooltip says what it allows. */
export function TripDayTag({ td, defs }: { td: TripDayRow; defs?: Record<string, any> }) {
  const ruleTip = tip(defs, td.travel ? 'trip_travel' : 'trip');
  return (
    <span data-tip={`${td.trip.where} · day ${td.day} of ${td.of}${td.travel ? ` · ${TRAVEL_WORD[td.travel]}` : ''}${td.home ? ` · home setup ${td.home}` : ''}.\n${ruleTip ?? ''}`} tabIndex={0}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: '1px dashed var(--c)', color: 'var(--c)', background: 'var(--ct)' }}>
      <Icon d={TRIP_ICON} size={11} sw={2.2} />{td.trip.where} {td.day}/{td.of}{td.travel ? ` · ${td.travel === 'both' ? 'travel' : td.travel}` : ''}
    </span>
  );
}

/** The sessions planned where a trip can't hold them (Plan): each with why, and one request to replan. */
export function TripClashes({ clashes, defs, offline, send }: { clashes: TripClash[]; defs?: Record<string, any>; offline: boolean; send: (kind: string, text: string, prm?: Record<string, unknown>) => void }) {
  if (!clashes.length) return null;
  const byTrip = new Map<string, TripClash[]>();
  for (const c of clashes) byTrip.set(c.trip, [...(byTrip.get(c.trip) ?? []), c]);
  return (
    <>
      {[...byTrip.entries()].map(([id, cs]) => (
        <div key={id} role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--y)', background: 'var(--yt)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px' }}>
            <span style={{ fontWeight: 700, color: 'var(--y)' }} data-tip={tip(defs, 'trip_clash')} tabIndex={0}><Icon d={TRIP_ICON} size={14} sw={2.2} /> {cs.length} {cs.length === 1 ? 'session doesn’t fit' : 'sessions don’t fit'} the {cs[0].where} trip</span>
            <button type="button" className="btn2 hv" style={{ marginLeft: 'auto' }} disabled={offline}
              onClick={() => send('plan', `Replan around my ${cs[0].where} trip`, { about: `trip ${id}` })}>Replan around it</button>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13 }}>
            {cs.map((c, i) => (
              <li key={i}><b>{shortDay(c.date)} · {c.title}</b> <span style={{ color: 'var(--tx2)' }}>— {c.why}{c.on_watch ? ' · on the watch: moving it is a Send to watch' : ''}</span></li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/** The Season page's Trips section: every trip ahead (and the last one past), what each place has, its
 * clashes and maybes — and the form to add, change or remove one. Saved through trips.py, no model. */
export function TripsSection() {
  const { data, error, loading } = useView<TripsView>('trips');
  const { state, ask, trips } = useStore();
  const [editing, setEditing] = useState<TripBody | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Skeleton h={120} />;
  if (!data) return null;
  const v = data;
  const offline = state?.coach !== 'online';
  const shown = v.trips.filter((t) => !t.past);
  const past = v.trips.filter((t) => t.past).slice(-1);
  const keys = v.access.map((a) => a.key);
  const save = (body: TripBody) => {
    setMsg(null);
    return trips({ action: 'save', trip: body }).then((r) => { setEditing(null); setMsg(r ?? 'Saved.'); });
  };
  const remove = (t: TripCard) => {
    setMsg(null);
    trips({ action: 'remove', id: t.id }).then((r) => setMsg(r ?? 'Removed.')).catch((e) => setMsg(`Not removed — ${String(e.message ?? e)}`));
  };
  const answer = (q: TripQuestion, s: 'yes' | 'no') => {
    setMsg(null);
    trips({ action: 'answer', id: q.trip, access: q.access, state: s }).then((r) => setMsg(r ?? 'Saved.')).catch((e) => setMsg(`Not saved — ${String(e.message ?? e)}`));
  };
  const edit = (t: TripCard) => setEditing({ id: t.id, where: t.where, from: t.from, to: t.to, time: t.time, leave: t.leave, back: t.back, note: t.note,
    access: Object.fromEntries(t.access.map((a) => [a.key, a.state])) as TripBody['access'] });
  return (
    <section aria-labelledby="trips-h" className="rise card" style={{ gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px' }}>
        <h2 id="trips-h" className="l" style={{ color: 'var(--tx)' }}>Trips</h2>
        <span data-tip={tip(v.defs, 'trip')} tabIndex={0} style={{ fontSize: 13, color: 'var(--tx2)', flex: '1 1 260px' }}>
          Days away from {v.home?.where ? `${v.home.where} and ` : ''}your usual setup. The coach plans each day with what that place has.
        </span>
        {!editing && <button type="button" className="btn" onClick={() => setEditing(blankTrip(keys))} style={{ minHeight: 40 }}>
          <Icon d="M12 5v14M5 12h14" size={15} sw={2.4} />Add a trip
        </button>}
      </div>
      {msg && <span role="status" style={{ fontSize: 13, color: 'var(--tx2)' }}>{msg}</span>}
      {editing && <TripForm v={v} initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
      {!shown.length && !editing && (
        <span style={{ fontSize: 14, color: 'var(--tx3)' }}>No trips ahead. Add one when you’ll be away — or tell the coach.</span>
      )}
      {[...past, ...shown].map((t) => (
        <article key={t.id} aria-label={`${t.where}, ${tripSpan(t)}`} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 14, border: `1px ${t.current ? 'solid var(--tx)' : 'solid var(--ln2)'}`, opacity: t.past ? 0.6 : 1 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 14px' }}>
            <span className="n" style={{ fontSize: 24, fontWeight: 700 }}>{t.where}</span>
            <span style={{ fontSize: 14, color: 'var(--tx2)' }}>{tripSpan(t)} · {t.days} {t.days === 1 ? 'day' : 'days'}</span>
            <span className="m" style={{ color: 'var(--tx3)' }}>{t.past ? 'past' : t.current ? 'now' : `in ${daysWord(t.days_to)}`}</span>
            {!t.past && <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button type="button" className="btn2 hv" onClick={() => edit(t)} disabled={!!editing}>Change</button>
              <button type="button" className="btn2 hv" onClick={() => remove(t)} aria-label={`Remove the ${t.where} trip`}>Remove</button>
            </span>}
          </div>
          <Places t={t} defs={v.defs} />
          <TripFacts t={t} v={v} />
          {t.questions.map((q) => (
            <div key={q.access} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', fontSize: 14 }}>
              <span style={{ flex: '1 1 240px' }}><b>{q.question}</b> <span style={{ color: 'var(--tx3)' }}>{q.due ? 'The coach needs it to plan that week.' : `Planned without it until you say — the coach asks from ${shortDay(q.ask_from)}.`}</span></span>
              <button type="button" className="btn2 hv" onClick={() => answer(q, 'yes')}>Yes</button>
              <button type="button" className="btn2 hv" onClick={() => answer(q, 'no')}>No</button>
            </div>
          ))}
          {t.clashes.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', fontSize: 13 }}>
              <span style={{ color: 'var(--y)', fontWeight: 700 }} data-tip={tip(v.defs, 'trip_clash')} tabIndex={0}>
                <Icon d={IC.warn} size={13} /> {t.clashes.length} {t.clashes.length === 1 ? 'session doesn’t fit' : 'sessions don’t fit'}
              </span>
              <span style={{ color: 'var(--tx2)', flex: '1 1 260px' }}>{t.clashes.map((c) => `${shortDay(c.date)} ${c.title}`).join(' · ')}</span>
              <button type="button" className="btn2 hv" disabled={offline} onClick={() => ask('plan', replanText(t), { about: `trip ${t.id}` })
                .then(() => setMsg('Sent — the coach’s proposal appears on Plan when it’s ready.')).catch((e) => setMsg(String(e.message ?? e)))}>Replan around it</button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function TripFacts({ t, v }: { t: TripCard; v: TripsView }) {
  const facts: ReactNode[] = [];
  if (t.time === 'limited') facts.push(<span key="time" data-tip={tip(v.defs, 'trip_limited')} tabIndex={0}>Limited time</span>);
  facts.push(<span key="travel" data-tip={tip(v.defs, 'trip_travel')} tabIndex={0}>
    Travel days kept light{t.leave ? ` · leave in the ${t.leave}` : ''}{t.back ? ` · back in the ${t.back}` : ''}</span>);
  if (t.there.no.includes('gym') || t.there.maybe.includes('gym')) facts.push(<span key="gym" data-tip={tip(v.defs, 'trip_no_gym')} tabIndex={0}>No gym: bodyweight or moved</span>);
  if (t.note) facts.push(<span key="note">“{t.note}”</span>);
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 13, color: 'var(--tx2)' }}>{facts.map((f, i) => <span key={i}>{i > 0 && '· '}{f}</span>)}</div>;
}

/** Add or change a trip: where, the dates, yes · maybe · no for every place (nothing assumed), the time,
 * and when you leave and are back. trips.py refuses what it can't hold — an overlap, dates out of order. */
export function TripForm({ v, initial, onSave, onCancel }: { v: TripsView; initial: TripBody; onSave: (t: TripBody) => Promise<unknown>; onCancel: () => void }) {
  const [t, setT] = useState<TripBody>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TripBody>(k: K, val: TripBody[K]) => setT((x) => ({ ...x, [k]: val }));
  const ready = t.where.trim() && t.from && t.to && t.to >= t.from;
  const submit = () => {
    setErr(null);
    setBusy(true);
    onSave({ ...t, where: t.where.trim(), note: t.note?.trim() || null }).catch((e) => setErr(String(e.message ?? e))).finally(() => setBusy(false));
  };
  const parts: (Part | null)[] = [null, ...v.parts];
  return (
    <form aria-label={initial.id ? `Change the ${initial.where} trip` : 'Add a trip'} onSubmit={(e) => { e.preventDefault(); if (ready) submit(); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, borderRadius: 14, border: '1px solid var(--tx)', background: 'var(--s2)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 200px', fontSize: 12, color: 'var(--tx2)' }}>Where
          <input type="text" value={t.where} maxLength={60} onChange={(e) => set('where', e.target.value)} placeholder="City or place" style={field} required /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px', fontSize: 12, color: 'var(--tx2)' }}>First day
          <input type="date" value={t.from} onChange={(e) => set('from', e.target.value)} style={field} required /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px', fontSize: 12, color: 'var(--tx2)' }}>Last day
          <input type="date" value={t.to} min={t.from || undefined} onChange={(e) => set('to', e.target.value)} style={field} required /></label>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend className="l" style={{ marginBottom: 8 }}>What will you have there?</legend>
        {v.access.map((a) => (
          <div key={a.key} role="radiogroup" aria-label={a.label} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px' }}>
            <span data-tip={a.covers} tabIndex={0} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: '1 1 160px', fontSize: 14, fontWeight: 600 }}>
              <SportIcon icon={ACCESS_ICON[a.key]} size={16} />{a.label}
            </span>
            {(['yes', 'maybe', 'no'] as TripState[]).map((s) => {
              const on = t.access[a.key] === s;
              const look = STATE_LOOK[s];
              return (
                <button key={s} type="button" role="radio" aria-checked={on} onClick={() => set('access', { ...t.access, [a.key]: s })}
                  data-tip={s === 'maybe' ? v.states.maybe : undefined}
                  style={{ minHeight: 34, minWidth: 74, padding: '0 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    border: `1px ${look.dashed ? 'dashed' : 'solid'} ${on ? look.c : 'var(--ln2)'}`, background: on ? look.bg : 'transparent', color: on ? (s === 'no' ? 'var(--tx)' : look.c) : 'var(--tx2)' }}>
                  {look.mark} {look.word}
                </button>
              );
            })}
          </div>
        ))}
      </fieldset>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px', fontSize: 12, color: 'var(--tx2)' }} data-tip={v.time.limited}>Time to train
          <select value={t.time ?? ''} onChange={(e) => set('time', (e.target.value || null) as TripBody['time'])} style={field}>
            <option value="">As at home</option><option value="limited">Limited — short, optional sessions</option>
          </select></label>
        {(['leave', 'back'] as const).map((k) => (
          <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px', fontSize: 12, color: 'var(--tx2)' }} data-tip={tip(v.defs, 'trip_travel')}>
            {k === 'leave' ? 'You leave in the…' : 'You’re back in the…'}
            <select value={t[k] ?? ''} onChange={(e) => set(k, (e.target.value || null) as Part | null)} style={field}>
              {parts.map((p) => <option key={p ?? ''} value={p ?? ''}>{p ?? 'Not sure'}</option>)}
            </select></label>
        ))}
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--tx2)' }}>Note · optional
        <input type="text" value={t.note ?? ''} maxLength={300} onChange={(e) => set('note', e.target.value)} placeholder="“Runs if time allows”, “hotel has a small gym”…" style={field} /></label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button type="submit" className="btn" disabled={!ready || busy}>{busy ? 'Saving…' : initial.id ? 'Save changes' : 'Save the trip'}</button>
        <button type="button" className="btn2 hv" onClick={onCancel}>Cancel</button>
        <span style={{ fontSize: 12, color: 'var(--tx3)', flex: '1 1 240px' }}>Saved straight to your trips — no coach needed. Then “Replan around it” asks the coach to fit the week to it.</span>
      </div>
      {err && <span role="alert" style={{ fontSize: 13, color: 'var(--r)' }}>Not saved — {err}</span>}
    </form>
  );
}
