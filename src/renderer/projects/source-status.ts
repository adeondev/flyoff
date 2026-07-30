import type { SourceSelection } from './source-caret';
import {
  sourceLineIndexAtOffset,
  type SourceDocumentModel,
} from './source-document-model';
import { countGraphemes } from './source-grapheme';

export interface SourcePositionStatus {
  line: number;
  column: number;
  selected: number;
}

function modelGraphemeOffset(
  model: SourceDocumentModel,
  offset: number,
): number {
  const line = sourceLineIndexAtOffset(model, offset);
  const localOffset = Math.max(0, offset - model.lineStarts[line]!);
  return (
    model.lineGraphemeStarts[line]! +
    countGraphemes(model.lines[line]!.source.slice(0, localOffset))
  );
}

export function sourcePositionStatus(
  content: string,
  selection: SourceSelection,
  model?: SourceDocumentModel,
): SourcePositionStatus {
  const start = Math.min(Math.max(0, selection.start), content.length);
  const end = Math.min(Math.max(start, selection.end), content.length);
  const focus = selection.direction === 'backward' ? start : end;
  if (model?.source === content) {
    const line = sourceLineIndexAtOffset(model, focus);
    return {
      line: line + 1,
      column:
        countGraphemes(
          model.lines[line]!.source.slice(
            0,
            Math.max(0, focus - model.lineStarts[line]!),
          ),
        ) + 1,
      selected:
        modelGraphemeOffset(model, end) -
        modelGraphemeOffset(model, start),
    };
  }
  const beforeFocus = content.slice(0, focus);
  const lastBreak = beforeFocus.lastIndexOf('\n');

  return {
    line: beforeFocus.split('\n').length,
    column: countGraphemes(beforeFocus.slice(lastBreak + 1)) + 1,
    selected: countGraphemes(content.slice(start, end)),
  };
}
