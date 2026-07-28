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

const AUTHORED_COLOR = /\{color\s*=\s*(["']?)(#[0-9a-fA-F]{3,8})\1\s*\}/g;

/**
 * Every distinct colour already written in the note, so the eyedropper can
 * land back on the exact value instead of an anti-aliased approximation.
 */
export function collectAuthoredColors(source: string): readonly string[] {
  const seen = new Set<string>();

  for (const match of source.matchAll(AUTHORED_COLOR)) {
    seen.add(match[2]!.toUpperCase());
  }

  return [...seen];
}

const COLOR_ATTRIBUTE = String.raw`\{color\s*=\s*[^}]*\}`;
const WHOLE_HIGHLIGHT = new RegExp(
  String.raw`^==([\s\S]*?)==(?:${COLOR_ATTRIBUTE})?$`,
);
const WHOLE_TEXT = new RegExp(
  String.raw`^\[([\s\S]*?)\](?:${COLOR_ATTRIBUTE})$`,
);
const TRAILING_HIGHLIGHT = new RegExp(
  String.raw`^==(?:${COLOR_ATTRIBUTE})?`,
);
const TRAILING_TEXT = new RegExp(String.raw`^\](?:${COLOR_ATTRIBUTE})`);

interface ColoredRun {
  end: number;
  kind: MarkdownInlineColorKind;
  start: number;
  text: string;
}

/**
 * The coloured or highlighted run the selection sits in, whether it was
 * selected whole or only by its inner text. Without this, recolouring wraps
 * the old markup in the new one and the note ends up with `====word====`.
 */
function existingColoredRun(
  value: string,
  start: number,
  end: number,
): ColoredRun | null {
  const selected = value.slice(start, end);

  const wholeHighlight = WHOLE_HIGHLIGHT.exec(selected);
  if (wholeHighlight) {
    return { start, end, kind: 'highlight', text: wholeHighlight[1]! };
  }
  const wholeText = WHOLE_TEXT.exec(selected);
  if (wholeText) {
    return { start, end, kind: 'text', text: wholeText[1]! };
  }

  if (start >= 2 && value.startsWith('==', start - 2)) {
    const trailing = TRAILING_HIGHLIGHT.exec(value.slice(end));
    if (trailing) {
      return {
        start: start - 2,
        end: end + trailing[0].length,
        kind: 'highlight',
        text: selected,
      };
    }
  }
  if (start >= 1 && value[start - 1] === '[') {
    const trailing = TRAILING_TEXT.exec(value.slice(end));
    if (trailing) {
      return {
        start: start - 1,
        end: end + trailing[0].length,
        kind: 'text',
        text: selected,
      };
    }
  }

  return null;
}

/** How the selection is already marked, so recolouring will not convert it. */
export function inlineColorKindAt(
  value: string,
  start: number,
  end: number,
): MarkdownInlineColorKind | null {
  return existingColoredRun(value, start, end)?.kind ?? null;
}

export function applyMarkdownInlineColor(
  kind: MarkdownInlineColorKind,
  value: string,
  start: number,
  end: number,
  color: string,
): MarkdownEdit {
  if (start === end) {
    return {
      value,
      selectionStart: start,
      selectionEnd: end,
    };
  }
  const run = existingColoredRun(value, start, end);
  const from = run?.start ?? start;
  const to = run?.end ?? end;
  const selected = run?.text || value.slice(start, end) || 'texto';
  const prefix = kind === 'text' ? '[' : '==';
  const suffix = kind === 'text' ? `]{color=${color}}` : `=={color=${color}}`;
  const inserted = `${prefix}${selected}${suffix}`;
  return {
    value: value.slice(0, from) + inserted + value.slice(to),
    selectionStart: from + prefix.length,
    selectionEnd: from + prefix.length + selected.length,
  };
}

export function removeMarkdownInlineColor(
  kind: MarkdownInlineColorKind,
  value: string,
  start: number,
  end: number,
): MarkdownEdit {
  const selected = value.slice(start, end);
  const unwrapped =
    kind === 'text'
      ? selected.replace(
          /\[([^\]\n]*)\]\{color\s*=\s*(["']?)#[0-9a-fA-F]{3,8}\2\s*\}/g,
          '$1',
        )
      : selected.replace(
          /==([^\n]*?)==(?:\{color\s*=\s*(["']?)#[0-9a-fA-F]{3,8}\2\s*\})?/g,
          '$1',
        );
  if (unwrapped !== selected) {
    return {
      value: value.slice(0, start) + unwrapped + value.slice(end),
      selectionStart: start,
      selectionEnd: start + unwrapped.length,
    };
  }

  const run = existingColoredRun(value, start, end);
  if (run?.kind === kind) {
    return {
      value: value.slice(0, run.start) + run.text + value.slice(run.end),
      selectionStart: run.start,
      selectionEnd: run.start + run.text.length,
    };
  }

  return {
    value,
    selectionStart: start,
    selectionEnd: end,
  };
}
