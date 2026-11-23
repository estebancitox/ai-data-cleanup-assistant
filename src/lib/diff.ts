// The part of a value that a fix changes, as pieces of the old and of the new value.

export interface Segment {
  text: string;
  /** True for a piece that the other value does not have. */
  changed: boolean;
}

export interface ValueDiff {
  from: Segment[];
  to: Segment[];
}

/** A value with nothing marked. */
export function unchanged(text: string): Segment[] {
  return text === '' ? [] : [{ text, changed: false }];
}

function segments(chars: string[], changed: boolean[]): Segment[] {
  const found: Segment[] = [];
  chars.forEach((char, index) => {
    const last = found[found.length - 1];
    if (last && last.changed === changed[index]) last.text += char;
    else found.push({ text: char, changed: changed[index] });
  });
  return found;
}

/**
 * If `short` is `long` with characters taken out, returns `long` with those characters
 * marked; otherwise null.
 */
function marksOfExtra(short: string[], long: string[]): Segment[] | null {
  const changed: boolean[] = [];
  let matched = 0;
  for (const char of long) {
    const same = matched < short.length && short[matched] === char;
    if (same) matched += 1;
    changed.push(!same);
  }
  return matched === short.length ? segments(long, changed) : null;
}

/**
 * Compares the value before a fix with the value after it. When the fix only takes
 * characters out (spaces, a currency symbol, separators) or only adds some, exactly those
 * characters are marked. Otherwise what the two values share at both ends stays unmarked and
 * the part between is marked on each side.
 */
export function diffValues(from: string, to: string): ValueDiff {
  // By code point, so that a character outside the basic plane is never cut in two.
  const a = Array.from(from);
  const b = Array.from(to);

  const removed = marksOfExtra(b, a);
  if (removed) return { from: removed, to: unchanged(to) };
  const added = marksOfExtra(a, b);
  if (added) return { from: unchanged(from), to: added };

  const shortest = Math.min(a.length, b.length);
  let start = 0;
  while (start < shortest && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < shortest - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;

  const between = (chars: string[]) =>
    segments(chars, chars.map((_, index) => index >= start && index < chars.length - end));
  return { from: between(a), to: between(b) };
}

/** Whitespace drawn with a visible mark, for the changed part of a value. */
export function showWhitespace(text: string): string {
  return text.replace(/ /g, '·').replace(/\t/g, '→').replace(/\r?\n/g, '↵');
}
