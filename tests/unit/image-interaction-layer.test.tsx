// @vitest-environment jsdom

import { useLayoutEffect, useRef } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImageInteractionLayer } from '../../src/renderer/projects/ImageInteractionLayer';
import {
  beginImageDrag,
  ImageDragOverlay,
} from '../../src/renderer/projects/image-drag-coordinator';
import { MEDIA_ASSET_TRANSFER } from '../../src/renderer/projects/media-transfer';
import { reconcileSource } from '../../src/renderer/projects/source-renderer';
import type { Translate } from '../../src/renderer/pages/page-types';

const translate: Translate = (key) => key;
const imageSource =
  '::image[Lua]{v=2 instance=223e4567-e89b-42d3-a456-426614174001 asset=123e4567-e89b-42d3-a456-426614174000 path="Media/Lua.png" mode=block align=center width=320 height=180 min=96 max=1200 margin=12 ratioLock=true positionLock=false caption=""}';

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => undefined,
  };
}

function Harness({
  onInsertMediaAsset,
  onOperation,
  source = `before\n${imageSource}\nafter`,
  visibleLines,
}: {
  onInsertMediaAsset?: React.ComponentProps<
    typeof ImageInteractionLayer
  >['onInsertMediaAsset'];
  onOperation: React.ComponentProps<
    typeof ImageInteractionLayer
  >['onOperation'];
  source?: string;
  visibleLines?: readonly [number, number];
}) {
  const editorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (editorRef.current) {
      reconcileSource(editorRef.current, source);
      if (visibleLines) {
        for (const line of Array.from(editorRef.current.children)) {
          const number = Number((line as HTMLElement).dataset.line);
          if (number < visibleLines[0] || number > visibleLines[1]) {
            line.remove();
          }
        }
      }
    }
  }, [source, visibleLines]);

  return (
    <div data-testid="stage">
      <div
        className="markdown-source__editor"
        data-testid="editor"
        ref={editorRef}
      />
      <ImageInteractionLayer
        editorRef={editorRef}
        onInsertMediaAsset={onInsertMediaAsset}
        onOperation={onOperation}
        onSelectionChange={vi.fn()}
        projectId="323e4567-e89b-42d3-a456-426614174002"
        readOnly={false}
        translate={translate}
      />
      <ImageDragOverlay />
    </div>
  );
}

describe('image interaction layer', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    Object.defineProperties(HTMLElement.prototype, {
      setPointerCapture: {
        configurable: true,
        value: vi.fn(),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('previews, cancels and commits mouse movement between blocks', () => {
    const onOperation = vi.fn();
    render(<Harness onOperation={onOperation} />);
    const stage = screen.getByTestId('stage');
    const editor = screen.getByTestId('editor');
    const lines = editor.querySelectorAll<HTMLElement>('.md-line');
    const host = editor.querySelector<HTMLElement>('.md-source-image__host');
    expect(host).not.toBeNull();

    stage.getBoundingClientRect = () => rect(0, 0, 640, 400);
    editor.getBoundingClientRect = () => rect(0, 0, 640, 300);
    lines[0]!.getBoundingClientRect = () => rect(0, 0, 640, 30);
    lines[1]!.getBoundingClientRect = () => rect(0, 30, 640, 200);
    lines[2]!.getBoundingClientRect = () => rect(0, 230, 640, 30);
    host!.getBoundingClientRect = () => rect(160, 40, 320, 180);

    fireEvent.pointerDown(host!, {
      button: 0,
      clientX: 320,
      clientY: 120,
      pointerId: 1,
    });
    fireEvent.pointerUp(host!, {
      clientX: 320,
      clientY: 120,
      pointerId: 1,
    });
    expect(document.querySelector('.markdown-image-overlay')).not.toBeNull();

    fireEvent.pointerDown(host!, {
      button: 0,
      clientX: 320,
      clientY: 120,
      pointerId: 2,
    });
    fireEvent.pointerMove(host!, {
      clientX: 500,
      clientY: 275,
      pointerId: 2,
    });
    expect(
      host!.closest('.md-source-image')?.classList.contains(
        'md-source-image--drag-origin',
      ),
    ).toBe(true);
    expect(
      document.querySelector('.image-drag-ghost'),
    ).not.toBeNull();
    expect(
      document.querySelector('.markdown-image-drop-target'),
    ).not.toBeNull();
    expect(
      editor
        .querySelector('.md-line--image-drop')
        ?.getAttribute('data-image-drop-align'),
    ).toBe('right');

    fireEvent.pointerCancel(host!, { pointerId: 2 });
    expect(editor.querySelector('.md-line--image-drop')).toBeNull();
    expect(
      host!.closest('.md-source-image')?.classList.contains(
        'md-source-image--drag-origin',
      ),
    ).toBe(false);
    expect(onOperation).not.toHaveBeenCalled();

    fireEvent.pointerDown(host!, {
      button: 0,
      clientX: 320,
      clientY: 120,
      pointerId: 3,
    });
    fireEvent.pointerMove(host!, {
      clientX: 500,
      clientY: 275,
      pointerId: 3,
    });
    fireEvent.pointerUp(host!, {
      clientX: 500,
      clientY: 275,
      pointerId: 3,
    });

    expect(onOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'move',
        sourceRange: expect.objectContaining({ start: 7 }),
        intent: {
          kind: 'block-boundary',
          align: 'right',
          boundaryIndex: 3,
        },
      }),
    );
    expect(editor.querySelector('.md-line--image-drop')).toBeNull();
  });

  it('coalesces pointer movement and preserves an unchanged destination', async () => {
    let nextFrameId = 0;
    let frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      nextFrameId += 1;
      return nextFrameId;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const flushFrame = (): void => {
      const current = frames;
      frames = [];
      for (const callback of current) {
        callback(performance.now());
      }
    };

    render(<Harness onOperation={vi.fn()} />);
    const stage = screen.getByTestId('stage');
    const editor = screen.getByTestId('editor');
    const lines = editor.querySelectorAll<HTMLElement>('.md-line');
    const contents =
      editor.querySelectorAll<HTMLElement>('.md-line__content');
    const host = editor.querySelector<HTMLElement>('.md-source-image__host')!;
    let lineMeasurements = 0;
    stage.getBoundingClientRect = () => rect(0, 0, 640, 400);
    editor.getBoundingClientRect = () => rect(0, 0, 640, 300);
    lines.forEach((line, index) => {
      line.getBoundingClientRect = () => {
        lineMeasurements += 1;
        return rect(0, index * 30, 640, 30);
      };
    });
    contents.forEach((content, index) => {
      content.getBoundingClientRect = () =>
        rect(60, index * 30, 560, 30);
    });
    host.getBoundingClientRect = () => rect(160, 40, 320, 180);
    act(flushFrame);

    fireEvent.pointerDown(host, {
      button: 0,
      clientX: 320,
      clientY: 120,
      pointerId: 20,
    });
    for (const clientX of [480, 490, 500]) {
      fireEvent.pointerMove(host, {
        clientX,
        clientY: 275,
        pointerId: 20,
      });
    }
    expect(
      editor.querySelector('.md-line--image-drop'),
    ).toBeNull();
    act(flushFrame);

    const target = editor.querySelector('.md-line--image-drop');
    expect(target).not.toBeNull();
    expect(lineMeasurements).toBe(lines.length);
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(editor, {
      attributes: true,
      subtree: true,
    });

    for (const clientX of [501, 502, 503]) {
      fireEvent.pointerMove(host, {
        clientX,
        clientY: 275,
        pointerId: 20,
      });
    }
    act(flushFrame);
    await Promise.resolve();

    expect(editor.querySelector('.md-line--image-drop')).toBe(target);
    expect(lineMeasurements).toBe(lines.length);
    expect(mutations).toHaveLength(0);
    observer.disconnect();

    fireEvent.scroll(editor);
    act(flushFrame);
    expect(lineMeasurements).toBe(lines.length * 2);

    fireEvent.pointerCancel(host, { pointerId: 20 });
  });

  it('maps a sparse virtual window to global block boundaries', () => {
    const onOperation = vi.fn();
    const prefix = Array.from(
      { length: 1_000 },
      (_, index) => `before ${index}`,
    );
    const source = [...prefix, imageSource, 'after'].join('\n');
    render(
      <Harness
        onOperation={onOperation}
        source={source}
        visibleLines={[1_000, 1_002]}
      />,
    );
    const stage = screen.getByTestId('stage');
    const editor = screen.getByTestId('editor');
    const lines = editor.querySelectorAll<HTMLElement>('.md-line');
    const contents =
      editor.querySelectorAll<HTMLElement>('.md-line__content');
    const host = editor.querySelector<HTMLElement>('.md-source-image__host')!;

    expect([...lines].map((line) => line.dataset.line)).toEqual([
      '1000',
      '1001',
      '1002',
    ]);
    stage.getBoundingClientRect = () => rect(0, 0, 640, 400);
    editor.getBoundingClientRect = () => rect(0, 0, 640, 300);
    lines[0]!.getBoundingClientRect = () => rect(0, 0, 640, 30);
    lines[1]!.getBoundingClientRect = () => rect(0, 30, 640, 200);
    lines[2]!.getBoundingClientRect = () => rect(0, 230, 640, 30);
    contents.forEach((content, index) => {
      content.getBoundingClientRect = () =>
        rect(60, index === 2 ? 230 : index * 30, 560, 30);
    });
    host.getBoundingClientRect = () => rect(160, 40, 320, 180);

    fireEvent.pointerDown(host, {
      button: 0,
      clientX: 320,
      clientY: 120,
      pointerId: 51,
    });
    fireEvent.pointerMove(host, {
      clientX: 500,
      clientY: 275,
      pointerId: 51,
    });
    fireEvent.pointerUp(host, {
      clientX: 500,
      clientY: 275,
      pointerId: 51,
    });

    expect(onOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          boundaryIndex: 1_001,
          kind: 'block-boundary',
        }),
        sourceRange: expect.objectContaining({
          start: source.indexOf(imageSource),
        }),
        type: 'move',
      }),
    );
  });

  it('selects an image when a later text line owns the hit target', () => {
    render(<Harness onOperation={vi.fn()} />);
    const editor = screen.getByTestId('editor');
    const lines = editor.querySelectorAll<HTMLElement>('.md-line');
    const host = editor.querySelector<HTMLElement>('.md-source-image__host')!;

    editor.getBoundingClientRect = () => rect(0, 0, 640, 300);
    host.getBoundingClientRect = () => rect(20, 40, 320, 180);

    fireEvent.pointerDown(lines[2]!, {
      button: 0,
      clientX: 120,
      clientY: 100,
      pointerId: 7,
    });
    fireEvent.pointerUp(editor, {
      clientX: 120,
      clientY: 100,
      pointerId: 7,
    });

    expect(document.querySelector('.markdown-image-overlay')).not.toBeNull();
  });

  it('turns deleted library assets into missing markers immediately', () => {
    render(<Harness onOperation={vi.fn()} />);
    const image = screen
      .getByTestId('editor')
      .querySelector<HTMLElement>('.md-source-image')!;
    const content = image.querySelector<HTMLImageElement>('img')!;

    window.dispatchEvent(
      new CustomEvent('flyoff:media-library-changed', {
        detail: {
          removedAssetIds: ['123e4567-e89b-42d3-a456-426614174000'],
        },
      }),
    );

    expect(image.classList.contains('md-source-image--missing')).toBe(true);
    expect(content.hasAttribute('src')).toBe(false);
  });

  it('uses the shared ghost and destination for gallery drops', async () => {
    const onInsertMediaAsset = vi.fn().mockResolvedValue(true);
    render(
      <Harness
        onInsertMediaAsset={onInsertMediaAsset}
        onOperation={vi.fn()}
      />,
    );
    const editor = screen.getByTestId('editor');
    const lines = editor.querySelectorAll<HTMLElement>('.md-line');
    const contents = editor.querySelectorAll<HTMLElement>('.md-line__content');
    editor.getBoundingClientRect = () => rect(0, 0, 640, 300);
    lines.forEach((line, index) => {
      line.getBoundingClientRect = () => rect(0, index * 30, 640, 30);
    });
    contents.forEach((content, index) => {
      content.getBoundingClientRect = () =>
        rect(60, index * 30, 560, 30);
    });
    const instanceId = '423e4567-e89b-42d3-a456-426614174003';
    beginImageDrag(
      {
        assetId: '523e4567-e89b-42d3-a456-426614174004',
        ghostHeight: 90,
        ghostWidth: 120,
        instanceId,
        projectId: '323e4567-e89b-42d3-a456-426614174002',
        source: 'gallery',
        sourceUrl: 'flyoff-media://asset/project/asset',
        targetHeight: 180,
        targetWidth: 320,
      },
      { x: 100, y: 100 },
      { height: 78, left: 10, top: 10, width: 100 },
    );
    const transfer = {
      dropEffect: 'none',
      types: [MEDIA_ASSET_TRANSFER],
    };

    fireEvent.dragOver(editor, {
      clientX: 100,
      clientY: 75,
      dataTransfer: transfer,
    });
    expect(
      document.querySelector('.markdown-image-drop-target'),
    ).not.toBeNull();

    fireEvent.drop(editor, {
      clientX: 100,
      clientY: 75,
      dataTransfer: transfer,
    });
    await vi.waitFor(() =>
      expect(onInsertMediaAsset).toHaveBeenCalledWith(
        '523e4567-e89b-42d3-a456-426614174004',
        '323e4567-e89b-42d3-a456-426614174002',
        expect.any(Number),
        instanceId,
        { align: 'center', mode: 'block' },
      ),
    );
  });
});
