/**
 * Send to watch, one state everywhere (2026-10-17, the flow review). Every button that puts workouts on
 * the watch — Today's rail and week, Plan's banner, Program's drawer, an accepted proposal — reads the
 * request book the same way:
 *   idle       nothing asked: ask the coach for a dry run (a `push` request → a push_plan)
 *   preparing  that request is running: wait — the confirm card opens by itself when it lands
 *   ready      a dry run from today is waiting, unconfirmed: reopen its card (it used to be reachable
 *              only from Coach once cancelled, while other buttons started a second dry run)
 *   sending    the confirm is running: the card shows it
 * The button never writes to Garmin; the card's own Send to watch is the athlete's confirmation.
 */
import { useState, type CSSProperties } from 'react';
import { useStore, type AppRequest } from '../lib/api';
import { isoDate, todayIso } from '../lib/fmt';

export type WatchStage = 'idle' | 'preparing' | 'ready' | 'sending';

const running = (r: AppRequest) => r.state === 'QUEUED' || r.state === 'WORKING';

export function useWatchSend() {
  const { state, ask, openSendToWatch } = useStore();
  const reqs = state?.requests ?? [];
  const today = todayIso();
  const confirms = reqs.filter((r) => r.kind === 'confirm' && r.state !== 'FAILED');
  const confirmed = new Set(confirms.map((r) => (r.params as { plan_hash?: string } | undefined)?.plan_hash));
  const plan = [...reqs].reverse().find((r) => r.state === 'DONE' && r.result?.kind === 'push_plan' && isoDate(new Date(r.createdAt)) === today);
  const ready = plan && plan.result?.kind === 'push_plan' && !confirmed.has(plan.result.payload.plan_hash) ? plan : undefined;
  const preparing = [...reqs].reverse().find((r) => r.kind === 'push' && running(r));
  const sending = confirms.some(running);
  const stage: WatchStage = sending ? 'sending' : preparing && (!ready || preparing.createdAt > ready.createdAt) ? 'preparing' : ready ? 'ready' : 'idle';
  const run = (): Promise<unknown> => {
    if (stage === 'ready') { openSendToWatch(ready!); return Promise.resolve(); }
    return ask('push', 'Send the pending changes to the watch');
  };
  const label = { idle: 'Send to watch', preparing: 'Preparing…', ready: 'Open the card', sending: 'Sending…' }[stage];
  const note = {
    idle: null,
    preparing: 'The coach is preparing a dry run — the Send-to-watch card opens when it’s ready.',
    ready: 'A dry run is waiting for your confirmation on its card.',
    sending: 'Sending to the watch — the card shows how it goes.',
  }[stage];
  return { stage, run, label, note, busy: stage === 'preparing' || stage === 'sending' };
}

/** The button: its label follows the stage; a refusal is shown, not swallowed (docs/DESIGN.md (app audit) U12). */
export function WatchSendButton({ className = 'btn', style, showNote }: { className?: string; style?: CSSProperties; showNote?: boolean }) {
  const { state } = useStore();
  const w = useWatchSend();
  const [err, setErr] = useState<string | null>(null);
  const offline = state?.coach !== 'online';
  return (
    <>
      <button type="button" className={className} style={style} disabled={offline || w.busy}
        onClick={() => { setErr(null); w.run().catch((e) => setErr(String(e.message ?? e))); }}>{w.label}</button>
      {showNote && w.note && <span role="status" style={{ fontSize: 12, color: 'var(--tx2)' }}>{w.note}</span>}
      {err && <span role="alert" style={{ fontSize: 12, color: 'var(--r)' }}>Not sent — {err}. Try again.</span>}
    </>
  );
}
