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
  if (typeof Intl.Segmenter === 'function') {
    const segment = new Intl.Segmenter(undefined, {
      granularity: 'grapheme',
    })
      .segment(value)
      .containing(bounded - 1);
    if (segment) {
      return segment.index;
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
  if (typeof Intl.Segmenter === 'function') {
    const segment = new Intl.Segmenter(undefined, {
      granularity: 'grapheme',
    })
      .segment(value)
      .containing(bounded);
    if (segment) {
      return segment.index + segment.segment.length;
    }
  }
  return nextCodePointBoundary(value, bounded);
}
