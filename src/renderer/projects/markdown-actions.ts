export const MARKDOWN_ACTIONS = [
  'bold',
  'italic',
  'strike',
  'highlight',
  'code',
  'heading',
  'list',
  'task',
  'quote',
  'link',
  'divider',
] as const;

export type MarkdownAction = (typeof MARKDOWN_ACTIONS)[number];

export interface MarkdownEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export type MarkdownInlineColorKind = 'text' | 'highlight';

const WRAPPERS: Partial<Record<MarkdownAction, string>> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  highlight: '==',
  code: '`',
};

const LINE_PREFIXES: Partial<Record<MarkdownAction, string>> = {
  heading: '# ',
  list: '- ',
  task: '- [ ] ',
  quote: '> ',
};

function applyWrapper(
  value: string,
  start: number,
  end: number,
  marker: string,
): MarkdownEdit {
  const before = value.slice(0, start);
  const selected = value.slice(start, end);
  const after = value.slice(end);

  if (before.endsWith(marker) && after.startsWith(marker)) {
    return {
      value:
        before.slice(0, -marker.length) + selected + after.slice(marker.length),
      selectionStart: start - marker.length,
      selectionEnd: end - marker.length,
    };
  }

  if (
    selected.length >= marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(marker.length, -marker.length);
    return {
      value: before + inner + after,
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }

  return {
    value: `${before}${marker}${selected}${marker}${after}`,
    selectionStart: start + marker.length,
    selectionEnd: end + marker.length,
  };
}

function applyLinePrefix(
  value: string,
  start: number,
  end: number,
  prefix: string,
): MarkdownEdit {
  const blockStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextBreak = value.indexOf('\n', end);
  const blockEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(blockStart, blockEnd).split('\n');
  const prefixed = lines.every((line) => line.startsWith(prefix));
  const next = lines
    .map((line) => (prefixed ? line.slice(prefix.length) : `${prefix}${line}`))
    .join('\n');

  return {
    value: value.slice(0, blockStart) + next + value.slice(blockEnd),
    selectionStart: blockStart,
    selectionEnd: blockStart + next.length,
  };
}

function applyLink(value: string, start: number, end: number): MarkdownEdit {
  const label = value.slice(start, end) || 'texto';
  const inserted = `[${label}](url)`;
  const urlStart = start + label.length + 3;

  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    selectionStart: urlStart,
    selectionEnd: urlStart + 3,
  };
}

function applyDivider(value: string, start: number, end: number): MarkdownEdit {
  const leading = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
  const trailing = value[end] === '\n' ? '' : '\n';
  const inserted = `${leading}---${trailing}`;

  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    selectionStart: start + inserted.length,
    selectionEnd: start + inserted.length,
  };
}

export function applyMarkdownAction(
  action: MarkdownAction,
  value: string,
  start: number,
  end: number,
): MarkdownEdit {
  const wrapper = WRAPPERS[action];
  if (wrapper) {
    return applyWrapper(value, start, end, wrapper);
  }

  const prefix = LINE_PREFIXES[action];
  if (prefix) {
    return applyLinePrefix(value, start, end, prefix);
  }

  return action === 'link'
    ? applyLink(value, start, end)
    : applyDivider(value, start, end);
}

export function applyMarkdownInlineColor(
  kind: MarkdownInlineColorKind,
  value: string,
  start: number,
  end: number,
  color: string,
): MarkdownEdit {
  const selected = value.slice(start, end) || 'texto';
  const prefix = kind === 'text' ? '[' : '==';
  const suffix = kind === 'text' ? `]{color=${color}}` : `=={color=${color}}`;
  const inserted = `${prefix}${selected}${suffix}`;
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + selected.length,
  };
}
