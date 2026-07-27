// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TwineThoughtPanel } from '../../src/renderer/twine/TwineThoughtPanel';
import type { TwineMessage } from '../../src/renderer/twine/twine-types';
import type { TranslationKey } from '../../src/shared/i18n';

let resizeCallback: ResizeObserverCallback;
let nextFrameId = 0;
let frames = new Map<number, FrameRequestCallback>();

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

function flushFrames(limit = 100): void {
  let count = 0;
  while (frames.size > 0 && count < limit) {
    const pending = [...frames.entries()];
    frames.clear();
    act(() => {
      for (const [, callback] of pending) {
        callback(count * 16.67);
      }
    });
    count += 1;
  }
}

function message(thought = 'Considering the request'): TwineMessage {
  return {
    attachments: [],
    id: 'assistant-1',
    kind: 'assistant',
    status: 'streaming',
    streamRequestId: 'request-1',
    text: '',
    thinkingStartedAt: Date.now() - 2_000,
    thought,
  };
}

describe('Twine thought panel', () => {
  beforeEach(() => {
    frames = new Map();
    nextFrameId = 0;
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrameId += 1;
      frames.set(nextFrameId, callback);
      return nextFrameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('collapses on the first visible answer and remains manually accessible', () => {
    const translate = (key: TranslationKey) => key;
    const view = render(
      <TwineThoughtPanel
        answerVisible={false}
        cacheKey="conversation:assistant-1:thought"
        message={message()}
        translate={translate}
      />,
    );
    expect(view.container.querySelector('details')).toBeNull();
    expect(
      view.container.querySelector('.twine-thought--active'),
    ).toBeTruthy();
    expect(screen.queryByText('twine.thinkingNow')).toBeNull();

    view.rerender(
      <TwineThoughtPanel
        answerVisible
        cacheKey="conversation:assistant-1:thought"
        message={{ ...message(), text: 'Answer', thinkingDurationMs: 2_000 }}
        translate={translate}
      />,
    );
    const details = view.container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(
      details.querySelector('.twine-thought__reveal'),
    ).toBeTruthy();
    expect(screen.getByText('twine.thoughtFor 2s')).toBeTruthy();

    fireEvent.click(details.querySelector('summary')!);
    expect(details.open).toBe(true);
    view.rerender(
      <TwineThoughtPanel
        answerVisible
        cacheKey="conversation:assistant-1:thought"
        message={{
          ...message('Considering the request carefully'),
          text: 'Answer',
          thinkingDurationMs: 2_000,
        }}
        translate={translate}
      />,
    );
    expect(details.open).toBe(true);
  });

  it('follows thought growth, pauses on manual upward scroll, and resumes at the end', () => {
    const view = render(
      <TwineThoughtPanel
        answerVisible={false}
        cacheKey="conversation:assistant-1:thought-scroll"
        message={message()}
        translate={(key: TranslationKey) => key}
      />,
    );
    const scroller = view.container.querySelector<HTMLElement>(
      '.twine-thought__content',
    )!;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
    });

    act(() => resizeCallback([], {} as ResizeObserver));
    flushFrames();
    expect(scroller.scrollTop).toBe(500);

    fireEvent.wheel(scroller, { deltaY: -100 });
    scroller.scrollTop = 120;
    fireEvent.scroll(scroller);
    act(() => resizeCallback([], {} as ResizeObserver));
    flushFrames();
    expect(scroller.scrollTop).toBe(120);

    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    act(() => resizeCallback([], {} as ResizeObserver));
    flushFrames();
    expect(scroller.scrollTop).toBe(500);
  });
});
