import type { SourceSelection } from "../source-caret";
import {
  nextGraphemeBoundary,
  previousGraphemeBoundary,
} from "../source-grapheme";

export interface SourceNavigationInput {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  pageLineCount?: number;
  platform?: string;
  shiftKey: boolean;
}

function anchor(selection: SourceSelection): number {
  return selection.direction === "backward" ? selection.end : selection.start;
}

function focus(selection: SourceSelection): number {
  return selection.direction === "backward" ? selection.start : selection.end;
}

function directed(anchorOffset: number, focusOffset: number): SourceSelection {
  return {
    direction:
      anchorOffset === focusOffset
        ? "none"
        : anchorOffset < focusOffset
          ? "forward"
          : "backward",
    end: Math.max(anchorOffset, focusOffset),
    start: Math.min(anchorOffset, focusOffset),
  };
}

function collapsed(offset: number): SourceSelection {
  return { direction: "none", end: offset, start: offset };
}

const unicodeWhitespace = /\s/uy;
const unicodeWordCharacter = /[\p{L}\p{M}\p{N}_]/uy;

function previousCodePointStart(value: string, offset: number): number {
  const previous = offset - 1;
  const code = value.charCodeAt(previous);
  return code >= 0xdc00 &&
    code <= 0xdfff &&
    previous > 0 &&
    value.charCodeAt(previous - 1) >= 0xd800 &&
    value.charCodeAt(previous - 1) <= 0xdbff
    ? previous - 1
    : previous;
}

function nextCodePointEnd(value: string, offset: number): number {
  const code = value.charCodeAt(offset);
  return code >= 0xd800 &&
    code <= 0xdbff &&
    offset + 1 < value.length &&
    value.charCodeAt(offset + 1) >= 0xdc00 &&
    value.charCodeAt(offset + 1) <= 0xdfff
    ? offset + 2
    : offset + 1;
}

function matchesCodePoint(
  expression: RegExp,
  value: string,
  start: number,
  end: number,
): boolean {
  expression.lastIndex = start;
  return expression.test(value) && expression.lastIndex === end;
}

function isWhitespaceCodePoint(
  value: string,
  start: number,
  end: number,
): boolean {
  const code = value.charCodeAt(start);
  if (code <= 0x7f) {
    return code === 0x20 || (code >= 0x09 && code <= 0x0d);
  }
  return matchesCodePoint(unicodeWhitespace, value, start, end);
}

function isWordCodePoint(value: string, start: number, end: number): boolean {
  const code = value.charCodeAt(start);
  if (code <= 0x7f) {
    return (
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      code === 0x5f ||
      (code >= 0x61 && code <= 0x7a)
    );
  }
  return matchesCodePoint(unicodeWordCharacter, value, start, end);
}

function previousWord(value: string, offset: number): number {
  const bounded = Math.min(value.length, Math.max(0, offset));
  if (bounded === 0) {
    return 0;
  }
  let start = previousCodePointStart(value, bounded);
  if (isWhitespaceCodePoint(value, start, bounded)) {
    let cursor = start;
    while (cursor > 0) {
      start = previousCodePointStart(value, cursor);
      if (!isWhitespaceCodePoint(value, start, cursor)) {
        break;
      }
      cursor = start;
    }
    return cursor;
  }
  if (isWordCodePoint(value, start, bounded)) {
    let cursor = start;
    while (cursor > 0) {
      start = previousCodePointStart(value, cursor);
      if (!isWordCodePoint(value, start, cursor)) {
        break;
      }
      cursor = start;
    }
    return cursor;
  }
  return previousGraphemeBoundary(value, bounded);
}

function nextWord(value: string, offset: number): number {
  const bounded = Math.min(value.length, Math.max(0, offset));
  if (bounded === value.length) {
    return value.length;
  }
  let end = nextCodePointEnd(value, bounded);
  if (isWhitespaceCodePoint(value, bounded, end)) {
    let cursor = end;
    while (cursor < value.length) {
      end = nextCodePointEnd(value, cursor);
      if (!isWhitespaceCodePoint(value, cursor, end)) {
        break;
      }
      cursor = end;
    }
    return cursor;
  }
  if (isWordCodePoint(value, bounded, end)) {
    let cursor = end;
    while (cursor < value.length) {
      end = nextCodePointEnd(value, cursor);
      if (!isWordCodePoint(value, cursor, end)) {
        break;
      }
      cursor = end;
    }
    return cursor;
  }
  return nextGraphemeBoundary(value, bounded);
}

function lineStart(value: string, offset: number): number {
  return value.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function lineEnd(value: string, offset: number): number {
  const lineFeed = value.indexOf("\n", offset);
  if (lineFeed === -1) {
    return value.length;
  }
  return lineFeed > 0 && value.charCodeAt(lineFeed - 1) === 0x0d
    ? lineFeed - 1
    : lineFeed;
}

function moveVertical(value: string, offset: number, delta: number): number {
  const currentStart = lineStart(value, offset);
  const column = offset - currentStart;
  let targetStart = currentStart;
  if (delta < 0) {
    for (let count = 0; count > delta; count -= 1) {
      if (targetStart === 0) {
        return 0;
      }
      targetStart = lineStart(value, targetStart - 1);
    }
  } else {
    for (let count = 0; count < delta; count += 1) {
      const lineFeed = value.indexOf("\n", targetStart);
      if (lineFeed === -1) {
        return value.length;
      }
      targetStart = lineFeed + 1;
    }
  }
  return Math.min(lineEnd(value, targetStart), targetStart + column);
}

export function resolveSourceKeyboardNavigation(
  source: string,
  selection: SourceSelection,
  input: SourceNavigationInput,
): SourceSelection | undefined {
  const isMac = input.platform === "darwin";
  const primary = isMac ? input.metaKey : input.ctrlKey;
  const key = input.key.toLocaleLowerCase();
  if (primary && !input.altKey && key === "a") {
    return {
      direction: source.length === 0 ? "none" : "forward",
      end: source.length,
      start: 0,
    };
  }

  const navigation = new Set([
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "End",
    "Home",
    "PageDown",
    "PageUp",
  ]);
  if (!navigation.has(input.key)) {
    return undefined;
  }
  if (input.altKey && !isMac) {
    return undefined;
  }

  const currentFocus = focus(selection);
  const currentAnchor = anchor(selection);
  if (!input.shiftKey && selection.start !== selection.end) {
    return collapsed(
      input.key === "ArrowLeft" ||
        input.key === "ArrowUp" ||
        input.key === "Home" ||
        input.key === "PageUp"
        ? selection.start
        : selection.end,
    );
  }

  const documentStart =
    (isMac && input.metaKey && input.key === "ArrowUp") ||
    (!isMac && input.ctrlKey && input.key === "Home");
  const documentEnd =
    (isMac && input.metaKey && input.key === "ArrowDown") ||
    (!isMac && input.ctrlKey && input.key === "End");
  let next: number;
  if (documentStart) {
    next = 0;
  } else if (documentEnd) {
    next = source.length;
  } else if (input.key === "ArrowLeft") {
    next =
      isMac && input.metaKey
        ? lineStart(source, currentFocus)
        : (isMac && input.altKey) || (!isMac && input.ctrlKey)
          ? previousWord(source, currentFocus)
          : previousGraphemeBoundary(source, currentFocus);
  } else if (input.key === "ArrowRight") {
    next =
      isMac && input.metaKey
        ? lineEnd(source, currentFocus)
        : (isMac && input.altKey) || (!isMac && input.ctrlKey)
          ? nextWord(source, currentFocus)
          : nextGraphemeBoundary(source, currentFocus);
  } else if (input.key === "Home") {
    next = lineStart(source, currentFocus);
  } else if (input.key === "End") {
    next = lineEnd(source, currentFocus);
  } else if (input.key === "ArrowUp") {
    next = moveVertical(source, currentFocus, -1);
  } else if (input.key === "ArrowDown") {
    next = moveVertical(source, currentFocus, 1);
  } else if (input.key === "PageUp") {
    next = moveVertical(
      source,
      currentFocus,
      -Math.max(1, input.pageLineCount ?? 20),
    );
  } else if (input.key === "PageDown") {
    next = moveVertical(
      source,
      currentFocus,
      Math.max(1, input.pageLineCount ?? 20),
    );
  } else {
    return undefined;
  }

  return input.shiftKey ? directed(currentAnchor, next) : collapsed(next);
}
