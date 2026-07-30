// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installSourceMouseSelection } from '../../src/renderer/projects/source-interaction';
import { createSourceDocumentModel } from '../../src/renderer/projects/source-document-model';
import {
  registerSourceViewAdapter,
  type SourceViewAdapter,
  type SourceViewSelection,
} from '../../src/renderer/projects/source-engine/source-view-adapter';

interface MouseSelectionFixture {
  dispose: () => void;
  editor: HTMLDivElement;
  frames: Map<number, FrameRequestCallback>;
  runFrame: () => void;
  selection: () => SourceViewSelection;
}

function createFixture(scrollTop = 0): MouseSelectionFixture {
  const editor = document.createElement('div');
  document.body.append(editor);
  Object.defineProperties(editor, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 1_000 },
  });
  editor.scrollTop = scrollTop;
  editor.getBoundingClientRect = () =>
    ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  const model = createSourceDocumentModel('x'.repeat(2_000));
  let selection: SourceViewSelection = {
    direction: 'none',
    end: 0,
    start: 0,
  };
  const adapter: SourceViewAdapter = {
    focus: vi.fn(),
    getModel: () => model,
    readSelection: () => selection,
    sourceCaretRect: () => undefined,
    sourceOffsetAtPoint: (_x, y) =>
      Math.min(model.source.length, Math.round(editor.scrollTop + y)),
    writeSelection: (next) => {
      selection = next;
    },
  };
  const unregister = registerSourceViewAdapter(editor, adapter);

  let nextFrame = 1;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame;
      nextFrame += 1;
      frames.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => {
      frames.delete(id);
    }),
  );

  const removeSelection = installSourceMouseSelection(editor, {
    getContent: () => model.source,
    getSelection: () => selection,
    isComposing: () => false,
    onSelectionChange: (_content, next) => {
      selection = next;
    },
  });

  return {
    dispose: () => {
      removeSelection();
      unregister();
    },
    editor,
    frames,
    runFrame: () => {
      const entry = frames.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      if (!entry) {
        return;
      }
      frames.delete(entry[0]);
      entry[1](performance.now());
    },
    selection: () => selection,
  };
}

function startDrag(editor: HTMLElement): void {
  editor.dispatchEvent(
    new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: 50,
      clientY: 50,
      detail: 1,
    }),
  );
}

function moveDrag(y: number): void {
  document.dispatchEvent(
    new MouseEvent('mousemove', {
      bubbles: true,
      buttons: 1,
      clientX: 50,
      clientY: y,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('source mouse selection autoscroll', () => {
  it('continues scrolling and extending selection without new mouse events', () => {
    const fixture = createFixture();
    startDrag(fixture.editor);
    moveDrag(124);

    expect(fixture.frames.size).toBe(1);
    const initialEnd = fixture.selection().end;
    fixture.runFrame();
    const firstScroll = fixture.editor.scrollTop;
    const firstEnd = fixture.selection().end;

    expect(firstScroll).toBeGreaterThan(0);
    expect(firstEnd).toBeGreaterThan(initialEnd);
    expect(fixture.frames.size).toBe(1);

    fixture.runFrame();
    expect(fixture.editor.scrollTop).toBeGreaterThan(firstScroll);
    expect(fixture.selection().end).toBeGreaterThan(firstEnd);
    expect(fixture.frames.size).toBe(1);
    fixture.dispose();
  });

  it('cancels pending autoscroll when the primary button is released', () => {
    const fixture = createFixture();
    startDrag(fixture.editor);
    moveDrag(124);
    expect(fixture.frames.size).toBe(1);

    document.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        button: 0,
        buttons: 0,
      }),
    );

    expect(fixture.frames.size).toBe(0);
    expect(fixture.editor.scrollTop).toBe(0);
    fixture.dispose();
  });

  it('stops scheduling at the document boundary', () => {
    const fixture = createFixture(900);
    startDrag(fixture.editor);
    moveDrag(124);
    expect(fixture.frames.size).toBe(1);

    fixture.runFrame();

    expect(fixture.editor.scrollTop).toBe(900);
    expect(fixture.frames.size).toBe(0);
    fixture.dispose();
  });

  it('cancels autoscroll on re-entry and during disposal', () => {
    const fixture = createFixture();
    startDrag(fixture.editor);
    moveDrag(124);
    expect(fixture.frames.size).toBe(1);

    moveDrag(40);
    expect(fixture.frames.size).toBe(0);
    expect(fixture.selection()).toEqual({
      direction: 'backward',
      end: 50,
      start: 40,
    });

    moveDrag(124);
    expect(fixture.frames.size).toBe(1);
    fixture.dispose();
    expect(fixture.frames.size).toBe(0);
  });
});
