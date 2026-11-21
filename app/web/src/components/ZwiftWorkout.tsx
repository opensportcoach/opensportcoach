/**
 * The Zwift workout a planned ride names: what to pick in Zwift's workout menu, linked to its page on
 * whatsonzwift.com. Every Zwift ride the coach plans carries one (his rule, 2026-11-05: the 11-05 VO2 ride
 * named none, and he rode what Zwift offered, about 9′ of work against the 15′ planned). The fields are
 * read off the workout's own page by scripts/zwift_workouts.py. Nothing here is invented or computed.
 */
import type { CSSProperties } from 'react';
import { SportIcon } from './SportIcon';
import { IC, Icon } from './ui';

export interface ZwiftWorkoutT { name: string; url: string; collection?: string | null; duration_min: number; stress_points?: number | null; adjust?: string | null }

/** From his rule's date on, a Zwift ride with no workout is a gap in the plan (scripts/zwift_workouts.py RULE_FROM). */
export const ZWIFT_RULE_FROM = '2026-11-06';

const EXT = 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5';
const SRC = 'From the workout’s page on whatsonzwift.com, picked by the coach.';

export const zwiftMeta = (w: ZwiftWorkoutT) =>
  [w.collection, `${w.duration_min} min`, w.stress_points ? `${w.stress_points} stress points` : null].filter(Boolean).join(' · ');

/** The session panel's card: the workout, where it sits in Zwift's menu, how to ride it, and its page. */
export function ZwiftWorkoutCard({ w }: { w: ZwiftWorkoutT }) {
  return (
    <div role="group" aria-label={`Zwift workout: ${w.name}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 14, border: '1px solid var(--ln2)', background: 'var(--s2)', maxWidth: 560 }}>
      <span className="l" data-tip={SRC} tabIndex={0} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--tx2)' }}>
        <SportIcon icon="zwift" size={13} />Ride this in Zwift
      </span>
      <span className="n" style={{ fontSize: 26, lineHeight: 1.05, fontWeight: 700, overflowWrap: 'anywhere' }}>{w.name}</span>
      <span style={{ fontSize: 13, color: 'var(--tx2)' }}>
        {w.collection ? <>Workouts → <b style={{ color: 'var(--tx)' }}>{w.collection}</b> · </> : null}{w.duration_min} min{w.stress_points ? ` · ${w.stress_points} stress points` : ''}
      </span>
      {w.adjust && (
        <span style={{ display: 'flex', gap: 8, fontSize: 14, lineHeight: 1.45 }}>
          <Icon d={IC.arrow} size={13} sw={2.4} style={{ flex: 'none', marginTop: 4, color: 'var(--tx3)' }} />
          <span><b>How to ride it:</b> {w.adjust}</span>
        </span>
      )}
      <a href={w.url} target="_blank" rel="noopener noreferrer" className="link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, alignSelf: 'flex-start' }}>
        See every step on What’s on Zwift<Icon d={EXT} size={12} sw={2.4} />
      </a>
    </div>
  );
}

/** One line for a day cell (Today's week, a proposal's day): the name with Zwift's mark. Not a link —
 * the cell around it already is one, and links never nest. */
export function ZwiftWorkoutLine({ w, style }: { w: ZwiftWorkoutT; style?: CSSProperties }) {
  return (
    <span data-tip={`Zwift workout · ${w.name}\n${zwiftMeta(w)}${w.adjust ? `\n${w.adjust}` : ''}\n${SRC}`} tabIndex={0}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--tx)', minWidth: 0, ...style }}>
      <SportIcon icon="zwift" size={11} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
    </span>
  );
}

/** A Zwift ride planned from the rule's date on that names no workout: say so rather than show nothing. */
export function ZwiftWorkoutMissing() {
  return (
    <span role="note" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: '1px dashed var(--y)', background: 'var(--yt)', fontSize: 13, alignSelf: 'flex-start' }}>
      <Icon d={IC.warn} size={13} sw={2.4} style={{ color: 'var(--y)' }} />
      No Zwift workout named yet. Ask the coach for one before you ride.
    </span>
  );
}
