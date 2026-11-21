/**
 * The Send-to-watch confirmation (board SendToWatch): confirm → sending → verified / failed.
 * Opens over any screen from a published push_plan. The click is the athlete's confirmation: the
 * server records it for that plan hash and tells the coach session; the confirm gate hook refuses any
 * Garmin write without it. Esc closes the card in the confirm state only.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore, type AppRequest } from '../lib/api';
import { day } from '../lib/fmt';
import { IC, Icon } from './ui';

const VERB: Record<string, { i: string; k: string; c: string; bg: string }> = {
  upload: { i: '+', k: 'New on the watch', c: 'var(--g)', bg: 'var(--gt)' },
  replace: { i: '↻', k: 'Replaced · old copy removed', c: 'var(--b)', bg: 'var(--bt)' },
  move: { i: '→', k: 'Calendar move', c: 'var(--v)', bg: 'var(--vt)' },
  schedule: { i: '+', k: 'Scheduled', c: 'var(--v)', bg: 'var(--vt)' },
  unschedule: { i: '−', k: 'Unscheduled', c: 'var(--y)', bg: 'var(--yt)' },
};

function describe(a: any): string {
  if (a.verb === 'move') return `${a.from ? day(a.from) : '—'} → ${a.to ? day(a.to) : '—'}`;
  // Only a replacement re-points existing calendar entries; a new workout is simply scheduled.
  if (a.dates?.length) return `On the calendar ${a.dates.map((d: string) => day(d)).join(', ')}${a.verb === 'replace' ? ' — re-pointed to the new copy' : ''}`;
  return a.verb === 'upload' ? 'Not on the watch yet' : 'Content changed since the last push';
}

export function SendToWatch() {
  const { state, sendToWatch, openSendToWatch, confirm, ask } = useStore();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [started, setStarted] = useState<number | null>(null);
  const [, tick] = useState(0);
  const sendBtn = useRef<HTMLButtonElement>(null);

  const req: AppRequest | undefined = confirmId ? state?.requests.find((r) => r.id === confirmId) : undefined;
  const result = req?.result?.kind === 'push_result' ? req.result.payload : null;
  const phase = !confirmId ? 'confirm' : req && (req.state === 'DONE' || req.state === 'FAILED') ? (result?.ok && req.state === 'DONE' ? 'verified' : 'failed') : 'sending';

  useEffect(() => { if (sendToWatch) { setConfirmId(null); setErr(null); setStarted(null); setTimeout(() => sendBtn.current?.focus(), 0); } }, [sendToWatch]);
  useEffect(() => {
    if (phase !== 'sending') return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase === 'confirm') openSendToWatch(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, openSendToWatch]);

  if (!sendToWatch) return null;
  const plan = sendToWatch.plan;
  const changes = (plan.actions ?? []).filter((a: any) => a.verb !== 'in_sync');
  const close = () => openSendToWatch(null);
  const elapsed = started ? Math.round((Date.now() - started) / 1000) : 0;
  const offline = state?.coach !== 'online';

  const card = { borderRadius: 20, background: 'var(--s1)', boxShadow: 'var(--sh)', padding: 22, display: 'flex', flexDirection: 'column' as const, gap: 16, width: 'min(440px, 100%)', boxSizing: 'border-box' as const };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.55)', display: 'grid', placeItems: 'center', padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget && phase === 'confirm') close(); }}>
      {phase === 'confirm' && (
        <section role="dialog" aria-modal="true" aria-labelledby="stw" style={{ ...card, border: '1px solid var(--ln2)' }}>
          <h2 id="stw" className="n" style={{ fontSize: 28, fontWeight: 700 }}>Send to watch</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--idt)', border: '1px solid var(--id)' }}>
            <span className="n" aria-hidden="true" style={{ width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--id)', color: 'var(--on)', fontSize: 17, fontWeight: 700 }}>{(plan.display ?? plan.athlete ?? '?')[0]}</span>
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span style={{ fontWeight: 700 }}>{plan.display ?? plan.athlete}</span>
              <span style={{ fontSize: 12, color: 'var(--tx2)' }}>Garmin account <b style={{ color: 'var(--tx)' }}>{plan.garmin_account}</b></span>
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="l" style={{ fontSize: 10 }}>Changes on the watch · {changes.length}</span>
            {changes.map((a: any, i: number) => {
              const v = VERB[a.verb] ?? VERB.replace;
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '26px 1fr', gap: 10, padding: 10, borderRadius: 10, background: 'var(--s2)' }}>
                  <span aria-hidden="true" className="n" style={{ width: 26, height: 26, borderRadius: 7, display: 'grid', placeItems: 'center', background: v.bg, color: v.c, fontSize: 16, fontWeight: 700 }}>{v.i}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="l" style={{ fontSize: 9, color: v.c }}>{v.k}</span>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{a.workout}</span>
                    <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{describe(a)}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.45, color: 'var(--tx2)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flex: 'none', color: 'var(--g)' }}><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /><path d="M9 12l2 2 4-4" /></svg>
            <span>Nothing else in the account is touched. Protected workouts{plan.protected != null ? ` (${plan.protected})` : ''} are never modified.</span>
          </div>
          <span className="m" style={{ color: 'var(--tx3)' }}>plan {plan.plan_hash}</span>
          {err && <span role="alert" style={{ fontSize: 13, color: 'var(--r)' }}>{err}</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button ref={sendBtn} type="button" className="btn" disabled={offline} style={{ flex: 1, minHeight: 48, borderRadius: 12, fontSize: 15 }}
              onClick={() => {
                setErr(null);
                confirm(plan.plan_hash).then((r) => { setConfirmId(r.id); setStarted(Date.now()); }).catch((e) => setErr(String(e.message ?? e)));
              }}>Send to watch</button>
            <button type="button" className="btn2" style={{ minHeight: 48, borderRadius: 12, fontSize: 14 }} onClick={close}>Cancel</button>
          </div>
        </section>
      )}
      {phase === 'sending' && (
        <section role="dialog" aria-modal="true" aria-label="Sending" style={{ ...card, border: '1px solid var(--b)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon className="spin" d={IC.spinner} size={22} sw={2.6} style={{ color: 'var(--b)' }} />
            <h2 className="n" style={{ fontSize: 28, fontWeight: 700 }}>Sending to {plan.garmin_account}</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-live="polite">
            {(req?.progress.length ? req.progress : ['Waiting for the coach']).map((p, i, all) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: i === all.length - 1 ? 'var(--tx)' : 'var(--tx2)' }}>
                <span aria-hidden="true">{i === all.length - 1 ? '→' : '✓'}</span>{p}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--tx3)' }}>
            <span>Usually 1–3 minutes</span><span className="n" style={{ fontSize: 15, color: 'var(--tx2)' }}>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--tx3)' }}>You can close this and keep browsing. The coach dock shows progress.</span>
          <button type="button" className="btn2" onClick={close}>Close · keep sending</button>
        </section>
      )}
      {phase === 'verified' && result && (
        <section role="dialog" aria-modal="true" aria-label="Verified" style={{ ...card, border: '1px solid var(--g)', gap: 14 }}>
          <div aria-hidden="true" style={{ width: 56, height: 56, borderRadius: '50%', border: '2px solid var(--g)', display: 'grid', placeItems: 'center', color: 'var(--g)' }}><Icon d={IC.check} size={26} sw={2.6} /></div>
          <h2 className="n" style={{ fontSize: 32, fontWeight: 700 }}>Watch in sync ✓</h2>
          <span style={{ fontSize: 14, color: 'var(--tx2)' }}>{result.message}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            {result.actions.map((a: any, i: number) => <span key={i}>✓ {a.workout}{a.date ? ` · ${day(a.date)}` : ''} {a.verb === 'replace' ? 'replaced · old copy removed' : a.verb}</span>)}
          </div>
          <span style={{ fontSize: 12, color: 'var(--tx3)' }}>They appear on the watch at its next sync.</span>
          <button type="button" className="btn" style={{ minHeight: 44, borderRadius: 12 }} onClick={close}>Done</button>
        </section>
      )}
      {phase === 'failed' && (
        <section role="dialog" aria-modal="true" aria-label="Failed" style={{ ...card, border: '1px solid var(--r)', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--r)' }}>
            <Icon d={IC.warn} size={22} sw={2.4} />
            <h2 className="n" style={{ fontSize: 28, fontWeight: 700, color: 'var(--tx)' }}>
              {result ? (() => { const n = result.actions.filter((a: any) => a.status === 'failed').length; return `${n} ${n === 1 ? 'change' : 'changes'} not verified`; })() : 'Not sent'}
            </h2>
          </div>
          {result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              {result.actions.map((a: any, i: number) => (
                <span key={i} style={{ color: a.status === 'verified' ? 'var(--g)' : 'var(--r)' }}>{a.status === 'verified' ? '✓' : '✕'} {a.workout}{a.error ? ` — ${a.error}` : ''}</span>
              ))}
            </div>
          )}
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--s2)', fontSize: 13, lineHeight: 1.45, color: 'var(--tx2)' }}>
            {result?.message ?? req?.error ?? 'The coach could not send this plan.'} A retry needs a fresh dry run — and your confirm on it.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" disabled={offline} style={{ flex: 1, minHeight: 44, borderRadius: 12 }}
              onClick={() => { ask('push', 'Retry the push: prepare a fresh dry run', { retry: plan.plan_hash }).then(close).catch((e) => setErr(String(e.message ?? e))); }}>Prepare a retry</button>
            <button type="button" className="btn2" style={{ minHeight: 44, borderRadius: 12 }} onClick={close}>Later</button>
          </div>
          {err && <span role="alert" style={{ fontSize: 13, color: 'var(--r)' }}>{err}</span>}
        </section>
      )}
    </div>
  );
}
