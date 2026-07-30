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
  nextSelection: {
    end: number;
    start: number;
  };
  previousSelection: {
    end: number;
    start: number;
  };
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

  const nextLines = current.lines.slice();
  const nextLine = highlightSourceLine(
    source.slice(lineStart, nextLineEnd),
    previousLine.fenceBefore,
  );
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
  const previousGraphemes = lineGraphemeSpan(
    previousLine,
    hasLineBreak,
  );
  const nextGraphemes = lineGraphemeSpan(nextLine, hasLineBreak);
  const graphemeDelta = nextGraphemes - previousGraphemes;
  const lineGraphemeStarts = current.lineGraphemeStarts.slice();
  for (
    let index = lineIndex + 1;
    index < lineGraphemeStarts.length;
    index += 1
  ) {
    lineGraphemeStarts[index] =
      lineGraphemeStarts[index]! + graphemeDelta;
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
