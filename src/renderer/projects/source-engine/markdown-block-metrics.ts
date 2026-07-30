import { parseImageDirective } from '../../../shared/markdown';

/**
 * Coarse classification of a block, taken from its source text alone. The
 * windowed reading view needs a height for every block in the document, but
 * only parses the ones it mounts, so the estimate has to come from characters
 * rather than from an AST.
 */
export type MarkdownBlockKind =
  | 'code'
  | 'heading'
  | 'image'
  | 'list'
  | 'paragraph'
  | 'quote'
  | 'rule'
  | 'table';

const HEADING = /^ {0,3}#{1,6}(?:[ \t]|--|$)/;
const LIST = /^ {0,3}(?:[-*+][ \t]|\d{1,9}[.)][ \t])/;
const CODE_FENCE = /^ {0,3}(?:```|~~~)/;
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

export function markdownBlockKind(source: string): MarkdownBlockKind {
  const firstBreak = source.indexOf('\n');
  const firstLine = firstBreak === -1 ? source : source.slice(0, firstBreak);

  if (CODE_FENCE.test(firstLine)) {
    return 'code';
  }
  if (RULE.test(firstLine.trimEnd())) {
    return 'rule';
  }
  if (HEADING.test(firstLine)) {
    return 'heading';
  }
  if (firstLine.trimStart().startsWith('>')) {
    return 'quote';
  }
  if (firstLine.trimStart().startsWith('|')) {
    return 'table';
  }
  if (LIST.test(firstLine)) {
    return 'list';
  }
  const leading = firstLine.trimStart();
  if (leading.startsWith('::image[') || leading.startsWith('::media[')) {
    return 'image';
  }
  return 'paragraph';
}

/**
 * Heights start as a guess and are corrected by measurement, so the model only
 * has to be consistent — a per-kind height for each wrapped row, plus whatever
 * fixed box the block carries regardless of its text.
 */
export interface MarkdownBlockMetrics {
  charsPerRow: number;
  heightPerRow: Record<MarkdownBlockKind, number>;
  rowHeight: number;
}

const KIND_ROW_SCALE: Record<MarkdownBlockKind, number> = {
  code: 1.25,
  heading: 1.9,
  image: 1,
  list: 1.15,
  paragraph: 1.35,
  quote: 1.35,
  rule: 1.4,
  table: 1.5,
};

export function createMarkdownBlockMetrics(
  rowHeight: number,
  contentWidth: number,
): MarkdownBlockMetrics {
  const safeRowHeight = rowHeight > 0 ? rowHeight : 24;
  // An average glyph is far narrower than the line box; this only needs to be
  // close enough for the first paint, since measurement corrects it.
  const averageCharWidth = safeRowHeight * 0.47;
  return {
    charsPerRow: Math.max(
      16,
      Math.floor((contentWidth > 0 ? contentWidth : 720) / averageCharWidth),
    ),
    heightPerRow: {
      code: safeRowHeight * KIND_ROW_SCALE.code,
      heading: safeRowHeight * KIND_ROW_SCALE.heading,
      image: safeRowHeight * KIND_ROW_SCALE.image,
      list: safeRowHeight * KIND_ROW_SCALE.list,
      paragraph: safeRowHeight * KIND_ROW_SCALE.paragraph,
      quote: safeRowHeight * KIND_ROW_SCALE.quote,
      rule: safeRowHeight * KIND_ROW_SCALE.rule,
      table: safeRowHeight * KIND_ROW_SCALE.table,
    },
    rowHeight: safeRowHeight,
  };
}

/** Wrapped rows a block occupies, counting soft wrapping of long lines. */
export function markdownBlockRows(
  source: string,
  charsPerRow: number,
): number {
  const perRow = charsPerRow > 0 ? charsPerRow : 80;
  let rows = 0;
  let lineStart = 0;

  for (;;) {
    const breakOffset = source.indexOf('\n', lineStart);
    const end = breakOffset === -1 ? source.length : breakOffset;
    rows += Math.max(1, Math.ceil((end - lineStart) / perRow));
    if (breakOffset === -1) {
      break;
    }
    lineStart = breakOffset + 1;
  }

  return Math.max(1, rows);
}

/**
 * An image block declares its own height, so it can be placed exactly instead
 * of estimated — the common cause of a scrollbar that jumps while you scroll.
 */
export function markdownImageBlockHeight(source: string): number | undefined {
  const trimmed = source.trim();
  if (!trimmed.startsWith('::image[')) {
    return undefined;
  }
  const directive = parseImageDirective(trimmed);
  // A wrapped image shares its row with the text flowing beside it, so its
  // declared height is not the height of the block.
  if (!directive || directive.mode === 'wrap') {
    return undefined;
  }
  return directive.height;
}

export function estimateMarkdownBlockHeight(
  source: string,
  metrics: MarkdownBlockMetrics,
): number {
  const declared = markdownImageBlockHeight(source);
  if (declared !== undefined) {
    return declared;
  }
  const kind = markdownBlockKind(source);
  const rows = markdownBlockRows(source, metrics.charsPerRow);
  return Math.max(metrics.rowHeight, rows * metrics.heightPerRow[kind]);
}

/**
 * Fold a real measurement back into the model. Blocks of the same kind share a
 * per-row height, so measuring the first screen sharpens the estimate for the
 * thousands of blocks that were never mounted.
 */
export function calibrateMarkdownBlockMetrics(
  metrics: MarkdownBlockMetrics,
  source: string,
  measuredHeight: number,
): void {
  if (measuredHeight <= 0 || markdownImageBlockHeight(source) !== undefined) {
    return;
  }
  const kind = markdownBlockKind(source);
  const rows = markdownBlockRows(source, metrics.charsPerRow);
  const observed = measuredHeight / rows;
  if (!Number.isFinite(observed) || observed <= 0) {
    return;
  }
  metrics.heightPerRow[kind] = metrics.heightPerRow[kind] * 0.75 + observed * 0.25;
}
