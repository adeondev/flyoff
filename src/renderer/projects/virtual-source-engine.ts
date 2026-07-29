import {
  sourceTextLength,
  type SourceSelection,
} from './source-caret';
import {
  isSourceTextChangeApplicable,
  type SourceDocumentModel,
  type SourceTextChange,
} from './source-document-model';
import {
  sourceOffsetInLine,
  type SourceViewportRange,
} from './source-viewport';

export const VIRTUAL_SOURCE_DEFAULT_LINE_HEIGHT = 22;
export const VIRTUAL_SOURCE_INITIAL_RENDERED_LINES = 64;
export const VIRTUAL_SOURCE_MAX_RENDERED_LINES = 96;

export function clampVirtualSourceSelection(
  selection: SourceSelection,
  sourceLength: number,
): SourceSelection {
  const start = Math.min(Math.max(0, selection.start), sourceLength);
  const end = Math.min(Math.max(start, selection.end), sourceLength);
  return {
    direction: start === end ? 'none' : selection.direction,
    end,
    start,
  };
}

export function virtualSourceSelectionDirection(
  anchor: number,
  focus: number,
): SourceSelection['direction'] {
  return anchor === focus ? 'none' : anchor < focus ? 'forward' : 'backward';
}

export function boundedVirtualSourceRange(
  range: SourceViewportRange,
): SourceViewportRange {
  if (range.endLine - range.startLine <= VIRTUAL_SOURCE_MAX_RENDERED_LINES) {
    return range;
  }
  return {
    endLine: range.startLine + VIRTUAL_SOURCE_MAX_RENDERED_LINES,
    startLine: range.startLine,
  };
}

export function maximumVirtualSourceLineLength(
  model: SourceDocumentModel,
  start = 0,
  end = model.lines.length,
): number {
  let maximum = 1;
  for (let index = start; index < end; index += 1) {
    maximum = Math.max(maximum, model.lines[index]?.source.length ?? 0);
  }
  return maximum;
}

export function virtualSourceChange(
  before: string,
  after: string,
  selection: SourceSelection,
  nextSelection: SourceSelection,
): SourceTextChange | undefined {
  if (before === after) {
    return undefined;
  }
  const oldLineStart =
    selection.start === 0
      ? 0
      : before.lastIndexOf('\n', selection.start - 1) + 1;
  const newLineStart =
    nextSelection.start === 0
      ? 0
      : after.lastIndexOf('\n', nextSelection.start - 1) + 1;
  const scanStart = Math.min(
    oldLineStart === 0 ? 0 : before.lastIndexOf('\n', oldLineStart - 2) + 1,
    newLineStart === 0 ? 0 : after.lastIndexOf('\n', newLineStart - 2) + 1,
  );
  const oldBreak = before.indexOf('\n', selection.end);
  const newBreak = after.indexOf('\n', nextSelection.end);
  const oldNextBreak =
    oldBreak === -1 ? -1 : before.indexOf('\n', oldBreak + 1);
  const newNextBreak = newBreak === -1 ? -1 : after.indexOf('\n', newBreak + 1);
  const oldEnd = oldNextBreak === -1 ? before.length : oldNextBreak;
  const newEnd = newNextBreak === -1 ? after.length : newNextBreak;
  const oldRegion = before.slice(scanStart, oldEnd);
  const newRegion = after.slice(scanStart, newEnd);
  let prefix = 0;
  while (
    prefix < oldRegion.length &&
    prefix < newRegion.length &&
    oldRegion[prefix] === newRegion[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldRegion.length - prefix &&
    suffix < newRegion.length - prefix &&
    oldRegion[oldRegion.length - suffix - 1] ===
      newRegion[newRegion.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const change = {
    from: scanStart + prefix,
    insert: newRegion.slice(prefix, newRegion.length - suffix),
    to: scanStart + oldRegion.length - suffix,
  };
  return isSourceTextChangeApplicable(before, after, change)
    ? change
    : undefined;
}

export function measureVirtualSourceLineHeight(root: HTMLElement): number {
  const styles = getComputedStyle(root);
  const explicit = Number.parseFloat(styles.lineHeight);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const fontSize = Number.parseFloat(styles.fontSize);
  return Number.isFinite(fontSize) && fontSize > 0
    ? fontSize * 1.5
    : VIRTUAL_SOURCE_DEFAULT_LINE_HEIGHT;
}

export function virtualSourceOffsetFromPoint(
  root: HTMLElement,
  model: SourceDocumentModel,
  x: number,
  y: number,
  lineHeight: number,
  verticalLayout?: { lineAtOffset: (offset: number) => number },
): number {
  const bounds = root.getBoundingClientRect();
  const verticalOffset = y - bounds.top + root.scrollTop;
  const fallbackLine = verticalLayout
    ? verticalLayout.lineAtOffset(verticalOffset)
    : Math.min(
        model.lines.length - 1,
        Math.max(0, Math.floor(verticalOffset / lineHeight)),
      );
  const document = root.ownerDocument;
  const nativePosition = document.caretPositionFromPoint?.(x, y);
  const fallbackRange = nativePosition
    ? null
    : document.caretRangeFromPoint?.(x, y);
  const position = nativePosition ??
    (fallbackRange
      ? {
          offset: fallbackRange.startOffset,
          offsetNode: fallbackRange.startContainer,
        }
      : undefined);
  const node = position?.offsetNode;
  const line = (
    node?.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node?.parentElement
  )?.closest<HTMLElement>('.md-line');
  if (
    position &&
    line?.parentElement?.classList.contains('virtual-source__rows')
  ) {
    const lineIndex = Number(line.dataset.line) - 1;
    const content = line.querySelector('.md-line__content');
    if (
      content &&
      Number.isInteger(lineIndex) &&
      lineIndex >= 0 &&
      lineIndex < model.lines.length
    ) {
      const range = root.ownerDocument.createRange();
      range.selectNodeContents(content);
      try {
        range.setEnd(position.offsetNode, position.offset);
        return sourceOffsetInLine(
          model,
          lineIndex,
          sourceTextLength(range.cloneContents()),
        );
      } catch {
        return model.lineStarts[lineIndex]!;
      }
    }
  }
  const lineIndex = Number.isFinite(fallbackLine) ? fallbackLine : 0;
  const fontSize = Number.parseFloat(getComputedStyle(root).fontSize) || 14;
  const gutter =
    Number(root.style.getPropertyValue('--md-line-number-digits')) || 3;
  const column = Math.round(
    Math.max(0, x - bounds.left - fontSize * (gutter + 2)) / (fontSize * 0.58),
  );
  return sourceOffsetInLine(model, lineIndex, column);
}
