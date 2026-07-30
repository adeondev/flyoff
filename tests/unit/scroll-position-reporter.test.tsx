// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
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
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports the current position immediately and settles after scroll stays idle', () => {
    vi.useFakeTimers();
    const onScroll = vi.fn();
    const { getByTestId } = render(<ScrollReporter onScroll={onScroll} />);
    const scroll = getByTestId('scroll');

    scroll.scrollTop = 20;
    fireEvent.scroll(scroll);
    scroll.scrollTop = 48;
    fireEvent.scroll(scroll);
    expect(onScroll).toHaveBeenCalledTimes(2);
    expect(onScroll).toHaveBeenLastCalledWith(48, false);

    fireEvent(scroll, new Event('scrollend', { bubbles: true }));
    expect(onScroll).toHaveBeenLastCalledWith(48, false);
    vi.advanceTimersByTime(79);
    expect(onScroll).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(onScroll).toHaveBeenLastCalledWith(48, true);
  });

  it('does not settle between consecutive scripted scroll frames', () => {
    vi.useFakeTimers();
    const onScroll = vi.fn();
    const { getByTestId } = render(<ScrollReporter onScroll={onScroll} />);
    const scroll = getByTestId('scroll');

    for (let index = 1; index <= 10; index += 1) {
      scroll.scrollTop = index * 20;
      fireEvent.scroll(scroll);
      fireEvent(scroll, new Event('scrollend', { bubbles: true }));
      vi.advanceTimersByTime(16);
    }

    expect(onScroll.mock.calls.some(([, settled]) => settled)).toBe(false);
    vi.advanceTimersByTime(80);
    expect(onScroll).toHaveBeenLastCalledWith(200, true);
  });
});
