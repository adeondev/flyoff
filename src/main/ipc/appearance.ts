import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import {
  PROJECT_APPEARANCE_IPC_CHANNELS,
  isSetProjectAppearanceRequest,
  isSetProjectNoteAppearanceRequest,
} from '../../shared/contracts';
import type { ProjectService } from '../projects';
import { validateTrustedMainFrame } from './trusted-sender';

export function registerProjectAppearanceHandlers(
  projectService: ProjectService,
  isAllowedUrl: (url: string) => boolean,
): () => void {
  const senderKey = (
    event: IpcMainInvokeEvent,
    capability: string,
  ): number => {
    validateTrustedMainFrame(event, isAllowedUrl, capability);
    return event.sender.id;
  };

  ipcMain.handle(PROJECT_APPEARANCE_IPC_CHANNELS.get, (event) =>
    projectService.getAppearance(senderKey(event, 'Project appearance reading')),
  );

  ipcMain.handle(
    PROJECT_APPEARANCE_IPC_CHANNELS.setNote,
    (event, value: unknown) => {
      const trustedSenderKey = senderKey(event, 'Project appearance update');
      if (!isSetProjectNoteAppearanceRequest(value)) {
        throw new TypeError('Invalid project appearance request.');
      }
      return projectService.setNoteAppearance(trustedSenderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_APPEARANCE_IPC_CHANNELS.setProject,
    (event, value: unknown) => {
      const trustedSenderKey = senderKey(event, 'Project appearance update');
      if (!isSetProjectAppearanceRequest(value)) {
        throw new TypeError('Invalid project appearance request.');
      }
      return projectService.setProjectAppearance(trustedSenderKey, value);
    },
  );

  return () => {
    for (const channel of Object.values(PROJECT_APPEARANCE_IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
  };
}
