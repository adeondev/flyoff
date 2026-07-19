// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  proportionalScrollTop,
  useSplitScrollSync,
} from '../../src/renderer/projects/use-split-scroll-sync';

function dimensions(
  element: HTMLElement,
  values: { clientHeight: number; scrollHeight: number; scrollTop: number },
): void {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: values.clientHeight },
    scrollHeight: { configurable: true, value: values.scrollHeight },
    scrollTop: { configurable: true, writable: true, value: values.scrollTop },
  });
}

describe('split editor scroll synchronization', () => {
  let frames: FrameRequestCallback[];
  let resize: ResizeObserverCallback | undefined;

  beforeEach(() => {
    frames = [];
    resize = undefined;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }

        disconnect(): void {}

        observe(): void {}

        unobserve(): void {}
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  function flushFrame(): void {
    const pending = frames.splice(0);
    act(() => {
      for (const callback of pending) {
        callback(performance.now());
      }
    });
  }

  it('maps scroll positions proportionally and handles empty ranges', () => {
    expect(
      proportionalScrollTop(
        { clientHeight: 500, scrollHeight: 1_500, scrollTop: 250 },
        { clientHeight: 400, scrollHeight: 2_400 },
      ),
    ).toBe(500);
    expect(
      proportionalScrollTop(
        { clientHeight: 500, scrollHeight: 500, scrollTop: 0 },
        { clientHeight: 400, scrollHeight: 2_400 },
      ),
    ).toBe(0);
  });

  it('lets the reading pane diverge until the next source scroll', () => {
    const source = document.createElement('div');
    const reading = document.createElement('div');
    dimensions(source, {
      clientHeight: 500,
      scrollHeight: 1_500,
      scrollTop: 250,
    });
    dimensions(reading, {
      clientHeight: 400,
      scrollHeight: 2_400,
      scrollTop: 0,
    });
    const sourceRef = { current: source };
    const readingRef = { current: reading };
    const { result, rerender } = renderHook(
      ({ content }) =>
        useSplitScrollSync({
          content,
          mode: 'split',
          readingRef,
          sourceRef,
        }),
      { initialProps: { content: 'one' } },
    );

    flushFrame();
    expect(reading.scrollTop).toBe(500);

    act(() => {
      result.current.handleReadingIntent();
      reading.scrollTop = 1_350;
      source.scrollTop = 800;
      rerender({ content: 'two' });
    });
    flushFrame();
    expect(reading.scrollTop).toBe(1_350);

    act(() => result.current.handleSourceScroll());
    flushFrame();
    expect(reading.scrollTop).toBe(1_600);
  });

  it('realigns after a source-driven content resize', () => {
    const source = document.createElement('div');
    const reading = document.createElement('div');
    dimensions(source, {
      clientHeight: 500,
      scrollHeight: 1_500,
      scrollTop: 500,
    });
    dimensions(reading, {
      clientHeight: 500,
      scrollHeight: 1_500,
      scrollTop: 0,
    });
    renderHook(() =>
      useSplitScrollSync({
        content: 'content',
        mode: 'split',
        readingRef: { current: reading },
        sourceRef: { current: source },
      }),
    );
    flushFrame();
    expect(reading.scrollTop).toBe(500);

    Object.defineProperty(reading, 'scrollHeight', {
      configurable: true,
      value: 2_500,
    });
    act(() => resize?.([], {} as ResizeObserver));
    flushFrame();
    expect(reading.scrollTop).toBe(1_000);
  });

  it('leaves both panes independent when synchronization is disabled', () => {
    const source = document.createElement('div');
    const reading = document.createElement('div');
    dimensions(source, {
      clientHeight: 500,
      scrollHeight: 1_500,
      scrollTop: 500,
    });
    dimensions(reading, {
      clientHeight: 500,
      scrollHeight: 2_500,
      scrollTop: 420,
    });
    const { result } = renderHook(() =>
      useSplitScrollSync({
        content: 'content',
        enabled: false,
        mode: 'split',
        readingRef: { current: reading },
        sourceRef: { current: source },
      }),
    );

    flushFrame();
    act(() => result.current.handleSourceScroll());
    flushFrame();

    expect(reading.scrollTop).toBe(420);
  });
});
