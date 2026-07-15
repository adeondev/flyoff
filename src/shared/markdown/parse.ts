import type { BlockNode, HeadingDepth, ListItem, Root } from './ast';
import { parseInline } from './inline';

const BLANK = /^[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const BLOCKQUOTE = /^ {0,3}>[ ]?(.*)$/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const TASK = /^\[([ xX])\][ \t]+(.*)$/;

function isBlockStart(line: string): boolean {
  return (
    FENCE.test(line) ||
    ATX.test(line) ||
    THEMATIC_BREAK.test(line) ||
    BLOCKQUOTE.test(line) ||
    LIST_ITEM.test(line)
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

    const atx = ATX.exec(line);
    if (atx) {
      blocks.push({
        type: 'heading',
        depth: atx[1]!.length as HeadingDepth,
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
