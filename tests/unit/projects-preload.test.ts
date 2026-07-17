import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FlyoffApi,
  MarkdownDocument,
  ProjectPageProperties,
} from '../../src/shared/contracts';
import { PROJECT_IPC_CHANNELS, projectSuccess } from '../../src/shared/contracts';
import '../../src/preload/index';

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron/renderer', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

const flyoffApi = electronMocks.exposeInMainWorld.mock.calls.find(
  ([name]) => name === 'flyoff',
)?.[1];
if (!flyoffApi) {
  throw new Error('Flyoff preload API was not exposed.');
}

const nodeId = '33333333-3333-4333-8333-333333333333';
const revision = 'a'.repeat(64);
const properties: ProjectPageProperties = {
  nodeId,
  pageType: 'markdown',
  contentSizeBytes: 7,
  diskSizeBytes: 320,
  createdAt: '2026-07-15T12:00:00.000Z',
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

describe('project preload bridge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates and forwards root and node path actions', async () => {
    electronMocks.invoke.mockResolvedValue(projectSuccess(null));
    const api = flyoffApi as FlyoffApi;
    await expect(api.revealProjectPath({ nodeId: null })).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      PROJECT_IPC_CHANNELS.revealPath,
      { nodeId: null },
    );

    await expect(api.copyProjectPath({ nodeId })).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      PROJECT_IPC_CHANNELS.copyPath,
      { nodeId },
    );
  });

  it('forwards typed property and protection operations on dedicated channels', async () => {
    const api = flyoffApi as FlyoffApi;
    const password = 'correct horse battery staple';

    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(properties));
    await expect(api.getProjectPageProperties({ nodeId })).resolves.toEqual(
      projectSuccess(properties),
    );
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.getPageProperties,
      { nodeId },
    );

    const readOnlyRequest = { nodeId, expectedRevision: revision, readOnly: true };
    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(properties));
    await api.setProjectPageReadOnly(readOnlyRequest);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.setPageReadOnly,
      readOnlyRequest,
    );

    const protectRequest = { nodeId, expectedRevision: revision, password };
    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(properties));
    await api.protectProjectPage(protectRequest);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.protectPage,
      protectRequest,
    );

    const changeRequest = {
      nodeId,
      expectedRevision: revision,
      currentPassword: 'old password',
      newPassword: password,
    };
    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(properties));
    await api.changeProjectPagePassword(changeRequest);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.changePagePassword,
      changeRequest,
    );

    const removeRequest = {
      nodeId,
      expectedRevision: revision,
      password: 'old password',
    };
    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(properties));
    await api.removeProjectPagePassword(removeRequest);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.removePagePassword,
      removeRequest,
    );

    const unlockRequest = { nodeId, password: 'old password' };
    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(document));
    await expect(api.unlockProjectPage(unlockRequest)).resolves.toEqual(
      projectSuccess(document),
    );
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.unlockPage,
      unlockRequest,
    );

    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(null));
    await expect(api.lockProjectPage({ nodeId })).resolves.toEqual(
      projectSuccess(null),
    );
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.lockPage,
      { nodeId },
    );
  });

  it('rejects malformed sensitive requests before invoking the main process', async () => {
    const api = flyoffApi as FlyoffApi;

    await expect(
      api.protectProjectPage({
        nodeId,
        expectedRevision: revision,
        password: '',
      }),
    ).rejects.toThrow('Invalid project page protection request');
    await expect(
      api.changeProjectPagePassword({
        nodeId,
        expectedRevision: revision,
        currentPassword: '',
        newPassword: 'correct horse battery staple',
      }),
    ).rejects.toThrow('Invalid project page password change request');
    await expect(
      api.setProjectPageReadOnly({
        nodeId: 'invalid',
        expectedRevision: revision,
        readOnly: true,
      }),
    ).rejects.toThrow('Invalid project page read-only request');
    await expect(
      api.lockProjectPage({ nodeId, extra: true } as never),
    ).rejects.toThrow('Invalid project page lock request');
    expect(electronMocks.invoke).not.toHaveBeenCalled();
  });

  it('rejects malformed main-process property, unlock, and lock results', async () => {
    const api = flyoffApi as FlyoffApi;

    electronMocks.invoke.mockResolvedValueOnce(
      projectSuccess({ ...properties, extra: true }),
    );
    await expect(api.getProjectPageProperties({ nodeId })).rejects.toThrow(
      'invalid page properties',
    );

    electronMocks.invoke.mockResolvedValueOnce(
      projectSuccess({ ...document, readOnly: 'no' }),
    );
    await expect(
      api.unlockProjectPage({ nodeId, password: 'old password' }),
    ).rejects.toThrow('invalid Markdown document');

    electronMocks.invoke.mockResolvedValueOnce(projectSuccess('not-null'));
    await expect(api.lockProjectPage({ nodeId })).rejects.toThrow(
      'invalid page lock result',
    );
  });

  it('rejects invalid requests and malformed main-process results', async () => {
    const api = flyoffApi as FlyoffApi;

    await expect(
      api.copyProjectPath({ nodeId: 'invalid' }),
    ).rejects.toThrow('Invalid project path request');
    expect(electronMocks.invoke).not.toHaveBeenCalled();

    electronMocks.invoke.mockResolvedValue({ ok: true, value: 'unexpected' });
    await expect(api.revealProjectPath({ nodeId: null })).rejects.toThrow(
      'invalid path reveal result',
    );
  });
});
