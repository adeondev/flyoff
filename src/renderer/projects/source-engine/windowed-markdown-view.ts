import {
  splitMarkdownBlocks,
  type MarkdownBlockSource,
} from '../../../shared/markdown';
import {
  applyMarkdownHeadingAssignments,
  buildMarkdownHeadingIndex,
  parseMarkdownBlockSegment,
  renderMarkdownBlockElement,
  type MarkdownHeadingAssignment,
} from '../markdown-render';
import { markdownTextChange } from '../markdown-text-change';
import {
  calibrateMarkdownBlockMetrics,
  createMarkdownBlockMetrics,
  estimateMarkdownBlockHeight,
  type MarkdownBlockKind,
  type MarkdownBlockMetrics,
} from './markdown-block-metrics';
import { SourceHeightMap } from './source-height-map';
import { sourceViewport } from './source-viewport';

const MAX_RENDERED_BLOCKS = 120;
const MIN_OVERSCAN_PX = 480;
const SCROLL_MEASUREMENT_IDLE_MS = 80;
const MEASURED_HEIGHT_CACHE_LIMIT = 40_000;

interface RenderedMarkdownBlock {
  element: Element;
  measuredHeight?: number;
  source: string;
}

export interface WindowedMarkdownViewOptions {
  projectId?: string;
}

const views = new WeakMap<HTMLElement, WindowedMarkdownView>();

/** The windowed view owning a reading container, if it is virtualized. */
export function windowedMarkdownViewFor(
  container: HTMLElement | null | undefined,
): WindowedMarkdownView | undefined {
  return container ? views.get(container) : undefined;
}

/**
 * A reading view that keeps only the visible blocks in the DOM.
 *
 * A 20.000 line note renders to roughly 12.000 blocks and 29.000 elements. The
 * cost of that is not parsing or building the nodes — it is Blink laying them
 * out, which measured at 477 ms on open and 34 ms on every edit. Mounting one
 * screen instead keeps every one of those paths proportional to the viewport.
 *
 * The full text stays outside the DOM: block ranges and heights belong to this
 * object, and the mounted elements are a disposable projection of them.
 */
export class WindowedMarkdownView {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly rendered = new Map<number, RenderedMarkdownBlock>();
  private readonly measuredHeights = new Map<string, number>();
  private readonly heightMap = new SourceHeightMap();

  // Block ranges are held as parallel arrays rather than objects: a local edit
  // shifts every offset after the caret, and rewriting 12.000 integers is
  // cheap where allocating 12.000 replacement objects is not.
  private blockSources: string[] = [];
  private blockStarts = new Int32Array(0);
  private blockEnds = new Int32Array(0);
  private headings = new Map<number, MarkdownHeadingAssignment[]>();
  private metrics: MarkdownBlockMetrics;
  private source = '';
  private projectId?: string;

  private startBlock = 0;
  private endBlock = 0;
  private animationFrame?: number;
  private scrollTimer?: number;
  private scrolling = false;
  private measurementDirty = true;
  private forceRender = true;
  private disposed = false;
  private paddingTopPx = 0;
  private wholeDocumentSelected = false;
  private estimateBasis?: Record<MarkdownBlockKind, number>;

  constructor(root: HTMLElement, options: WindowedMarkdownViewOptions = {}) {
    this.root = root;
    this.projectId = options.projectId;
    const ownerDocument = root.ownerDocument;

    this.canvas = ownerDocument.createElement('div');
    this.canvas.className = 'markdown-view__canvas';
    this.layer = ownerDocument.createElement('div');
    this.layer.className = 'markdown-view__blocks';
    this.canvas.appendChild(this.layer);
    root.replaceChildren(this.canvas);
    root.dataset.windowed = 'true';

    const ownerView = ownerDocument.defaultView;
    const styles = ownerView?.getComputedStyle(root);
    const rowHeight = Number.parseFloat(styles?.lineHeight ?? '');
    const paddingInline =
      (Number.parseFloat(styles?.paddingLeft ?? '') || 0) +
      (Number.parseFloat(styles?.paddingRight ?? '') || 0);
    this.metrics = createMarkdownBlockMetrics(
      Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 24,
      Math.max(0, root.clientWidth - paddingInline),
    );
    this.refreshPaddingTop();
    this.handleScroll = this.handleScroll.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleCopy = this.handleCopy.bind(this);
    this.clearWholeDocumentSelection =
      this.clearWholeDocumentSelection.bind(this);
    root.addEventListener('scroll', this.handleScroll, { passive: true });
    root.addEventListener('keydown', this.handleKeyDown);
    root.addEventListener('copy', this.handleCopy);
    root.addEventListener('pointerdown', this.clearWholeDocumentSelection);
    views.set(root, this);
  }

  get element(): HTMLElement {
    return this.root;
  }

  get blockCount(): number {
    return this.blockSources.length;
  }

  private adoptBlocks(blocks: readonly MarkdownBlockSource[]): void {
    const count = blocks.length;
    const sources = new Array<string>(count);
    const starts = new Int32Array(count);
    const ends = new Int32Array(count);
    for (let index = 0; index < count; index += 1) {
      const block = blocks[index]!;
      sources[index] = block.source;
      starts[index] = block.start;
      ends[index] = block.end;
    }
    this.blockSources = sources;
    this.blockStarts = starts;
    this.blockEnds = ends;
  }

  get mountedBlockCount(): number {
    return this.rendered.size;
  }

  get documentSource(): string {
    return this.source;
  }

  setProjectId(projectId: string | undefined): void {
    if (this.projectId === projectId) {
      return;
    }
    this.projectId = projectId;
    this.rendered.clear();
    this.layer.replaceChildren();
    this.forceRender = true;
    this.requestRender();
  }

  setSource(source: string): void {
    if (this.disposed || this.source === source) {
      return;
    }

    const localEdit = this.applyLocalBlockEdit(source);
    this.source = source;

    if (localEdit === undefined) {
      this.adoptBlocks(splitMarkdownBlocks(source));
      this.headings = buildMarkdownHeadingIndex(this.blockSources);
      this.rendered.clear();
      this.layer.replaceChildren();
      this.refreshHeights();
    } else {
      const stale = this.rendered.get(localEdit);
      if (stale) {
        stale.element.remove();
        this.rendered.delete(localEdit);
      }
      const blockSource = this.blockSources[localEdit]!;
      // Block boundaries and the block count held, so every heading anchor
      // keeps its index; only a change inside a heading can shift the slugs.
      if (blockSource.includes('#')) {
        this.headings = buildMarkdownHeadingIndex(this.blockSources);
      }
      this.heightMap.update(
        localEdit,
        this.measuredHeights.get(blockSource) ??
          estimateMarkdownBlockHeight(blockSource, this.metrics),
      );
      this.canvas.style.height = `${Math.ceil(this.heightMap.totalHeight)}px`;
    }

    this.forceRender = true;
    this.measurementDirty = true;
    this.requestRender();
  }

  /**
   * Absorb an edit that stayed inside one block, updating block offsets in
   * place instead of re-splitting the document.
   *
   * Splitting 20.000 lines into blocks costs about 15 ms, which is far too
   * much to spend on a keystroke in split view. A typing edit almost never
   * moves a block boundary, so the common case only has to re-split the three
   * blocks around the caret and shift the offsets that follow.
   *
   * Returns the touched block index, or undefined when the edit could have
   * moved a boundary and the caller must rebuild.
   */
  private applyLocalBlockEdit(source: string): number | undefined {
    const previousSource = this.source;
    if (previousSource.length === 0 || this.blockSources.length === 0) {
      return undefined;
    }

    const { nextEnd, previousEnd, start } = markdownTextChange(
      previousSource,
      source,
    );
    // A newline on either side can merge or split blocks.
    if (
      previousSource.lastIndexOf('\n', previousEnd - 1) >= start ||
      source.lastIndexOf('\n', nextEnd - 1) >= start
    ) {
      return undefined;
    }

    const index = this.blockIndexAtOffset(start);
    if (index < 0 || index >= this.blockSources.length) {
      return undefined;
    }
    const blockStart = this.blockStarts[index]!;
    const blockEnd = this.blockEnds[index]!;
    const delta = source.length - previousSource.length;
    const shiftedEnd = blockEnd + delta;
    if (
      start < blockStart ||
      previousEnd > blockEnd ||
      nextEnd > shiftedEnd ||
      shiftedEnd < blockStart
    ) {
      return undefined;
    }

    const firstIndex = Math.max(0, index - 1);
    const lastIndex = Math.min(this.blockSources.length - 1, index + 1);
    const windowStart = this.blockStarts[firstIndex]!;
    const windowEnd = this.blockEnds[lastIndex]! + delta;
    if (windowEnd < windowStart || windowEnd > source.length) {
      return undefined;
    }

    const segments = splitMarkdownBlocks(
      source.slice(windowStart, windowEnd),
    );
    if (segments.length !== lastIndex - firstIndex + 1) {
      return undefined;
    }

    // Confirm the re-split window lines up with the blocks it replaces before
    // committing, so a boundary that did move falls back to a full rebuild.
    const localIndex = index - firstIndex;
    for (let position = 0; position < segments.length; position += 1) {
      const segment = segments[position]!;
      const blockIndex = firstIndex + position;
      const shift = position > localIndex ? delta : 0;
      const expectedEnd =
        this.blockEnds[blockIndex]! + (position >= localIndex ? delta : 0);
      if (
        windowStart + segment.start !== this.blockStarts[blockIndex]! + shift ||
        windowStart + segment.end !== expectedEnd ||
        (position !== localIndex &&
          segment.source !== this.blockSources[blockIndex])
      ) {
        return undefined;
      }
    }

    for (let position = 0; position < segments.length; position += 1) {
      const segment = segments[position]!;
      const blockIndex = firstIndex + position;
      this.blockSources[blockIndex] = segment.source;
      this.blockStarts[blockIndex] = windowStart + segment.start;
      this.blockEnds[blockIndex] = windowStart + segment.end;
    }

    if (delta !== 0) {
      for (
        let position = lastIndex + 1;
        position < this.blockSources.length;
        position += 1
      ) {
        this.blockStarts[position] = this.blockStarts[position]! + delta;
        this.blockEnds[position] = this.blockEnds[position]! + delta;
      }
    }

    return index;
  }

  /**
   * Measuring the first screen teaches the estimator what a paragraph, a
   * heading or a table really costs, but the thousands of blocks that were
   * never mounted still carry the heights guessed before that. Once the
   * calibrated model has moved far enough from the one those guesses came
   * from, they are recomputed so the scrollbar reflects the whole document
   * rather than the part that happens to have been seen.
   */
  private reestimateWithCalibratedMetrics(): void {
    const scrollTop = Math.max(0, this.root.scrollTop - this.paddingTop());
    const anchorIndex = this.heightMap.indexAtOffset(scrollTop);
    const anchorBefore = this.heightMap.offsetAtIndex(anchorIndex);

    this.refreshHeights();

    const shift = this.heightMap.offsetAtIndex(anchorIndex) - anchorBefore;
    if (Math.abs(shift) > 0.5) {
      this.root.scrollTop += shift;
    }
    this.forceRender = true;
  }

  private metricsOutgrewEstimates(): boolean {
    const basis = this.estimateBasis;
    if (!basis) {
      return false;
    }
    for (const kind of Object.keys(basis) as MarkdownBlockKind[]) {
      const previous = basis[kind];
      const current = this.metrics.heightPerRow[kind];
      if (previous > 0 && Math.abs(current - previous) / previous > 0.02) {
        return true;
      }
    }
    return false;
  }

  private refreshHeights(): void {
    this.estimateBasis = { ...this.metrics.heightPerRow };
    const heights = new Array<number>(this.blockSources.length);
    for (let index = 0; index < this.blockSources.length; index += 1) {
      const blockSource = this.blockSources[index]!;
      heights[index] =
        this.measuredHeights.get(blockSource) ??
        estimateMarkdownBlockHeight(blockSource, this.metrics);
    }
    this.heightMap.replace(heights);
    this.canvas.style.height = `${Math.ceil(this.heightMap.totalHeight)}px`;
  }

  /**
   * The container carries the reading padding, so the canvas starts below it
   * and scroll offsets have to be translated into canvas coordinates. Reading
   * the computed style is a layout read, so it is refreshed off the scroll
   * path rather than every frame.
   */
  private paddingTop(): number {
    return this.paddingTopPx;
  }

  private refreshPaddingTop(): void {
    const view = this.root.ownerDocument.defaultView;
    if (!view) {
      return;
    }
    const parsed = Number.parseFloat(
      view.getComputedStyle(this.root).paddingTop,
    );
    this.paddingTopPx = Number.isFinite(parsed) ? parsed : 0;
  }

  private handleScroll(): void {
    this.scrolling = true;
    const view = this.root.ownerDocument.defaultView;
    if (view) {
      if (this.scrollTimer !== undefined) {
        view.clearTimeout(this.scrollTimer);
      }
      this.scrollTimer = view.setTimeout(() => {
        this.scrollTimer = undefined;
        this.scrolling = false;
        this.measurementDirty = true;
        this.requestRender();
      }, SCROLL_MEASUREMENT_IDLE_MS);
    }
    this.requestRender();
  }

  /**
   * Select the whole note.
   *
   * Only the visible blocks exist, so a DOM range can never cover the
   * document. The range drawn here selects what is on screen, and the flag
   * records that the reader asked for everything — a copy then serves the
   * full text from the model instead of the mounted fragment.
   */
  selectAll(): void {
    const view = this.root.ownerDocument.defaultView;
    const selection = view?.getSelection();
    if (selection) {
      const range = this.root.ownerDocument.createRange();
      range.selectNodeContents(this.layer);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    this.wholeDocumentSelected = true;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const primary = event.ctrlKey || event.metaKey;
    if (
      primary &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'a'
    ) {
      event.preventDefault();
      this.selectAll();
      return;
    }
    if (!primary) {
      this.clearWholeDocumentSelection();
    }
  }

  private handleCopy(event: ClipboardEvent): void {
    if (!this.wholeDocumentSelected) {
      return;
    }
    event.clipboardData?.setData('text/plain', this.source);
    event.preventDefault();
  }

  private clearWholeDocumentSelection(): void {
    this.wholeDocumentSelected = false;
  }

  /** Run any pending projection work now, instead of on the next frame. */
  flush(): void {
    const view = this.root.ownerDocument.defaultView;
    if (this.animationFrame !== undefined) {
      view?.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
    this.render();
  }

  requestRender(): void {
    if (this.disposed || this.animationFrame !== undefined) {
      return;
    }
    const view = this.root.ownerDocument.defaultView;
    if (!view) {
      this.render();
      return;
    }
    this.animationFrame = view.requestAnimationFrame(() => {
      this.animationFrame = undefined;
      this.render();
    });
  }

  private render(): void {
    if (this.disposed || this.blockSources.length === 0) {
      return;
    }

    const viewportHeight = Math.max(1, this.root.clientHeight || 650);
    const overscan = Math.max(MIN_OVERSCAN_PX, viewportHeight * 0.5);
    const viewport = sourceViewport(this.heightMap, {
      maximumLines: MAX_RENDERED_BLOCKS,
      overscan,
      scrollTop: Math.max(0, this.root.scrollTop - this.paddingTop()),
      viewportHeight,
    });

    const rangeChanged =
      viewport.startLine !== this.startBlock ||
      viewport.endLine !== this.endBlock;
    const shouldMeasure = this.measurementDirty && !this.scrolling;
    if (!rangeChanged && !this.forceRender && !shouldMeasure) {
      return;
    }

    this.startBlock = viewport.startLine;
    this.endBlock = viewport.endLine;

    if (rangeChanged || this.forceRender) {
      this.forceRender = false;
      this.reconcileBlocks(viewport.startLine, viewport.endLine);
      this.layer.style.transform = `translateY(${Math.round(viewport.top)}px)`;
      this.canvas.style.height = `${Math.ceil(viewport.totalHeight)}px`;
    }

    if (shouldMeasure) {
      this.measurementDirty = false;
      this.measureBlocks();
    }
  }

  private mountBlock(index: number): RenderedMarkdownBlock | undefined {
    const blockSource = this.blockSources[index];
    if (blockSource === undefined) {
      return undefined;
    }
    const node = parseMarkdownBlockSegment({
      end: this.blockEnds[index]!,
      source: blockSource,
      start: this.blockStarts[index]!,
    });
    const element = node
      ? renderMarkdownBlockElement(node, this.projectId)
      : null;
    if (!(element instanceof Element)) {
      return undefined;
    }
    const assignments = this.headings.get(index);
    if (assignments) {
      applyMarkdownHeadingAssignments(element, assignments);
    }
    if (element instanceof HTMLElement) {
      element.dataset.markdownBlock = String(index);
      if (index === this.blockSources.length - 1) {
        element.classList.add('markdown-view__block--last');
      }
    }
    return { element, source: blockSource };
  }

  private reconcileBlocks(startBlock: number, endBlock: number): void {
    for (const [index, rendered] of this.rendered) {
      if (index >= startBlock && index < endBlock) {
        continue;
      }
      rendered.element.remove();
      this.rendered.delete(index);
    }

    // Mounting in ascending order and inserting before the first already
    // mounted successor keeps the children in document order without a sort.
    for (let index = startBlock; index < endBlock; index += 1) {
      if (this.rendered.has(index)) {
        continue;
      }
      const mounted = this.mountBlock(index);
      if (!mounted) {
        continue;
      }
      let anchor: Element | null = null;
      for (let after = index + 1; after < endBlock; after += 1) {
        const candidate = this.rendered.get(after);
        if (candidate) {
          anchor = candidate.element;
          break;
        }
      }
      this.layer.insertBefore(mounted.element, anchor);
      this.rendered.set(index, mounted);
    }
  }

  private measureBlocks(): void {
    this.refreshPaddingTop();
    const anchorIndex = this.heightMap.indexAtOffset(
      Math.max(0, this.root.scrollTop - this.paddingTop()),
    );
    let anchorAdjustment = 0;
    let changed = false;

    // A block's own border box excludes its margins, and adjacent margins
    // collapse, so summing rects would understate the document by every gap
    // between blocks. The distance to the next block's top is the height the
    // flow actually gives this one. The last mounted block has no successor to
    // measure against and is left for a later pass.
    const mountedIndices = [...this.rendered.keys()].sort(
      (left, right) => left - right,
    );
    const tops = new Map<number, number>();
    for (const index of mountedIndices) {
      tops.set(index, this.rendered.get(index)!.element.getBoundingClientRect().top);
    }

    for (const index of mountedIndices) {
      const rendered = this.rendered.get(index)!;
      const successorTop = tops.get(index + 1);
      const height =
        successorTop === undefined
          ? 0
          : successorTop - tops.get(index)!;
      if (height <= 0) {
        continue;
      }
      const previousHeight = rendered.measuredHeight;
      rendered.measuredHeight = height;
      if (Math.abs(height - this.heightMap.heightAt(index)) <= 0.5) {
        continue;
      }
      if (previousHeight !== undefined && index < anchorIndex) {
        anchorAdjustment += height - previousHeight;
      }
      calibrateMarkdownBlockMetrics(this.metrics, rendered.source, height);
      if (this.measuredHeights.size >= MEASURED_HEIGHT_CACHE_LIMIT) {
        this.measuredHeights.clear();
      }
      this.measuredHeights.set(rendered.source, height);
      this.heightMap.update(index, height);
      changed = true;
    }

    if (!changed) {
      return;
    }
    // Correcting a block above the anchor would otherwise slide the content
    // the reader is looking at.
    if (Math.abs(anchorAdjustment) > 0.5) {
      this.root.scrollTop += anchorAdjustment;
    }
    if (this.metricsOutgrewEstimates()) {
      this.reestimateWithCalibratedMetrics();
    }
    this.canvas.style.height = `${Math.ceil(this.heightMap.totalHeight)}px`;
    this.forceRender = true;
    this.requestRender();
  }

  /** Scroll so the block covering a source offset is mounted and visible. */
  scrollToOffset(offset: number, block: ScrollLogicalPosition = 'start'): void {
    const index = this.blockIndexAtOffset(offset);
    if (index < 0) {
      return;
    }
    const top = this.heightMap.offsetAtIndex(index) + this.paddingTop();
    this.root.scrollTop =
      block === 'center'
        ? Math.max(0, top - this.root.clientHeight / 2)
        : top;
    this.forceRender = true;
    this.render();
  }

  private blockIndexAtOffset(offset: number): number {
    let low = 0;
    let high = this.blockSources.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (this.blockStarts[middle]! <= offset) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return Math.max(0, high);
  }

  /** Reveal a heading by its path, mounting it first when it is offscreen. */
  scrollToHeadingPath(headingPath: readonly string[]): boolean {
    const serialized = JSON.stringify(headingPath);
    for (const [index, assignments] of this.headings) {
      for (const assignment of assignments) {
        if (JSON.stringify(assignment.path) !== serialized) {
          continue;
        }
        this.scrollToOffset(this.blockStarts[index]!, 'center');
        return true;
      }
    }
    return false;
  }

  scrollToTop(): void {
    this.root.scrollTop = 0;
    this.forceRender = true;
    this.render();
  }

  destroy(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const view = this.root.ownerDocument.defaultView;
    if (this.animationFrame !== undefined) {
      view?.cancelAnimationFrame(this.animationFrame);
    }
    if (this.scrollTimer !== undefined) {
      view?.clearTimeout(this.scrollTimer);
    }
    this.root.removeEventListener('scroll', this.handleScroll);
    this.root.removeEventListener('keydown', this.handleKeyDown);
    this.root.removeEventListener('copy', this.handleCopy);
    this.root.removeEventListener(
      'pointerdown',
      this.clearWholeDocumentSelection,
    );
    this.rendered.clear();
    this.measuredHeights.clear();
    this.root.replaceChildren();
    delete this.root.dataset.windowed;
    views.delete(this.root);
  }
}
