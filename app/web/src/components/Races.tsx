/**
 * The pieces every race screen shares (boards Race-Card, Season, Race, Today-Races, Plan-Races): an
 * event's own mark — or, without one, its kind's icon and a monogram — the date-check chip and block,
 * the window legend, today's call as a strip, and the race card.
 */
import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useStore, useView, type Defs } from '../lib/api';
import { elapsed, tip, todayIso } from '../lib/fmt';
import { CHECK, KIND_COL, WIN, checkState, checkedBy, checkingNow, daysWord, longDay, shortDay, signed, type CheckState, type Mark, type MarkPart, type RaceCard } from '../lib/races';
import { SportIcon } from './SportIcon';
import { Icon } from './ui';

type Marked = Pick<RaceCard, 'name' | 'kind' | 'mark' | 'fallback'>;

/** One file of a mark, drawn the way the registry says: a mask in the text colour, or the image as is. */
function MarkFile({ part, w, h }: { part: MarkPart; w: number | string; h: number | string }) {
  const src = `/${part.file}`;
  return part.draw === 'mask'
    ? <span className="mk-mask" aria-hidden="true" style={{ ['--mk' as string]: `url("${src}")`, width: w, height: h }} />
    : <img className="mk-img" src={src} alt="" aria-hidden="true" style={{ width: w, height: h }} />;
}
const markTip = (m: Mark) => `${m.label}: ${m.note}\nSource: ${m.source}.`;

/** The square tile — the series' icon, else its wordmark, else the fallback (the kind's icon + monogram). */
export function RaceTile({ race, size = 44 }: { race: Marked; size?: number }) {
  const m = race.mark;
  const part = m?.icon ?? m?.wordmark ?? null;
  const tile: CSSProperties = { width: size, height: size, flex: 'none', boxSizing: 'border-box', borderRadius: Math.round(size / 4.4), border: '1px solid var(--ln2)', background: 'var(--s2)', overflow: 'hidden' };
  if (m && part) {
    const bleed = part.draw === 'image' && part === m.icon;   // a full-colour square fills its tile
    return (
      <span role="img" aria-label={m.label} data-tip={markTip(m)} tabIndex={0}
        style={{ ...tile, display: 'grid', placeItems: 'center', padding: bleed ? 0 : Math.round(size / 7), color: 'var(--tx)', background: part.draw === 'image' && !bleed ? '#FFFFFF' : 'var(--s2)' }}>
        <MarkFile part={part} w="100%" h="100%" />
      </span>
    );
  }
  return (
    <span role="img" aria-label={`${race.name}, no mark`} data-tip={`${race.name}: no mark for this event — its kind’s icon and a monogram.`} tabIndex={0}
      style={{ ...tile, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, color: KIND_COL[race.kind] ?? 'var(--tx)' }}>
      <SportIcon icon={race.fallback.icon} size={Math.round(size * 0.42)} sw={1.8} />
      <span className="n" style={{ fontSize: Math.round(size * 0.29), fontWeight: 700, lineHeight: 1, color: 'var(--tx)' }}>{race.fallback.monogram}</span>
    </span>
  );
}

/** The wide slot on the race page: the wordmark, with "70.3" set beside a brand's own; else the fallback. */
export function RaceWordmark({ race, w = 190, h = 92 }: { race: Marked; w?: number; h?: number }) {
  const m = race.mark;
  const part = m?.wordmark ?? m?.icon ?? null;
  if (m && part) return (
    <div role="img" aria-label={m.label} data-tip={markTip(m)} tabIndex={0}
      style={{ width: w, height: h, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--tx)' }}>
      <MarkFile part={part} w={m.suffix ? '72%' : '100%'} h="100%" />
      {m.suffix && <span className="n" style={{ fontSize: 28, fontWeight: 700 }}>{m.suffix}</span>}
    </div>
  );
  return (
    <div role="img" aria-label={`${race.name}, no mark`} data-tip={`${race.name}: no mark for this event — its kind’s icon and a monogram.`} tabIndex={0}
      style={{ width: w, height: h, boxSizing: 'border-box', borderRadius: 14, border: '1px dashed var(--ln2)', background: 'var(--s2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: KIND_COL[race.kind] ?? 'var(--tx)' }}>
      <SportIcon icon={race.fallback.icon} size={30} sw={1.7} />
      <span className="n" style={{ fontSize: 30, fontWeight: 700, color: 'var(--tx)' }}>{race.fallback.monogram}</span>
    </div>
  );
}

/** Today's call, one line, first on every race screen (boards Season, Race, Plan-Races). */
export function CallStrip() {
  const { data: t } = useView('today');
  // Only today's call is a call (Today's hero says the same): yesterday's is not shown here.
  const rec = t?.daily && t.daily.date === todayIso() ? t.daily.recommendation : null;
  if (!rec) return null;
  const col = rec.verb === 'TRAIN' ? 'var(--g)' : rec.verb === 'REST' || rec.verb === 'RECOVER' ? 'var(--v)' : rec.verb === 'RACE' ? 'var(--tx)' : 'var(--b)';
  return (
    <Link to="/" className="hv" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', padding: '12px 16px', borderRadius: 14, border: '1px solid var(--ln)', background: 'var(--s1)' }}>
      <span className="l" style={{ color: 'var(--tx)' }}>Today’s call</span>
      <span className="n" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: col }}>{rec.verb}</span>
      <span className="n" style={{ fontSize: 20, fontWeight: 600 }}>· {rec.title}</span>
      <span style={{ fontSize: 14, color: 'var(--tx2)', flex: '1 1 240px' }}>{rec.why}</span>
    </Link>
  );
}

/** A window's swatch and word, for legends. */
export function WinSwatch({ w, size = 12 }: { w: string; size?: number }) {
  const k = WIN[w];
  return <span aria-hidden="true" className={k.cls} style={{ width: size, height: size, flex: 'none', borderRadius: 3, background: k.cls ? undefined : k.bg, border: `1px solid ${k.bc}`, boxSizing: 'border-box' }} />;
}
export function WinLegend({ windows, defs, bench }: { windows: string[]; defs?: Defs; bench?: boolean }) {
  return (
    <>
      {windows.map((w) => (
        <span key={w} data-tip={tip(defs, ({ easy: 'race_easy', taper: 'race_taper', recovery: 'race_recovery', race: 'race_day' } as Record<string, string>)[w])} tabIndex={0}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tx2)' }}><WinSwatch w={w} />{WIN[w].word}</span>
      ))}
      {bench && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tx2)' }}><span aria-hidden="true" style={{ color: 'var(--y)' }}>★</span>Benchmark</span>}
    </>
  );
}

/** The date-check chip: an icon, a word, and who checked it on hover. */
export function CheckChip({ race, state, defs }: { race: RaceCard; state: CheckState; defs?: Defs }) {
  const k = CHECK[state];
  return (
    <span data-tip={`${k.word} — ${checkedBy(race)}.${race.verified.note ? `\n${race.verified.note}` : ''}\n${tip(defs, 'race_check') ?? ''}`} tabIndex={0}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 6, background: k.bg === 'transparent' ? 'var(--s2)' : k.bg, color: k.c, fontSize: 12, fontWeight: 700 }}>
      <Icon d={k.i} size={12} sw={2.8} className={k.spin ? 'spin' : undefined} />{k.word}{state === 'confirmed' || state === 'listings' ? ` · ${checkedBy(race).split(' · ')[0]}` : ''}
    </span>
  );
}

/** The date check as a block: the state, and what it asks of you — pick a date, or confirm from your entry. */
export function CheckBlock({ race, state, defs }: { race: RaceCard; state: CheckState; defs?: Defs }) {
  const { state: app, ask, askAbout } = useStore();
  const [sent, setSent] = useState<string | null>(null);
  const k = CHECK[state];
  const offline = app?.coach !== 'online';
  const by = state === 'checking' ? 'the coach is looking it up online' : state === 'differs' ? 'the organiser has another date'
    : state === 'unconfirmed' ? 'the organiser’s page couldn’t be read' : state === 'due' ? (race.check_due?.why ?? 'due a check') : checkedBy(race);
  const send = (text: string) => ask('question', text, { about: `race ${race.id}` }).then(() => setSent('Sent — the coach changes nothing until you say so.')).catch((e) => setSent(String(e.message ?? e)));
  return (
    <div data-tip={tip(defs, 'race_check')} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 10, background: k.bg, border: `1px ${k.bs} ${k.bc}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Icon d={k.i} size={14} sw={2.6} className={k.spin ? 'spin' : undefined} style={{ color: k.c, flex: 'none' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: k.c }}>{k.word}</span>
        <span style={{ fontSize: 12, color: 'var(--tx2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{by}</span>
      </div>
      {state === 'differs' && race.verified.found?.date && (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
          <div style={{ padding: 8, borderRadius: 8, border: '1px dashed var(--ln2)' }}>
            <div className="l" style={{ fontSize: 9 }}>Yours</div>
            <div className="n" style={{ fontSize: 16, fontWeight: 700 }}>{shortDay(race.date)}</div>
          </div>
          <div style={{ padding: 8, borderRadius: 8, border: '1px solid var(--y)', background: 'var(--s1)' }}>
            <div className="l" style={{ fontSize: 9, color: 'var(--y)' }}>Organiser</div>
            <div className="n" style={{ fontSize: 16, fontWeight: 700 }}>{shortDay(race.verified.found.date)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn" disabled={offline} style={{ minHeight: 36, fontSize: 12 }}
            onClick={() => send(`${race.name}: use the official date, ${longDay(race.verified.found!.date!)}.`)}>Use the official date</button>
          <button type="button" className="btn2 hv" disabled={offline} style={{ minHeight: 36, fontSize: 12 }}
            onClick={() => send(`${race.name}: keep my date, ${longDay(race.date)}.`)}>Keep mine</button>
        </div>
      </>)}
      {state === 'unconfirmed' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--tx2)', flex: '1 1 140px' }}>{race.verified.note ?? 'Check the date on your entry.'}</span>
          <button type="button" className="btn" disabled={offline} style={{ minHeight: 36, fontSize: 12 }}
            onClick={() => askAbout(`${race.name}: the date on my entry is …`)}>Confirm from my entry</button>
        </div>
      )}
      {state === 'confirmed' && race.verified.note && <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{race.verified.note}</span>}
      {sent && <span role="status" style={{ fontSize: 12, color: 'var(--tx2)' }}>{sent}</span>}
    </div>
  );
}

/** One race in a card (board Race-Card): the mark, what and when, how far off, the target or the
 * result, and the date check. */
export function RaceCardView({ race, defs, next }: { race: RaceCard; defs?: Defs; next?: boolean }) {
  const { state } = useStore();
  const cs = checkState(race, checkingNow(state?.requests));
  const where = [race.where?.city, race.where?.venue].filter(Boolean).join(' · ');
  const res = race.result;
  const p = race.prediction;
  const met = res && res.vs_target_s != null ? res.vs_target_s < 0 : null;
  return (
    <article aria-label={`${race.name}, ${longDay(race.date)}, priority ${race.priority}`}
      style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 16, background: 'var(--s1)',
        border: `${race.priority === 'A' ? 2 : 1}px solid ${race.priority === 'A' ? 'var(--tx)' : next ? 'var(--ln2)' : 'var(--ln)'}`, opacity: race.past ? 0.92 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <RaceTile race={race} size={46} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span data-tip={tip(defs, 'race_priority')} tabIndex={0} className="n"
              style={{ height: 22, padding: '0 7px', borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 700, background: race.priority === 'A' ? 'var(--tx)' : 'transparent', color: race.priority === 'A' ? 'var(--on)' : 'var(--tx)', border: '1px solid var(--tx)' }}>{race.priority}</span>
            <span className="l" style={{ fontSize: 10, color: KIND_COL[race.kind] ?? 'var(--tx2)' }}>{race.kind_label}</span>
            {next && <span className="l" style={{ fontSize: 10, color: 'var(--id)' }}>Next</span>}
          </div>
          <Link to={`/race/${encodeURIComponent(race.id)}`} style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.15 }}>{race.name}</Link>
          {where && <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{where}</span>}
        </div>
        <div data-tip={`${daysWord(race.days_to)} to ${longDay(race.date)}.\n${tip(defs, 'race_countdown') ?? ''}`} tabIndex={0} style={{ flex: 'none', textAlign: 'right' }}>
          <div className="n" style={{ fontSize: 34, fontWeight: 700, lineHeight: 0.9, color: race.past ? 'var(--tx3)' : 'var(--tx)' }}>{Math.abs(race.days_to)}</div>
          <div className="l" style={{ fontSize: 9 }}>{race.past ? 'days ago' : race.days_to === 0 ? 'today' : 'days to go'}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, background: 'var(--ln)', borderRadius: 10, overflow: 'hidden' }}>
        <div data-tip={`${longDay(race.date)}${race.start ? ` · ${race.start}` : ''}.${race.start_note ? `\n${race.start_note}` : ''}`} tabIndex={0} style={{ background: 'var(--s2)', padding: '8px 10px' }}>
          <div className="l" style={{ fontSize: 9 }}>Date · start</div>
          <div className="n" style={{ fontSize: 17, fontWeight: 700 }}>{shortDay(race.date)} {race.date.slice(0, 4)}</div>
          <div className="m" style={{ color: 'var(--tx3)' }}>{race.start ?? 'start time not set'}</div>
        </div>
        {res ? (
          <div data-tip={`Finish time ${res.time}${res.vs_target_s != null ? `, ${signed(res.vs_target_s)} against the target` : ''}.\nSource: Garmin.`} tabIndex={0} style={{ background: 'var(--s2)', padding: '8px 10px' }}>
            <div className="l" style={{ fontSize: 9 }}>Result</div>
            <div className="n" style={{ fontSize: 17, fontWeight: 700, color: met == null ? 'var(--tx)' : met ? 'var(--g)' : 'var(--r)' }}>{res.time}</div>
            <div className="m" style={{ color: 'var(--tx3)' }}>{res.vs_target_s != null ? `${signed(res.vs_target_s)} vs ${race.target?.under}` : '—'}</div>
          </div>
        ) : (
          <div data-tip={`${tip(defs, 'race_target') ?? ''}${p ? `\nPredicted ${elapsed(p.value_s)} (Garmin, ${shortDay(p.as_of)}).` : ''}`} tabIndex={0} style={{ background: 'var(--s2)', padding: '8px 10px' }}>
            <div className="l" style={{ fontSize: 9 }}>Target</div>
            <div className="n" style={{ fontSize: 17, fontWeight: 700 }}>{race.target ? `sub ${race.target.under}` : '—'}</div>
            <div className="m" style={{ color: p ? (p.vs_target_s != null && p.vs_target_s <= 0 ? 'var(--g)' : 'var(--y)') : 'var(--tx3)' }}>
              {p ? `predicted ${elapsed(p.value_s)}` : 'not tested yet'}
            </div>
          </div>
        )}
      </div>
      <div data-tip={`${race.windows.text}\n${tip(defs, 'race_windows') ?? ''}`} tabIndex={0} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', fontSize: 12, color: 'var(--tx2)' }}>
        {race.windows.before && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><WinSwatch w={race.windows.before.window} size={10} />{WIN[race.windows.before.window].word} {shortDay(race.windows.before.from)}{race.windows.before.days > 1 ? ` – ${shortDay(race.windows.before.to)}` : ''}</span>}
        {race.windows.recovery && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><WinSwatch w="recovery" size={10} />Recovery to {shortDay(race.windows.recovery.to)}</span>}
      </div>
      <CheckBlock race={race} state={cs} defs={defs} />
    </article>
  );
}

