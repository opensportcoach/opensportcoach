/**
 * A pool swim or a circuit against the workout it followed (scripts/session_review.py → the workout
 * view's `review`). Every number is the engine's, shown with its definition; nothing is computed here.
 * Swims: each rep beside the planned swim it matched, and each repeated set's pace spread. Circuits: each
 * step beside the planned step the watch recorded, a stray lap press set aside and flagged.
 */
import { elapsed, mmss, nf } from '../lib/fmt';
import { IC, Icon } from './ui';

const LABEL: Record<string, string> = {
  distance: 'Distance', moving_s: 'Moving time', pace_100: 'Moving pace', swolf: 'SWOLF', strokes_per_length: 'Strokes / length',
  stroke_rate: 'Stroke rate', avg_hr: 'Avg HR', css_100: 'CSS', pace_spread: 'Pace spread', steps_recorded: 'Steps recorded',
  stray_laps: 'Stray laps', run_s: 'Running', station_s: 'Stations', rest_s: 'Rests', run_spread: 'Run spread',
};
const ORDER = ['distance', 'moving_s', 'pace_100', 'css_100', 'pace_spread', 'swolf', 'strokes_per_length', 'stroke_rate',
  'run_s', 'station_s', 'rest_s', 'run_spread', 'steps_recorded', 'stray_laps', 'avg_hr'];
const SRC: Record<string, string> = { garmin: 'Garmin', computed: 'computed', file: 'your file', strava: 'Strava' };

function value(key: string, v: { value: number; unit: string }): string {
  if (v.unit === 's') return elapsed(v.value);
  if (v.unit === 's/100m') return `${mmss(v.value)} /100 m`;
  if (v.unit === '%') return `${v.value} %`;
  if (key === 'distance') return `${nf(v.value)} m`;
  return `${v.value}${v.unit ? ` ${v.unit}` : ''}`;
}

export function SessionReview({ r }: { r: any }) {
  const swim = r.sport === 'swim';
  const p = r.planned;
  const defs: Record<string, string> = r.definitions ?? {};
  const hasHr = (r.intervals ?? []).some((x: any) => x.hr != null);
  const metrics = ORDER.filter((k) => r.metrics?.[k]).map((k) => [k, r.metrics[k]] as const);
  return (
    <section aria-labelledby="review" className="card" style={{ borderRadius: 16, gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 14px' }}>
        <h2 id="review" className="l" style={{ color: 'var(--tx)' }}>{swim ? 'Swim review' : 'Circuit review'}</h2>
        {p ? (
          <span className="m" style={{ color: 'var(--tx2)' }}
            data-tip={`Matched by ${p.matched_by}${p.version ? `; the workout as it was that day (${p.version})` : ''}.`} tabIndex={0}>
            against <b style={{ color: 'var(--tx)' }}>{p.name}</b>
            {swim ? ` · ${p.done} of ${p.swims} planned swims` : ` · ${p.done_working} of ${p.working} working steps`}
          </span>
        ) : (
          <span className="m" style={{ color: 'var(--tx3)' }}>{r.planned_note}</span>
        )}
      </div>
      {metrics.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {metrics.map(([k, v]) => (
            <div key={k} data-tip={`${defs[k] ?? LABEL[k] ?? k}\nSource: ${SRC[v.source] ?? v.source}.`} tabIndex={0}
              style={{ background: 'var(--s1)', borderRadius: 10, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="l" style={{ fontSize: 10, color: 'var(--tx3)' }}>{LABEL[k] ?? k}</span>
              <span className="n" style={{ fontSize: 17 }}>{value(k, v)}</span>
            </div>
          ))}
        </div>
      )}
      {(r.flags ?? []).map((f: any) => (
        <div key={f.key} role="note" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--y)' }}>
          <Icon d={IC.warn} size={14} sw={2.4} /><span style={{ color: 'var(--tx2)' }}>{f.text}</span>
        </div>
      ))}
      {swim && (r.sets ?? []).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {r.sets.map((s: any, i: number) => (
            <span key={i} className="m" style={{ color: 'var(--tx2)' }} data-tip={defs.pace_spread} tabIndex={0}>
              {s.reps} × {s.metres} m{s.note ? ` · ${s.note}` : ''} — {s.done} done
              {s.pace_spread != null ? ` · pace spread ${(s.pace_spread * 100).toFixed(1)} %` : ''}
            </span>
          ))}
        </div>
      )}
      {r.intervals?.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th className="l">#</th><th className="l">Planned</th>
                {swim ? <><th className="l">Distance</th><th className="l">Time</th><th className="l">Pace</th><th className="l">SWOLF</th></>
                  : <><th className="l">Step</th><th className="l">Time</th></>}
                {hasHr && <th className="l">HR</th>}
              </tr>
            </thead>
            <tbody>
              {r.intervals.map((x: any) => (
                <tr key={x.n}>
                  <td className="m">{x.n}</td>
                  <td style={{ color: x.planned ? 'var(--tx)' : 'var(--tx3)' }}>{x.planned?.note ?? (x.planned ? '—' : 'not in the plan')}</td>
                  {swim ? (
                    <>
                      <td className="n">{x.metres} m</td><td className="n">{mmss(x.secs)}</td>
                      <td className="n">{x.pace_100 ? `${mmss(x.pace_100)}` : '—'}</td><td className="n">{x.swolf ?? '—'}</td>
                    </>
                  ) : (
                    <><td className="m">{x.planned?.role ?? '—'}</td><td className="n">{mmss(x.secs)}</td></>
                  )}
                  {hasHr && <td className="n">{x.hr ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <span className="m" style={{ color: 'var(--tx3)' }}>
        Source: Garmin's {swim ? 'laps' : 'steps as the watch recorded them'}, held against the workout by OpenSportCoach
      </span>
    </section>
  );
}
