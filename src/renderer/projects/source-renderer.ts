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
  type SourceTextChange,
} from './source-document-model';

interface SourceRenderState {
  activeLine: number;
  lineElements: HTMLElement[];
  model: SourceDocumentModel;
}

const renderStates = new WeakMap<HTMLElement, SourceRenderState>();

function restoreActiveLine(root: HTMLElement, lineIndex: number): void {
  const line = renderStates.get(root)?.lineElements[lineIndex];
  if (lineIndex >= 0 && line) {
    line.classList.add('md-line--active');
  }
}

function moveActiveLine(
  root: HTMLElement,
  state: SourceRenderState,
  lineIndex: number,
): void {
  if (state.activeLine === lineIndex) {
    return;
  }
  if (state.activeLine >= 0) {
    state.lineElements[state.activeLine]?.classList.remove(
      'md-line--active',
    );
  }
  if (lineIndex >= 0) {
    state.lineElements[lineIndex]?.classList.add('md-line--active');
  }
  state.activeLine = lineIndex;
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
): HTMLElement[] {
  const spellcheckEnabled = root.dataset.spellcheckEnabled === 'true';
  const spellcheckCodeBlocks =
    root.dataset.spellcheckCodeBlocks === 'true';
  const markup = new Array<string>(lines.length);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    markup[index] =
      `<span class="${sourceLineClassName(line)}" data-line="${index + 1}">` +
      `<span aria-hidden="true" class="md-line__gutter" contenteditable="false" data-md-gutter>${index + 1}</span>` +
      `<span class="md-line__content" spellcheck="${spellcheckEnabled && (spellcheckCodeBlocks || !line.code)}">` +
      `${line.html || '<br data-md-placeholder>'}</span></span>`;
  }
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = markup.join('');
  const lineElements = Array.from(
    template.content.children,
  ) as HTMLElement[];
  root.replaceChildren(template.content);
  enableTwemojiFallback(root);
  return lineElements;
}

export function reconcileSource(
  root: HTMLElement,
  source: string,
  verifyStructure = false,
  change?: SourceTextChange,
): void {
  const currentState = renderStates.get(root);
  if (
    !verifyStructure &&
    currentState?.model.source === source
  ) {
    return;
  }
  const model = currentState
    ? updateSourceDocumentModel(currentState.model, source, change)
    : createSourceDocumentModel(source);
  const next = model.lines;
  root.style.setProperty(
    '--md-line-number-digits',
    String(Math.max(3, String(next.length).length)),
  );
  const current = currentState?.model.lines;

  if (
    !current ||
    root.childElementCount !== current.length ||
    (verifyStructure && !hasCanonicalLines(root, current.length))
  ) {
    const lineElements = replaceAll(root, next);
    renderStates.set(root, {
      activeLine: currentState?.activeLine ?? -1,
      lineElements,
      model:
        currentState && model === currentState.model
          ? createSourceDocumentModel(source)
          : model,
    });
    restoreActiveLine(root, currentState?.activeLine ?? -1);
    applyCodeBlockWidths(root, model, model.change);
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
  const lineElements = currentState.lineElements;
  const anchor = lineElements[oldEnd] ?? null;
  if (currentState.activeLine >= 0) {
    lineElements[currentState.activeLine]?.classList.remove(
      'md-line--active',
    );
  }

  for (let index = oldEnd - 1; index >= prefix; index -= 1) {
    lineElements[index]?.remove();
  }

  const fragment = root.ownerDocument.createDocumentFragment();
  const insertedLines: HTMLElement[] = [];
  for (let index = prefix; index < newEnd; index += 1) {
    const line = createLine(root, next[index]!, index);
    insertedLines.push(line);
    fragment.appendChild(line);
  }
  root.insertBefore(fragment, anchor);
  lineElements.splice(
    prefix,
    oldEnd - prefix,
    ...insertedLines,
  );

  if (current.length !== next.length) {
    for (let index = newEnd; index < lineElements.length; index += 1) {
      const line = lineElements[index]!;
      line.dataset.line = String(index + 1);
      const gutter = line.firstElementChild;
      if (gutter) {
        gutter.textContent = String(index + 1);
      }
    }
  }

  if (root.childElementCount !== next.length) {
    lineElements.splice(0, lineElements.length, ...replaceAll(root, next));
  }

  applyCodeBlockWidths(root, model, model.change);
  const activeLine = currentState.activeLine;
  renderStates.set(root, { activeLine, lineElements, model });
  restoreActiveLine(root, activeLine);
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
  moveActiveLine(root, state, lineIndex);
}

export function getSourceDocumentModel(
  root: HTMLElement,
): SourceDocumentModel | undefined {
  return renderStates.get(root)?.model;
}

export function getSourceLineElement(
  root: HTMLElement,
  index: number,
): HTMLElement | undefined {
  return renderStates.get(root)?.lineElements[index];
}

export function getSourceChangeRange(
  root: HTMLElement,
): SourceChangeRange | undefined {
  return renderStates.get(root)?.model.change;
}
