import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlyoffApi, ProjectPageNode } from '../../src/shared/contracts';
import { DIAGRAM_IPC_CHANNELS, projectSuccess } from '../../src/shared/contracts';
import { createDiagramDocument } from '../../src/shared/diagram';
import '../../src/preload/index';

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  getWordSuggestions: vi.fn(),
}));

vi.mock('electron/renderer', () => ({
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
  webFrame: { getWordSuggestions: electronMocks.getWordSuggestions },
}));

const flyoffApi = electronMocks.exposeInMainWorld.mock.calls.find(
  ([name]) => name === 'flyoff',
)?.[1] as FlyoffApi | undefined;

if (!flyoffApi) {
  throw new Error('Flyoff preload API was not exposed.');
}

const nodeId = '11111111-1111-4111-8111-111111111111';
const revision = 'a'.repeat(64);
const document = createDiagramDocument('class', () => nodeId);
const node: ProjectPageNode = {
      canContainChildren: true,
      extension: '.flyd',
  hasChildren: false,
  kind: 'page',
  name: 'Domain',
  nodeId,
  pageType: 'diagram',
  parentId: null,
};

describe('diagram preload bridge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates create, read and save requests before invoking IPC', async () => {
    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(node));
    await expect(
      flyoffApi.createDiagramDocument({
        parentId: null,
        name: 'Domain',
        diagramType: 'class',
      }),
    ).resolves.toEqual(projectSuccess(node));
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      DIAGRAM_IPC_CHANNELS.create,
      expect.objectContaining({ name: 'Domain' }),
    );

    electronMocks.invoke.mockResolvedValueOnce(
      projectSuccess({ nodeId, document, revision }),
    );
    await expect(flyoffApi.readDiagramDocument({ nodeId })).resolves.toMatchObject({
      ok: true,
      value: { revision },
    });

    electronMocks.invoke.mockResolvedValueOnce(
      projectSuccess({ nodeId, document, revision }),
    );
    await flyoffApi.saveDiagramDocument({
      nodeId,
      document,
      expectedRevision: revision,
    });
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      DIAGRAM_IPC_CHANNELS.save,
      expect.objectContaining({ expectedRevision: revision }),
    );

    await expect(
      flyoffApi.saveDiagramDocument({
        nodeId,
        document: { ...document, documentId: 'invalid' },
        expectedRevision: revision,
      } as never),
    ).rejects.toThrow('Invalid diagram save request');
  });

  it('validates import and export outcomes received from main', async () => {
    const token = '22222222-2222-4222-8222-222222222222';
    const selection = {
      status: 'ready' as const,
      token,
      fileName: 'model.flyd',
      sourceFormat: 'flyd' as const,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      diagrams: [
        {
          importId: '33333333-3333-4333-8333-333333333333',
          suggestedName: 'Domain',
          diagramType: 'class' as const,
          elementCount: 0,
          relationshipCount: 0,
          fidelity: 'exact' as const,
          diagnostics: [],
        },
      ],
    };
    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(selection));
    await expect(flyoffApi.selectDiagramImport()).resolves.toEqual(
      projectSuccess(selection),
    );

    const outcome = { nodes: [node], diagnostics: [] };
    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(outcome));
    await expect(
      flyoffApi.commitDiagramImport({
        token,
        parentId: null,
        importIds: [selection.diagrams[0]!.importId],
      }),
    ).resolves.toEqual(projectSuccess(outcome));

    electronMocks.invoke.mockResolvedValueOnce(
      projectSuccess({ fileName: 'Domain.flyd', format: 'flyd' }),
    );
    await expect(
      flyoffApi.exportDiagram({ nodeId, format: 'flyd' }),
    ).resolves.toMatchObject({ ok: true });

    electronMocks.invoke.mockResolvedValueOnce({ ok: true, value: { path: 'C:\\secret' } });
    await expect(flyoffApi.selectDiagramImport()).rejects.toThrow(
      'invalid diagram import selection',
    );
  });

  it('subscribes to pathless pending-open notifications and validates consumption', async () => {
    const listener = vi.fn();
    const unsubscribe = flyoffApi.onPendingDiagramOpen(listener);
    const handler = electronMocks.on.mock.calls.find(
      ([channel]) => channel === DIAGRAM_IPC_CHANNELS.pendingChanged,
    )?.[1];
    expect(handler).toBeTypeOf('function');
    handler?.({}, 'ignored path');
    expect(listener).toHaveBeenCalledWith();
    unsubscribe();
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      DIAGRAM_IPC_CHANNELS.pendingChanged,
      handler,
    );

    electronMocks.invoke.mockResolvedValueOnce(projectSuccess(null));
    await expect(flyoffApi.consumePendingDiagramOpen()).resolves.toEqual(
      projectSuccess(null),
    );
    electronMocks.invoke.mockResolvedValueOnce(projectSuccess({ path: 'C:\\private' }));
    await expect(flyoffApi.consumePendingDiagramOpen()).rejects.toThrow(
      'invalid pending diagram result',
    );
  });
});
