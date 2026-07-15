import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTabSessionHandlers } from '../../src/main/ipc/tab-session';
import type { TabSessionStore } from '../../src/main/session';
import {
  GET_RESTORABLE_TAB_SESSION_CHANNEL,
  RESOLVE_RESTORABLE_TAB_SESSION_CHANNEL,
  SAVE_TAB_SESSION_CHANNEL,
  TAB_SESSION_VERSION,
  type TabSessionSnapshot,
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

const session: TabSessionSnapshot = {
  version: TAB_SESSION_VERSION,
  tabs: [
    {
      tabId: 'page:home',
      target: { type: 'internal', pageId: 'home' },
      scrollTop: 0,
      pageState: { version: 1, data: {} },
    },
  ],
  activeTabId: 'page:home',
};

function createEvent(url = 'flyoff://app/index.html') {
  const mainFrame = { url };
  return { sender: { mainFrame }, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
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

function createStore() {
  return {
    getRestorableSession: vi.fn(() => session),
    resolveRestorableSession: vi.fn(),
    save: vi.fn(),
  } as unknown as TabSessionStore;
}

describe('tab session IPC', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers trusted get, resolve and save handlers', () => {
    const store = createStore();
    const unregister = registerTabSessionHandlers(
      store,
      (url) => url.startsWith('flyoff://app/'),
    );
    const event = createEvent();

    expect(handlerFor(GET_RESTORABLE_TAB_SESSION_CHANNEL)(event)).toBe(session);
    handlerFor(RESOLVE_RESTORABLE_TAB_SESSION_CHANNEL)(
      event,
      'restore',
      session,
    );
    handlerFor(SAVE_TAB_SESSION_CHANNEL)(event, session);

    expect(store.resolveRestorableSession).toHaveBeenCalledWith(session);
    expect(store.save).toHaveBeenCalledWith(session);

    unregister();
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid payloads and untrusted origins', () => {
    const store = createStore();
    registerTabSessionHandlers(
      store,
      (url) => url.startsWith('flyoff://app/'),
    );

    expect(() =>
      handlerFor(RESOLVE_RESTORABLE_TAB_SESSION_CHANNEL)(
        createEvent(),
        'later',
        session,
      ),
    ).toThrow('Invalid tab session restoration decision');
    expect(() =>
      handlerFor(SAVE_TAB_SESSION_CHANNEL)(createEvent(), { tabs: [] }),
    ).toThrow('Invalid tab session snapshot');
    expect(() =>
      handlerFor(GET_RESTORABLE_TAB_SESSION_CHANNEL)(
        createEvent('https://attacker.example/'),
      ),
    ).toThrow('untrusted origin');
  });
});
