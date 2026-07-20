import type { SourceEditorState } from './markdown-history';
import {
  nextGraphemeBoundary,
  previousGraphemeBoundary,
} from './source-grapheme';

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

function previousWordBoundary(value: string, offset: number): number {
  const prefix = value.slice(0, offset);
  const whitespace = /\s+$/u.exec(prefix);
  if (whitespace) {
    return offset - whitespace[0].length;
  }
  const word = /[\p{L}\p{M}\p{N}_]+$/u.exec(prefix);
  return word ? offset - word[0].length : previousGraphemeBoundary(value, offset);
}

function nextWordBoundary(value: string, offset: number): number {
  const suffix = value.slice(offset);
  const whitespace = /^\s+/u.exec(suffix);
  if (whitespace) {
    return offset + whitespace[0].length;
  }
  const word = /^[\p{L}\p{M}\p{N}_]+/u.exec(suffix);
  return word ? offset + word[0].length : nextGraphemeBoundary(value, offset);
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
      return deleteRange(state, 'backward', previousWordBoundary);
    case 'deleteWordForward':
      return deleteRange(state, 'forward', nextWordBoundary);
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
