import { ipcMain } from 'electron';

import {
  BOOTSTRAP_STATE_CHANNEL,
  type BootstrapState,
} from '../../shared/contracts';
import { validateTrustedMainFrame } from './trusted-sender';

export function registerBootstrapHandler(
  state: BootstrapState,
  isAllowedUrl: (url: string) => boolean,
): () => void {
  ipcMain.handle(BOOTSTRAP_STATE_CHANNEL, (event) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Bootstrap state');
    return state;
  });

  return () => ipcMain.removeHandler(BOOTSTRAP_STATE_CHANNEL);
}
