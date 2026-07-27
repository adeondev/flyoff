import {
  normalizeImageDirective,
  type ImageAlignment,
  type ImageDirective,
  type ImageLayoutMode,
} from '../../shared/markdown';

export type ImageResizeDirection =
  | 'north-west'
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west';

export type ImageInteractionPhase =
  | 'idle'
  | 'text-selecting'
  | 'image-selected'
  | 'image-dragging'
  | 'image-resizing'
  | 'context-menu'
  | 'external-drag';

export interface ImageSelection {
  directive: ImageDirective;
  lineIndex: number;
  sourceRange: ImageSourceRange;
}

export interface ImageSourceRange {
  end: number;
  start: number;
}

export interface ImageDragSize {
  height: number;
  width: number;
}

export interface ImageInsertionPlacement {
  align: ImageAlignment;
  mode: Extract<ImageLayoutMode, 'block' | 'wrap'>;
}

export type ImageDropIntent =
  | {
      kind: 'block-boundary';
      align: ImageAlignment;
      boundaryIndex: number;
    }
  | {
      kind: 'inline-offset';
      offset: number;
    };

export function fitImageDragGhost(
  width: number,
  height: number,
  maxWidth = 640,
  maxHeight = 480,
): ImageDragSize {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = Math.min(
    1,
    Math.max(1, maxWidth) / safeWidth,
    Math.max(1, maxHeight) / safeHeight,
  );
  return {
    height: safeHeight * scale,
    width: safeWidth * scale,
  };
}

export function sameImageDropIntent(
  left: ImageDropIntent | null,
  right: ImageDropIntent | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.kind !== right.kind) {
    return false;
  }
  return left.kind === 'inline-offset' && right.kind === 'inline-offset'
    ? left.offset === right.offset
    : left.kind === 'block-boundary' && right.kind === 'block-boundary'
      ? left.align === right.align &&
        left.boundaryIndex === right.boundaryIndex
      : false;
}

export interface ImageInteractionState {
  phase: ImageInteractionPhase;
  selection: ImageSelection | null;
}

export type ImageInteractionAction =
  | { type: 'select'; selection: ImageSelection }
  | { type: 'start-drag' }
  | { type: 'start-resize' }
  | { type: 'open-menu' }
  | { type: 'external-drag' }
  | { type: 'finish'; selection?: ImageSelection }
  | { type: 'cancel' }
  | { type: 'clear' };

export const initialImageInteractionState: ImageInteractionState = {
  phase: 'idle',
  selection: null,
};

export function reduceImageInteraction(
  state: ImageInteractionState,
  action: ImageInteractionAction,
): ImageInteractionState {
  switch (action.type) {
    case 'select':
      return { phase: 'image-selected', selection: action.selection };
    case 'start-drag':
      return state.selection ? { ...state, phase: 'image-dragging' } : state;
    case 'start-resize':
      return state.selection ? { ...state, phase: 'image-resizing' } : state;
    case 'open-menu':
      return state.selection ? { ...state, phase: 'context-menu' } : state;
    case 'external-drag':
      return { ...state, phase: 'external-drag' };
    case 'finish':
      return {
        phase: action.selection
          ? 'image-selected'
          : state.selection
            ? 'image-selected'
            : 'idle',
        selection: action.selection ?? state.selection,
      };
    case 'cancel':
      return state.selection
        ? { ...state, phase: 'image-selected' }
        : initialImageInteractionState;
    case 'clear':
      return initialImageInteractionState;
  }
}

function horizontalDelta(
  direction: ImageResizeDirection,
  deltaX: number,
): number {
  return direction.includes('west')
    ? -deltaX
    : direction.includes('east')
      ? deltaX
      : 0;
}

function verticalDelta(
  direction: ImageResizeDirection,
  deltaY: number,
): number {
  return direction.includes('north')
    ? -deltaY
    : direction.includes('south')
      ? deltaY
      : 0;
}

export function resizeImageDirective(
  directive: ImageDirective,
  direction: ImageResizeDirection,
  deltaX: number,
  deltaY: number,
  shiftKey: boolean,
  availableWidth: number,
): ImageDirective {
  const preserveRatio = shiftKey ? !directive.ratioLock : directive.ratioLock;
  const ratio = directive.width / directive.height;
  const changesWidth = direction.includes('west') || direction.includes('east');
  const changesHeight =
    direction.includes('north') || direction.includes('south');
  const widthDelta = horizontalDelta(direction, deltaX);
  const heightDelta = verticalDelta(direction, deltaY);
  let width = directive.width + widthDelta;
  let height = directive.height + heightDelta;

  if (preserveRatio) {
    if (changesWidth && changesHeight) {
      const denominator =
        directive.width * directive.width + directive.height * directive.height;
      const scale =
        1 +
        (widthDelta * directive.width + heightDelta * directive.height) /
          Math.max(1, denominator);
      width = directive.width * scale;
      height = directive.height * scale;
    } else if (changesWidth) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
  }

  const minimum = Math.min(directive.minWidth, Math.max(48, availableWidth));
  const maximum = Math.max(
    minimum,
    Math.min(directive.maxWidth, Math.max(48, availableWidth)),
  );
  width = Math.min(maximum, Math.max(minimum, width));
  if (preserveRatio) {
    height = width / ratio;
    if (height < 24) {
      height = 24;
      width = Math.min(maximum, Math.max(minimum, height * ratio));
    } else if (height > 4_096) {
      height = 4_096;
      width = Math.min(maximum, Math.max(minimum, height * ratio));
    }
  } else {
    height = Math.min(4_096, Math.max(24, height));
  }

  return normalizeImageDirective({
    ...directive,
    width,
    height,
  });
}

export function alignmentAtPoint(
  clientX: number,
  bounds: Pick<DOMRect, 'left' | 'width'>,
): ImageAlignment {
  const position = (clientX - bounds.left) / Math.max(1, bounds.width);
  return position < 1 / 3 ? 'left' : position > 2 / 3 ? 'right' : 'center';
}

export function imagePlacementAtPoint(
  clientX: number,
  bounds: Pick<DOMRect, 'left' | 'width'>,
  preferredMode: ImageInsertionPlacement['mode'],
): ImageInsertionPlacement {
  const align = alignmentAtPoint(clientX, bounds);
  return {
    align,
    mode: preferredMode === 'wrap' && align !== 'center' ? 'wrap' : 'block',
  };
}

export function lineBoundaryAtPoint(
  clientY: number,
  lineBounds: readonly Pick<DOMRect, 'top' | 'bottom'>[],
): number {
  if (lineBounds.length === 0) {
    return 0;
  }
  for (let index = 0; index < lineBounds.length; index += 1) {
    const bounds = lineBounds[index]!;
    if (clientY < bounds.top + (bounds.bottom - bounds.top) / 2) {
      return index;
    }
  }
  return lineBounds.length;
}

export function imageBoundaryAtPoint(
  clientY: number,
  imageHeight: number,
  lineBounds: readonly Pick<DOMRect, 'top' | 'bottom'>[],
): number {
  return lineBoundaryAtPoint(clientY - imageHeight / 2, lineBounds);
}

function lineRangeAtOffset(
  source: string,
  offset: number,
): ImageSourceRange {
  const start = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const newline = source.indexOf('\n', offset);
  return { start, end: newline === -1 ? source.length : newline };
}

function insideInlineCode(line: string, offset: number): boolean {
  let cursor = 0;
  while (cursor < line.length) {
    const open = line.indexOf('`', cursor);
    if (open === -1) {
      return false;
    }
    let run = 1;
    while (line[open + run] === '`') {
      run += 1;
    }
    const close = line.indexOf('`'.repeat(run), open + run);
    if (close === -1) {
      return offset > open;
    }
    if (offset > open && offset < close + run) {
      return true;
    }
    cursor = close + run;
  }
  return false;
}

function insideLinkDestination(line: string, offset: number): boolean {
  let cursor = 0;
  while (cursor < line.length) {
    const labelEnd = line.indexOf('](', cursor);
    if (labelEnd === -1) {
      return false;
    }
    const close = line.indexOf(')', labelEnd + 2);
    if (close === -1) {
      return offset > labelEnd;
    }
    if (offset > labelEnd && offset < close + 1) {
      return true;
    }
    cursor = close + 1;
  }
  return false;
}

function inFencedCode(source: string, lineStart: number): boolean {
  let fenced = false;
  let cursor = 0;
  while (cursor < lineStart) {
    const end = source.indexOf('\n', cursor);
    const line = source.slice(cursor, end === -1 ? source.length : end);
    if (/^ {0,3}(?:`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
    }
    if (end === -1) {
      break;
    }
    cursor = end + 1;
  }
  return fenced;
}

export function inlineImageDropOffset(
  source: string,
  candidate: number,
  excluded?: ImageSourceRange,
): number | null {
  const clamped = Math.max(0, Math.min(source.length, candidate));
  const line = lineRangeAtOffset(source, clamped);
  if (inFencedCode(source, line.start)) {
    return null;
  }
  const text = source.slice(line.start, line.end);
  if (
    /^ {0,3}(?:`{3,}|~{3,})/.test(text) ||
    /^\s*::(?:image|media)\[/.test(text)
  ) {
    return null;
  }
  const localCandidate = clamped - line.start;
  if (
    insideInlineCode(text, localCandidate) ||
    insideLinkDestination(text, localCandidate)
  ) {
    return null;
  }
  const candidates = new Set<number>([0, text.length]);
  for (let index = 1; index < text.length; index += 1) {
    if (/\s/u.test(text[index - 1]!) || /\s/u.test(text[index]!)) {
      candidates.add(index);
    }
  }
  const safe = [...candidates].filter((local) => {
    const absolute = line.start + local;
    return (
      !(excluded && absolute > excluded.start && absolute < excluded.end) &&
      !insideInlineCode(text, local) &&
      !insideLinkDestination(text, local)
    );
  });
  if (safe.length === 0) {
    return null;
  }
  safe.sort(
    (left, right) =>
      Math.abs(left - localCandidate) - Math.abs(right - localCandidate) ||
      left - right,
  );
  return line.start + safe[0]!;
}
