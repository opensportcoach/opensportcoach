/**
 * Hover tips as structured cards (round 3, 2026-10-11: "hovers only show text"). An element's
 * `data-tip` is either a plain string — read by `parseTip` into the same structure, so every existing
 * tip gets a title, label/value rows and a source line for free — or `rich({...})`, which carries row
 * colours (a chart's series) and a title accent.
 */
export interface RichTip {
  /** Title. */ t?: string;
  /** Title accent: a dot in this colour. */ c?: string;
  /** Rows: label, value, swatch colour. */ r?: [string, string, string?][];
  /** Paragraphs. */ n?: string[];
  /** Source: garmin | computed | coach, or its words. */ s?: string;
  /** A hint for what a click does. */ h?: string;
}

export const rich = (x: RichTip): string => JSON.stringify(x);

const ROW = /^([^:.]{1,34}):\s+(\S.{0,44})$/;

/** A plain tip → its structure: "Source: …" → the footer, "Click …" → a hint, short "Label: value"
 * lines → rows, and a short first line above rows (or above a paragraph) → the title. */
export function parseTip(text: string): RichTip {
  const raw = text.trim();
  if (raw.startsWith('{')) {
    try { return JSON.parse(raw) as RichTip; } catch { /* not JSON after all: read it as text */ }
  }
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: RichTip = {};
  const rest: string[] = [];
  for (const l of lines) {
    const src = l.match(/^Source:\s*(.+?)\.?$/);
    if (src) { out.s = src[1]; continue; }
    if (/^(Click|Tap)\b/.test(l)) { out.h = l; continue; }
    rest.push(l);
  }
  const isRow = (l: string) => ROW.test(l) && !/[.!?]$/.test(l.split(':')[0]);
  const rows = rest.filter(isRow);
  const first = rest[0];
  if (first && !isRow(first) && first.length <= 48 && !/[.!?]$/.test(first) && rest.length > 1) {
    out.t = first;
    rest.shift();
  }
  for (const l of rest) {
    if (rows.includes(l)) (out.r ??= []).push(l.match(ROW)!.slice(1, 3) as [string, string]);
    else (out.n ??= []).push(l);
  }
  return out;
}

/** The source line's words and colour. */
export function sourceOf(s?: string): [string, string] | null {
  if (!s) return null;
  const k = s.toLowerCase();
  if (k.startsWith('garmin')) return [s, 'var(--b)'];
  if (k.startsWith('computed')) return [s, 'var(--v)'];
  if (k.startsWith('coach')) return [s, 'var(--g)'];
  return [s, 'var(--tx3)'];
}
