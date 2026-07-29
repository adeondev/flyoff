import type { SourceEditorState } from './markdown-history';
import type { MarkdownInlineColorKind } from './markdown-actions';
import { resolveSourceInput } from './source-input';

export interface MarkdownTypingColor {
  color: string | null;
  kind: MarkdownInlineColorKind;
}

interface InlineColorRun extends MarkdownTypingColor {
  contentEnd: number;
  contentStart: number;
  end: number;
  start: number;
  text: string;
}

interface StyledText {
  style: MarkdownTypingColor | null;
  text: string;
}

const TEXT_COLOR_RUN =
  /\[([^\]\n]*)\]\{color\s*=\s*(?:"(#[0-9a-fA-F]{3,8})"|'(#[0-9a-fA-F]{3,8})'|(#[0-9a-fA-F]{3,8}))\s*\}/g;
const HIGHLIGHT_COLOR_RUN =
  /==([^\n]*?)==(?:\{color\s*=\s*(?:"(#[0-9a-fA-F]{3,8})"|'(#[0-9a-fA-F]{3,8})'|(#[0-9a-fA-F]{3,8}))\s*\})?/g;
const EMPTY_COLOR_RUN =
  /\[\]\{color\s*=\s*(?:"#[0-9a-fA-F]{3,8}"|'#[0-9a-fA-F]{3,8}'|#[0-9a-fA-F]{3,8})\s*\}|====(?:\{color\s*=\s*(?:"#[0-9a-fA-F]{3,8}"|'#[0-9a-fA-F]{3,8}'|#[0-9a-fA-F]{3,8})\s*\})?/g;

function collectRuns(
  value: string,
  baseOffset = 0,
): readonly InlineColorRun[] {
  const runs: InlineColorRun[] = [];

  for (const match of value.matchAll(TEXT_COLOR_RUN)) {
    const start = baseOffset + match.index;
    const text = match[1]!;
    runs.push({
      color: match[2] ?? match[3] ?? match[4] ?? null,
      contentEnd: start + 1 + text.length,
      contentStart: start + 1,
      end: start + match[0].length,
      kind: 'text',
      start,
      text,
    });
  }

  for (const match of value.matchAll(HIGHLIGHT_COLOR_RUN)) {
    const start = baseOffset + match.index;
    const text = match[1]!;
    runs.push({
      color: match[2] ?? match[3] ?? match[4] ?? null,
      contentEnd: start + 2 + text.length,
      contentStart: start + 2,
      end: start + match[0].length,
      kind: 'highlight',
      start,
      text,
    });
  }

  return runs
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter(
      (run, index, sorted) =>
        !sorted.some(
          (candidate, candidateIndex) =>
            candidateIndex < index &&
            candidate.start <= run.start &&
            candidate.end >= run.end,
        ),
    );
}

function sameStyle(
  left: MarkdownTypingColor | null,
  right: MarkdownTypingColor | null,
): boolean {
  return (
    left?.kind === right?.kind &&
    left?.color?.toUpperCase() === right?.color?.toUpperCase()
  );
}

function serializeSegment(
  segment: StyledText,
  caretMarker: string,
): string {
  if (
    !segment.text ||
    !segment.style ||
    segment.text === caretMarker
  ) {
    return segment.text;
  }
  if (segment.style.kind === 'highlight' && !segment.style.color) {
    return `==${segment.text}==`;
  }
  if (!segment.style.color) {
    return segment.text;
  }
  return segment.style.kind === 'text'
    ? `[${segment.text}]{color=${segment.style.color}}`
    : `==${segment.text}=={color=${segment.style.color}}`;
}

function serializeStyledText(
  segments: readonly StyledText[],
  caretMarker: string,
): SourceEditorState {
  const lines: StyledText[][] = [[]];

  for (const segment of segments) {
    const parts = segment.text.split('\n');
    for (const [index, part] of parts.entries()) {
      if (part) {
        const line = lines.at(-1)!;
        const previous = line.at(-1);
        if (previous && sameStyle(previous.style, segment.style)) {
          previous.text += part;
        } else {
          line.push({ style: segment.style, text: part });
        }
      }
      if (index < parts.length - 1) {
        lines.push([]);
      }
    }
  }

  const marked = lines
    .map((line) =>
      line.map((segment) => serializeSegment(segment, caretMarker)).join(''),
    )
    .join('\n');
  const caret = marked.indexOf(caretMarker);
  const content = marked.replace(caretMarker, '');
  const offset = caret === -1 ? content.length : caret;
  return {
    content,
    selection: { direction: 'none', end: offset, start: offset },
  };
}

function uniqueMarker(value: string): string {
  let marker = '\u0000';
  while (value.includes(marker)) {
    marker += '\u0000';
  }
  return marker;
}

function runStyle(run: InlineColorRun): MarkdownTypingColor | null {
  return run.kind === 'highlight' || run.color
    ? { color: run.color, kind: run.kind }
    : null;
}

function runAtContentOffset(
  runs: readonly InlineColorRun[],
  offset: number,
): InlineColorRun | undefined {
  return runs.find(
    (run) => offset >= run.contentStart && offset <= run.contentEnd,
  );
}

function formatReplacement(
  state: SourceEditorState,
  inserted: string,
  typingColor: MarkdownTypingColor,
): SourceEditorState {
  const start = Math.min(state.selection.start, state.content.length);
  const end = Math.min(
    Math.max(start, state.selection.end),
    state.content.length,
  );
  const scanStart =
    state.content.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextBreak = state.content.indexOf('\n', end);
  const scanEnd = nextBreak === -1 ? state.content.length : nextBreak;
  const runs = collectRuns(
    state.content.slice(scanStart, scanEnd),
    scanStart,
  );
  const first = runAtContentOffset(runs, start);
  const last = runAtContentOffset(runs, end);
  const marker = uniqueMarker(state.content + inserted);
  const insertedStyle = typingColor.color ? typingColor : null;

  if (first && first === last) {
    const style = runStyle(first);
    const replacement = serializeStyledText(
      [
        {
          style,
          text: first.text.slice(0, start - first.contentStart),
        },
        { style: insertedStyle, text: inserted + marker },
        {
          style,
          text: first.text.slice(end - first.contentStart),
        },
      ],
      marker,
    );
    return {
      content:
        state.content.slice(0, first.start) +
        replacement.content +
        state.content.slice(first.end),
      selection: {
        direction: 'none',
        end: first.start + replacement.selection.end,
        start: first.start + replacement.selection.start,
      },
    };
  }

  const replaceStart = first?.start ?? start;
  const replaceEnd = last?.end ?? end;
  const segments: StyledText[] = [];
  if (first) {
    segments.push({
      style: runStyle(first),
      text: first.text.slice(0, start - first.contentStart),
    });
  }
  segments.push({ style: insertedStyle, text: inserted + marker });
  if (last) {
    segments.push({
      style: runStyle(last),
      text: last.text.slice(end - last.contentStart),
    });
  }
  const replacement = serializeStyledText(segments, marker);

  return {
    content:
      state.content.slice(0, replaceStart) +
      replacement.content +
      state.content.slice(replaceEnd),
    selection: {
      direction: 'none',
      end: replaceStart + replacement.selection.end,
      start: replaceStart + replacement.selection.start,
    },
  };
}

function cleanupEmptyRuns(state: SourceEditorState): SourceEditorState {
  const focus = Math.min(
    Math.max(0, state.selection.start),
    state.content.length,
  );
  const scanStart =
    focus === 0 ? 0 : state.content.lastIndexOf('\n', focus - 1) + 1;
  const nextBreak = state.content.indexOf('\n', focus);
  const scanEnd = nextBreak === -1 ? state.content.length : nextBreak;
  const line = state.content.slice(scanStart, scanEnd);
  if (!line.includes('[]') && !line.includes('====')) {
    return state;
  }

  let cleaned = '';
  let lineOffset = 0;
  let removedBeforeStart = 0;
  let removedBeforeEnd = 0;

  for (const match of line.matchAll(EMPTY_COLOR_RUN)) {
    cleaned += line.slice(lineOffset, match.index);
    const matchStart = scanStart + match.index;
    const matchEnd = matchStart + match[0].length;
    if (matchStart < state.selection.start) {
      removedBeforeStart +=
        Math.min(matchEnd, state.selection.start) - matchStart;
    }
    if (matchStart < state.selection.end) {
      removedBeforeEnd +=
        Math.min(matchEnd, state.selection.end) - matchStart;
    }
    lineOffset = match.index + match[0].length;
  }
  if (lineOffset === 0) {
    return state;
  }
  cleaned += line.slice(lineOffset);
  return {
    content:
      state.content.slice(0, scanStart) +
      cleaned +
      state.content.slice(scanEnd),
    selection: {
      direction: state.selection.direction,
      end: state.selection.end - removedBeforeEnd,
      start: state.selection.start - removedBeforeStart,
    },
  };
}

function insertionText(
  inputType: string,
  data?: string | null,
): string | undefined {
  if (
    inputType === 'insertText' ||
    inputType === 'insertReplacementText'
  ) {
    return data === null || data === undefined
      ? undefined
      : data.replace(/\r\n?/g, '\n');
  }
  if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
    return '\n';
  }
  return undefined;
}

export function markdownTypingColorAt(
  value: string,
  offset: number,
): MarkdownTypingColor | null {
  const scanStart = value.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const nextBreak = value.indexOf('\n', offset);
  const scanEnd = nextBreak === -1 ? value.length : nextBreak;
  const run = runAtContentOffset(
    collectRuns(value.slice(scanStart, scanEnd), scanStart),
    offset,
  );
  return run ? { color: run.color, kind: run.kind } : null;
}

export function resolveMarkdownTypingInput(
  state: SourceEditorState,
  inputType: string,
  data: string | null | undefined,
  typingColor: MarkdownTypingColor | null,
): SourceEditorState | undefined {
  const inserted = insertionText(inputType, data);
  if (typingColor && inserted !== undefined) {
    return formatReplacement(state, inserted, typingColor);
  }

  const resolved = resolveSourceInput(state, inputType, data);
  return resolved && inputType.startsWith('delete')
    ? cleanupEmptyRuns(resolved)
    : resolved;
}

export function applyMarkdownTypingReplacement(
  state: SourceEditorState,
  inserted: string,
  typingColor: MarkdownTypingColor | null,
): SourceEditorState {
  if (typingColor) {
    return formatReplacement(
      state,
      inserted.replace(/\r\n?/g, '\n'),
      typingColor,
    );
  }
  const start = Math.min(state.selection.start, state.content.length);
  const end = Math.min(
    Math.max(start, state.selection.end),
    state.content.length,
  );
  const normalized = inserted.replace(/\r\n?/g, '\n');
  const caret = start + normalized.length;
  return {
    content: state.content.slice(0, start) + normalized + state.content.slice(end),
    selection: { direction: 'none', end: caret, start: caret },
  };
}

export function applyMarkdownTypingComposition(
  before: SourceEditorState,
  after: SourceEditorState,
  typingColor: MarkdownTypingColor | null,
): SourceEditorState {
  if (!typingColor || before.content === after.content) {
    return after;
  }

  let start = 0;
  while (
    start < before.content.length &&
    start < after.content.length &&
    before.content[start] === after.content[start]
  ) {
    start += 1;
  }
  let suffix = 0;
  while (
    suffix < before.content.length - start &&
    suffix < after.content.length - start &&
    before.content[before.content.length - suffix - 1] ===
      after.content[after.content.length - suffix - 1]
  ) {
    suffix += 1;
  }

  return formatReplacement(
    {
      content: before.content,
      selection: {
        direction: 'forward',
        end: before.content.length - suffix,
        start,
      },
    },
    after.content.slice(start, after.content.length - suffix),
    typingColor,
  );
}
