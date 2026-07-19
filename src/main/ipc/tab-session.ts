import { ipcMain } from 'electron';

import {
  GET_RESTORABLE_TAB_SESSION_CHANNEL,
  isTabSessionRestoreDecision,
  isWorkspaceSessionSnapshot,
  RESOLVE_RESTORABLE_TAB_SESSION_CHANNEL,
  SAVE_TAB_SESSION_CHANNEL,
} from '../../shared/contracts';
import type { TabSessionStore } from '../session';
import { validateTrustedMainFrame } from './trusted-sender';

export function registerTabSessionHandlers(
  store: TabSessionStore,
  isAllowedUrl: (url: string) => boolean,
): () => void {
  ipcMain.handle(GET_RESTORABLE_TAB_SESSION_CHANNEL, (event) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Tab session restoration');
    return store.getRestorableSession();
  });

  ipcMain.handle(
    RESOLVE_RESTORABLE_TAB_SESSION_CHANNEL,
    (event, decision: unknown, current: unknown) => {
      validateTrustedMainFrame(event, isAllowedUrl, 'Tab session restoration');

      if (!isTabSessionRestoreDecision(decision)) {
        throw new TypeError('Invalid tab session restoration decision.');
      }

      if (!isWorkspaceSessionSnapshot(current)) {
        throw new TypeError('Invalid tab session snapshot.');
      }

      store.resolveRestorableSession(current);
    },
  );

  ipcMain.handle(SAVE_TAB_SESSION_CHANNEL, (event, session: unknown) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Tab session persistence');

    if (!isWorkspaceSessionSnapshot(session)) {
      throw new TypeError('Invalid tab session snapshot.');
    }

    store.save(session);
  });

  return () => {
    ipcMain.removeHandler(GET_RESTORABLE_TAB_SESSION_CHANNEL);
    ipcMain.removeHandler(RESOLVE_RESTORABLE_TAB_SESSION_CHANNEL);
    ipcMain.removeHandler(SAVE_TAB_SESSION_CHANNEL);
  };
}
