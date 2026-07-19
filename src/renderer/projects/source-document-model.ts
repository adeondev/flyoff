import {
  highlightSourceLine,
  highlightSourceLines,
  type HighlightedSourceLine,
} from './markdown-highlight';

export interface SourceChangeRange {
  endLine: number;
  full: boolean;
  startLine: number;
}

export interface SourceDocumentModel {
  change: SourceChangeRange;
  lines: readonly HighlightedSourceLine[];
  lineStarts: readonly number[];
  source: string;
}

function lineStarts(lines: readonly HighlightedSourceLine[]): number[] {
  const starts = new Array<number>(lines.length);
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    starts[index] = offset;
    offset += lines[index]!.source.length + 1;
  }

  return starts;
}

export function createSourceDocumentModel(
  source: string,
): SourceDocumentModel {
  const lines = highlightSourceLines(source);
  return {
    change: { endLine: lines.length, full: true, startLine: 0 },
    lines,
    lineStarts: lineStarts(lines),
    source,
  };
}

export function updateSourceDocumentModel(
  current: SourceDocumentModel,
  source: string,
): SourceDocumentModel {
  if (source === current.source) {
    return current;
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

  while (index < rawLines.length) {
    if (index >= newSuffixStart) {
      const oldIndex = oldSuffixStart + index - newSuffixStart;
      const reusable = oldLines[oldIndex];
      if (reusable?.fenceBefore === fenceState) {
        reusedFrom = index;
        nextLines.push(...oldLines.slice(oldIndex));
        break;
      }
    }

    const highlighted = highlightSourceLine(rawLines[index]!, fenceState);
    nextLines.push(highlighted);
    fenceState = highlighted.fenceAfter;
    index += 1;
  }

  return {
    change: {
      endLine: Math.max(prefix + 1, reusedFrom),
      full: false,
      startLine: prefix,
    },
    lines: nextLines,
    lineStarts: lineStarts(nextLines),
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
