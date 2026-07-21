// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useScrollPositionReporter } from '../../src/renderer/hooks/use-scroll-position-reporter';

function ScrollReporter({
  onScroll,
}: {
  onScroll: (scrollTop: number, settled?: boolean) => void;
}) {
  const reporter = useScrollPositionReporter(onScroll);
  return (
    <div
      data-testid="scroll"
      onScroll={(event) =>
        reporter.reportScroll(event.currentTarget.scrollTop)
      }
      onScrollEnd={(event) =>
        reporter.reportScrollEnd(event.currentTarget.scrollTop)
      }
    />
  );
}

describe('scroll position reporter', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports at most once per frame and settles immediately', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestAnimationFrame',
      (callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (handle: number) =>
      window.clearTimeout(handle),
    );
    const onScroll = vi.fn();
    const { getByTestId } = render(<ScrollReporter onScroll={onScroll} />);
    const scroll = getByTestId('scroll');

    scroll.scrollTop = 20;
    fireEvent.scroll(scroll);
    scroll.scrollTop = 48;
    fireEvent.scroll(scroll);
    expect(onScroll).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);
    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(onScroll).toHaveBeenLastCalledWith(48, false);

    fireEvent(scroll, new Event('scrollend', { bubbles: true }));
    expect(onScroll).toHaveBeenLastCalledWith(48, true);
  });
});
