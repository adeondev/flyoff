import type { BlockNode, HeadingDepth, ListItem, Root } from './ast';
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
  return (
    FENCE.test(line) ||
    DIVIDED_ATX.test(line) ||
    ATX.test(line) ||
    THEMATIC_BREAK.test(line) ||
    BLOCKQUOTE.test(line) ||
    LIST_ITEM.test(line)
    || MEDIA_DIRECTIVE.test(line) ||
    Boolean(image && image.mode !== 'inline')
  );
}

function parseFence(
  lines: readonly string[],
  start: number,
): { block: BlockNode; end: number } {
  const marker = FENCE.exec(lines[start]!)![1]!;
  const closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`);
  const lang = FENCE.exec(lines[start]!)![2]!.trim() || null;
  const body: string[] = [];
  let index = start + 1;

  while (index < lines.length) {
    if (closing.test(lines[index]!)) {
      index += 1;
      break;
    }
    body.push(lines[index]!);
    index += 1;
  }

  return { block: { type: 'code', lang, value: body.join('\n') }, end: index };
}

function parseList(
  lines: readonly string[],
  start: number,
): { block: BlockNode; end: number } {
  const first = LIST_ITEM.exec(lines[start]!)!;
  const ordered = /\d/.test(first[2]!);
  const startNumber = ordered ? Number.parseInt(first[2]!, 10) : null;
  const items: ListItem[] = [];
  let index = start;

  while (index < lines.length) {
    const match = LIST_ITEM.exec(lines[index]!);
    if (!match || /\d/.test(match[2]!) !== ordered) {
      break;
    }

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
      children: [{ type: 'paragraph', children: parseInline(content) }],
    });
    index += 1;
  }

  return {
    block: { type: 'list', ordered, start: startNumber, children: items },
    end: index,
  };
}

export function parseBlocks(lines: readonly string[]): BlockNode[] {
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (BLANK.test(line)) {
      index += 1;
      continue;
    }

    if (FENCE.test(line)) {
      const parsed = parseFence(lines, index);
      blocks.push(parsed.block);
      index = parsed.end;
      continue;
    }

    if (MEDIA_DIRECTIVE.test(line)) {
      const directive = parseMediaDirective(line);
      if (directive) {
        blocks.push({ type: 'media', directive });
        index += 1;
        continue;
      }
    }

    if (IMAGE_DIRECTIVE.test(line)) {
      const directive = parseImageDirective(line);
      if (directive && directive.mode !== 'inline') {
        blocks.push({ type: 'image-block', directive });
        index += 1;
        continue;
      }
    }

    const dividedAtx = DIVIDED_ATX.exec(line);
    if (dividedAtx) {
      blocks.push({
        type: 'heading',
        depth: dividedAtx[1]!.length as HeadingDepth,
        divided: true,
        children: parseInline(dividedAtx[2]!.trim()),
      });
      index += 1;
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      blocks.push({
        type: 'heading',
        depth: atx[1]!.length as HeadingDepth,
        divided: false,
        children: parseInline((atx[2] ?? '').trim()),
      });
      index += 1;
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      blocks.push({ type: 'thematicBreak' });
      index += 1;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      const inner: string[] = [];
      while (index < lines.length && !BLANK.test(lines[index]!)) {
        const match = BLOCKQUOTE.exec(lines[index]!);
        inner.push(match ? match[1]! : lines[index]!);
        index += 1;
      }
      blocks.push({ type: 'blockquote', children: parseBlocks(inner) });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const parsed = parseList(lines, index);
      blocks.push(parsed.block);
      index = parsed.end;
      continue;
    }

    const alignments = index + 1 < lines.length
      ? tableAlignments(lines[index + 1]!)
      : null;
    if (alignments && line.includes('|')) {
      const headerCells = splitTableRow(line);
      const rows: ReturnType<typeof parseInline>[][] = [];
      index += 2;
      while (
        index < lines.length &&
        !BLANK.test(lines[index]!) &&
        lines[index]!.includes('|')
      ) {
        rows.push(splitTableRow(lines[index]!).map(parseInline));
        index += 1;
      }
      blocks.push({
        type: 'table',
        alignments,
        header: headerCells.map(parseInline),
        rows,
      });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      !BLANK.test(lines[index]!) &&
      !isBlockStart(lines[index]!)
    ) {
      paragraph.push(lines[index]!);
      index += 1;
    }
    blocks.push({
      type: 'paragraph',
      children: parseInline(paragraph.join('\n').trim()),
    });
  }

  return blocks;
}

export function parseMarkdown(source: string): Root {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return { type: 'root', children: parseBlocks(lines) };
}
