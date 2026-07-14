import type { BrowserWindow, Event, Input } from 'electron';

import {
  RENDERER_MENU_COMMAND_CHANNEL,
  RENDERER_MENU_COMMANDS,
  type FlyoffPlatform,
} from '../../shared/contracts';

export function registerNavigationShortcuts(
  window: BrowserWindow,
  platform: FlyoffPlatform,
): () => void {
  const webContents = window.webContents;
  const handleBeforeInput = (event: Event, input: Input) => {
    const primary = platform === 'darwin' ? input.meta : input.control;

    if (
      input.type !== 'keyDown' ||
      !primary ||
      input.alt ||
      input.key.toLowerCase() !== 'w'
    ) {
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
