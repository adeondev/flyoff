import {
  twemojiAssetUrl,
  twemojiSegments,
} from '../components/twemoji';

const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function escapePlainHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => ESCAPE[char]!);
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

const PAIRS: readonly { delimiter: string; className: string }[] = [
  { delimiter: '**', className: 'md-tok-strong' },
  { delimiter: '__', className: 'md-tok-strong' },
  { delimiter: '~~', className: 'md-tok-strike' },
  { delimiter: '==', className: 'md-tok-highlight' },
];

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

function highlightInline(text: string): string {
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

    if (
      char === '[' &&
      text[index + 1] === '[' &&
      text[index - 1] !== '!'
    ) {
      const tail = text.indexOf(']]', index + 2);
      if (tail !== -1) {
        flush();
        const inside = text.slice(index + 2, tail);
        const aliasAt = inside.indexOf('|');
        const destination =
          aliasAt === -1 ? inside : inside.slice(0, aliasAt);
        const alias = aliasAt === -1 ? '' : inside.slice(aliasAt);
        out += span(
          'md-source-link',
          mark('[[') +
            span('md-tok-link', escapeHtml(destination)) +
            (alias ? span('md-tok-attr', escapeHtml(alias)) : '') +
            mark(']]'),
        );
        index = tail + 2;
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
          out += span(
            'md-source-link',
            (char === '!' ? mark('!') : '') +
              mark('[') +
              span('md-tok-link', highlightInline(label)) +
              mark(']') +
              span('md-tok-attr', escapeHtml(attr)),
          );
          index = tail + 1;
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
          out += span(
            className,
            mark(delimiter) +
              highlightInline(text.slice(index + delimiter.length, close)) +
              mark(delimiter),
          );
          index = close + delimiter.length;
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
            highlightInline(text.slice(index + 1, close)) +
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
  const dividedHeading = /^(\s*(#{1,6})--\s+)(.*)$/.exec(line);
  if (dividedHeading) {
    return (
      mark(dividedHeading[1]!) +
      span(
        `md-tok-heading md-tok-heading--divided md-tok-h${dividedHeading[2]!.length}`,
        highlightInline(dividedHeading[3]!),
      )
    );
  }

  const heading = /^(\s*(#{1,6})\s+)(.*)$/.exec(line);
  if (heading) {
    return (
      mark(heading[1]!) +
      span(
        `md-tok-heading md-tok-h${heading[2]!.length}`,
        highlightInline(heading[3]!),
      )
    );
  }

  const blockquote = /^(\s*>\s?)(.*)$/.exec(line);
  if (blockquote) {
    return mark(blockquote[1]!) + highlightInline(blockquote[2]!);
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
      highlightInline(list[5]!)
    );
  }

  if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
    return span('md-tok-rule', escapeHtml(line));
  }

  return highlightInline(line);
}

const FENCE_LINE = /^\s*(```+|~~~+)/;
const CACHE_LIMIT = 4000;
const lineCache = new Map<string, string>();

export interface HighlightedSourceLine {
  code: boolean;
  codeEnd: boolean;
  codeStart: boolean;
  fenceAfter: boolean;
  fenceBefore: boolean;
  fenceLine: boolean;
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

  return classes.join(' ');
}

function highlightCachedLine(key: string, compute: () => string): string {
  const cached = lineCache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const html = compute();

  if (lineCache.size >= CACHE_LIMIT) {
    lineCache.clear();
  }

  lineCache.set(key, html);
  return html;
}

export function highlightSourceLine(
  source: string,
  fenceBefore: boolean,
): HighlightedSourceLine {
  const isFence = FENCE_LINE.test(source);
  const state = isFence ? (fenceBefore ? 'fc' : 'fo') : fenceBefore ? 'c' : 'n';
  const key = `${state}\u0000${source}`;
  const html = highlightCachedLine(key, () =>
    isFence
      ? span('md-tok-fence', escapeHtml(source))
      : fenceBefore
        ? span('md-tok-code', escapeHtml(source))
        : highlightLine(source),
  );

  return {
    code: state !== 'n',
    codeEnd: isFence && fenceBefore,
    codeStart: isFence && !fenceBefore,
    fenceAfter: isFence ? !fenceBefore : fenceBefore,
    fenceBefore,
    fenceLine: isFence,
    html,
    key,
    source,
  };
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
