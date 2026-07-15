import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectHandlers } from '../../src/main/ipc/projects';
import type { ProjectService } from '../../src/main/projects';
import {
  PROJECT_FORMAT_VERSION,
  PROJECT_IPC_CHANNELS,
  projectSuccess,
  type ProjectSummary,
} from '../../src/shared/contracts';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
  showOpenDialog: vi.fn(),
  trashItem: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => undefined),
  },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
  },
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
  shell: {
    trashItem: electronMocks.trashItem,
  },
}));

const summary: ProjectSummary = {
  projectId: '11111111-1111-4111-8111-111111111111',
  name: 'Projeto',
  location: 'C:\\Projetos\\Projeto',
  formatVersion: PROJECT_FORMAT_VERSION,
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
    readMarkdown: vi.fn(),
    saveMarkdown: vi.fn(),
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
    expect(() =>
      handlerFor(PROJECT_IPC_CHANNELS.close)(
        createEvent('https://attacker.example/'),
      ),
    ).toThrow('untrusted origin');
  });
});
