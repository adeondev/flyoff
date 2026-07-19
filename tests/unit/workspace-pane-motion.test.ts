// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  animateWorkspacePaneExit,
  resolveWorkspacePaneExitPlacement,
  waitForWorkspaceMotion,
} from '../../src/renderer/components/tabs/workspace-pane-motion';

describe('workspace pane motion', () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete document.documentElement.dataset.motion;
    vi.useRealTimers();
  });

  function createSplit(direction: 'row' | 'column') {
    const split = document.createElement('div');
    split.className = `workspace-split workspace-split--${direction}`;
    const first = document.createElement('section');
    first.className = 'workspace-pane';
    const divider = document.createElement('div');
    const second = document.createElement('section');
    second.className = 'workspace-pane';
    split.append(first, divider, second);
    document.body.append(split);
    return { first, second, split };
  }

  it.each([
    ['row', 'row-start', 'row-end'],
    ['column', 'column-start', 'column-end'],
  ] as const)(
    'resolves both %s split placements',
    (direction, firstPlacement, secondPlacement) => {
      const { first, second } = createSplit(direction);
      expect(resolveWorkspacePaneExitPlacement(first)).toBe(firstPlacement);
      expect(resolveWorkspacePaneExitPlacement(second)).toBe(secondPlacement);
    },
  );

  it('animates the real split in reverse and deduplicates requests', async () => {
    const { first, split } = createSplit('row');
    const firstRequest = animateWorkspacePaneExit(first);
    const repeatedRequest = animateWorkspacePaneExit(first);

    expect(repeatedRequest).toBe(firstRequest);
    expect(split.dataset.splitExit).toBe('row-start');
    expect(first.dataset.paneExiting).toBe('true');
    expect(document.querySelector('.workspace-pane-exit-clone')).toBeNull();

    split.dispatchEvent(new Event('animationend'));
    await firstRequest;
  });

  it('finishes immediately when motion is reduced', async () => {
    document.documentElement.dataset.motion = 'reduced';
    const { first, split } = createSplit('column');

    await animateWorkspacePaneExit(first);

    expect(split.hasAttribute('data-split-exit')).toBe(false);
  });

  it('supports the shorter overlapped pane exit and skips its delay for reduced motion', async () => {
    vi.useFakeTimers();
    const { first, split } = createSplit('row');
    const pending = animateWorkspacePaneExit(first, 80);

    expect(
      split.style.getPropertyValue('--workspace-pane-exit-duration'),
    ).toBe('80ms');
    split.dispatchEvent(new Event('animationend'));
    await pending;

    vi.clearAllTimers();
    const delay = waitForWorkspaceMotion(45);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(45);
    await delay;

    document.documentElement.dataset.motion = 'reduced';
    await expect(waitForWorkspaceMotion(45)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
