// @mentions: "@nikos" pings nikos, "@everyone" pings everybody.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A mention ends where the name does: not followed by another letter or digit.
const END = '(?![\\p{L}\\p{N}_])';

/** Whether `text` mentions `name` (or everyone). */
export function mentionsMe(text: string, name: string): boolean {
  if (!text.includes('@')) return false;
  return new RegExp(`@(?:everyone|${escape(name)})${END}`, 'iu').test(text);
}

export type TextPart = { text: string; mention?: boolean };

/** Splits text into plain parts and @mentions of the given names, longest names first. */
export function splitMentions(text: string, names: string[]): TextPart[] {
  if (!text.includes('@')) return [{ text }];
  const alts = ['everyone', ...names].filter(Boolean).sort((a, b) => b.length - a.length).map(escape);
  const re = new RegExp(`@(?:${alts.join('|')})${END}`, 'giu');
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ text: text.slice(last, i) });
    parts.push({ text: m[0], mention: true });
    last = i + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** The "@partial" being typed right before the caret, if any. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@]{0,32})$/u.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, query: m[2]! } : null;
}
