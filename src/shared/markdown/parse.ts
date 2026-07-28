import type {
  BlockNode,
  HeadingDepth,
  ListItem,
  Root,
  SourceRange,
} from './ast';
import { parseInline } from './inline';
import { parseImageDirective, parseMediaDirective } from './media';

const BLANK = /^[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const DIVIDED_ATX = /^ {0,3}(#{1,6})--[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const BLOCKQUOTE = /^ {0,3}>[ ]?(.*)$/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const TASK = /^\[([ xX])\][ \t]+(.*)$/;
const TABLE_DIVIDER_CELL = /^:?-{3,}:?$/;
const MEDIA_DIRECTIVE = /^::media\[/;
const IMAGE_DIRECTIVE = /^::image\[/;

interface SourceLine {
  end: number;
  start: number;
  text: string;
}

export interface MarkdownBlockSource extends SourceRange {
  source: string;
}

function splitSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== '\n' && character !== '\r') {
      continue;
    }
    lines.push({ end: index, start, text: source.slice(start, index) });
    if (character === '\r' && source[index + 1] === '\n') {
      index += 1;
    }
    start = index + 1;
  }

  lines.push({
    end: source.length,
    start,
    text: source.slice(start),
  });
  return lines;
}

function syntheticSourceLines(lines: readonly string[]): SourceLine[] {
  let offset = 0;
  return lines.map((text) => {
    const line = { end: offset + text.length, start: offset, text };
    offset = line.end + 1;
    return line;
  });
}

function sourceRange(
  lines: readonly SourceLine[],
  start: number,
  end: number,
): SourceRange {
  return {
    end: lines[Math.max(start, end - 1)]?.end ?? 0,
    start: lines[start]?.start ?? 0,
  };
}

function positioned<T extends { type: BlockNode['type'] }>(
  block: T,
  lines: readonly SourceLine[],
  start: number,
  end: number,
): T & { position: SourceRange } {
  return { ...block, position: sourceRange(lines, start, end) };
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let value = '';
  let escaped = false;
  for (const character of trimmed) {
    if (escaped) {
      value += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  cells.push(value.trim());
  return cells;
}

function tableAlignments(line: string) {
  const cells = splitTableRow(line);
  if (cells.length === 0 || !cells.every((cell) => TABLE_DIVIDER_CELL.test(cell))) {
    return null;
  }
  return cells.map((cell) =>
    cell.startsWith(':') && cell.endsWith(':')
      ? ('center' as const)
      : cell.endsWith(':')
        ? ('right' as const)
        : cell.startsWith(':')
          ? ('left' as const)
          : null,
  );
}

function isBlockStart(line: string): boolean {
  const image = IMAGE_DIRECTIVE.test(line)
    ? parseImageDirective(line)
    : null;
  const media = MEDIA_DIRECTIVE.test(line)
    ? parseMediaDirective(line)
    : null;
  return (
    FENCE.test(line) ||
    DIVIDED_ATX.test(line) ||
    ATX.test(line) ||
    THEMATIC_BREAK.test(line) ||
    BLOCKQUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    media !== null ||
    Boolean(image && image.mode !== 'inline')
  );
}

function fenceEnd(lines: readonly SourceLine[], start: number): number {
  const marker = FENCE.exec(lines[start]!.text)![1]!;
  const closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`);
  let index = start + 1;
  while (index < lines.length) {
    if (closing.test(lines[index]!.text)) {
      return index + 1;
    }
    index += 1;
  }
  return index;
}

function listEnd(lines: readonly SourceLine[], start: number): number {
  const ordered = /\d/.test(LIST_ITEM.exec(lines[start]!.text)![2]!);
  let index = start + 1;
  while (index < lines.length) {
    const match = LIST_ITEM.exec(lines[index]!.text);
    if (!match || /\d/.test(match[2]!) !== ordered) {
      break;
    }
    index += 1;
  }
  return index;
}

function blockEnd(lines: readonly SourceLine[], start: number): number {
  const line = lines[start]!.text;
  const image = IMAGE_DIRECTIVE.test(line)
    ? parseImageDirective(line)
    : null;
  if (FENCE.test(line)) {
    return fenceEnd(lines, start);
  }
  if (
    DIVIDED_ATX.test(line) ||
    ATX.test(line) ||
    THEMATIC_BREAK.test(line) ||
    (MEDIA_DIRECTIVE.test(line) && parseMediaDirective(line) !== null) ||
    Boolean(image && image.mode !== 'inline')
  ) {
    return start + 1;
  }
  if (BLOCKQUOTE.test(line)) {
    let index = start + 1;
    while (index < lines.length && !BLANK.test(lines[index]!.text)) {
      index += 1;
    }
    return index;
  }
  if (LIST_ITEM.test(line)) {
    return listEnd(lines, start);
  }

  const alignments =
    start + 1 < lines.length
      ? tableAlignments(lines[start + 1]!.text)
      : null;
  if (alignments && line.includes('|')) {
    let index = start + 2;
    while (
      index < lines.length &&
      !BLANK.test(lines[index]!.text) &&
      lines[index]!.text.includes('|')
    ) {
      index += 1;
    }
    return index;
  }

  let index = start + 1;
  while (
    index < lines.length &&
    !BLANK.test(lines[index]!.text) &&
    !isBlockStart(lines[index]!.text)
  ) {
    index += 1;
  }
  return index;
}

function parseFence(lines: readonly SourceLine[], start: number): BlockNode {
  const end = fenceEnd(lines, start);
  const lang = FENCE.exec(lines[start]!.text)![2]!.trim() || null;
  const bodyEnd =
    end > start + 1 && FENCE.test(lines[end - 1]!.text) ? end - 1 : end;
  return positioned(
    {
      type: 'code' as const,
      lang,
      value: lines
        .slice(start + 1, bodyEnd)
        .map(({ text }) => text)
        .join('\n'),
    },
    lines,
    start,
    end,
  );
}

function parseList(lines: readonly SourceLine[], start: number): BlockNode {
  const first = LIST_ITEM.exec(lines[start]!.text)!;
  const ordered = /\d/.test(first[2]!);
  const startNumber = ordered ? Number.parseInt(first[2]!, 10) : null;
  const end = listEnd(lines, start);
  const items: ListItem[] = [];

  for (let index = start; index < end; index += 1) {
    const match = LIST_ITEM.exec(lines[index]!.text)!;
    let content = match[4]!;
    let checked: boolean | null = null;
    const task = TASK.exec(content);
    if (task) {
      checked = task[1] !== ' ';
      content = task[2]!;
    }
    items.push({
      type: 'listItem',
      checked,
      children: [
        positioned(
          { type: 'paragraph' as const, children: parseInline(content) },
          lines,
          index,
          index + 1,
        ),
      ],
    });
  }

  return positioned(
    { type: 'list' as const, ordered, start: startNumber, children: items },
    lines,
    start,
    end,
  );
}

function parseBlockLines(lines: readonly SourceLine[]): BlockNode[] {
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!.text;
    if (BLANK.test(line)) {
      index += 1;
      continue;
    }

    if (FENCE.test(line)) {
      const block = parseFence(lines, index);
      blocks.push(block);
      index = blockEnd(lines, index);
      continue;
    }

    if (MEDIA_DIRECTIVE.test(line)) {
      const directive = parseMediaDirective(line);
      if (directive) {
        blocks.push(
          positioned(
            { type: 'media' as const, directive },
            lines,
            index,
            index + 1,
          ),
        );
        index += 1;
        continue;
      }
    }

    if (IMAGE_DIRECTIVE.test(line)) {
      const directive = parseImageDirective(line);
      if (directive && directive.mode !== 'inline') {
        blocks.push(
          positioned(
            { type: 'image-block' as const, directive },
            lines,
            index,
            index + 1,
          ),
        );
        index += 1;
        continue;
      }
    }

    const dividedAtx = DIVIDED_ATX.exec(line);
    if (dividedAtx) {
      blocks.push(
        positioned(
          {
            type: 'heading' as const,
            depth: dividedAtx[1]!.length as HeadingDepth,
            divided: true,
            children: parseInline(dividedAtx[2]!.trim()),
          },
          lines,
          index,
          index + 1,
        ),
      );
      index += 1;
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      blocks.push(
        positioned(
          {
            type: 'heading' as const,
            depth: atx[1]!.length as HeadingDepth,
            divided: false,
            children: parseInline((atx[2] ?? '').trim()),
          },
          lines,
          index,
          index + 1,
        ),
      );
      index += 1;
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      blocks.push(
        positioned(
          { type: 'thematicBreak' as const },
          lines,
          index,
          index + 1,
        ),
      );
      index += 1;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      const end = blockEnd(lines, index);
      const inner = lines.slice(index, end).map((sourceLine) => {
        const match = BLOCKQUOTE.exec(sourceLine.text);
        if (!match) {
          return sourceLine;
        }
        const prefixLength = match[0].length - match[1]!.length;
        return {
          end: sourceLine.end,
          start: sourceLine.start + prefixLength,
          text: match[1]!,
        };
      });
      blocks.push(
        positioned(
          {
            type: 'blockquote' as const,
            children: parseBlockLines(inner),
          },
          lines,
          index,
          end,
        ),
      );
      index = end;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const block = parseList(lines, index);
      blocks.push(block);
      index = blockEnd(lines, index);
      continue;
    }

    const alignments =
      index + 1 < lines.length
        ? tableAlignments(lines[index + 1]!.text)
        : null;
    if (alignments && line.includes('|')) {
      const start = index;
      const headerCells = splitTableRow(line);
      const rows: ReturnType<typeof parseInline>[][] = [];
      index += 2;
      while (
        index < lines.length &&
        !BLANK.test(lines[index]!.text) &&
        lines[index]!.text.includes('|')
      ) {
        rows.push(splitTableRow(lines[index]!.text).map(parseInline));
        index += 1;
      }
      blocks.push(
        positioned(
          {
            type: 'table' as const,
            alignments,
            header: headerCells.map(parseInline),
            rows,
          },
          lines,
          start,
          index,
        ),
      );
      continue;
    }

    const start = index;
    const end = blockEnd(lines, start);
    const paragraph = lines
      .slice(start, end)
      .map(({ text }) => text)
      .join('\n')
      .trim();
    blocks.push(
      positioned(
        {
          type: 'paragraph' as const,
          children: parseInline(paragraph),
        },
        lines,
        start,
        end,
      ),
    );
    index = end;
  }

  return blocks;
}

export function splitMarkdownBlocks(source: string): MarkdownBlockSource[] {
  const lines = splitSourceLines(source);
  const blocks: MarkdownBlockSource[] = [];
  let index = 0;

  while (index < lines.length) {
    if (BLANK.test(lines[index]!.text)) {
      index += 1;
      continue;
    }
    const end = blockEnd(lines, index);
    const range = sourceRange(lines, index, end);
    blocks.push({ ...range, source: source.slice(range.start, range.end) });
    index = end;
  }

  return blocks;
}

export function parseBlocks(lines: readonly string[]): BlockNode[] {
  return parseBlockLines(syntheticSourceLines(lines));
}

export function parseMarkdown(source: string): Root {
  return { type: 'root', children: parseBlockLines(splitSourceLines(source)) };
}
