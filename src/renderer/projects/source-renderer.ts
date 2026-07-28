import {
  sourceLineClassName,
  type HighlightedSourceLine,
} from './markdown-highlight';
import {
  createSourceDocumentModel,
  sourceLineIndexAtOffset,
  updateSourceDocumentModel,
  type SourceChangeRange,
  type SourceDocumentModel,
} from './source-document-model';
import { markFloatContexts } from './floating-media';

interface SourceRenderState {
  activeLine: number;
  model: SourceDocumentModel;
}

const renderStates = new WeakMap<HTMLElement, SourceRenderState>();

function markFloatingMedia(root: HTMLElement): void {
  markFloatContexts(root, {
    clearSelector: '.md-line--heading',
    contextClassName: 'md-line--float-context',
    floatingSelector: '.md-source-image--wrap',
    ignoredClearSelector: '.md-source-image--inline',
    previousSiblingIgnoredClearSelector: '.md-source-image--wrap',
  });
}

function markActiveLine(root: HTMLElement, lineIndex: number): void {
  for (const active of root.querySelectorAll(':scope > .md-line--active')) {
    active.classList.remove('md-line--active');
  }
  if (lineIndex >= 0) {
    root.children[lineIndex]?.classList.add('md-line--active');
  }
}

function enableTwemojiFallback(root: ParentNode): void {
  for (const image of root.querySelectorAll<HTMLImageElement>(
    'img.twemoji__glyph',
  )) {
    const fallback = (): void => {
      const wrapper = image.closest('.twemoji');
      wrapper?.classList.add('twemoji--fallback');
      image.remove();
    };

    image.addEventListener('error', fallback, { once: true });
    if (image.complete && image.naturalWidth === 0) {
      fallback();
    }
  }
}

function applyCodeBlockWidths(
  root: HTMLElement,
  model: SourceDocumentModel,
  change: SourceChangeRange,
): void {
  let start = change.full ? 0 : Math.max(0, change.startLine - 1);
  while (
    start > 0 &&
    (model.lines[start]?.code || model.lines[start - 1]?.code)
  ) {
    start -= 1;
  }
  let end = change.full
    ? model.lines.length
    : Math.min(model.lines.length, change.endLine + 1);
  while (
    end < model.lines.length &&
    (model.lines[end]?.code || model.lines[end - 1]?.code)
  ) {
    end += 1;
  }

  for (let lineIndex = start; lineIndex < end; lineIndex += 1) {
    (root.children[lineIndex] as HTMLElement | undefined)?.style.removeProperty(
      '--md-code-inline-size',
    );
  }

  let index = start;
  while (index < end) {
    if (!model.lines[index]?.code) {
      index += 1;
      continue;
    }
    const start = index;
    let maximumLength = 0;
    while (index < model.lines.length && model.lines[index]?.code) {
      maximumLength = Math.max(
        maximumLength,
        model.lines[index]!.source.replaceAll('\t', '  ').length,
      );
      index += 1;
    }
    const inlineSize = `calc(${Math.max(1, maximumLength)}ch + 24px)`;
    for (let lineIndex = start; lineIndex < index; lineIndex += 1) {
      (root.children[lineIndex] as HTMLElement | undefined)?.style.setProperty(
        '--md-code-inline-size',
        inlineSize,
      );
    }
  }
}

function createLine(
  root: HTMLElement,
  line: HighlightedSourceLine,
  index: number,
): HTMLSpanElement {
  const element = root.ownerDocument.createElement('span');
  const gutter = root.ownerDocument.createElement('span');
  const content = root.ownerDocument.createElement('span');
  element.className = sourceLineClassName(line);
  element.dataset.line = String(index + 1);
  gutter.className = 'md-line__gutter';
  gutter.dataset.mdGutter = '';
  gutter.setAttribute('aria-hidden', 'true');
  gutter.setAttribute('contenteditable', 'false');
  gutter.textContent = String(index + 1);
  content.className = 'md-line__content';
  content.spellcheck =
    root.dataset.spellcheckEnabled === 'true' &&
    (!line.code || root.dataset.spellcheckCodeBlocks === 'true');
  if (line.html) {
    content.innerHTML = line.html;
    enableTwemojiFallback(content);
  } else {
    const placeholder = root.ownerDocument.createElement('br');
    placeholder.dataset.mdPlaceholder = '';
    content.appendChild(placeholder);
  }
  element.append(gutter, content);
  return element;
}

// Runs on every keystroke, so it walks the live collection instead of
// materialising an array of every row.
function hasCanonicalLines(root: HTMLElement, expectedLength: number): boolean {
  if (root.childElementCount !== expectedLength) {
    return false;
  }
  const rows = root.children;
  for (let index = 0; index < rows.length; index += 1) {
    const line = rows[index]!;
    if (
      !line.classList.contains('md-line') ||
      line.children.length !== 2 ||
      !line.firstElementChild?.classList.contains('md-line__gutter') ||
      !line.lastElementChild?.classList.contains('md-line__content')
    ) {
      return false;
    }
  }
  return true;
}

function replaceAll(
  root: HTMLElement,
  lines: readonly HighlightedSourceLine[],
): void {
  root.replaceChildren(
    ...lines.map((line, index) => createLine(root, line, index)),
  );
}

export function reconcileSource(root: HTMLElement, source: string): void {
  const currentState = renderStates.get(root);
  const model = currentState
    ? updateSourceDocumentModel(currentState.model, source)
    : createSourceDocumentModel(source);
  const next = model.lines;
  root.style.setProperty(
    '--md-line-number-digits',
    String(Math.max(3, String(next.length).length)),
  );
  const current = currentState?.model.lines;

  if (!current || !hasCanonicalLines(root, current.length)) {
    replaceAll(root, next);
    renderStates.set(root, {
      activeLine: currentState?.activeLine ?? -1,
      model:
        currentState && model === currentState.model
          ? createSourceDocumentModel(source)
          : model,
    });
    markActiveLine(root, currentState?.activeLine ?? -1);
    applyCodeBlockWidths(root, model, model.change);
    markFloatingMedia(root);
    return;
  }

  if (model === currentState.model) {
    return;
  }

  let prefix = 0;
  while (
    prefix < current.length &&
    prefix < next.length &&
    current[prefix]?.key === next[prefix]?.key
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < next.length - prefix &&
    current[current.length - suffix - 1]?.key ===
      next[next.length - suffix - 1]?.key
  ) {
    suffix += 1;
  }

  const oldEnd = current.length - suffix;
  const newEnd = next.length - suffix;
  const anchor = root.children[oldEnd] ?? null;

  for (let index = oldEnd - 1; index >= prefix; index -= 1) {
    root.children[index]?.remove();
  }

  const fragment = root.ownerDocument.createDocumentFragment();
  for (let index = prefix; index < newEnd; index += 1) {
    fragment.appendChild(createLine(root, next[index]!, index));
  }
  root.insertBefore(fragment, anchor);

  // Rows before newEnd were just built carrying their final numbers, and the
  // preserved suffix only shifts when the line count changes, so editing
  // within a single line renumbers nothing.
  if (current.length !== next.length) {
    for (let index = newEnd; index < root.children.length; index += 1) {
      const line = root.children[index] as HTMLElement;
      line.dataset.line = String(index + 1);
      const gutter = line.firstElementChild;
      if (gutter) {
        gutter.textContent = String(index + 1);
      }
    }
  }

  // Preserved rows were structurally validated before splicing and inserted
  // rows come from createLine, so only the splice arithmetic can still be
  // wrong — checking the count catches that without rescanning every row.
  if (root.childElementCount !== next.length) {
    replaceAll(root, next);
  }

  applyCodeBlockWidths(root, model, model.change);
  const activeLine = currentState.activeLine;
  renderStates.set(root, { activeLine, model });
  markActiveLine(root, activeLine);
  markFloatingMedia(root);
}

export function updateActiveSourceLine(
  root: HTMLElement,
  _source: string,
  offset: number,
): void {
  const state = renderStates.get(root);
  if (!state) {
    return;
  }
  const lineIndex = sourceLineIndexAtOffset(state.model, offset);
  if (state.activeLine === lineIndex) {
    return;
  }
  markActiveLine(root, lineIndex);
  state.activeLine = lineIndex;
}

export function getSourceDocumentModel(
  root: HTMLElement,
): SourceDocumentModel | undefined {
  return renderStates.get(root)?.model;
}

export function getSourceChangeRange(
  root: HTMLElement,
): SourceChangeRange | undefined {
  return renderStates.get(root)?.model.change;
}
