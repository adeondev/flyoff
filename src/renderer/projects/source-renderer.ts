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
import { getSourceViewAdapter } from './source-engine/source-view-adapter';

interface SourceRenderState {
  activeElement?: HTMLElement;
  activeLine: number;
  canonical: boolean;
  lines: HTMLElement[];
  model: SourceDocumentModel;
  observer: MutationObserver;
}

const renderStates = new WeakMap<HTMLElement, SourceRenderState>();
const markupSignatures = new WeakMap<HighlightedSourceLine, string>();
const SOURCE_OFFSET_ATTRIBUTES = [
  'data-image-source-end',
  'data-image-source-start',
  'data-md-color-end',
  'data-md-color-start',
] as const;
const SOURCE_OFFSET_SELECTOR = SOURCE_OFFSET_ATTRIBUTES
  .map((attribute) => `[${attribute}]`)
  .join(',');
const SAFE_TEXT_REPLACEMENT = /^[\p{L}\p{M}\p{N}]+$/u;

function createRenderState(
  root: HTMLElement,
  activeLine: number,
  lines: HTMLElement[],
  model: SourceDocumentModel,
): SourceRenderState {
  const state = {
    activeLine,
    canonical: true,
    lines,
    model,
  } as SourceRenderState;
  const MutationObserverConstructor =
    root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
  state.observer = new MutationObserverConstructor(() => {
    state.canonical = false;
  });
  state.observer.observe(root, { childList: true });
  return state;
}

function acceptManagedMutations(state: SourceRenderState): void {
  state.observer.takeRecords();
  state.canonical = true;
}

function markActiveLine(
  state: SourceRenderState,
  lineIndex: number,
): void {
  state.activeElement?.classList.remove('md-line--active');
  const next = lineIndex >= 0 ? state.lines[lineIndex] : undefined;
  next?.classList.add('md-line--active');
  state.activeElement = next;
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

function configureInlineColorTriggers(
  root: HTMLElement,
  content: ParentNode,
): void {
  const label = root.dataset.inlineColorLabel;
  const readOnly = root.dataset.readOnly === 'true';
  for (const trigger of content.querySelectorAll<HTMLButtonElement>(
    '.md-inline-color-trigger',
  )) {
    if (label) {
      trigger.setAttribute('aria-label', label);
      trigger.dataset.flyoffTooltip = label;
      trigger.dataset.flyoffTooltipPlacement = 'top';
    }
    trigger.ariaDisabled = String(readOnly);
  }
}

function configureSpellcheck(
  root: HTMLElement,
  content: HTMLElement,
  line: HighlightedSourceLine,
): void {
  content.spellcheck =
    root.dataset.spellcheckEnabled === 'true' &&
    (!line.code || root.dataset.spellcheckCodeBlocks === 'true');
}

function markupSignature(line: HighlightedSourceLine): string {
  const cached = markupSignatures.get(line);
  if (cached !== undefined) {
    return cached;
  }
  const signature = line.html
    .replace(/(^|>)[^<]*/gu, '$1')
    .replace(
      /(data-(?:image-source-(?:end|start)|md-color-(?:end|start))=")\d+(")/gu,
      '$1#$2',
    );
  markupSignatures.set(line, signature);
  return signature;
}

function updateCompatibleSourceLineText(
  root: HTMLElement,
  content: HTMLElement,
  previous: HighlightedSourceLine,
  next: HighlightedSourceLine,
): boolean {
  if (
    previous.source === next.source ||
    markupSignature(previous) !== markupSignature(next) ||
    content.querySelector(
      '.md-source-image, .md-spelling-error, .twemoji',
    )
  ) {
    return false;
  }

  let start = 0;
  const sharedLength = Math.min(previous.source.length, next.source.length);
  while (
    start < sharedLength &&
    previous.source.charCodeAt(start) === next.source.charCodeAt(start)
  ) {
    start += 1;
  }
  let previousEnd = previous.source.length;
  let nextEnd = next.source.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous.source.charCodeAt(previousEnd - 1) ===
      next.source.charCodeAt(nextEnd - 1)
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  const removed = previous.source.slice(start, previousEnd);
  const inserted = next.source.slice(start, nextEnd);
  if (
    !SAFE_TEXT_REPLACEMENT.test(removed) ||
    !SAFE_TEXT_REPLACEMENT.test(inserted)
  ) {
    return false;
  }

  const document = root.ownerDocument;
  const filter = document.defaultView?.NodeFilter ?? NodeFilter;
  const walker = document.createTreeWalker(
    content,
    filter.SHOW_TEXT,
    {
      acceptNode(node) {
        return node.parentElement?.closest('[data-md-decoration]')
          ? filter.FILTER_REJECT
          : filter.FILTER_ACCEPT;
      },
    },
  );
  let represented = 0;
  let target:
    | { end: number; node: Text; start: number }
    | undefined;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (
      !target &&
      start >= represented &&
      previousEnd <= represented + length
    ) {
      target = {
        end: previousEnd - represented,
        node: node as Text,
        start: start - represented,
      };
    }
    represented += length;
    node = walker.nextNode();
  }
  if (!target || represented !== previous.source.length) {
    return false;
  }

  const delta = inserted.length - removed.length;
  const offsetUpdates: Array<{
    attribute: (typeof SOURCE_OFFSET_ATTRIBUTES)[number];
    element: HTMLElement;
    value: number;
  }> = [];
  for (const element of content.querySelectorAll<HTMLElement>(
    SOURCE_OFFSET_SELECTOR,
  )) {
    for (const attribute of SOURCE_OFFSET_ATTRIBUTES) {
      const value = Number(element.getAttribute(attribute));
      if (!Number.isInteger(value)) {
        continue;
      }
      if (value > start && value < previousEnd) {
        return false;
      }
      offsetUpdates.push({
        attribute,
        element,
        value: value >= previousEnd ? value + delta : value,
      });
    }
  }

  target.node.replaceData(
    target.start,
    target.end - target.start,
    inserted,
  );
  for (const update of offsetUpdates) {
    update.element.setAttribute(update.attribute, String(update.value));
  }
  return true;
}

function applyCodeBlockWidths(
  lines: readonly HTMLElement[],
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

  let index = start;
  while (index < end) {
    if (!model.lines[index]?.code) {
      lines[index]?.style.removeProperty('--md-code-inline-size');
      index += 1;
      continue;
    }
    const blockStart = index;
    let maximumLength = 0;
    while (index < model.lines.length && model.lines[index]?.code) {
      maximumLength = Math.max(
        maximumLength,
        model.lines[index]!.source.replaceAll('\t', '  ').length,
      );
      index += 1;
    }
    const inlineSize = `calc(${Math.max(1, maximumLength)}ch + 24px)`;
    const preservedBefore =
      blockStart < change.startLine ? lines[blockStart] : undefined;
    const preservedAfter =
      index > change.endLine
        ? lines[Math.max(blockStart, change.endLine)]
        : undefined;
    const previousWidth = (
      preservedBefore ?? preservedAfter
    )?.style.getPropertyValue('--md-code-inline-size');
    if (previousWidth === inlineSize) {
      for (
        let lineIndex = Math.max(blockStart, change.startLine);
        lineIndex < Math.min(index, change.endLine);
        lineIndex += 1
      ) {
        lines[lineIndex]?.style.setProperty(
          '--md-code-inline-size',
          inlineSize,
        );
      }
      continue;
    }
    for (let lineIndex = blockStart; lineIndex < index; lineIndex += 1) {
      lines[lineIndex]?.style.setProperty(
        '--md-code-inline-size',
        inlineSize,
      );
    }
  }
}

export function createSourceLineElement(
  root: HTMLElement,
  line: HighlightedSourceLine,
  index: number,
): HTMLSpanElement {
  const element = root.ownerDocument.createElement('span');
  const gutter = root.ownerDocument.createElement('span');
  const content = root.ownerDocument.createElement('span');
  element.append(gutter, content);
  updateSourceLineElement(root, element, line, index);
  return element;
}

export function updateSourceLineElement(
  root: HTMLElement,
  element: HTMLElement,
  line: HighlightedSourceLine,
  index: number,
  previousLine?: HighlightedSourceLine,
): void {
  const gutter = element.children[0] as HTMLElement | undefined;
  const content = element.children[1] as HTMLElement | undefined;
  if (!gutter || !content || element.childElementCount !== 2) {
    const replacement = createSourceLineElement(root, line, index);
    element.replaceChildren(...replacement.childNodes);
    element.className = replacement.className;
    element.dataset.line = replacement.dataset.line;
    element.removeAttribute('style');
    return;
  }
  element.className = sourceLineClassName(line);
  element.dataset.line = String(index + 1);
  element.removeAttribute('style');
  gutter.className = 'md-line__gutter';
  gutter.dataset.mdGutter = '';
  gutter.setAttribute('aria-hidden', 'true');
  gutter.setAttribute('contenteditable', 'false');
  const lineNumber = String(index + 1);
  if (gutter.textContent !== lineNumber) {
    gutter.textContent = lineNumber;
  }
  content.className = 'md-line__content';
  configureSpellcheck(root, content, line);
  if (
    previousLine &&
    updateCompatibleSourceLineText(root, content, previousLine, line)
  ) {
    return;
  }
  if (line.html) {
    content.innerHTML = line.html;
    enableTwemojiFallback(content);
    if (line.html.includes('md-inline-color-trigger')) {
      configureInlineColorTriggers(root, content);
    }
  } else if (
    content.childNodes.length !== 1 ||
    !content.firstElementChild?.hasAttribute('data-md-placeholder')
  ) {
    const placeholder = root.ownerDocument.createElement('br');
    placeholder.dataset.mdPlaceholder = '';
    content.replaceChildren(placeholder);
  }
}

function hasCanonicalLines(
  root: HTMLElement,
  state: SourceRenderState,
): boolean {
  if (state.observer.takeRecords().length > 0) {
    state.canonical = false;
  }
  if (
    !state.canonical ||
    root.childNodes.length !== state.lines.length ||
    root.childElementCount !== state.lines.length
  ) {
    return false;
  }
  const first = state.lines[0];
  const last = state.lines.at(-1);
  return (
    (!first || root.firstElementChild === first) &&
    (!last || root.lastElementChild === last)
  );
}

function replaceAll(
  root: HTMLElement,
  lines: readonly HighlightedSourceLine[],
): HTMLElement[] {
  const elements = lines.map((line, index) =>
    createSourceLineElement(root, line, index),
  );
  root.replaceChildren(...elements);
  return elements;
}

export function reconcileSource(root: HTMLElement, source: string): void {
  const currentState = renderStates.get(root);
  if (
    currentState?.canonical &&
    currentState.model.source === source &&
    hasCanonicalLines(root, currentState)
  ) {
    return;
  }
  const model = currentState
    ? updateSourceDocumentModel(currentState.model, source)
    : createSourceDocumentModel(source);
  const next = model.lines;
  root.style.setProperty(
    '--md-line-number-digits',
    String(Math.max(3, String(next.length).length)),
  );
  const current = currentState?.model.lines;

  if (
    !current ||
    !currentState ||
    !hasCanonicalLines(root, currentState)
  ) {
    const lines = replaceAll(root, next);
    const nextModel =
      currentState && model === currentState.model
        ? createSourceDocumentModel(source)
        : model;
    const state = currentState
      ? Object.assign(currentState, { lines, model: nextModel })
      : createRenderState(root, -1, lines, nextModel);
    acceptManagedMutations(state);
    renderStates.set(root, state);
    markActiveLine(state, state.activeLine);
    applyCodeBlockWidths(lines, state.model, state.model.change);
    return;
  }

  if (model === currentState.model) {
    return;
  }

  const prefix = model.change.startLine;
  const oldEnd = model.change.previousEndLine;
  const newEnd = model.change.endLine;
  const anchor = currentState.lines[oldEnd] ?? null;

  for (let index = oldEnd - 1; index >= prefix; index -= 1) {
    currentState.lines[index]?.remove();
  }

  const fragment = root.ownerDocument.createDocumentFragment();
  const inserted: HTMLElement[] = [];
  for (let index = prefix; index < newEnd; index += 1) {
    const line = createSourceLineElement(root, next[index]!, index);
    inserted.push(line);
    fragment.appendChild(line);
  }
  root.insertBefore(fragment, anchor);
  currentState.lines.splice(
    prefix,
    oldEnd - prefix,
    ...inserted,
  );

  // Rows before newEnd were just built carrying their final numbers, and the
  // preserved suffix only shifts when the line count changes, so editing
  // within a single line renumbers nothing.
  if (current.length !== next.length) {
    for (let index = newEnd; index < currentState.lines.length; index += 1) {
      const line = currentState.lines[index]!;
      line.dataset.line = String(index + 1);
      const gutter = line.firstElementChild;
      if (gutter) {
        gutter.textContent = String(index + 1);
      }
    }
  }

  // Preserved rows were structurally validated before splicing and inserted
  // rows come from createSourceLineElement, so only the splice arithmetic can still be
  // wrong — checking the count catches that without rescanning every row.
  if (
    root.childElementCount !== next.length ||
    currentState.lines.length !== next.length
  ) {
    currentState.lines = replaceAll(root, next);
  }

  currentState.model = model;
  acceptManagedMutations(currentState);
  applyCodeBlockWidths(currentState.lines, model, model.change);
  markActiveLine(currentState, currentState.activeLine);
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
  markActiveLine(state, lineIndex);
}

export function getSourceDocumentModel(
  root: HTMLElement,
): SourceDocumentModel | undefined {
  const adapter = getSourceViewAdapter(root);
  if (adapter) {
    return adapter.getModel();
  }
  return renderStates.get(root)?.model;
}

export function getSourceChangeRange(
  root: HTMLElement,
): SourceChangeRange | undefined {
  const adapter = getSourceViewAdapter(root);
  if (adapter) {
    return adapter.getChangeRange?.() ?? adapter.getModel().change;
  }
  return renderStates.get(root)?.model.change;
}

export function getSourceLineElements(
  root: HTMLElement,
): readonly HTMLElement[] | undefined {
  const adapter = getSourceViewAdapter(root);
  if (adapter) {
    return adapter.getVisibleLineElements?.();
  }
  const state = renderStates.get(root);
  if (!state || !hasCanonicalLines(root, state)) {
    if (state) {
      state.canonical = false;
    }
    return undefined;
  }
  return state.lines;
}

export function disposeSourceRenderer(root: HTMLElement): void {
  renderStates.get(root)?.observer.disconnect();
  renderStates.delete(root);
}
