import {
  editedCharCodeAt,
  editedLength,
  sliceEditedDocument,
  spliceSourceDocument,
} from './source-document-text';
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
  /**
   * The edit itself, in document offsets. The mirror already knows exactly what
   * was replaced, so handing it on lets the document model apply the change
   * without deriving it back out of the text — which is what forced a
   * whole-document scan and materialisation on every keystroke.
   */
  change: { from: number; insert: string; to: number };
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

/**
 * A document the caller can read a character of without holding it as one
 * string. Reading the new document is what materialised it on every keystroke.
 */
interface ReadableDocument {
  charCodeAt(offset: number): number;
  length: number;
}

/**
 * The document text, readable in windows without existing as one string.
 *
 * A plain string satisfies this, which is what every caller outside the
 * keystroke path passes. The view passes a reader backed by the model's lines
 * instead, because slicing the caret window out of the document string is the
 * last thing on the edit path that materialised the whole note.
 */
export interface SourceTextReader extends ReadableDocument {
  slice(start: number, end: number): string;
}

function splitsUnitIn(document: ReadableDocument, offset: number): boolean {
  if (offset <= 0 || offset >= document.length) {
    return false;
  }
  return (
    (document.charCodeAt(offset - 1) === 0x0d &&
      document.charCodeAt(offset) === 0x0a) ||
    (isHighSurrogate(document.charCodeAt(offset - 1)) &&
      isLowSurrogate(document.charCodeAt(offset)))
  );
}

function normalizedSelectionIn(
  document: ReadableDocument,
  selection: SourceViewSelection,
): SourceViewSelection {
  const first = clampedOffset(selection.start, document.length);
  const second = clampedOffset(selection.end, document.length);
  let start = Math.min(first, second);
  let end = Math.max(first, second);
  if (start === end) {
    if (splitsUnitIn(document, start)) {
      start -= 1;
      end = start;
    }
  } else {
    if (splitsUnitIn(document, start)) {
      start -= 1;
    }
    if (splitsUnitIn(document, end)) {
      end += 1;
    }
  }
  return {
    direction: normalizedDirection(selection.direction, start, end),
    end,
    start,
  };
}

function normalizedSelection(
  value: string,
  selection: SourceViewSelection,
): SourceViewSelection {
  return normalizedSelectionIn(value, selection);
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

/**
 * Normalise an already-extracted window. Split out so the window can be
 * assembled from the pieces of an edit rather than sliced out of the new
 * document, which is what used to materialise it.
 */
function normalizedWindow(
  window: string,
  absoluteStart: number,
): NormalizedSourceWindow {
  const normalized = window.replace(/\r\n?/g, '\n');
  if (window.length === normalized.length) {
    return { value: normalized };
  }
  const value: string[] = [];
  const sourceOffsets = [absoluteStart];
  let offset = 0;
  while (offset < window.length) {
    if (window.charCodeAt(offset) === 0x0d) {
      offset +=
        offset + 1 < window.length && window.charCodeAt(offset + 1) === 0x0a
          ? 2
          : 1;
      value.push('\n');
    } else {
      value.push(window[offset]!);
      offset += 1;
    }
    sourceOffsets.push(absoluteStart + offset);
  }
  return { sourceOffsets, value: value.join('') };
}

function normalizedSourceWindow(
  source: string,
  start: number,
  end: number,
): NormalizedSourceWindow {
  return normalizedWindow(source.slice(start, end), start);
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
  reader?: SourceTextReader,
): SourceInputMirror {
  const text: SourceTextReader = reader ?? source;
  const sourceSelection = normalizedSelectionIn(text, selection);
  const maximum = normalizedMaximum(maxCodeUnits);
  const focus = selectionFocus(sourceSelection);
  const selectionMapped =
    sourceSelection.end - sourceSelection.start <= maximum;
  const requiredStart = selectionMapped ? sourceSelection.start : focus;
  const requiredEnd = selectionMapped ? sourceSelection.end : focus;
  const lowestStart = Math.max(0, requiredEnd - maximum);
  const highestStart = Math.min(
    requiredStart,
    Math.max(0, text.length - maximum),
  );
  const preferredStart = focus - Math.floor(maximum / 2);
  let start = Math.min(
    highestStart,
    Math.max(lowestStart, preferredStart),
  );
  let end = Math.min(text.length, start + maximum);
  if (splitsUnitIn(text, start)) {
    start += 1;
  }
  if (splitsUnitIn(text, end)) {
    end -= 1;
  }

  const normalized = normalizedWindow(text.slice(start, end), start);
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
  reader?: SourceTextReader,
): SourceInputMirrorEdit {
  // `source` is the document as it stands, which after the previous keystroke
  // is a cons of pieces rather than one string. Reading it here would join it,
  // so the current document is read through the same line-backed reader the
  // mirror uses.
  const currentText: SourceTextReader = reader ?? source;
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
      change: { from: 0, insert: '', to: 0 },
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
  const replacement = normalizedSelectionIn(
    currentText,
    mirror.selectionMapped
      ? {
          direction: 'forward',
          end: sourceOffsetAtMirrorOffset(mirror, diff.valueEnd),
          start: sourceOffsetAtMirrorOffset(mirror, diff.start),
        }
      : mirror.sourceSelection,
  );
  const content = spliceSourceDocument(
    source,
    replacement.start,
    replacement.end,
    inserted,
  );
  // Everything below reads the *edited* document through these, never through
  // `content`. Reading `content` is what forced V8 to materialise the whole
  // note on every keystroke, and it also flattened it for the next one, which
  // no longer holds it as one string.
  const edited: ReadableDocument = {
    charCodeAt: (offset) =>
      editedCharCodeAt(
        currentText,
        replacement.start,
        replacement.end,
        inserted,
        offset,
      ),
    length: editedLength(
      currentText,
      replacement.start,
      replacement.end,
      inserted,
    ),
  };
  const selection =
    mirror.selectionMapped
      ? (() => {
          const nextWindowEnd =
            mirror.end -
            (replacement.end - replacement.start) +
            inserted.length;
          const nextWindow = normalizedWindow(
            sliceEditedDocument(
              currentText,
              replacement.start,
              replacement.end,
              inserted,
              mirror.start,
              nextWindowEnd,
            ),
            mirror.start,
          );
          return normalizedSelectionIn(edited, {
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
      : normalizedSelectionIn(edited, {
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
  return {
    change: {
      from: replacement.start,
      insert: inserted,
      to: replacement.end,
    },
    content,
    inserted,
    selection,
  };
}
