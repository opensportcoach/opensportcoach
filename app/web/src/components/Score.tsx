/**
 * The execution score (docs/DESIGN.md (fuelling and score) §5–6; boards Score-Badge, Score-Card, Score-States).
 * Every number and every sentence here is scripts/session_score.py's: the page draws the band, the
 * parts and the set rows that moved the score, and computes none of it. A number never appears
 * without its band word and glyph; a session that can't be scored shows a dash and says why.
 */
import type { Defs } from '../lib/api';
import { tip } from '../lib/fmt';
import { rich } from '../lib/tip';
import { IC, Icon } from './ui';

export interface Band { word: string; c: string; bg: string; fill: string; stroke: string }
const B = (word: string, c: string, bg: string, fill = '', stroke = ''): Band => ({ word, c, bg, fill, stroke });
export const BANDS: Record<string, Band> = {
  as_planned: B('As planned', 'var(--g)', 'var(--gt)', '', 'M7.5 12l3 3 6-6.5'),
  mostly: B('Mostly', 'var(--b)', 'var(--bt)', 'M12 6v6h-6a6 6 0 1 0 6-6z'),
  partly: B('Partly', 'var(--y)', 'var(--yt)', 'M12 6a6 6 0 0 1 0 12z'),
  off_plan: B('Off plan', 'var(--r)', 'var(--rt)', '', 'M9 9l6 6M15 9l-6 6'),
  unclear: B('Unclear', 'var(--tx2)', 'var(--s2)', '', 'M10 9.5a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.7M12 15.5h.01'),
  none: B('Not scored', 'var(--tx3)', 'var(--s2)', '', 'M8 12h8'),
};
export const bandOf = (s: any): Band => BANDS[s?.band ?? 'none'] ?? BANDS.none;

// What a session was scored against, in words: the engine's reference names files and a commit
// ("Gym · Push + Power · program.py @ 63b7e4c"), which the page never prints (UX review 2026-11-10).
export const againstWords = (a: string) => a
  .replace(/ · program\.py @ [0-9a-f]+$/, ', as the program stood that day')
  .replace(/ · program\.py \(working copy\)$/, ', as the program stands now')
  .replace(/^plan\.json \d{4}-\d{2}-\d{2} · /, 'that day’s plan: ')
  .replace(/^watch · /, 'the watch workout ');

export function BandGlyph({ b, size = 14 }: { b: Band; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" fill="none" stroke="currentColor" strokeWidth="2" />
      {b.fill && <path d={b.fill} fill="currentColor" />}
      {b.stroke && <path d={b.stroke} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />}
    </svg>
  );
}

/** The badge's tip: the number, its band, why when there's no number, and where it comes from. */
export function badgeTip(s: any, defs?: Defs): string {
  const b = bandOf(s);
  if (!s || s.excluded) return `${b.word}. ${s?.excluded ?? 'No score for this session.'}\nSource: Computed by OpenSportCoach.`;
  const head = s.total == null ? `${b.word}: under 60 % of the session could be scored.` : `Execution ${s.total} · ${b.word}${s.headline ? `: ${s.headline}` : ''}.`;
  return tip(defs, 'score', `${head}${s.provisional ? ' Provisional: fuel not logged yet.' : ''}`) ?? `${head}\nSource: Computed by OpenSportCoach.`;
}

/**
 * size lg: the session page header (number, band, the part that cost the most; links to the card).
 * size md: Today's Last session, in the verdict row.  size sm: a Workouts row.
 */
export function ScoreBadge({ s, size = 'md', defs, href }: { s: any; size?: 'lg' | 'md' | 'sm'; defs?: Defs; href?: string }) {
  const b = bandOf(s);
  const v = s?.total ?? '—';
  const t = badgeTip(s, defs);
  if (size === 'sm') {
    return (
      <span data-tip={t} tabIndex={0} aria-label={`Score ${v}, ${b.word}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span className="n" style={{ minWidth: 26, textAlign: 'center', padding: '1px 5px', borderRadius: 6, background: b.bg, fontSize: 16, fontWeight: 700 }}>{v}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', color: b.c }}><BandGlyph b={b} size={11} />{b.word}</span>
      </span>
    );
  }
  if (size === 'md') {
    return (
      <span data-tip={t} tabIndex={0} aria-label={`Score ${v}, ${b.word}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px 3px 4px', borderRadius: 9, border: `1.5px solid ${b.c}` }}>
        <span className="n" style={{ padding: '0 6px', borderRadius: 6, background: b.bg, fontSize: 18, fontWeight: 700 }}>{v}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: b.c }}><BandGlyph b={b} size={12} />{b.word}</span>
      </span>
    );
  }
  const second = s?.excluded ? 'not scored' : s?.provisional ? 'provisional' : s?.headline;
  const body = (
    <>
      <span className="n" style={{ display: 'grid', placeItems: 'center', padding: '0 12px', background: b.bg, fontSize: 28, fontWeight: 700, color: 'var(--tx)' }}>{v}</span>
      <span style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '4px 12px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 700, color: b.c }}><BandGlyph b={b} size={13} />{b.word}</span>
        {second && <span className="m" style={{ color: 'var(--tx3)' }}>{second}</span>}
      </span>
    </>
  );
  const style = { display: 'inline-flex', alignItems: 'stretch', minHeight: 44, borderRadius: 12, border: `1.5px solid ${b.c}`, overflow: 'hidden' } as const;
  return href
    ? <a href={href} data-tip={t} aria-label={`Execution score ${v}, ${b.word}. Go to the score card.`} style={style}
        onClick={(e) => { const el = document.getElementById(href.slice(1)); if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }}>{body}</a>
    : <span data-tip={t} tabIndex={0} style={style}>{body}</span>;
}

const CHIP: Record<string, [string, string, string]> = {
  miss: ['var(--rt)', 'var(--r)', IC.minus], warn: ['var(--s3)', 'var(--tx2)', IC.down],
  flag: ['var(--yt)', 'var(--y)', IC.warn], info: ['var(--s3)', 'var(--tx3)', IC.minus], ok: ['var(--gt)', 'var(--g)', IC.check],
};

/** The Score card (board Score-Card): the badge and its sentence, every part on one bar (width =
 * weight, solid = points earned), a row per part, and the set rows that moved the score. */
export function ScoreCard({ s, defs, ctx }: { s: any; defs?: Defs; ctx?: string }) {
  if (!s) return null;
  const b = bandOf(s);
  const v = s.total ?? '—';
  const parts: any[] = s.parts ?? [];
  const none = !!s.excluded;
  const outOf = none ? s.excluded.startsWith('Nothing was planned') ? 'nothing to compare' : 'not scored'
    : s.total == null ? `only ${Math.round((s.coverage ?? 0) * 100)} % could be scored`
      : s.provisional ? `provisional · ${parts.filter((p) => p.dropped === 'not logged').map((p) => `${p.label.toLowerCase()} not logged`).join(', ')}`
        : `out of ${s.out_of}${parts.some((p) => p.dropped) ? ` · ${parts.filter((p) => p.dropped).map((p) => p.label.toLowerCase()).join(', ')} dropped out` : ''}`;
  const chips: any[] = s.chips ?? [];
  return (
    <section id="score" className="sc card" aria-labelledby="sc-h" style={{ gap: 16, scrollMarginTop: 80 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 12px' }}>
        <h2 id="sc-h" className="l" style={{ margin: 0, color: 'var(--tx)' }}>Execution score</h2>
        {ctx && <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{ctx}</span>}
        <span className="m" data-tip={tip(defs, 'score') ?? 'How closely the session matched what was agreed for that day — not how fit you are.'} tabIndex={0}
          style={{ marginLeft: 'auto', color: 'var(--tx3)' }}>execution, not fitness</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 20px' }}>
        <span data-tip={badgeTip(s, defs)} tabIndex={0} aria-label={`Score ${v}, ${b.word}`} style={{ display: 'inline-flex', alignItems: 'stretch', borderRadius: 14, border: `1.5px solid ${b.c}`, overflow: 'hidden' }}>
          <span style={{ display: 'grid', placeItems: 'center', padding: '6px 14px', background: b.bg }}><span className="n" style={{ fontSize: 44, lineHeight: 1, fontWeight: 700 }}>{v}</span></span>
          <span style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, padding: '8px 14px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 700, color: b.c }}><BandGlyph b={b} size={15} />{b.word}</span>
            <span className="m" style={{ color: 'var(--tx3)' }}>{outOf}</span>
          </span>
        </span>
        <p style={{ margin: 0, flex: '1 1 280px', fontSize: 15, lineHeight: 1.45, textWrap: 'pretty' } as any}>{s.summary}</p>
      </div>
      {none && (
        <p style={{ margin: 0, padding: '12px 14px', borderRadius: 12, border: '1px dashed var(--ln2)', fontSize: 14, color: 'var(--tx2)', lineHeight: 1.45 }}>
          {s.excluded.startsWith('Nothing was planned') ? 'Nothing was planned, so there’s nothing to score against. It still counts for load and history.' : 'Not scored, never zero: it still counts for load and history.'}
        </p>
      )}
      {!none && parts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div role="img" aria-label={`Parts: ${parts.map((p) => `${p.label} ${p.dropped ? 'dropped out' : `${p.points} of ${p.weight}`}`).join(', ')}.`} style={{ display: 'flex', gap: 3, height: 30 }}>
            {parts.map((p) => {
              const pct = p.dropped ? 0 : Math.round((p.score ?? 0) * 100);
              return (
                <span key={p.key} style={{ flex: `${p.weight} 0 0`, position: 'relative', borderRadius: 6, overflow: 'hidden', background: p.dropped ? 'transparent' : 'var(--s3)', border: p.dropped ? '1px dashed var(--ln2)' : 0, boxSizing: 'border-box' }}>
                  <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: fillOf(p) }} />
                  <span className="n" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, color: '#FFFFFF', mixBlendMode: 'difference', opacity: p.dropped ? 0.55 : 1 }}>{p.label.replace(' done', '')}</span>
                </span>
              );
            })}
          </div>
          <div role="table" aria-label="Score parts" style={{ display: 'flex', flexDirection: 'column' }}>
            <div role="row" className="srow srow-h" style={{ padding: '0 0 6px', borderBottom: '1px solid var(--ln)' }}>
              {['Part · weight', 'Planned → done', '', 'Points'].map((h, i) => <span key={i} role="columnheader" className="l" style={{ fontSize: 9, textAlign: i === 3 ? 'right' : undefined }}>{h}</span>)}
            </div>
            {parts.map((p) => (
              <div key={p.key} role="row" className="srow" style={{ padding: '10px 0', borderBottom: '1px solid var(--ln)', opacity: p.dropped ? 0.7 : 1 }}>
                <span role="cell" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{p.label}</span>
                  <span className="m" style={{ color: 'var(--tx3)' }}>weight {p.weight}</span>
                </span>
                <span role="cell" data-tip={partTip(p, defs)} tabIndex={0}
                  style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 14, lineHeight: 1.35 }}>
                    {p.planned_text && <><span style={{ color: 'var(--tx2)' }}>{p.planned_text}</span> <span aria-hidden="true" style={{ color: 'var(--tx3)' }}>→</span> </>}
                    <b>{p.dropped ? (p.dropped === 'not logged' ? 'not logged' : '—') : p.done_text ?? '—'}</b>
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--tx3)', lineHeight: 1.35 }}>{p.dropped ? `Dropped out: ${p.dropped}.` : p.measure}</span>
                </span>
                <span role="cell" aria-hidden="true" style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--s2)', border: p.dropped ? '1px dashed var(--ln2)' : 0, boxSizing: 'border-box' }}>
                  <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${p.dropped ? 0 : Math.round((p.score ?? 0) * 100)}%`, borderRadius: 4, background: fillOf(p) }} />
                </span>
                <span role="cell" className="n" style={{ fontSize: 18, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {p.dropped ? <span style={{ fontSize: 13, color: 'var(--tx3)' }}>{p.dropped === 'not logged' ? 'waiting' : 'not scored'}</span> : `${p.points.toFixed(1)} / ${p.weight}`}
                </span>
              </div>
            ))}
          </div>
          {chips.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="l" style={{ fontSize: 10, color: 'var(--tx)' }}>Set rows that moved the score</span>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
                {chips.map((c, i) => {
                  const [bg, col, icon] = CHIP[c.kind] ?? CHIP.info;
                  return (
                    <li key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: 'var(--s2)' }}>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{c.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{c.what}</span>
                      </span>
                      <span className="chip" style={{ background: bg, color: col }}><Icon d={icon} size={10} sw={3} />{c.chip}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {(s.flags ?? []).filter((x: any) => !x.exid).map((x: any, i: number) => (
            <p key={i} style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--y)', lineHeight: 1.45 }}><Icon d={IC.warn} size={14} sw={2.4} style={{ marginTop: 2 }} />{x.text}</p>
          ))}
          <span style={{ fontSize: 12, color: 'var(--tx3)', lineHeight: 1.45 }}>{s.foot}{s.against ? ` Scored against ${againstWords(s.against)}.` : ''}</span>
        </div>
      )}
    </section>
  );
}

/** A part's hover card: planned, done and points as rows, the engine's definition, its source. */
const partTip = (p: any, defs?: Defs) => rich({
  t: `${p.label} · weight ${p.weight}`,
  r: p.dropped ? [['Dropped out', p.dropped]] : [['Planned', p.planned_text ?? '—'], ['Done', p.done_text ?? '—'], ['Points', `${p.points.toFixed(1)} of ${p.weight}`]],
  n: [defs?.[`score_${p.key}`]?.definition ?? p.measure],
  s: 'computed',
});

const fillOf = (p: any) => (p.dropped ? 'transparent' : p.score >= 0.85 ? 'var(--tx)' : p.score >= 0.5 ? 'var(--tx2)' : 'var(--y)');
