/** Today — the landing page (board Main, variants Today-NewAthlete / Today-Light / Today-Narrow / Today-Rest). */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, useView, type AppRequest, type AppState, type Defs } from '../lib/api';
import { clock, day, hm, isoDate, isoWeek, kg, nf, tip, todayIso, zone } from '../lib/fmt';
import { ErrorBox, IC, Icon, Ring, Skeleton, Spark } from '../components/ui';
import { FORM_ZONES, formZone } from '../lib/form';
import { rich } from '../lib/tip';
import { GOOD, SIGNAL, inline, recWord } from '../lib/recovery';
import { SportIcon, SportTag, kindColor } from '../components/SportIcon';
import { ZwiftWorkoutLine } from '../components/ZwiftWorkout';
import { FUEL_ICON, FuelLine, FuelPlanCard, cueHref, hm as fuelHm } from '../components/Fuel';
import { MiniHypnogram, STAGES } from '../components/Hypnogram';
import { CheckChip, RaceTile, WinSwatch } from '../components/Races';
import { WIN, checkState, checkingNow, longDay, shortDay, signed, type RaceCard } from '../lib/races';
import { plannedKey } from '../lib/calendar';
import { WatchSendButton, useWatchSend } from '../components/WatchSend';
import { LastSession } from '../components/LastSession';
import { WeekNumbers } from '../components/WeekNumbers';
import { CH, CHANGE_ORDER, counts, days as proposalDays, findProposal, proposalOf, span, standing, wd } from '../lib/proposal';

const VERB_COL: Record<string, string> = { TRAIN: 'var(--g)', REST: 'var(--v)', 'EASY CARDIO': 'var(--b)', CARDIO: 'var(--b)', MOBILITY: 'var(--tx2)' };
const TONE: Record<string, [string, string, string]> = {
  good: ['var(--gt)', 'var(--g)', IC.check], warn: ['var(--yt)', 'var(--y)', IC.warn], bad: ['var(--rt)', 'var(--r)', IC.x], neutral: ['var(--s3)', 'var(--tx2)', IC.minus],
};
const FEEL = ['Wrecked', 'Tired', 'OK', 'Good', 'Great'];

const rx = (e: any) => `${e.sets}×${e.value}${e.kind.startsWith('time') ? ' s' : ''}${e.weight != null ? ` @ ${e.machine ? '+' : ''}${kg(e.weight)} kg${e.per_hand ? ' / hand' : ''}` : ' @ BW'}`;

export default function Today() {
  const { state } = useStore();
  const { data, error, loading } = useView('today');
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <><Skeleton h={340} /><Skeleton h={190} /><Skeleton h={150} /></>;
  const t = data;
  return (
    <>
      <Hero t={t} />
      <RaceLine t={t} />
      {/* The check-in outranks the metrics, so it sits above them — it was ten cards down (UX review 2026-11-10). */}
      {!heroFeel(t, state) && !feelInRail(t, state) && <CheckIn t={t} />}
      <Overnight t={t} />
      <Rings t={t} />
      <Kpis t={t} />
      <Week t={t} />
      {/* Decisions live in the hero's right rail (board Main, 2026-10-16); the check-in sits below it. */}
      {/* Check-in beside Last session (board Main, 2026-10-23), the week after them; they wrap on narrow screens. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20 }}>
        {/* While the coach waits on how you feel, the question sits in the hero — not twice. */}
        <div style={{ flex: '1.6 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column' }}><LastSession t={t} /></div>
        {/* This week (board Week-Numbers, 2026-10-25): its own row, the full width. */}
        <div style={{ flex: '1 1 100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}><WeekNumbers t={t} /></div>
      </div>
    </>
  );
}

/** The next race, one line under today's call (board Today-Races): its mark, the days to it, today's
 * window, the target and the date check. From 8 weeks out (the countdown), or whenever today sits in a
 * window; a race ends the day as its result once recorded. Opens the race. Every word is the view's. */
function RaceLine({ t }: { t: any }) {
  const { state } = useStore();
  const { data: v } = useView<{ races: RaceCard[]; defs: Defs }>('races');
  const tr = t.race;
  if (!tr || !v?.races) return null;
  const win = tr.window?.window && tr.window.window !== 'build' ? tr.window : null;
  const race: RaceCard | undefined = v.races.find((r) => r.id === (win?.race?.id ?? tr.next?.id));
  if (!race || (!win && !tr.countdown)) return null;
  const k = win ? WIN[win.window] : null;
  const raceDay = win?.window === 'race';
  const cs = checkState(race, checkingNow(state?.requests));
  const res = race.result;
  const days = race.days_to;
  const ruleKey = win ? ({ easy: 'race_easy', taper: 'race_taper', recovery: 'race_recovery', race: 'race_day' } as Record<string, string>)[win.window] : 'race_windows';
  const winText = raceDay ? `Race day${race.start ? ` · start ${race.start}` : ''}`
    : win ? `${k!.word} day ${win.day} of ${win.of}${win.window === 'recovery' ? ` · ends ${shortDay(win.to)}` : ` · ${days} ${days === 1 ? 'day' : 'days'} to go`}`
      : `Build · no window yet${race.windows.before ? ` — ${WIN[race.windows.before.window].word.toLowerCase()} from ${shortDay(race.windows.before.from)}` : ''}`;
  return (
    <Link to={`/race/${encodeURIComponent(race.id)}`} className="rise hv" aria-label={`${race.name}: ${winText}`}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '12px 14px', borderRadius: 14, border: `${raceDay ? 2 : 1}px solid ${raceDay ? 'var(--tx)' : 'var(--ln2)'}`, background: 'var(--s1)' }}>
      <RaceTile race={race} size={40} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{race.name}{res ? ' · result' : ''}</span>
        <span className="m" style={{ color: 'var(--tx3)' }}>{shortDay(race.date)} · {race.priority} · {race.format?.division ?? race.kind_label}</span>
      </span>
      {res ? (
        <span data-tip="Finish time from the Garmin activity. Source: Garmin." className="n" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{res.time}
          {res.vs_target_s != null && <span style={{ fontSize: 13, fontWeight: 500, color: res.vs_target_s < 0 ? 'var(--g)' : 'var(--r)' }}> {signed(res.vs_target_s)}</span>}</span>
      ) : !raceDay && (
        <span data-tip={`${days} days to ${longDay(race.date)}.\n${tip(v.defs, 'race_countdown') ?? ''}`} className="n" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{days}<span style={{ fontSize: 13, color: 'var(--tx2)', fontWeight: 500 }}> {days === 1 ? 'day' : 'days'}</span></span>
      )}
      <span data-tip={`${win?.rule ?? ''}${win?.rule ? '\n' : ''}${tip(v.defs, ruleKey) ?? ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRadius: 8, fontSize: 13, fontWeight: 700,
        background: raceDay ? 'var(--tx)' : k && !k.cls ? k.bg : 'transparent', color: raceDay ? 'var(--on)' : 'var(--tx)', border: `1px solid ${k ? k.bc : 'var(--ln2)'}` }}>
        {k && !raceDay ? <WinSwatch w={win!.window} size={10} /> : !k && <span aria-hidden="true" style={{ color: 'var(--o)' }}>▲</span>}{winText}
      </span>
      {race.target && <span data-tip={tip(v.defs, 'race_target')} style={{ fontSize: 13, color: 'var(--tx2)' }}>target <b className="n" style={{ fontSize: 16, color: 'var(--tx)' }}>sub {race.target.under}</b></span>}
      {!race.past && <span style={{ marginLeft: 'auto' }}><CheckChip race={race} state={cs} defs={v.defs} /></span>}
    </Link>
  );
}

/** The daily's one line per ride or run since the last check-in (docs/DESIGN.md (rides and runs) §4). */
function EnduranceLines({ daily }: { daily: any }) {
  const lines: any[] = daily?.endurance ?? [];
  if (!lines.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 620 }}>
      {lines.map((l) => (
        <Link key={l.activity_id} to={`/workouts/${l.activity_id}`} className="hv"
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', padding: '8px 12px', borderRadius: 10, border: `1px solid ${l.flag ? 'var(--y)' : 'var(--ln)'}`, fontSize: 14 }}>
          <span className="l" style={{ color: l.flag ? 'var(--y)' : 'var(--b)', minWidth: 34 }}>{l.sport === 'bike' ? 'Ride' : 'Run'}</span>
          <span style={{ flex: '1 1 200px' }}><b>{l.title}</b> — {l.line}</span>
          {l.flag && <span className="chip" style={{ background: 'var(--yt)', color: 'var(--y)' }}>worth a look</span>}
          <Icon d={IC.arrow} size={14} />
        </Link>
      ))}
    </div>
  );
}

/** Today's fuel (docs/DESIGN.md (fuelling and score) §6.2): a line for each session planned today that the rule fuels —
 * what to take and when, in the athlete's own products, every gram from the view (scripts/fuel.py). */
function TodayFuel({ t }: { t: any }) {
  const today = todayIso();
  const plans = (t.planned ?? []).filter((p: any) => p.date === today && !p.done && p.fuel?.needed);
  if (!plans.length) return null;
  // Board Main (call="ride"): the compact fuel plan card under the call — what to pack, and when.
  return (
    <div role="group" aria-label="Fuel for today" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 680 }}>
      {plans.map((p: any) => <FuelPlanCard key={p.title} plan={p.fuel} size="compact" defs={t.defs} cueHref={cueHref(p)}
        ctx={`${p.title}${p.duration_min ? ` · ${fuelHm(p.duration_min)}` : ''}`} />)}
    </div>
  );
}

/** Today's training is done: say so, and keep the morning's call as context, not as an instruction. */
function DoneHero({ t, rec }: { t: any; rec: any }) {
  const { state, askAbout } = useStore();
  const offline = state?.coach !== 'online';
  const today = todayIso();
  const sessions: any[] = t.trained_today ?? [];
  const main = sessions.find((w) => w.kind === 'strength') ?? sessions.find((w) => w.kind === 'circuit') ?? sessions[0];
  const title = main?.title ?? t.plan_today?.name ?? 'Today’s session';
  const others = sessions.filter((w) => w !== main);
  const facts = main ? [
    main.start && `at ${main.start}`, main.durationMin && `${main.durationMin} min`,
    main.sets && (main.kind === 'circuit' ? `${main.sets} stations` : `${main.sets} sets`), main.tonnage && `${nf(main.tonnage / 1000, 1)} t`,
  ].filter(Boolean).join(' · ') : 'logged on the watch';
  return (
    <section aria-labelledby="call" className="rise" style={{ borderRadius: 20, border: '1px solid var(--ln)', background: 'radial-gradient(90% 120% at 0% 0%, var(--gt), transparent 60%), var(--s1)', boxShadow: 'var(--sh)', padding: '28px 32px 32px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px' }}>
        <span className="l" style={{ color: 'var(--tx)' }}>Today</span>
        <span className="l">{day(today)} · week {isoWeek(today)}</span>
      </div>
      <h1 id="call" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 20px' }}>
        <span className="n hero-v" style={{ fontSize: 148, lineHeight: 0.82, fontWeight: 700, letterSpacing: '-.02em', color: 'var(--g)' }}>DONE</span>
        <span className="n" style={{ fontSize: 52, lineHeight: 1, fontWeight: 600 }}>· {title.replace(' · ', ' ')}</span>
      </h1>
      <p style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>Trained {facts}.{others.length ? ` Also today: ${others.map((w) => `${w.title}${w.distanceKm ? ` ${nf(w.distanceKm, 1)} km` : ''}`).join(', ')}.` : ''}</p>
      {rec && (
        <span style={{ fontSize: 14, color: 'var(--tx2)' }}>
          This morning’s call was <b style={{ color: 'var(--tx)' }}>{rec.verb} · {rec.title}</b> — {rec.why}
        </span>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, paddingTop: 4 }}>
        {main?.id && <Link to={`/workouts/${main.id}`} className="btn" style={{ minHeight: 48, padding: '0 20px', borderRadius: 12, fontSize: 15 }}>Open the session<Icon d={IC.arrow} size={16} /></Link>}
        <button type="button" className="btn2 hv" disabled={offline} style={{ minHeight: 48, borderRadius: 12, fontSize: 15 }}
          onClick={() => askAbout(`Today’s session: ${title}`)}><Icon d={IC.chat} size={16} sw={2} />Ask about it</button>
      </div>
    </section>
  );
}

/** How long since the coach's last word. Quiet for 10 minutes: point to the terminal, where it may
 * be waiting for an answer or have stopped (docs/DESIGN.md (app audit) M7). */
function StatusAge({ since, waiting }: { since: number; waiting: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  const min = Math.floor((Date.now() - since) / 60_000);
  if (min < 10) return <span className="m" style={{ color: 'var(--tx3)' }}>last update {min < 1 ? 'just now' : `${min} min ago`}</span>;
  return (
    <span role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--y)' }}>
      <Icon d={IC.warn} size={14} sw={2.4} />
      {waiting ? `Still waiting for how you feel — ${min} min. Answer above, or in the terminal.` : `No update for ${min} min — check the terminal: the coach may be waiting for you, or may have stopped.`}
    </span>
  );
}

function Hero({ t }: { t: any }) {
  const { state, ask, askAbout } = useStore();
  const nav = useNavigate();
  const daily = t.daily;
  const offline = state?.coach !== 'online';
  const today = todayIso();
  const stale = !!daily && daily.date !== today;
  // Only TODAY's call is a call. Yesterday's stays visible, small, as context (docs/DESIGN.md (app audit) H2).
  const rec = daily && !stale ? daily.recommendation : null;
  // Under a call: the program day the CALL names. Without one: the watch calendar's day.
  const plan = rec ? t.call_program : t.plan_today?.program;
  const planKey: string | undefined = rec ? t.call_program?.key : t.plan_today?.day;
  const onWatch = plan && t.sync?.workouts?.find((w: any) => w.key === planKey)?.state === 'in_sync';
  const calendarDay = t.plan_today?.day && t.plan_today?.name;
  const differs = rec && t.call_program && t.plan_today?.day && t.plan_today.day !== t.call_program.key;
  const running = !offline && state?.status;   // the coach is running today's analysis right now
  const feelAsk = heroFeel(t, state);
  const waited = running && running.ask === 'feel' && feelAsk === 'ask';   // the coach has stopped for the answer
  if (running && !rec) {
    return (<>
      <section className="card rise" aria-live="polite" style={{ padding: '28px 32px', borderColor: 'var(--b)' }}>
        <span className="l" style={{ color: 'var(--tx)' }}>Today’s call</span>
        <span className="n" style={{ fontSize: 40, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 14 }}>
          <Icon className="spin" d={IC.spinner} size={28} />The coach is on it
        </span>
        <span style={{ fontSize: 15, color: 'var(--b)', fontWeight: 600 }}>{running.text}</span>
        <span style={{ fontSize: 14, color: 'var(--tx2)' }}>
          Started {new Date(running.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}. Every
          screen updates by itself when new data lands, and today’s call appears here when it’s ready. Numbers below are from
          the data alone.
        </span>
        {feelAsk === 'ask' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 12, borderTop: '1px solid var(--ln)' }}>
            <span style={{ fontSize: 20, fontWeight: 600 }}>How do you feel?</span>
            {waited
              ? <span role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--y)' }}><Icon d={IC.warn} size={14} sw={2.4} />The coach is waiting for your answer — here, or in the terminal.</span>
              : <span style={{ fontSize: 14, color: 'var(--tx2)' }}>Today’s call needs it, and it outranks the numbers. Answer now and the coach won’t have to stop to ask.</span>}
            <FeelPicker after="Got it — the coach has it for today’s call." />
          </div>
        )}
        {feelAsk === 'sent' && <span role="status" style={{ fontSize: 14, color: 'var(--g)' }}>Got it — the coach has it for today’s call.</span>}
        <StatusAge since={running.updated ?? running.since} waiting={!!waited} />
      </section>
      <Waiting t={t} card />
    </>);
  }
  // A lifting or circuit session (Hyrox, HIIT) makes the day DONE; a ride or run is listed beside it.
  const lifted = (t.trained_today ?? []).filter((w: any) => w.kind === 'strength' || w.kind === 'circuit');
  if (lifted.length || t.plan_today?.done) return <><DoneHero t={t} rec={rec} /><Waiting t={t} card /></>;
  if (!rec) {
    const last = stale ? daily.recommendation : null;
    return (<>
      <section className="card rise" style={{ padding: '28px 32px' }}>
        <span className="l" style={{ color: 'var(--tx)' }}>Today’s call · {day(today)}</span>
        <span className="n" style={{ fontSize: 40, fontWeight: 700 }}>No call yet today</span>
        <span style={{ fontSize: 15, color: 'var(--tx2)' }}>
          {offline ? 'The coach is offline — start a coach session to get today’s call. ' : 'The coach hasn’t run today’s analysis. '}
          Numbers below are from the data alone.
        </span>
        {(last || calendarDay) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, color: 'var(--tx2)', padding: '10px 14px', borderRadius: 12, background: 'var(--s2)', maxWidth: 620 }}>
            {last && <span>Last call, {day(daily.date)}: <b style={{ color: 'var(--tx)' }}>{last.verb} · {last.title}</b> — {last.why}</span>}
            {calendarDay && <span>On your watch for today: <b style={{ color: 'var(--tx)' }}>{t.plan_today.name}</b></span>}
          </div>
        )}
        <button type="button" className="btn" disabled={offline} style={{ alignSelf: 'flex-start', minHeight: 48 }}
          onClick={() => ask('workflow', 'Run today’s analysis', { name: 'daily' })}>Run today’s analysis</button>
      </section>
      <Waiting t={t} card />
    </>);
  }
  const col = VERB_COL[rec.verb] ?? 'var(--tx)';
  const feel = todaysFeel(t, state?.requests ?? []);
  const exercises = plan ? plan.exercises.map((e: any) => `${e.routine || e.label} ${rx(e)}`).join(' · ') : '';
  return (
    <section aria-labelledby="call" className="rise hero" style={{ position: 'relative', borderRadius: 20, border: '1px solid var(--ln)', background: `radial-gradient(90% 120% at 0% 0%, ${col === 'var(--g)' ? 'var(--gt)' : col === 'var(--b)' ? 'var(--bt)' : 'var(--vt)'}, transparent 60%), var(--s1)`, boxShadow: 'var(--sh)', padding: '28px 32px 30px', display: 'flex', flexWrap: 'wrap', gap: '28px 36px' }}>
      <div style={{ flex: '999 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px' }}>
          <span className="l" style={{ color: 'var(--tx)' }}>Today’s call</span>
          <span className="l">{day(today)} · week {isoWeek(today)}</span>
          <span data-tip={`Decided by the coach at ${clock(daily.generated_at)}${daily.data_as_of ? ` from data rebuilt at ${clock(daily.data_as_of)}` : ''}.\nSource: Coach.`} tabIndex={0} className="m"
            style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--ln2)', color: 'var(--tx2)' }}>
            coach · {clock(daily.generated_at)}
          </span>
        </div>
        <h1 id="call" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="n hero-v" style={{ fontSize: 148, lineHeight: 0.82, fontWeight: 700, letterSpacing: '-.02em', color: col }}>{rec.verb}</span>
          {/* A session name reads "· D2 Pull"; a sentence ("Rest today, your call.") stands as it is. */}
          <span className="n" style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 600, color: 'var(--tx)', maxWidth: '22ch', textWrap: 'pretty' } as CSSProperties}>
            {/[.!?]$/.test(rec.title) ? rec.title : `· ${rec.title.replace(' · ', ' ')}`}
          </span>
        </h1>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.4, maxWidth: '46ch', textWrap: 'pretty' } as CSSProperties}>{rec.why}</p>
        {rec.reasoning && <Reasoning text={rec.reasoning} />}
        {rec.cut && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--s2)', border: '1px solid var(--ln)', maxWidth: 620 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--y)', flex: 'none', marginTop: 1 }} strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d={IC.cut} /></svg>
            <span className="l" style={{ color: 'var(--y)', paddingTop: 3 }}>Cut</span>
            <span style={{ fontSize: 15, lineHeight: 1.45 }}>{rec.cut}</span>
          </div>
        )}
        <EnduranceLines daily={daily} />
        <TodayFuel t={t} />
        {differs && (
          <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, border: '1px solid var(--y)', background: 'var(--yt)', fontSize: 14, maxWidth: 620 }}>
            <Icon d={IC.watch} size={16} sw={2} style={{ color: 'var(--y)' }} />
            <span>Your watch has <b>{t.plan_today.name}</b> scheduled today; the coach’s call is <b>{t.call_program.name}</b>. Start it from the watch’s workout list, or ask the coach to reschedule.</span>
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingTop: 2 }}>
          {/* Two places, not one (docs/DESIGN.md (app audit) U6): the day's anatomy on Program, and the watch's own steps on Plan. */}
          {plan && <Link to={`/program?day=${encodeURIComponent(planKey ?? '')}#anatomy`} className="btn" style={{ minHeight: 48, padding: '0 20px', borderRadius: 12, fontSize: 15 }}
            data-tip="The session in order — each exercise, its load and the number to beat.">Open {plan.name}<Icon d={IC.arrow} size={16} /></Link>}
          {plan && <button type="button" className="btn2 hv" style={{ minHeight: 48, borderRadius: 12, fontSize: 15 }} onClick={() => nav(`/plan?watch=${encodeURIComponent(planKey ?? '')}`)}><Icon d={IC.watch} size={16} sw={2} />See it as the watch shows it</button>}
          <button type="button" className="btn2 hv" disabled={offline} style={{ minHeight: 48, borderRadius: 12, fontSize: 15 }}
            onClick={() => askAbout(`Today’s call: ${rec.verb} · ${rec.title}`)}><Icon d={IC.chat} size={16} sw={2} />Ask why</button>
          {plan ? (
            <span data-tip={`${exercises}.\nSource: Coach (program.py).`} tabIndex={0} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--tx2)' }}>
              <Icon d={onWatch ? IC.check : IC.warn} size={13} sw={2.6} style={{ color: onWatch ? 'var(--g)' : 'var(--y)' }} />
              {plan.name} · {plan.exercises.length} exercises · {onWatch ? 'on the watch' : 'not on the watch'}
            </span>
          ) : rec.verb === 'REST' && !calendarDay && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--tx2)' }}><Icon d={IC.minus} size={13} sw={2.6} style={{ color: 'var(--tx3)' }} />Rest day · nothing on the watch</span>
          )}
        </div>
      </div>
      {/* The right rail: why, then what is waiting for you, then what comes next. */}
      {/* border-box: the rule and its padding count inside the basis, so call and rail sit side by side
          wherever the hero is wider than the rail collapses (styles.css, 739 px). */}
      <div className="hero-why" style={{ flex: '1 1 320px', boxSizing: 'border-box', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="l">Why · {rec.signals.length === 3 ? 'three signals' : 'signals'}</span>
          {rec.signals.map((w: any, i: number) => {
            const [tint, c, icon] = TONE[w.tone] ?? TONE.neutral;
            return (
              <div key={i} data-tip={`${w.label}: ${w.value}\nSource: Coach.`} tabIndex={0} style={{ display: 'grid', gridTemplateColumns: '24px auto 1fr', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'var(--s2)' }}>
                <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', background: tint, color: c }}><Icon d={icon} size={12} sw={3} /></span>
                <span className="n" style={{ fontSize: 21, fontWeight: 700, whiteSpace: 'nowrap' }}>{w.value}</span>
                <span style={{ fontSize: 12, color: 'var(--tx2)', lineHeight: 1.3, textAlign: 'right' }}>{w.label}</span>
              </div>
            );
          })}
          {feel && (
            <span style={{ fontSize: 12, color: 'var(--tx3)' }}>
              You checked in {feel.feel}/5{feel.at ? ` at ${feel.at}` : ''}{feel.note ? ` — “${feel.note}”` : ''}.{' '}
              <button type="button" className="link" onClick={() => document.getElementById('checkin')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                style={{ border: 0, background: 'none', padding: 0, fontSize: 12 }}>Update</button>
            </span>
          )}
        </div>
        <Waiting t={t} />
        <NextUp t={t} />
      </div>
    </section>
  );
}

/** "The full reasoning": the call's few sentences behind its one line, opened on demand. */
function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '60ch' }}>
      {open && <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--tx2)' }}>{text}</p>}
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="link"
        style={{ alignSelf: 'flex-start', padding: 0, border: 0, background: 'none', fontWeight: 600 }}>{open ? 'Less' : 'The full reasoning'}</button>
    </div>
  );
}

/** The next session after today — on the watch, or planned off it — one click from its day on Plan. */
function NextUp({ t }: { t: any }) {
  const today = todayIso();
  const sync = new Map<string, string>((t.sync?.workouts ?? []).map((w: any) => [w.workout, w.state]));
  const next = [
    ...(t.scheduled ?? []).filter((x: any) => x.date > today && !x.done).map((x: any) => ({ ...x, watch: true, key: x.day ?? x.title })),
    ...(t.planned ?? []).filter((x: any) => x.date > today && !x.done).map((x: any) => ({ ...x, watch: false, key: plannedKey(x) })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(b.watch) - Number(a.watch)))[0];
  if (!next) return null;
  const st = next.watch ? sync.get(next.title) : null;
  const sub = next.watch ? (st === 'changed' || st === 'not_pushed' ? 'changed · not on the watch yet' : 'on the watch')
    : next.zwift_workout ? `Zwift workout: ${next.zwift_workout.name} · ${next.zwift_workout.duration_min} min` : (next.detail ?? 'planned · off the watch');
  return (
    <Link to={`/plan?watch=${encodeURIComponent(next.key)}&date=${next.date}`} className="hv" data-tip={`${day(next.date)} · ${next.title}${next.why ? `\n${next.why}` : ''}\nSource: ${next.watch ? 'your Garmin calendar' : 'the coach’s plan'}.`}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, border: '1px solid var(--ln)' }}>
      <span className="l" style={{ fontSize: 9 }}>Next</span>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: kindColor(next.badge?.kind), flex: 'none' }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{day(next.date).split(' ')[0]} · {next.title}</span>
        <span className="m" style={{ color: 'var(--tx3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
      </span>
      <Icon d="M9 6l6 6-6 6" size={14} sw={2.2} style={{ color: 'var(--tx3)', flex: 'none' }} />
    </Link>
  );
}

/** The overnight numbers belong to the last day with a readiness reading. Until this morning's
 * reading reaches Garmin, that is yesterday — say so instead of showing it under today's date. */
function Overnight({ t }: { t: any }) {
  const asOf: string | undefined = t.today?.date;
  if (!asOf || asOf === todayIso()) return null;
  return (
    <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, border: '1px dashed var(--y)', background: 'var(--yt)', fontSize: 14, color: 'var(--tx)' }}>
      <Icon d={IC.moon} size={16} sw={2} style={{ color: 'var(--y)' }} />
      <span>Recovery, sleep and the numbers below are from <b>{day(asOf)}</b> — this morning’s reading hasn’t reached Garmin yet. Sync the watch, then <b>Refresh data</b>.</span>
    </div>
  );
}

function Rings({ t }: { t: any }) {
  const n = t.night ?? {};
  const s = n.sleep ?? {};
  // The night's own minutes when the view has them: `actualH` is rounded to a tenth of an hour, and
  // 6.8 h read 6:48 beside the 6:50 the Sleep card showed for the same night (app audit 2026-11-10).
  const asleepH = t.last_night?.asleep_min != null && (!n.date || !t.last_night.date || t.last_night.date === n.date) ? t.last_night.asleep_min / 60 : s.actualH;
  // Today's strain from the week's own day (the calendar's today), not the overnight snapshot's.
  const wd = (t.week?.days ?? []).find((x: any) => x.date === todayIso());
  const strain = wd ? { value: wd.strain, load: wd.totalLoad } : null;
  // Strain is Garmin's EPOC load: lifting barely moves it (CLAUDE.md). The day's strength sits beside it.
  const lifts = (t.trained_today ?? []).filter((w: any) => w.kind === 'strength');
  const tonnage = lifts.reduce((a: number, w: any) => a + (w.tonnage ?? 0), 0);
  const sets = lifts.reduce((a: number, w: any) => a + (w.sets ?? 0), 0);
  const level = strain?.value == null ? null : strain.value >= 14 ? 'High' : strain.value >= 8 ? 'Moderate' : 'Light';
  const d: Defs = t.defs;
  const rows = [
    { label: 'Recovery', v: n.recoveryScore, u: '%', sub: 'recovery', max: 100, col: zone(n.recoveryScore), state: n.recoveryScore == null ? 'Calibrating' : `${recWord(n.recoveryScore)} · ${n.recoveryScore >= 67 ? 'ready to train' : n.recoveryScore >= 34 ? 'train, cap intensity' : 'recover first'}`,
      icon: n.recoveryScore >= 67 ? IC.check : IC.warn, tip: tip(d, 'recovery'),
      // In words (round 3): what holds the score down, or that every signal is at your usual.
      note: (() => {
        const cs: any[] = n.components ?? [];
        const off = cs.filter((c) => c.state && !GOOD.has(c.state));
        if (!cs.length) return '';
        return off.length ? `Holding it down: ${off.map((c) => `${inline(SIGNAL[c.label]?.name ?? c.label)} ${(SIGNAL[c.label]?.words[c.state] ?? c.state).toLowerCase()}`).join(', ')}.` : 'Every signal at or better than your usual.';
      })() },
    { label: 'Strain · cardio', v: strain?.value, u: '', sub: 'of 21', max: 21, col: 'var(--b)',
      state: level == null ? '—' : lifts.length ? `Cardio ${level.toLowerCase()} · lifted ${nf(tonnage / 1000, 1)} t` : `${level} · so far`,
      icon: IC.up,
      note: lifts.length ? `Garmin load ${nf(strain?.load)} today — it reads heart rate, so ${sets} sets of lifting barely move it.` : `Garmin load ${nf(strain?.load)} today.`,
      tip: `${tip(d, 'strain') ?? ''}\nIt is heart-rate (EPOC) load: lifting sits near 100 bpm and barely registers, so the day's strength is shown beside it, never inside it.` },
    { label: 'Sleep', v: s.performancePct, u: '%', sub: 'performance', max: 100, col: 'var(--v)', state: s.actualH != null ? `${hm(asleepH)} of ${hm(s.needH)}` : '—',
      icon: IC.moon, note: [s.efficiencyPct != null && `Efficiency ${s.efficiencyPct} %`, s.bedtime && `Bed ${s.bedtime} · up ${s.waketime}`].filter(Boolean).join('. '), tip: tip(d, 'sleep_performance') },
  ];
  return (
    <section aria-label="Headline scores" className="rise" style={{ animationDelay: '.08s', borderRadius: 20, border: '1px solid var(--ln)', background: 'var(--s1)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}>
      {rows.map((r) => (
        <div key={r.label} data-tip={r.tip} tabIndex={0} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, padding: '22px 22px', borderRight: '1px solid var(--ln)' }}>
          <Ring value={r.v ?? null} max={r.max} color={r.col} size={124}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span className="n" style={{ fontSize: 42, lineHeight: 0.9, fontWeight: 700 }}>{r.v == null ? '—' : nf(r.v, r.max === 21 ? 1 : 0)}<span style={{ fontSize: 22, color: 'var(--tx2)' }}>{r.v == null ? '' : r.u}</span></span>
              <span className="l" style={{ fontSize: 10, marginTop: 4 }}>{r.sub}</span>
            </div>
          </Ring>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: '1 1 150px' }}>
            <span className="l" style={{ color: 'var(--tx)' }}>{r.label}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: r.col }}><Icon d={r.icon} sw={2.6} />{r.state}</span>
            <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--tx2)' }}>{r.note}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

function Kpis({ t }: { t: any }) {
  const td = t.today ?? {};
  const sp = t.spark ?? {};
  const d: Defs = t.defs;
  const ready = (t.trends?.recovery ?? []).map((x: any) => x.readiness);
  const need = t.night?.sleep?.needH;
  const hrv = td.hrv ?? {};
  const rhr = td.rhr ?? {};
  const body = t.body;
  const v: any[] = t.vitals ?? [];
  const lastOf = (k: string) => [...v].reverse().find((x) => x[k] != null)?.[k] ?? null;
  // R2: the headline is the 7-day trend — Garmin's own 7-night HRV average (what its status compares
  // with the band) and a 7-day resting-HR mean; last night sits beside it.
  const hrv7 = lastOf('hrv_7d');
  const rhr7 = lastOf('rhr_7d');
  // No band yet: Garmin calibrates for ~3 weeks on a new watch, and OpenSportCoach never invents one.
  const hasBand = hrv.bandLow != null && hrv.bandHigh != null;
  const hrvJudged = hrv7 ?? hrv.value;
  const inBand = hasBand && hrvJudged != null && hrvJudged >= hrv.bandLow && hrvJudged <= hrv.bandHigh;
  const rhrDelta = rhr7 != null && rhr.baseline != null ? rhr7 - rhr.baseline : null;
  const n = t.last_night;
  const asleepH = n?.asleep_min != null ? n.asleep_min / 60 : td.sleep?.hours;
  const needH = n?.need_min ? n.need_min / 60 : need;
  const sleepShort = needH && asleepH != null ? needH - asleepH : null;
  const [lo, hi] = [body?.targetLow, body?.targetHigh];
  const fit = sp.fitness ?? [];
  const fitDelta = fit.length > 7 && fit.at(-1) != null && fit.at(-8) != null ? fit.at(-1) - fit.at(-8) : null;
  const fz = formZone(td.form);
  const signed = (x: number, dg = 0) => { const r = +x.toFixed(dg); return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${nf(Math.abs(r), dg)}`; };
  type Kpi = { label: string; v: string; u: string; delta: string; col: string; icon: string; foot: string; tip?: string; sub?: string; wide?: boolean; stale?: boolean; chart: JSX.Element };
  const kpis: Kpi[] = [
    { label: 'HRV · 7-day', v: nf(hrv7 ?? hrv.value), u: 'ms', sub: hrv.value != null ? `last night ${nf(hrv.value)}` : undefined,
      delta: hrvJudged == null ? 'No reading' : !hasBand ? 'Calibrating · no band yet' : inBand ? `In band ${hrv.bandLow}–${hrv.bandHigh}` : `Out of band ${hrv.bandLow}–${hrv.bandHigh}`,
      col: !hasBand ? 'var(--v)' : inBand ? 'var(--g)' : 'var(--y)', icon: !hasBand ? IC.minus : inBand ? IC.check : IC.warn,
      chart: <Spark values={v.map((x) => x.hrv)} avg={v.map((x) => x.hrv_7d)} bandLo={hasBand ? hrv.bandLow : undefined} bandHi={hasBand ? hrv.bandHigh : undefined} />,
      foot: hasBand ? '30 d · faint = nightly · band = your normal' : '30 d · Garmin needs ~3 weeks for a band',
      tip: [tip(d, 'hrv_weekly'), tip(d, 'hrv'), `HRV band: ${tip(d, 'hrv_band')?.split('\n')[0] ?? ''}`].filter(Boolean).join('\n') },
    { label: 'Resting HR · 7-day', v: nf(rhr7 ?? rhr.value, rhr7 != null ? 1 : 0), u: 'bpm', sub: rhr.value != null ? `last night ${nf(rhr.value)}` : undefined,
      delta: rhrDelta == null ? '—' : `${signed(rhrDelta, 1)} vs baseline ${nf(rhr.baseline, 1)}`, col: rhrDelta != null && rhrDelta <= 0.5 ? 'var(--g)' : 'var(--y)', icon: rhrDelta != null && rhrDelta <= 0.5 ? IC.down : IC.up,
      chart: <Spark values={v.map((x) => x.rhr)} avg={v.map((x) => x.rhr_7d)} base={rhr.baseline} color="var(--r)" />, foot: '30 d · faint = daily · dashed = 30-d baseline',
      tip: [tip(d, 'rhr_7d'), tip(d, 'rhr_baseline')?.split('\n')[0]].filter(Boolean).join('\n') },
    { label: 'Sleep · last night', v: hm(asleepH), u: 'h', sub: n?.score != null ? `score ${n.score}` : undefined, wide: !!n?.segments?.length,
      delta: sleepShort == null ? '—' : sleepShort > 0.05 ? `${hm(sleepShort)} short of ${hm(needH)} need` : 'Need met', col: sleepShort != null && sleepShort > 0.05 ? 'var(--y)' : 'var(--g)', icon: sleepShort != null && sleepShort > 0.05 ? IC.warn : IC.check,
      chart: n?.segments?.length ? <MiniHypnogram night={n} /> : <Spark values={(t.trends?.sleep ?? []).map((x: any) => x.hours)} color="var(--v)" base={need} />,
      foot: n?.segments?.length ? `${n.start} → ${n.end} · ${(['deep', 'rem', 'awake'] as const).map((k) => `${STAGES.find((st) => st.key === k)!.label.toLowerCase().replace('rem', 'REM')} ${hm((n.totals_min?.[k] ?? 0) / 60)}`).join(' · ')}` : `14 d${need ? ` · dashed = ${hm(need)} need` : ''}`,
      tip: tip(d, 'sleep_performance') },
    // The icon follows the zone, as on every other tile — it was an up arrow at any score (U7).
    { label: 'Readiness', v: nf(td.readiness?.score), u: '/100', delta: (td.readiness?.level ?? '—').toString().toLowerCase().replace(/^./, (c: string) => c.toUpperCase()), col: zone(td.readiness?.score),
      icon: td.readiness?.score == null ? IC.minus : td.readiness.score >= 67 ? IC.check : IC.warn,
      chart: <Spark values={ready} />, foot: '30 d', tip: tip(d, 'readiness') },
    { label: 'Form', v: td.form == null ? '—' : signed(td.form), u: fz?.word ?? '', sub: undefined,
      delta: fz ? fz.means : '—', col: fz?.col ?? 'var(--tx2)', icon: fz && fz.word === 'Overreaching' ? IC.warn : IC.minus,
      chart: <Spark values={sp.form ?? []} base={0} zones={FORM_ZONES.filter((z) => z.tint !== 'transparent').map((z) => ({ from: z.from, to: z.to, color: z.tint }))} color={fz?.col ?? 'var(--tx)'} />,
      foot: `fitness ${nf(td.fitness)}${fitDelta != null ? ` (${signed(fitDelta)} in 7 d)` : ''} · fatigue ${nf(td.fatigue)}`,
      tip: `${tip(d, 'form') ?? ''}\nZones: fresh +5 to +25 · neutral −10 to +5 · building −30 to −10 · overreaching below −30 · detraining above +25.\nIt reads Garmin's heart-rate load, so lifting barely moves it — strength is on the week below.` },
    { label: 'Body weight', v: body ? nf(body.latestKg, 1) : '—', u: 'kg', delta: !body ? 'No weigh-in' : lo != null && body.latestKg > hi ? `${nf(body.latestKg - hi, 1)} above ${lo}–${hi}` : lo != null && body.latestKg < lo ? `${nf(lo - body.latestKg, 1)} below ${lo}–${hi}` : lo != null ? `In range ${lo}–${hi}` : 'No target set',
      col: !body ? 'var(--tx3)' : lo != null && (body.latestKg > hi || body.latestKg < lo) ? 'var(--y)' : 'var(--g)', icon: !body ? IC.minus : lo != null && (body.latestKg > hi || body.latestKg < lo) ? IC.warn : IC.check,
      chart: <Spark values={(body?.series ?? []).map((x: any) => x.kg)} bandLo={lo} bandHi={hi} />, foot: body ? (body.daysSince ? `weighed ${body.daysSince} d ago` : 'weighed today') : '—', tip: tip(d, 'weight'), stale: body?.daysSince >= 4 },
  ];
  return (
    // Tiles wrap and grow to fill each row: a grid left three empty cells under six tiles (U20).
    <section aria-label="Key metrics, last 30 days" className="rise" style={{ animationDelay: '.14s', display: 'flex', flexWrap: 'wrap', gap: 1, borderRadius: 16, background: 'var(--ln)', border: '1px solid var(--ln)', overflow: 'hidden' }}>
      {kpis.map((k) => (
        <div key={k.label} data-tip={k.tip} tabIndex={0} className="hv" style={{ flex: k.wide ? '2 1 320px' : '1 1 160px', background: 'var(--s1)', padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, opacity: k.stale ? 0.6 : 1 }}>
          <span className="l">{k.label}</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' }}>
            <span className="n" style={{ fontSize: 36, lineHeight: 1, fontWeight: 700 }}>{k.v}</span>
            <span style={{ fontSize: 13, color: k.label === 'Form' ? k.col : 'var(--tx2)', fontWeight: k.label === 'Form' ? 700 : 400 }}>{k.u}</span>
            {k.sub && <span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)', fontSize: 10 }}>{k.sub}</span>}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: k.col }}><Icon d={k.icon} size={12} sw={2.6} />{k.delta}</span>
          {k.chart}
          <span className="m" style={{ color: 'var(--tx3)', fontSize: 10 }}>{k.foot}</span>
        </div>
      ))}
    </section>
  );
}

function Week({ t }: { t: any }) {
  const { data: cal } = useView('calendar');
  const raceDay: Record<string, any> = Object.fromEntries((cal?.race_days ?? []).map((x: any) => [x.date, x]));
  const days = t.week?.days ?? [];
  const anyWin = days.some((d: any) => raceDay[d.date]);
  const pending = t.sync?.pending ?? 0;
  const changedNames = new Set((t.sync?.workouts ?? []).filter((w: any) => w.state === 'changed' || w.state === 'not_pushed').map((w: any) => w.workout));
  const starved = Object.fromEntries((t.rotation?.days ?? []).filter((x: any) => x.starved).map((x: any) => [x.day, x]));
  const label = days.length ? `${days[0].dom}–${days[days.length - 1].dom} ${day(days[days.length - 1].date).split(' ')[2]}` : '';
  return (
    <section aria-labelledby="wk" className="rise card" style={{ animationDelay: '.2s', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 20px' }}>
        <h2 id="wk" className="l" style={{ color: 'var(--tx)' }}>This week · {label}</h2>
        {pending > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--y)' }}><Icon d={IC.warn} size={12} />{pending} {pending === 1 ? 'workout' : 'workouts'} not on the watch</span>}
        {pending > 0 && <WatchSendButton className="btn2 hv" style={{ marginLeft: 'auto', minHeight: 36 }} />}
        {anyWin && ['easy', 'taper', 'recovery', 'race'].filter((w) => days.some((d: any) => raceDay[d.date]?.window === w)).map((w) => (
          <span key={w} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tx2)' }}><WinSwatch w={w} size={11} />{WIN[w].word}</span>
        ))}
        <Link to="/plan" className="link" style={pending ? undefined : { marginLeft: 'auto' }}>Open plan</Link>
      </div>
      <div style={{ overflowX: 'auto', margin: '0 -4px', padding: '0 4px 4px' }}>
        <div style={{ minWidth: 760, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}>
          {days.map((d: any) => {
            const done = d.items?.[0];
            const sched = (t.scheduled ?? []).find((s: any) => s.date === d.date && !s.done);
            // Planned off the watch (plan.json — Zwift, the long ride): headline only on a day with
            // nothing else; otherwise a "+" line under the day's main session.
            const plans = d.isToday || d.isFuture ? (t.planned ?? []).filter((s: any) => s.date === d.date && !s.done) : [];
            const plan = !done && !sched ? plans[0] : null;
            const extra = plan ? plans.slice(1) : plans;
            const notOnWatch = sched && changedNames.has(sched.title);
            const flagDay = sched?.day && starved[sched.day];
            // The sport's own name and icon (sports.badge) — tennis reads Tennis, not "Activity" (R5).
            const badge = done?.sport ? done : sched?.badge ?? plan?.badge;
            const more = (d.items ?? []).length - 1;
            const rest = !done && !sched && !plan;
            // A card opens its session: the logged workout, or the planned one picked on Plan.
            const rd = raceDay[d.date];
            // A race day with nothing logged is the race, never a "Rest day" (app audit 2026-11-10).
            const raceOnly = rest && rd?.window === 'race';
            const wk = rd ? WIN[rd.window] : null;
            const href = done?.id ? `/workouts/${done.id}` : done ? '/workouts'
              : sched ? `/plan?watch=${encodeURIComponent(sched.day ?? sched.title)}`
                : plan ? `/plan?watch=${encodeURIComponent(plan.workout ?? `plan:${plan.date}:${plan.title}`)}` : raceOnly ? `/race/${rd.race.id}` : '/plan';
            return (
              <div key={d.date} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 2px' }}>
                  <span className="l" style={{ color: d.isToday ? 'var(--tx)' : 'var(--tx3)' }}>{d.dow}</span>
                  <span className="n" style={{ fontSize: 15, color: 'var(--tx3)' }}>{d.dom}</span>
                </div>
                <div data-tip={d.readiness == null ? 'Readiness is measured each morning — not available for future days.' : `Readiness ${d.readiness} on ${d.dow}.\nSource: Garmin.`} tabIndex={0} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 22 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--s3)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${d.readiness ?? 0}%`, background: zone(d.readiness), borderRadius: 3 }} /></div>
                  <span className="n" style={{ fontSize: 14, width: 22, textAlign: 'right', color: 'var(--tx2)' }}>{d.readiness ?? '—'}</span>
                </div>
                <Link to={href} className={`hv${wk?.cls && rd.window !== 'race' ? ` ${wk.cls}` : ''}`} style={{ minHeight: 116, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 12,
                  background: rd && rd.window !== 'race' && !wk!.cls ? wk!.bg : d.isToday ? 'var(--s2)' : rest ? 'transparent' : 'var(--bg)',
                  border: `${rd?.window === 'race' ? 2 : 1}px ${notOnWatch || (rest && !rd) ? 'dashed' : 'solid'} ${d.isToday ? 'var(--tx)' : rd ? wk!.bc : notOnWatch ? 'var(--y)' : 'var(--ln2)'}` }}>
                  {rd && <span className="l" data-tip={`${rd.race.name} · ${WIN[rd.window].word.toLowerCase()}${rd.of > 1 ? ` day ${rd.day} of ${rd.of}` : ''}.`} style={{ fontSize: 9, color: rd.window === 'race' ? 'var(--tx)' : wk!.bc }}>
                    {rd.window === 'race' ? `${rd.race.priority} · race · ${rd.race.name}` : `${WIN[rd.window].word}${rd.of > 1 ? ` ${rd.day}/${rd.of}` : ''}`}</span>}
                  {badge ? <SportTag b={badge} today={d.isToday} /> : <span className="l" style={{ fontSize: 10, color: raceOnly ? 'var(--tx)' : 'var(--tx3)' }}>{raceOnly ? 'Race' : 'Rest'}{d.isToday ? ' · today' : ''}</span>}
                  <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.15 }}>{done ? done.name : sched ? sched.title : plan ? plan.title : raceOnly ? `${rd.race.name}${rd.race.start ? ` · ${rd.race.start}` : ''}` : 'Rest day'}</span>
                  {/* The Zwift workout to open (his rule, 2026-11-05): under the planned ride, or its "+" line. */}
                  {plan?.zwift_workout && <ZwiftWorkoutLine w={plan.zwift_workout} />}
                  {plan?.fuel?.needed && <FuelLine plan={plan.fuel} defs={t.defs} compact />}
                  {extra.map((x: any) => (
                    <span key={x.title} data-tip={`${x.badge.sport} · ${x.title}${x.zwift_workout ? ` · Zwift workout: ${x.zwift_workout.name}` : ''}\nPlanned by the coach — off the watch.`} tabIndex={0} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--tx2)' }}>
                      + <SportIcon icon={x.badge.icon} size={12} /> {x.zwift_workout ? `${x.title} · ${x.zwift_workout.name}` : x.title}
                    </span>
                  ))}
                  {more > 0 && (
                    <span data-tip={rich({ t: 'Also this day', r: d.items.slice(1).map((x: any): [string, string, string] => [`${x.sport ?? x.group} · ${x.name}`, `${x.durationMin} min`, kindColor(x.kind)]) })} tabIndex={0}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--tx2)' }}>
                      + {d.items.slice(1).map((x: any) => <SportIcon key={x.id ?? x.name} icon={x.icon} size={12} style={{ color: kindColor(x.kind) }} />)} {more} more
                    </span>
                  )}
                  {done && <span className="n" style={{ fontSize: 15, color: 'var(--tx2)' }}>Load {done.load}{done.distanceKm ? ` · ${done.distanceKm} km` : ` · ${done.durationMin} min`}</span>}
                  <span style={{ marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: done ? 'var(--g)' : notOnWatch ? 'var(--y)' : sched ? 'var(--g)' : plan ? 'var(--tx2)' : 'var(--tx3)' }}>
                    <Icon d={done ? IC.check : notOnWatch ? IC.warn : sched ? IC.check : plan ? IC.clock : IC.minus} size={11} sw={2.8} />
                    {done ? 'Done' : notOnWatch ? 'Changed · not on the watch' : sched ? 'On the watch' : plan ? (plan.workout ? 'Planned · goes on the watch' : 'Planned · off the watch') : raceOnly ? (d.isFuture ? 'Race day' : d.isToday ? 'Race day · nothing logged yet' : 'Nothing logged') : d.isFuture ? 'Planned' : d.isToday ? 'Nothing logged yet' : 'Rested'}
                  </span>
                </Link>
                {flagDay && (
                  <div style={{ display: 'flex', gap: 6, padding: 8, borderRadius: 8, background: 'var(--ot)', color: 'var(--o)', fontSize: 11, fontWeight: 600, lineHeight: 1.3 }}>
                    <Icon d={IC.flag} size={12} style={{ marginTop: 1 }} />{flagDay.label} — {flagDay.age ?? '∞'} days since last trained
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** How do you feel, 1–5, and a note: sent as a check-in. The coach weighs it above the metrics. */
function FeelPicker({ initial, after, compact }: { initial?: number | null; after: string; compact?: boolean }) {
  const { state, ask } = useStore();
  const offline = state?.coach !== 'online';
  const [feel, setFeel] = useState<number | null>(initial ?? null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const send = () => {
    if (!feel) return;
    setErr(null);
    ask('checkin', `Feeling ${feel}/5 — ${FEEL[feel - 1]}${note ? `: ${note}` : ''}`, { feel, ...(note ? { note } : {}) })
      .then(() => setSent(after)).catch((e) => setErr(String(e.message ?? e)));
  };
  if (sent) return <span role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--g)' }}><Icon d={IC.check} size={14} sw={3} />{sent}</span>;
  // Compact: the rail's width (Waiting for you) — smaller tiles, the same five and the same note.
  const h = compact ? 44 : 64;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 10, ...(compact ? { flex: '1 1 100%', minWidth: 0 } : {}) }}>
      <div role="radiogroup" aria-label="How do you feel, 1 to 5" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: compact ? 4 : 6 }}>
        {FEEL.map((label, i) => {
          const on = feel === i + 1;
          return (
            <button key={label} type="button" role="radio" aria-checked={on} disabled={offline} onClick={() => setFeel(i + 1)}
              style={{ minHeight: h, minWidth: 0, padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: compact ? 9 : 12, border: `1px solid ${on ? 'var(--tx)' : 'var(--ln2)'}`, background: on ? 'var(--tx)' : 'transparent', color: on ? 'var(--on)' : 'var(--tx)' }}>
              <span className="n" style={{ fontSize: compact ? 18 : 26, lineHeight: 1, fontWeight: 700 }}>{i + 1}</span>
              <span style={{ fontSize: compact ? 9 : 11, fontWeight: 600 }}>{label}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: compact ? 6 : 8 }}>
        <input aria-label="Note for the coach (optional)" type="text" disabled={offline} value={note} onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder={compact ? 'Add a note (optional)' : 'Anything the numbers can’t see — sleep, soreness, stress (optional)'}
          style={{ flex: 1, minWidth: 0, minHeight: compact ? 34 : 44, boxSizing: 'border-box', padding: '0 12px', borderRadius: compact ? 9 : 10, border: '1px solid var(--ln2)', background: 'var(--bg)', color: 'var(--tx)', fontSize: compact ? 12 : 14 }} />
        <button type="button" className="btn" disabled={offline || !feel} onClick={send} style={compact ? { ...act(true), minHeight: 34 } : { minHeight: 44 }}>Send</button>
      </div>
      {err && <span role="alert" style={{ fontSize: 12, color: 'var(--r)' }}>{err}</span>}
    </div>
  );
}

/** Today's answer to "how do you feel?": from today's daily, or a check-in sent today (the newer). */
function todaysFeel(t: any, requests: AppRequest[]): { feel: number; note?: string | null; at?: string; pending: boolean } | null {
  const today = todayIso();
  const sent = [...requests].reverse().find((r) => r.kind === 'checkin' && r.state !== 'FAILED' && isoDate(new Date(r.createdAt)) === today);
  const daily = t.daily?.date === today && t.daily?.feel?.answer ? t.daily : null;
  const sentAt = sent ? sent.createdAt : -1;
  const dailyAt = daily?.generated_at ? Date.parse(daily.generated_at) : -1;
  if (sent && sentAt >= dailyAt) {
    return { feel: Number(sent.params?.feel), note: (sent.params?.note as string) ?? null, at: new Date(sent.createdAt).toTimeString().slice(0, 5), pending: sent.state !== 'DONE' };
  }
  if (daily) return { feel: daily.feel.answer, note: daily.feel.note, at: clock(daily.generated_at), pending: false };
  return null;
}

/** How do you feel, while the coach runs today's analysis: the hero asks it whenever today has no
 * answer yet — not only once the coach says it waits (`ask: "feel"`). A coach that asked in the
 * terminal alone left the page spinning, the picker ten cards down (2026-11-22). 'ask': the hero
 * shows the picker · 'sent': a check-in went since the analysis started, or the coach asked and moved
 * on (answered in the terminal) · null: the Check-in card. */
function heroFeel(t: any, state: AppState | null | undefined): 'ask' | 'sent' | null {
  const status = state?.coach === 'online' ? state.status : null;
  if (!status || (t.daily?.date === todayIso() && t.daily?.recommendation)) return null;
  const requests = state?.requests ?? [];
  if (status.answered || requests.some((r) => r.kind === 'checkin' && r.state !== 'FAILED' && r.createdAt >= status.since)) return 'sent';
  return status.ask === 'feel' || !todaysFeel(t, requests) ? 'ask' : null;
}

/** Not answered today, and the hero isn't asking: "Waiting for you" asks it, and the Check-in card
 * steps aside. Offline nothing can be sent, so the card stays, read-only. */
function feelInRail(t: any, state: AppState | null | undefined): boolean {
  return state?.coach === 'online' && !heroFeel(t, state) && !todaysFeel(t, state?.requests ?? []);
}

/** Asked once a day (R3 round 3, 2026-10-11): once answered — on this page, in the terminal, or in
 * the coach's daily — the card shows the answer, and changing it is one click away. */
function CheckIn({ t }: { t: any }) {
  const { state } = useStore();
  const offline = state?.coach !== 'online';
  const answer = todaysFeel(t, state?.requests ?? []);
  const [changing, setChanging] = useState(false);
  const latest = `${answer?.feel}-${answer?.at}`;
  useEffect(() => setChanging(false), [latest]);   // a new answer arrived: show it
  return (
    <section id="checkin" aria-labelledby="ci" className="card" style={{ scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 id="ci" className="l" style={{ color: 'var(--tx)' }}>Check-in</h2>
        <span className="l" style={{ fontSize: 10 }}>Weighed above the metrics</span>
      </div>
      {answer && !changing ? (<>
        <span style={{ fontSize: 15, color: 'var(--tx2)' }}>Today you told the coach</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="n" aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--tx)', color: 'var(--on)', fontSize: 30, fontWeight: 700 }}>{answer.feel}</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 22, fontWeight: 700 }}>{FEEL[answer.feel - 1] ?? '—'}<span style={{ fontSize: 14, color: 'var(--tx3)', fontWeight: 500 }}> · {answer.feel}/5</span></span>
            {answer.note && <span style={{ fontSize: 13, color: 'var(--tx2)' }}>“{answer.note}”</span>}
          </span>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--tx3)' }}>
          {answer.pending ? 'Sent — the coach is re-weighing today’s call.' : `Recorded${answer.at ? ` at ${answer.at}` : ''}.`}
          <button type="button" className="link" disabled={offline} onClick={() => setChanging(true)} style={{ border: 0, background: 'none', padding: 0, fontSize: 12 }}>Feeling different? Update it</button>
        </span>
      </>) : (<>
        <span style={{ fontSize: 20, fontWeight: 600 }}>How do you feel?</span>
        <FeelPicker initial={answer?.feel ?? null} after={`Sent at ${new Date().toTimeString().slice(0, 5)} · the coach re-weighs today’s call.`} />
        <span style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--tx3)' }}>
          {offline ? 'Coach offline — check-in is read-only.' : 'The coach reads this before the numbers.'}
          {changing && <button type="button" className="link" onClick={() => setChanging(false)} style={{ border: 0, background: 'none', padding: 0, fontSize: 12 }}>Keep {answer?.feel}/5</button>}
        </span>
      </>)}
    </section>
  );
}

/** What a request did to a pending item, in words: the label, and where it is with the coach. */
function answered(r: AppRequest): { label: string; where: string } {
  const label = r.kind === 'accept' ? 'Accepted' : r.kind === 'push' ? 'Asked for a dry run'
    : r.text.startsWith('Not yet:') ? 'Held — the coach asks again next session' : `Answered: ${r.text.split(' — ').at(-1)}`;
  const where = r.state === 'QUEUED' ? 'sent to the coach' : r.state === 'WORKING' ? 'the coach is on it' : 'the coach has it';
  return { label, where };
}

/** One item waiting for the athlete, as the rail draws it: an icon, its kind, a line, the detail, the actions. */
interface Item { id: string; order: number; kind: string; c: string; bg: string; i: string; t: ReactNode; sub?: ReactNode; tip?: string; acts?: ReactNode; status?: ReactNode; error?: ReactNode; open: boolean }

const Q_ICON = 'M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V15M12 18h.01';
const LIST_ICON = 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01';
const act = (primary?: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', minHeight: 34, padding: '0 12px', borderRadius: 9, fontSize: 12, fontWeight: 700,
  border: `1px solid ${primary ? 'var(--tx)' : 'var(--ln2)'}`, background: primary ? 'var(--tx)' : 'transparent', color: primary ? 'var(--on)' : 'var(--tx)' });

/**
 * Waiting for you (board Main, 2026-10-16): every decision in the hero's right rail, never below the
 * fold — the daily's open items (a bump, the coach's question, a workout not on the watch), and a plan
 * proposal waiting for review. Most urgent first, three shown, the rest one click away.
 *
 * An item's answer is the request that answered it — found in the request book, which survives a reload
 * and the next session — so an answered item stays answered (docs/DESIGN.md (app audit) R1). A refused or failed
 * answer is shown as the error it is, with the buttons back. Accepting never sends to the watch.
 */
function Waiting({ t, card }: { t: any; card?: boolean }) {
  const { state, ask, askAbout, fuel } = useStore();
  const offline = state?.coach !== 'online';
  const [err, setErr] = useState<Record<string, string>>({});
  const [all, setAll] = useState(false);
  const [fuelSaid, setFuelSaid] = useState<Record<string, { ok: boolean; text: string; busy?: boolean }>>({});
  const daily = t.daily;
  const requests = state?.requests ?? [];
  const pending: any[] = daily?.pending ?? (t.bumps ?? []).map((b: any, i: number) => ({
    id: `b${i}`, kind: 'bump', text: `${b.label} on ${b.date}: ${b.sets_done} sets, all ≥ ${b.reps_target} reps`, bump: { exercise: b.name.replace(/_/g, ' ').toLowerCase(), from: b.weight, to: null, evidence_dates: [b.earned_on] },
  }));
  // Requests sent since this daily was written answer its items (a pending id like "q1" is only
  // unique within one daily). Not "the same day": a daily from yesterday is still open today.
  const since = daily?.generated_at ? Date.parse(daily.generated_at) : NaN;
  const sameDay = (r: AppRequest) => Number.isFinite(since) && r.createdAt >= since;
  const answerOf = (p: any): AppRequest | undefined => p.kind === 'unsynced' ? undefined
    : [...requests].reverse().find((r) => r.state !== 'FAILED' && sameDay(r) && r.params?.pending_id === p.id);
  const failedOf = (p: any): AppRequest | undefined => {
    if (p.kind === 'unsynced') return undefined;
    const last = [...requests].reverse().find((r) => sameDay(r) && r.params?.pending_id === p.id);
    return last?.state === 'FAILED' ? last : undefined;
  };
  // The watch item is open while the watch lacks something; its button follows the shared watch state.
  const watch = useWatchSend();
  const watchItem = (id: string, text: string): Item => ({ id, order: 3, kind: 'Not on the watch', c: 'var(--y)', bg: 'var(--yt)', i: IC.warn, open: true, t: text,
    tip: 'Sync state of the workouts OpenSportCoach builds, from your Garmin account.', sub: watch.stage === 'ready' ? watch.note : undefined,
    status: watch.busy ? <Done msg={watch.note!} pending /> : null, acts: <WatchSendButton className="" style={act(true)} /> });
  const decide = (id: string, kind: string, text: string, params?: Record<string, unknown>) => {
    setErr((e) => ({ ...e, [id]: '' }));
    ask(kind, text, params).catch((e) => setErr((x) => ({ ...x, [id]: String(e.message ?? e) })));
  };
  const errorOf = (id: string, failed?: AppRequest) => {
    const bad = err[id] || failed?.error;
    return bad ? <span role="alert" style={{ fontSize: 12, color: 'var(--r)' }}>Not sent — {bad}. Try again.</span> : null;
  };
  // The watch, from the watch: the daily's "not on the watch" item only while something still isn't.
  const unsyncedNow = (t.sync?.workouts ?? []).filter((w: any) => w.state === 'changed' || w.state === 'not_pushed');
  const watchOpen = unsyncedNow.length > 0 || !!t.sync?.unknown;
  const items: Item[] = [];
  for (const p of pending) {
    if (p.kind === 'unsynced') { if (watchOpen) items.push(watchItem(p.id, p.text)); continue; }
    const a = answerOf(p);
    const w = a ? answered(a) : null;
    const status = a ? <Done msg={`${w!.label}${a.kind === 'accept' ? ' — nothing reaches the watch until you confirm it' : ''} · ${w!.where}`} pending={a.state !== 'DONE'} /> : null;
    const error = a ? null : errorOf(p.id, failedOf(p));
    if (p.kind === 'bump') items.push({ id: p.id, order: 0, kind: 'Progression', c: 'var(--g)', bg: 'var(--gt)', i: IC.up, open: !a, status, error, tip: tip(t.defs, 'bump'),
      t: p.bump ? <span style={{ textTransform: 'capitalize' }}>{p.bump.exercise} {kg(p.bump.from)}{p.bump.to != null && <> → {kg(p.bump.to)} kg</>}</span> : p.text,
      sub: p.bump?.evidence_dates?.length ? `${p.text.includes(' — ') ? `${p.text.split(' — ').slice(1).join(' — ')} · ` : ''}earned ${p.bump.evidence_dates.map((x: string) => day(x)).join(', ')}` : p.text,
      acts: <>
        <button type="button" disabled={offline} style={act(true)} onClick={() => decide(p.id, 'accept', `Accept: ${p.text}`, { pending_id: p.id })}>Accept</button>
        <button type="button" className="hv" disabled={offline} style={act()} onClick={() => decide(p.id, 'question', `Not yet: ${p.text}`, { pending_id: p.id })}>Not yet</button>
      </> });
    if (p.kind === 'question') items.push({ id: p.id, order: 2, kind: 'Question from the coach', c: 'var(--b)', bg: 'var(--bt)', i: Q_ICON, open: !a, status, error, t: p.text,
      acts: <>
        {(p.options ?? []).map((o: string) => <button key={o} type="button" className="hv" disabled={offline} style={act()} onClick={() => decide(p.id, 'question', `${p.text} — ${o}`, { pending_id: p.id })}>{o}</button>)}
        <button type="button" className="hv" disabled={offline} style={act()} onClick={() => askAbout(p.text)}>Reply…</button>
      </> });
  }
  // Something isn't on the watch and the daily didn't say so (it was written before the change).
  if (unsyncedNow.length && !items.some((x) => x.kind === 'Not on the watch')) {
    items.push(watchItem('sync', `${unsyncedNow.map((w: any) => w.workout).join(', ')} ${unsyncedNow.length === 1 ? 'is' : 'are'} not on the watch yet`));
  }
  // A plan proposal waiting for review (or out of date, or being rewritten): its own page decides it.
  const pr = findProposal(requests);
  const prop = pr && proposalOf(pr);
  const ps = pr && standing(pr, requests, t.freshness?.data_as_of);
  if (prop && ps && (ps.stage === 'waiting' || ps.stage === 'stale' || ps.stage === 'requested' || ps.stage === 'applying')) {
    const ds = proposalDays(prop);
    const n = counts(ds);
    const checks = prop.checks ?? [];
    const rules = checks.length ? (checks.some((c) => c.status === 'broken') ? ' · rules ✕' : checks.some((c) => c.status === 'near_limit') ? ' · rules !' : ' · rules ✓') : '';
    const href = `/plan/proposal/${encodeURIComponent(prop.id)}`;
    const waiting = ps.stage === 'waiting';
    items.push({ id: 'proposal', order: 1, kind: `Plan proposal · week of ${wd(span(ds).first)}`, c: 'var(--v)', bg: 'var(--vt)', i: LIST_ICON,
      t: prop.headline ?? prop.title ?? 'Plan proposal', tip: `Coach proposal${prop.version ? ` ${prop.version.n} of ${prop.version.of}` : ''}, ${new Date(pr.finishedAt ?? pr.createdAt).toTimeString().slice(0, 5)}. Source: coach.`,
      sub: ps.stage === 'stale' ? 'Out of date — your data moved on; review it to have the coach re-check.' : `${CHANGE_ORDER.filter((c) => c !== 'unchanged' && n[c]).map((c) => `${CH[c].i} ${n[c]} ${CH[c].word.toLowerCase()}`).join(' · ')}${rules}`,
      open: waiting || ps.stage === 'stale', error: errorOf('proposal'),
      status: ps.stage === 'requested' ? <Done msg="Changes asked — the coach is writing a new version" pending /> : ps.stage === 'applying' ? <Done msg="Accepted — the coach is applying it" pending /> : null,
      acts: <>
        <Link to={href} style={act(true)}>Review</Link>
        {waiting && <button type="button" className="hv" disabled={offline} style={act()} onClick={() => decide('proposal', 'accept', `Accept plan ${prop.id}`, { proposal: prop.id })}>Accept as is</button>}
      </> });
  }
  // How do you feel, unanswered today: a decision like the rest, so the rail never says "Nothing to
  // decide" while the check-in waits below the fold (2026-11-22). First — it outranks the numbers.
  // Answered from here, it stays answered, as every item does; the Check-in card below shows it too.
  const feelCheckin = [...requests].reverse().find((r) => r.kind === 'checkin' && r.state !== 'FAILED' && isoDate(new Date(r.createdAt)) === todayIso()
    && (!Number.isFinite(since) || r.createdAt >= since));
  if (feelInRail(t, state)) {
    items.push({ id: 'feel', order: -2, kind: 'Check-in', c: 'var(--b)', bg: 'var(--bt)', i: IC.heart, open: true, t: 'How do you feel?',
      sub: daily?.date === todayIso() && daily.recommendation ? 'Today’s call was made without it — your answer re-weighs it.' : 'The coach reads this before the numbers.',
      acts: <FeelPicker compact after="Sent — the coach re-weighs today’s call." /> });
  } else if (feelCheckin && !heroFeel(t, state)) {
    const n = Number(feelCheckin.params?.feel);
    items.push({ id: 'feel', order: -2, kind: 'Check-in', c: 'var(--b)', bg: 'var(--bt)', i: IC.heart, open: false, t: 'How do you feel?',
      status: <Done msg={`You told the coach ${n}/5 · ${FEEL[n - 1] ?? '—'}${feelCheckin.state !== 'DONE' ? ' · it’s re-weighing today’s call' : ''}`} pending={feelCheckin.state !== 'DONE'} /> });
  }
  // Fuel (docs/DESIGN.md (fuelling and score) §6.2): the setup still open — asked the first time a session was bound,
  // answerable here — and the rides and runs of the last week that ask what was taken. Written by the
  // server's fuel action (scripts/fuel.py, no model), so they work with the coach offline too.
  const fuelT = t.fuel ?? {};
  const openQs: any[] = fuelT.setup_open ?? [];
  if (openQs.length) {
    // First, until it's done: his rule (2026-11-06) is that an unfinished setup is asked for at once.
    items.push({ id: 'fuel-setup', order: -1, kind: 'Fuel setup', c: 'var(--o)', bg: 'var(--ot)', i: FUEL_ICON, open: true,
      t: `Finish your fuel setup · ${openQs.length} ${openQs.length === 1 ? 'question' : 'questions'}`,
      sub: 'Your gels and drink mixes, how you mix a bottle, what your gut takes, caffeine. Until then fuel plans are in grams only.',
      acts: <Link to="/fuel/setup" style={act(true)}>Answer</Link> });
  }
  for (const a of (fuelT.due ?? []) as any[]) {
    const id = `fuel-${a.id}`;
    const said = fuelSaid[id];
    items.push({ id, order: 2.5, kind: 'Log your fuel', c: 'var(--o)', bg: 'var(--ot)', i: FUEL_ICON, open: !said?.ok,
      t: `${a.title} · ${day(a.date)} · ${a.minutes} min`, sub: 'What did you take? It is how your gut training moves on.',
      status: said?.ok || said?.busy ? <Done msg={said.text} pending={said.busy} /> : null,
      error: said && !said.ok && !said.busy ? <span role="alert" style={{ fontSize: 12, color: 'var(--r)' }}>{said.text}</span> : null,
      acts: <>
        <Link to={`/workouts/${a.id}#fuel`} style={act(true)}>Log it</Link>
        <button type="button" className="hv" style={act()} onClick={() => {
          setFuelSaid((x) => ({ ...x, [id]: { ok: false, busy: true, text: 'Saving…' } }));
          fuel('log', { activity_id: a.id, items: [], nothing: true })
            .then(() => setFuelSaid((x) => ({ ...x, [id]: { ok: true, text: 'Logged: nothing taken' } })))
            .catch((e) => setFuelSaid((x) => ({ ...x, [id]: { ok: false, text: `Not saved — ${String(e.message ?? e)}` } })));
        }}>I took nothing</button>
      </> });
  }
  // Most urgent first: open before answered, then the check-in · fuel setup · bump · proposal · question · fuel log · watch.
  items.sort((x, y) => Number(y.open) - Number(x.open) || x.order - y.order);
  const open = items.filter((x) => x.open).length;
  const shown = all ? items : items.slice(0, 3);
  const accepted = prop && ps?.stage === 'accepted';
  const inSync = !t.sync?.unknown && !unsyncedNow.length;
  if (card && !items.length) return null;
  const body = (
    <section aria-labelledby="pd" style={{ display: 'flex', flexDirection: 'column', gap: 8, ...(card ? {} : { paddingTop: 16, borderTop: '1px solid var(--ln)' }) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 id="pd" className="l" style={{ color: 'var(--tx)' }}>Waiting for you</h2>
        {open > 0 && <span className="n" aria-label={`${open} ${open === 1 ? 'decision' : 'decisions'} waiting`}
          style={{ minWidth: 22, height: 22, padding: '0 7px', boxSizing: 'border-box', borderRadius: 999, display: 'grid', placeItems: 'center', background: 'var(--tx)', color: 'var(--on)', fontSize: 14, fontWeight: 700 }}>{open}</span>}
        {items.length > 1 && <span className="m" style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>most urgent first</span>}
      </div>
      {shown.map((x) => (
        <div key={x.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '11px 12px', borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--ln2)', opacity: x.open ? 1 : 0.75 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span aria-hidden="true" style={{ flex: 'none', width: 26, height: 26, borderRadius: 7, display: 'grid', placeItems: 'center', background: x.bg, color: x.c }}><Icon d={x.i} size={13} sw={2.6} /></span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
              <span className="l" style={{ fontSize: 9, color: x.c }}>{x.kind}</span>
              <span data-tip={x.tip} tabIndex={x.tip ? 0 : undefined} style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>{x.t}</span>
              {x.sub && <span style={{ fontSize: 12, color: 'var(--tx2)', lineHeight: 1.35 }}>{x.sub}</span>}
            </span>
          </div>
          {x.status ? <span style={{ paddingLeft: 36 }}>{x.status}</span> : x.acts && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 36 }}>{x.acts}</div>}
          {x.error && <span style={{ paddingLeft: 36 }}>{x.error}</span>}
        </div>
      ))}
      {items.length > 3 && (
        <button type="button" className="link" onClick={() => setAll(!all)} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0 }}>
          {all ? 'Show the first three' : `+ ${items.length - 3} more`}
        </button>
      )}
      {!items.length && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px dashed var(--ln2)' }}>
          <Icon d={IC.check} size={16} sw={2.6} style={{ color: 'var(--g)' }} />
          <span style={{ fontSize: 14 }}><b>Nothing to decide.</b> <span style={{ color: 'var(--tx2)' }}>{accepted ? 'Plan accepted' : 'No plan waiting'}, {inSync ? 'watch in sync' : 'watch status unknown'}.</span></span>
        </div>
      )}
    </section>
  );
  return card ? <div className="card rise" style={{ gap: 8 }}>{body}</div> : body;
}

const Done = ({ msg, pending }: { msg: string; pending?: boolean }) => (
  <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: pending ? 'var(--tx2)' : 'var(--g)' }}>
    <Icon className={pending ? 'spin' : undefined} d={pending ? IC.spinner : IC.check} sw={2.6} />{msg}
  </span>
);
