/**
 * Markdown for coach text — answers, a day's reasoning, the reviews in the athlete's logs/. Text only, never
 * HTML: every block is built here, so nothing the coach writes can become markup.
 *
 * 2026-11-28 (his report, with a screenshot): the old renderer knew paragraphs, bullets, bold and code, so a
 * review's numbers table printed as "| | |", "|---|---|" and one "| Time | 72′ |" line each. It reads tables
 * (with or without a header), quotes, numbered lists, rules, code and italics now; the reviews themselves draw
 * with the Coach's analysis card's pieces (components/CoachReview.tsx).
 */
import type { ReactNode } from 'react';

export type MdBlock =
  | { t: 'p'; text: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'quote'; lines: string[] }
  | { t: 'hr' }
  | { t: 'code'; text: string };

const SEP = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;
const UL = /^\s*[-*+]\s+/;
const OL = /^\s*\d{1,3}[.)]\s+/;

/** A table row's cells: the outer pipes dropped, `\|` kept as a pipe inside a cell. */
export function cells(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/** The text's blocks. Each line of prose is its own paragraph: the coach writes one statement per line
 * (`**Verdict:** …` then `**Intent:** …`), and joining them read as one run-on paragraph. */
export function parseMd(text: string): MdBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const l = raw.trim();
    if (!l) { i++; continue; }
    if (l.startsWith('```')) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) body.push(lines[i]);
      out.push({ t: 'code', text: body.join('\n') });
      i++;
      continue;
    }
    if (l.startsWith('|') && i + 1 < lines.length && SEP.test(lines[i + 1].trim())) {
      const head = cells(l);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
        const r = cells(lines[i]);
        rows.push(head.map((_, k) => r[k] ?? ''));
      }
      out.push({ t: 'table', head, rows });
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push({ t: 'h', level: h[1].length, text: h[2].replace(/\s+#+\s*$/, '') }); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(l)) { out.push({ t: 'hr' }); i++; continue; }
    if (l.startsWith('>')) {
      const q: string[] = [];
      for (; i < lines.length && lines[i].trim().startsWith('>'); i++) q.push(lines[i].trim().replace(/^>\s?/, ''));
      out.push({ t: 'quote', lines: q.filter((x) => x.trim()) });
      continue;
    }
    if (UL.test(raw) || OL.test(raw)) {
      const kind = UL.test(raw) ? 'ul' : 'ol';
      const re = kind === 'ul' ? UL : OL;
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const x = lines[i];
        if (re.test(x)) items.push(x.replace(re, ''));
        else if (x.trim() && /^\s{2,}/.test(x) && !UL.test(x) && !OL.test(x) && items.length) items[items.length - 1] += ` ${x.trim()}`;
        else break;
      }
      out.push({ t: kind, items });
      continue;
    }
    out.push({ t: 'p', text: l });
    i++;
  }
  return out;
}

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\w*])\*[^*\s](?:[^*]*[^*\s])?\*(?![\w*])|(?<!\w)_[^_\s](?:[^_]*[^_\s])?_(?!\w))/g;

/** Bold, italics, inline code and links. A link opens only when it is a web address; anything else stays text. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (i % 2 === 0) return p;
        if (p.startsWith('**')) return <b key={i}><Inline text={p.slice(2, -2)} /></b>;
        if (p.startsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
        if (p.startsWith('[')) {
          const m = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
          if (m && /^https?:\/\//.test(m[2])) return <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer" className="link" style={{ fontSize: 'inherit' }}>{m[1]}</a>;
          return m ? m[1] : p;
        }
        return <i key={i}><Inline text={p.slice(1, -1)} /></i>;
      })}
    </>
  );
}

/** A table as the app draws tables. A header of empty cells (`| | |`) is no header: the rows stand alone. */
export function MdTable({ head, rows }: { head: string[]; rows: string[][] }) {
  const hasHead = head.some((h) => h.trim());
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        {hasHead && <thead><tr>{head.map((h, k) => <th key={k} className="l" style={{ fontSize: 10 }}><Inline text={h} /></th>)}</tr></thead>}
        <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Inline text={c} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function MdBlockView({ b }: { b: MdBlock }): ReactNode {
  switch (b.t) {
    case 'p': return <p><Inline text={b.text} /></p>;
    case 'h': return <h3><Inline text={b.text} /></h3>;
    case 'ul': return <ul>{b.items.map((x, i) => <li key={i}><Inline text={x} /></li>)}</ul>;
    case 'ol': return <ol>{b.items.map((x, i) => <li key={i}><Inline text={x} /></li>)}</ol>;
    case 'table': return <MdTable head={b.head} rows={b.rows} />;
    case 'quote': return <blockquote>{b.lines.map((x, i) => <p key={i}><Inline text={x} /></p>)}</blockquote>;
    case 'hr': return <hr />;
    case 'code': return <pre><code>{b.text}</code></pre>;
  }
}

/** Coach text as blocks: answers in the dock, a day's reasoning, a session's context. */
export function Markdown({ text }: { text: string }) {
  return <div className="md" style={{ fontSize: 14, lineHeight: 1.5 }}>{parseMd(text).map((b, i) => <MdBlockView key={i} b={b} />)}</div>;
}
