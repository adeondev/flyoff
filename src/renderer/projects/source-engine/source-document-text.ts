/**
 * The document text as three pieces, so a keystroke never rebuilds it.
 *
 * A typing edit used to produce the next document by slicing the current one
 * and concatenating. Building that is free — V8 keeps it as a cons string —
 * but the first character anyone reads materialises the whole thing, measured
 * at 1.216.700 bytes per keystroke on a 20.000 line note, which was 81% of
 * everything a keystroke allocated.
 *
 * Slicing is what forces it: a cons string cannot be sliced, so the next
 * keystroke flattens the previous document even if nothing read it. The fix is
 * to stop slicing the document at all. The text is held as
 *
 *     prefix + middle + suffix
 *
 * where `prefix` and `suffix` are slices of a flat base taken once, and
 * `middle` is the region around the caret. An edit inside `middle` rebuilds
 * only `middle` — kilobytes, not megabytes — and the result is another cons
 * string over the same two pieces, so nothing is ever flattened while typing
 * stays in one region.
 *
 * Leaving that region, or growing it past the cap, re-bases: one flatten, then
 * the cheap path resumes. Re-basing is also what happens for a paste, an undo
 * or an external update, which is right — those are not keystrokes.
 */

/**
 * How large `middle` may grow before a re-base. Big enough that ordinary
 * typing, including a long paragraph, never leaves it; small enough that
 * rebuilding it is nothing next to the document.
 */
const MAX_MIDDLE_LENGTH = 64 * 1024;

interface DocumentPieces {
  /** The flat string `prefix` and `suffix` are slices of. */
  base: string;
  /** Exactly the string handed out last time, compared by identity. */
  content: string;
  middle: string;
  prefix: string;
  /** Absolute offset where `middle` starts. */
  prefixStart: number;
  suffix: string;
}

/**
 * One entry, not a map keyed by document: edits arrive one after another for
 * whichever editor has focus, and the identity check below makes a miss
 * harmless — it simply re-bases, which is what the old code did every time.
 */
let pieces: DocumentPieces | undefined;

/** Counts re-bases, so a test can prove the cheap path is the one running. */
export const sourceDocumentTextDiagnostics = { rebases: 0, splices: 0 };

export function resetSourceDocumentText(): void {
  pieces = undefined;
  sourceDocumentTextDiagnostics.rebases = 0;
  sourceDocumentTextDiagnostics.splices = 0;
}

function rebase(
  source: string,
  from: number,
  to: number,
  insert: string,
): string {
  sourceDocumentTextDiagnostics.rebases += 1;
  // The region is the line the edit lands on. Typing then stays inside it for
  // as long as the caret stays on that line, which is the common case by far.
  const lineStart = source.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
  const newline = source.indexOf('\n', to);
  const lineEnd = newline === -1 ? source.length : newline;
  // These three slices are what flattens `source`, once.
  const prefix = source.slice(0, lineStart);
  const suffix = source.slice(lineEnd);
  const middle =
    source.slice(lineStart, from) + insert + source.slice(to, lineEnd);
  const content = prefix + middle + suffix;
  pieces = {
    base: source,
    content,
    middle,
    prefix,
    prefixStart: lineStart,
    suffix,
  };
  return content;
}

/**
 * The document with `[from, to)` replaced by `insert`.
 *
 * Returns a string, so every caller is unchanged; what differs is that the
 * string is a shallow cons over pieces that already existed, rather than a
 * fresh copy of the document.
 */
export function spliceSourceDocument(
  source: string,
  from: number,
  to: number,
  insert: string,
): string {
  sourceDocumentTextDiagnostics.splices += 1;
  const current = pieces;
  if (current && current.content === source) {
    const middleStart = current.prefixStart;
    const middleEnd = middleStart + current.middle.length;
    if (
      from >= middleStart &&
      to <= middleEnd &&
      to >= from &&
      current.middle.length - (to - from) + insert.length <= MAX_MIDDLE_LENGTH
    ) {
      const middle =
        current.middle.slice(0, from - middleStart) +
        insert +
        current.middle.slice(to - middleStart);
      const content = current.prefix + middle + current.suffix;
      pieces = { ...current, content, middle };
      return content;
    }
  }
  return rebase(source, from, to, insert);
}

/**
 * The document being edited, read through whatever can answer for it. A plain
 * string qualifies; the view passes a reader backed by the model's lines, so
 * that the current document — itself a cons of pieces — is never joined.
 */
export interface EditableText {
  charCodeAt(offset: number): number;
  length: number;
  slice(start: number, end: number): string;
}

/**
 * A character of the edited document without building it.
 *
 * Every offset resolves to the old text or to the inserted text, so the caller
 * can normalise a selection against the new document without touching it.
 */
export function editedCharCodeAt(
  source: EditableText,
  from: number,
  to: number,
  insert: string,
  offset: number,
): number {
  if (offset < from) {
    return source.charCodeAt(offset);
  }
  if (offset < from + insert.length) {
    return insert.charCodeAt(offset - from);
  }
  return source.charCodeAt(offset - insert.length + (to - from));
}

/** Length of the edited document, without building it. */
export function editedLength(
  source: EditableText,
  from: number,
  to: number,
  insert: string,
): number {
  return source.length - (to - from) + insert.length;
}

/**
 * A window of the edited document, assembled from at most three slices of
 * text that is already flat. Used for the caret window, which is bounded, so
 * this never touches more than that window plus the inserted text.
 */
export function sliceEditedDocument(
  source: EditableText,
  from: number,
  to: number,
  insert: string,
  start: number,
  end: number,
): string {
  const total = editedLength(source, from, to, insert);
  const left = Math.max(0, Math.min(total, start));
  const right = Math.max(left, Math.min(total, end));
  const insertEnd = from + insert.length;
  // Offsets at or after the inserted text map back by this much.
  const tailShift = insert.length - (to - from);

  let result = '';
  if (left < from) {
    result += source.slice(left, Math.min(right, from));
  }
  if (right > from && left < insertEnd) {
    result += insert.slice(
      Math.max(0, left - from),
      Math.min(insert.length, right - from),
    );
  }
  if (right > insertEnd) {
    result += source.slice(
      Math.max(to, left - tailShift),
      right - tailShift,
    );
  }
  return result;
}
