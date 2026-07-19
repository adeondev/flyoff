import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectNoteActivityHandlers } from '../../src/main/ipc';
import type { ProjectService } from '../../src/main/projects';
import {
  PROJECT_NOTE_ACTIVITY_IPC_CHANNELS,
  projectSuccess,
} from '../../src/shared/contracts';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
}));

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

describe('project note activity IPC', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards trusted listing and recording through the active sender', async () => {
    const event = { type: 'activated' as const, nodeId: crypto.randomUUID() };
    const service = {
      getNoteActivity: vi.fn(() => Promise.resolve(projectSuccess([]))),
      recordNoteActivity: vi.fn(() =>
        Promise.resolve(
          projectSuccess({
            projectId: crypto.randomUUID(),
            nodeId: event.nodeId,
            activationCount: 1,
            lastActivatedAt: '2026-07-19T12:00:00.000Z',
            lastClosedAt: null,
          }),
        ),
      ),
    } as unknown as ProjectService;
    const unregister = registerProjectNoteActivityHandlers(
      service,
      (url) => url.startsWith('flyoff://app/'),
    );
    const ipcEvent = createEvent();

    await handlerFor(PROJECT_NOTE_ACTIVITY_IPC_CHANNELS.get)(ipcEvent);
    await handlerFor(PROJECT_NOTE_ACTIVITY_IPC_CHANNELS.record)(
      ipcEvent,
      event,
    );
    expect(service.getNoteActivity).toHaveBeenCalledWith(42);
    expect(service.recordNoteActivity).toHaveBeenCalledWith(42, event);

    unregister();
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed events and untrusted origins before service work', () => {
    const service = {
      getNoteActivity: vi.fn(),
      recordNoteActivity: vi.fn(),
    } as unknown as ProjectService;
    registerProjectNoteActivityHandlers(
      service,
      (url) => url.startsWith('flyoff://app/'),
    );

    expect(() =>
      handlerFor(PROJECT_NOTE_ACTIVITY_IPC_CHANNELS.record)(createEvent(), {
        type: 'activated',
        nodeId: 'invalid',
      }),
    ).toThrow('Invalid project note activity event');
    expect(() =>
      handlerFor(PROJECT_NOTE_ACTIVITY_IPC_CHANNELS.get)(
        createEvent('https://attacker.example/'),
      ),
    ).toThrow('untrusted origin');
    expect(service.recordNoteActivity).not.toHaveBeenCalled();
    expect(service.getNoteActivity).not.toHaveBeenCalled();
  });
});
