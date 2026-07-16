import type { BrowserWindow, Event, Input } from 'electron';

import {
  RENDERER_MENU_COMMAND_CHANNEL,
  RENDERER_MENU_COMMANDS,
  type FlyoffPlatform,
} from '../../shared/contracts';

const ZOOM_STEP = 0.5;

export function registerNavigationShortcuts(
  window: BrowserWindow,
  platform: FlyoffPlatform,
): () => void {
  const webContents = window.webContents;
  const handleBeforeInput = (event: Event, input: Input) => {
    const primary = platform === 'darwin' ? input.meta : input.control;

    if (input.type !== 'keyDown' || !primary || input.alt) {
      return;
    }

    // The zoom-in menu item is bound to "=" because "+" needs Shift on most
    // layouts. Cover the Shift and numpad spellings here.
    if (input.key === '+') {
      event.preventDefault();
      webContents.setZoomLevel(webContents.getZoomLevel() + ZOOM_STEP);
      return;
    }

    if (input.key.toLowerCase() !== 'w') {
      return;
    }

    event.preventDefault();

    if (input.shift) {
      window.close();
      return;
    }

    webContents.send(
      RENDERER_MENU_COMMAND_CHANNEL,
      RENDERER_MENU_COMMANDS.closeTab,
    );
  };

  webContents.on('before-input-event', handleBeforeInput);

  return () => {
    webContents.off('before-input-event', handleBeforeInput);
  };
}
