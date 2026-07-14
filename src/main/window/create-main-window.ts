import path from 'node:path';

import { app, BrowserWindow, Menu, screen } from 'electron';

import flyoffIcon from '../../../resources/icons/flyoff.png';
import {
  WINDOW_STATE_CHANGED_CHANNEL,
  type WindowState,
} from '../../shared/contracts';
import { secureWebContents, type RendererLocation } from '../security';
import {
  fitWindowBoundsToDisplay,
  trackWindowState,
  type WindowStateStore,
} from './window-state-store';

const DEFAULT_WIDTH = 1_200;
const DEFAULT_HEIGHT = 760;
const MINIMUM_WIDTH = 900;
const MINIMUM_HEIGHT = 600;

export interface CreateMainWindowOptions extends RendererLocation {
  onWindowCreated?: (window: BrowserWindow) => void;
  windowStateStore?: WindowStateStore;
}

function waitForWindowMode(
  subscribe: (listener: () => void) => void,
  unsubscribe: (listener: () => void) => void,
  changeMode: () => void,
): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      unsubscribe(finish);
      resolve();
    };
    const timeout = setTimeout(finish, 1_000);

    subscribe(finish);
    changeMode();
  });
}

export async function createMainWindow({
  isAllowedUrl,
  onWindowCreated,
  rendererUrl,
  windowStateStore,
}: CreateMainWindowOptions): Promise<BrowserWindow> {
  const persistedState = windowStateStore?.load();
  const initialBounds = persistedState
    ? fitWindowBoundsToDisplay(
        persistedState.bounds,
        screen,
        MINIMUM_WIDTH,
        MINIMUM_HEIGHT,
      )
    : { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  const window = new BrowserWindow({
    ...initialBounds,
    minWidth: MINIMUM_WIDTH,
    minHeight: MINIMUM_HEIGHT,
    show: false,
    frame: false,
    autoHideMenuBar: process.platform !== 'darwin',
    backgroundColor: '#131014',
    icon:
      process.platform === 'darwin'
        ? undefined
        : path.join(__dirname, flyoffIcon),
    title: 'Flyoff',
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      sandbox: true,
      spellcheck: true,
      webSecurity: true,
    },
  });

  onWindowCreated?.(window);

  if (process.platform !== 'darwin') {
    window.setMenu(Menu.getApplicationMenu());
    window.setAutoHideMenuBar(false);
    window.setMenuBarVisibility(false);
  }

  secureWebContents(window.webContents, isAllowedUrl);

  const sendWindowState = () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }

    const state: WindowState = { maximized: window.isMaximized() };
    window.webContents.send(WINDOW_STATE_CHANGED_CHANNEL, state);
  };

  window.on('maximize', sendWindowState);
  window.on('unmaximize', sendWindowState);

  const stopTrackingWindowState = windowStateStore
    ? trackWindowState(window, windowStateStore)
    : undefined;
  window.once('closed', () => stopTrackingWindowState?.());

  const readyToShow = new Promise<void>((resolve) => {
    window.once('ready-to-show', () => resolve());
  });

  await Promise.all([window.loadURL(rendererUrl), readyToShow]);

  if (persistedState?.minimized) {
    window.showInactive();
  } else {
    window.show();
  }

  if (persistedState?.maximized) {
    await waitForWindowMode(
      (listener) => window.once('maximize', listener),
      (listener) => window.off('maximize', listener),
      () => window.maximize(),
    );
  }

  if (persistedState?.minimized) {
    await waitForWindowMode(
      (listener) => window.once('minimize', listener),
      (listener) => window.off('minimize', listener),
      () => window.minimize(),
    );
  }

  if (process.platform !== 'darwin') {
    window.setMenuBarVisibility(false);
  }

  return window;
}
