import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import {
  PROJECT_NOTE_ACTIVITY_IPC_CHANNELS,
  isProjectNoteActivityEvent,
} from '../../shared/contracts';
import type { ProjectService } from '../projects';
import { validateTrustedMainFrame } from './trusted-sender';

export function registerProjectNoteActivityHandlers(
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

  ipcMain.handle(PROJECT_NOTE_ACTIVITY_IPC_CHANNELS.get, (event) =>
    projectService.getNoteActivity(
      senderKey(event, 'Project note activity listing'),
    ),
  );

  ipcMain.handle(
    PROJECT_NOTE_ACTIVITY_IPC_CHANNELS.record,
    (event, value: unknown) => {
      const trustedSenderKey = senderKey(
        event,
        'Project note activity recording',
      );
      if (!isProjectNoteActivityEvent(value)) {
        throw new TypeError('Invalid project note activity event.');
      }
      return projectService.recordNoteActivity(trustedSenderKey, value);
    },
  );

  return () => {
    for (const channel of Object.values(
      PROJECT_NOTE_ACTIVITY_IPC_CHANNELS,
    )) {
      ipcMain.removeHandler(channel);
    }
  };
}
