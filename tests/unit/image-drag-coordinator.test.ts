// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginImageDrag,
  finishImageDrag,
  holdImageDrag,
  imageDragGhostRect,
  imageDragSnapshot,
  moveImageDrag,
  returnImageDrag,
  settleImageDrag,
} from '../../src/renderer/projects/image-drag-coordinator';

const payload = {
  assetId: '123e4567-e89b-42d3-a456-426614174000',
  ghostHeight: 60,
  ghostWidth: 100,
  instanceId: '223e4567-e89b-42d3-a456-426614174001',
  projectId: '323e4567-e89b-42d3-a456-426614174002',
  source: 'note' as const,
  sourceUrl: 'flyoff-media://asset/project/asset',
  targetHeight: 180,
  targetWidth: 320,
};
const sourceRect = { height: 60, left: 20, top: 30, width: 100 };

afterEach(() => {
  finishImageDrag();
  delete document.documentElement.dataset.motion;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('image drag coordinator', () => {
  it('keeps the ghost centered exactly on the pointer', async () => {
    beginImageDrag(payload, { x: 200, y: 150 }, sourceRect);
    expect(imageDragGhostRect(imageDragSnapshot())).toEqual({
      height: 60,
      left: 150,
      top: 120,
      width: 100,
    });

    moveImageDrag({ x: 340, y: 280 });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(imageDragGhostRect(imageDragSnapshot())).toEqual({
      height: 60,
      left: 290,
      top: 250,
      width: 100,
    });
  });

  it('settles at the exact destination and then clears', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const completed = vi.fn();
    let landingFrame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      landingFrame = callback;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const destination = { height: 90, left: 400, top: 210, width: 160 };
    beginImageDrag(payload, { x: 200, y: 150 }, sourceRect);
    holdImageDrag();
    settleImageDrag(destination, completed);

    expect(imageDragSnapshot().phase).toBe('holding');
    expect(imageDragGhostRect(imageDragSnapshot())).toEqual({
      height: 60,
      left: 150,
      top: 120,
      width: 100,
    });
    landingFrame?.(performance.now());
    expect(imageDragSnapshot().phase).toBe('settling');
    expect(imageDragGhostRect(imageDragSnapshot())).toEqual(destination);
    vi.advanceTimersByTime(119);
    expect(imageDragSnapshot().phase).toBe('settling');
    vi.advanceTimersByTime(1);
    expect(imageDragSnapshot()).toEqual({ phase: 'idle' });
    expect(completed).toHaveBeenCalledOnce();
  });

  it('returns invalid drops to their source rectangle', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    beginImageDrag(payload, { x: 500, y: 400 }, sourceRect);
    returnImageDrag();

    expect(imageDragSnapshot().phase).toBe('returning');
    expect(imageDragGhostRect(imageDragSnapshot())).toEqual(sourceRect);
    vi.advanceTimersByTime(100);
    expect(imageDragSnapshot().phase).toBe('idle');
  });

  it('finishes landing immediately when interface motion is reduced', () => {
    document.documentElement.dataset.motion = 'reduced';
    const completed = vi.fn();
    beginImageDrag(payload, { x: 200, y: 150 }, sourceRect);
    holdImageDrag();
    settleImageDrag(
      { height: 90, left: 400, top: 210, width: 160 },
      completed,
    );

    expect(imageDragSnapshot()).toEqual({ phase: 'idle' });
    expect(completed).toHaveBeenCalledOnce();
  });

  it('finishes the previous flight before starting another drag', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const completed = vi.fn();
    beginImageDrag(payload, { x: 200, y: 150 }, sourceRect);
    holdImageDrag();
    settleImageDrag(
      { height: 90, left: 400, top: 210, width: 160 },
      completed,
    );

    beginImageDrag(
      { ...payload, instanceId: '423e4567-e89b-42d3-a456-426614174003' },
      { x: 300, y: 250 },
      sourceRect,
    );

    expect(completed).toHaveBeenCalledOnce();
    expect(imageDragSnapshot().phase).toBe('dragging');
  });

  it('uses the pane-preview fill and a visible landing transition', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/renderer/projects/projects.css'),
      'utf8',
    );
    const target = styles.match(
      /\.markdown-image-drop-target\s*{([^}]*)}/,
    )?.[1];
    const landing = styles.match(
      /\.image-drag-ghost\[data-phase='settling'\]\s*{([^}]*)}/,
    )?.[1];

    expect(target).toContain('border: 0');
    expect(target).toContain('var(--color-accent) 36%');
    expect(landing).toContain('opacity: 1');
    expect(landing).toMatch(/transform 120ms var\(--ease-out\)/);
    expect(landing).toMatch(/opacity 120ms var\(--ease-out\)/);
  });
});
