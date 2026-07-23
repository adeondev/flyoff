import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDiagramHandlers } from '../../src/main/ipc/diagrams';
import type { ProjectService } from '../../src/main/projects';
import {
  DIAGRAM_IPC_CHANNELS,
  projectSuccess,
  type ProjectPageNode,
} from '../../src/shared/contracts';
import {
  createDiagramDocument,
  type DiagramDiagnostic,
} from '../../src/shared/diagram';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  fromWebContents: vi.fn(() => undefined),
}));

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: electronMocks.fromWebContents },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
    showSaveDialog: electronMocks.showSaveDialog,
  },
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
}));

const temporaryDirectories: string[] = [];
const nodeId = '11111111-1111-4111-8111-111111111111';
const revision = 'a'.repeat(64);
const document = createDiagramDocument('class', () => nodeId);
const node: ProjectPageNode = {
  canContainChildren: true,
  hasChildren: false,
  kind: 'page',
  name: 'Domain',
  nodeId,
  pageType: 'diagram',
  parentId: null,
};

function createEvent(url = 'flyoff://app/index.html'): IpcMainInvokeEvent {
  const mainFrame = { url };
  return {
    sender: { id: 42, mainFrame },
    senderFrame: mainFrame,
  } as unknown as IpcMainInvokeEvent;
}

function handlerFor(channel: string) {
  const handler = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([registered]) => registered === channel)?.[1];
  if (!handler) {
    throw new Error(`No handler registered for ${channel}.`);
  }
  return handler;
}

function ids() {
  let next = 2;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
}

function service(): ProjectService {
  return {
    createDiagram: vi.fn(async () => projectSuccess(node)),
    readDiagram: vi.fn(async () => projectSuccess({ nodeId, document, revision })),
    saveDiagram: vi.fn(async () => projectSuccess({ nodeId, document, revision })),
    getNode: vi.fn(async () => projectSuccess(node)),
    importDiagrams: vi.fn(async (
      _key,
      _parentId,
      diagrams: readonly { diagnostics: readonly DiagramDiagnostic[] }[],
    ) =>
      projectSuccess({ nodes: [node], diagnostics: diagrams.flatMap(({ diagnostics }) => diagnostics) }),
    ),
  } as unknown as ProjectService;
}

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('diagram IPC', () => {
  it('validates trusted create, read and save calls before forwarding', async () => {
    const projectService = service();
    const unregister = registerDiagramHandlers({
      projectService,
      isAllowedUrl: (url) => url.startsWith('flyoff://app/'),
    });
    const event = createEvent();

    await handlerFor(DIAGRAM_IPC_CHANNELS.create)(event, {
      parentId: null,
      name: 'Domain',
      diagramType: 'class',
    });
    await handlerFor(DIAGRAM_IPC_CHANNELS.read)(event, { nodeId });
    await handlerFor(DIAGRAM_IPC_CHANNELS.save)(event, {
      nodeId,
      document,
      expectedRevision: revision,
    });
    expect(projectService.createDiagram).toHaveBeenCalledWith(42, expect.any(Object));
    expect(projectService.readDiagram).toHaveBeenCalledWith(42, { nodeId });
    expect(projectService.saveDiagram).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ expectedRevision: revision }),
    );
    expect(() =>
      handlerFor(DIAGRAM_IPC_CHANNELS.save)(event, {
        nodeId,
        document: { ...document, documentId: 'invalid' },
        expectedRevision: revision,
      }),
    ).toThrow(TypeError);
    expect(() =>
      handlerFor(DIAGRAM_IPC_CHANNELS.read)(createEvent('https://evil.test'), { nodeId }),
    ).toThrow();

    unregister();
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(
      Object.keys(DIAGRAM_IPC_CHANNELS).length - 1,
    );
  });

  it('selects a bounded .flyd, binds its token to the sender and commits selected diagrams', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-diagram-ipc-'));
    temporaryDirectories.push(directory);
    const source = path.join(directory, 'Domain.flyd');
    writeFileSync(source, `${JSON.stringify(document)}\n`, 'utf8');
    const projectService = service();
    registerDiagramHandlers({
      projectService,
      isAllowedUrl: () => true,
      selectImportFile: async () => source,
      createId: ids(),
    });

    const selected = await handlerFor(DIAGRAM_IPC_CHANNELS.selectImport)(createEvent());
    expect(selected).toMatchObject({
      ok: true,
      value: { status: 'ready', sourceFormat: 'flyd' },
    });
    const selection = selected.value;
    if (selection.status !== 'ready') {
      throw new Error('Expected a ready import selection.');
    }
    await expect(
      handlerFor(DIAGRAM_IPC_CHANNELS.commitImport)(createEvent(), {
        token: selection.token,
        parentId: null,
        importIds: selection.diagrams.map(
          ({ importId }: { importId: string }) => importId,
        ),
      }),
    ).resolves.toMatchObject({ ok: true, value: { nodes: [node] } });
    expect(projectService.importDiagrams).toHaveBeenCalledWith(
      42,
      null,
      expect.arrayContaining([expect.objectContaining({ document })]),
    );
  });

  it('exports without exposing a path and refuses to overwrite an existing file', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-diagram-export-'));
    temporaryDirectories.push(directory);
    const destination = path.join(directory, 'Domain.flyd');
    const projectService = service();
    registerDiagramHandlers({
      projectService,
      isAllowedUrl: () => true,
      selectExportFile: async () => destination,
    });

    await expect(
      handlerFor(DIAGRAM_IPC_CHANNELS.export)(createEvent(), { nodeId, format: 'flyd' }),
    ).resolves.toEqual({
      ok: true,
      value: { fileName: 'Domain.flyd', format: 'flyd' },
    });
    expect(readFileSync(destination, 'utf8')).toContain('"format": "flyoff-diagram"');

    await expect(
      handlerFor(DIAGRAM_IPC_CHANNELS.export)(createEvent(), { nodeId, format: 'flyd' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'collision' } });
  });
});
