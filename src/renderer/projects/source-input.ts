import type { SourceEditorState } from './markdown-history';
import {
  nextGraphemeBoundary,
  previousGraphemeBoundary,
} from './source-grapheme';

const SOURCE_WHITESPACE = /\s/uy;
const SOURCE_WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/uy;

function collapsed(offset: number): SourceEditorState['selection'] {
  return { start: offset, end: offset, direction: 'none' };
}

function replaceSelection(
  state: SourceEditorState,
  inserted: string,
): SourceEditorState {
  const start = Math.min(state.selection.start, state.content.length);
  const end = Math.min(Math.max(start, state.selection.end), state.content.length);
  const content =
    state.content.slice(0, start) + inserted + state.content.slice(end);
  return {
    content,
    selection: collapsed(start + inserted.length),
  };
}

function previousCodePointStart(value: string, offset: number): number {
  const previous = value.charCodeAt(offset - 1);
  return previous >= 0xdc00 &&
    previous <= 0xdfff &&
    offset > 1 &&
    value.charCodeAt(offset - 2) >= 0xd800 &&
    value.charCodeAt(offset - 2) <= 0xdbff
    ? offset - 2
    : offset - 1;
}

function nextCodePointEnd(value: string, offset: number): number {
  const current = value.charCodeAt(offset);
  return current >= 0xd800 &&
    current <= 0xdbff &&
    offset + 1 < value.length &&
    value.charCodeAt(offset + 1) >= 0xdc00 &&
    value.charCodeAt(offset + 1) <= 0xdfff
    ? offset + 2
    : offset + 1;
}

function matchesCodePoint(
  pattern: RegExp,
  value: string,
  start: number,
  end: number,
): boolean {
  pattern.lastIndex = start;
  return pattern.test(value) && pattern.lastIndex === end;
}

export function previousSourceWordBoundary(
  value: string,
  offset: number,
): number {
  let cursor = Math.min(Math.max(0, offset), value.length);
  let start = previousCodePointStart(value, cursor);
  if (
    cursor > 0 &&
    matchesCodePoint(SOURCE_WHITESPACE, value, start, cursor)
  ) {
    do {
      cursor = start;
      start = previousCodePointStart(value, cursor);
    } while (
      cursor > 0 &&
      matchesCodePoint(SOURCE_WHITESPACE, value, start, cursor)
    );
    return cursor;
  }
  if (
    cursor > 0 &&
    matchesCodePoint(SOURCE_WORD_CHARACTER, value, start, cursor)
  ) {
    do {
      cursor = start;
      start = previousCodePointStart(value, cursor);
    } while (
      cursor > 0 &&
      matchesCodePoint(SOURCE_WORD_CHARACTER, value, start, cursor)
    );
    return cursor;
  }
  return previousGraphemeBoundary(value, cursor);
}

export function nextSourceWordBoundary(value: string, offset: number): number {
  let cursor = Math.min(Math.max(0, offset), value.length);
  let end = nextCodePointEnd(value, cursor);
  if (
    cursor < value.length &&
    matchesCodePoint(SOURCE_WHITESPACE, value, cursor, end)
  ) {
    do {
      cursor = end;
      end = nextCodePointEnd(value, cursor);
    } while (
      cursor < value.length &&
      matchesCodePoint(SOURCE_WHITESPACE, value, cursor, end)
    );
    return cursor;
  }
  if (
    cursor < value.length &&
    matchesCodePoint(SOURCE_WORD_CHARACTER, value, cursor, end)
  ) {
    do {
      cursor = end;
      end = nextCodePointEnd(value, cursor);
    } while (
      cursor < value.length &&
      matchesCodePoint(SOURCE_WORD_CHARACTER, value, cursor, end)
    );
    return cursor;
  }
  return nextGraphemeBoundary(value, cursor);
}

export function previousSourceWordNavigationBoundary(
  value: string,
  offset: number,
): number {
  let cursor = Math.min(Math.max(0, offset), value.length);
  while (cursor > 0) {
    const start = previousCodePointStart(value, cursor);
    if (matchesCodePoint(SOURCE_WORD_CHARACTER, value, start, cursor)) {
      break;
    }
    cursor = start;
  }
  while (cursor > 0) {
    const start = previousCodePointStart(value, cursor);
    if (!matchesCodePoint(SOURCE_WORD_CHARACTER, value, start, cursor)) {
      break;
    }
    cursor = start;
  }
  return cursor;
}

export function nextSourceWordStartBoundary(
  value: string,
  offset: number,
): number {
  let cursor = Math.min(Math.max(0, offset), value.length);
  while (cursor < value.length) {
    const end = nextCodePointEnd(value, cursor);
    if (!matchesCodePoint(SOURCE_WORD_CHARACTER, value, cursor, end)) {
      break;
    }
    cursor = end;
  }
  while (cursor < value.length) {
    const end = nextCodePointEnd(value, cursor);
    if (matchesCodePoint(SOURCE_WORD_CHARACTER, value, cursor, end)) {
      break;
    }
    cursor = end;
  }
  return cursor;
}

export function nextSourceWordEndBoundary(
  value: string,
  offset: number,
): number {
  let cursor = Math.min(Math.max(0, offset), value.length);
  while (cursor < value.length) {
    const end = nextCodePointEnd(value, cursor);
    if (matchesCodePoint(SOURCE_WORD_CHARACTER, value, cursor, end)) {
      break;
    }
    cursor = end;
  }
  while (cursor < value.length) {
    const end = nextCodePointEnd(value, cursor);
    if (!matchesCodePoint(SOURCE_WORD_CHARACTER, value, cursor, end)) {
      break;
    }
    cursor = end;
  }
  return cursor;
}

function previousLineBoundary(value: string, offset: number): number {
  const lineStart = value.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  return lineStart === offset && offset > 0 ? offset - 1 : lineStart;
}

function nextLineBoundary(value: string, offset: number): number {
  const lineEnd = value.indexOf('\n', offset);
  return lineEnd === -1 ? value.length : lineEnd + 1;
}

function deleteEntireLine(state: SourceEditorState): SourceEditorState {
  if (state.selection.start !== state.selection.end) {
    return replaceSelection(state, '');
  }
  const caret = Math.min(state.selection.start, state.content.length);
  let start = state.content.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const lineEnd = state.content.indexOf('\n', caret);
  const end = lineEnd === -1 ? state.content.length : lineEnd + 1;
  if (lineEnd === -1 && start > 0) {
    start -= 1;
  }
  return {
    content: state.content.slice(0, start) + state.content.slice(end),
    selection: collapsed(start),
  };
}

function deleteRange(
  state: SourceEditorState,
  direction: 'backward' | 'forward',
  boundary: (value: string, offset: number) => number,
): SourceEditorState {
  if (state.selection.start !== state.selection.end) {
    return replaceSelection(state, '');
  }

  const caret = Math.min(state.selection.start, state.content.length);
  const edge = boundary(state.content, caret);
  const start = direction === 'backward' ? edge : caret;
  const end = direction === 'backward' ? caret : edge;
  if (start === end) {
    return { content: state.content, selection: collapsed(caret) };
  }
  return {
    content: state.content.slice(0, start) + state.content.slice(end),
    selection: collapsed(start),
  };
}

export function resolveSourceInput(
  state: SourceEditorState,
  inputType: string,
  data?: string | null,
): SourceEditorState | undefined {
  switch (inputType) {
    case 'insertText':
    case 'insertReplacementText':
      return data === null || data === undefined
        ? undefined
        : replaceSelection(state, data.replace(/\r\n?/g, '\n'));
    case 'insertParagraph':
    case 'insertLineBreak':
      return replaceSelection(state, '\n');
    case 'deleteContentBackward':
      return deleteRange(state, 'backward', previousGraphemeBoundary);
    case 'deleteContentForward':
      return deleteRange(state, 'forward', nextGraphemeBoundary);
    case 'deleteWordBackward':
      return deleteRange(state, 'backward', previousSourceWordBoundary);
    case 'deleteWordForward':
      return deleteRange(state, 'forward', nextSourceWordBoundary);
    case 'deleteSoftLineBackward':
    case 'deleteHardLineBackward':
      return deleteRange(state, 'backward', previousLineBoundary);
    case 'deleteSoftLineForward':
    case 'deleteHardLineForward':
      return deleteRange(state, 'forward', nextLineBoundary);
    case 'deleteEntireSoftLine':
      return deleteEntireLine(state);
    case 'deleteByCut':
    case 'deleteByDrag':
      return state.selection.start === state.selection.end
        ? { ...state, selection: collapsed(state.selection.start) }
        : replaceSelection(state, '');
    default:
      return undefined;
  }
}
