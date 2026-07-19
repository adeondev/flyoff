import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectHandlers } from '../../src/main/ipc/projects';
import type { ProjectService } from '../../src/main/projects';
import {
  PROJECT_FORMAT_VERSION,
  PROJECT_IPC_CHANNELS,
  projectSuccess,
  type MarkdownDocument,
  type ProjectPageProperties,
  type ProjectSummary,
} from '../../src/shared/contracts';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
  showOpenDialog: vi.fn(),
  showItemInFolder: vi.fn(),
  trashItem: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => undefined),
  },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
  },
  clipboard: {
    writeText: electronMocks.writeText,
  },
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
  shell: {
    showItemInFolder: electronMocks.showItemInFolder,
    trashItem: electronMocks.trashItem,
  },
}));

const summary: ProjectSummary = {
  projectId: '11111111-1111-4111-8111-111111111111',
  name: 'Projeto',
  location: 'C:\\Projetos\\Projeto',
  formatVersion: PROJECT_FORMAT_VERSION,
};

const nodeId = '33333333-3333-4333-8333-333333333333';
const revision = 'a'.repeat(64);
const properties: ProjectPageProperties = {
  nodeId,
  pageType: 'markdown',
  contentSizeBytes: 7,
  diskSizeBytes: 321,
  createdAt: null,
  modifiedAt: '2026-07-16T12:00:00.000Z',
  revision,
  readOnly: false,
  passwordProtected: true,
  locked: false,
};
const document: MarkdownDocument = {
  nodeId,
  content: '# Flyoff',
  revision,
  readOnly: false,
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

function createService(): ProjectService {
  return {
    selectCreateLocation: vi.fn(() =>
      Promise.resolve(
        projectSuccess({
          token: '22222222-2222-4222-8222-222222222222',
          location: 'C:\\Projetos',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      ),
    ),
    createProject: vi.fn(() => Promise.resolve(projectSuccess(summary))),
    openProject: vi.fn(() => Promise.resolve(projectSuccess(summary))),
    restoreProject: vi.fn(() => Promise.resolve(projectSuccess(summary))),
    closeProject: vi.fn(() => Promise.resolve(projectSuccess(null))),
    getNode: vi.fn(),
    listChildren: vi.fn(),
    createNode: vi.fn(),
    renameNode: vi.fn(),
    moveNode: vi.fn(),
    trashNode: vi.fn(),
    resolvePath: vi.fn(() =>
      Promise.resolve(projectSuccess('C:\\Projetos\\Projeto')),
    ),
    readMarkdown: vi.fn(),
    saveMarkdown: vi.fn(),
    listLinkTargets: vi.fn(() =>
      Promise.resolve(
        projectSuccess([{ name: 'Nota', nodeId, path: 'Pasta/Nota' }]),
      ),
    ),
    getGraph: vi.fn(() =>
      Promise.resolve(
        projectSuccess({
          nodes: [
            {
              connectionCount: 0,
              name: 'Nota',
              nodeId,
              path: 'Pasta/Nota',
            },
          ],
          edges: [],
        }),
      ),
    ),
    resolveInternalLink: vi.fn(() =>
      Promise.resolve(
        projectSuccess({
          status: 'resolved' as const,
          target: {
            locked: false,
            name: 'Nota',
            nodeId,
            path: 'Pasta/Nota',
          },
        }),
      ),
    ),
    listBacklinks: vi.fn(() =>
      Promise.resolve(
        projectSuccess({
          references: [],
          skippedLockedNodeIds: [],
        }),
      ),
    ),
    searchProject: vi.fn(() =>
      Promise.resolve(
        projectSuccess({
          nodeIds: [nodeId],
          previews: [],
          skippedLockedNodeIds: [],
        }),
      ),
    ),
    getPageProperties: vi.fn(() => Promise.resolve(projectSuccess(properties))),
    setPageReadOnly: vi.fn(() => Promise.resolve(projectSuccess(properties))),
    protectPage: vi.fn(() => Promise.resolve(projectSuccess(properties))),
    changePagePassword: vi.fn(() => Promise.resolve(projectSuccess(properties))),
    removePagePassword: vi.fn(() => Promise.resolve(projectSuccess(properties))),
    unlockPage: vi.fn(() => Promise.resolve(projectSuccess(document))),
    lockPage: vi.fn(() => Promise.resolve(projectSuccess(null))),
  } as unknown as ProjectService;
}

describe('project IPC', () => {
  beforeEach(() => vi.clearAllMocks());

  it('selects trusted directories and forwards typed project operations', async () => {
    const service = createService();
    electronMocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\Projetos'],
    });
    const unregister = registerProjectHandlers({
      isAllowedUrl: (url) => url.startsWith('flyoff://app/'),
      projectService: service,
    });
    const event = createEvent();

    await expect(
      handlerFor(PROJECT_IPC_CHANNELS.selectCreateLocation)(event),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(service.selectCreateLocation).toHaveBeenCalledWith(
      42,
      'C:\\Projetos',
    );

    await handlerFor(PROJECT_IPC_CHANNELS.create)(event, {
      selectionToken: '22222222-2222-4222-8222-222222222222',
      name: 'Projeto',
    });
    expect(service.createProject).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ name: 'Projeto' }),
    );

    unregister();
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(
      Object.keys(PROJECT_IPC_CHANNELS).length,
    );
  });

  it('returns cancellation without granting a location token', async () => {
    const service = createService();
    electronMocks.showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });
    registerProjectHandlers({
      isAllowedUrl: () => true,
      projectService: service,
    });

    await expect(
      handlerFor(PROJECT_IPC_CHANNELS.selectCreateLocation)(createEvent()),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    });
    expect(service.selectCreateLocation).not.toHaveBeenCalled();
  });

  it('forwards internal link resolution and backlink operations', async () => {
    const service = createService();
    registerProjectHandlers({
      isAllowedUrl: () => true,
      projectService: service,
    });
    const event = createEvent();
    const request = {
      headingPath: ['Título'],
      path: 'Pasta/Nota',
      sourceNodeId: nodeId,
      syntax: 'wikilink' as const,
    };

    await handlerFor(PROJECT_IPC_CHANNELS.listLinkTargets)(event);
    await handlerFor(PROJECT_IPC_CHANNELS.getGraph)(event);
    await handlerFor(PROJECT_IPC_CHANNELS.resolveInternalLink)(event, request);
    await handlerFor(PROJECT_IPC_CHANNELS.listBacklinks)(event, {
      targetNodeId: nodeId,
    });
    await handlerFor(PROJECT_IPC_CHANNELS.search)(event, {
      query: 'tag:work',
    });

    expect(service.listLinkTargets).toHaveBeenCalledWith(42);
    expect(service.getGraph).toHaveBeenCalledWith(42);
    expect(service.resolveInternalLink).toHaveBeenCalledWith(42, request);
    expect(service.listBacklinks).toHaveBeenCalledWith(42, {
      targetNodeId: nodeId,
    });
    expect(service.searchProject).toHaveBeenCalledWith(42, {
      query: 'tag:work',
    });
  });

  it('returns a typed failure when a native directory dialog fails', async () => {
    const service = createService();
    electronMocks.showOpenDialog.mockRejectedValue(
      new Error('Native dialog unavailable'),
    );
    registerProjectHandlers({
      isAllowedUrl: () => true,
      projectService: service,
    });

    await expect(
      handlerFor(PROJECT_IPC_CHANNELS.open)(createEvent()),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'io-error' },
    });
    expect(service.openProject).not.toHaveBeenCalled();
  });

  it('resolves paths before revealing or copying them', async () => {
    const service = createService();
    registerProjectHandlers({
      isAllowedUrl: () => true,
      projectService: service,
    });
    const event = createEvent();

    await expect(
      handlerFor(PROJECT_IPC_CHANNELS.revealPath)(event, { nodeId: null }),
    ).resolves.toEqual({ ok: true, value: null });
    expect(service.resolvePath).toHaveBeenCalledWith(42, { nodeId: null });
    expect(electronMocks.showItemInFolder).toHaveBeenCalledWith(
      'C:\\Projetos\\Projeto',
    );

    await expect(
      handlerFor(PROJECT_IPC_CHANNELS.copyPath)(event, { nodeId }),
    ).resolves.toEqual({ ok: true, value: null });
    expect(service.resolvePath).toHaveBeenCalledWith(42, { nodeId });
    expect(electronMocks.writeText).toHaveBeenCalledWith(
      'C:\\Projetos\\Projeto',
    );
  });

  it('validates and forwards every page property and protection operation', async () => {
    const service = createService();
    registerProjectHandlers({
      isAllowedUrl: () => true,
      projectService: service,
    });
    const event = createEvent();
    const password = 'correct horse battery staple';

    await expect(
      handlerFor(PROJECT_IPC_CHANNELS.getPageProperties)(event, { nodeId }),
    ).resolves.toEqual(projectSuccess(properties));
    expect(service.getPageProperties).toHaveBeenCalledWith(42, { nodeId });

    const readOnlyRequest = { nodeId, expectedRevision: revision, readOnly: true };
    await handlerFor(PROJECT_IPC_CHANNELS.setPageReadOnly)(
      event,
      readOnlyRequest,
    );
    expect(service.setPageReadOnly).toHaveBeenCalledWith(42, readOnlyRequest);

    const protectRequest = { nodeId, expectedRevision: revision, password };
    await handlerFor(PROJECT_IPC_CHANNELS.protectPage)(event, protectRequest);
    expect(service.protectPage).toHaveBeenCalledWith(42, protectRequest);

    const changeRequest = {
      nodeId,
      expectedRevision: revision,
      currentPassword: 'old password',
      newPassword: password,
    };
    await handlerFor(PROJECT_IPC_CHANNELS.changePagePassword)(
      event,
      changeRequest,
    );
    expect(service.changePagePassword).toHaveBeenCalledWith(42, changeRequest);

    const removeRequest = {
      nodeId,
      expectedRevision: revision,
      password: 'old password',
    };
    await handlerFor(PROJECT_IPC_CHANNELS.removePagePassword)(
      event,
      removeRequest,
    );
    expect(service.removePagePassword).toHaveBeenCalledWith(42, removeRequest);

    const unlockRequest = { nodeId, password: 'old password' };
    await expect(
      handlerFor(PROJECT_IPC_CHANNELS.unlockPage)(event, unlockRequest),
    ).resolves.toEqual(projectSuccess(document));
    expect(service.unlockPage).toHaveBeenCalledWith(42, unlockRequest);

    await expect(
      handlerFor(PROJECT_IPC_CHANNELS.lockPage)(event, { nodeId }),
    ).resolves.toEqual(projectSuccess(null));
    expect(service.lockPage).toHaveBeenCalledWith(42, { nodeId });
  });

  it('rejects page-security payloads before service or privileged work', () => {
    const service = createService();
    registerProjectHandlers({
      isAllowedUrl: (url) => url.startsWith('flyoff://app/'),
      projectService: service,
    });
    const event = createEvent();

    expect(() =>
      handlerFor(PROJECT_IPC_CHANNELS.protectPage)(event, {
        nodeId,
        expectedRevision: revision,
        password: 'correct horse battery staple',
        extra: true,
      }),
    ).toThrow('Invalid project page protection request');
    expect(service.protectPage).not.toHaveBeenCalled();

    expect(() =>
      handlerFor(PROJECT_IPC_CHANNELS.changePagePassword)(event, {
        nodeId,
        expectedRevision: 'invalid',
        currentPassword: 'old password',
        newPassword: 'correct horse battery staple',
      }),
    ).toThrow('Invalid project page password change request');
    expect(service.changePagePassword).not.toHaveBeenCalled();

    expect(() =>
      handlerFor(PROJECT_IPC_CHANNELS.unlockPage)(event, {
        nodeId: 'invalid',
        password: 'old password',
      }),
    ).toThrow('Invalid project page unlock request');
    expect(service.unlockPage).not.toHaveBeenCalled();

    expect(() =>
      handlerFor(PROJECT_IPC_CHANNELS.protectPage)(
        createEvent('https://attacker.example/'),
        { malformed: true },
      ),
    ).toThrow('untrusted origin');
    expect(service.protectPage).not.toHaveBeenCalled();
  });

  it('rejects malformed payloads and untrusted origins', async () => {
    const service = createService();
    registerProjectHandlers({
      isAllowedUrl: (url) => url.startsWith('flyoff://app/'),
      projectService: service,
    });

    await expect(
      handlerFor(PROJECT_IPC_CHANNELS.create)(createEvent(), {
        selectionToken: 'not-a-token',
        name: 'Projeto',
      }),
    ).rejects.toThrow('Invalid project creation request');
    await expect(
      handlerFor(PROJECT_IPC_CHANNELS.copyPath)(createEvent(), {
        nodeId: 'invalid',
      }),
    ).rejects.toThrow('Invalid project path request');
    expect(() =>
      handlerFor(PROJECT_IPC_CHANNELS.close)(
        createEvent('https://attacker.example/'),
      ),
    ).toThrow('untrusted origin');
  });
});
