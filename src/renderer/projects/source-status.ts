import type { SourceSelection } from './source-caret';

export interface SourcePositionStatus {
  line: number;
  column: number;
  selected: number;
}

function graphemeCount(value: string): number {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)]
      .length;
  }
  return [...value].length;
}

export function sourcePositionStatus(
  content: string,
  selection: SourceSelection,
): SourcePositionStatus {
  const start = Math.min(Math.max(0, selection.start), content.length);
  const end = Math.min(Math.max(start, selection.end), content.length);
  const focus = selection.direction === 'backward' ? start : end;
  const beforeFocus = content.slice(0, focus);
  const lastBreak = beforeFocus.lastIndexOf('\n');

  return {
    line: beforeFocus.split('\n').length,
    column: graphemeCount(beforeFocus.slice(lastBreak + 1)) + 1,
    selected: graphemeCount(content.slice(start, end)),
  };
}
