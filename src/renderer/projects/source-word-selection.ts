import type { SourceSelection } from './source-caret';
import { parseImageDirectiveAt } from '../../shared/markdown';

const WORD_CORE = /^[\p{L}\p{M}\p{N}_]$/u;
const WORD_JOINER = /^['\u2019_-]$/u;
const DECIMAL_DIGIT = /^\p{Nd}$/u;
const NUMERIC_JOINER = /^[.,:/-]$/u;

interface CodePointSpan {
  end: number;
  start: number;
  value: string;
}

interface SourceRange {
  end: number;
  start: number;
}

function codePointAt(source: string, offset: number): CodePointSpan | undefined {
  if (offset < 0 || offset >= source.length) {
    return undefined;
  }
  const value = String.fromCodePoint(source.codePointAt(offset)!);
  return { end: offset + value.length, start: offset, value };
}

function codePointBefore(
  source: string,
  offset: number,
): CodePointSpan | undefined {
  if (offset <= 0) {
    return undefined;
  }
  const trailing = source.charCodeAt(offset - 1);
  const start =
    trailing >= 0xdc00 &&
    trailing <= 0xdfff &&
    offset > 1 &&
    source.charCodeAt(offset - 2) >= 0xd800 &&
    source.charCodeAt(offset - 2) <= 0xdbff
      ? offset - 2
      : offset - 1;
  return codePointAt(source, start);
}

function firstWordCore(
  source: string,
  start: number,
  end: number,
): CodePointSpan | undefined {
  let offset = start;
  while (offset < end) {
    const current = codePointAt(source, offset);
    if (!current) {
      return undefined;
    }
    if (WORD_CORE.test(current.value)) {
      return current;
    }
    offset = current.end;
  }
  return undefined;
}

function segmentWordAt(source: string, offset: number): SourceRange | undefined {
  if (typeof Intl.Segmenter !== 'function') {
    return undefined;
  }
  const segment = new Intl.Segmenter(undefined, { granularity: 'word' })
    .segment(source)
    .containing(offset);
  return segment?.isWordLike
    ? { start: segment.index, end: segment.index + segment.segment.length }
    : undefined;
}

function expandCore(source: string, range: SourceRange): SourceRange {
  let { start, end } = range;
  let previous = codePointBefore(source, start);
  while (previous && WORD_CORE.test(previous.value)) {
    start = previous.start;
    previous = codePointBefore(source, start);
  }

  let next = codePointAt(source, end);
  while (next && WORD_CORE.test(next.value)) {
    end = next.end;
    next = codePointAt(source, end);
  }
  return { start, end };
}

function expandWord(source: string, initial: SourceRange): SourceRange {
  let { start, end } = expandCore(source, initial);

  while (start > 0) {
    const joiner = codePointBefore(source, start);
    const core = joiner ? codePointBefore(source, joiner.start) : undefined;
    if (!joiner || !core || !WORD_JOINER.test(joiner.value) || !WORD_CORE.test(core.value)) {
      break;
    }
    start = expandCore(source, { start: core.start, end }).start;
  }

  while (end < source.length) {
    const joiner = codePointAt(source, end);
    const core = joiner ? codePointAt(source, joiner.end) : undefined;
    if (!joiner || !core || !WORD_JOINER.test(joiner.value) || !WORD_CORE.test(core.value)) {
      break;
    }
    end = expandCore(source, { start, end: core.end }).end;
  }

  return { start, end };
}

function expandDigitRun(source: string, probe: CodePointSpan): SourceRange {
  let start = probe.start;
  let end = probe.end;
  let previous = codePointBefore(source, start);
  while (previous && DECIMAL_DIGIT.test(previous.value)) {
    start = previous.start;
    previous = codePointBefore(source, start);
  }

  let next = codePointAt(source, end);
  while (next && DECIMAL_DIGIT.test(next.value)) {
    end = next.end;
    next = codePointAt(source, end);
  }

  return { start, end };
}

function expandDigits(source: string, probe: CodePointSpan): SourceRange {
  let { start, end } = expandDigitRun(source, probe);

  while (start > 0) {
    const joiner = codePointBefore(source, start);
    const digit = joiner ? codePointBefore(source, joiner.start) : undefined;
    if (!joiner || !digit || !NUMERIC_JOINER.test(joiner.value) || !DECIMAL_DIGIT.test(digit.value)) {
      break;
    }
    start = expandDigitRun(source, digit).start;
  }

  while (end < source.length) {
    const joiner = codePointAt(source, end);
    const digit = joiner ? codePointAt(source, joiner.end) : undefined;
    if (!joiner || !digit || !NUMERIC_JOINER.test(joiner.value) || !DECIMAL_DIGIT.test(digit.value)) {
      break;
    }
    end = expandDigitRun(source, digit).end;
  }

  return { start, end };
}

function normalizedSelection(
  source: string,
  selection: SourceSelection,
): SourceSelection {
  const start = Math.min(Math.max(0, selection.start), source.length);
  const end = Math.min(Math.max(start, selection.end), source.length);
  return {
    start,
    end,
    direction:
      start === end
        ? 'none'
        : selection.direction === 'backward'
          ? 'backward'
          : 'forward',
  };
}

export function expandDoubleClickSelection(
  source: string,
  selection: SourceSelection,
): SourceSelection {
  const normalized = normalizedSelection(source, selection);
  let probe = firstWordCore(source, normalized.start, normalized.end);
  if (!probe && normalized.start < normalized.end) {
    const selected = source.slice(normalized.start, normalized.end);
    const before = codePointBefore(source, normalized.start);
    const after = codePointAt(source, normalized.end);
    if (
      /^[.,:/-]+$/u.test(selected) &&
      before &&
      after &&
      DECIMAL_DIGIT.test(before.value) &&
      DECIMAL_DIGIT.test(after.value)
    ) {
      probe = before;
    }
  }
  if (!probe && normalized.start === normalized.end) {
    const atCaret = codePointAt(source, normalized.start);
    const beforeCaret = codePointBefore(source, normalized.start);
    probe =
      atCaret && WORD_CORE.test(atCaret.value)
        ? atCaret
        : beforeCaret && WORD_CORE.test(beforeCaret.value)
          ? beforeCaret
          : undefined;
  }
  if (!probe) {
    return normalized;
  }

  const segmented = segmentWordAt(source, probe.start) ?? {
    start: probe.start,
    end: probe.end,
  };
  const containsWordLetter = /[\p{L}\p{M}_]/u.test(
    source.slice(segmented.start, segmented.end),
  );
  const range =
    DECIMAL_DIGIT.test(probe.value) && !containsWordLetter
      ? expandDigits(source, probe)
      : expandWord(source, segmented);
  return { ...range, direction: 'forward' };
}

export function expandTripleClickSelection(
  source: string,
  selection: SourceSelection,
): SourceSelection {
  const normalized = normalizedSelection(source, selection);
  let probe = normalized.start;
  if (
    probe > 0 &&
    source[probe] === '\n' &&
    source[probe - 1] === '\r'
  ) {
    probe -= 1;
  }

  let start = probe;
  while (
    start > 0 &&
    source[start - 1] !== '\n' &&
    source[start - 1] !== '\r'
  ) {
    start -= 1;
  }

  let end = probe;
  while (
    end < source.length &&
    source[end] !== '\n' &&
    source[end] !== '\r'
  ) {
    end += 1;
  }

  if (start === end) {
    return normalized;
  }

  const line = source.slice(start, end);
  if (/^\s*::(?:image|media)\[/.test(line)) {
    return normalized;
  }
  const prefix =
    /^(?:\s{0,3}(?:#{1,6}(?:--)?|>|[-*+]|\d{1,9}[.)])\s+)(?:\[[ xX]\]\s+)?/.exec(
      line,
    )?.[0].length ?? 0;
  const visible: string[] = [];
  const offsets: number[] = [];
  let index = prefix;

  const append = (from: number, to: number): void => {
    for (let cursor = from; cursor < to; cursor += 1) {
      visible.push(line[cursor]!);
      offsets.push(cursor);
    }
  };

  while (index < line.length) {
    if (line[index] === '`') {
      const close = line.indexOf('`', index + 1);
      if (probe - start >= index && (close === -1 || probe - start <= close)) {
        return normalized;
      }
      index = close === -1 ? line.length : close + 1;
      continue;
    }
    if (line.startsWith('::image[', index)) {
      const parsed = parseImageDirectiveAt(line, index);
      if (parsed) {
        if (
          probe - start >= parsed.start &&
          probe - start <= parsed.end
        ) {
          return normalized;
        }
        index = parsed.end;
        continue;
      }
    }
    if (line.startsWith('[[', index)) {
      const close = line.indexOf(']]', index + 2);
      if (close !== -1) {
        const inside = line.slice(index + 2, close);
        const alias = inside.indexOf('|');
        const labelStart = index + 2 + (alias === -1 ? 0 : alias + 1);
        append(labelStart, close);
        index = close + 2;
        const attribute = /^\{color\s*=[^}]+\}/.exec(line.slice(index));
        index += attribute?.[0].length ?? 0;
        continue;
      }
    }
    if (line[index] === '[') {
      const labelEnd = line.indexOf(']', index + 1);
      if (labelEnd !== -1 && line[labelEnd + 1] === '(') {
        const destinationEnd = line.indexOf(')', labelEnd + 2);
        if (destinationEnd !== -1) {
          append(index + 1, labelEnd);
          index = destinationEnd + 1;
          const attribute = /^\{color\s*=[^}]+\}/.exec(line.slice(index));
          index += attribute?.[0].length ?? 0;
          continue;
        }
      }
    }
    const pair = ['**', '__', '~~', '=='].find((value) =>
      line.startsWith(value, index),
    );
    if (pair) {
      index += pair.length;
      continue;
    }
    if (line[index] === '*' || line[index] === '_') {
      index += 1;
      continue;
    }
    append(index, index + 1);
    index += 1;
  }

  if (visible.length === 0) {
    return normalized;
  }
  const localProbe = Math.max(prefix, probe - start);
  let visibleProbe = offsets.findIndex((offset) => offset >= localProbe);
  if (visibleProbe === -1) {
    visibleProbe = visible.length - 1;
  }
  const text = visible.join('');
  const segment =
    typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'sentence' })
          .segment(text)
          .containing(visibleProbe)
      : undefined;
  let visibleStart = segment?.index ?? 0;
  let visibleEnd = segment
    ? segment.index + segment.segment.length
    : text.length;
  while (visibleStart < visibleEnd && /\s/.test(text[visibleStart]!)) {
    visibleStart += 1;
  }
  while (visibleEnd > visibleStart && /\s/.test(text[visibleEnd - 1]!)) {
    visibleEnd -= 1;
  }
  const rawStart = offsets[visibleStart];
  const rawEndOffset = offsets[visibleEnd - 1];
  if (rawStart === undefined || rawEndOffset === undefined) {
    return normalized;
  }
  let safeStart = rawStart;
  const safeEnd = rawEndOffset + line[rawEndOffset]!.length;
  for (const delimiter of ['**', '__', '~~', '==']) {
    if (
      line.slice(0, safeStart).endsWith(delimiter) &&
      line.indexOf(delimiter, safeStart) < safeEnd
    ) {
      safeStart -= delimiter.length;
      break;
    }
  }
  const wikiStart = line.lastIndexOf('[[', safeStart);
  const wikiEnd = line.indexOf(']]', safeStart);
  if (wikiStart >= prefix && wikiStart < safeStart && wikiEnd < safeEnd) {
    safeStart = wikiStart;
  } else {
    const linkStart = line.lastIndexOf('[', safeStart);
    const linkLabelEnd = line.indexOf('](', safeStart);
    const linkEnd =
      linkLabelEnd === -1 ? -1 : line.indexOf(')', linkLabelEnd + 2);
    if (
      linkStart >= prefix &&
      linkStart < safeStart &&
      linkEnd !== -1 &&
      linkEnd < safeEnd
    ) {
      safeStart = linkStart;
    }
  }
  return {
    start: start + safeStart,
    end: start + safeEnd,
    direction: 'forward',
  };
}
