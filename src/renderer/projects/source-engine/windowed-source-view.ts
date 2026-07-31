import {
  imageDirectivesInSource,
  parseMediaDirective,
} from '../../../shared/markdown';
import {
  createSourceDocumentModel,
  sourceLineIndexAtOffset,
  sourceTextReader,
  updateSourceDocumentModel,
  type SourceDocumentUpdateHint,
  type SourceDocumentModel,
} from '../source-document-model';
import { sourceLineHasImageDirective } from '../markdown-highlight';
import {
  createSourceLineElement,
  updateSourceLineElement,
} from '../source-renderer';
import { releaseSourceSpellingHighlights } from '../source-spellcheck';
import type { SourceSelection } from '../source-caret';
import { SourceHeightMap } from './source-height-map';
import {
  registerSourceViewAdapter,
  type SourceViewAdapter,
} from './source-view-adapter';
import {
  applySourceInputMirrorEdit,
  createSourceInputMirror,
  sourceSelectionFromMirror,
  type SourceInputMirror,
  type SourceInputMirrorEdit,
} from './source-input-mirror';
import { sourceViewport, type SourceViewport } from './source-viewport';

interface RenderedSourceLine {
  element: HTMLElement;
  measuredHeight?: number;
  sourceLine: SourceDocumentModel['lines'][number];
}

interface WriteSelectionOptions {
  reveal?: boolean;
}

interface WindowedSourceViewOptions {
  ariaLabel: string;
  /**
   * Notified for every scroll of the editor, with whether the view produced it
   * itself while re-anchoring. Listening here rather than on the element keeps
   * the classification deterministic: a listener added elsewhere may run before
   * the view has had the chance to recognise its own write.
   */
  onScroll?: (scrollTop: number, selfInduced: boolean) => void;
  onScrollEnd?: (scrollTop: number, selfInduced: boolean) => void;
  readOnly: boolean;
  selection: SourceSelection;
  source: string;
}

const DEFAULT_LINE_HEIGHT = 24;
const MIN_OVERSCAN_LINES = 12;
const MAX_RENDERED_LINES = 300;
const SCROLL_MEASUREMENT_IDLE_MS = 80;
/**
 * How long after the last layout reset the resize anchor is kept.
 *
 * A pane animation produces one reset per frame, and re-deriving the anchor from
 * the scroll position each time compounds any rounding into a visible drift. The
 * anchor is taken once and held across the whole burst instead.
 */
const RESIZE_ANCHOR_RELEASE_MS = 200;
const DEFAULT_WRAP_CHAR_FACTOR = 0.54;
/** Ignore very short lines when learning: they bound the factor too loosely. */
const WRAP_CALIBRATION_MINIMUM_LENGTH = 24;

function normalizedSelection(
  selection: SourceSelection,
  sourceLength: number,
): SourceSelection {
  const start = Math.min(sourceLength, Math.max(0, selection.start));
  const end = Math.min(sourceLength, Math.max(start, selection.end));
  return {
    direction:
      start === end
        ? 'none'
        : selection.direction === 'backward'
          ? 'backward'
          : 'forward',
    end,
    start,
  };
}

function selectionFocus(selection: SourceSelection): number {
  return selection.direction === 'backward'
    ? selection.start
    : selection.end;
}

function sameSelection(
  left: SourceSelection,
  right: SourceSelection,
): boolean {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.direction === right.direction
  );
}

function representedLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return 0;
  }
  const element = node as Element;
  if (
    element.hasAttribute('data-md-decoration') ||
    element.hasAttribute('data-md-gutter')
  ) {
    return 0;
  }
  if (element.tagName === 'BR') {
    return element.hasAttribute('data-md-placeholder') ? 0 : 1;
  }
  let length = 0;
  for (const child of element.childNodes) {
    length += representedLength(child);
  }
  return length;
}

function positionInContent(
  content: Element,
  target: number,
): { node: Node; offset: number } {
  let remaining = Math.max(0, target);
  const document = content.ownerDocument;
  const filter = document.defaultView?.NodeFilter ?? NodeFilter;
  const walker = document.createTreeWalker(
    content,
    filter.SHOW_TEXT,
    {
      acceptNode(node) {
        const element = node.parentElement;
        return element?.closest('[data-md-decoration], [data-md-gutter]')
          ? filter.FILTER_REJECT
          : filter.FILTER_ACCEPT;
      },
    },
  );
  let node = walker.nextNode();
  let last: Node | undefined;
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      return { node, offset: remaining };
    }
    remaining -= length;
    last = node;
    node = walker.nextNode();
  }
  return last
    ? { node: last, offset: last.textContent?.length ?? 0 }
    : { node: content, offset: 0 };
}

function offsetInContent(
  content: Element,
  node: Node,
  offset: number,
): number | undefined {
  if (node !== content && !content.contains(node)) {
    return undefined;
  }
  const ignored =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element).closest('[data-md-decoration], [data-md-gutter]')
      : node.parentElement?.closest(
          '[data-md-decoration], [data-md-gutter]',
        );
  if (ignored) {
    return undefined;
  }

  let length = 0;
  let current = node;
  if (current.nodeType === Node.TEXT_NODE) {
    length = Math.min(
      Math.max(0, offset),
      current.textContent?.length ?? 0,
    );
  } else {
    const children = current.childNodes;
    const boundary = Math.min(Math.max(0, offset), children.length);
    for (let index = 0; index < boundary; index += 1) {
      length += representedLength(children[index]!);
    }
  }

  while (current !== content) {
    let sibling = current.previousSibling;
    while (sibling) {
      length += representedLength(sibling);
      sibling = sibling.previousSibling;
    }
    const parent = current.parentNode;
    if (!parent) {
      return undefined;
    }
    current = parent;
  }
  return length;
}

function caretPositionAtPoint(
  document: Document,
  x: number,
  y: number,
): { node: Node; offset: number } | undefined {
  const position = document.caretPositionFromPoint?.(x, y);
  if (position) {
    return { node: position.offsetNode, offset: position.offset };
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range
    ? { node: range.startContainer, offset: range.startOffset }
    : undefined;
}

function lineContent(line: HTMLElement): HTMLElement {
  return (
    line.querySelector<HTMLElement>(':scope > .md-line__content') ?? line
  );
}

function domRect(
  document: Document,
  x: number,
  y: number,
  width: number,
  height: number,
): DOMRect {
  const Rect = document.defaultView?.DOMRect ?? DOMRect;
  return new Rect(x, y, width, height);
}

export class WindowedSourceView implements SourceViewAdapter {
  readonly input: HTMLTextAreaElement;

  private readonly canvas: HTMLDivElement;
  private readonly caret: HTMLDivElement;
  private readonly linesLayer: HTMLDivElement;
  private readonly selectionLayer: HTMLDivElement;
  private readonly heightMap = new SourceHeightMap();
  private measuredHeights = new WeakMap<
    SourceDocumentModel['lines'][number],
    number
  >();
  private readonly rendered = new Map<number, RenderedSourceLine>();
  private readonly floatClearanceLines = new Set<number>();
  private floatAnchorLines = new Int32Array();
  private readonly unregisterAdapter: () => void;
  private readonly resizeObserver?: ResizeObserver;
  private readonly rowResizeObserver?: ResizeObserver;
  private readonly layoutObserver?: MutationObserver;
  private readonly handleCompositionEnd: () => void;
  private readonly handleCompositionStart: () => void;
  private readonly handleInputFocusChange: () => void;
  private readonly handleRootFocus: (event: FocusEvent) => void;
  private readonly handleScroll: () => void;
  private readonly handleScrollEnd: () => void;
  private readonly handleWindowResize: () => void;
  private activeLine = -1;
  private animationFrame?: number;
  private compositionTimer?: number;
  private layoutResetFrame?: number;
  private resizeAnchor?: { fraction: number; line: number };
  private resizeAnchorTimer?: number;
  private layoutResetDeferred = false;
  private pendingRevealOffset?: number;
  private programmaticScrollTop?: number;
  private scrollMeasurementTimer?: number;
  private composing = false;
  private disposed = false;
  private forceRender = true;
  private heightContentWidth = 80;
  /**
   * How wide an average character is, as a fraction of the font size, used to
   * predict how many rows a line wraps to.
   *
   * A fixed guess here is what made a layout reset shift the view: the reset
   * discards every measured height for estimates, and an estimate that
   * over-predicts wrapping inflates the whole document. On an 11.205 line note
   * the inflation was about 29%, moving the anchored line from 132 to 102.
   * Lines measured at a single row prove the factor is at most
   * `contentWidth / (length * fontSize)`, so the smallest such bound seen is a
   * sound ceiling to keep.
   */
  private wrapCharFactor = DEFAULT_WRAP_CHAR_FACTOR;
  private heightFontSize = DEFAULT_LINE_HEIGHT / 1.5;
  private heightWraps = true;
  private lineHeight = DEFAULT_LINE_HEIGHT;
  private layoutSignature = '';
  private measurementDirty = true;
  private inputMirror: SourceInputMirror;
  private model: SourceDocumentModel;
  private paddingTopValue = 0;
  private canvasHeightValue = -1;
  private selection: SourceSelection;
  private selectionDirty = true;
  private scrolling = false;
  /**
   * Whether the scroll event being dispatched right now came from the view's
   * own re-anchoring rather than from the reader. Listeners registered after
   * the view's read it to avoid persisting a position the reader never chose;
   * a pane animation writes one such position per frame.
   */
  private selfInducedScroll = false;
  private viewport: SourceViewport = {
    endLine: 0,
    startLine: 0,
    top: 0,
    totalHeight: 0,
  };

  constructor(
    private readonly root: HTMLDivElement,
    options: WindowedSourceViewOptions,
  ) {
    this.model = createSourceDocumentModel(options.source);
    this.selection = normalizedSelection(
      options.selection,
      options.source.length,
    );
    this.inputMirror = createSourceInputMirror(
      options.source,
      this.selection,
    );
    const document = root.ownerDocument;
    this.canvas = document.createElement('div');
    this.canvas.className = 'source-window__canvas';
    this.linesLayer = document.createElement('div');
    this.linesLayer.className = 'source-window__lines';
    this.linesLayer.setAttribute('aria-hidden', 'true');
    this.selectionLayer = document.createElement('div');
    this.selectionLayer.className = 'source-window__selections';
    this.selectionLayer.setAttribute('aria-hidden', 'true');
    this.caret = document.createElement('div');
    this.caret.className = 'source-window__caret';
    this.caret.setAttribute('aria-hidden', 'true');
    this.input = document.createElement('textarea');
    this.input.className = 'source-window__input';
    this.input.setAttribute('aria-label', options.ariaLabel);
    this.input.setAttribute('aria-multiline', 'true');
    this.input.autocapitalize = 'off';
    this.input.autocomplete = 'off';
    this.input.readOnly = options.readOnly;
    this.input.spellcheck = false;
    this.input.value = this.inputMirror.value;
    this.input.wrap = 'off';
    this.canvas.append(
      this.linesLayer,
      this.selectionLayer,
      this.caret,
      this.input,
    );
    root.replaceChildren(this.canvas);

    this.handleScroll = () => {
      const view = this.root.ownerDocument.defaultView;
      // A scroll this view caused itself must not count as the reader
      // scrolling. Treating it as such kept `scrolling` latched true for the
      // whole of a pane animation, which suppressed the measurement pass that
      // is supposed to reconcile the freshly re-wrapped lines.
      const selfInduced =
        this.programmaticScrollTop !== undefined &&
        Math.abs(this.root.scrollTop - this.programmaticScrollTop) <= 1;
      this.programmaticScrollTop = undefined;
      this.selfInducedScroll = selfInduced;
      this.measurementDirty = true;
      if (!selfInduced) {
        // The reader is in control now; stop holding a resize anchor against
        // them.
        this.releaseResizeAnchor();
        this.scrolling = true;
        if (this.scrollMeasurementTimer !== undefined) {
          view?.clearTimeout(this.scrollMeasurementTimer);
        }
        if (view) {
          this.scrollMeasurementTimer = view.setTimeout(() => {
            this.scrollMeasurementTimer = undefined;
            this.scrolling = false;
            this.requestRender();
          }, SCROLL_MEASUREMENT_IDLE_MS);
        }
      }
      this.requestRender();
      options.onScroll?.(this.root.scrollTop, selfInduced);
    };
    this.handleScrollEnd = () => {
      options.onScrollEnd?.(this.root.scrollTop, this.selfInducedScroll);
    };
    this.handleWindowResize = () => this.requestLayoutReset();
    this.handleInputFocusChange = () => {
      this.selectionDirty = true;
      this.requestRender();
    };
    this.handleCompositionStart = () => {
      const view = this.root.ownerDocument.defaultView;
      if (this.compositionTimer !== undefined) {
        view?.clearTimeout(this.compositionTimer);
        this.compositionTimer = undefined;
      }
      this.composing = true;
      this.selectionDirty = true;
      this.requestRender();
    };
    this.handleCompositionEnd = () => {
      const view = this.root.ownerDocument.defaultView;
      const finish = () => {
        this.compositionTimer = undefined;
        this.composing = false;
        this.selectionDirty = true;
        this.requestRender();
      };
      if (!view) {
        finish();
        return;
      }
      this.compositionTimer = view.setTimeout(finish, 0);
    };
    this.handleRootFocus = (event) => {
      if (event.target === this.root) {
        this.focus();
      }
    };
    this.input.addEventListener('focus', this.handleInputFocusChange);
    this.input.addEventListener('blur', this.handleInputFocusChange);
    this.input.addEventListener(
      'compositionstart',
      this.handleCompositionStart,
    );
    this.input.addEventListener('compositionend', this.handleCompositionEnd);
    root.addEventListener('scroll', this.handleScroll, { passive: true });
    root.addEventListener('scrollend', this.handleScrollEnd, {
      passive: true,
    });
    root.addEventListener('focus', this.handleRootFocus);
    root.ownerDocument.defaultView?.addEventListener(
      'resize',
      this.handleWindowResize,
    );

    const ResizeObserverConstructor =
      root.ownerDocument.defaultView?.ResizeObserver;
    if (ResizeObserverConstructor) {
      this.resizeObserver = new ResizeObserverConstructor(() =>
        this.requestLayoutReset(),
      );
      this.resizeObserver.observe(root);
      this.rowResizeObserver = new ResizeObserverConstructor(() => {
        this.measurementDirty = true;
        this.selectionDirty = true;
        this.requestRender();
      });
    }
    const MutationObserverConstructor =
      root.ownerDocument.defaultView?.MutationObserver;
    const editor = root.closest<HTMLElement>('.markdown-editor');
    if (MutationObserverConstructor && editor) {
      this.layoutObserver = new MutationObserverConstructor(() =>
        this.requestLayoutReset(),
      );
      this.layoutObserver.observe(editor, {
        attributeFilter: [
          'data-content-padding',
          'data-content-width',
          'data-line-numbers',
          'data-note-font',
          'data-source-style',
          'data-wrap',
          'style',
        ],
        attributes: true,
      });
      const workspace = root.closest<HTMLElement>('.workspace');
      if (workspace) {
        this.layoutObserver.observe(workspace, {
          attributeFilter: ['style'],
          attributes: true,
        });
      }
      this.layoutObserver.observe(document.documentElement, {
        attributeFilter: ['data-font-ligatures', 'data-interface-font', 'style'],
        attributes: true,
      });
    }

    const initialStyles = this.updateLineHeight();
    this.rebuildHeightMap(initialStyles);
    this.updateSourceMetrics();
    this.unregisterAdapter = registerSourceViewAdapter(root, this);
    this.render();
    this.layoutSignature = this.readLayoutSignature();
    this.syncInputMirror();
  }

  getModel(): SourceDocumentModel {
    return this.model;
  }

  getChangeRange() {
    return this.model.change;
  }

  /** True while handling a scroll event the view itself produced. */
  isSelfInducedScroll(): boolean {
    return this.selfInducedScroll;
  }

  getVisibleLineElements(): readonly HTMLElement[] {
    return Array.from(
      this.linesLayer.children,
      (element) => element as HTMLElement,
    );
  }

  readSelection(): SourceSelection {
    return this.selection;
  }

  writeSelection(
    selection: SourceSelection,
    options: WriteSelectionOptions = {},
  ): void {
    const next = normalizedSelection(selection, this.model.source.length);
    if (!sameSelection(this.selection, next)) {
      this.selectionDirty = true;
    }
    this.selection = next;
    this.syncInputMirror();
    this.updateActiveLine();
    if (options.reveal !== false) {
      this.revealOffset(selectionFocus(this.selection));
    }
    this.requestRender();
  }

  focus(): void {
    if (this.disposed) {
      return;
    }
    this.input.focus({ preventScroll: true });
    this.syncInputMirror();
    this.requestRender();
  }

  setAriaLabel(ariaLabel: string): void {
    this.input.setAttribute('aria-label', ariaLabel);
  }

  setReadOnly(readOnly: boolean): void {
    this.input.readOnly = readOnly;
  }

  cancelComposition(): void {
    const view = this.root.ownerDocument.defaultView;
    if (this.compositionTimer !== undefined) {
      view?.clearTimeout(this.compositionTimer);
      this.compositionTimer = undefined;
    }
    this.composing = false;
    this.selectionDirty = true;
    this.syncInputMirror();
    this.requestRender();
  }

  setSource(
    source: string,
    selection = this.selection,
    hint?: SourceDocumentUpdateHint,
  ): void {
    const previous = this.model;
    const previousSelection = this.selection;
    // Read scroll geometry before anything writes to the DOM. Once the input
    // mirror has been written, reading it back forces Blink to flush layout,
    // and that flush measured as the single largest cost of a keystroke.
    const scrollTop = Math.max(0, this.root.scrollTop - this.paddingTop());
    this.model = updateSourceDocumentModel(previous, source, hint);
    this.selection = normalizedSelection(selection, source.length);
    if (!sameSelection(previousSelection, this.selection)) {
      this.selectionDirty = true;
    }
    this.syncInputMirror();
    let effectiveScrollTop = scrollTop;
    if (this.model !== previous) {
      const incrementalLine = this.incrementalHeightLine(previous);
      if (incrementalLine === undefined) {
        this.rebuildHeightMap();
      } else {
        effectiveScrollTop = this.updateSingleLineHeight(
          incrementalLine,
          scrollTop,
        );
      }
      this.forceRender = true;
      this.measurementDirty = true;
      this.selectionDirty = true;
    }
    this.updateSourceMetrics();
    // While composing, the hidden input has to sit under the caret in the same
    // frame or the IME candidate window is placed against stale geometry.
    this.render(effectiveScrollTop, !this.composing);
  }

  syncSelectionFromInput(): SourceSelection {
    const start = this.input.selectionStart ?? 0;
    const end = this.input.selectionEnd ?? start;
    const direction = this.input.selectionDirection;
    const next = normalizedSelection(
      sourceSelectionFromMirror(
        this.inputMirror,
        start,
        end,
        start === end
          ? 'none'
          : direction === 'backward'
            ? 'backward'
            : 'forward',
      ),
      this.model.source.length,
    );
    // Scrolling the caret into view is an effect of the caret *moving*, never
    // of the caret being read. `selectionchange` also fires when focus simply
    // returns to the editor — opening a tab, closing a pane — and revealing
    // there dragged the reader back to wherever the caret happened to sit.
    const moved = !sameSelection(this.selection, next);
    if (moved) {
      this.selectionDirty = true;
    }
    this.selection = next;
    this.updateActiveLine();
    if (moved) {
      this.revealOffset(selectionFocus(this.selection));
    }
    this.requestRender();
    return this.selection;
  }

  captureInputMirror(): SourceInputMirror {
    return this.inputMirror;
  }

  readInputEdit(
    source: string,
    mirror: SourceInputMirror,
  ): SourceInputMirrorEdit {
    const start = this.input.selectionStart ?? 0;
    const end = this.input.selectionEnd ?? start;
    return applySourceInputMirrorEdit(
      source,
      mirror,
      this.input.value.replace(/\r\n?/g, '\n'),
      {
        direction:
          start === end
            ? 'none'
            : this.input.selectionDirection === 'backward'
              ? 'backward'
              : 'forward',
        end,
        start,
      },
      // Only when the text being edited is the one the model holds. A
      // controlled update can land between `beforeinput` and `input`, and the
      // caller then passes the content it captured earlier; reading a
      // different document through the model's lines would silently splice the
      // wrong text.
      source === this.model.source
        ? sourceTextReader(this.model)
        : undefined,
    );
  }

  sourceOffsetAtPoint(x: number, y: number): number | undefined {
    const document = this.root.ownerDocument;
    const target = document.elementFromPoint?.(x, y);
    let line =
      target instanceof Element
        ? target.closest<HTMLElement>('.md-line')
        : null;
    if (!line || !this.root.contains(line)) {
      line = this.nearestRenderedLine(y);
    }
    if (!line) {
      return undefined;
    }
    const lineIndex = Number(line.dataset.line) - 1;
    const sourceLine = this.model.lines[lineIndex];
    const lineStart = this.model.lineStarts[lineIndex];
    if (!sourceLine || lineStart === undefined) {
      return undefined;
    }
    const image =
      target instanceof Element
        ? target.closest<HTMLElement>('.md-source-image')
        : null;
    if (image && line.contains(image)) {
      const start = Number(image.dataset.imageSourceStart);
      const end = Number(image.dataset.imageSourceEnd);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const bounds = image.getBoundingClientRect();
        return (
          lineStart +
          (x < bounds.left + bounds.width / 2 ? start : end)
        );
      }
    }
    if (
      target instanceof Element &&
      target.closest('.md-line__gutter')
    ) {
      return lineStart;
    }
    const position = caretPositionAtPoint(document, x, y);
    const content = lineContent(line);
    const local =
      position &&
      (position.node === content || content.contains(position.node))
        ? offsetInContent(content, position.node, position.offset)
        : undefined;
    if (local !== undefined) {
      return lineStart + Math.min(sourceLine.source.length, local);
    }
    const bounds = content.getBoundingClientRect();
    return lineStart + (x <= bounds.left ? 0 : sourceLine.source.length);
  }

  sourceCaretRect(offset: number): DOMRect | undefined {
    const target = Math.min(
      this.model.source.length,
      Math.max(0, offset),
    );
    const lineIndex = sourceLineIndexAtOffset(this.model, target);
    const rendered = this.rendered.get(lineIndex)?.element;
    const sourceLine = this.model.lines[lineIndex];
    const lineStart = this.model.lineStarts[lineIndex];
    if (!rendered || !sourceLine || lineStart === undefined) {
      return undefined;
    }
    const local = Math.min(
      sourceLine.source.length,
      Math.max(0, target - lineStart),
    );
    for (const image of rendered.querySelectorAll<HTMLElement>(
      '.md-source-image',
    )) {
      const start = Number(image.dataset.imageSourceStart);
      const end = Number(image.dataset.imageSourceEnd);
      if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        local >= start &&
        local <= end
      ) {
        const bounds = image.getBoundingClientRect();
        const atEnd = local > (start + end) / 2;
        return domRect(
          this.root.ownerDocument,
          atEnd ? bounds.right : bounds.left,
          bounds.top,
          0,
          bounds.height,
        );
      }
    }
    const position = positionInContent(lineContent(rendered), local);
    const range = this.root.ownerDocument.createRange();
    try {
      range.setStart(position.node, position.offset);
      range.collapse(true);
      const rect =
        range.getClientRects?.()[0] ?? range.getBoundingClientRect?.();
      if (!rect) {
        return undefined;
      }
      if (rect.width || rect.height) {
        return rect;
      }
    } catch {
      return undefined;
    }
    const contentBounds = lineContent(rendered).getBoundingClientRect();
    return domRect(
      this.root.ownerDocument,
      local === 0 ? contentBounds.left : contentBounds.right,
      contentBounds.top,
      0,
      Math.max(this.lineHeight, contentBounds.height),
    );
  }

  /**
   * Reveal the caret in the next frame instead of now.
   *
   * Revealing reads the caret rectangle back out of the DOM, and on the
   * keystroke path that read lands right after the edit was written — a forced
   * layout in the middle of the input. Measured over 200 keys on a 20.000 line
   * note it was 9,7% of the time spent per key, with a p99 of 8,9 ms. The frame
   * still runs before paint, so the caret is on screen at the same time.
   */
  scheduleRevealOffset(offset: number): void {
    this.pendingRevealOffset = offset;
    this.requestRender();
  }

  revealOffset(offset: number): void {
    const lineIndex = sourceLineIndexAtOffset(this.model, offset);
    const top = this.heightMap.offsetAtIndex(lineIndex);
    const bottom = top + this.heightMap.heightAt(lineIndex);
    const paddingTop = this.paddingTop();
    const visibleTop = Math.max(0, this.root.scrollTop - paddingTop);
    const visibleBottom = visibleTop + this.root.clientHeight;
    if (top < visibleTop) {
      this.writeScrollTop(top + paddingTop);
      this.render();
    } else if (bottom > visibleBottom) {
      this.writeScrollTop(
        bottom - this.root.clientHeight + paddingTop,
      );
      this.render();
    } else if (!this.rendered.has(lineIndex)) {
      this.render();
    }
    const caret = this.sourceCaretRect(offset);
    const bounds = this.root.getBoundingClientRect();
    if (!caret || bounds.width <= 0) {
      return;
    }
    const margin = Math.min(24, Math.max(8, this.lineHeight / 2));
    if (caret.left < bounds.left + margin) {
      this.root.scrollLeft = Math.max(
        0,
        this.root.scrollLeft - (bounds.left + margin - caret.left),
      );
    } else if (caret.right > bounds.right - margin) {
      this.root.scrollLeft += caret.right - (bounds.right - margin);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.animationFrame !== undefined) {
      this.root.ownerDocument.defaultView?.cancelAnimationFrame(
        this.animationFrame,
      );
    }
    if (this.compositionTimer !== undefined) {
      this.root.ownerDocument.defaultView?.clearTimeout(
        this.compositionTimer,
      );
    }
    if (this.scrollMeasurementTimer !== undefined) {
      this.root.ownerDocument.defaultView?.clearTimeout(
        this.scrollMeasurementTimer,
      );
    }
    if (this.layoutResetFrame !== undefined) {
      this.root.ownerDocument.defaultView?.cancelAnimationFrame(
        this.layoutResetFrame,
      );
    }
    if (this.resizeAnchorTimer !== undefined) {
      this.root.ownerDocument.defaultView?.clearTimeout(
        this.resizeAnchorTimer,
      );
    }
    this.resizeObserver?.disconnect();
    this.rowResizeObserver?.disconnect();
    this.layoutObserver?.disconnect();
    this.unregisterAdapter();
    this.input.removeEventListener('focus', this.handleInputFocusChange);
    this.input.removeEventListener('blur', this.handleInputFocusChange);
    this.input.removeEventListener(
      'compositionstart',
      this.handleCompositionStart,
    );
    this.input.removeEventListener(
      'compositionend',
      this.handleCompositionEnd,
    );
    this.root.removeEventListener('scroll', this.handleScroll);
    this.root.removeEventListener('scrollend', this.handleScrollEnd);
    this.root.removeEventListener('focus', this.handleRootFocus);
    this.root.ownerDocument.defaultView?.removeEventListener(
      'resize',
      this.handleWindowResize,
    );
    this.rendered.clear();
    this.root.replaceChildren();
  }

  private updateLineHeight(): CSSStyleDeclaration {
    const styles = getComputedStyle(this.root);
    const parsed = Number.parseFloat(styles.lineHeight);
    const fontSize = Number.parseFloat(styles.fontSize);
    const paddingTop = Number.parseFloat(styles.paddingTop);
    this.paddingTopValue = Number.isFinite(paddingTop) ? paddingTop : 0;
    this.heightFontSize =
      Number.isFinite(fontSize) && fontSize > 0
        ? fontSize
        : DEFAULT_LINE_HEIGHT / 1.5;
    this.lineHeight =
      Number.isFinite(parsed) && parsed > 0
        ? parsed
        : Number.isFinite(fontSize) && fontSize > 0
          ? fontSize * 1.5
          : DEFAULT_LINE_HEIGHT;
    return styles;
  }

  private updateSourceMetrics(): void {
    this.root.dataset.sourceLength = String(this.model.source.length);
    this.root.dataset.sourceLineCount = String(this.model.lines.length);
  }

  private rebuildHeightMap(
    styles = getComputedStyle(this.root),
  ): void {
    this.floatClearanceLines.clear();
    const heights = new Array<number>(this.model.lines.length);
    this.floatAnchorLines = new Int32Array(this.model.lines.length);
    this.floatAnchorLines.fill(-1);
    const fontSize =
      Number.parseFloat(styles.fontSize) ||
      this.lineHeight / 1.5;
    const editor = this.root.closest<HTMLElement>('.markdown-editor');
    const editorWidth = editor?.clientWidth || this.root.clientWidth;
    const scale =
      Number.parseFloat(styles.getPropertyValue('--md-scale')) || 1;
    const paddingBase =
      editor?.dataset.contentPadding === 'compact'
        ? 18
        : editor?.dataset.contentPadding === 'wide'
          ? 42
          : editorWidth <= 320
            ? 8
            : editorWidth <= 480
              ? 12
              : editorWidth <= 640
                ? 18
                : 28;
    const digits = Math.max(3, String(this.model.lines.length).length);
    this.root.style.setProperty('--md-line-number-digits', String(digits));
    const configuredMaximum =
      editor?.dataset.contentWidth === 'narrow'
        ? 760
        : editor?.dataset.contentWidth === 'comfortable'
          ? 960
          : Number.POSITIVE_INFINITY;
    const paddingInline = Math.max(
      paddingBase * scale,
      Number.isFinite(configuredMaximum)
        ? Math.max(0, (this.root.clientWidth - configuredMaximum) / 2)
        : 0,
    );
    const gutterGap =
      editorWidth <= 320
        ? fontSize * 0.45
        : editorWidth <= 480
          ? fontSize * 0.65
          : fontSize;
    const gutterWidth =
      editor?.dataset.lineNumbers === 'false'
        ? 0
        : digits * fontSize * 0.58 + gutterGap;
    const contentWidth = Math.max(
      80,
      this.root.clientWidth - paddingInline * 2 - gutterWidth,
    );
    const imageAvailable = Math.max(
      96,
      this.root.clientWidth - paddingInline * 2,
    );
    const wraps = editor?.dataset.wrap !== 'false';
    this.heightContentWidth = contentWidth;
    this.heightFontSize = fontSize;
    this.heightWraps = wraps;
    const headingScale = [1, 1.75, 1.5, 1.25, 1.1, 0.95, 0.9];
    let floatRemaining = 0;
    let floatAnchor = -1;
    let maximumCodeLength = 0;
    for (let index = 0; index < this.model.lines.length; index += 1) {
      const line = this.model.lines[index]!;
      if (line.code) {
        maximumCodeLength = Math.max(
          maximumCodeLength,
          line.source.replaceAll('\t', '  ').length,
        );
      }
      if (line.heading && floatRemaining > 0 && index > 0) {
        heights[index - 1] = (heights[index - 1] ?? this.lineHeight) +
          floatRemaining;
        this.floatClearanceLines.add(index - 1);
        floatRemaining = 0;
        floatAnchor = -1;
      }
      if (floatRemaining > 0) {
        this.floatAnchorLines[index] = floatAnchor;
      }
      const measured = this.measuredHeights.get(line);
      const headingLevel = line.heading
        ? /^\s*(#{1,6})(?:--)?\s/.exec(line.source)?.[1]?.length ?? 0
        : 0;
      const scale = headingScale[headingLevel] ?? 1;
      const estimatedRows =
        wraps && !line.code
          ? Math.max(
              1,
              Math.ceil(
                (line.source.length *
                  fontSize *
                  this.wrapCharFactor *
                  scale) /
                  contentWidth,
              ),
            )
          : 1;
      let height =
        measured ??
        Math.max(
          this.lineHeight,
          estimatedRows *
            (headingLevel > 0
              ? fontSize * scale * 1.25
              : this.lineHeight),
        );
      if (measured === undefined) {
        if (line.codeStart) {
          height += 8;
        }
        if (line.codeEnd) {
          height += 8;
        }
      }
      if (!line.code && sourceLineHasImageDirective(line.source)) {
        const images = imageDirectivesInSource(line.source).map(
          ({ directive }) => ({
            height: directive.height,
            margin: directive.margin,
            mode: directive.mode,
            width: directive.width,
          }),
        );
        const legacy = parseMediaDirective(line.source);
        if (legacy) {
          const width = Math.max(
            96,
            Math.round((legacy.span / 12) * 720),
          );
          images.push({
            height: Math.max(72, Math.round(width / legacy.ratio)),
            margin: 12,
            mode:
              legacy.placement === 'wrap-left' ||
              legacy.placement === 'wrap-right'
              ? 'wrap'
              : legacy.placement,
            width,
          });
        }
        for (const image of images) {
          const width = Math.min(image.width, imageAvailable);
          const imageHeight = width / (image.width / image.height);
          if (image.mode === 'wrap') {
            if (floatRemaining <= 0) {
              floatAnchor = index;
            }
            this.floatAnchorLines[index] = floatAnchor;
            floatRemaining = Math.max(
              floatRemaining,
              imageHeight + image.margin * 2,
            );
          } else {
            height = Math.max(
              height,
              imageHeight + image.margin * 2,
            );
          }
        }
      }
      heights[index] = height;
      floatRemaining = Math.max(0, floatRemaining - height);
      if (floatRemaining <= 0) {
        floatAnchor = -1;
      }
    }
    if (floatRemaining > 0 && heights.length > 0) {
      const last = heights.length - 1;
      heights[last] = heights[last]! + floatRemaining;
      this.floatClearanceLines.add(last);
    }
    this.heightMap.replace(heights);
    this.setCanvasHeight(this.heightMap.totalHeight);
    if (maximumCodeLength > 0) {
      this.canvas.style.setProperty(
        '--md-code-inline-size',
        `calc(${maximumCodeLength}ch + 24px)`,
      );
    } else {
      this.canvas.style.removeProperty('--md-code-inline-size');
    }
  }

  private incrementalHeightLine(
    previous: SourceDocumentModel,
  ): number | undefined {
    const change = this.model.change;
    const index = change.startLine;
    if (
      change.full ||
      this.model.lines.length !== previous.lines.length ||
      change.endLine !== index + 1 ||
      change.previousEndLine !== index + 1
    ) {
      return undefined;
    }
    const before = previous.lines[index];
    const after = this.model.lines[index];
    if (
      !before ||
      !after ||
      before.code ||
      after.code ||
      before.codeStart ||
      after.codeStart ||
      before.codeEnd ||
      after.codeEnd ||
      before.fenceBefore ||
      after.fenceBefore ||
      before.fenceAfter ||
      after.fenceAfter ||
      before.fenceLine ||
      after.fenceLine ||
      before.heading ||
      after.heading ||
      sourceLineHasImageDirective(before.source) ||
      sourceLineHasImageDirective(after.source) ||
      (this.floatAnchorLines[index] ?? -1) >= 0 ||
      this.floatClearanceLines.has(index)
    ) {
      return undefined;
    }
    return index;
  }

  /** @returns the scroll offset in effect after any anchor correction. */
  private updateSingleLineHeight(index: number, scrollTop: number): number {
    const line = this.model.lines[index];
    if (!line) {
      return scrollTop;
    }
    const anchor = this.heightMap.indexAtOffset(scrollTop);
    const previousAnchorTop = this.heightMap.offsetAtIndex(anchor);
    const estimatedRows = this.heightWraps
      ? Math.max(
          1,
          Math.ceil(
            (line.source.length *
              this.heightFontSize *
              this.wrapCharFactor) /
              this.heightContentWidth,
          ),
        )
      : 1;
    this.heightMap.update(
      index,
      Math.max(this.lineHeight, estimatedRows * this.lineHeight),
    );
    const delta =
      this.heightMap.offsetAtIndex(anchor) - previousAnchorTop;
    this.setCanvasHeight(this.heightMap.totalHeight);
    if (Math.abs(delta) <= 0.5) {
      return scrollTop;
    }
    // Assign from the offset already in hand rather than `+=`, which would
    // read the scroll position back and flush layout again.
    const corrected = Math.max(0, scrollTop + delta);
    this.writeScrollTop(corrected + this.paddingTop());
    return corrected;
  }

  private readLayoutSignature(): string {
    const editor = this.root.closest<HTMLElement>('.markdown-editor');
    const workspace = this.root.closest<HTMLElement>('.workspace');
    const documentRoot = this.root.ownerDocument.documentElement;
    return [
      this.root.clientWidth,
      editor?.clientWidth,
      editor?.dataset.contentPadding,
      editor?.dataset.contentWidth,
      editor?.dataset.lineNumbers,
      editor?.dataset.noteFont,
      editor?.dataset.sourceStyle,
      editor?.dataset.wrap,
      workspace?.style.getPropertyValue('--md-scale'),
      documentRoot.dataset.fontLigatures,
      documentRoot.dataset.interfaceFont,
      documentRoot.style.getPropertyValue('--preference-note-font-size'),
      documentRoot.style.getPropertyValue('--preference-note-line-height'),
    ].join('\u0000');
  }

  private requestLayoutReset(): void {
    if (this.disposed || this.layoutResetFrame !== undefined) {
      return;
    }
    const view = this.root.ownerDocument.defaultView;
    if (!view) {
      this.resetLayout();
      return;
    }
    this.layoutResetFrame = view.requestAnimationFrame(() => {
      this.layoutResetFrame = undefined;
      this.resetLayout();
    });
  }

  private resetLayout(): void {
    if (this.disposed) {
      return;
    }
    if (
      !this.root.isConnected ||
      this.root.clientWidth <= 0 ||
      this.root.clientHeight <= 0
    ) {
      // No box to measure against: a pane being taken apart, a tab going
      // hidden. Dropping the request outright left the view anchored to the
      // width it had before and the reader somewhere else entirely, so it is
      // remembered and retried as soon as there is geometry again.
      this.layoutResetDeferred = true;
      return;
    }
    this.layoutResetDeferred = false;
    const signature = this.readLayoutSignature();
    if (signature === this.layoutSignature) {
      this.forceRender = true;
      this.selectionDirty = true;
      this.requestRender();
      return;
    }
    this.layoutSignature = signature;
    // Every measured height is about to be replaced by an estimate, so the
    // document's total height changes and a raw `scrollTop` would land on a
    // different line. The anchor is taken ONCE per resize burst: a pane
    // animation triggers a reset every frame, and re-deriving the anchor from
    // the already-corrected scroll position each time let rounding compound
    // into a drift of tens of lines, always upward.
    const hadAnchor = this.resizeAnchor !== undefined;
    const anchor = this.resizeAnchor ?? this.captureScrollAnchor();
    this.resizeAnchor = anchor;
    const view = this.root.ownerDocument.defaultView;
    if (view) {
      if (this.resizeAnchorTimer !== undefined) {
        view.clearTimeout(this.resizeAnchorTimer);
      }
      this.resizeAnchorTimer = view.setTimeout(() => {
        this.resizeAnchorTimer = undefined;
        this.resizeAnchor = undefined;
      }, RESIZE_ANCHOR_RELEASE_MS);
    }

    this.measuredHeights = new WeakMap();
    for (const rendered of this.rendered.values()) {
      rendered.measuredHeight = undefined;
    }
    const styles = this.updateLineHeight();
    this.rebuildHeightMap(styles);

    if (hadAnchor || anchor.line > 0 || anchor.fraction > 0) {
      // Proportional, so a line that changed height keeps the same relative
      // position instead of losing the remainder to a clamp.
      const restored =
        this.heightMap.offsetAtIndex(anchor.line) +
        anchor.fraction * this.heightMap.heightAt(anchor.line);
      const next = restored + this.paddingTop();
      if (Math.abs(this.root.scrollTop - next) > 0.5) {
        this.writeScrollTop(next);
      }
    }

    this.forceRender = true;
    this.measurementDirty = true;
    this.selectionDirty = true;
    // Synchronously, in the same frame as the scroll write above.
    //
    // Rebuilding the height map moves every line to a new offset, and the
    // re-anchor then moves the scroller into that new coordinate space. The
    // mounted lines are still positioned by the old map until a render moves
    // them, so deferring it to the next frame left exactly one frame where the
    // scroller was looking at a region no line had been placed in yet — an
    // 810 px viewport with 810 px of nothing in it, which is the blank flash a
    // reader sees when a pane opens beside a note.
    this.render();
  }

  /**
   * Writing the canvas height dirties layout for the whole scroller. Typing
   * inside a line usually leaves the document height untouched, so the write
   * is skipped unless the value actually moved.
   */
  private setCanvasHeight(totalHeight: number): void {
    const height = Math.ceil(totalHeight);
    if (height === this.canvasHeightValue) {
      return;
    }
    this.canvasHeightValue = height;
    this.canvas.style.height = `${height}px`;
  }

  /**
   * Tighten the wrap estimate from a line that was actually laid out.
   *
   * Only single-row lines are used, and only ones long enough to say something
   * useful. Each gives an upper bound on the character width factor; keeping
   * the smallest bound seen stops the estimate from predicting wraps that do
   * not happen, which is what inflated the document on a layout reset.
   */
  private learnWrapFactor(
    line: SourceDocumentModel['lines'][number],
    height: number,
  ): void {
    if (
      !this.heightWraps ||
      line.code ||
      line.heading ||
      line.source.length < WRAP_CALIBRATION_MINIMUM_LENGTH ||
      height > this.lineHeight * 1.5 ||
      this.heightFontSize <= 0
    ) {
      return;
    }
    const bound =
      this.heightContentWidth / (line.source.length * this.heightFontSize);
    if (bound > 0 && bound < this.wrapCharFactor) {
      this.wrapCharFactor = Math.max(0.3, bound);
    }
  }

  /**
   * Single funnel for every vertical scroll the view performs itself.
   *
   * The resulting scroll event arrives asynchronously, so the value written is
   * remembered rather than a flag being toggled: the handler recognises its own
   * write by comparing against it.
   */
  private writeScrollTop(next: number): void {
    const target = Math.max(0, next);
    this.programmaticScrollTop = target;
    this.root.scrollTop = target;
  }

  /** Position of a line as a share of its own height, immune to it resizing. */
  private captureScrollAnchor(): { fraction: number; line: number } {
    const scrollTop = Math.max(0, this.root.scrollTop - this.paddingTop());
    const line = this.heightMap.indexAtOffset(scrollTop);
    const height = this.heightMap.heightAt(line);
    const within = scrollTop - this.heightMap.offsetAtIndex(line);
    return {
      fraction: height > 0 ? within / height : 0,
      line,
    };
  }

  private releaseResizeAnchor(): void {
    if (this.resizeAnchorTimer !== undefined) {
      this.root.ownerDocument.defaultView?.clearTimeout(
        this.resizeAnchorTimer,
      );
      this.resizeAnchorTimer = undefined;
    }
    this.resizeAnchor = undefined;
  }

  private paddingTop(): number {
    return this.paddingTopValue;
  }

  /**
   * Viewport height without touching layout on the edit path. The resize
   * observer refreshes it, and its callback runs after layout, where reading
   * the box back is free.
   */
  private requestRender(force = false): void {
    if (this.disposed) {
      return;
    }
    this.forceRender ||= force;
    if (this.animationFrame !== undefined) {
      return;
    }
    const view = this.root.ownerDocument.defaultView;
    if (!view) {
      this.render();
      return;
    }
    this.animationFrame = view.requestAnimationFrame(() => {
      this.animationFrame = undefined;
      const reveal = this.pendingRevealOffset;
      if (reveal !== undefined) {
        this.pendingRevealOffset = undefined;
        this.revealOffset(reveal);
      }
      this.render();
    });
  }

  /**
   * @param knownScrollTop Scroll offset already read while layout was clean.
   * A keystroke writes to the input mirror before rendering, so letting this
   * method read the scroll position back would force Blink to flush layout in
   * the middle of the edit — the largest single cost of a keystroke when it
   * was measured.
   */
  private render(knownScrollTop?: number, writeOnly = false): void {
    if (this.disposed) {
      return;
    }
    if (
      this.layoutResetDeferred &&
      !writeOnly &&
      this.root.clientWidth > 0 &&
      this.root.clientHeight > 0
    ) {
      this.resetLayout();
    }
    const paddingTop = this.paddingTop();
    const scrollTop =
      knownScrollTop ?? Math.max(0, this.root.scrollTop - paddingTop);
    const viewportHeight = Math.max(
      this.lineHeight,
      this.root.clientHeight || 800,
    );
    const overscan = Math.max(
      viewportHeight * 0.5,
      this.lineHeight * MIN_OVERSCAN_LINES,
    );
    let nextViewport = sourceViewport(this.heightMap, {
      maximumLines: MAX_RENDERED_LINES,
      overscan,
      scrollTop,
      viewportHeight,
    });
    const floatAnchor = this.floatAnchorLines[nextViewport.startLine] ?? -1;
    if (floatAnchor >= 0 && floatAnchor < nextViewport.startLine) {
      const visibleEnd = Math.min(
        this.model.lines.length,
        this.heightMap.indexAtOffset(scrollTop + viewportHeight) + 1,
      );
      if (visibleEnd - floatAnchor <= MAX_RENDERED_LINES) {
        nextViewport = {
          ...nextViewport,
          endLine: Math.min(
            this.model.lines.length,
            Math.max(
              visibleEnd,
              Math.min(
                nextViewport.endLine,
                floatAnchor + MAX_RENDERED_LINES,
              ),
            ),
          ),
          startLine: floatAnchor,
          top: this.heightMap.offsetAtIndex(floatAnchor),
        };
      }
    }
    const rangeChanged =
      nextViewport.startLine !== this.viewport.startLine ||
      nextViewport.endLine !== this.viewport.endLine;
    const viewportDirty = this.forceRender || rangeChanged;
    // Measurement runs while the editor is being resized: it only touches the
    // mounted lines, carries its own anchor compensation, and is what keeps the
    // height map agreeing with lines that just re-wrapped. This only holds
    // because a scroll the view caused itself no longer sets `scrolling` — when
    // it did, a pane animation suppressed measurement entirely.
    const shouldMeasure =
      this.measurementDirty && !this.scrolling && !writeOnly;
    this.viewport = nextViewport;
    this.forceRender = false;
    if (
      !viewportDirty &&
      !shouldMeasure &&
      !this.selectionDirty
    ) {
      return;
    }
    if (viewportDirty) {
      this.reconcileLines(nextViewport.startLine, nextViewport.endLine);
      this.linesLayer.style.transform = `translateY(${Math.round(
        nextViewport.top,
      )}px)`;
      this.setCanvasHeight(nextViewport.totalHeight);
    }
    if (shouldMeasure) {
      this.measurementDirty = false;
      this.measureLines(scrollTop);
      // Measuring replaces estimated heights with real ones, which can leave
      // the mounted range too short to cover the viewport. Re-projecting here
      // closes that strip in the same frame — but it has to be a projection,
      // not another full render: calling `render` again read the scroll
      // position and repainted the selection a second time per frame, and the
      // forced layout that costs starved the frame budget outright.
      this.coverViewportAfterMeasurement(scrollTop);
    }
    this.updateActiveLine();
    if (viewportDirty || this.selectionDirty) {
      if (writeOnly) {
        // Painting the selection reads a Range rectangle back out of the DOM,
        // which forces layout. On the keystroke path that read is the whole
        // difference against an editor that keeps a transaction write-only and
        // does its reading in a measure phase, so it moves to the next frame.
        this.requestRender();
      } else {
        this.paintSelection();
        this.selectionDirty = false;
      }
    }
  }

  /**
   * Re-mount the window against heights that were just measured.
   *
   * Only the projection and the mount: no scroll read, no selection paint, no
   * measurement. One extra pass is enough because the heights it projects from
   * are measured rather than estimated, and it stops as soon as the range it
   * wants is the range already mounted.
   */
  private coverViewportAfterMeasurement(scrollTop: number): void {
    const viewportHeight = Math.max(
      this.lineHeight,
      this.root.clientHeight || 800,
    );
    const overscan = Math.max(
      viewportHeight * 0.5,
      this.lineHeight * MIN_OVERSCAN_LINES,
    );
    const next = sourceViewport(this.heightMap, {
      maximumLines: MAX_RENDERED_LINES,
      overscan,
      scrollTop,
      viewportHeight,
    });
    if (
      next.startLine === this.viewport.startLine &&
      next.endLine === this.viewport.endLine
    ) {
      return;
    }
    this.viewport = next;
    this.reconcileLines(next.startLine, next.endLine);
    this.linesLayer.style.transform = `translateY(${Math.round(next.top)}px)`;
    this.setCanvasHeight(next.totalHeight);
  }

  private reconcileLines(startLine: number, endLine: number): void {
    const recyclableByElement = new Map<HTMLElement, RenderedSourceLine>();
    let firstRetained = Number.POSITIVE_INFINITY;
    let lastRetained = -1;
    for (const [index, rendered] of this.rendered) {
      const sourceLine = this.model.lines[index];
      if (index < startLine || index >= endLine) {
        this.rendered.delete(index);
        recyclableByElement.set(rendered.element, rendered);
        continue;
      }
      if (rendered.sourceLine !== sourceLine) {
        releaseSourceSpellingHighlights(this.root, rendered.element);
        this.rowResizeObserver?.unobserve(rendered.element);
        rendered.element.remove();
        this.rendered.delete(index);
        continue;
      }
      firstRetained = Math.min(firstRetained, index);
      lastRetained = Math.max(lastRetained, index);
      rendered.element.classList.toggle(
        'md-line--document-end',
        index === this.model.lines.length - 1,
      );
    }

    const recyclable = Array.from(
      this.linesLayer.children,
      (element) => recyclableByElement.get(element as HTMLElement),
    ).filter(
      (rendered): rendered is RenderedSourceLine => rendered !== undefined,
    );
    const staging = this.root.ownerDocument.createDocumentFragment();
    staging.append(...recyclable.map(({ element }) => element));
    let recyclableIndex = 0;
    const desired: HTMLElement[] = [];
    for (let index = startLine; index < endLine; index += 1) {
      const sourceLine = this.model.lines[index];
      const existing = this.rendered.get(index);
      if (!sourceLine) {
        continue;
      }
      if (existing?.sourceLine === sourceLine) {
        desired.push(existing.element);
        continue;
      }

      const recycled = recyclable[recyclableIndex];
      let element: HTMLElement;
      if (recycled) {
        recyclableIndex += 1;
        element = recycled.element;
        releaseSourceSpellingHighlights(this.root, element);
        updateSourceLineElement(
          this.root,
          element,
          sourceLine,
          index,
          recycled.sourceLine,
        );
        recycled.measuredHeight = undefined;
        recycled.sourceLine = sourceLine;
        this.rendered.set(index, recycled);
      } else {
        element = createSourceLineElement(this.root, sourceLine, index);
        this.rendered.set(index, { element, sourceLine });
        this.rowResizeObserver?.observe(element);
      }
      element.classList.toggle(
        'md-line--active',
        index === this.activeLine,
      );
      element.classList.toggle(
        'md-line--document-end',
        index === this.model.lines.length - 1,
      );
      desired.push(element);
    }

    for (
      let index = recyclableIndex;
      index < recyclable.length;
      index += 1
    ) {
      const rendered = recyclable[index]!;
      this.rowResizeObserver?.unobserve(rendered.element);
    }

    if (this.linesLayer.childElementCount === 0) {
      const fragment = this.root.ownerDocument.createDocumentFragment();
      fragment.append(...desired);
      this.linesLayer.appendChild(fragment);
      return;
    }

    const enteringBefore = Number.isFinite(firstRetained)
      ? Math.max(0, firstRetained - startLine)
      : 0;
    const enteringAfter =
      lastRetained >= 0 ? Math.max(0, endLine - lastRetained - 1) : 0;
    if (enteringAfter > 0 && enteringBefore === 0) {
      let cursor: Element | null = null;
      for (let index = desired.length - 1; index >= 0; index -= 1) {
        const element = desired[index]!;
        if (
          element.parentElement !== this.linesLayer ||
          element.nextElementSibling !== cursor
        ) {
          this.linesLayer.insertBefore(element, cursor);
        }
        cursor = element;
      }
      return;
    }

    let cursor = this.linesLayer.firstElementChild;
    for (const element of desired) {
      if (element === cursor) {
        cursor = cursor.nextElementSibling;
      } else {
        this.linesLayer.insertBefore(element, cursor);
      }
    }
  }

  private measureLines(scrollTop: number): void {
    const anchor = this.heightMap.indexAtOffset(scrollTop);
    let anchorAdjustment = 0;
    let changed = false;
    for (const [index, rendered] of this.rendered) {
      if (this.floatClearanceLines.has(index)) {
        continue;
      }
      const height = rendered.element.getBoundingClientRect().height;
      if (height <= 0) {
        continue;
      }
      this.learnWrapFactor(rendered.sourceLine, height);
      const previousRenderedHeight = rendered.measuredHeight;
      rendered.measuredHeight = height;
      if (Math.abs(height - this.heightMap.heightAt(index)) > 0.5) {
        // Compensate against the element's own previous measurement, not
        // against the map. Only a change in rendered height moves pixels on
        // screen; correcting the map's belief about a line does not. When there
        // is no previous measurement the rendered height has not changed, so
        // there is nothing to compensate.
        if (previousRenderedHeight !== undefined && index < anchor) {
          anchorAdjustment += height - previousRenderedHeight;
        }
        this.measuredHeights.set(rendered.sourceLine, height);
        this.heightMap.update(index, height);
        changed = true;
      }
    }
    if (!changed) {
      return;
    }
    // Height first: a scroll written while the canvas still holds the old
    // height is clamped against it, and clamping only ever moves upward.
    this.setCanvasHeight(this.heightMap.totalHeight);
    if (Math.abs(anchorAdjustment) > 0.5) {
      this.writeScrollTop(this.root.scrollTop + anchorAdjustment);
    }
    this.forceRender = true;
    this.selectionDirty = true;
    this.requestRender();
  }

  private updateActiveLine(): void {
    const active = sourceLineIndexAtOffset(
      this.model,
      selectionFocus(this.selection),
    );
    if (active === this.activeLine) {
      return;
    }
    this.activeLine = active;
    for (const [index, rendered] of this.rendered) {
      rendered.element.classList.toggle('md-line--active', index === active);
    }
  }

  private syncInputMirror(): void {
    if (this.composing) {
      return;
    }
    this.inputMirror = createSourceInputMirror(
      this.model.source,
      this.selection,
      undefined,
      sourceTextReader(this.model),
    );
    if (this.input.value !== this.inputMirror.value) {
      this.input.value = this.inputMirror.value;
    }
    try {
      this.input.setSelectionRange(
        this.inputMirror.selectionStart,
        this.inputMirror.selectionEnd,
        this.inputMirror.selectionDirection,
      );
    } catch {
      return;
    }
  }

  private paintSelection(): void {
    this.selectionLayer.replaceChildren();
    const focused =
      this.root.ownerDocument.activeElement === this.input;
    if (!focused) {
      this.caret.hidden = true;
      return;
    }
    const caretRect = this.sourceCaretRect(
      selectionFocus(this.selection),
    );
    if (caretRect) {
      const canvasBounds = this.canvas.getBoundingClientRect();
      const left = caretRect.left - canvasBounds.left;
      const boxHeight = Math.max(this.lineHeight, caretRect.height);
      // A rect much taller than a line box came from an image host, and there
      // the caret should span the image. Otherwise match a native caret, which
      // covers the text box rather than the whole line box — drawn at the full
      // line height it reads as noticeably taller than the glyphs beside it.
      const widget = caretRect.height > this.lineHeight * 1.5;
      const height = widget
        ? caretRect.height
        : Math.min(boxHeight, Math.max(8, this.heightFontSize * 1.2));
      const top =
        caretRect.top - canvasBounds.top + (boxHeight - height) / 2;
      this.caret.style.left = `${left}px`;
      this.caret.style.top = `${top}px`;
      this.caret.style.height = `${height}px`;
      this.input.style.left = `${left}px`;
      this.input.style.top = `${top}px`;
      this.input.style.width = '1px';
      this.input.style.height = `${height}px`;
    }
    this.caret.hidden =
      this.selection.start !== this.selection.end || !caretRect;
    if (
      this.selection.start === this.selection.end
    ) {
      return;
    }

    const document = this.root.ownerDocument;
    const canvasBounds = this.canvas.getBoundingClientRect();
    for (const [lineIndex, rendered] of this.rendered) {
      const sourceLine = this.model.lines[lineIndex];
      const lineStart = this.model.lineStarts[lineIndex];
      if (!sourceLine || lineStart === undefined) {
        continue;
      }
      const lineEnd = lineStart + sourceLine.source.length;
      const start = Math.max(this.selection.start, lineStart);
      const end = Math.min(this.selection.end, lineEnd);
      if (start > lineEnd || end < lineStart || end < start) {
        continue;
      }
      const content = lineContent(rendered.element);
      const from = positionInContent(content, start - lineStart);
      const to = positionInContent(content, end - lineStart);
      const range = document.createRange();
      try {
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
      } catch {
        continue;
      }
      const rects = [...(range.getClientRects?.() ?? [])];
      if (
        rects.length === 0 &&
        this.selection.start <= lineStart &&
        this.selection.end > lineEnd
      ) {
        rects.push(content.getBoundingClientRect());
      }
      for (const rect of rects) {
        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }
        const marker = document.createElement('span');
        marker.className = 'source-window__selection';
        marker.style.left = `${rect.left - canvasBounds.left}px`;
        marker.style.top = `${rect.top - canvasBounds.top}px`;
        marker.style.width = `${rect.width}px`;
        marker.style.height = `${rect.height}px`;
        this.selectionLayer.appendChild(marker);
      }
      for (const image of rendered.element.querySelectorAll<HTMLElement>(
        '.md-source-image',
      )) {
        const imageStart = Number(image.dataset.imageSourceStart);
        const imageEnd = Number(image.dataset.imageSourceEnd);
        if (
          !Number.isFinite(imageStart) ||
          !Number.isFinite(imageEnd) ||
          this.selection.start >= lineStart + imageEnd ||
          this.selection.end <= lineStart + imageStart
        ) {
          continue;
        }
        const rect = image.getBoundingClientRect();
        const marker = document.createElement('span');
        marker.className =
          'source-window__selection source-window__selection--widget';
        marker.style.left = `${rect.left - canvasBounds.left}px`;
        marker.style.top = `${rect.top - canvasBounds.top}px`;
        marker.style.width = `${rect.width}px`;
        marker.style.height = `${rect.height}px`;
        this.selectionLayer.appendChild(marker);
      }
    }
  }

  private nearestRenderedLine(y: number): HTMLElement | null {
    let nearest: HTMLElement | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const rendered of this.rendered.values()) {
      const bounds = rendered.element.getBoundingClientRect();
      const current =
        y < bounds.top
          ? bounds.top - y
          : y > bounds.bottom
            ? y - bounds.bottom
            : 0;
      if (current < distance) {
        nearest = rendered.element;
        distance = current;
      }
    }
    return nearest;
  }
}
