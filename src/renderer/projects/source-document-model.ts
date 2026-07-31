import {
  adoptSourceLineGraphemeCount,
  highlightSourceLine,
  highlightSourceLines,
  type HighlightedSourceLine,
} from './markdown-highlight';
import { markdownTextChange } from './markdown-text-change';

export interface SourceChangeRange {
  endLine: number;
  full: boolean;
  previousEndLine: number;
  startLine: number;
}

export interface SourceDocumentModel {
  change: SourceChangeRange;
  lineGraphemeStarts: Int32Array;
  lines: readonly HighlightedSourceLine[];
  lineStarts: Int32Array;
  source: string;
}

export interface SourceDocumentUpdateHint {
  /**
   * The exact edit, when the caller already knows it.
   *
   * Without it the model has to find the change by reading the new document
   * text, and that first character read is what makes V8 materialise the whole
   * string — measured at 2,59 MB allocated per keystroke on a 1,2 M character
   * note, with a collection every ~11 keys. With it, a single-line edit touches
   * only the line it lands on.
   */
  change?: { from: number; insert: string; to: number };
  nextSelection: {
    end: number;
    start: number;
  };
  previousSelection: {
    end: number;
    start: number;
  };
}


/**
 * The line-local edit path is new; the derivation-from-text path it short
 * circuits is kept intact behind this switch so the two can be compared and so
 * it can be turned off without a rebuild if it ever misbehaves.
 */
let localChangePathEnabled = true;

/** Counts fast-path applications, so a test can prove it was exercised. */
export const sourceDocumentModelDiagnostics = { localChangeApplied: 0 };

export function setLocalSourceChangePathEnabled(enabled: boolean): void {
  localChangePathEnabled = enabled;
}

export function isLocalSourceChangePathEnabled(): boolean {
  return localChangePathEnabled;
}

function lineGraphemeSpan(
  line: HighlightedSourceLine,
  hasLineBreak: boolean,
): number {
  return (
    line.graphemeCount +
    (hasLineBreak && !line.source.endsWith('\r') ? 1 : 0)
  );
}

/**
 * Offsets live in typed arrays because a keystroke shifts every offset after
 * the caret. Copying and rewriting 20.000 boxed numbers twice per keystroke is
 * far more expensive than the same work over Int32Array, where a copy is a
 * memcpy and the loop never boxes.
 */
function lineIndexes(lines: readonly HighlightedSourceLine[]): {
  graphemes: Int32Array;
  source: Int32Array;
} {
  const source = new Int32Array(lines.length);
  const graphemes = new Int32Array(lines.length);
  let offset = 0;
  let graphemeOffset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    source[index] = offset;
    graphemes[index] = graphemeOffset;
    offset += line.source.length + 1;
    graphemeOffset += lineGraphemeSpan(
      line,
      index + 1 < lines.length,
    );
  }

  return { graphemes, source };
}

interface SourceTextChange {
  nextEnd: number;
  previousEnd: number;
  start: number;
}

interface SourceTextChangeBoundary {
  next: number;
  previous: number;
}

function sourceLineStart(source: string, offset: number): number {
  return source.lastIndexOf(
    '\n',
    Math.max(0, Math.min(source.length, offset) - 1),
  ) + 1;
}

function sourceLineWindowEnd(source: string, offset: number): number {
  const bounded = Math.max(0, Math.min(source.length, offset));
  if (bounded === sourceLineStart(source, bounded)) {
    return bounded;
  }
  const newline = source.indexOf('\n', bounded);
  return newline === -1 ? source.length : newline + 1;
}

function matchingSourceTail(
  previous: string,
  next: string,
  boundary: SourceTextChangeBoundary,
): boolean {
  const previousRemaining = previous.length - boundary.previous;
  if (previousRemaining !== next.length - boundary.next) {
    return false;
  }
  const probe = Math.min(64, previousRemaining);
  return (
    previous.slice(boundary.previous, boundary.previous + probe) ===
      next.slice(boundary.next, boundary.next + probe) &&
    previous.slice(previous.length - probe) ===
      next.slice(next.length - probe)
  );
}

function hintedSourceTextChange(
  previous: string,
  next: string,
  hint: SourceDocumentUpdateHint,
): SourceTextChange | undefined {
  const selectionBoundary = {
    next: hint.nextSelection.end,
    previous: hint.previousSelection.end,
  };
  const lineBoundary = {
    next: sourceLineWindowEnd(next, hint.nextSelection.end),
    previous: sourceLineWindowEnd(
      previous,
      hint.previousSelection.end,
    ),
  };
  const boundary = matchingSourceTail(
    previous,
    next,
    selectionBoundary,
  )
    ? selectionBoundary
    : matchingSourceTail(previous, next, lineBoundary)
      ? lineBoundary
      : undefined;
  if (!boundary) {
    return undefined;
  }

  let start = Math.min(
    sourceLineStart(previous, hint.previousSelection.start),
    sourceLineStart(next, hint.nextSelection.start),
  );
  const sharedEnd = Math.min(boundary.previous, boundary.next);
  while (start < sharedEnd && previous[start] === next[start]) {
    start += 1;
  }

  let previousEnd = boundary.previous;
  let nextEnd = boundary.next;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  return start === previousEnd &&
    start === nextEnd &&
    previous !== next
    ? undefined
    : { nextEnd, previousEnd, start };
}

function sourceTextChange(
  previous: string,
  next: string,
  hint?: SourceDocumentUpdateHint,
): SourceTextChange {
  const hinted = hint
    ? hintedSourceTextChange(previous, next, hint)
    : undefined;
  if (hinted) {
    return hinted;
  }
  // No hint means a paste, an undo, or an external update, where the caret
  // gives nothing away and the whole document has to be compared. Doing that
  // one character at a time cost 4,7 ms on a 20.000 line note and 19,6 ms on
  // an 80.000 line one; comparing in blocks keeps it off the critical path.
  return markdownTextChange(previous, next);
}

function containsLineBreak(
  source: string,
  start: number,
  end: number,
): boolean {
  const offset = source.indexOf('\n', start);
  return offset !== -1 && offset < end;
}

/**
 * Rebuild the model around a replacement that stays inside one line.
 *
 * Everything here works on the affected line and the offset indexes; the
 * document text is stored, never read.
 */
function replaceSingleLine(
  current: SourceDocumentModel,
  source: string,
  lineIndex: number,
  nextLine: HighlightedSourceLine,
  sourceDelta: number,
): SourceDocumentModel {
  const previousLine = current.lines[lineIndex]!;
  const nextLines = current.lines.slice();
  nextLines[lineIndex] = nextLine;

  let fenceState = nextLine.fenceAfter;
  let endLine = lineIndex + 1;
  while (
    endLine < nextLines.length &&
    current.lines[endLine]!.fenceBefore !== fenceState
  ) {
    const previous = current.lines[endLine]!;
    const highlighted = highlightSourceLine(previous.source, fenceState);
    adoptSourceLineGraphemeCount(highlighted, previous.graphemeCount);
    nextLines[endLine] = highlighted;
    fenceState = highlighted.fenceAfter;
    endLine += 1;
  }

  const lineStarts = current.lineStarts.slice();
  for (let index = lineIndex + 1; index < lineStarts.length; index += 1) {
    lineStarts[index] = lineStarts[index]! + sourceDelta;
  }

  const hasLineBreak = lineIndex + 1 < nextLines.length;
  const previousGraphemes = lineGraphemeSpan(previousLine, hasLineBreak);
  const nextGraphemes = lineGraphemeSpan(nextLine, hasLineBreak);
  const graphemeDelta = nextGraphemes - previousGraphemes;
  const lineGraphemeStarts = current.lineGraphemeStarts.slice();
  for (
    let index = lineIndex + 1;
    index < lineGraphemeStarts.length;
    index += 1
  ) {
    lineGraphemeStarts[index] = lineGraphemeStarts[index]! + graphemeDelta;
  }

  return {
    change: {
      endLine,
      full: false,
      previousEndLine: endLine,
      startLine: lineIndex,
    },
    lineGraphemeStarts,
    lines: nextLines,
    lineStarts,
    source,
  };
}

/**
 * Apply an edit the caller described exactly, without reading the document.
 *
 * This is the keystroke path. It reads `source.length`, which is O(1) even on a
 * rope, and otherwise touches only the line the edit lands on — so V8 is never
 * asked to materialise the new document string, and the model does no work
 * proportional to the size of the note.
 */
function applyKnownSourceChange(
  current: SourceDocumentModel,
  source: string,
  change: { from: number; insert: string; to: number },
): SourceDocumentModel | undefined {
  const { from, insert, to } = change;
  if (from < 0 || to < from || to > current.source.length) {
    return undefined;
  }
  const sourceDelta = insert.length - (to - from);
  if (source.length !== current.source.length + sourceDelta) {
    return undefined;
  }
  // A line break on either side changes how many lines exist, which the single
  // line path cannot express.
  if (insert.includes('\n') || insert.includes('\r')) {
    return undefined;
  }

  const lineIndex = sourceLineIndexAtOffset(current, from);
  const previousLine = current.lines[lineIndex];
  const lineStart = current.lineStarts[lineIndex];
  if (!previousLine || lineStart === undefined) {
    return undefined;
  }
  const lineEnd = lineStart + previousLine.source.length;
  if (to > lineEnd) {
    return undefined;
  }

  const localStart = from - lineStart;
  const localEnd = to - lineStart;
  const nextLineSource =
    previousLine.source.slice(0, localStart) +
    insert +
    previousLine.source.slice(localEnd);
  // An edit can describe a replacement that puts back exactly what was there.
  // The document is unchanged, and saying so here is what keeps this path
  // agreeing with the one that compares the two documents instead — the edit
  // is confined to this line, so the line is the whole question.
  if (nextLineSource === previousLine.source) {
    return current;
  }
  const nextLine = highlightSourceLine(
    nextLineSource,
    previousLine.fenceBefore,
  );
  sourceDocumentModelDiagnostics.localChangeApplied += 1;
  return replaceSingleLine(current, source, lineIndex, nextLine, sourceDelta);
}

function updateSingleSourceLine(
  current: SourceDocumentModel,
  source: string,
  change: SourceTextChange,
): SourceDocumentModel | undefined {
  if (
    containsLineBreak(
      current.source,
      change.start,
      change.previousEnd,
    ) ||
    containsLineBreak(source, change.start, change.nextEnd)
  ) {
    return undefined;
  }

  const lineIndex = sourceLineIndexAtOffset(current, change.start);
  const previousLine = current.lines[lineIndex];
  const lineStart = current.lineStarts[lineIndex];
  if (!previousLine || lineStart === undefined) {
    return undefined;
  }

  const previousLineEnd = lineStart + previousLine.source.length;
  const sourceDelta = source.length - current.source.length;
  const nextLineEnd = previousLineEnd + sourceDelta;
  if (
    change.previousEnd > previousLineEnd ||
    change.nextEnd > nextLineEnd ||
    nextLineEnd < lineStart
  ) {
    return undefined;
  }

  const nextLine = highlightSourceLine(
    source.slice(lineStart, nextLineEnd),
    previousLine.fenceBefore,
  );
  return replaceSingleLine(current, source, lineIndex, nextLine, sourceDelta);
}

export function createSourceDocumentModel(
  source: string,
): SourceDocumentModel {
  const lines = highlightSourceLines(source);
  const indexes = lineIndexes(lines);
  return {
    change: {
      endLine: lines.length,
      full: true,
      previousEndLine: 0,
      startLine: 0,
    },
    lineGraphemeStarts: indexes.graphemes,
    lines,
    lineStarts: indexes.source,
    source,
  };
}

export function updateSourceDocumentModel(
  current: SourceDocumentModel,
  source: string,
  hint?: SourceDocumentUpdateHint,
): SourceDocumentModel {
  // Before the equality check, not after it. `===` on two strings of the same
  // length compares their characters, and the new document is a cons of pieces
  // V8 has not joined, so that comparison joined the whole note — every
  // same-length edit paid for a full copy of the document. A described edit
  // says what changed without anyone having to look.
  if (
    localChangePathEnabled &&
    hint?.change &&
    (hint.change.from !== hint.change.to || hint.change.insert.length > 0)
  ) {
    const local = applyKnownSourceChange(current, source, hint.change);
    if (local) {
      return local;
    }
  }

  // A genuine no-op arrives as the same string, so this is an identity check.
  if (source === current.source) {
    return current;
  }

  const textChange = sourceTextChange(current.source, source, hint);
  const singleLine = updateSingleSourceLine(
    current,
    source,
    textChange,
  );
  if (singleLine) {
    return singleLine;
  }

  const rawLines = source.split('\n');
  const oldLines = current.lines;
  let prefix = 0;
  while (
    prefix < rawLines.length &&
    prefix < oldLines.length &&
    rawLines[prefix] === oldLines[prefix]?.source
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < rawLines.length - prefix &&
    suffix < oldLines.length - prefix &&
    rawLines[rawLines.length - suffix - 1] ===
      oldLines[oldLines.length - suffix - 1]?.source
  ) {
    suffix += 1;
  }

  const nextLines: HighlightedSourceLine[] = oldLines.slice(0, prefix);
  const newSuffixStart = rawLines.length - suffix;
  const oldSuffixStart = oldLines.length - suffix;
  let fenceState =
    prefix === 0 ? false : nextLines[prefix - 1]!.fenceAfter;
  let index = prefix;
  let reusedFrom = rawLines.length;
  let reusedPreviousFrom = oldLines.length;

  while (index < rawLines.length) {
    if (index >= newSuffixStart) {
      const oldIndex = oldSuffixStart + index - newSuffixStart;
      const reusable = oldLines[oldIndex];
      if (reusable?.fenceBefore === fenceState) {
        reusedFrom = index;
        reusedPreviousFrom = oldIndex;
        nextLines.push(...oldLines.slice(oldIndex));
        break;
      }
    }

    const highlighted = highlightSourceLine(rawLines[index]!, fenceState);
    nextLines.push(highlighted);
    fenceState = highlighted.fenceAfter;
    index += 1;
  }

  const indexes = lineIndexes(nextLines);
  return {
    change: {
      endLine: reusedFrom,
      full: false,
      previousEndLine: reusedPreviousFrom,
      startLine: prefix,
    },
    lineGraphemeStarts: indexes.graphemes,
    lines: nextLines,
    lineStarts: indexes.source,
    source,
  };
}

/**
 * Read the document through its lines instead of through its text.
 *
 * The model keeps the whole document as one string, but a keystroke leaves
 * that string as a cons of pieces V8 has not joined, and any read of it —
 * a character, a slice — joins the whole note. The lines are already separate
 * strings, so answering from them costs the window and nothing more.
 */
export function sourceTextReader(
  model: SourceDocumentModel,
): {
  charCodeAt: (offset: number) => number;
  length: number;
  slice: (start: number, end: number) => string;
} {
  const length = model.source.length;
  const lineAt = (offset: number): number =>
    sourceLineIndexAtOffset(model, offset);
  return {
    charCodeAt: (offset) => {
      if (offset < 0 || offset >= length) {
        return Number.NaN;
      }
      const index = lineAt(offset);
      const start = model.lineStarts[index] ?? 0;
      const line = model.lines[index];
      const local = offset - start;
      // Past the end of the line is the newline that separates it from the
      // next one; it is not stored on the line itself.
      return local < (line?.source.length ?? 0)
        ? line!.source.charCodeAt(local)
        : 0x0a;
    },
    length,
    slice: (start, end) => {
      const from = Math.max(0, Math.min(length, start));
      const to = Math.max(from, Math.min(length, end));
      if (from === to) {
        return '';
      }
      const firstLine = lineAt(from);
      const parts: string[] = [];
      let index = firstLine;
      let cursor = model.lineStarts[firstLine] ?? 0;
      while (cursor < to && index < model.lines.length) {
        const line = model.lines[index]!;
        const lineStart = model.lineStarts[index] ?? cursor;
        const lineEnd = lineStart + line.source.length;
        if (from < lineEnd && to > lineStart) {
          parts.push(
            line.source.slice(
              Math.max(0, from - lineStart),
              Math.min(line.source.length, to - lineStart),
            ),
          );
        }
        if (lineEnd < length && to > lineEnd && from <= lineEnd) {
          parts.push('\n');
        }
        cursor = lineEnd + 1;
        index += 1;
      }
      return parts.join('');
    },
  };
}

export function sourceLineIndexAtOffset(
  model: Pick<SourceDocumentModel, 'lineStarts' | 'source'>,
  offset: number,
): number {
  const target = Math.min(Math.max(0, offset), model.source.length);
  let low = 0;
  let high = model.lineStarts.length - 1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (model.lineStarts[middle]! <= target) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return Math.max(0, high);
}
