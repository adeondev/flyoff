import {
  app,
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';

import {
  isApplicationMenuCommand,
  MENU_COMMAND_CHANNEL,
  type ApplicationMenuCommand,
} from '../../shared/contracts';
import { validateTrustedMainFrame } from './trusted-sender';

function getActiveWindow(webContents: WebContents): BrowserWindow {
  const window = BrowserWindow.fromWebContents(webContents);

  if (!window || window.isDestroyed()) {
    throw new Error('The menu command does not belong to an active Flyoff window.');
  }

  return window;
}

export function executeApplicationMenuCommand(
  command: ApplicationMenuCommand,
  event: IpcMainInvokeEvent,
): void {
  const webContents = event.sender;

  switch (command) {
    case 'file.closeWindow':
      getActiveWindow(webContents).close();
      return;
    case 'file.quit':
      app.quit();
      return;
    case 'edit.undo':
      webContents.undo();
      return;
    case 'edit.redo':
      webContents.redo();
      return;
    case 'edit.cut':
      webContents.cut();
      return;
    case 'edit.copy':
      webContents.copy();
      return;
    case 'edit.paste':
      webContents.paste();
      return;
    case 'edit.selectAll':
      webContents.selectAll();
      return;
    case 'view.resetZoom':
      webContents.setZoomLevel(0);
      return;
    case 'view.zoomIn':
      webContents.setZoomLevel(webContents.getZoomLevel() + 0.5);
      return;
    case 'view.zoomOut':
      webContents.setZoomLevel(webContents.getZoomLevel() - 0.5);
      return;
    case 'view.toggleFullScreen': {
      const window = getActiveWindow(webContents);
      window.setFullScreen(!window.isFullScreen());
      return;
    }
    case 'help.about':
      app.showAboutPanel();
      return;
  }
}

export function registerMenuCommandHandler(
  isAllowedUrl: (url: string) => boolean,
): () => void {
  ipcMain.handle(MENU_COMMAND_CHANNEL, (event, command: unknown) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Application menu command');

    if (!isApplicationMenuCommand(command)) {
      throw new TypeError('Invalid application menu command.');
    }

    executeApplicationMenuCommand(command, event);
  });

  return () => ipcMain.removeHandler(MENU_COMMAND_CHANNEL);
}
