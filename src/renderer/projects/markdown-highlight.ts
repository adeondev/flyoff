const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => ESCAPE[char]!);
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
          out +=
            (char === '!' ? mark('!') : '') +
            mark('[') +
            span('md-tok-link', highlightInline(label)) +
            mark(']') +
            span('md-tok-attr', escapeHtml(attr));
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
  const heading = /^(\s*#{1,6}\s+)(.*)$/.exec(line);
  if (heading) {
    return (
      mark(heading[1]!) + span('md-tok-heading', highlightInline(heading[2]!))
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
      (list[4] ? span('md-tok-task', escapeHtml(list[4])) : '') +
      highlightInline(list[5]!)
    );
  }

  if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
    return span('md-tok-rule', escapeHtml(line));
  }

  return highlightInline(line);
}

export function highlightSource(source: string): string {
  const lines = source.split('\n');
  const output: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```+|~~~+)/.test(line)) {
      output.push(span('md-tok-fence', escapeHtml(line)));
      inFence = !inFence;
      continue;
    }

    output.push(inFence ? span('md-tok-code', escapeHtml(line)) : highlightLine(line));
  }

  return output.join('\n');
}
