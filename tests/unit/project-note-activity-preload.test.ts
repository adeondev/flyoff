import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlyoffApi } from '../../src/shared/contracts';
import {
  PROJECT_NOTE_ACTIVITY_IPC_CHANNELS,
  projectSuccess,
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
)?.[1] as FlyoffApi | undefined;

if (!flyoffApi) {
  throw new Error('Flyoff preload API was not exposed.');
}

describe('project note activity preload bridge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates activity in both directions', async () => {
    const nodeId = '22222222-2222-4222-8222-222222222222';
    const entry = {
      projectId: '11111111-1111-4111-8111-111111111111',
      nodeId,
      activationCount: 1,
      lastActivatedAt: '2026-07-19T12:00:00.000Z',
      lastClosedAt: null,
    };
    electronMocks.invoke.mockResolvedValueOnce(projectSuccess([entry]));
    await expect(flyoffApi.getProjectNoteActivity()).resolves.toEqual(
      projectSuccess([entry]),
    );
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_NOTE_ACTIVITY_IPC_CHANNELS.get,
    );

    const event = { type: 'closed' as const, nodeId };
    electronMocks.invoke.mockResolvedValueOnce(
      projectSuccess({ ...entry, lastClosedAt: '2026-07-19T12:01:00.000Z' }),
    );
    await expect(flyoffApi.recordProjectNoteActivity(event)).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      PROJECT_NOTE_ACTIVITY_IPC_CHANNELS.record,
      event,
    );
  });

  it('rejects malformed renderer events and main-process results', async () => {
    await expect(
      flyoffApi.recordProjectNoteActivity({
        type: 'activated',
        nodeId: 'invalid',
      }),
    ).rejects.toThrow('Invalid project note activity event');
    expect(electronMocks.invoke).not.toHaveBeenCalled();

    electronMocks.invoke.mockResolvedValueOnce(
      projectSuccess([
        {
          projectId: crypto.randomUUID(),
          nodeId: crypto.randomUUID(),
          activationCount: -1,
          lastActivatedAt: null,
          lastClosedAt: null,
        },
      ]),
    );
    await expect(flyoffApi.getProjectNoteActivity()).rejects.toThrow(
      'invalid project note activity',
    );
  });
});
