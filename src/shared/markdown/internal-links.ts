import type { InlineNode } from './ast';
import { parseInline } from './inline';

export type InternalLinkSyntax = 'markdown' | 'wikilink';

export interface InternalLinkOccurrence {
  column: number;
  destination: string;
  destinationEnd: number;
  destinationStart: number;
  end: number;
  headingPath: readonly string[];
  label: string | null;
  line: number;
  path: string;
  start: number;
  syntax: InternalLinkSyntax;
}

export interface MarkdownHeadingOccurrence {
  depth: number;
  line: number;
  offset: number;
  path: readonly string[];
  text: string;
}

export interface InternalLinkDestination {
  headingPath: readonly string[];
  path: string;
}

interface Fence {
  length: number;
  marker: '`' | '~';
}

const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function decodeLinkPart(value: string): string | null {
  try {
    return decodeURIComponent(value).normalize('NFC');
  } catch {
    return null;
  }
}

function destinationParts(
  destination: string,
  _syntax: InternalLinkSyntax,
): InternalLinkDestination | null {
  const normalized = destination.trim();
  if (!normalized || normalized.includes('\0') || URI_SCHEME.test(normalized)) {
    return null;
  }

  const hash = normalized.indexOf('#');
  const rawPath = hash === -1 ? normalized : normalized.slice(0, hash);
  const rawHeading = hash === -1 ? '' : normalized.slice(hash + 1);
  const decodedPath = decodeLinkPart(rawPath);
  if (decodedPath === null) {
    return null;
  }

  const rawHeadingParts = rawHeading ? rawHeading.split('#') : [];
  const headingPath: string[] = [];
  for (const rawPart of rawHeadingParts) {
    const decoded = decodeLinkPart(rawPart);
    if (decoded === null) {
      return null;
    }
    const part = decoded.trim();
    if (part) {
      headingPath.push(part);
    }
  }

  const path = decodedPath.trim().replaceAll('\\', '/');
  if (!path && headingPath.length === 0) {
    return null;
  }

  return { headingPath, path };
}

export function parseInternalLinkDestination(
  destination: string,
  syntax: InternalLinkSyntax,
): InternalLinkDestination | null {
  return destinationParts(destination, syntax);
}

function closingBracket(
  value: string,
  from: number,
  close: string,
): number {
  for (let index = from; index < value.length; index += 1) {
    if (value[index] === '\\') {
      index += 1;
      continue;
    }
    if (value.startsWith(close, index)) {
      return index;
    }
  }
  return -1;
}

function markdownDestination(
  line: string,
  from: number,
): { end: number; resume: number; start: number } | null {
  let index = from;
  while (line[index] === ' ' || line[index] === '\t') {
    index += 1;
  }
  if (line[index] === '<') {
    const close = closingBracket(line, index + 1, '>');
    return close === -1 || close === index + 1
      ? null
      : { start: index + 1, end: close, resume: close + 1 };
  }

  const start = index;
  let depth = 0;
  while (index < line.length) {
    const char = line[index]!;
    if (char === '\\') {
      index += 2;
      continue;
    }
    if ((char === ' ' || char === '\t') && depth === 0) {
      break;
    }
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    }
    index += 1;
  }

  return index === start ? null : { end: index, resume: index, start };
}

function markdownLinkAt(
  line: string,
  lineOffset: number,
  lineNumber: number,
  start: number,
): InternalLinkOccurrence | null {
  if (start > 0 && line[start - 1] === '!') {
    return null;
  }
  const labelEnd = closingBracket(line, start + 1, ']');
  if (labelEnd === -1 || line[labelEnd + 1] !== '(') {
    return null;
  }

  const destination = markdownDestination(line, labelEnd + 2);
  if (!destination) {
    return null;
  }

  let close = destination.resume;
  let quoted: string | undefined;
  while (line[close] === ' ' || line[close] === '\t') {
    close += 1;
  }
  if (line[close] === '"' || line[close] === "'") {
    quoted = line[close];
    const titleEnd = closingBracket(line, close + 1, quoted!);
    if (titleEnd === -1) {
      return null;
    }
    close = titleEnd + 1;
    while (line[close] === ' ' || line[close] === '\t') {
      close += 1;
    }
  }
  if (line[close] !== ')') {
    return null;
  }

  const raw = line.slice(destination.start, destination.end);
  const parts = destinationParts(raw, 'markdown');
  if (!parts) {
    return null;
  }

  return {
    column: start + 1,
    destination: raw,
    destinationEnd: lineOffset + destination.end,
    destinationStart: lineOffset + destination.start,
    end: lineOffset + close + 1,
    headingPath: parts.headingPath,
    label: line.slice(start + 1, labelEnd),
    line: lineNumber,
    path: parts.path,
    start: lineOffset + start,
    syntax: 'markdown',
  };
}

function wikiLinkAt(
  line: string,
  lineOffset: number,
  lineNumber: number,
  start: number,
): InternalLinkOccurrence | null {
  if (start > 0 && line[start - 1] === '!') {
    return null;
  }
  const close = closingBracket(line, start + 2, ']]');
  if (close === -1) {
    return null;
  }

  const inside = line.slice(start + 2, close);
  const aliasAt = closingBracket(inside, 0, '|');
  const rawDestination = (aliasAt === -1 ? inside : inside.slice(0, aliasAt));
  const leading = rawDestination.length - rawDestination.trimStart().length;
  const trimmed = rawDestination.trim();
  const parts = destinationParts(trimmed, 'wikilink');
  if (!parts) {
    return null;
  }

  const destinationStart = lineOffset + start + 2 + leading;
  return {
    column: start + 1,
    destination: trimmed,
    destinationEnd: destinationStart + trimmed.length,
    destinationStart,
    end: lineOffset + close + 2,
    headingPath: parts.headingPath,
    label:
      aliasAt === -1 ? null : inside.slice(aliasAt + 1).trim() || null,
    line: lineNumber,
    path: parts.path,
    start: lineOffset + start,
    syntax: 'wikilink',
  };
}

function openingFence(line: string): Fence | null {
  const match = /^\s*(`{3,}|~{3,})/.exec(line);
  const marker = match?.[1]?.[0];
  return marker === '`' || marker === '~'
    ? { marker, length: match![1]!.length }
    : null;
}

function closesFence(line: string, fence: Fence): boolean {
  const trimmed = line.trimStart();
  let length = 0;
  while (trimmed[length] === fence.marker) {
    length += 1;
  }
  return length >= fence.length;
}

function scanInlineLinks(
  line: string,
  lineOffset: number,
  lineNumber: number,
  output: InternalLinkOccurrence[],
): void {
  let index = 0;
  while (index < line.length) {
    if (line[index] === '\\') {
      index += 2;
      continue;
    }
    if (line[index] === '`') {
      let run = 1;
      while (line[index + run] === '`') {
        run += 1;
      }
      const close = line.indexOf('`'.repeat(run), index + run);
      index = close === -1 ? line.length : close + run;
      continue;
    }

    const link = line.startsWith('[[', index)
      ? wikiLinkAt(line, lineOffset, lineNumber, index)
      : line[index] === '['
        ? markdownLinkAt(line, lineOffset, lineNumber, index)
        : null;
    if (link) {
      output.push(link);
      index = link.end - lineOffset;
      continue;
    }
    index += 1;
  }
}

function inlineText(nodes: readonly InlineNode[]): string {
  let value = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'inlineCode':
        value += node.value;
        break;
      case 'break':
        value += ' ';
        break;
      case 'strong':
      case 'emphasis':
      case 'delete':
      case 'highlight':
      case 'color':
        value += inlineText(node.children);
        break;
      case 'link':
        value += inlineText(node.children);
        break;
      case 'image':
        value += node.alt;
        break;
    }
  }
  return value;
}

function headingAt(
  line: string,
  lineOffset: number,
  lineNumber: number,
  hierarchy: string[],
): MarkdownHeadingOccurrence | null {
  const match = /^\s*(#{1,6})(?:--)?\s+(.+?)\s*$/.exec(line);
  if (!match) {
    return null;
  }
  const depth = match[1]!.length;
  const markdown = match[2]!.replace(/\s+#+\s*$/, '');
  const text = inlineText(parseInline(markdown)).trim();
  if (!text) {
    return null;
  }

  hierarchy.length = depth;
  hierarchy[depth - 1] = text;
  return {
    depth,
    line: lineNumber,
    offset: lineOffset + line.indexOf(match[1]!),
    path: hierarchy.filter(Boolean),
    text,
  };
}

export function extractMarkdownStructure(source: string): {
  headings: readonly MarkdownHeadingOccurrence[];
  links: readonly InternalLinkOccurrence[];
} {
  const headings: MarkdownHeadingOccurrence[] = [];
  const links: InternalLinkOccurrence[] = [];
  const hierarchy: string[] = [];
  const lines = source.split('\n');
  let fence: Fence | null = null;
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (fence) {
      if (closesFence(line, fence)) {
        fence = null;
      }
      offset += line.length + (index < lines.length - 1 ? 1 : 0);
      continue;
    }

    const nextFence = openingFence(line);
    if (nextFence) {
      fence = nextFence;
      offset += line.length + (index < lines.length - 1 ? 1 : 0);
      continue;
    }

    scanInlineLinks(line, offset, index + 1, links);
    const heading = headingAt(line, offset, index + 1, hierarchy);
    if (heading) {
      headings.push(heading);
    }
    offset += line.length + (index < lines.length - 1 ? 1 : 0);
  }

  return { headings, links };
}

export function extractInternalLinks(
  source: string,
): readonly InternalLinkOccurrence[] {
  return extractMarkdownStructure(source).links;
}

export function normalizeInternalLinkText(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase();
}

export function markdownHeadingSlug(value: string): string {
  return normalizeInternalLinkText(value)
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}
