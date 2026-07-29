import type { SourceSelection } from './source-caret';
import { sourceLineIndexAtIndexedOffset } from './source-line-index';

export interface SourcePositionStatus {
  line: number;
  column: number;
  selected: number;
}

interface SourcePositionIndex {
  content: string;
  crlfOffsets: number[];
  graphemeBlocks: Map<number, number>;
  lineGraphemes: Map<number, number>;
  lineStarts: readonly number[];
  simpleGraphemes?: boolean;
}

const INDEX_CACHE_LIMIT = 4;
const INDEX_CACHE_UNIT_LIMIT = 16 * 1_024 * 1_024;
const GRAPHEME_BLOCK_LINES = 128;
const COMPLEX_GRAPHEME = /[\u0300-\u{10ffff}]/u;
const indexCache: SourcePositionIndex[] = [];
const indexedPositionCache = new WeakMap<
  readonly number[],
  SourcePositionIndex
>();
let cachedUnits = 0;
let segmenter: Intl.Segmenter | null | undefined;

function createIndex(
  content: string,
  lineStarts: readonly number[],
): SourcePositionIndex {
  return {
    content,
    crlfOffsets: [],
    graphemeBlocks: new Map(),
    lineGraphemes: new Map(),
    lineStarts,
  };
}

function buildIndex(content: string): SourcePositionIndex {
  const lineStarts = [0];
  let lineBreak = content.indexOf('\n');
  while (lineBreak !== -1) {
    lineStarts.push(lineBreak + 1);
    lineBreak = content.indexOf('\n', lineBreak + 1);
  }
  return createIndex(content, lineStarts);
}

function sourcePositionIndex(
  content: string,
  indexedLineStarts?: readonly number[],
): SourcePositionIndex {
  if (indexedLineStarts) {
    const cached = indexedPositionCache.get(indexedLineStarts);
    if (cached?.content === content) {
      return cached;
    }
    const index = createIndex(content, indexedLineStarts);
    indexedPositionCache.set(indexedLineStarts, index);
    return index;
  }

  const cachedIndex = indexCache.findIndex(
    (candidate) => candidate.content === content,
  );
  if (cachedIndex !== -1) {
    const cached = indexCache[cachedIndex]!;
    if (cachedIndex < indexCache.length - 1) {
      indexCache.splice(cachedIndex, 1);
      indexCache.push(cached);
    }
    return cached;
  }

  const index = buildIndex(content);
  if (content.length > INDEX_CACHE_UNIT_LIMIT) {
    return index;
  }
  indexCache.push(index);
  cachedUnits += content.length;
  while (
    indexCache.length > INDEX_CACHE_LIMIT ||
    cachedUnits > INDEX_CACHE_UNIT_LIMIT
  ) {
    cachedUnits -= indexCache.shift()!.content.length;
  }
  return index;
}

function lineIndexAtOffset(
  lineStarts: readonly number[],
  offset: number,
): number {
  const indexed = sourceLineIndexAtIndexedOffset(lineStarts, offset);
  if (indexed !== undefined) {
    return indexed;
  }
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (lineStarts[middle]! <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return Math.max(0, high);
}

function graphemeCount(
  value: string,
  start: number,
  end: number,
): number {
  if (start >= end) {
    return 0;
  }
  let allSimple = true;
  let simpleCount = end - start;
  for (let index = start; index < end; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0x02ff) {
      allSimple = false;
      break;
    }
    if (
      code === 0x0d &&
      index + 1 < end &&
      value.charCodeAt(index + 1) === 0x0a
    ) {
      simpleCount -= 1;
    }
  }
  if (allSimple) {
    return simpleCount;
  }
  if (segmenter === undefined) {
    segmenter =
      typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;
  }
  if (segmenter) {
    let count = 0;
    for (const grapheme of segmenter.segment(value.slice(start, end))) {
      count += grapheme.segment.length > 0 ? 1 : 0;
    }
    return count;
  }

  let count = 0;
  for (let index = start; index < end; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < end
    ) {
      const trailing = value.charCodeAt(index + 1);
      if (trailing >= 0xdc00 && trailing <= 0xdfff) {
        index += 1;
      }
    }
    count += 1;
  }
  return count;
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function simpleSelectionGraphemeCount(
  index: SourcePositionIndex,
  start: number,
  end: number,
): number | undefined {
  const length = end - start;
  if (
    length < 4_096 ||
    length * 2 < index.content.length
  ) {
    return undefined;
  }
  if (index.simpleGraphemes === undefined) {
    index.simpleGraphemes = !COMPLEX_GRAPHEME.test(index.content);
    if (index.simpleGraphemes) {
      let offset = index.content.indexOf('\r\n');
      while (offset !== -1) {
        index.crlfOffsets.push(offset);
        offset = index.content.indexOf('\r\n', offset + 2);
      }
    }
  }
  if (!index.simpleGraphemes) {
    return undefined;
  }
  const firstPair = lowerBound(index.crlfOffsets, start);
  const afterLastPair = lowerBound(index.crlfOffsets, end - 1);
  return length - (afterLastPair - firstPair);
}

function lineGraphemeCount(
  index: SourcePositionIndex,
  lineStarts: readonly number[],
  line: number,
): number {
  const cached = index.lineGraphemes.get(line);
  if (cached !== undefined) {
    return cached;
  }
  const count = graphemeCount(
    index.content,
    lineStarts[line]!,
    lineStarts[line + 1] ?? index.content.length,
  );
  index.lineGraphemes.set(line, count);
  return count;
}

function graphemeBlockCount(
  index: SourcePositionIndex,
  lineStarts: readonly number[],
  block: number,
): number {
  const cached = index.graphemeBlocks.get(block);
  if (cached !== undefined) {
    return cached;
  }
  const start = block * GRAPHEME_BLOCK_LINES;
  const end = Math.min(start + GRAPHEME_BLOCK_LINES, lineStarts.length);
  let count = 0;
  for (let line = start; line < end; line += 1) {
    count += graphemeCount(
      index.content,
      lineStarts[line]!,
      lineStarts[line + 1] ?? index.content.length,
    );
  }
  index.graphemeBlocks.set(block, count);
  return count;
}

function lineRangeGraphemeCount(
  index: SourcePositionIndex,
  lineStarts: readonly number[],
  start: number,
  end: number,
): number {
  let count = 0;
  let line = start;
  while (line < end) {
    if (line % GRAPHEME_BLOCK_LINES === 0) {
      const block = Math.floor(line / GRAPHEME_BLOCK_LINES);
      const blockEnd = Math.min(
        line + GRAPHEME_BLOCK_LINES,
        lineStarts.length,
      );
      if (blockEnd <= end) {
        count += graphemeBlockCount(index, lineStarts, block);
        line = blockEnd;
        continue;
      }
    }
    count += lineGraphemeCount(index, lineStarts, line);
    line += 1;
  }
  return count;
}

function selectionGraphemeCount(
  index: SourcePositionIndex,
  lineStarts: readonly number[],
  start: number,
  end: number,
): number {
  if (start >= end) {
    return 0;
  }
  const simpleCount = simpleSelectionGraphemeCount(index, start, end);
  if (simpleCount !== undefined) {
    return simpleCount;
  }
  const startLine = lineIndexAtOffset(lineStarts, start);
  const endLine = lineIndexAtOffset(lineStarts, end);
  if (startLine === endLine) {
    return graphemeCount(index.content, start, end);
  }
  return (
    graphemeCount(index.content, start, lineStarts[startLine + 1]!) +
    lineRangeGraphemeCount(
      index,
      lineStarts,
      startLine + 1,
      endLine,
    ) +
    graphemeCount(index.content, lineStarts[endLine]!, end)
  );
}

export function sourcePositionStatus(
  content: string,
  selection: SourceSelection,
  indexedLineStarts?: readonly number[],
): SourcePositionStatus {
  const start = Math.min(Math.max(0, selection.start), content.length);
  const end = Math.min(Math.max(start, selection.end), content.length);
  if (!indexedLineStarts && start === 0 && end === 0) {
    return { line: 1, column: 1, selected: 0 };
  }
  const focus = selection.direction === 'backward' ? start : end;
  const index = sourcePositionIndex(content, indexedLineStarts);
  const lineStarts = indexedLineStarts ?? index.lineStarts;
  const lineIndex = lineIndexAtOffset(lineStarts, focus);
  const lineStart = lineStarts[lineIndex]!;

  return {
    line: lineIndex + 1,
    column: graphemeCount(content, lineStart, focus) + 1,
    selected: selectionGraphemeCount(index, lineStarts, start, end),
  };
}
