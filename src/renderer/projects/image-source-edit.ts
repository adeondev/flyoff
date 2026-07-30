import {
  parseImageDirective,
  parseImageDirectiveAt,
  serializeImageDirective,
  type ImageDirective,
} from '../../shared/markdown';
import type {
  ImageDropIntent,
  ImageSourceRange,
} from './image-interaction';

export type ImageSourceOperation =
  | {
      type: 'change';
      sourceRange: ImageSourceRange;
      directive: ImageDirective;
    }
  | {
      type: 'move';
      sourceRange: ImageSourceRange;
      intent: ImageDropIntent;
      directive: ImageDirective;
    }
  | {
      type: 'delete';
      sourceRange: ImageSourceRange;
      instanceId: string;
    }
  | {
      type: 'duplicate';
      sourceRange: ImageSourceRange;
      directive: ImageDirective;
    };

export interface ImageSourceEdit {
  caret: number;
  content: string;
}

export interface ResolvedImageSource {
  directive: ImageDirective;
  range: ImageSourceRange;
}

function validRange(
  content: string,
  range: ImageSourceRange,
): boolean {
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.end > range.start &&
    range.end <= content.length
  );
}

export function resolveImageSourceByInstance(
  content: string,
  instanceId: string,
  preferredRange?: ImageSourceRange,
): ResolvedImageSource | null {
  if (preferredRange && validRange(content, preferredRange)) {
    const directive = parseImageDirective(
      content.slice(preferredRange.start, preferredRange.end),
    );
    if (directive?.instanceId === instanceId) {
      return { directive, range: preferredRange };
    }
  }

  const marker = `instance=${instanceId}`;
  let markerStart = content.indexOf(marker);
  while (markerStart !== -1) {
    const lineStart =
      content.lastIndexOf('\n', Math.max(0, markerStart - 1)) + 1;
    let directiveStart = content.lastIndexOf('::image[', markerStart);
    while (directiveStart >= lineStart) {
      const parsed = parseImageDirectiveAt(content, directiveStart);
      if (
        parsed?.directive.instanceId === instanceId &&
        parsed.start <= markerStart &&
        parsed.end >= markerStart + marker.length
      ) {
        return {
          directive: parsed.directive,
          range: { start: parsed.start, end: parsed.end },
        };
      }
      directiveStart = content.lastIndexOf(
        '::image[',
        directiveStart - 1,
      );
    }
    markerStart = content.indexOf(marker, markerStart + marker.length);
  }
  return null;
}

function lineBounds(
  content: string,
  offset: number,
): ImageSourceRange {
  const start = content.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const newline = content.indexOf('\n', offset);
  return { start, end: newline === -1 ? content.length : newline };
}

function wholeLineRange(
  content: string,
  range: ImageSourceRange,
): ImageSourceRange {
  const line = lineBounds(content, range.start);
  if (
    content.slice(line.start, range.start).trim() ||
    content.slice(range.end, line.end).trim()
  ) {
    return range;
  }
  if (line.end < content.length) {
    return { start: line.start, end: line.end + 1 };
  }
  return line.start > 0
    ? { start: line.start - 1, end: line.end }
    : line;
}

function inlineRemovalRange(
  content: string,
  range: ImageSourceRange,
): ImageSourceRange {
  const before = content[range.start - 1];
  const after = content[range.end];
  return before &&
    after &&
    before !== '\n' &&
    after !== '\n' &&
    /\s/u.test(before) &&
    /\s/u.test(after)
    ? { start: range.start, end: range.end + 1 }
    : range;
}

function adjustedOffset(
  offset: number,
  removed: ImageSourceRange,
): number {
  if (offset <= removed.start) {
    return offset;
  }
  if (offset >= removed.end) {
    return offset - (removed.end - removed.start);
  }
  return removed.start;
}

function lineBoundaryOffset(content: string, boundaryIndex: number): number {
  if (boundaryIndex <= 0) {
    return 0;
  }
  let offset = 0;
  let line = 0;
  while (line < boundaryIndex) {
    const newline = content.indexOf('\n', offset);
    if (newline === -1) {
      return content.length;
    }
    offset = newline + 1;
    line += 1;
  }
  return offset;
}

function insertBlock(
  content: string,
  offset: number,
  serialized: string,
): ImageSourceEdit {
  const clamped = Math.max(0, Math.min(content.length, offset));
  const prefix =
    clamped > 0 && content[clamped - 1] !== '\n' ? '\n' : '';
  const suffix =
    clamped < content.length && content[clamped] !== '\n' ? '\n' : '';
  const inserted = `${prefix}${serialized}${suffix}`;
  return {
    content: content.slice(0, clamped) + inserted + content.slice(clamped),
    caret: clamped + prefix.length,
  };
}

function insertInline(
  content: string,
  offset: number,
  serialized: string,
): ImageSourceEdit {
  const clamped = Math.max(0, Math.min(content.length, offset));
  const before = content[clamped - 1];
  const after = content[clamped];
  const prefix = before && !/\s/u.test(before) ? ' ' : '';
  const suffix = after && !/\s/u.test(after) ? ' ' : '';
  const inserted = `${prefix}${serialized}${suffix}`;
  return {
    content: content.slice(0, clamped) + inserted + content.slice(clamped),
    caret: clamped + prefix.length,
  };
}

export function rewriteImageSource(
  content: string,
  operation: ImageSourceOperation,
): ImageSourceEdit | null {
  if (!validRange(content, operation.sourceRange)) {
    return null;
  }
  const currentSource = content.slice(
    operation.sourceRange.start,
    operation.sourceRange.end,
  );
  const current = parseImageDirective(currentSource);
  const instanceId =
    operation.type === 'delete'
      ? operation.instanceId
      : operation.directive.instanceId;
  if (current?.instanceId !== instanceId) {
    return null;
  }

  if (operation.type === 'change') {
    const serialized = serializeImageDirective(operation.directive);
    if (current?.mode === 'inline' && operation.directive.mode !== 'inline') {
      const without =
        content.slice(0, operation.sourceRange.start) +
        content.slice(operation.sourceRange.end);
      return insertBlock(without, operation.sourceRange.start, serialized);
    }
    return {
      content:
        content.slice(0, operation.sourceRange.start) +
        serialized +
        content.slice(operation.sourceRange.end),
      caret: operation.sourceRange.start,
    };
  }

  if (operation.type === 'duplicate') {
    const serialized = serializeImageDirective({
      ...operation.directive,
      instanceId: crypto.randomUUID(),
    });
    const insertion =
      current?.mode === 'inline'
        ? operation.sourceRange.end
        : wholeLineRange(content, operation.sourceRange).end;
    return operation.directive.mode === 'inline'
      ? insertInline(content, insertion, serialized)
      : insertBlock(content, insertion, serialized);
  }

  const removal =
    current?.mode === 'inline'
      ? inlineRemovalRange(content, operation.sourceRange)
      : wholeLineRange(content, operation.sourceRange);
  const without =
    content.slice(0, removal.start) + content.slice(removal.end);

  if (operation.type === 'delete') {
    return { content: without || '', caret: removal.start };
  }

  const serialized = serializeImageDirective(operation.directive);

  if (operation.intent.kind === 'inline-offset') {
    return insertInline(
      without,
      adjustedOffset(operation.intent.offset, removal),
      serialized,
    );
  }
  const originalOffset = lineBoundaryOffset(
    content,
    operation.intent.boundaryIndex,
  );
  return insertBlock(
    without,
    adjustedOffset(originalOffset, removal),
    serialized,
  );
}
