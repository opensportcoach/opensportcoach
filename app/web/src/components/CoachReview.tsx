/**
 * A review the coach wrote to the athlete's logs/ (`<date>-<id>-review.md`), drawn with the Coach's analysis
 * card's pieces (screens/endurance.tsx ReviewCard) rather than as plain markdown: the verdict large, intent and
 * execution as chips, a two-column numbers table as tiles, each finding in its own row with its mark, "Next
 * time" boxed, the coach's questions last (his ask, 2026-11-28). It reads the coach's own conventions —
 * `**Verdict:**`-style lines, `## What it says`, `## Context`, `## Next time`, `## Question` — and anything
 * else draws as plain markdown, so a review written another way still reads.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useView } from '../lib/api';
import { IC, Icon } from './ui';
import { Inline, MdBlockView, MdTable, parseMd, type MdBlock } from './Markdown';

export const RATING: Record<string, [string, string]> = {
  on_target: ['On target', 'var(--g)'], partly: ['Partly', 'var(--y)'], off_target: ['Off target', 'var(--r)'], unclear: ['Unclear', 'var(--tx2)'],
};
export const SEVERITY: Record<string, [string, string, string]> = {
  good: ['✓', 'var(--g)', 'var(--gt)'], info: ['i', 'var(--b)', 'var(--bt)'], watch: ['!', 'var(--y)', 'var(--yt)'], act: ['!', 'var(--r)', 'var(--rt)'],
};
export const INTENT: Record<string, string> = {
  recovery: 'Recovery', endurance: 'Endurance', tempo: 'Tempo', threshold: 'Threshold', vo2: 'VO₂max', vo2max: 'VO₂max', race: 'Race', mixed: 'Mixed', unknown: 'Unknown',
};

/** `**Verdict:** text` (or `**Verdict**: text`): a labelled line. A bold sentence without a colon is not one. */
const LABELLED = /^\*\*([^*:]{1,40}):\*\*\s*(.*)$|^\*\*([^*:]{1,40})\*\*:\s*(.*)$/;
function labelled(text: string): [string, string] | null {
  const m = text.match(LABELLED);
  return m ? [(m[1] ?? m[3]).trim(), (m[2] ?? m[4] ?? '').trim()] : null;
}

/** The execution line's first words as the analysis's rating: "partly. The intensity…" → Partly. */
function ratingOf(text: string): keyof typeof RATING | null {
  const w = text.toLowerCase().replace(/[*_`]/g, '').trim();
  if (/^(on target|on-target|yes|as planned|done|met)\b/.test(w)) return 'on_target';
  if (/^(partly|partially|mostly|in part)\b/.test(w)) return 'partly';
  if (/^(off target|off-target|no\b|missed|not met)/.test(w)) return 'off_target';
  return null;
}

/** The intent line's first word, and where it came from: "endurance (planned, …)" → Endurance · planned. */
function intentOf(text: string): { word: string; source: string | null } | null {
  const w = text.toLowerCase().replace(/[*_`]/g, '').trim();
  const first = w.match(/^([a-z0-9₂]+)/)?.[1] ?? '';
  if (!INTENT[first]) return null;
  const source = /\binferred\b/.test(w) ? 'inferred' : /\bplanned\b/.test(w) ? 'planned' : /\b(athlete|he said|she said|they said|your word)\b/.test(w) ? 'your word' : null;
  return { word: INTENT[first], source };
}

/** A finding's mark, from how the coach opens it: "**Good: …**" is good; a warning word is one to watch. */
function severityOf(item: string): keyof typeof SEVERITY {
  const lead = (item.match(/^\*\*([^*]+)\*\*/)?.[1] ?? '').toLowerCase();
  if (/^(good|well done|nailed|right)\b/.test(lead)) return 'good';
  if (/^(act|fix|stop|injury|pain)\b/.test(lead)) return 'act';
  if (/^(watch|worth a look|careful|note:? the risk)\b/.test(lead)) return 'watch';
  return 'info';
}

interface Section { title: string | null; blocks: MdBlock[] }
function sections(blocks: MdBlock[]): Section[] {
  const out: Section[] = [{ title: null, blocks: [] }];
  for (const b of blocks) {
    if (b.t === 'h' && b.level >= 2) out.push({ title: b.text, blocks: [] });
    else out[out.length - 1].blocks.push(b);
  }
  return out.filter((s) => s.title || s.blocks.length);
}

const findingRow: CSSProperties = { display: 'grid', gridTemplateColumns: '24px 1fr', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--s2)' };

function Finding({ text }: { text: string }) {
  const [icon, c, bg] = SEVERITY[severityOf(text)];
  return (
    <div style={findingRow}>
      <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', background: bg, color: c, fontWeight: 700, fontSize: 12 }}>{icon}</span>
      <span style={{ fontSize: 14, lineHeight: 1.45 }}><Inline text={text} /></span>
    </div>
  );
}

/** A two-column table with no header — the review's numbers — as tiles: the label small, the value large. */
function Tiles({ rows }: { rows: string[][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(190px, 100%), 1fr))', gap: 8 }}>
      {rows.map(([k, v], i) => (
        <div key={i} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--s2)', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span className="l" style={{ fontSize: 10, letterSpacing: '.1em' }}><Inline text={k} /></span>
          <span className="n" style={{ fontSize: v.length <= 18 ? 22 : 17, lineHeight: 1.15, fontWeight: 700, overflowWrap: 'anywhere' }}><Inline text={v} /></span>
        </div>
      ))}
    </div>
  );
}

const isTileTable = (b: MdBlock) => b.t === 'table' && b.head.length === 2 && !b.head.some((h) => h.trim());

/** One block in a review: tables as tiles or a table, findings as rows, a quote set off, the rest as text. */
function ReviewBlock({ b, next, findings }: { b: MdBlock; next?: MdBlock; findings: boolean }): ReactNode {
  if (b.t === 'table') return isTileTable(b) ? <Tiles rows={b.rows} /> : <MdTable head={b.head} rows={b.rows} />;
  if (b.t === 'ul' && (findings || b.items.every((x) => x.startsWith('**')))) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{b.items.map((x, i) => <Finding key={i} text={x} />)}</div>;
  }
  if (b.t === 'quote') {
    return (
      <blockquote style={{ margin: 0, padding: '10px 14px', borderLeft: '3px solid var(--id)', borderRadius: '0 10px 10px 0', background: 'var(--s2)', fontSize: 14, lineHeight: 1.5 }}>
        {b.lines.map((x, i) => <p key={i} style={{ margin: 0 }}><Inline text={x} /></p>)}
      </blockquote>
    );
  }
  if (b.t === 'p') {
    const lab = labelled(b.text);
    if (lab) {
      return (
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--tx2)' }}>
          <span className="l" style={{ fontSize: 10, color: 'var(--tx)', marginRight: 8 }}>{lab[0]}</span><Inline text={lab[1]} />
        </p>
      );
    }
    // The line that introduces a table ("Numbers from endurance_metrics.py …:") is its caption.
    const caption = b.text.endsWith(':') && next?.t === 'table';
    return <p style={{ margin: 0, fontSize: caption ? 12 : 14, lineHeight: 1.5, color: caption ? 'var(--tx3)' : 'var(--tx2)' }}><Inline text={b.text} /></p>;
  }
  return <div className="md" style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--tx2)' }}><MdBlockView b={b} /></div>;
}

/** The review's markdown, laid out. `head` goes beside the title (the file it came from); `bare` drops the card. */
export function ReviewDoc({ markdown, title = 'Coach review', head, bare }: { markdown: string; title?: string; head?: ReactNode; bare?: boolean }) {
  const blocks = parseMd(markdown.replace(/^# .*\n/, ''));
  // The lead: `**Verdict:**`, `**Intent:**` and `**Execution:**` lines become the card's headline and chips.
  const lead: Record<string, string> = {};
  const rest = blocks.filter((b) => {
    if (b.t !== 'p') return true;
    const lab = labelled(b.text);
    const k = lab?.[0].toLowerCase();
    if (lab && (k === 'verdict' || k === 'intent' || k === 'execution') && !(k in lead)) { lead[k] = lab[1]; return false; }
    return true;
  });
  const rating = lead.execution ? ratingOf(lead.execution) : null;
  const intent = lead.intent ? intentOf(lead.intent) : null;
  const [rLabel, rCol] = rating ? RATING[rating] : RATING.unclear;
  const execText = rating ? lead.execution.replace(/^[^.:;,]*[.:;,]\s*/, '') : lead.execution;
  const secs = sections(rest);
  const body = (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
        <h2 className="l" style={{ color: 'var(--v)' }}>{title}</h2>
        {intent && <span className="chip" data-tip={lead.intent} tabIndex={0} style={{ background: 'var(--s2)', color: 'var(--tx)' }}>{intent.word}{intent.source ? ` · ${intent.source}` : ''}</span>}
        {rating && <span className="chip" style={{ background: 'var(--s2)', color: rCol }}>{rLabel}</span>}
        {head && <span style={{ marginLeft: 'auto' }}>{head}</span>}
      </div>
      {lead.verdict && <p style={{ margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}><Inline text={lead.verdict} /></p>}
      {execText && <p style={{ margin: 0, fontSize: 14, color: 'var(--tx2)' }}><Inline text={execText} /></p>}
      {lead.intent && !intent && <p style={{ margin: 0, fontSize: 14, color: 'var(--tx2)' }}><span className="l" style={{ fontSize: 10, color: 'var(--tx)', marginRight: 8 }}>Intent</span><Inline text={lead.intent} /></p>}
      {lead.intent && intent && <p style={{ margin: 0, fontSize: 13, color: 'var(--tx3)' }}><Inline text={lead.intent} /></p>}
      {secs.map((s, i) => <ReviewSection key={i} s={s} />)}
    </>
  );
  if (bare) return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{body}</div>;
  return <section className="card" aria-label={title} style={{ borderRadius: 16, gap: 14 }}>{body}</section>;
}

function ReviewSection({ s }: { s: Section }) {
  const t = (s.title ?? '').toLowerCase();
  if (/^next time/.test(t)) {
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--ln2)' }}>
        <span className="l" style={{ color: 'var(--id)', flex: 'none' }}>Next time</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 15, lineHeight: 1.45 }}>
          {s.blocks.map((b, i) => (b.t === 'p' ? <span key={i}><Inline text={b.text} /></span> : <div key={i} className="md"><MdBlockView b={b} /></div>))}
        </div>
      </div>
    );
  }
  if (/^questions?\b|^the coach asks/.test(t)) {
    const qs = s.blocks.flatMap((b) => (b.t === 'ul' || b.t === 'ol' ? b.items : b.t === 'p' ? [b.text] : []));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 12, background: 'var(--vt)' }}>
        <span className="l" style={{ fontSize: 10, color: 'var(--v)' }}>The coach asks</span>
        {qs.map((q, i) => <span key={i} style={{ display: 'flex', gap: 8, fontSize: 14, lineHeight: 1.45 }}><Icon d={IC.chat} size={13} sw={2.2} style={{ marginTop: 3, color: 'var(--v)' }} /><span><Inline text={q} /></span></span>)}
        <span style={{ fontSize: 12, color: 'var(--tx3)' }}>Answer in the coach panel.</span>
      </div>
    );
  }
  const findings = /what it says|findings|what went/.test(t);
  const context = /^context/.test(t);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {s.title && <h3 className="l" style={{ color: 'var(--tx)', fontSize: 11 }}><Inline text={s.title} /></h3>}
      {s.blocks.map((b, i) => (context && b.t === 'ul'
        ? <ul key={i} style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--tx2)', display: 'flex', flexDirection: 'column', gap: 4, lineHeight: 1.45 }}>{b.items.map((x, j) => <li key={j}><Inline text={x} /></li>)}</ul>
        : <ReviewBlock key={i} b={b} next={s.blocks[i + 1]} findings={findings} />))}
    </div>
  );
}

/** A review file from the athlete's logs, read through the journal view. */
export function CoachReview({ file, bare, title }: { file: string; bare?: boolean; title?: string }) {
  const { data } = useView('journal-entry', file);
  if (!data) return null;
  return <ReviewDoc markdown={String(data.markdown ?? '')} title={title} bare={bare}
    head={<span className="m" style={{ color: 'var(--tx3)' }}>{file}</span>} />;
}
