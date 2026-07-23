// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TwineMarkdown } from '../../src/renderer/twine/TwineMarkdown';

let frameId = 0;
let frameTime = 0;
let frames = new Map<number, FrameRequestCallback>();

function runFrame(elapsed = 16.67): void {
  const entry = frames.entries().next().value as
    | [number, FrameRequestCallback]
    | undefined;
  expect(entry).toBeTruthy();
  if (!entry) {
    return;
  }
  frames.delete(entry[0]);
  frameTime += elapsed;
  act(() => entry[1](frameTime));
}

function drainText(element: Element, expected: string, limit = 240): number {
  let count = 0;
  while (element.textContent !== expected && count < limit) {
    runFrame();
    count += 1;
  }
  expect(element.textContent).toBe(expected);
  return count;
}

describe('Twine streaming Markdown', () => {
  beforeEach(() => {
    frameId = 0;
    frameTime = 0;
    frames = new Map();
    vi.spyOn(performance, 'now').mockImplementation(() => frameTime);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('adapts the reveal rate to the measured API throughput', () => {
    const slow = render(<TwineMarkdown source="" streaming />);
    frameTime = 500;
    slow.rerender(<TwineMarkdown source="abcdefghij" streaming />);
    const slowMarkdown = slow.container.querySelector('.twine-markdown')!;
    const slowFrames = drainText(slowMarkdown, 'abcdefghij');
    slow.unmount();

    frames.clear();
    frameTime = 0;
    const fast = render(<TwineMarkdown source="" streaming />);
    frameTime = 20;
    fast.rerender(<TwineMarkdown source="abcdefghij" streaming />);
    const fastMarkdown = fast.container.querySelector('.twine-markdown')!;
    const fastFrames = drainText(fastMarkdown, 'abcdefghij');

    expect(fastFrames).toBeLessThan(slowFrames);
  });

  it('never splits emoji or combining graphemes', () => {
    const expected = 'A\u{1F469}\u200D\u{1F4BB}e\u0301';
    const validPrefixes = new Set([
      '',
      'A',
      'A\u{1F469}\u200D\u{1F4BB}',
      expected,
    ]);
    const { container } = render(
      <TwineMarkdown source={expected} streaming />,
    );
    const markdown = container.querySelector('.twine-markdown')!;

    while (markdown.textContent !== expected) {
      runFrame();
      expect(validPrefixes.has(markdown.textContent ?? '')).toBe(true);
    }
  });

  it('accepts new chunks while the existing queue is draining', () => {
    const { container, rerender } = render(
      <TwineMarkdown source="abcdefgh" streaming />,
    );
    const markdown = container.querySelector('.twine-markdown')!;
    runFrame();
    const beforeAppend = markdown.textContent ?? '';

    frameTime += 40;
    rerender(<TwineMarkdown source="abcdefghijklmnop" streaming />);
    drainText(markdown, 'abcdefghijklmnop');

    expect(beforeAppend.length).toBeGreaterThan(0);
  });

  it('drains the queue after done without revealing the remainder at once', () => {
    const { container, rerender } = render(
      <TwineMarkdown source="abcdefghijklmnop" streaming />,
    );
    const markdown = container.querySelector('.twine-markdown')!;
    runFrame();
    const partial = markdown.textContent ?? '';

    rerender(<TwineMarkdown source="abcdefghijklmnop" streaming={false} />);
    expect(markdown.textContent).toBe(partial);
    expect(partial).not.toBe('abcdefghijklmnop');
    drainText(markdown, 'abcdefghijklmnop');
  });

  it('formats the visible prefix as Markdown while it is revealed', () => {
    const { container } = render(
      <TwineMarkdown source="**bold**" streaming />,
    );
    const markdown = container.querySelector('.twine-markdown')!;

    drainText(markdown, 'bold');
    expect(markdown.querySelector('strong')?.textContent).toBe('bold');
  });

  it('reports the first grapheme only when it becomes visible', () => {
    const onFirstVisibleGrapheme = vi.fn();
    const { container } = render(
      <TwineMarkdown
        onFirstVisibleGrapheme={onFirstVisibleGrapheme}
        source="answer"
        streaming
      />,
    );

    expect(onFirstVisibleGrapheme).not.toHaveBeenCalled();
    runFrame();
    expect(container.querySelector('.twine-markdown')?.textContent).not.toBe('');
    expect(onFirstVisibleGrapheme).toHaveBeenCalledOnce();
    drainText(container.querySelector('.twine-markdown')!, 'answer');
    expect(onFirstVisibleGrapheme).toHaveBeenCalledOnce();
  });

  it('keeps typewriter progress when the message remounts in another pane', () => {
    const first = render(
      <TwineMarkdown cacheKey="message-1:text" source="abcdefghij" streaming />,
    );
    const firstMarkdown = first.container.querySelector('.twine-markdown')!;
    runFrame();
    const visible = firstMarkdown.textContent ?? '';
    first.unmount();

    const second = render(
      <TwineMarkdown cacheKey="message-1:text" source="abcdefghij" streaming />,
    );
    const secondMarkdown = second.container.querySelector('.twine-markdown')!;
    expect(secondMarkdown.textContent).toBe(visible);
    drainText(secondMarkdown, 'abcdefghij');
  });

  it('shows complete content immediately with reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { container } = render(
      <TwineMarkdown source="**ready**" streaming />,
    );

    expect(container.querySelector('strong')?.textContent).toBe('ready');
    expect(frames).toHaveLength(0);
  });
});
