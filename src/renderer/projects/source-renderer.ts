import type { HighlightedSourceLine } from './markdown-highlight';
import {
  createSourceDocumentModel,
  sourceLineIndexAtOffset,
  updateSourceDocumentModel,
  type SourceChangeRange,
  type SourceDocumentModel,
} from './source-document-model';

interface SourceRenderState {
  activeLine: number;
  model: SourceDocumentModel;
}

const renderStates = new WeakMap<HTMLElement, SourceRenderState>();

function createLine(
  root: HTMLElement,
  line: HighlightedSourceLine,
  index: number,
): HTMLSpanElement {
  const element = root.ownerDocument.createElement('span');
  const gutter = root.ownerDocument.createElement('span');
  const content = root.ownerDocument.createElement('span');
  element.className = line.code ? 'md-line md-line--code' : 'md-line';
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
  } else {
    const placeholder = root.ownerDocument.createElement('br');
    placeholder.dataset.mdPlaceholder = '';
    content.appendChild(placeholder);
  }
  element.append(gutter, content);
  return element;
}

function hasCanonicalLines(
  root: HTMLElement,
  expectedLength: number,
): boolean {
  return (
    root.childElementCount === expectedLength &&
    Array.from(root.children).every(
      (line) =>
        line.classList.contains('md-line') &&
        line.children.length === 2 &&
        line.firstElementChild?.classList.contains('md-line__gutter') &&
        line.lastElementChild?.classList.contains('md-line__content'),
    )
  );
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
    root.children[currentState?.activeLine ?? -1]?.classList.add(
      'md-line--active',
    );
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

  for (let index = prefix; index < root.children.length; index += 1) {
    const line = root.children[index] as HTMLElement;
    line.dataset.line = String(index + 1);
    const gutter = line.querySelector<HTMLElement>(':scope > .md-line__gutter');
    if (gutter) {
      gutter.textContent = String(index + 1);
    }
  }

  if (!hasCanonicalLines(root, next.length)) {
    replaceAll(root, next);
  }

  const activeLine = currentState.activeLine;
  renderStates.set(root, { activeLine, model });
  if (activeLine >= 0) {
    root.children[activeLine]?.classList.add('md-line--active');
  }
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
  root.children[state.activeLine]?.classList.remove('md-line--active');
  root.children[lineIndex]?.classList.add('md-line--active');
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
