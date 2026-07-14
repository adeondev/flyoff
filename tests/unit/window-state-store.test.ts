import { EventEmitter } from 'node:events';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fitWindowBoundsToDisplay,
  isPersistedWindowState,
  trackWindowState,
  WindowStateStore,
} from '../../src/main/window/window-state-store';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-state-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  vi.useRealTimers();

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('window state persistence', () => {
  it('validates the version, bounds and window modes', () => {
    expect(
      isPersistedWindowState({
        version: 1,
        bounds: { x: -400, y: 20, width: 1_100, height: 700 },
        maximized: true,
        minimized: true,
      }),
    ).toBe(true);
    expect(
      isPersistedWindowState({
        version: 2,
        bounds: { x: 0, y: 0, width: 1_100, height: 700 },
        maximized: false,
        minimized: false,
      }),
    ).toBe(false);
    expect(
      isPersistedWindowState({
        version: 1,
        bounds: { x: 0, y: 0, width: 0, height: 700 },
        maximized: false,
        minimized: false,
      }),
    ).toBe(false);
  });

  it('keeps restored bounds fully inside the matching display', () => {
    const getDisplayMatching = vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1_920, height: 1_040 },
    }));

    expect(
      fitWindowBoundsToDisplay(
        { x: 1_800, y: 900, width: 1_200, height: 760 },
        { getDisplayMatching } as never,
        900,
        600,
      ),
    ).toEqual({ x: 720, y: 280, width: 1_200, height: 760 });
  });

  it('writes and reads normal bounds with maximized and minimized state', () => {
    const store = new WindowStateStore(createTemporaryDirectory());
    const window = {
      getNormalBounds: () => ({ x: 140, y: 80, width: 1_000, height: 680 }),
      isDestroyed: () => false,
      isMaximized: () => true,
      isMinimized: () => true,
    };

    store.save(window as never);

    expect(store.load()).toEqual({
      version: 1,
      bounds: { x: 140, y: 80, width: 1_000, height: 680 },
      maximized: true,
      minimized: true,
    });
  });

  it('ignores missing, malformed and incompatible state files', () => {
    const store = new WindowStateStore(createTemporaryDirectory());

    expect(store.load()).toBeUndefined();
    writeFileSync(store.filePath, '{broken', 'utf8');
    expect(store.load()).toBeUndefined();
    writeFileSync(
      store.filePath,
      JSON.stringify({ version: 99, bounds: {} }),
      'utf8',
    );
    expect(store.load()).toBeUndefined();
  });

  it('debounces movement and immediately records mode changes and close', () => {
    vi.useFakeTimers();
    const window = new EventEmitter();
    Object.assign(window, {
      isMaximized: () => false,
      isMinimized: () => false,
    });
    const save = vi.fn();
    const stopTracking = trackWindowState(
      window as never,
      { save } as unknown as WindowStateStore,
    );

    window.emit('move');
    window.emit('resize');
    vi.advanceTimersByTime(199);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledOnce();

    window.emit('maximize');
    vi.runAllTimers();
    window.emit('minimize');
    vi.runAllTimers();
    window.emit('close');
    expect(save).toHaveBeenCalledTimes(4);

    stopTracking();
    window.emit('restore');
    vi.runAllTimers();
    expect(save).toHaveBeenCalledTimes(4);
  });
});
