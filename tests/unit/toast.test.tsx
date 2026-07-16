// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastHost } from '../../src/renderer/components/feedback/ToastHost';
import {
  EMPTY_TOAST_QUEUE,
  toastQueueReducer,
  type ToastDescriptor,
} from '../../src/renderer/components/feedback/toast-state';

function toast(index: number, tone: 'info' | 'error' = 'error'): ToastDescriptor {
  return {
    id: String(index),
    message: `Message ${index}`,
    tone,
    duration: tone === 'error' ? 8_000 : 5_000,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('toast queue', () => {
  it('shows four newest notifications and promotes queued work deterministically', () => {
    let state = EMPTY_TOAST_QUEUE;
    for (let index = 1; index <= 6; index += 1) {
      state = toastQueueReducer(state, {
        type: 'enqueue',
        toast: toast(index),
      });
    }

    expect(state.visible.map(({ id }) => id)).toEqual(['4', '3', '2', '1']);
    expect(state.queued.map(({ id }) => id)).toEqual(['5', '6']);
    state = toastQueueReducer(state, { type: 'dismiss', id: '2' });
    expect(state.visible.map(({ id }) => id)).toEqual(['5', '4', '3', '1']);
    expect(state.queued.map(({ id }) => id)).toEqual(['6']);
  });

  it('uses ARIA tone, pauses on hover and closes immediately by button', async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ToastHost
        ariaLabel="Notifications"
        closeLabel="Dismiss"
        onDismiss={onDismiss}
        toasts={[toast(1), toast(2, 'info')]}
      />,
    );

    const error = screen.getByRole('alert');
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.mouseEnter(error);
    await act(async () => vi.advanceTimersByTimeAsync(9_000));
    expect(onDismiss).not.toHaveBeenCalledWith('1');
    expect(onDismiss).toHaveBeenCalledWith('2');
    fireEvent.mouseLeave(error);
    await act(async () => vi.advanceTimersByTimeAsync(8_100));
    expect(onDismiss).toHaveBeenCalledWith('1');

    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
    expect(onDismiss).toHaveBeenCalledTimes(3);
  });
});
