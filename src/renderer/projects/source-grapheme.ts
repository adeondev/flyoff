let segmenter: Intl.Segmenter | null | undefined;

function graphemeSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;
  }
  return segmenter;
}

function previousCodePointBoundary(value: string, offset: number): number {
  if (offset <= 0) {
    return 0;
  }
  const previous = value.charCodeAt(offset - 1);
  return previous >= 0xdc00 &&
    previous <= 0xdfff &&
    offset > 1 &&
    value.charCodeAt(offset - 2) >= 0xd800 &&
    value.charCodeAt(offset - 2) <= 0xdbff
    ? offset - 2
    : offset - 1;
}

function nextCodePointBoundary(value: string, offset: number): number {
  if (offset >= value.length) {
    return value.length;
  }
  const current = value.charCodeAt(offset);
  return current >= 0xd800 &&
    current <= 0xdbff &&
    offset + 1 < value.length &&
    value.charCodeAt(offset + 1) >= 0xdc00 &&
    value.charCodeAt(offset + 1) <= 0xdfff
    ? offset + 2
    : offset + 1;
}

export function previousGraphemeBoundary(
  value: string,
  offset: number,
): number {
  const bounded = Math.min(Math.max(0, offset), value.length);
  if (bounded <= 0) {
    return 0;
  }
  if (value.charCodeAt(bounded - 1) === 0x0a) {
    return bounded > 1 && value.charCodeAt(bounded - 2) === 0x0d
      ? bounded - 2
      : bounded - 1;
  }
  const activeSegmenter = graphemeSegmenter();
  if (activeSegmenter) {
    const start = value.lastIndexOf('\n', bounded - 1) + 1;
    const nextBreak = value.indexOf('\n', bounded);
    const line = value.slice(
      start,
      nextBreak === -1 ? value.length : nextBreak,
    );
    const segment = activeSegmenter
      .segment(line)
      .containing(bounded - start - 1);
    if (segment) {
      return start + segment.index;
    }
  }
  return previousCodePointBoundary(value, bounded);
}

export function nextGraphemeBoundary(
  value: string,
  offset: number,
): number {
  const bounded = Math.min(Math.max(0, offset), value.length);
  if (bounded >= value.length) {
    return value.length;
  }
  if (value.charCodeAt(bounded) === 0x0d) {
    return bounded + (value.charCodeAt(bounded + 1) === 0x0a ? 2 : 1);
  }
  if (value.charCodeAt(bounded) === 0x0a) {
    return bounded + 1;
  }
  const activeSegmenter = graphemeSegmenter();
  if (activeSegmenter) {
    const start = value.lastIndexOf('\n', Math.max(0, bounded - 1)) + 1;
    const nextBreak = value.indexOf('\n', bounded);
    const line = value.slice(
      start,
      nextBreak === -1 ? value.length : nextBreak,
    );
    const segment = activeSegmenter.segment(line).containing(bounded - start);
    if (segment) {
      return start + segment.index + segment.segment.length;
    }
  }
  return nextCodePointBoundary(value, bounded);
}
