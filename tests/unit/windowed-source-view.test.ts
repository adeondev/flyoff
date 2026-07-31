// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WindowedSourceView } from '../../src/renderer/projects/source-engine/windowed-source-view';
import { serializeImageDirective } from '../../src/shared/markdown';

class ResizeObserverStub implements ResizeObserver {
  static instances: ResizeObserverStub[] = [];

  constructor(
    private readonly callback: ResizeObserverCallback,
  ) {
    ResizeObserverStub.instances.push(this);
  }

  disconnect(): void {}

  observe(): void {}

  unobserve(): void {}

  trigger(): void {
    this.callback([], this);
  }
}

function editorRoot(): HTMLDivElement {
  const editor = document.createElement('main');
  editor.className = 'markdown-editor';
  const root = document.createElement('div');
  root.className = 'markdown-source__editor';
  root.style.fontSize = '16px';
  root.style.lineHeight = '24px';
  Object.defineProperties(root, {
    clientHeight: { configurable: true, value: 240 },
    clientWidth: { configurable: true, value: 800 },
    scrollTop: { configurable: true, value: 0, writable: true },
  });
  editor.appendChild(root);
  document.body.appendChild(editor);
  return root;
}

describe('windowed source view', () => {
  let frames: FrameRequestCallback[];
  let views: WindowedSourceView[];

  beforeEach(() => {
    frames = [];
    views = [];
    ResizeObserverStub.instances = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    for (const view of views) {
      view.dispose();
    }
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function createView(
    source = 'first\nsecond',
  ): WindowedSourceView {
    const view = new WindowedSourceView(editorRoot(), {
      ariaLabel: 'Editor',
      readOnly: false,
      selection: { direction: 'none', end: 0, start: 0 },
      source,
    });
    views.push(view);
    return view;
  }

  function flushFrames(): void {
    let passes = 0;
    while (frames.length > 0) {
      const pending = frames.splice(0);
      for (const callback of pending) {
        callback(performance.now());
      }
      passes += 1;
      if (passes > 10) {
        throw new Error('windowed source view did not settle');
      }
    }
  }

  /**
   * One pass of the frames queued so far, without draining the frames those
   * callbacks queue in turn. `flushFrames` runs to quiescence, which hides
   * whether work happened in this frame or the next one — and that difference
   * is the whole question here.
   */
  function runOneFramePass(): void {
    for (const callback of frames.splice(0)) {
      callback(performance.now());
    }
  }

  it('repositions the lines in the same frame that re-anchors the scroll', () => {
    const source = Array.from(
      { length: 2_000 },
      (_, index) =>
        `line ${index} with enough text on it that a narrower editor wraps it`,
    ).join('\n');
    const view = createView(source);
    const root = view.input.closest<HTMLElement>('.markdown-source__editor')!;
    const layer = root.querySelector<HTMLElement>('.source-window__lines')!;
    flushFrames();

    root.scrollTop = 6_000;
    root.dispatchEvent(new Event('scroll'));
    flushFrames();

    const scrollBefore = root.scrollTop;
    const transformBefore = layer.style.transform;

    // Halving the width is what opening a pane beside the note does: every
    // line re-wraps, the height map is rebuilt, and the scroller is re-anchored
    // into the new coordinate space.
    Object.defineProperty(root, 'clientWidth', {
      configurable: true,
      value: 400,
    });
    ResizeObserverStub.instances[0]!.trigger();

    // Exactly the frame the layout reset runs in, and nothing after it.
    runOneFramePass();

    expect(
      root.scrollTop,
      'the layout reset should have re-anchored the scroll position',
    ).not.toBe(scrollBefore);
    // The lines are placed by this transform. Leaving it at the old value
    // while the scroller has already moved into the new coordinate space is a
    // frame where the viewport looks at a region no line was placed in — the
    // note visibly blanks and comes back when a pane opens beside it.
    expect(
      layer.style.transform,
      'the line layer still holds the offset from the previous layout',
    ).not.toBe(transformBefore);
  });

  // Skipped deliberately, not aspirationally. The close-split strip is real in
  // the packaged app — one frame with 371 px of an 810 px viewport uncovered,
  // in roughly one run in three — but it depends on lines actually re-wrapping,
  // and jsdom does no layout, so this passes here whether the defect is present
  // or not. Left as the shape the assertion should take once it can be driven
  // from real geometry; it proves nothing today.
  it.skip('mounts enough lines to cover the viewport when the pane widens', () => {
    const source = Array.from(
      { length: 2_000 },
      (_, index) =>
        `line ${index} with enough text on it that a narrower editor wraps it`,
    ).join('\n');
    const view = createView(source);
    const root = view.input.closest<HTMLElement>('.markdown-source__editor')!;
    // Start narrow, the way a note sits while a pane is open beside it.
    Object.defineProperty(root, 'clientWidth', {
      configurable: true,
      value: 400,
    });
    ResizeObserverStub.instances[0]!.trigger();
    flushFrames();
    root.scrollTop = 6_000;
    root.dispatchEvent(new Event('scroll'));
    flushFrames();

    // Closing the pane gives the width back. The lines that were wrapping stop
    // wrapping, so the document shrinks under the viewport and a range
    // projected from the old estimates no longer reaches the bottom of it.
    Object.defineProperty(root, 'clientWidth', {
      configurable: true,
      value: 800,
    });
    ResizeObserverStub.instances[0]!.trigger();
    runOneFramePass();

    // A single row cannot be shorter than the line height, so covering the
    // viewport takes at least this many lines however they are laid out.
    const minimum = Math.ceil(root.clientHeight / 24);
    expect(
      view.getVisibleLineElements().length,
      `only ${view.getVisibleLineElements().length} lines are mounted for a ${root.clientHeight}px viewport`,
    ).toBeGreaterThanOrEqual(minimum);
  });

  it('removes every listener and observer it installed when disposed', () => {
    const root = editorRoot();
    const added: [string, EventListenerOrEventListenerObject][] = [];
    const removed: [string, EventListenerOrEventListenerObject][] = [];
    const addSpy = vi
      .spyOn(root, 'addEventListener')
      .mockImplementation((type, listener) => {
        added.push([type, listener as EventListenerOrEventListenerObject]);
      });
    const removeSpy = vi
      .spyOn(root, 'removeEventListener')
      .mockImplementation((type, listener) => {
        removed.push([type, listener as EventListenerOrEventListenerObject]);
      });
    const view = new WindowedSourceView(root, {
      ariaLabel: 'Editor',
      readOnly: false,
      selection: { direction: 'none', end: 0, start: 0 },
      source: 'first\nsecond',
    });
    const disconnected = ResizeObserverStub.instances.map(() => false);
    ResizeObserverStub.instances.forEach((observer, index) => {
      vi.spyOn(observer, 'disconnect').mockImplementation(() => {
        disconnected[index] = true;
      });
    });

    expect(added.length).toBeGreaterThan(0);
    view.dispose();

    expect(removed).toEqual(added);
    expect(disconnected.every(Boolean)).toBe(true);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('remeasures resized rows and invalidates measurements on layout reset', () => {
    const view = createView();
    const first = view.getVisibleLineElements()[0]!;
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 400, 48),
    );

    ResizeObserverStub.instances[1]!.trigger();
    flushFrames();

    const canvas = first.closest('.source-window__canvas') as HTMLElement;
    expect(canvas.style.height).toBe('72px');

    vi.mocked(first.getBoundingClientRect).mockReturnValue(
      new DOMRect(0, 0, 400, 24),
    );
    const rebuildHeightMap = vi.spyOn(
      view as unknown as { rebuildHeightMap(): void },
      'rebuildHeightMap',
    );
    Object.defineProperty(
      first.closest('.markdown-source__editor'),
      'clientWidth',
      { configurable: true, value: 640 },
    );
    ResizeObserverStub.instances[0]!.trigger();
    flushFrames();

    expect(rebuildHeightMap).toHaveBeenCalledOnce();
    expect(canvas.style.height).toBe('48px');
  });

  it('does not re-derive the scroll anchor during a burst of layout resets', () => {
    const source = Array.from(
      { length: 900 },
      (_, index) => `line ${index} com texto suficiente para ocupar espaco`,
    ).join('\n');
    const view = createView(source);
    const root = view.input.closest(
      '.markdown-source__editor',
    ) as HTMLDivElement;

    root.scrollTop = 24 * 300;
    root.dispatchEvent(new Event('scroll'));
    flushFrames();

    const captureScrollAnchor = vi.spyOn(
      view as unknown as {
        captureScrollAnchor(): { fraction: number; line: number };
      },
      'captureScrollAnchor',
    );
    const rebuildHeightMap = vi.spyOn(
      view as unknown as { rebuildHeightMap(): void },
      'rebuildHeightMap',
    );

    // A pane animation resizes the editor on every frame, and every frame is a
    // full layout reset. Re-deriving the anchor from the already-corrected
    // scroll position is what let the error compound upward.
    for (const width of [780, 760, 740, 720, 700, 690, 680]) {
      Object.defineProperty(root, 'clientWidth', {
        configurable: true,
        value: width,
      });
      ResizeObserverStub.instances[0]!.trigger();
      flushFrames();
    }

    expect(rebuildHeightMap.mock.calls.length).toBeGreaterThan(1);
    // Not derived during the burst at all. A resize is only observed after the
    // browser has re-wrapped the mounted lines, so anything read once the burst
    // has started already describes a position the text has moved to. The
    // anchor restored across the burst is the one recorded on the last frame in
    // which the height map and the text on screen still agreed, which is why
    // this is now zero rather than one.
    expect(captureScrollAnchor).not.toHaveBeenCalled();
  });

  it('does not let its own scroll correction count as the reader scrolling', async () => {
    const source = Array.from(
      { length: 500 },
      (_, index) => `line ${index}`,
    ).join('\n');
    const view = createView(source);
    const root = view.input.closest(
      '.markdown-source__editor',
    ) as HTMLDivElement;
    // Scroll away from the top first, so the reset's anchor restore actually
    // writes scrollTop — otherwise there is no self-induced scroll to classify
    // and the assertion would hold for the wrong reason.
    root.scrollTop = 24 * 200;
    root.dispatchEvent(new Event('scroll'));
    flushFrames();
    await new Promise((resolve) => setTimeout(resolve, 100));
    flushFrames();

    const measureLines = vi.spyOn(
      view as unknown as { measureLines(scrollTop: number): void },
      'measureLines',
    );

    // A layout reset writes scrollTop itself. Treating that write as the reader
    // scrolling latched `scrolling` and suppressed measurement for the whole
    // animation, leaving re-wrapped lines unreconciled.
    Object.defineProperty(root, 'clientWidth', {
      configurable: true,
      value: 640,
    });
    ResizeObserverStub.instances[0]!.trigger();
    flushFrames();

    expect(measureLines).toHaveBeenCalled();
  });

  it('spans the image when the caret sits on an image host', () => {
    const view = createView();
    const canvas = view.input.closest(
      '.source-window__canvas',
    ) as HTMLElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(20, 10, 800, 400),
    );
    // An image host reports a rect far taller than a line box. Clamping that
    // to the text box would draw a tiny caret beside a large image.
    vi.spyOn(view, 'sourceCaretRect').mockReturnValue(
      new DOMRect(120, 80, 0, 180),
    );

    view.input.focus();
    flushFrames();

    expect(view.input.style.height).toBe('180px');
    expect(view.input.style.top).toBe('70px');
  });

  it('repaints on focus and blur but skips a stable scroll frame', () => {
    const view = createView();
    const canvas = view.input.closest(
      '.source-window__canvas',
    ) as HTMLElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(20, 10, 800, 48),
    );
    vi.spyOn(view, 'sourceCaretRect').mockReturnValue(
      new DOMRect(120, 80, 0, 18),
    );
    const paintSelection = vi.spyOn(
      view as unknown as { paintSelection(): void },
      'paintSelection',
    );
    const measureLines = vi.spyOn(
      view as unknown as { measureLines(scrollTop: number): void },
      'measureLines',
    );

    view.input.focus();
    flushFrames();

    expect(view.input.style.left).toBe('100px');
    // The caret covers the text box (16px font x 1.2), centred in the 24px
    // line box, so it reads like a native caret rather than spanning the whole
    // line: 70px + (24 - 19.2) / 2.
    expect(view.input.style.top).toBe('72.4px');
    expect(view.input.style.width).toBe('1px');
    expect(view.input.style.height).toBe('19.2px');
    paintSelection.mockClear();
    measureLines.mockClear();

    view.input.closest('.markdown-source__editor')?.dispatchEvent(
      new Event('scroll'),
    );
    flushFrames();
    expect(paintSelection).not.toHaveBeenCalled();
    expect(measureLines).not.toHaveBeenCalled();

    view.input.blur();
    flushFrames();
    expect(paintSelection).toHaveBeenCalledOnce();
    expect(
      (canvas.querySelector('.source-window__caret') as HTMLElement).hidden,
    ).toBe(true);
  });

  it('defers row measurement until scrolling settles', async () => {
    const source = Array.from(
      { length: 500 },
      (_, index) => `line ${index}`,
    ).join('\n');
    const view = createView(source);
    const root = view.input.closest(
      '.markdown-source__editor',
    ) as HTMLDivElement;
    const measureLines = vi.spyOn(
      view as unknown as { measureLines(scrollTop: number): void },
      'measureLines',
    );

    root.scrollTop = 24 * 200;
    root.dispatchEvent(new Event('scroll'));
    flushFrames();
    expect(measureLines).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 100));
    flushFrames();
    expect(measureLines).toHaveBeenCalledOnce();
  });

  it('keeps the viewport fixed when deferred measurement settles', async () => {
    const source = Array.from(
      { length: 500 },
      (_, index) => `line ${index}`,
    ).join('\n');
    const view = createView(source);
    const root = view.input.closest(
      '.markdown-source__editor',
    ) as HTMLDivElement;

    root.scrollTop = 24 * 200;
    root.dispatchEvent(new Event('scroll'));
    flushFrames();

    const rendered = view.getVisibleLineElements();
    const overscanLine = rendered.find(
      (line) => Number(line.dataset.line) - 1 < 200,
    )!;
    vi.spyOn(overscanLine, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 400, 48),
    );
    const settledScrollTop = root.scrollTop;

    await new Promise((resolve) => setTimeout(resolve, 100));
    flushFrames();

    expect(root.scrollTop).toBe(settledScrollTop);

    vi.mocked(overscanLine.getBoundingClientRect).mockReturnValue(
      new DOMRect(0, 0, 400, 72),
    );
    ResizeObserverStub.instances[1]!.trigger();
    flushFrames();

    expect(root.scrollTop).toBe(settledScrollTop + 24);
  });

  it('reveals a scheduled caret in the next frame, not inside the edit', () => {
    const source = Array.from(
      { length: 900 },
      (_, index) => `line ${index}`,
    ).join('\n');
    const view = createView(source);
    const root = view.input.closest(
      '.markdown-source__editor',
    ) as HTMLDivElement;

    root.scrollTop = 24 * 400;
    root.dispatchEvent(new Event('scroll'));
    flushFrames();
    const readingPosition = root.scrollTop;

    const target = view.getModel().lineStarts[100]!;
    view.scheduleRevealOffset(target);

    // Reading geometry back is what a keystroke must not pay for; nothing may
    // have moved before the frame runs.
    expect(root.scrollTop).toBe(readingPosition);

    flushFrames();

    expect(root.scrollTop).toBeLessThan(readingPosition);
  });

  it('does not scroll the caret into view when the selection is only re-read', () => {
    const source = Array.from(
      { length: 900 },
      (_, index) => `line ${index}`,
    ).join('\n');
    const view = createView(source);
    const root = view.input.closest(
      '.markdown-source__editor',
    ) as HTMLDivElement;

    // The reader leaves the caret near the top and scrolls far past it, which
    // is the state a note is in when a tab or pane is opened beside it.
    view.writeSelection({ direction: 'none', end: 0, start: 0 });
    flushFrames();
    root.scrollTop = 24 * 400;
    root.dispatchEvent(new Event('scroll'));
    flushFrames();
    const readingPosition = root.scrollTop;

    // Focus coming back to the editor makes the document emit `selectionchange`
    // even though the caret never moved.
    expect(view.syncSelectionFromInput()).toEqual({
      direction: 'none',
      end: 0,
      start: 0,
    });
    flushFrames();

    expect(root.scrollTop).toBe(readingPosition);

    // A caret that actually moves must still be followed.
    const target = view.getModel().lineStarts[500]!;
    view.input.setSelectionRange(
      view.captureInputMirror().selectionStart,
      view.captureInputMirror().selectionEnd,
    );
    view.writeSelection({ direction: 'none', end: target, start: target });
    flushFrames();
    root.scrollTop = 24 * 800;
    root.dispatchEvent(new Event('scroll'));
    flushFrames();
    view.input.setSelectionRange(0, 0);

    view.syncSelectionFromInput();
    flushFrames();

    expect(root.scrollTop).toBeLessThan(24 * 800);
  });

  it('coalesces duplicate layout notifications and ignores hidden geometry', () => {
    const view = createView(
      Array.from({ length: 500 }, (_, index) => `line ${index}`).join('\n'),
    );
    const root = view.input.closest(
      '.markdown-source__editor',
    ) as HTMLDivElement;
    const rebuildHeightMap = vi.spyOn(
      view as unknown as { rebuildHeightMap(): void },
      'rebuildHeightMap',
    );

    Object.defineProperty(root, 'clientWidth', {
      configurable: true,
      value: 0,
    });
    ResizeObserverStub.instances[0]!.trigger();
    window.dispatchEvent(new Event('resize'));
    flushFrames();
    expect(rebuildHeightMap).not.toHaveBeenCalled();

    Object.defineProperty(root, 'clientWidth', {
      configurable: true,
      value: 640,
    });
    ResizeObserverStub.instances[0]!.trigger();
    window.dispatchEvent(new Event('resize'));
    flushFrames();
    expect(rebuildHeightMap).toHaveBeenCalledOnce();
  });

  it('invalidates height estimates when wrapping preferences change', async () => {
    const view = createView(
      Array.from({ length: 500 }, (_, index) => `line ${index}`).join('\n'),
    );
    const editor = view.input.closest('.markdown-editor') as HTMLElement;
    const rebuildHeightMap = vi.spyOn(
      view as unknown as { rebuildHeightMap(): void },
      'rebuildHeightMap',
    );

    editor.dataset.wrap = 'false';
    await Promise.resolve();
    flushFrames();

    expect(rebuildHeightMap).toHaveBeenCalledOnce();
  });

  it('does not rewrite native input state during composition', () => {
    const view = createView('before');
    view.input.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    );
    view.input.value = 'native composition';
    view.input.setSelectionRange(18, 18);

    view.setSource('before composition', {
      direction: 'none',
      end: 18,
      start: 18,
    });

    expect(view.input.value).toBe('native composition');
    expect(view.input.selectionStart).toBe(18);
    expect(view.input.selectionEnd).toBe(18);
  });

  it('reveals the caret horizontally when long lines do not wrap', () => {
    const source = 'x'.repeat(4_000);
    const view = createView(source);
    const root = view.input.closest(
      '.markdown-source__editor',
    ) as HTMLDivElement;
    const editor = root.closest('.markdown-editor') as HTMLElement;
    editor.dataset.wrap = 'false';
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 800, 240),
    );
    vi.spyOn(view, 'sourceCaretRect').mockReturnValue(
      new DOMRect(1_200, 40, 0, 24),
    );

    view.writeSelection({
      direction: 'none',
      end: source.length,
      start: source.length,
    });

    expect(root.scrollLeft).toBeGreaterThan(400);
  });

  it('keeps textarea and source offsets aligned across CRLF', () => {
    const source = 'zero\r\none\r\ntwo\r\nthree';
    const view = createView(source);
    view.writeSelection({
      direction: 'none',
      end: source.length,
      start: source.length,
    });
    const mirror = view.captureInputMirror();

    expect(view.input.value).toBe('zero\none\ntwo\nthree');
    expect(view.input.selectionStart).toBe(view.input.value.length);
    expect(view.syncSelectionFromInput()).toEqual({
      direction: 'none',
      end: source.length,
      start: source.length,
    });

    view.input.setRangeText(
      '漢字',
      view.input.selectionStart,
      view.input.selectionEnd,
      'end',
    );
    expect(view.readInputEdit(source, mirror)).toEqual({
      // The reported edit is what the document model applies without reading
      // the note, so the offsets matter as much as the resulting text.
      change: { from: source.length, insert: '漢字', to: source.length },
      content: `${source}漢字`,
      inserted: '漢字',
      selection: {
        direction: 'none',
        end: source.length + 2,
        start: source.length + 2,
      },
    });
  });

  it('keeps code width stable and marks only the real document end', () => {
    const view = createView('```ts\nshort\nlonger\tcode\n');
    const canvas = view.input.closest(
      '.source-window__canvas',
    ) as HTMLElement;

    expect(canvas.style.getPropertyValue('--md-code-inline-size')).toBe(
      'calc(12ch + 24px)',
    );
    expect(
      view
        .getVisibleLineElements()
        .filter((line) => line.classList.contains('md-line--document-end'))
        .map((line) => line.dataset.line),
    ).toEqual(['4']);

    view.setSource('```ts\nshort\nlonger\tcode\n```\nafter');

    expect(
      view
        .getVisibleLineElements()
        .filter((line) => line.classList.contains('md-line--document-end'))
        .map((line) => line.dataset.line),
    ).toEqual(['5']);
  });

  it('estimates embedded inline images before their row is measured', () => {
    const image = serializeImageDirective({
      align: 'left',
      alt: 'Tall',
      assetId: '123e4567-e89b-42d3-a456-426614174000',
      caption: '',
      height: 960,
      instanceId: '223e4567-e89b-42d3-a456-426614174001',
      margin: 8,
      maxWidth: 1_200,
      minWidth: 96,
      mode: 'inline',
      path: 'Media/tall.png',
      positionLock: false,
      ratioLock: true,
      version: 2,
      width: 120,
    });
    const view = createView(`before ${image} after\nnext`);
    const canvas = view.input.closest(
      '.source-window__canvas',
    ) as HTMLElement;

    expect(Number.parseFloat(canvas.style.height)).toBeGreaterThan(900);
  });

  it('keeps a wrapped image anchor mounted across its visible float island', () => {
    const image = serializeImageDirective({
      align: 'left',
      alt: 'Tall wrap',
      assetId: '123e4567-e89b-42d3-a456-426614174000',
      caption: '',
      height: 4_096,
      instanceId: '223e4567-e89b-42d3-a456-426614174001',
      margin: 8,
      maxWidth: 1_200,
      minWidth: 96,
      mode: 'wrap',
      path: 'Media/tall-wrap.png',
      positionLock: false,
      ratioLock: true,
      version: 2,
      width: 120,
    });
    const lines = Array.from(
      { length: 500 },
      (_, index) => (index === 100 ? image : `line ${index}`),
    );
    const view = createView(lines.join('\n'));
    const root = view.input.closest(
      '.markdown-source__editor',
    ) as HTMLDivElement;

    root.scrollTop = 24 * 220;
    root.dispatchEvent(new Event('scroll'));
    flushFrames();

    expect(
      view.getVisibleLineElements().some((line) => line.dataset.line === '101'),
    ).toBe(true);
    expect(view.getVisibleLineElements().length).toBeLessThanOrEqual(300);
  });

  it('updates ordinary edits incrementally in a 15,000-line document', () => {
    const tail = Array.from(
      { length: 14_999 },
      (_, index) => `line ${index + 1}`,
    ).join('\n');
    let source = `line 0\n${tail}`;
    const view = createView(source);
    const rebuildHeightMap = vi.spyOn(
      view as unknown as { rebuildHeightMap(): void },
      'rebuildHeightMap',
    );

    for (let index = 1; index <= 10; index += 1) {
      source = `edited ${'x'.repeat(index)}\n${tail}`;
      view.setSource(source);
    }

    expect(rebuildHeightMap).not.toHaveBeenCalled();
    expect(view.getModel().lines).toHaveLength(15_000);
    expect(view.getModel().lines[0]?.source).toBe('edited xxxxxxxxxx');
    expect(view.getVisibleLineElements().length).toBeLessThanOrEqual(300);
  });

  it('recycles line elements across disjoint viewport windows', () => {
    const source = Array.from(
      { length: 1_000 },
      (_, index) => `line ${index}`,
    ).join('\n');
    const view = createView(source);
    const root = view.input.closest(
      '.markdown-source__editor',
    ) as HTMLDivElement;

    root.scrollTop = 24 * 250;
    root.dispatchEvent(new Event('scroll'));
    flushFrames();
    const before = new Set(view.getVisibleLineElements());

    root.scrollTop = 24 * 750;
    root.dispatchEvent(new Event('scroll'));
    flushFrames();
    const after = view.getVisibleLineElements();

    expect(after.every((line) => before.has(line))).toBe(true);
    expect(after[0]?.textContent).toContain(
      `line ${Number(after[0]?.dataset.line) - 1}`,
    );
  });

  it('preserves measured heights for unchanged lines on an incremental edit', () => {
    const view = createView('first\nsecond\nthird');
    const second = view.getVisibleLineElements()[1]!;
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 400, 48),
    );
    ResizeObserverStub.instances[1]!.trigger();
    flushFrames();
    const canvas = view.input.closest(
      '.source-window__canvas',
    ) as HTMLElement;
    const rebuildHeightMap = vi.spyOn(
      view as unknown as { rebuildHeightMap(): void },
      'rebuildHeightMap',
    );

    view.setSource('changed\nsecond\nthird');

    expect(rebuildHeightMap).not.toHaveBeenCalled();
    expect(canvas.style.height).toBe('96px');
    expect(view.getVisibleLineElements()[1]).toBe(second);
  });

  it('preserves the scroll anchor when an edited line above it grows', () => {
    const source = Array.from(
      { length: 500 },
      (_, index) => `line ${index}`,
    ).join('\n');
    const view = createView(source);
    const root = view.input.closest(
      '.markdown-source__editor',
    ) as HTMLDivElement;
    const canvas = view.input.closest(
      '.source-window__canvas',
    ) as HTMLElement;
    root.scrollTop = 24 * 250;
    root.dispatchEvent(new Event('scroll'));
    flushFrames();
    const previousScrollTop = root.scrollTop;
    const previousHeight = Number.parseFloat(canvas.style.height);
    const rebuildHeightMap = vi.spyOn(
      view as unknown as { rebuildHeightMap(): void },
      'rebuildHeightMap',
    );

    view.setSource(`${'x'.repeat(400)}\n${source.slice(source.indexOf('\n') + 1)}`);

    const heightDelta =
      Number.parseFloat(canvas.style.height) - previousHeight;
    expect(rebuildHeightMap).not.toHaveBeenCalled();
    expect(heightDelta).toBeGreaterThan(0);
    expect(root.scrollTop - previousScrollTop).toBeCloseTo(heightDelta);
  });

  it('falls back to a full height rebuild for structural source changes', () => {
    const image = serializeImageDirective({
      align: 'left',
      alt: 'Inline',
      assetId: '123e4567-e89b-42d3-a456-426614174000',
      caption: '',
      height: 120,
      instanceId: '223e4567-e89b-42d3-a456-426614174001',
      margin: 8,
      maxWidth: 1_200,
      minWidth: 96,
      mode: 'inline',
      path: 'Media/inline.png',
      positionLock: false,
      ratioLock: true,
      version: 2,
      width: 120,
    });
    const cases = [
      ['plain\nnext', 'plain\ninserted\nnext'],
      ['plain\nnext', '# Heading\nnext'],
      ['```\ncode\n```', '```\nchanged\n```'],
      [`before ${image}\nnext`, `changed ${image}\nnext`],
    ] as const;

    for (const [before, after] of cases) {
      const view = createView(before);
      const rebuildHeightMap = vi.spyOn(
        view as unknown as { rebuildHeightMap(): void },
        'rebuildHeightMap',
      );

      view.setSource(after);

      expect(rebuildHeightMap).toHaveBeenCalledOnce();
    }
  });

  it('falls back to a full rebuild inside an active wrapped-image float', () => {
    const image = serializeImageDirective({
      align: 'left',
      alt: 'Tall wrap',
      assetId: '123e4567-e89b-42d3-a456-426614174000',
      caption: '',
      height: 960,
      instanceId: '223e4567-e89b-42d3-a456-426614174001',
      margin: 8,
      maxWidth: 1_200,
      minWidth: 96,
      mode: 'wrap',
      path: 'Media/tall-wrap.png',
      positionLock: false,
      ratioLock: true,
      version: 2,
      width: 120,
    });
    const source = `${image}\ninside float\nnext`;
    const view = createView(source);
    const rebuildHeightMap = vi.spyOn(
      view as unknown as { rebuildHeightMap(): void },
      'rebuildHeightMap',
    );

    view.setSource(`${image}\nchanged inside float\nnext`);

    expect(rebuildHeightMap).toHaveBeenCalledOnce();
  });
});
