import {
  highlightSourceLines,
  type HighlightedSourceLine,
} from './markdown-highlight';

interface SourceRenderState {
  lines: readonly HighlightedSourceLine[];
}

const renderStates = new WeakMap<HTMLElement, SourceRenderState>();

function createLine(
  root: HTMLElement,
  line: HighlightedSourceLine,
  index: number,
): HTMLSpanElement {
  const element = root.ownerDocument.createElement('span');
  const content = root.ownerDocument.createElement('span');
  element.className = 'md-line';
  element.dataset.line = String(index + 1);
  content.className = 'md-line__content';
  content.innerHTML = line.html;
  element.appendChild(content);
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
        line.children.length === 1 &&
        line.firstElementChild?.classList.contains('md-line__content'),
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
  const next = highlightSourceLines(source);
  const current = renderStates.get(root)?.lines;

  if (!current || !hasCanonicalLines(root, current.length)) {
    replaceAll(root, next);
    renderStates.set(root, { lines: next });
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
    (root.children[index] as HTMLElement).dataset.line = String(index + 1);
  }

  renderStates.set(root, { lines: next });
}
