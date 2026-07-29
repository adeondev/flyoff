import {
  readSelection,
  readSource,
  sourceOffsetAtPoint,
  type SourceSelection,
} from './source-caret';
import {
  parseInternalLinkDestination,
  type InternalLinkSyntax,
} from '../../shared/markdown';

export type SourceLineAction =
  | 'duplicate'
  | 'delete'
  | 'move-up'
  | 'move-down';

export interface SourceContextLink {
  end: number;
  headingPath: readonly string[];
  internal: boolean;
  path: string;
  start: number;
  syntax: InternalLinkSyntax;
  url: string;
}

export interface SourceContextTask {
  checked: boolean;
  markerOffset: number;
}

export interface SourceContextSpelling {
  end: number;
  start: number;
  suggestions?: readonly string[];
  allowPersonalDictionary?: boolean;
  word: string;
}

export interface SourceLineCapabilities {
  canDelete: boolean;
  canMoveDown: boolean;
  canMoveUp: boolean;
}

export interface SourceMenuRequest {
  content: string;
  link?: SourceContextLink;
  lines: SourceLineCapabilities;
  position: { x: number; y: number };
  selection: SourceSelection;
  spelling?: SourceContextSpelling;
  task?: SourceContextTask;
}

export interface SourceContextEdit {
  content: string;
  selection: SourceSelection;
}

interface LinePosition {
  column: number;
  line: number;
}

interface SelectedLines {
  end: number;
  start: number;
}

const TASK_PREFIX = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\]\s+)/;
const INLINE_LINK = /!?\[[^\]\n]*\]\(([^)\n]*)\)/g;
const WIKI_LINK = /(?<!!)\[\[([^\]\n]+)\]\]/g;
const SPELLING_WORD =
  /[\p{L}\p{M}]+(?:['\u2019\u2010-][\p{L}\p{M}]+)*/gu;

export function sourceSpellingAtOffset(
  source: string,
  offset: number,
): SourceContextSpelling | undefined {
  const target = clampOffset(source, offset);
  const startOffset =
    target === 0 ? 0 : source.lastIndexOf('\n', target - 1) + 1;
  const nextBreak = source.indexOf('\n', target);
  const endOffset = nextBreak === -1 ? source.length : nextBreak;
  const line = source.slice(startOffset, endOffset);
  for (const match of line.matchAll(SPELLING_WORD)) {
    const start = startOffset + match.index;
    const end = start + match[0].length;
    if (target >= start && target <= end) {
      return { end, start, word: match[0] };
    }
  }
  return undefined;
}

function clampOffset(content: string, offset: number): number {
  return Math.min(Math.max(0, offset), content.length);
}

function positionAt(lines: readonly string[], offset: number): LinePosition {
  let remaining = Math.max(0, offset);

  for (let line = 0; line < lines.length; line += 1) {
    const length = lines[line]!.length;
    if (remaining <= length) {
      return { column: remaining, line };
    }
    remaining -= length + 1;
  }

  const line = Math.max(0, lines.length - 1);
  return { column: lines[line]?.length ?? 0, line };
}

function offsetAt(
  lines: readonly string[],
  line: number,
  column: number,
): number {
  const target = Math.min(Math.max(0, line), Math.max(0, lines.length - 1));
  let offset = 0;

  for (let index = 0; index < target; index += 1) {
    offset += lines[index]!.length + 1;
  }

  return offset + Math.min(Math.max(0, column), lines[target]?.length ?? 0);
}

function selectedLines(
  content: string,
  selection: SourceSelection,
): SelectedLines {
  const lines = content.split('\n');
  const start = positionAt(lines, clampOffset(content, selection.start));
  const selectionEnd = clampOffset(content, selection.end);
  const end = positionAt(lines, selectionEnd);

  return {
    start: start.line,
    end:
      selectionEnd > selection.start && end.column === 0
        ? Math.max(start.line, end.line - 1)
        : end.line,
  };
}

function lineStart(content: string, line: number): number {
  if (line <= 0) {
    return 0;
  }

  let offset = 0;
  for (let index = 0; index < line; index += 1) {
    const next = content.indexOf('\n', offset);
    if (next === -1) {
      return content.length;
    }
    offset = next + 1;
  }
  return offset;
}

function selectionForMovedBlock(
  lines: readonly string[],
  targetLine: number,
  count: number,
  original: SourceSelection,
  originalPosition: LinePosition,
): SourceSelection {
  if (original.start === original.end) {
    const offset = offsetAt(lines, targetLine, originalPosition.column);
    return { direction: 'none', end: offset, start: offset };
  }

  const start = offsetAt(lines, targetLine, 0);
  const end = offsetAt(
    lines,
    targetLine + count - 1,
    lines[targetLine + count - 1]?.length ?? 0,
  );
  return { direction: original.direction, end, start };
}

function lineContext(
  content: string,
  selection: SourceSelection,
): SourceLineCapabilities {
  const start = clampOffset(content, selection.start);
  let end = clampOffset(content, selection.end);
  if (end > start && content[end - 1] === '\n') {
    end -= 1;
  }

  return {
    canDelete: content.length > 0,
    canMoveDown: content.indexOf('\n', end) !== -1,
    canMoveUp:
      start > 0 && content.lastIndexOf('\n', start - 1) !== -1,
  };
}

function taskContext(
  content: string,
  start: number,
  end: number,
): SourceContextTask | undefined {
  const line = content.slice(start, end);
  const match = line ? TASK_PREFIX.exec(line) : null;
  if (!match) {
    return undefined;
  }

  return {
    checked: match[2]!.toLocaleLowerCase() === 'x',
    markerOffset: start + match[1]!.length,
  };
}

function taskContextAtOffset(
  content: string,
  start: number,
  end: number,
  offset: number,
): SourceContextTask | undefined {
  const match = TASK_PREFIX.exec(content.slice(start, end));
  if (!match) {
    return undefined;
  }
  const tokenStart = start + match[1]!.length - 1;
  const tokenEnd = start + match[0].length;
  return offset >= tokenStart && offset <= tokenEnd
    ? taskContext(content, start, end)
    : undefined;
}

function linkDestination(
  raw: string,
  absoluteStart: number,
): Pick<SourceContextLink, 'end' | 'start' | 'url'> | undefined {
  const leadingWhitespace = raw.length - raw.trimStart().length;
  const destination = raw.slice(leadingWhitespace);
  if (!destination) {
    return undefined;
  }

  if (destination.startsWith('<')) {
    const close = destination.indexOf('>');
    if (close <= 1) {
      return undefined;
    }
    const start = absoluteStart + leadingWhitespace + 1;
    return {
      start,
      end: start + close - 1,
      url: destination.slice(1, close),
    };
  }

  const value = /^\S+/.exec(destination)?.[0];
  if (!value) {
    return undefined;
  }
  const start = absoluteStart + leadingWhitespace;
  return { start, end: start + value.length, url: value };
}

function linkContext(
  content: string,
  lineStartOffset: number,
  lineEndOffset: number,
  linkIndex: number,
): SourceContextLink | undefined {
  const line = content.slice(lineStartOffset, lineEndOffset);

  const matches = [
    ...[...line.matchAll(INLINE_LINK)].map((match) => ({
      match,
      syntax: 'markdown' as const,
    })),
    ...[...line.matchAll(WIKI_LINK)].map((match) => ({
      match,
      syntax: 'wikilink' as const,
    })),
  ].sort(
    (left, right) => (left.match.index ?? 0) - (right.match.index ?? 0),
  );
  const selected = matches[linkIndex];
  const match = selected?.match;
  if (!match || match.index === undefined) {
    return undefined;
  }

  if (selected.syntax === 'wikilink') {
    const inside = match[1]!;
    const aliasAt = inside.indexOf('|');
    const destination = (aliasAt === -1
      ? inside
      : inside.slice(0, aliasAt)
    ).trim();
    const leading =
      (aliasAt === -1 ? inside : inside.slice(0, aliasAt)).length -
      (aliasAt === -1 ? inside : inside.slice(0, aliasAt)).trimStart().length;
    const start =
      lineStartOffset + match.index + 2 + leading;
    const internal = parseInternalLinkDestination(destination, 'wikilink');
    return {
      end: start + destination.length,
      headingPath: internal?.headingPath ?? [],
      internal: internal !== null,
      path: internal?.path ?? '',
      start,
      syntax: 'wikilink',
      url: destination,
    };
  }

  const raw = match[1]!;
  const destinationStart =
    lineStartOffset +
    match.index +
    match[0].indexOf('(') +
    1;
  const link = linkDestination(raw, destinationStart);
  if (!link) {
    return undefined;
  }
  const internal = parseInternalLinkDestination(link.url, 'markdown');
  return {
    ...link,
    headingPath: internal?.headingPath ?? [],
    internal: internal !== null,
    path: internal?.path ?? '',
    syntax: 'markdown',
  };
}

function linkIndexAtOffset(
  content: string,
  lineStartOffset: number,
  lineEndOffset: number,
  offset: number,
): number {
  const line = content.slice(lineStartOffset, lineEndOffset);
  const relative = offset - lineStartOffset;
  const matches = [
    ...line.matchAll(INLINE_LINK),
    ...line.matchAll(WIKI_LINK),
  ].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  return matches.findIndex((match) => {
    const start = match.index ?? -1;
    return start >= 0 && relative >= start && relative <= start + match[0].length;
  });
}

export function createSourceMenuRequest(
  root: HTMLElement,
  target: EventTarget | null,
  position: { x: number; y: number },
): SourceMenuRequest {
  const source = readSource(root);
  const selection = readSelection(root);
  const element = target instanceof Element ? target : undefined;
  const line = element?.closest<HTMLElement>('.md-line');
  const lineIndex = Math.max(0, Number(line?.dataset.line ?? 1) - 1);
  const pointOffset = sourceOffsetAtPoint(root, position.x, position.y);
  const fallbackOffset = Math.min(
    source.length,
    selection.direction === 'backward'
      ? selection.start
      : selection.end,
  );
  const lineOffset =
    pointOffset ??
    (line
      ? lineStart(source, lineIndex)
      : fallbackOffset);
  const lineStartOffset =
    lineOffset === 0
      ? 0
      : source.lastIndexOf('\n', lineOffset - 1) + 1;
  const lineBreak = source.indexOf('\n', lineOffset);
  const lineEndOffset =
    lineBreak === -1 ? source.length : lineBreak;
  const task = element?.closest('.md-tok-task')
    ? taskContext(source, lineStartOffset, lineEndOffset)
    : pointOffset === undefined
      ? undefined
      : taskContextAtOffset(
          source,
          lineStartOffset,
          lineEndOffset,
          pointOffset,
        );
  const linkElement = element?.closest('.md-source-link');
  const linkElements = line
    ? [...line.querySelectorAll('.md-source-link')]
    : [];
  const linkIndex = linkElement
    ? linkElements.indexOf(linkElement)
    : pointOffset === undefined
      ? -1
      : linkIndexAtOffset(
          source,
          lineStartOffset,
          lineEndOffset,
          pointOffset,
        );
  const spelling =
    pointOffset === undefined
      ? undefined
      : sourceSpellingAtOffset(source, pointOffset);

  return {
    content: source,
    link:
      linkIndex >= 0
        ? linkContext(
            source,
            lineStartOffset,
            lineEndOffset,
            linkIndex,
          )
        : undefined,
    lines: lineContext(source, selection),
    position,
    selection,
    spelling,
    task,
  };
}

export function sourceLineCapabilities(
  content: string,
  selection: SourceSelection,
): SourceLineCapabilities {
  return lineContext(content, selection);
}

export function applySourceLineAction(
  action: SourceLineAction,
  content: string,
  selection: SourceSelection,
): SourceContextEdit | undefined {
  const lines = content.split('\n');
  const range = selectedLines(content, selection);
  const count = range.end - range.start + 1;
  const block = lines.slice(range.start, range.end + 1);
  const caret = positionAt(lines, clampOffset(content, selection.start));
  let targetLine = range.start;

  switch (action) {
    case 'duplicate':
      targetLine = range.end + 1;
      lines.splice(targetLine, 0, ...block);
      break;
    case 'delete':
      lines.splice(range.start, count);
      if (lines.length === 0) {
        lines.push('');
      }
      {
        const offset = offsetAt(lines, Math.min(range.start, lines.length - 1), 0);
        const next = {
          content: lines.join('\n'),
          selection: { direction: 'none' as const, end: offset, start: offset },
        };
        return next.content === content ? undefined : next;
      }
    case 'move-up':
      if (range.start === 0) {
        return undefined;
      }
      targetLine = range.start - 1;
      lines.splice(targetLine, count + 1, ...block, lines[targetLine]!);
      break;
    case 'move-down':
      if (range.end >= lines.length - 1) {
        return undefined;
      }
      targetLine = range.start + 1;
      lines.splice(
        range.start,
        count + 1,
        lines[range.end + 1]!,
        ...block,
      );
      break;
  }

  const next = {
    content: lines.join('\n'),
    selection: selectionForMovedBlock(
      lines,
      targetLine,
      count,
      selection,
      caret,
    ),
  };
  return next.content === content ? undefined : next;
}

export function toggleSourceTask(
  content: string,
  selection: SourceSelection,
  task: SourceContextTask,
): SourceContextEdit | undefined {
  const marker = content[task.markerOffset];
  if (marker !== ' ' && marker?.toLocaleLowerCase() !== 'x') {
    return undefined;
  }

  const nextMarker = task.checked ? ' ' : 'x';
  return {
    content:
      content.slice(0, task.markerOffset) +
      nextMarker +
      content.slice(task.markerOffset + 1),
    selection,
  };
}
