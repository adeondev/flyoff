import type { InlineNode } from './ast';
import { parseImageDirectiveAt } from './media';

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/;

interface Parsed {
  node: InlineNode;
  end: number;
}

function countRun(text: string, from: number, char: string): number {
  let count = 0;
  while (text[from + count] === char) {
    count += 1;
  }
  return count;
}

function findDelimiter(text: string, from: number, delimiter: string): number {
  let index = from;

  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }

    if (text.startsWith(delimiter, index)) {
      if (
        delimiter.length === 1 &&
        (text[index - 1] === delimiter || text[index + 1] === delimiter)
      ) {
        index += 1;
        continue;
      }

      return index;
    }

    index += 1;
  }

  return -1;
}

function findMatchingBracket(text: string, start: number): number {
  let depth = 0;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (char === '\\') {
      index += 1;
      continue;
    }

    if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function parseDestination(
  text: string,
  open: number,
): { url: string; title: string | null; end: number } | null {
  let index = open + 1;
  let url = '';

  if (text[index] === '<') {
    const close = text.indexOf('>', index);
    if (close === -1) {
      return null;
    }
    url = text.slice(index + 1, close);
    index = close + 1;
  } else {
    while (
      index < text.length &&
      !/\s/.test(text[index]!) &&
      text[index] !== ')'
    ) {
      url += text[index];
      index += 1;
    }
  }

  while (index < text.length && /\s/.test(text[index]!)) {
    index += 1;
  }

  let title: string | null = null;
  const quote = text[index];

  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, index + 1);
    if (close === -1) {
      return null;
    }
    title = text.slice(index + 1, close);
    index = close + 1;
  }

  while (index < text.length && /\s/.test(text[index]!)) {
    index += 1;
  }

  if (text[index] !== ')') {
    return null;
  }

  return { url, title, end: index + 1 };
}

function parseColorAttribute(
  text: string,
  open: number,
): { color: string; end: number } | null {
  const close = text.indexOf('}', open);
  if (close === -1) {
    return null;
  }

  const match = /^color\s*=\s*(.+)$/.exec(text.slice(open + 1, close).trim());
  if (!match) {
    return null;
  }

  const color = match[1]!.trim().replace(/^["']|["']$/g, '');
  if (!SAFE_COLOR.test(color)) {
    return null;
  }

  return { color, end: close + 1 };
}

function parseBracket(
  text: string,
  start: number,
  isImage: boolean,
): Parsed | null {
  const labelEnd = findMatchingBracket(text, start);
  if (labelEnd === -1) {
    return null;
  }

  const label = text.slice(start + 1, labelEnd);
  const next = text[labelEnd + 1];

  if (next === '(') {
    const destination = parseDestination(text, labelEnd + 1);
    if (!destination) {
      return null;
    }

    if (isImage) {
      return {
        node: {
          type: 'image',
          url: destination.url,
          alt: label,
          title: destination.title,
        },
        end: destination.end,
      };
    }

    const attribute =
      text[destination.end] === '{'
        ? parseColorAttribute(text, destination.end)
        : null;
    return {
      node: {
        type: 'link',
        url: destination.url,
        title: destination.title,
        ...(attribute ? { color: attribute.color } : {}),
        children: parseInline(label),
      },
      end: attribute?.end ?? destination.end,
    };
  }

  if (!isImage && next === '{') {
    const attribute = parseColorAttribute(text, labelEnd + 1);
    if (attribute) {
      return {
        node: {
          type: 'color',
          color: attribute.color,
          children: parseInline(label),
        },
        end: attribute.end,
      };
    }
  }

  return null;
}

function parseWikiLink(text: string, start: number): Parsed | null {
  if (start > 0 && text[start - 1] === '!') {
    return null;
  }
  const close = text.indexOf(']]', start + 2);
  if (close === -1) {
    return null;
  }

  const inside = text.slice(start + 2, close);
  const aliasAt = inside.indexOf('|');
  const destination = (aliasAt === -1 ? inside : inside.slice(0, aliasAt)).trim();
  if (!destination) {
    return null;
  }
  const label =
    aliasAt === -1
      ? destination
      : inside.slice(aliasAt + 1).trim() || destination;
  const attribute =
    text[close + 2] === '{' ? parseColorAttribute(text, close + 2) : null;

  return {
    node: {
      type: 'link',
      url: destination,
      title: null,
      ...(attribute ? { color: attribute.color } : {}),
      syntax: 'wikilink',
      children: parseInline(label),
    },
    end: attribute?.end ?? close + 2,
  };
}

const PAIR_DELIMITERS = [
  { delimiter: '**', type: 'strong' },
  { delimiter: '__', type: 'strong' },
  { delimiter: '~~', type: 'delete' },
  { delimiter: '==', type: 'highlight' },
] as const;

function parseEmphasis(text: string, start: number): Parsed | null {
  for (const { delimiter, type } of PAIR_DELIMITERS) {
    if (text.startsWith(delimiter, start)) {
      const close = findDelimiter(text, start + 2, delimiter);
      if (close > start + 1) {
        const attribute =
          type === 'highlight' && text[close + delimiter.length] === '{'
            ? parseColorAttribute(text, close + delimiter.length)
            : null;
        return {
          node:
            type === 'highlight' && attribute
              ? {
                  type,
                  color: attribute.color,
                  children: parseInline(text.slice(start + 2, close)),
                }
              : { type, children: parseInline(text.slice(start + 2, close)) },
          end: attribute?.end ?? close + delimiter.length,
        };
      }
    }
  }

  const char = text[start];
  if (char === '*' || char === '_') {
    const close = findDelimiter(text, start + 1, char);
    if (close > start) {
      return {
        node: {
          type: 'emphasis',
          children: parseInline(text.slice(start + 1, close)),
        },
        end: close + 1,
      };
    }
  }

  return null;
}

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = '';
  let index = 0;

  const flush = (): void => {
    if (buffer) {
      nodes.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };

  while (index < text.length) {
    const char = text[index]!;

    if (char === '\\') {
      const next = text[index + 1];
      if (next === '\n') {
        flush();
        nodes.push({ type: 'break' });
        index += 2;
        continue;
      }
      if (next && PUNCTUATION.test(next)) {
        buffer += next;
        index += 2;
        continue;
      }
    }

    if (char === '\n') {
      buffer = buffer.replace(/ +$/, '');
      flush();
      nodes.push({ type: 'break' });
      index += 1;
      while (text[index] === ' ') {
        index += 1;
      }
      continue;
    }

    if (char === '`') {
      const run = countRun(text, index, '`');
      const fence = '`'.repeat(run);
      const close = text.indexOf(fence, index + run);
      if (close !== -1) {
        flush();
        let value = text.slice(index + run, close);
        if (
          value.length > 2 &&
          value.startsWith(' ') &&
          value.endsWith(' ') &&
          value.trim() !== ''
        ) {
          value = value.slice(1, -1);
        }
        nodes.push({ type: 'inlineCode', value });
        index = close + run;
        continue;
      }
    }

    if (char === ':' && text.startsWith('::image[', index)) {
      const parsed = parseImageDirectiveAt(text, index);
      if (parsed?.directive.mode === 'inline') {
        flush();
        nodes.push({ type: 'inline-image', directive: parsed.directive });
        index = parsed.end;
        continue;
      }
    }

    if (char === '!' && text[index + 1] === '[') {
      const parsed = parseBracket(text, index + 1, true);
      if (parsed) {
        flush();
        nodes.push(parsed.node);
        index = parsed.end;
        continue;
      }
    }

    if (
      char === '[' &&
      text[index + 1] === '[' &&
      text[index - 1] !== '!'
    ) {
      const parsed = parseWikiLink(text, index);
      if (parsed) {
        flush();
        nodes.push(parsed.node);
        index = parsed.end;
        continue;
      }
    }

    if (char === '[') {
      const parsed = parseBracket(text, index, false);
      if (parsed) {
        flush();
        nodes.push(parsed.node);
        index = parsed.end;
        continue;
      }
    }

    const emphasis = parseEmphasis(text, index);
    if (emphasis) {
      flush();
      nodes.push(emphasis.node);
      index = emphasis.end;
      continue;
    }

    buffer += char;
    index += 1;
  }

  flush();
  return nodes;
}
