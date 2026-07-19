import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron';

import {
  PROJECT_IPC_CHANNELS,
  isCreateProjectNodeRequest,
  isChangeProjectPagePasswordRequest,
  isCreateProjectRequest,
  isGetProjectNodeRequest,
  isGetProjectPagePropertiesRequest,
  isListProjectChildrenRequest,
  isListProjectBacklinksRequest,
  isMoveProjectNodeRequest,
  isProjectPathRequest,
  isReadMarkdownDocumentRequest,
  isProjectInternalLinkRequest,
  isProjectSearchRequest,
  isLockProjectPageRequest,
  isProtectProjectPageRequest,
  isRemoveProjectPagePasswordRequest,
  isRenameProjectNodeRequest,
  isRestoreProjectRequest,
  isSaveMarkdownDocumentRequest,
  isSetProjectPageReadOnlyRequest,
  isTrashProjectNodeRequest,
  isUnlockProjectPageRequest,
  projectFailure,
  projectSuccess,
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
  copyPathToClipboard?: (absolutePath: string) => void;
  revealPathInFileManager?: (absolutePath: string) => void;
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
  copyPathToClipboard = (absolutePath) => clipboard.writeText(absolutePath),
  dialogLabels,
  isAllowedUrl,
  projectService,
  revealPathInFileManager = (absolutePath) => shell.showItemInFolder(absolutePath),
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
    PROJECT_IPC_CHANNELS.revealPath,
    async (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Project path reveal');

      if (!isProjectPathRequest(value)) {
        throw new TypeError('Invalid project path request.');
      }

      const resolved = await projectService.resolvePath(senderKey, value);
      if (!resolved.ok) {
        return resolved;
      }

      try {
        revealPathInFileManager(resolved.value);
        return projectSuccess(null);
      } catch {
        return projectFailure(
          'io-error',
          'The project path could not be shown in the file manager.',
        );
      }
    },
  );

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.copyPath,
    async (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Project path copy');

      if (!isProjectPathRequest(value)) {
        throw new TypeError('Invalid project path request.');
      }

      const resolved = await projectService.resolvePath(senderKey, value);
      if (!resolved.ok) {
        return resolved;
      }

      try {
        copyPathToClipboard(resolved.value);
        return projectSuccess(null);
      } catch {
        return projectFailure(
          'io-error',
          'The project path could not be copied.',
        );
      }
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

  ipcMain.handle(PROJECT_IPC_CHANNELS.listLinkTargets, (event) => {
    const { senderKey } = trustedSender(event, 'Project link target listing');
    return projectService.listLinkTargets(senderKey);
  });

  ipcMain.handle(PROJECT_IPC_CHANNELS.getGraph, (event) => {
    const { senderKey } = trustedSender(event, 'Project graph');
    return projectService.getGraph(senderKey);
  });

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.resolveInternalLink,
    (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Project link resolution');
      if (!isProjectInternalLinkRequest(value)) {
        throw new TypeError('Invalid project internal link request.');
      }
      return projectService.resolveInternalLink(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.listBacklinks,
    (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Project backlink listing');
      if (!isListProjectBacklinksRequest(value)) {
        throw new TypeError('Invalid project backlink request.');
      }
      return projectService.listBacklinks(senderKey, value);
    },
  );

  ipcMain.handle(PROJECT_IPC_CHANNELS.search, (event, value: unknown) => {
    const { senderKey } = trustedSender(event, 'Project search');
    if (!isProjectSearchRequest(value)) {
      throw new TypeError('Invalid project search request.');
    }
    return projectService.searchProject(senderKey, value);
  });

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.getPageProperties,
    (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Project page properties');
      if (!isGetProjectPagePropertiesRequest(value)) {
        throw new TypeError('Invalid project page properties request.');
      }
      return projectService.getPageProperties(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.setPageReadOnly,
    (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Project page read-only policy');
      if (!isSetProjectPageReadOnlyRequest(value)) {
        throw new TypeError('Invalid project page read-only request.');
      }
      return projectService.setPageReadOnly(senderKey, value);
    },
  );

  ipcMain.handle(PROJECT_IPC_CHANNELS.protectPage, (event, value: unknown) => {
    const { senderKey } = trustedSender(event, 'Project page protection');
    if (!isProtectProjectPageRequest(value)) {
      throw new TypeError('Invalid project page protection request.');
    }
    return projectService.protectPage(senderKey, value);
  });

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.changePagePassword,
    (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Project page password change');
      if (!isChangeProjectPagePasswordRequest(value)) {
        throw new TypeError('Invalid project page password change request.');
      }
      return projectService.changePagePassword(senderKey, value);
    },
  );

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.removePagePassword,
    (event, value: unknown) => {
      const { senderKey } = trustedSender(event, 'Project page protection removal');
      if (!isRemoveProjectPagePasswordRequest(value)) {
        throw new TypeError('Invalid project page password removal request.');
      }
      return projectService.removePagePassword(senderKey, value);
    },
  );

  ipcMain.handle(PROJECT_IPC_CHANNELS.unlockPage, (event, value: unknown) => {
    const { senderKey } = trustedSender(event, 'Project page unlock');
    if (!isUnlockProjectPageRequest(value)) {
      throw new TypeError('Invalid project page unlock request.');
    }
    return projectService.unlockPage(senderKey, value);
  });

  ipcMain.handle(PROJECT_IPC_CHANNELS.lockPage, (event, value: unknown) => {
    const { senderKey } = trustedSender(event, 'Project page lock');
    if (!isLockProjectPageRequest(value)) {
      throw new TypeError('Invalid project page lock request.');
    }
    return projectService.lockPage(senderKey, value);
  });

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
