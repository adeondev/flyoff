import type { SourceSelection } from './source-caret';
import type { SourceDocumentModel } from './source-document-model';

export const VIRTUAL_SOURCE_CHARACTER_THRESHOLD = 384_000;
export const VIRTUAL_SOURCE_LINE_THRESHOLD = 5_000;
export const VIRTUAL_SOURCE_OVERSCAN_LINES = 24;

export interface SourceViewportRange {
  endLine: number;
  startLine: number;
}

export function shouldVirtualizeSource(source: string): boolean {
  if (source.length >= VIRTUAL_SOURCE_CHARACTER_THRESHOLD) {
    return true;
  }

  let offset = -1;
  for (let line = 1; line < VIRTUAL_SOURCE_LINE_THRESHOLD; line += 1) {
    offset = source.indexOf('\n', offset + 1);
    if (offset === -1) {
      return false;
    }
  }
  return true;
}

export function sourceViewportRange(
  scrollTop: number,
  clientHeight: number,
  lineHeight: number,
  lineCount: number,
  overscan = VIRTUAL_SOURCE_OVERSCAN_LINES,
): SourceViewportRange {
  if (lineCount <= 0) {
    return { endLine: 0, startLine: 0 };
  }
  const safeLineHeight = Math.max(1, lineHeight);
  const first = Math.min(
    lineCount - 1,
    Math.max(0, Math.floor(scrollTop / safeLineHeight)),
  );
  const visible = Math.max(1, Math.ceil(clientHeight / safeLineHeight));
  return {
    endLine: Math.min(lineCount, first + visible + overscan),
    startLine: Math.max(0, first - overscan),
  };
}

export function sourceSelectionFocus(selection: SourceSelection): number {
  return selection.direction === 'backward'
    ? selection.start
    : selection.end;
}

export function sourceSelectionAnchor(selection: SourceSelection): number {
  return selection.direction === 'backward'
    ? selection.end
    : selection.start;
}

export function sourceOffsetInLine(
  model: SourceDocumentModel,
  lineIndex: number,
  column: number,
): number {
  const index = Math.min(
    Math.max(0, lineIndex),
    Math.max(0, model.lines.length - 1),
  );
  return (
    (model.lineStarts[index] ?? 0) +
    Math.min(Math.max(0, column), model.lines[index]?.source.length ?? 0)
  );
}

export function sourceLineColumn(
  model: SourceDocumentModel,
  offset: number,
): { column: number; lineIndex: number } {
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
  const lineIndex = Math.max(0, high);
  return {
    column: Math.min(
      target - (model.lineStarts[lineIndex] ?? 0),
      model.lines[lineIndex]?.source.length ?? 0,
    ),
    lineIndex,
  };
}
