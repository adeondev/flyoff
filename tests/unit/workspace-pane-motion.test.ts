// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  waitForWorkspaceMotion,
  workspaceMotionReduced,
} from '../../src/renderer/components/tabs/workspace-pane-motion';

describe('workspace pane motion', () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete document.documentElement.dataset.motion;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('lets the explicit motion preference win over the media query', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );

    expect(workspaceMotionReduced()).toBe(true);
    document.documentElement.dataset.motion = 'full';
    expect(workspaceMotionReduced()).toBe(false);
    document.documentElement.dataset.motion = 'reduced';
    expect(workspaceMotionReduced()).toBe(true);
  });

  it('falls back to the media query and tolerates its absence', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(workspaceMotionReduced()).toBe(false);

    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    expect(workspaceMotionReduced()).toBe(false);
  });

  it('waits for the requested delay and skips it for reduced motion', async () => {
    vi.useFakeTimers();
    const delay = waitForWorkspaceMotion(45);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(45);
    await delay;

    document.documentElement.dataset.motion = 'reduced';
    await expect(waitForWorkspaceMotion(45)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
