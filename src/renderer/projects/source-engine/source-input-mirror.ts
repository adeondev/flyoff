import type {
  SourceViewSelection,
  SourceViewSelectionDirection,
} from './source-view-adapter';

export const SOURCE_INPUT_MIRROR_MAX_CODE_UNITS = 8_192;

export interface SourceInputMirror {
  end: number;
  selectionDirection: SourceViewSelectionDirection;
  selectionEnd: number;
  selectionMapped: boolean;
  selectionStart: number;
  sourceOffsets?: readonly number[];
  sourceSelection: SourceViewSelection;
  start: number;
  value: string;
}

export interface SourceInputMirrorEdit {
  content: string;
  inserted: string;
  selection: SourceViewSelection;
}

export type SourceInputMirrorSelection = SourceViewSelection;

interface SourceInputMirrorDiff {
  nextEnd: number;
  start: number;
  valueEnd: number;
}

interface NormalizedSourceWindow {
  sourceOffsets?: readonly number[];
  value: string;
}

function clampedOffset(value: number, length: number): number {
  if (value === Number.POSITIVE_INFINITY) {
    return length;
  }
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(length, Math.max(0, Math.trunc(value)));
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function splitsSourceUnit(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) {
    return false;
  }
  return (
    (value.charCodeAt(offset - 1) === 0x0d &&
      value.charCodeAt(offset) === 0x0a) ||
    (isHighSurrogate(value.charCodeAt(offset - 1)) &&
      isLowSurrogate(value.charCodeAt(offset)))
  );
}

function normalizedDirection(
  direction: SourceViewSelectionDirection,
  start: number,
  end: number,
): SourceViewSelectionDirection {
  if (start === end) {
    return 'none';
  }
  return direction === 'backward' ? 'backward' : 'forward';
}

function normalizedSelection(
  value: string,
  selection: SourceViewSelection,
): SourceViewSelection {
  const first = clampedOffset(selection.start, value.length);
  const second = clampedOffset(selection.end, value.length);
  let start = Math.min(first, second);
  let end = Math.max(first, second);
  if (start === end) {
    if (splitsSourceUnit(value, start)) {
      start -= 1;
      end = start;
    }
  } else {
    if (splitsSourceUnit(value, start)) {
      start -= 1;
    }
    if (splitsSourceUnit(value, end)) {
      end += 1;
    }
  }
  return {
    direction: normalizedDirection(selection.direction, start, end),
    end,
    start,
  };
}

function normalizedMaximum(maxCodeUnits: number): number {
  if (!Number.isFinite(maxCodeUnits)) {
    return SOURCE_INPUT_MIRROR_MAX_CODE_UNITS;
  }
  return Math.min(
    SOURCE_INPUT_MIRROR_MAX_CODE_UNITS,
    Math.max(2, Math.trunc(maxCodeUnits)),
  );
}

function normalizedSourceWindow(
  source: string,
  start: number,
  end: number,
): NormalizedSourceWindow {
  const raw = source.slice(start, end);
  const normalized = raw.replace(/\r\n?/g, '\n');
  if (raw.length === normalized.length) {
    return { value: normalized };
  }
  const value: string[] = [];
  const sourceOffsets = [start];
  let offset = start;
  while (offset < end) {
    if (source.charCodeAt(offset) === 0x0d) {
      offset +=
        offset + 1 < end && source.charCodeAt(offset + 1) === 0x0a ? 2 : 1;
      value.push('\n');
    } else {
      value.push(source[offset]!);
      offset += 1;
    }
    sourceOffsets.push(offset);
  }
  return { sourceOffsets, value: value.join('') };
}

function mirrorOffsetAtSourceOffset(
  sourceOffsets: readonly number[] | undefined,
  sourceOffset: number,
  sourceStart: number,
  valueLength: number,
): number {
  if (!sourceOffsets) {
    return clampedOffset(sourceOffset - sourceStart, valueLength);
  }
  const target = Math.min(
    sourceOffsets.at(-1) ?? 0,
    Math.max(sourceOffsets[0] ?? 0, sourceOffset),
  );
  let low = 0;
  let high = sourceOffsets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sourceOffsets[middle]! < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  if (sourceOffsets[low] === target) {
    return low;
  }
  return Math.max(0, low - 1);
}

function sourceOffsetAtWindowOffset(
  sourceOffsets: readonly number[] | undefined,
  sourceStart: number,
  valueLength: number,
  windowOffset: number,
): number {
  const offset = clampedOffset(windowOffset, valueLength);
  return sourceOffsets?.[offset] ?? sourceStart + offset;
}

function sourceOffsetAtMirrorOffset(
  mirror: SourceInputMirror,
  mirrorOffset: number,
): number {
  return sourceOffsetAtWindowOffset(
    mirror.sourceOffsets,
    mirror.start,
    mirror.value.length,
    mirrorOffset,
  );
}

function selectionFocus(selection: SourceViewSelection): number {
  return selection.direction === 'backward'
    ? selection.start
    : selection.end;
}

function mirrorDiff(value: string, nextValue: string): SourceInputMirrorDiff {
  const sharedLength = Math.min(value.length, nextValue.length);
  let start = 0;
  while (start < sharedLength && value[start] === nextValue[start]) {
    start += 1;
  }
  while (
    start > 0 &&
    (splitsSourceUnit(value, start) ||
      splitsSourceUnit(nextValue, start))
  ) {
    start -= 1;
  }

  let suffix = 0;
  while (
    suffix < value.length - start &&
    suffix < nextValue.length - start &&
    value[value.length - suffix - 1] ===
      nextValue[nextValue.length - suffix - 1]
  ) {
    suffix += 1;
  }
  while (
    suffix > 0 &&
    (splitsSourceUnit(value, value.length - suffix) ||
      splitsSourceUnit(nextValue, nextValue.length - suffix))
  ) {
    suffix -= 1;
  }
  return {
    nextEnd: nextValue.length - suffix,
    start,
    valueEnd: value.length - suffix,
  };
}

export function createSourceInputMirror(
  source: string,
  selection: SourceViewSelection,
  maxCodeUnits = SOURCE_INPUT_MIRROR_MAX_CODE_UNITS,
): SourceInputMirror {
  const sourceSelection = normalizedSelection(source, selection);
  const maximum = normalizedMaximum(maxCodeUnits);
  const focus = selectionFocus(sourceSelection);
  const selectionMapped =
    sourceSelection.end - sourceSelection.start <= maximum;
  const requiredStart = selectionMapped ? sourceSelection.start : focus;
  const requiredEnd = selectionMapped ? sourceSelection.end : focus;
  const lowestStart = Math.max(0, requiredEnd - maximum);
  const highestStart = Math.min(
    requiredStart,
    Math.max(0, source.length - maximum),
  );
  const preferredStart = focus - Math.floor(maximum / 2);
  let start = Math.min(
    highestStart,
    Math.max(lowestStart, preferredStart),
  );
  let end = Math.min(source.length, start + maximum);
  if (splitsSourceUnit(source, start)) {
    start += 1;
  }
  if (splitsSourceUnit(source, end)) {
    end -= 1;
  }

  const normalized = normalizedSourceWindow(source, start, end);
  const localFocus = mirrorOffsetAtSourceOffset(
    normalized.sourceOffsets,
    focus,
    start,
    normalized.value.length,
  );
  const selectionStart = selectionMapped
    ? mirrorOffsetAtSourceOffset(
        normalized.sourceOffsets,
        sourceSelection.start,
        start,
        normalized.value.length,
      )
    : localFocus;
  const selectionEnd = selectionMapped
    ? mirrorOffsetAtSourceOffset(
        normalized.sourceOffsets,
        sourceSelection.end,
        start,
        normalized.value.length,
      )
    : localFocus;
  return {
    end,
    selectionDirection: selectionMapped
      ? sourceSelection.direction
      : 'none',
    selectionEnd,
    selectionMapped,
    selectionStart,
    sourceOffsets: normalized.sourceOffsets,
    sourceSelection,
    start,
    value: normalized.value,
  };
}

export function sourceSelectionFromMirror(
  mirror: SourceInputMirror,
  localStart: number,
  localEnd: number,
  direction: SourceViewSelectionDirection,
): SourceViewSelection {
  const local = normalizedSelection(mirror.value, {
    direction,
    end: localEnd,
    start: localStart,
  });
  if (
    !mirror.selectionMapped &&
    local.start === mirror.selectionStart &&
    local.end === mirror.selectionEnd &&
    local.direction === mirror.selectionDirection
  ) {
    return mirror.sourceSelection;
  }
  return {
    direction: local.direction,
    end: sourceOffsetAtMirrorOffset(mirror, local.end),
    start: sourceOffsetAtMirrorOffset(mirror, local.start),
  };
}

export function applySourceInputMirrorEdit(
  source: string,
  mirror: SourceInputMirror,
  nextValue: string,
  localSelection: SourceInputMirrorSelection,
): SourceInputMirrorEdit {
  const normalizedNext = normalizedSourceWindow(
    nextValue,
    0,
    nextValue.length,
  );
  const textareaValue = normalizedNext.value;
  const nextSelection = normalizedSelection(textareaValue, {
    direction: localSelection.direction,
    end: mirrorOffsetAtSourceOffset(
      normalizedNext.sourceOffsets,
      localSelection.end,
      0,
      textareaValue.length,
    ),
    start: mirrorOffsetAtSourceOffset(
      normalizedNext.sourceOffsets,
      localSelection.start,
      0,
      textareaValue.length,
    ),
  });
  if (textareaValue === mirror.value) {
    return {
      content: source,
      inserted: '',
      selection: sourceSelectionFromMirror(
        mirror,
        nextSelection.start,
        nextSelection.end,
        nextSelection.direction,
      ),
    };
  }

  const diff = mirrorDiff(mirror.value, textareaValue);
  const inserted = textareaValue.slice(diff.start, diff.nextEnd);
  const replacement = normalizedSelection(
    source,
    mirror.selectionMapped
      ? {
          direction: 'forward',
          end: sourceOffsetAtMirrorOffset(mirror, diff.valueEnd),
          start: sourceOffsetAtMirrorOffset(mirror, diff.start),
        }
      : mirror.sourceSelection,
  );
  const content =
    source.slice(0, replacement.start) +
    inserted +
    source.slice(replacement.end);
  const selection =
    mirror.selectionMapped
      ? (() => {
          const nextWindowEnd =
            mirror.end -
            (replacement.end - replacement.start) +
            inserted.length;
          const nextWindow = normalizedSourceWindow(
            content,
            mirror.start,
            nextWindowEnd,
          );
          return normalizedSelection(content, {
            direction: nextSelection.direction,
            end: sourceOffsetAtWindowOffset(
              nextWindow.sourceOffsets,
              mirror.start,
              nextWindow.value.length,
              nextSelection.end,
            ),
            start: sourceOffsetAtWindowOffset(
              nextWindow.sourceOffsets,
              mirror.start,
              nextWindow.value.length,
              nextSelection.start,
            ),
          });
        })()
      : normalizedSelection(content, {
          direction: nextSelection.direction,
          end:
            replacement.start +
            Math.min(
              inserted.length,
              Math.max(0, nextSelection.end - diff.start),
            ),
          start:
            replacement.start +
            Math.min(
              inserted.length,
              Math.max(0, nextSelection.start - diff.start),
            ),
        });
  return { content, inserted, selection };
}
