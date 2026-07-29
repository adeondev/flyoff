import { twemojiAssetUrl, twemojiSegments } from '../components/twemoji';
import { colorContrastInk } from '../components/color';
import {
  parseImageDirective,
  parseImageDirectiveAt,
  parseMediaDirective,
  type ImageDirective,
  type MediaDirective,
} from '../../shared/markdown';

const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapePlainHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPE[char]!);
}

function escapeHtml(value: string): string {
  return twemojiSegments(value)
    .map((segment) => {
      if (!segment.codepoint || !segment.emoji) {
        return escapePlainHtml(segment.text);
      }
      const emoji = escapePlainHtml(segment.emoji);
      const assetUrl = twemojiAssetUrl(segment.codepoint);
      const fallbackClass = assetUrl ? '' : ' twemoji--fallback';
      const image = assetUrl
        ? `<img alt="" aria-hidden="true" class="twemoji__glyph" contenteditable="false" data-md-decoration decoding="async" draggable="false" loading="lazy" src="${assetUrl}">`
        : '';
      return `<span aria-label="${emoji}" class="twemoji twemoji--source${fallbackClass}" data-twemoji="${segment.codepoint}" role="img"><span aria-hidden="true" class="twemoji__unicode">${emoji}</span>${image}</span>`;
    })
    .join('');
}

function span(className: string, value: string): string {
  return `<span class="${className}">${value}</span>`;
}

function mark(value: string): string {
  return span('md-tok-mark', escapeHtml(value));
}

/** Tagged apart from plain attributes so it alone can be hidden on demand. */
function colorAttr(value: string): string {
  return span('md-tok-attr md-tok-color-attr', escapeHtml(value));
}

const PAIRS: readonly { delimiter: string; className: string }[] = [
  { delimiter: '**', className: 'md-tok-strong' },
  { delimiter: '__', className: 'md-tok-strong' },
  { delimiter: '~~', className: 'md-tok-strike' },
  { delimiter: '==', className: 'md-tok-highlight' },
];

interface SourceColorAttribute {
  color: string;
  colorEnd: number;
  colorStart: number;
  end: number;
}

function sourceImageHost(
  directive: ImageDirective,
  source: string,
  sourceStart: number,
  sourceEnd: number,
): string {
  const style = `--source-image-width:${directive.width}px;--source-image-height:${directive.height}px;--source-image-margin:${directive.margin}px`;
  return `<span class="md-source-image md-source-image--${directive.mode} md-source-image--${directive.align}" data-image-align="${directive.align}" data-image-asset="${directive.assetId}" data-image-height="${directive.height}" data-image-instance="${directive.instanceId}" data-image-margin="${directive.margin}" data-image-max="${directive.maxWidth}" data-image-min="${directive.minWidth}" data-image-mode="${directive.mode}" data-image-position-lock="${directive.positionLock}" data-image-ratio-lock="${directive.ratioLock}" data-image-source-end="${sourceEnd}" data-image-source-start="${sourceStart}" data-image-width="${directive.width}" style="${style};--source-image-ratio:${directive.width / directive.height}"><span aria-label="${escapePlainHtml(directive.alt)}" class="md-source-image__host" contenteditable="false" data-md-decoration role="img"><img alt="${escapePlainHtml(directive.alt)}" class="md-source-image__content" decoding="async" draggable="false" loading="lazy"></span><span aria-hidden="true" class="md-source-image__syntax">${escapeHtml(source)}</span></span>`;
}

function legacyImageSourceHost(
  directive: MediaDirective,
  source: string,
): string {
  const width = Math.max(96, Math.round((directive.span / 12) * 720));
  const height = Math.max(72, Math.round(width / directive.ratio));
  const mode = directive.placement.startsWith('wrap')
    ? 'wrap'
    : directive.placement;
  const align = directive.placement === 'wrap-right' ? 'right' : 'left';
  return `<span class="md-source-image md-source-image--legacy" data-image-align="${align}" data-image-asset="${directive.id}" data-image-height="${height}" data-image-instance="" data-image-margin="12" data-image-max="1200" data-image-min="96" data-image-mode="${mode}" data-image-position-lock="false" data-image-ratio-lock="${directive.lock}" data-image-width="${width}" style="--source-image-width:${width}px;--source-image-height:${height}px;--source-image-margin:12px;--source-image-ratio:${width / height}"><span aria-label="${escapePlainHtml(directive.description)}" class="md-source-image__host" contenteditable="false" data-md-decoration role="img"><img alt="${escapePlainHtml(directive.description)}" class="md-source-image__content" decoding="async" draggable="false" loading="lazy"></span><span class="md-source-image__syntax">${escapeHtml(source)}</span></span>`;
}

const SOURCE_COLOR_ATTRIBUTE =
  /^\{color\s*=\s*(["']?)(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\1\s*\}/;

function sourceColorAttribute(
  text: string,
  start: number,
): SourceColorAttribute | null {
  const match = SOURCE_COLOR_ATTRIBUTE.exec(text.slice(start));
  const color = match?.[2];
  if (!match || !color) {
    return null;
  }
  const localColorStart = match[0].indexOf(color);
  return {
    color,
    colorEnd: start + localColorStart + color.length,
    colorStart: start + localColorStart,
    end: start + match[0].length,
  };
}

function colorTrigger(
  kind: 'highlight' | 'text',
  start: number,
  end: number,
  color?: string,
): string {
  const style = color ? ` style="--md-inline-color:${color}"` : '';
  return `<button class="md-inline-color-trigger" contenteditable="false" data-md-color-end="${end}" data-md-color-kind="${kind}" data-md-color-start="${start}" data-md-color-value="${color ?? ''}" tabindex="-1" type="button"${style}></button>`;
}

function findClose(text: string, from: number, delimiter: string): number {
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

function findBracket(text: string, from: number, close: string): number {
  let index = from;

  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] === close) {
      return index;
    }
    index += 1;
  }

  return -1;
}

function highlightInline(text: string, baseOffset = 0): string {
  let out = '';
  let plain = '';
  let index = 0;

  const flush = (): void => {
    if (plain) {
      out += escapeHtml(plain);
      plain = '';
    }
  };

  while (index < text.length) {
    const char = text[index]!;

    if (char === '\\' && index + 1 < text.length) {
      plain += text.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (char === '`') {
      let run = 0;
      while (text[index + run] === '`') {
        run += 1;
      }
      const fence = '`'.repeat(run);
      const close = text.indexOf(fence, index + run);
      if (close !== -1) {
        flush();
        out += span('md-tok-code', escapeHtml(text.slice(index, close + run)));
        index = close + run;
        continue;
      }
    }

    if (char === ':' && text.startsWith('::image[', index)) {
      const parsed = parseImageDirectiveAt(text, index);
      if (parsed?.directive.mode === 'inline') {
        flush();
        out += sourceImageHost(
          parsed.directive,
          text.slice(parsed.start, parsed.end),
          baseOffset + parsed.start,
          baseOffset + parsed.end,
        );
        index = parsed.end;
        continue;
      }
    }

    if (char === '[' && text[index + 1] === '[' && text[index - 1] !== '!') {
      const tail = text.indexOf(']]', index + 2);
      if (tail !== -1) {
        flush();
        const colorAttribute = sourceColorAttribute(text, tail + 2);
        const end = colorAttribute?.end ?? tail + 2;
        const inside = text.slice(index + 2, tail);
        const aliasAt = inside.indexOf('|');
        const destination = aliasAt === -1 ? inside : inside.slice(0, aliasAt);
        const alias = aliasAt === -1 ? '' : inside.slice(aliasAt);
        out += span(
          'md-source-link',
          colorTrigger(
            'text',
            baseOffset + (colorAttribute?.colorStart ?? tail + 2),
            baseOffset + (colorAttribute?.colorEnd ?? tail + 2),
            colorAttribute?.color,
          ) +
            mark('[[') +
            span(
              colorAttribute
                ? 'md-tok-link md-source-colored-text'
                : 'md-tok-link',
              colorAttribute
                ? `<span style="color:${colorAttribute.color}">${escapeHtml(destination)}</span>`
                : escapeHtml(destination),
            ) +
            (alias ? span('md-tok-attr', escapeHtml(alias)) : '') +
            mark(']]') +
            (colorAttribute
              ? colorAttr(text.slice(tail + 2, colorAttribute.end))
              : ''),
        );
        index = end;
        continue;
      }
    }

    if (char === '[' || (char === '!' && text[index + 1] === '[')) {
      const bracketStart = char === '!' ? index + 1 : index;
      const labelEnd = findBracket(text, bracketStart + 1, ']');
      const opener = text[labelEnd + 1];
      if (labelEnd !== -1 && (opener === '(' || opener === '{')) {
        const closer = opener === '(' ? ')' : '}';
        const tail = findBracket(text, labelEnd + 2, closer);
        if (tail !== -1) {
          flush();
          const label = text.slice(bracketStart + 1, labelEnd);
          const attr = text.slice(labelEnd + 1, tail + 1);
          const colorAttribute = sourceColorAttribute(
            text,
            opener === '{' ? labelEnd + 1 : tail + 1,
          );
          const isLink = opener === '(' && char !== '!';
          const end = colorAttribute?.end ?? tail + 1;
          out += span(
            'md-source-link',
            (colorAttribute || isLink
              ? colorTrigger(
                  'text',
                  baseOffset + (colorAttribute?.colorStart ?? tail + 1),
                  baseOffset + (colorAttribute?.colorEnd ?? tail + 1),
                  colorAttribute?.color,
                )
              : '') +
              (char === '!' ? mark('!') : '') +
              mark('[') +
              span(
                colorAttribute
                  ? 'md-tok-link md-source-colored-text'
                  : 'md-tok-link',
                colorAttribute
                  ? `<span style="color:${colorAttribute.color}">${highlightInline(
                      label,
                      baseOffset + bracketStart + 1,
                    )}</span>`
                  : highlightInline(label, baseOffset + bracketStart + 1),
              ) +
              mark(']') +
              (opener === '{' && colorAttribute
                ? colorAttr(attr)
                : span('md-tok-attr', escapeHtml(attr))) +
              (opener === '(' && colorAttribute
                ? colorAttr(text.slice(tail + 1, colorAttribute.end))
                : ''),
          );
          index = end;
          continue;
        }
      }
    }

    let matchedPair = false;
    for (const { className, delimiter } of PAIRS) {
      if (text.startsWith(delimiter, index)) {
        const close = findClose(text, index + delimiter.length, delimiter);
        if (close > index + delimiter.length - 1) {
          flush();
          const colorAttribute =
            delimiter === '=='
              ? sourceColorAttribute(text, close + delimiter.length)
              : null;
          const end = colorAttribute?.end ?? close + delimiter.length;
          const trigger =
            delimiter === '=='
              ? colorTrigger(
                  'highlight',
                  baseOffset +
                    (colorAttribute?.colorStart ?? close + delimiter.length),
                  baseOffset +
                    (colorAttribute?.colorEnd ?? close + delimiter.length),
                  colorAttribute?.color,
                )
              : '';
          const content = highlightInline(
            text.slice(index + delimiter.length, close),
            baseOffset + index + delimiter.length,
          );
          const coloredContent = colorAttribute
            ? `<span class="md-source-colored-highlight" style="background:${colorAttribute.color};color:${colorContrastInk(
                colorAttribute.color,
              )}">${content}</span>`
            : content;
          out += span(
            className,
            trigger +
              mark(delimiter) +
              coloredContent +
              mark(delimiter) +
              (colorAttribute
                ? colorAttr(text.slice(close + delimiter.length, end))
                : ''),
          );
          index = end;
          matchedPair = true;
          break;
        }
      }
    }
    if (matchedPair) {
      continue;
    }

    if (char === '*' || char === '_') {
      const close = findClose(text, index + 1, char);
      if (close > index) {
        flush();
        out += span(
          'md-tok-em',
          mark(char) +
            highlightInline(
              text.slice(index + 1, close),
              baseOffset + index + 1,
            ) +
            mark(char),
        );
        index = close + 1;
        continue;
      }
    }

    plain += char;
    index += 1;
  }

  flush();
  return out;
}

function highlightLine(line: string): string {
  const image = parseImageDirective(line);
  if (image) {
    return sourceImageHost(image, line, 0, line.length);
  }
  const media = parseMediaDirective(line);
  if (media) {
    return legacyImageSourceHost(media, line);
  }
  const dividedHeading = /^(\s*(#{1,6})--\s+)(.*)$/.exec(line);
  if (dividedHeading) {
    return (
      mark(dividedHeading[1]!) +
      span(
        `md-tok-heading md-tok-heading--divided md-tok-h${dividedHeading[2]!.length}`,
        highlightInline(dividedHeading[3]!, dividedHeading[1]!.length),
      )
    );
  }

  const heading = /^(\s*(#{1,6})\s+)(.*)$/.exec(line);
  if (heading) {
    return (
      mark(heading[1]!) +
      span(
        `md-tok-heading md-tok-h${heading[2]!.length}`,
        highlightInline(heading[3]!, heading[1]!.length),
      )
    );
  }

  const blockquote = /^(\s*>\s?)(.*)$/.exec(line);
  if (blockquote) {
    return (
      mark(blockquote[1]!) +
      highlightInline(blockquote[2]!, blockquote[1]!.length)
    );
  }

  const list = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line);
  if (list) {
    return (
      escapeHtml(list[1]!) +
      span('md-tok-list', escapeHtml(list[2]!)) +
      escapeHtml(list[3]!) +
      (list[4]
        ? span(
            `md-tok-task md-tok-task--${
              /\[[xX]\]/.test(list[4]) ? 'checked' : 'unchecked'
            }`,
            '<span aria-hidden="true" class="md-tok-task__box" contenteditable="false"><span class="md-tok-task__check"></span></span>' +
              escapeHtml(list[4]),
          )
        : '') +
      highlightInline(
        list[5]!,
        list[1]!.length +
          list[2]!.length +
          list[3]!.length +
          (list[4]?.length ?? 0),
      )
    );
  }

  if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
    return span('md-tok-rule', escapeHtml(line));
  }

  return highlightInline(line);
}

const FENCE_LINE = /^\s*(```+|~~~+)/;
const HEADING_LINE = /^\s*#{1,6}(?:--)?\s+/;
const CACHE_LIMIT = 4000;
const CACHE_UNIT_LIMIT = 2 * 1024 * 1024;
const lineCache = new Map<string, { html: string; units: number }>();
let lineCacheUnits = 0;

function isSourceWhitespace(code: number): boolean {
  return (
    (code >= 0x0009 && code <= 0x000d) ||
    code === 0x0020 ||
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

function firstSourceMarker(source: string): number {
  let index = 0;
  while (
    index < source.length &&
    isSourceWhitespace(source.charCodeAt(index))
  ) {
    index += 1;
  }
  return source.charCodeAt(index);
}

export interface HighlightedSourceLine {
  code: boolean;
  codeEnd: boolean;
  codeStart: boolean;
  fenceAfter: boolean;
  fenceBefore: boolean;
  fenceLine: boolean;
  heading: boolean;
  html: string;
  key: string;
  source: string;
}

export function sourceLineClassName(line: HighlightedSourceLine): string {
  const classes = ['md-line'];

  if (line.code) {
    classes.push('md-line--code');
  }
  if (line.codeStart) {
    classes.push('md-line--code-start');
  }
  if (line.codeEnd) {
    classes.push('md-line--code-end');
  }
  if (line.fenceLine) {
    classes.push('md-line--code-fence');
  }
  if (line.heading) {
    classes.push('md-line--heading');
  }

  return classes.join(' ');
}

function highlightCachedLine(
  key: string,
  source: string,
  fenceBefore: boolean,
  fenceLine: boolean,
): string {
  const cached = lineCache.get(key);

  if (cached !== undefined) {
    lineCache.delete(key);
    lineCache.set(key, cached);
    return cached.html;
  }

  const html = fenceLine
    ? span('md-tok-fence', escapeHtml(source))
    : fenceBefore
      ? span('md-tok-code', escapeHtml(source))
      : highlightLine(source);
  const units = key.length + html.length;

  lineCache.set(key, { html, units });
  lineCacheUnits += units;
  while (
    lineCache.size > CACHE_LIMIT ||
    lineCacheUnits > CACHE_UNIT_LIMIT
  ) {
    const oldest = lineCache.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    lineCacheUnits -= lineCache.get(oldest)?.units ?? 0;
    lineCache.delete(oldest);
  }

  return html;
}

class HighlightedSourceLineRecord implements HighlightedSourceLine {
  readonly code: boolean;
  readonly codeEnd: boolean;
  readonly codeStart: boolean;
  readonly fenceAfter: boolean;
  readonly fenceLine: boolean;
  readonly heading: boolean;
  readonly key: string;

  constructor(
    readonly source: string,
    readonly fenceBefore: boolean,
  ) {
    const marker = firstSourceMarker(source);
    this.fenceLine =
      (marker === 0x0060 || marker === 0x007e) &&
      FENCE_LINE.test(source);
    this.code = this.fenceLine || fenceBefore;
    this.codeEnd = this.fenceLine && fenceBefore;
    this.codeStart = this.fenceLine && !fenceBefore;
    this.fenceAfter = this.fenceLine ? !fenceBefore : fenceBefore;
    this.heading =
      !this.code && marker === 0x0023 && HEADING_LINE.test(source);
    this.key = `${
      this.fenceLine ? (fenceBefore ? 'fc' : 'fo') : fenceBefore ? 'c' : 'n'
    }\u0000${source}`;
  }

  get html(): string {
    return highlightCachedLine(
      this.key,
      this.source,
      this.fenceBefore,
      this.fenceLine,
    );
  }
}

export function highlightSourceLine(
  source: string,
  fenceBefore: boolean,
): HighlightedSourceLine {
  return new HighlightedSourceLineRecord(source, fenceBefore);
}

export function highlightSourceLines(
  source: string,
): readonly HighlightedSourceLine[] {
  const output: HighlightedSourceLine[] = [];
  let inFence = false;

  for (const line of source.split('\n')) {
    const highlighted = highlightSourceLine(line, inFence);
    output.push(highlighted);
    inFence = highlighted.fenceAfter;
  }

  return output;
}

export function highlightSource(source: string): string {
  return highlightSourceLines(source)
    .map(
      (line, index) =>
        `<span class="${sourceLineClassName(line)}" data-line="${index + 1}"><span aria-hidden="true" class="md-line__gutter" contenteditable="false" data-md-gutter>${index + 1}</span><span class="md-line__content">${line.html || '<br data-md-placeholder>'}</span></span>`,
    )
    .join('');
}
