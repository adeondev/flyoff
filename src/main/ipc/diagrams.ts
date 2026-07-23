import { open, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron';

import {
  DIAGRAM_IPC_CHANNELS,
  isCreateDiagramDocumentRequest,
  isCommitDiagramImportRequest,
  isExportDiagramRequest,
  isReadDiagramDocumentRequest,
  isSaveDiagramDocumentRequest,
  projectSuccess,
  type DiagramExportFormat,
} from '../../shared/contracts';
import { serializeDiagramExport } from '../diagrams/diagram-exporter';
import { DiagramImportCoordinator } from '../diagrams/diagram-import-coordinator';
import {
  completePendingDiagramOpen,
  peekPendingDiagramOpen,
} from '../diagrams/pending-diagram-open';
import {
  ProjectOperationError,
  projectErrorResult,
  type ProjectService,
} from '../projects';
import { validateTrustedMainFrame } from './trusted-sender';

export type SelectDiagramImportFile = (
  window: BrowserWindow | undefined,
) => Promise<string | null>;

export type SelectDiagramExportFile = (
  format: DiagramExportFormat,
  defaultName: string,
  window: BrowserWindow | undefined,
) => Promise<string | null>;

export interface RegisterDiagramHandlersOptions {
  projectService: ProjectService;
  isAllowedUrl: (url: string) => boolean;
  selectImportFile?: SelectDiagramImportFile;
  selectExportFile?: SelectDiagramExportFile;
  createId?: () => string;
  now?: () => Date;
}

async function selectImportWithDialog(
  window: BrowserWindow | undefined,
): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: 'Import diagram',
    properties: ['openFile'],
    filters: [
      {
        name: 'Supported diagrams',
        extensions: [
          'flyd',
          'spinel',
          'spinel-import.json',
          'xmi',
          'xml',
          'drawio',
          'asta',
          'astah',
        ],
      },
    ],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
}

async function selectExportWithDialog(
  format: DiagramExportFormat,
  defaultName: string,
  window: BrowserWindow | undefined,
): Promise<string | null> {
  const extension = format === 'flyd' ? 'flyd' : 'drawio';
  const options = {
    title: 'Export diagram',
    defaultPath: `${defaultName}.${extension}`,
    filters: [{ name: format === 'flyd' ? 'Flyoff Diagram File' : 'Draw.io', extensions: [extension] }],
  };
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  return result.canceled ? null : result.filePath ?? null;
}

async function writeExportWithoutOverwrite(filePath: string, content: string): Promise<void> {
  if (!path.isAbsolute(filePath)) {
    throw new ProjectOperationError('unsafe-path', 'The export destination must be absolute.');
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  try {
    handle = await open(filePath, 'wx', 0o600);
    created = true;
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ProjectOperationError(
        'collision',
        'Flyoff will not overwrite an existing file during diagram export.',
        { cause: error },
      );
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
    if (created && handle) {
      await rm(filePath, { force: true }).catch(() => undefined);
    }
  }
}

export function registerDiagramHandlers({
  createId = () => crypto.randomUUID(),
  isAllowedUrl,
  now,
  projectService,
  selectExportFile = selectExportWithDialog,
  selectImportFile = selectImportWithDialog,
}: RegisterDiagramHandlersOptions): () => void {
  const imports = new DiagramImportCoordinator(projectService, createId, now);
  const senderKey = (event: IpcMainInvokeEvent, capability: string) => {
    validateTrustedMainFrame(event, isAllowedUrl, capability);
    return event.sender.id;
  };

  ipcMain.handle(DIAGRAM_IPC_CHANNELS.create, (event, value: unknown) => {
    const key = senderKey(event, 'Diagram document creation');
    if (!isCreateDiagramDocumentRequest(value)) {
      throw new TypeError('Invalid diagram creation request.');
    }
    return projectService.createDiagram(key, value);
  });

  ipcMain.handle(DIAGRAM_IPC_CHANNELS.read, (event, value: unknown) => {
    const key = senderKey(event, 'Diagram document reading');
    if (!isReadDiagramDocumentRequest(value)) {
      throw new TypeError('Invalid diagram read request.');
    }
    return projectService.readDiagram(key, value);
  });

  ipcMain.handle(DIAGRAM_IPC_CHANNELS.save, (event, value: unknown) => {
    const key = senderKey(event, 'Diagram document saving');
    if (!isSaveDiagramDocumentRequest(value)) {
      throw new TypeError('Invalid diagram save request.');
    }
    return projectService.saveDiagram(key, value);
  });

  ipcMain.handle(DIAGRAM_IPC_CHANNELS.selectImport, async (event) => {
    const key = senderKey(event, 'Diagram import selection');
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    try {
      return await imports.select(key, await selectImportFile(window));
    } catch (error) {
      return projectErrorResult(error);
    }
  });

  ipcMain.handle(DIAGRAM_IPC_CHANNELS.commitImport, (event, value: unknown) => {
    const key = senderKey(event, 'Diagram import creation');
    if (!isCommitDiagramImportRequest(value)) {
      throw new TypeError('Invalid diagram import request.');
    }
    return imports.commit(key, value);
  });

  ipcMain.handle(DIAGRAM_IPC_CHANNELS.export, async (event, value: unknown) => {
    const key = senderKey(event, 'Diagram export');
    if (!isExportDiagramRequest(value)) {
      throw new TypeError('Invalid diagram export request.');
    }
    const node = await projectService.getNode(key, { nodeId: value.nodeId });
    if (!node.ok || node.value.kind !== 'page' || node.value.pageType !== 'diagram') {
      return node.ok
        ? projectErrorResult(
            new ProjectOperationError('invalid-operation', 'The selected page is not a diagram.'),
          )
        : node;
    }
    const diagram = await projectService.readDiagram(key, { nodeId: value.nodeId });
    if (!diagram.ok) {
      return diagram;
    }
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    try {
      const destination = await selectExportFile(value.format, node.value.name, window);
      if (!destination) {
        return projectErrorResult(
          new ProjectOperationError('cancelled', 'Diagram export was cancelled.'),
        );
      }
      const extension = value.format === 'flyd' ? '.flyd' : '.drawio';
      const exportPath = path.extname(destination) ? destination : `${destination}${extension}`;
      await writeExportWithoutOverwrite(
        exportPath,
        serializeDiagramExport(diagram.value.document, value.format),
      );
      return projectSuccess({ fileName: path.basename(exportPath), format: value.format });
    } catch (error) {
      return projectErrorResult(error);
    }
  });

  ipcMain.handle(DIAGRAM_IPC_CHANNELS.openPending, async (event) => {
    const key = senderKey(event, 'Pending diagram opening');
    const pendingPath = peekPendingDiagramOpen();
    if (!pendingPath) {
      return projectSuccess(null);
    }
    const selected = await imports.select(key, pendingPath);
    if (!selected.ok) {
      return selected;
    }
    if (selected.value.status !== 'ready') {
      return projectErrorResult(
        new ProjectOperationError('invalid-format', 'Only .flyd files can be opened directly.'),
      );
    }
    const committed = await imports.commit(key, {
      token: selected.value.token,
      parentId: null,
      importIds: selected.value.diagrams.map(({ importId }) => importId),
    });
    if (committed.ok) {
      completePendingDiagramOpen(pendingPath);
    }
    return committed;
  });

  return () => {
    ipcMain.removeHandler(DIAGRAM_IPC_CHANNELS.create);
    ipcMain.removeHandler(DIAGRAM_IPC_CHANNELS.read);
    ipcMain.removeHandler(DIAGRAM_IPC_CHANNELS.save);
    ipcMain.removeHandler(DIAGRAM_IPC_CHANNELS.selectImport);
    ipcMain.removeHandler(DIAGRAM_IPC_CHANNELS.commitImport);
    ipcMain.removeHandler(DIAGRAM_IPC_CHANNELS.export);
    ipcMain.removeHandler(DIAGRAM_IPC_CHANNELS.openPending);
    imports.dispose();
  };
}
