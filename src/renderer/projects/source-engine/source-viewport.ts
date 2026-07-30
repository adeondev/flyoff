import type { SourceHeightMap } from './source-height-map';

export const SOURCE_VIEWPORT_MAX_LINES = 300;

export type SourceViewportHeightMap = Pick<
  SourceHeightMap,
  'indexAtOffset' | 'length' | 'offsetAtIndex' | 'totalHeight'
>;

export interface SourceViewportOptions {
  maximumLines?: number;
  overscan?: number;
  scrollTop: number;
  viewportHeight: number;
}

export interface SourceViewport {
  endLine: number;
  startLine: number;
  top: number;
  totalHeight: number;
}

function finiteExtent(value: number, fallback: number): number {
  if (value === Number.POSITIVE_INFINITY) {
    return fallback;
  }
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function maximumLineCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return SOURCE_VIEWPORT_MAX_LINES;
  }
  return Math.max(1, Math.trunc(value));
}

function mapLength(heightMap: SourceViewportHeightMap): number {
  return Number.isFinite(heightMap.length)
    ? Math.max(0, Math.trunc(heightMap.length))
    : 0;
}

function mapTotalHeight(heightMap: SourceViewportHeightMap): number {
  return Number.isFinite(heightMap.totalHeight)
    ? Math.max(0, heightMap.totalHeight)
    : 0;
}

function lineAtOffset(
  heightMap: SourceViewportHeightMap,
  offset: number,
  length: number,
): number {
  const index = heightMap.indexAtOffset(offset);
  if (!Number.isFinite(index)) {
    return 0;
  }
  return Math.min(length - 1, Math.max(0, Math.trunc(index)));
}

function offsetAtLine(
  heightMap: SourceViewportHeightMap,
  index: number,
  totalHeight: number,
): number {
  const offset = heightMap.offsetAtIndex(index);
  return Number.isFinite(offset)
    ? Math.min(totalHeight, Math.max(0, offset))
    : 0;
}

function endLineAtOffset(
  heightMap: SourceViewportHeightMap,
  offset: number,
  length: number,
  totalHeight: number,
): number {
  if (offset >= totalHeight) {
    return length;
  }
  const line = lineAtOffset(heightMap, offset, length);
  return offsetAtLine(heightMap, line, totalHeight) < offset
    ? line + 1
    : line;
}

export function sourceViewport(
  heightMap: SourceViewportHeightMap,
  options: SourceViewportOptions,
): SourceViewport {
  const length = mapLength(heightMap);
  const totalHeight = mapTotalHeight(heightMap);
  if (length === 0) {
    return { endLine: 0, startLine: 0, top: 0, totalHeight };
  }

  const lineLimit = Math.min(
    length,
    maximumLineCount(options.maximumLines),
  );
  if (totalHeight === 0) {
    return {
      endLine: lineLimit,
      startLine: 0,
      top: 0,
      totalHeight,
    };
  }

  const scrollTop =
    options.scrollTop === Number.POSITIVE_INFINITY
      ? totalHeight
      : Math.min(
          totalHeight,
          finiteExtent(options.scrollTop, totalHeight),
        );
  const viewportHeight = finiteExtent(
    options.viewportHeight,
    totalHeight,
  );
  const overscan = finiteExtent(options.overscan ?? 0, totalHeight);
  const visibleBottom = Math.min(
    totalHeight,
    scrollTop + viewportHeight,
  );
  const rangeTop = Math.max(0, scrollTop - overscan);
  const rangeBottom = Math.min(totalHeight, visibleBottom + overscan);
  const visibleStart = lineAtOffset(heightMap, scrollTop, length);
  const visibleEnd = Math.max(
    visibleStart + 1,
    endLineAtOffset(
      heightMap,
      visibleBottom,
      length,
      totalHeight,
    ),
  );
  const requestedStart = lineAtOffset(heightMap, rangeTop, length);
  const requestedEnd = Math.max(
    requestedStart + 1,
    endLineAtOffset(
      heightMap,
      rangeBottom,
      length,
      totalHeight,
    ),
  );

  let startLine = requestedStart;
  let endLine = Math.min(length, requestedEnd);
  const visibleLineCount = visibleEnd - visibleStart;
  if (visibleLineCount >= lineLimit) {
    startLine = Math.min(visibleStart, length - lineLimit);
    endLine = startLine + lineLimit;
  } else if (endLine - startLine > lineLimit) {
    const availableOverscan = lineLimit - visibleLineCount;
    const requestedBefore = visibleStart - requestedStart;
    const requestedAfter = requestedEnd - visibleEnd;
    let before = Math.min(
      requestedBefore,
      Math.floor(availableOverscan / 2),
    );
    let after = Math.min(
      requestedAfter,
      availableOverscan - before,
    );
    let remaining = availableOverscan - before - after;
    const extraBefore = Math.min(requestedBefore - before, remaining);
    before += extraBefore;
    remaining -= extraBefore;
    after += Math.min(requestedAfter - after, remaining);
    startLine = visibleStart - before;
    endLine = visibleEnd + after;
  }

  endLine = Math.min(length, Math.max(startLine + 1, endLine));
  startLine = Math.max(0, Math.min(startLine, endLine - 1));
  return {
    endLine,
    startLine,
    top: offsetAtLine(heightMap, startLine, totalHeight),
    totalHeight,
  };
}
