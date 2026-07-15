import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron';

import {
  PROJECT_IPC_CHANNELS,
  isCreateProjectNodeRequest,
  isCreateProjectRequest,
  isGetProjectNodeRequest,
  isListProjectChildrenRequest,
  isMoveProjectNodeRequest,
  isReadMarkdownDocumentRequest,
  isRenameProjectNodeRequest,
  isRestoreProjectRequest,
  isSaveMarkdownDocumentRequest,
  isTrashProjectNodeRequest,
  projectFailure,
} from '../../shared/contracts';
import type { ProjectService } from '../projects';
import { validateTrustedMainFrame } from './trusted-sender';

export type ProjectDirectoryDialogPurpose = 'create-parent' | 'open-project';

export type SelectProjectDirectory = (
  purpose: ProjectDirectoryDialogPurpose,
  window: BrowserWindow | undefined,
) => Promise<string | null>;

export interface RegisterProjectHandlersOptions {
  dialogLabels?: {
    createParent: string;
    openProject: string;
  };
  isAllowedUrl: (url: string) => boolean;
  projectService: ProjectService;
  selectDirectory?: SelectProjectDirectory;
}

async function selectDirectoryWithDialog(
  purpose: ProjectDirectoryDialogPurpose,
  window: BrowserWindow | undefined,
  labels?: RegisterProjectHandlersOptions['dialogLabels'],
): Promise<string | null> {
  const options: OpenDialogOptions = {
    title:
      purpose === 'create-parent'
        ? (labels?.createParent ?? 'Choose where to create the project')
        : (labels?.openProject ?? 'Open Flyoff project'),
    properties:
      purpose === 'create-parent'
        ? ['openDirectory', 'createDirectory']
        : ['openDirectory'],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);

  return result.canceled ? null : (result.filePaths[0] ?? null);
}

export function registerProjectHandlers({
  dialogLabels,
  isAllowedUrl,
  projectService,
  selectDirectory = (purpose, window) =>
    selectDirectoryWithDialog(purpose, window, dialogLabels),
}: RegisterProjectHandlersOptions): () => void {
  const trustedSender = (event: IpcMainInvokeEvent, capability: string) => {
    validateTrustedMainFrame(event, isAllowedUrl, capability);
    return {
      senderKey: event.sender.id,
      window: BrowserWindow.fromWebContents(event.sender) ?? undefined,
    };
  };

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.selectCreateLocation,
    async (event) => {
      const { senderKey, window } = trustedSender(
        event,
        'Project location selection',
      );
      let selected: string | null;
      try {
        selected = await selectDirectory('create-parent', window);
      } catch {
        return projectFailure(
          'io-error',
          'The project location selector could not be opened.',
        );
      }

      return selected
        ? projectService.selectCreateLocation(senderKey, selected)
        : projectFailure('cancelled', 'Project creation was cancelled.');
    },
  );

  ipcMain.handle(PROJECT_IPC_CHANNELS.create, async (event, value: unknown) => {
    const { senderKey } = trustedSender(event, 'Project creation');

    if (!isCreateProjectRequest(value)) {
      throw new TypeError('Invalid project creation request.');
    }

    return projectService.createProject(senderKey, value);
  });

  ipcMain.handle(PROJECT_IPC_CHANNELS.open, async (event) => {
    const { senderKey, window } = trustedSender(event, 'Project opening');
    let selected: string | null;
    try {
      selected = await selectDirectory('open-project', window);
    } catch {
      return projectFailure(
        'io-error',
        'The project selector could not be opened.',
      );
    }

    return selected
      ? projectService.openProject(senderKey, selected)
      : projectFailure('cancelled', 'Project opening was cancelled.');
  });

  ipcMain.handle(PROJECT_IPC_CHANNELS.restore, async (event, value: unknown) => {
    const { senderKey } = trustedSender(event, 'Project restoration');

    if (!isRestoreProjectRequest(value)) {
      throw new TypeError('Invalid project restoration request.');
    }

    return projectService.restoreProject(senderKey, value);
  });

  ipcMain.handle(PROJECT_IPC_CHANNELS.close, (event) => {
    const { senderKey } = trustedSender(event, 'Project closing');
    return projectService.closeProject(senderKey);
  });

  ipcMain.handle(PROJECT_IPC_CHANNELS.getNode, (event, value: unknown) => {
    const { senderKey } = trustedSender(event, 'Project content lookup');

    if (!isGetProjectNodeRequest(value)) {
      throw new TypeError('Invalid project node request.');
    }

    return projectService.getNode(senderKey, value);
  });

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.listChildren,
    async (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Project content listing');

      if (!isListProjectChildrenRequest(value)) {
        throw new TypeError('Invalid project directory request.');
      }

      return projectService.listChildren(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.createNode,
    async (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Project content creation');

      if (!isCreateProjectNodeRequest(value)) {
        throw new TypeError('Invalid project node creation request.');
      }

      return projectService.createNode(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.renameNode,
    async (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Project content rename');

      if (!isRenameProjectNodeRequest(value)) {
        throw new TypeError('Invalid project node rename request.');
      }

      return projectService.renameNode(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.moveNode,
    async (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Project content move');

      if (!isMoveProjectNodeRequest(value)) {
        throw new TypeError('Invalid project node move request.');
      }

      return projectService.moveNode(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.trashNode,
    async (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Project content deletion');

      if (!isTrashProjectNodeRequest(value)) {
        throw new TypeError('Invalid project node trash request.');
      }

      return projectService.trashNode(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.readMarkdown,
    async (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Markdown document reading');

      if (!isReadMarkdownDocumentRequest(value)) {
        throw new TypeError('Invalid Markdown document request.');
      }

      return projectService.readMarkdown(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.saveMarkdown,
    async (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Markdown document saving');

      if (!isSaveMarkdownDocumentRequest(value)) {
        throw new TypeError('Invalid Markdown document save request.');
      }

      return projectService.saveMarkdown(senderKey, value);
    },
  );

  const channels = Object.values(PROJECT_IPC_CHANNELS);

  return () => {
    for (const channel of channels) {
      ipcMain.removeHandler(channel);
    }
  };
}

export function createSystemTrashItem(): (absolutePath: string) => Promise<void> {
  return (absolutePath) => shell.trashItem(absolutePath);
}
