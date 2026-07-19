import { ipcMain } from 'electron';

import {
  GET_UI_STATE_CHANNEL,
  isWorkspaceLayoutState,
  SAVE_UI_STATE_CHANNEL,
} from '../../shared/contracts';
import type { UiStateStore } from '../window';
import { validateTrustedMainFrame } from './trusted-sender';

export function registerUiStateHandlers(
  store: UiStateStore,
  isAllowedUrl: (url: string) => boolean,
): () => void {
  ipcMain.handle(GET_UI_STATE_CHANNEL, (event) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Workspace layout');
    return store.load();
  });

  ipcMain.handle(SAVE_UI_STATE_CHANNEL, (event, state: unknown) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Workspace layout');

    if (!isWorkspaceLayoutState(state)) {
      throw new TypeError('Invalid workspace layout state.');
    }

    store.save(state);
  });

  return () => {
    ipcMain.removeHandler(GET_UI_STATE_CHANNEL);
    ipcMain.removeHandler(SAVE_UI_STATE_CHANNEL);
  };
}
