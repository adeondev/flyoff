import {
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent,
} from 'electron';

import {
  isWindowControlAction,
  WINDOW_CONTROL_CHANNEL,
  WINDOW_STATE_CHANNEL,
  type WindowControlAction,
  type WindowState,
} from '../../shared/contracts';
import { validateTrustedMainFrame } from './trusted-sender';

function getRequestWindow(
  event: IpcMainInvokeEvent,
  isAllowedUrl: (url: string) => boolean,
): BrowserWindow {
  validateTrustedMainFrame(event, isAllowedUrl, 'Window controls');

  const window = BrowserWindow.fromWebContents(event.sender);

  if (!window || window.isDestroyed()) {
    throw new Error('The request does not belong to an active Flyoff window.');
  }

  return window;
}

export function getWindowState(window: BrowserWindow): WindowState {
  return { maximized: window.isMaximized() };
}

function performWindowAction(
  window: BrowserWindow,
  action: WindowControlAction,
): WindowState {
  if (action === 'minimize') {
    window.minimize();
  } else if (action === 'toggle-maximize') {
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  } else {
    const state = getWindowState(window);
    window.close();
    return state;
  }

  return getWindowState(window);
}

export function registerWindowControlHandlers(
  isAllowedUrl: (url: string) => boolean,
): () => void {
  ipcMain.handle(WINDOW_STATE_CHANNEL, (event) =>
    getWindowState(getRequestWindow(event, isAllowedUrl)),
  );
  ipcMain.handle(
    WINDOW_CONTROL_CHANNEL,
    (event, action: unknown) => {
      const window = getRequestWindow(event, isAllowedUrl);

      if (!isWindowControlAction(action)) {
        throw new TypeError('Invalid window control action.');
      }

      return performWindowAction(window, action);
    },
  );

  return () => {
    ipcMain.removeHandler(WINDOW_STATE_CHANNEL);
    ipcMain.removeHandler(WINDOW_CONTROL_CHANNEL);
  };
}
