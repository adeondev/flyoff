import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type {
  BrowserWindow,
  Rectangle,
  Screen,
} from 'electron';

const WINDOW_STATE_VERSION = 1;
const WINDOW_STATE_FILENAME = 'window-state.json';
const SAVE_DELAY_MS = 200;

export interface PersistedWindowState {
  version: typeof WINDOW_STATE_VERSION;
  bounds: Rectangle;
  maximized: boolean;
  minimized: boolean;
}

type WindowModeOverride = Partial<
  Pick<PersistedWindowState, 'maximized' | 'minimized'>
>;

function isFiniteInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Math.abs(value as number) <= 100_000;
}

export function isPersistedWindowState(
  value: unknown,
): value is PersistedWindowState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const state = value as Record<string, unknown>;
  const bounds = state.bounds as Record<string, unknown> | undefined;

  return (
    state.version === WINDOW_STATE_VERSION &&
    typeof state.maximized === 'boolean' &&
    typeof state.minimized === 'boolean' &&
    Boolean(bounds) &&
    isFiniteInteger(bounds?.x) &&
    isFiniteInteger(bounds?.y) &&
    isFiniteInteger(bounds?.width) &&
    (bounds?.width as number) > 0 &&
    isFiniteInteger(bounds?.height) &&
    (bounds?.height as number) > 0
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function fitWindowBoundsToDisplay(
  bounds: Rectangle,
  screen: Pick<Screen, 'getDisplayMatching'>,
  minimumWidth: number,
  minimumHeight: number,
): Rectangle {
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(
    Math.max(bounds.width, minimumWidth),
    workArea.width,
  );
  const height = Math.min(
    Math.max(bounds.height, minimumHeight),
    workArea.height,
  );

  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  };
}

export class WindowStateStore {
  readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, WINDOW_STATE_FILENAME);
  }

  load(): PersistedWindowState | undefined {
    try {
      const state: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return isPersistedWindowState(state) ? state : undefined;
    } catch {
      return undefined;
    }
  }

  save(window: BrowserWindow, mode: WindowModeOverride = {}): void {
    if (window.isDestroyed()) {
      return;
    }

    const state: PersistedWindowState = {
      version: WINDOW_STATE_VERSION,
      bounds: window.getNormalBounds(),
      maximized: mode.maximized ?? window.isMaximized(),
      minimized: mode.minimized ?? window.isMinimized(),
    };

    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    } catch {
      return;
    }
  }
}

export function trackWindowState(
  window: BrowserWindow,
  store: WindowStateStore,
): () => void {
  let pendingSave: ReturnType<typeof setTimeout> | undefined;
  let mode: Required<WindowModeOverride> = {
    maximized: window.isMaximized(),
    minimized: window.isMinimized(),
  };

  const persist = () => {
    if (pendingSave) {
      clearTimeout(pendingSave);
      pendingSave = undefined;
    }

    store.save(window, mode);
  };
  const schedulePersist = () => {
    if (pendingSave) {
      clearTimeout(pendingSave);
    }

    pendingSave = setTimeout(persist, SAVE_DELAY_MS);
  };
  const persistMode = (change: WindowModeOverride) => {
    if (pendingSave) {
      clearTimeout(pendingSave);
      pendingSave = undefined;
    }

    mode = { ...mode, ...change };
    store.save(window, mode);
  };
  const persistMaximized = () => persistMode({ maximized: true });
  const persistUnmaximized = () => persistMode({ maximized: false });
  const persistMinimized = () => persistMode({ minimized: true });
  const persistRestored = () => persistMode({ minimized: false });

  window.on('move', schedulePersist);
  window.on('resize', schedulePersist);
  window.on('maximize', persistMaximized);
  window.on('unmaximize', persistUnmaximized);
  window.on('minimize', persistMinimized);
  window.on('restore', persistRestored);
  window.on('close', persist);

  return () => {
    if (pendingSave) {
      clearTimeout(pendingSave);
    }

    window.off('move', schedulePersist);
    window.off('resize', schedulePersist);
    window.off('maximize', persistMaximized);
    window.off('unmaximize', persistUnmaximized);
    window.off('minimize', persistMinimized);
    window.off('restore', persistRestored);
    window.off('close', persist);
  };
}
