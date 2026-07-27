const BLOCK_ELEMENTS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DIV',
  'FOOTER',
  'HEADER',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'UL',
]);

export type SourceSelectionDirection = 'forward' | 'backward' | 'none';

export interface SourceSelection {
  start: number;
  end: number;
  direction: SourceSelectionDirection;
}

interface Position {
  node: Node;
  offset: number;
}

function isLine(element: Element): boolean {
  return element.classList.contains('md-line');
}

function lineContent(line: Element): Element {
  const content = line.querySelector(':scope > .md-line__content');
  return content ?? line;
}

function canonicalLines(root: ParentNode): readonly Element[] | undefined {
  const children = Array.from(root.childNodes);
  if (
    children.length === 0 ||
    children.some((child) => child.nodeType !== Node.ELEMENT_NODE || !isLine(child as Element))
  ) {
    return undefined;
  }
  return children as Element[];
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return serializeChildren(node as ParentNode);
  }

  const element = node as Element;
  if (
    element.hasAttribute('data-md-gutter') ||
    element.hasAttribute('data-md-decoration')
  ) {
    return '';
  }
  if (element.tagName === 'BR') {
    return element.hasAttribute('data-md-placeholder') ? '' : '\n';
  }
  return serializeChildren(element);
}

function isPlaceholderBlock(node: Node): boolean {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    BLOCK_ELEMENTS.has((node as Element).tagName) &&
    node.childNodes.length === 1 &&
    node.firstChild?.nodeType === Node.ELEMENT_NODE &&
    (node.firstChild as Element).tagName === 'BR'
  );
}

function serializeChildren(parent: ParentNode): string {
  const segments: string[] = [];
  let inline = '';
  let hasInline = false;

  const flushInline = (): void => {
    if (hasInline) {
      segments.push(inline);
      inline = '';
      hasInline = false;
    }
  };

  for (const child of parent.childNodes) {
    const block =
      child.nodeType === Node.ELEMENT_NODE &&
      BLOCK_ELEMENTS.has((child as Element).tagName);
    if (block) {
      flushInline();
      segments.push(isPlaceholderBlock(child) ? '' : serializeNode(child));
    } else {
      hasInline = true;
      inline += serializeNode(child);
    }
  }

  flushInline();
  return segments.join('\n');
}

function serializeRoot(root: ParentNode): string {
  const lines = canonicalLines(root);
  return lines
    ? lines.map((line) => serializeChildren(lineContent(line))).join('\n')
    : serializeChildren(root);
}

export function readSource(root: HTMLElement): string {
  return serializeRoot(root).replace(/\r\n?/g, '\n');
}

function clampOffset(container: Node, offset: number): number {
  const limit =
    container.nodeType === Node.TEXT_NODE
      ? (container.textContent?.length ?? 0)
      : container.childNodes.length;
  return Math.min(Math.max(0, offset), limit);
}

function rootChildOffset(
  root: HTMLElement,
  offset: number,
  lines: readonly Element[],
): number {
  const clamped = Math.min(Math.max(0, offset), lines.length);
  const model = getSourceDocumentModel(root);
  if (model && model.lines.length === lines.length) {
    return clamped >= model.lines.length
      ? model.source.length
      : model.lineStarts[clamped]!;
  }
  let length = 0;

  for (let index = 0; index < clamped; index += 1) {
    length += serializeChildren(lineContent(lines[index]!)).length;
    if (index < lines.length - 1) {
      length += 1;
    }
  }

  return length;
}

function outsideOffset(root: HTMLElement, container: Node): number {
  const relation = root.compareDocumentPosition(container);
  if (relation & Node.DOCUMENT_POSITION_DISCONNECTED) {
    return 0;
  }
  return relation & Node.DOCUMENT_POSITION_PRECEDING
    ? 0
    : (getSourceDocumentModel(root)?.source.length ?? readSource(root).length);
}

function canonicalLineOffset(
  root: HTMLElement,
  container: Node,
  containerOffset: number,
): number | undefined {
  const model = getSourceDocumentModel(root);
  const element =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as Element)
      : container.parentElement;
  const line = element?.closest<HTMLElement>('.md-line');
  if (!model || !line || line.parentElement !== root) {
    return undefined;
  }
  const index = Number(line.dataset.line) - 1;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= model.lines.length
  ) {
    return undefined;
  }
  if (
    element?.closest('.md-line__gutter')
  ) {
    return model.lineStarts[index];
  }
  if (container === line) {
    return (
      model.lineStarts[index]! +
      (containerOffset > 1 ? model.lines[index]!.source.length : 0)
    );
  }

  const content = lineContent(line);
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(content);
  try {
    range.setEnd(container, clampOffset(container, containerOffset));
  } catch {
    return undefined;
  }
  return (
    model.lineStarts[index]! +
    serializeRoot(range.cloneContents()).length
  );
}

function offsetOf(
  root: HTMLElement,
  container: Node,
  containerOffset: number,
): number {
  const lines = canonicalLines(root);
  if (container === root && lines) {
    return rootChildOffset(root, containerOffset, lines);
  }

  if (container !== root && !root.contains(container)) {
    return outsideOffset(root, container);
  }

  const lineOffset = canonicalLineOffset(
    root,
    container,
    containerOffset,
  );
  if (lineOffset !== undefined) {
    return lineOffset;
  }

  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(container, clampOffset(container, containerOffset));
  } catch {
    return 0;
  }

  return serializeRoot(range.cloneContents()).length;
}

function caretPositionAtPoint(
  document: Document,
  x: number,
  y: number,
): Position | undefined {
  const position = document.caretPositionFromPoint?.(x, y);
  if (position) {
    return { node: position.offsetNode, offset: position.offset };
  }

  const range = document.caretRangeFromPoint?.(x, y);
  return range
    ? { node: range.startContainer, offset: range.startOffset }
    : undefined;
}

function pointOffset(
  root: HTMLElement,
  x: number,
  y: number,
): number | undefined {
  const position = caretPositionAtPoint(root.ownerDocument, x, y);
  if (
    !position ||
    (position.node !== root && !root.contains(position.node))
  ) {
    return undefined;
  }
  return offsetOf(root, position.node, position.offset);
}

export function sourceOffsetAtPoint(
  root: HTMLElement,
  x: number,
  y: number,
): number | undefined {
  const direct = pointOffset(root, x, y);
  if (direct !== undefined) {
    return direct;
  }

  const bounds = root.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return undefined;
  }

  const inset = 1;
  return pointOffset(
    root,
    Math.min(Math.max(x, bounds.left + inset), bounds.right - inset),
    Math.min(Math.max(y, bounds.top + inset), bounds.bottom - inset),
  );
}

function selectionDirection(
  anchor: number,
  focus: number,
): SourceSelectionDirection {
  return anchor === focus ? 'none' : anchor < focus ? 'forward' : 'backward';
}

export function readSelection(root: HTMLElement): SourceSelection {
  const selection = root.ownerDocument.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return { start: 0, end: 0, direction: 'none' };
  }

  const anchor = selection.anchorNode
    ? offsetOf(root, selection.anchorNode, selection.anchorOffset)
    : 0;
  const focus = selection.focusNode
    ? offsetOf(root, selection.focusNode, selection.focusOffset)
    : anchor;

  return {
    start: Math.min(anchor, focus),
    end: Math.max(anchor, focus),
    direction: selectionDirection(anchor, focus),
  };
}

export function readCaret(root: HTMLElement): number {
  const selection = readSelection(root);
  return selection.direction === 'backward' ? selection.start : selection.end;
}

function positionInLine(line: Element, offset: number): Position {
  const content = lineContent(line);
  const walker = line.ownerDocument.createTreeWalker(
    content,
    NodeFilter.SHOW_TEXT,
  );
  let remaining = Math.max(0, offset);
  let node = walker.nextNode();
  let last: Node | null = null;

  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      return { node, offset: remaining };
    }
    remaining -= length;
    last = node;
    node = walker.nextNode();
  }

  return last
    ? { node: last, offset: last.textContent?.length ?? 0 }
    : { node: content, offset: 0 };
}

function positionAt(root: HTMLElement, target: number): Position {
  const lines = canonicalLines(root);
  if (!lines) {
    return { node: root, offset: root.childNodes.length };
  }

  const model = getSourceDocumentModel(root);
  if (model && model.lines.length === lines.length) {
    const index = sourceLineIndexAtOffset(model, target);
    return positionInLine(
      lines[index]!,
      Math.min(
        model.lines[index]!.source.length,
        Math.max(0, target - model.lineStarts[index]!),
      ),
    );
  }

  let remaining = Math.max(0, target);
  for (const line of lines) {
    const length = serializeChildren(lineContent(line)).length;
    if (remaining <= length) {
      return positionInLine(line, remaining);
    }
    remaining -= length + 1;
  }

  const last = lines.at(-1);
  return last
    ? positionInLine(last, serializeChildren(lineContent(last)).length)
    : { node: root, offset: 0 };
}

function normalizeSelection(
  startOrSelection: number | SourceSelection,
  end?: number,
): SourceSelection {
  if (typeof startOrSelection !== 'number') {
    return startOrSelection;
  }
  const selectionEnd = end ?? startOrSelection;
  return {
    start: Math.min(startOrSelection, selectionEnd),
    end: Math.max(startOrSelection, selectionEnd),
    direction:
      startOrSelection === selectionEnd
        ? 'none'
        : startOrSelection < selectionEnd
          ? 'forward'
          : 'backward',
  };
}

export function writeSelection(
  root: HTMLElement,
  startOrSelection: number | SourceSelection,
  end?: number,
): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) {
    return;
  }

  const sourceSelection = normalizeSelection(startOrSelection, end);
  const from = positionAt(root, sourceSelection.start);
  const to = positionAt(root, sourceSelection.end);
  const range = root.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  selection.removeAllRanges();

  if (
    sourceSelection.direction === 'backward' &&
    typeof selection.extend === 'function'
  ) {
    range.collapse(false);
    selection.addRange(range);
    selection.extend(from.node, from.offset);
    return;
  }

  selection.addRange(range);
}

export function writeCaret(root: HTMLElement, target: number): void {
  writeSelection(root, target);
}

export function sourceCaretRect(
  root: HTMLElement,
  target: number,
): DOMRect | undefined {
  const position = positionAt(root, target);
  const range = root.ownerDocument.createRange();
  try {
    range.setStart(position.node, position.offset);
    range.collapse(true);
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    return rect.width || rect.height ? rect : undefined;
  } catch {
    return undefined;
  }
}

export function replaceRange(
  source: string,
  start: number,
  end: number,
  inserted: string,
): string {
  return source.slice(0, start) + inserted + source.slice(end);
}
import { sourceLineIndexAtOffset } from './source-document-model';
import { getSourceDocumentModel } from './source-renderer';
