/**
 * The rich source editor renders one element per source line, so offsets are
 * measured against those line elements: Range.toString() alone would not
 * account for the line breaks between blocks.
 *
 * Every helper tolerates the transient structure a browser may produce mid-edit
 * (a bare <div> right after Enter, say), because the editor re-renders its own
 * structure immediately afterwards.
 */

function lineElements(root: HTMLElement): readonly Element[] {
  return Array.from(root.children);
}

export function readSource(root: HTMLElement): string {
  const lines = lineElements(root);

  return lines.length === 0
    ? (root.textContent ?? '')
    : lines.map((line) => line.textContent ?? '').join('\n');
}

function offsetOf(
  root: HTMLElement,
  container: Node,
  containerOffset: number,
): number {
  let offset = 0;

  for (const line of lineElements(root)) {
    if (line === container || line.contains(container)) {
      const measure = root.ownerDocument.createRange();
      measure.selectNodeContents(line);
      measure.setEnd(container, containerOffset);
      return offset + measure.toString().length;
    }

    offset += (line.textContent?.length ?? 0) + 1;
  }

  return offset;
}

export interface SourceSelection {
  start: number;
  end: number;
}

export function readSelection(root: HTMLElement): SourceSelection {
  const selection = root.ownerDocument.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return { start: 0, end: 0 };
  }

  const range = selection.getRangeAt(0);

  if (!root.contains(range.startContainer)) {
    return { start: 0, end: 0 };
  }

  return {
    start: offsetOf(root, range.startContainer, range.startOffset),
    end: offsetOf(root, range.endContainer, range.endOffset),
  };
}

export function readCaret(root: HTMLElement): number {
  return readSelection(root).end;
}

interface Position {
  node: Node;
  offset: number;
}

function positionInLine(line: Element, offset: number): Position {
  const walker = line.ownerDocument.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let remaining = offset;
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
    : { node: line, offset: 0 };
}

function positionAt(root: HTMLElement, target: number): Position {
  const lines = lineElements(root);
  let remaining = Math.max(0, target);

  for (const line of lines) {
    const length = line.textContent?.length ?? 0;

    if (remaining <= length) {
      return positionInLine(line, remaining);
    }

    remaining -= length + 1;
  }

  const last = lines.at(-1);
  return last
    ? positionInLine(last, last.textContent?.length ?? 0)
    : { node: root, offset: 0 };
}

export function writeSelection(
  root: HTMLElement,
  start: number,
  end: number = start,
): void {
  const selection = root.ownerDocument.getSelection();

  if (!selection) {
    return;
  }

  const from = positionAt(root, start);
  const to = positionAt(root, end);
  const range = root.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function writeCaret(root: HTMLElement, target: number): void {
  writeSelection(root, target);
}

export function replaceRange(
  source: string,
  start: number,
  end: number,
  inserted: string,
): string {
  return source.slice(0, start) + inserted + source.slice(end);
}
