import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FlyoffApi,
  MarkdownDocument,
  ProjectPageProperties,
} from '../../src/shared/contracts';
import { PROJECT_IPC_CHANNELS, projectSuccess } from '../../src/shared/contracts';
import {
  createDefaultFlyoffPreferences,
  GET_PREFERENCES_CHANNEL,
  SAVE_PREFERENCES_CHANNEL,
  ADD_SPELLCHECK_WORD_CHANNEL,
  APPLY_WINDOW_THEME_CHANNEL,
  CHECK_SPELLCHECK_WORDS_CHANNEL,
  GET_SPELLCHECK_SUGGESTIONS_CHANNEL,
  RESTART_APPLICATION_CHANNEL,
} from '../../src/shared/contracts';
import '../../src/preload/index';

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  getWordSuggestions: vi.fn(),
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
  webFrame: {
    getWordSuggestions: electronMocks.getWordSuggestions,
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

    await expect(api.copyProjectPaths({ nodeIds: [nodeId] })).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      PROJECT_IPC_CHANNELS.copyPaths,
      { nodeIds: [nodeId] },
    );
  });

  it('validates and forwards batch node mutations', async () => {
    const api = flyoffApi as FlyoffApi;
    const secondNodeId = '44444444-4444-4444-8444-444444444444';
    const nodes = [nodeId, secondNodeId].map((currentNodeId, index) => ({
      canContainChildren: true,
      extension: '.md',
      hasChildren: false,
      kind: 'page' as const,
      name: `Note ${index + 1}`,
      nodeId: currentNodeId,
      pageType: 'markdown',
      parentId: null,
    }));
    electronMocks.invoke.mockResolvedValueOnce(
      projectSuccess({
        nodes,
        skippedLockedNodeIds: [],
        updatedDocumentNodeIds: [],
      }),
    );

    await expect(
      api.moveProjectNodes({ nodeIds: [nodeId, secondNodeId], parentId: null }),
    ).resolves.toMatchObject({ ok: true, value: { nodes } });
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.moveNodes,
      { nodeIds: [nodeId, secondNodeId], parentId: null },
    );

    electronMocks.invoke.mockResolvedValueOnce(
      projectSuccess({ nodeIds: [nodeId, secondNodeId] }),
    );
    await expect(
      api.trashProjectNodes({ nodeIds: [nodeId, secondNodeId] }),
    ).resolves.toEqual(
      projectSuccess({ nodeIds: [nodeId, secondNodeId] }),
    );
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.trashNodes,
      { nodeIds: [nodeId, secondNodeId] },
    );

    await expect(
      api.trashProjectNodes({ nodeIds: [] }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('validates preferences in both directions', async () => {
    const api = flyoffApi as FlyoffApi;
    const preferences = createDefaultFlyoffPreferences();
    const snapshot = {
      preferences,
      runtime: { hardwareAccelerationEnabled: true },
      spellcheck: {
        provider: 'chromium-hunspell' as const,
        canSelectLanguages: true,
        downloadsDictionaries: true,
        availableLanguages: ['en-US', 'pt-BR'],
        activeLanguages: ['pt-BR'],
      },
    };

    electronMocks.invoke.mockResolvedValueOnce(snapshot);
    await expect(api.getPreferences()).resolves.toEqual(snapshot);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      GET_PREFERENCES_CHANNEL,
    );

    electronMocks.invoke.mockResolvedValueOnce(snapshot);
    await expect(api.savePreferences(preferences)).resolves.toEqual(snapshot);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      SAVE_PREFERENCES_CHANNEL,
      preferences,
    );

    await expect(
      api.savePreferences({ ...preferences, version: 99 } as never),
    ).rejects.toThrow('Invalid Flyoff preferences');
    electronMocks.invoke.mockResolvedValueOnce({ ...snapshot, extra: true });
    await expect(api.getPreferences()).rejects.toThrow('invalid preferences');

    electronMocks.invoke.mockResolvedValueOnce(undefined);
    await expect(api.applyWindowTheme('basalt')).resolves.toBeUndefined();
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      APPLY_WINDOW_THEME_CHANNEL,
      'basalt',
    );

    electronMocks.invoke.mockResolvedValueOnce(undefined);
    await expect(api.restartApplication()).resolves.toBeUndefined();
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      RESTART_APPLICATION_CHANNEL,
    );
  });

  it('exposes bounded spellcheck suggestions and dictionary updates', async () => {
    const api = flyoffApi as FlyoffApi;
    electronMocks.invoke.mockResolvedValueOnce([
      'configura\u00e7\u00e3o',
    ]);

    await expect(
      api.getSpellcheckSuggestions({ word: 'configurass\u00e3o' }),
    ).resolves.toEqual(['configura\u00e7\u00e3o']);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      GET_SPELLCHECK_SUGGESTIONS_CHANNEL,
      { word: 'configurass\u00e3o' },
    );
    electronMocks.invoke.mockResolvedValueOnce(['configurass\u00e3o']);
    await expect(
      api.checkSpellcheckWords({ words: ['configurass\u00e3o'] }),
    ).resolves.toEqual(['configurass\u00e3o']);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      CHECK_SPELLCHECK_WORDS_CHANNEL,
      { words: ['configurass\u00e3o'] },
    );
    electronMocks.invoke.mockResolvedValueOnce(true);
    await expect(
      api.addSpellcheckWord({ word: 'Flyoff' }),
    ).resolves.toBe(true);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      ADD_SPELLCHECK_WORD_CHANNEL,
      { word: 'Flyoff' },
    );
    await expect(
      api.getSpellcheckSuggestions({ word: 'duas palavras' }),
    ).rejects.toThrow('Invalid spellcheck word request');
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

  it('validates internal link requests and results across the bridge', async () => {
    const api = flyoffApi as FlyoffApi;
    const target = { name: 'Nota', nodeId, path: 'Pasta/Nota' };
    const request = {
      headingPath: ['Título'],
      path: 'Pasta/Nota',
      sourceNodeId: nodeId,
      syntax: 'wikilink' as const,
    };

    electronMocks.invoke.mockResolvedValueOnce(projectSuccess([target]));
    await expect(api.listProjectLinkTargets()).resolves.toEqual(
      projectSuccess([target]),
    );
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.listLinkTargets,
    );

    const graph = {
      nodes: [{ ...target, connectionCount: 0 }],
      edges: [],
    };
    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(graph));
    await expect(api.getProjectGraph()).resolves.toEqual(projectSuccess(graph));
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.getGraph,
    );

    electronMocks.invoke.mockResolvedValueOnce(
      projectSuccess({
        status: 'resolved',
        target: { ...target, locked: false },
      }),
    );
    await expect(api.resolveProjectInternalLink(request)).resolves.toMatchObject(
      { ok: true, value: { status: 'resolved' } },
    );
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.resolveInternalLink,
      request,
    );

    const backlinks = { references: [], skippedLockedNodeIds: [] };
    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(backlinks));
    await expect(
      api.listProjectBacklinks({ targetNodeId: nodeId }),
    ).resolves.toEqual(projectSuccess(backlinks));
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.listBacklinks,
      { targetNodeId: nodeId },
    );

    const search = {
      nodeIds: [nodeId],
      previews: [],
      skippedLockedNodeIds: [],
    };
    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(search));
    await expect(
      api.searchProject({ query: 'tag:work' }),
    ).resolves.toEqual(projectSuccess(search));
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_IPC_CHANNELS.search,
      { query: 'tag:work' },
    );

    await expect(
      api.resolveProjectInternalLink({
        ...request,
        sourceNodeId: 'invalid',
      }),
    ).rejects.toThrow('Invalid project internal link request');
    await expect(api.searchProject({ query: ' ' })).rejects.toThrow(
      'Invalid project search request',
    );

    electronMocks.invoke.mockResolvedValueOnce(
      projectSuccess({
        nodes: [{ ...target, connectionCount: -1 }],
        edges: [],
      }),
    );
    await expect(api.getProjectGraph()).rejects.toThrow(
      'invalid project graph',
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
    await expect(
      api.copyProjectPaths({ nodeIds: [] }),
    ).rejects.toThrow('Invalid project paths request');
    expect(electronMocks.invoke).not.toHaveBeenCalled();

    electronMocks.invoke.mockResolvedValue({ ok: true, value: 'unexpected' });
    await expect(api.revealProjectPath({ nodeId: null })).rejects.toThrow(
      'invalid path reveal result',
    );
  });
});
