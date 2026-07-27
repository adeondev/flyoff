import { randomUUID } from 'node:crypto';

import {
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
} from 'electron';

import {
  PROJECT_MEDIA_IPC_CHANNELS,
  isCancelProjectMediaImportRequest,
  isCreateMediaFolderRequest,
  isCreateMediaFolderWithEntriesRequest,
  isGetProjectMediaAssetRequest,
  isImportProjectMediaPathsRequest,
  isImportProjectMediaRequest,
  isListProjectMediaUsagesRequest,
  isMoveMediaEntriesRequest,
  isRenameMediaEntryRequest,
  isTrashMediaEntriesRequest,
  projectFailure,
  projectSuccess,
} from '../../shared/contracts';
import type { ProjectService } from '../projects';
import { validateTrustedMainFrame } from './trusted-sender';

export type SelectProjectMediaFiles = (
  window: BrowserWindow | null,
) => Promise<readonly string[] | null>;

export interface RegisterProjectMediaHandlersOptions {
  isAllowedUrl: (url: string) => boolean;
  projectService: ProjectService;
  selectMediaFiles?: SelectProjectMediaFiles;
}

const selectDefault: SelectProjectMediaFiles = async (window) => {
  const options: OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Imagens',
        extensions: [
          'png',
          'jpg',
          'jpeg',
          'webp',
          'gif',
          'avif',
        ],
      },
    ],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths;
};

export function registerProjectMediaHandlers({
  isAllowedUrl,
  projectService,
  selectMediaFiles = selectDefault,
}: RegisterProjectMediaHandlersOptions): () => void {
  const imports = new Map<
    string,
    { abort: AbortController; senderId: number }
  >();
  const trusted = (
    event: Electron.IpcMainInvokeEvent,
    operation: string,
  ) => {
    validateTrustedMainFrame(event, isAllowedUrl, operation);
    return { senderKey: event.sender.id };
  };

  ipcMain.handle(
    PROJECT_MEDIA_IPC_CHANNELS.startImport,
    (event, value: unknown) => {
      const { senderKey } = trusted(event, 'Project media import start');
      if (!isImportProjectMediaPathsRequest(value)) {
        throw new TypeError('Invalid project media paths.');
      }
      const operationId = randomUUID();
      const abort = new AbortController();
      imports.set(operationId, { abort, senderId: event.sender.id });
      let completed = 0;
      let failed = 0;
      const send = (progress: {
        completed: number;
        currentName: string;
        failed: number;
        total: number;
        status: 'running' | 'completed' | 'cancelled' | 'failed';
        outcome?: unknown;
        error?: unknown;
      }): void => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(PROJECT_MEDIA_IPC_CHANNELS.importProgress, {
            operationId,
            ...progress,
          });
        }
      };
      void projectService
        .importMediaWithProgress(
          senderKey,
          value,
          (progress) => {
            completed = progress.completed;
            failed = progress.failed;
            send({ ...progress, status: 'running' });
          },
          abort.signal,
        )
        .then((result) => {
          if (abort.signal.aborted) {
            send({
              completed: result.ok ? result.value.assets.length : completed,
              currentName: '',
              failed,
              total: value.paths.length,
              status: 'cancelled',
              outcome:
                result.ok && result.value.assets.length > 0
                  ? result.value
                  : undefined,
              error: result.ok ? undefined : result.error,
            });
          } else if (result.ok) {
            send({
              completed: result.value.assets.length,
              currentName: '',
              failed,
              total: value.paths.length,
              status: 'completed',
              outcome: result.value,
            });
          } else {
            send({
              completed,
              currentName: '',
              failed,
              total: value.paths.length,
              status: 'failed',
              error: result.error,
            });
          }
        })
        .finally(() => imports.delete(operationId));
      return projectSuccess({ operationId });
    },
  );

  ipcMain.handle(
    PROJECT_MEDIA_IPC_CHANNELS.cancelImport,
    (event, value: unknown) => {
      trusted(event, 'Project media import cancellation');
      if (!isCancelProjectMediaImportRequest(value)) {
        throw new TypeError('Invalid media cancellation request.');
      }
      const operation = imports.get(value.operationId);
      if (!operation || operation.senderId !== event.sender.id) {
        return projectFailure('not-found', 'The media import was not found.');
      }
      operation.abort.abort();
      return projectSuccess(null);
    },
  );

  ipcMain.handle(
    PROJECT_MEDIA_IPC_CHANNELS.selectImport,
    async (event, value: unknown) => {
      const { senderKey } = trusted(event, 'Project media selection');
      if (!isImportProjectMediaRequest(value)) {
        throw new TypeError('Invalid project media import request.');
      }
      const paths = await selectMediaFiles(
        BrowserWindow.fromWebContents(event.sender),
      );
      return paths && paths.length > 0
        ? projectService.importMedia(senderKey, { ...value, paths })
        : projectFailure('cancelled', 'No media file was selected.');
    },
  );

  ipcMain.handle(
    PROJECT_MEDIA_IPC_CHANNELS.getSnapshot,
    (event) => {
      const { senderKey } = trusted(event, 'Project media gallery');
      return projectService.getMediaGallery(senderKey);
    },
  );

  ipcMain.handle(
    PROJECT_MEDIA_IPC_CHANNELS.createFolder,
    (event, value: unknown) => {
      const { senderKey } = trusted(event, 'Project media folder creation');
      if (!isCreateMediaFolderRequest(value)) {
        throw new TypeError('Invalid media folder request.');
      }
      return projectService.createMediaFolder(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_MEDIA_IPC_CHANNELS.createFolderWithEntries,
    (event, value: unknown) => {
      const { senderKey } = trusted(
        event,
        'Project media folder creation with entries',
      );
      if (!isCreateMediaFolderWithEntriesRequest(value)) {
        throw new TypeError('Invalid media folder with entries request.');
      }
      return projectService.createMediaFolderWithEntries(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_MEDIA_IPC_CHANNELS.renameEntry,
    (event, value: unknown) => {
      const { senderKey } = trusted(event, 'Project media rename');
      if (!isRenameMediaEntryRequest(value)) {
        throw new TypeError('Invalid media rename request.');
      }
      return projectService.renameMediaEntry(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_MEDIA_IPC_CHANNELS.moveEntries,
    (event, value: unknown) => {
      const { senderKey } = trusted(event, 'Project media move');
      if (!isMoveMediaEntriesRequest(value)) {
        throw new TypeError('Invalid media move request.');
      }
      return projectService.moveMediaEntries(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_MEDIA_IPC_CHANNELS.trashEntries,
    (event, value: unknown) => {
      const { senderKey } = trusted(event, 'Project media trash');
      if (!isTrashMediaEntriesRequest(value)) {
        throw new TypeError('Invalid media trash request.');
      }
      return projectService.trashMediaEntries(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_MEDIA_IPC_CHANNELS.importPaths,
    (event, value: unknown) => {
      const { senderKey } = trusted(event, 'Project media import');
      if (!isImportProjectMediaPathsRequest(value)) {
        throw new TypeError('Invalid project media paths.');
      }
      return projectService.importMedia(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_MEDIA_IPC_CHANNELS.getAsset,
    (event, value: unknown) => {
      const { senderKey } = trusted(event, 'Project media inspection');
      if (!isGetProjectMediaAssetRequest(value)) {
        throw new TypeError('Invalid project media request.');
      }
      return projectService.getMediaAsset(senderKey, value.nodeId);
    },
  );

  ipcMain.handle(
    PROJECT_MEDIA_IPC_CHANNELS.listUsages,
    (event, value: unknown) => {
      const { senderKey } = trusted(event, 'Project media usage listing');
      if (!isListProjectMediaUsagesRequest(value)) {
        throw new TypeError('Invalid project media usage request.');
      }
      return projectService.listMediaUsages(senderKey, value.nodeId);
    },
  );

  return () => {
    for (const operation of imports.values()) {
      operation.abort.abort();
    }
    imports.clear();
    for (const channel of Object.values(PROJECT_MEDIA_IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
  };
}
