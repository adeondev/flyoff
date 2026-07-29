import {
  highlightSourceLines,
  type HighlightedSourceLine,
} from './markdown-highlight';
import type { SourceChangeRange } from './source-document-model';

const SPELLING_WORD =
  /[\p{L}\p{M}]+(?:['\u2019\u2010-][\p{L}\p{M}]+)*/gu;
const IGNORED_SOURCE =
  /`[^`\n]*`|https?:\/\/[^\s<>()]+|\]\([^)\n]*\)|\[\[[^\]\n]*\]\]/gu;
const SPELLING_ERROR_CLASS = 'md-spelling-error';
export const SOURCE_SPELLCHECK_OVERSCAN_LINES = 120;
export const PERSONAL_DICTIONARY_CHANGED_EVENT =
  'flyoff:personal-dictionary-changed';

function ignoredRanges(source: string): readonly [number, number][] {
  return [...source.matchAll(IGNORED_SOURCE)].map((match) => [
    match.index,
    match.index + match[0].length,
  ]);
}

function isIgnored(
  ranges: readonly [number, number][],
  start: number,
  end: number,
): boolean {
  return ranges.some(
    ([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart,
  );
}

export function collectSourceSpellcheckWords(
  source: string,
  checkCodeBlocks: boolean,
): readonly string[] {
  return collectSourceSpellcheckWordsFromLines(
    highlightSourceLines(source),
    checkCodeBlocks,
  );
}

export function collectSourceSpellcheckWordsFromLines(
  lines: readonly HighlightedSourceLine[],
  checkCodeBlocks: boolean,
): readonly string[] {
  const words = new Set<string>();

  for (const line of lines) {
    if (line.code && !checkCodeBlocks) {
      continue;
    }
    const ranges = ignoredRanges(line.source);
    for (const match of line.source.matchAll(SPELLING_WORD)) {
      const start = match.index;
      const word = match[0];
      if (
        word.length > 1 &&
        !isIgnored(ranges, start, start + word.length)
      ) {
        words.add(word);
      }
    }
  }

  return [...words];
}

function sourceLinesInRange(
  root: HTMLElement,
  range?: Pick<SourceChangeRange, 'endLine' | 'startLine'>,
): readonly HTMLElement[] {
  const virtualRows = root.querySelector<HTMLElement>(
    ':scope > .virtual-source__spacer > .virtual-source__rows',
  );
  if (virtualRows) {
    const start = Math.max(0, range?.startLine ?? 0);
    const end = Math.max(start, range?.endLine ?? Number.POSITIVE_INFINITY);
    const lines: HTMLElement[] = [];
    for (const child of virtualRows.children) {
      if (!(child instanceof HTMLElement) || !child.classList.contains('md-line')) {
        continue;
      }
      const index = Number(child.dataset.line) - 1;
      if (Number.isInteger(index) && index >= start && index < end) {
        lines.push(child);
      }
    }
    return lines;
  }
  const start = Math.max(0, range?.startLine ?? 0);
  const end = Math.min(
    root.children.length,
    range?.endLine ?? root.children.length,
  );
  const lines: HTMLElement[] = [];
  for (let index = start; index < end; index += 1) {
    const line = root.children[index];
    if (line instanceof HTMLElement && line.classList.contains('md-line')) {
      lines.push(line);
    }
  }
  return lines;
}

function lineIndexFromPoint(
  root: HTMLElement,
  x: number,
  y: number,
): number | undefined {
  const target = root.ownerDocument.elementFromPoint?.(x, y);
  const line =
    target instanceof Element
      ? target.closest<HTMLElement>('.md-line')
      : null;
  if (!line || !root.contains(line)) {
    return undefined;
  }
  const index = Number(line.dataset.line) - 1;
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

export function sourceSpellcheckViewportRange(
  root: HTMLElement,
  lineCount: number,
  overscan = SOURCE_SPELLCHECK_OVERSCAN_LINES,
): Pick<SourceChangeRange, 'endLine' | 'startLine'> {
  if (lineCount <= 0) {
    return { endLine: 0, startLine: 0 };
  }

  const bounds = root.getBoundingClientRect();
  const x = Math.min(bounds.right - 1, bounds.left + bounds.width / 2);
  const hitStart = lineIndexFromPoint(root, x, bounds.top + 1);
  const hitEnd = lineIndexFromPoint(root, x, bounds.bottom - 1);
  const scrollHeight = Math.max(1, root.scrollHeight);
  const estimatedStart = Math.floor(
    (root.scrollTop / scrollHeight) * lineCount,
  );
  const estimatedVisible = Math.max(
    1,
    Math.ceil((Math.max(1, root.clientHeight) / scrollHeight) * lineCount),
  );
  const visibleStart = Math.min(
    lineCount - 1,
    hitStart ?? estimatedStart,
  );
  const visibleEnd = Math.min(
    lineCount,
    (hitEnd ?? visibleStart + estimatedVisible - 1) + 1,
  );
  return {
    endLine: Math.min(lineCount, visibleEnd + overscan),
    startLine: Math.max(0, visibleStart - overscan),
  };
}

export function clearSourceSpellingErrorsOutsideRange(
  root: HTMLElement,
  range: Pick<SourceChangeRange, 'endLine' | 'startLine'>,
): void {
  const affected = new Set<Node>();
  for (const marker of root.querySelectorAll<HTMLElement>(
    `.${SPELLING_ERROR_CLASS}`,
  )) {
    const line = marker.closest<HTMLElement>('.md-line');
    const index = Number(line?.dataset.line) - 1;
    if (
      Number.isInteger(index) &&
      index >= range.startLine &&
      index < range.endLine
    ) {
      continue;
    }
    const parent = marker.parentNode;
    marker.replaceWith(
      root.ownerDocument.createTextNode(marker.textContent ?? ''),
    );
    if (parent) {
      affected.add(parent);
    }
  }
  for (const node of affected) {
    node.normalize();
  }
}

export function clearSourceSpellingErrors(
  root: HTMLElement,
  range?: Pick<SourceChangeRange, 'endLine' | 'startLine'>,
): void {
  const affected = new Set<Node>();
  for (const line of sourceLinesInRange(root, range)) {
    for (const marker of line.querySelectorAll<HTMLElement>(
      `.${SPELLING_ERROR_CLASS}`,
    )) {
      const parent = marker.parentNode;
      marker.replaceWith(
        root.ownerDocument.createTextNode(marker.textContent ?? ''),
      );
      if (parent) {
        affected.add(parent);
      }
    }
  }
  for (const node of affected) {
    node.normalize();
  }
}

function canMarkTextNode(node: Text): boolean {
  const parent = node.parentElement;
  return Boolean(
    parent &&
      !parent.closest(
        '.md-tok-code, .md-source-link, .md-spelling-error',
      ),
  );
}

function markTextNode(node: Text, misspelled: ReadonlySet<string>): void {
  const text = node.data;
  const matches = [...text.matchAll(SPELLING_WORD)].filter((match) =>
    misspelled.has(match[0]),
  );
  if (matches.length === 0) {
    return;
  }

  const fragment = node.ownerDocument.createDocumentFragment();
  let offset = 0;
  for (const match of matches) {
    if (match.index > offset) {
      fragment.append(text.slice(offset, match.index));
    }
    const marker = node.ownerDocument.createElement('span');
    marker.className = SPELLING_ERROR_CLASS;
    marker.dataset.spellingWord = match[0];
    marker.textContent = match[0];
    fragment.append(marker);
    offset = match.index + match[0].length;
  }
  if (offset < text.length) {
    fragment.append(text.slice(offset));
  }
  node.replaceWith(fragment);
}

export function renderSourceSpellingErrors(
  root: HTMLElement,
  words: readonly string[],
  checkCodeBlocks: boolean,
  range?: Pick<SourceChangeRange, 'endLine' | 'startLine'>,
): void {
  clearSourceSpellingErrors(root, range);
  const misspelled = new Set(words);
  if (misspelled.size === 0) {
    return;
  }

  for (const line of sourceLinesInRange(root, range)) {
    if (line.classList.contains('md-line--code') && !checkCodeBlocks) {
      continue;
    }
    const content = line.querySelector<HTMLElement>(
      ':scope > .md-line__content',
    );
    if (!content) {
      continue;
    }
    const walker = root.ownerDocument.createTreeWalker(
      content,
      NodeFilter.SHOW_TEXT,
    );
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node instanceof Text && canMarkTextNode(node)) {
        nodes.push(node);
      }
    }
    for (const node of nodes) {
      markTextNode(node, misspelled);
    }
  }
}
