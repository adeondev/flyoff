import type {
  BrowserWindow,
  IpcMainInvokeEvent,
} from 'electron';
import { app, ipcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CloseCoordinator } from '../../src/main/lifecycle';
import type { TabSessionStore } from '../../src/main/session';
import {
  CLOSE_REQUESTED_CHANNEL,
  CLOSE_RESPONSE_CHANNEL,
  RESTART_APPLICATION_CHANNEL,
  WORKSPACE_SESSION_VERSION,
  type CloseRequest,
  type WorkspaceSessionSnapshot,
} from '../../src/shared/contracts';

type Listener = (...arguments_: unknown[]) => void;

const electronMocks = vi.hoisted(() => ({
  appHandlers: new Map<string, Listener>(),
  appOff: vi.fn(),
  appOn: vi.fn((event: string, listener: Listener) => {
    electronMocks.appHandlers.set(event, listener);
  }),
  fromWebContents: vi.fn(),
  getAllWindows: vi.fn(() => [] as BrowserWindow[]),
  getFocusedWindow: vi.fn(),
  handle: vi.fn(),
  quit: vi.fn(),
  relaunch: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    off: electronMocks.appOff,
    on: electronMocks.appOn,
    quit: electronMocks.quit,
    relaunch: electronMocks.relaunch,
  },
  BrowserWindow: {
    fromWebContents: electronMocks.fromWebContents,
    getAllWindows: electronMocks.getAllWindows,
    getFocusedWindow: electronMocks.getFocusedWindow,
  },
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
}));

const session: WorkspaceSessionSnapshot = {
  version: WORKSPACE_SESSION_VERSION,
  home: {
    root: {
      kind: 'pane',
      paneId: 'home-pane-1',
      tabs: [
        {
          tabId: 'page:home',
          target: { type: 'internal', pageId: 'home' },
          scrollTop: 0,
          pageState: { version: 1, data: {} },
        },
        {
          tabId: 'page:settings',
          target: { type: 'internal', pageId: 'settings' },
          scrollTop: 0,
          pageState: { version: 1, data: {} },
        },
      ],
      activeTabId: 'page:settings',
    },
    activePaneId: 'home-pane-1',
  },
  project: null,
};

function createEmitter() {
  const listeners = new Map<string, Set<Listener>>();

  return {
    emit(event: string, ...arguments_: unknown[]) {
      for (const listener of listeners.get(event) ?? []) {
        listener(...arguments_);
      }
    },
    off: vi.fn((event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
    }),
    on: vi.fn((event: string, listener: Listener) => {
      const eventListeners = listeners.get(event) ?? new Set<Listener>();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    once: vi.fn((event: string, listener: Listener) => {
      const onceListener: Listener = (...arguments_) => {
        listeners.get(event)?.delete(onceListener);
        listener(...arguments_);
      };
      const eventListeners = listeners.get(event) ?? new Set<Listener>();
      eventListeners.add(onceListener);
      listeners.set(event, eventListeners);
    }),
  };
}

function createWindow() {
  const windowEvents = createEmitter();
  const webContentsEvents = createEmitter();
  const mainFrame = { url: 'flyoff://app/index.html' };
  const webContents = {
    ...webContentsEvents,
    isDestroyed: vi.fn(() => false),
    isLoadingMainFrame: vi.fn(() => false),
    mainFrame,
    send: vi.fn(),
  };
  const window = {
    ...windowEvents,
    close: vi.fn(),
    isDestroyed: vi.fn(() => false),
    webContents,
  };

  return { webContents, window };
}

function createStore() {
  return {
    flush: vi.fn(),
    saveFinal: vi.fn(),
  } as unknown as TabSessionStore;
}

function responseHandler() {
  const handler = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([channel]) => channel === CLOSE_RESPONSE_CHANNEL)?.[1];

  if (!handler) {
    throw new Error('Close response handler was not registered.');
  }

  return handler;
}

function restartHandler() {
  const handler = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(
      ([channel]) => channel === RESTART_APPLICATION_CHANNEL,
    )?.[1];

  if (!handler) {
    throw new Error('Restart handler was not registered.');
  }

  return handler;
}

function latestRequest(webContents: ReturnType<typeof createWindow>['webContents']) {
  const request = webContents.send.mock.calls.at(-1)?.[1] as
    | CloseRequest
    | undefined;

  if (!request) {
    throw new Error('Close request was not sent.');
  }

  return request;
}

function invokeResponse(
  webContents: ReturnType<typeof createWindow>['webContents'],
  response: unknown,
) {
  return responseHandler()(
    {
      sender: webContents,
      senderFrame: webContents.mainFrame,
    } as unknown as IpcMainInvokeEvent,
    response,
  );
}

describe('CloseCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.appHandlers.clear();
    electronMocks.getAllWindows.mockReturnValue([]);
    electronMocks.getFocusedWindow.mockReturnValue(undefined);
  });

  it('cancels a window close without dismantling the application', () => {
    const store = createStore();
    const onShutdownApproved = vi.fn();
    const coordinator = new CloseCoordinator({
      isAllowedUrl: (url) => url.startsWith('flyoff://app/'),
      onShutdownApproved,
      smokeTest: false,
      tabSessionStore: store,
    });
    const created = createWindow();
    electronMocks.fromWebContents.mockReturnValue(created.window);
    coordinator.attachWindow(created.window as unknown as BrowserWindow);
    const event = { preventDefault: vi.fn() };

    created.window.emit('close', event);
    const request = latestRequest(created.webContents);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(created.webContents.send).toHaveBeenCalledWith(
      CLOSE_REQUESTED_CHANNEL,
      request,
    );

    invokeResponse(created.webContents, {
      requestId: request.requestId,
      decision: 'cancel',
    });

    expect(store.saveFinal).not.toHaveBeenCalled();
    expect(created.window.close).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    expect(onShutdownApproved).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('saves the final snapshot and closes exactly once after confirmation', () => {
    const store = createStore();
    const coordinator = new CloseCoordinator({
      isAllowedUrl: () => true,
      smokeTest: false,
      tabSessionStore: store,
    });
    const created = createWindow();
    electronMocks.fromWebContents.mockReturnValue(created.window);
    coordinator.attachWindow(created.window as unknown as BrowserWindow);

    created.window.emit('close', { preventDefault: vi.fn() });
    const request = latestRequest(created.webContents);
    invokeResponse(created.webContents, {
      requestId: request.requestId,
      decision: 'confirm',
      session,
    });

    expect(store.saveFinal).toHaveBeenCalledWith(session);
    expect(created.window.close).toHaveBeenCalledOnce();
    coordinator.dispose();
  });

  it('closes the window after confirmation when the final snapshot cannot be saved', () => {
    const store = createStore();
    vi.mocked(store.saveFinal).mockImplementation(() => {
      throw new Error('disk unavailable');
    });
    const coordinator = new CloseCoordinator({
      isAllowedUrl: () => true,
      smokeTest: false,
      tabSessionStore: store,
    });
    const created = createWindow();
    electronMocks.fromWebContents.mockReturnValue(created.window);
    coordinator.attachWindow(created.window as unknown as BrowserWindow);

    created.window.emit('close', { preventDefault: vi.fn() });
    const request = latestRequest(created.webContents);

    expect(() =>
      invokeResponse(created.webContents, {
        requestId: request.requestId,
        decision: 'confirm',
        session,
      }),
    ).not.toThrow();
    expect(created.window.close).toHaveBeenCalledOnce();

    expect(() =>
      invokeResponse(created.webContents, {
        requestId: request.requestId,
        decision: 'cancel',
      }),
    ).toThrow('no longer active');
    coordinator.dispose();
  });

  it('gates application quit and rejects stale responses', () => {
    const store = createStore();
    const onShutdownApproved = vi.fn();
    const coordinator = new CloseCoordinator({
      isAllowedUrl: () => true,
      onShutdownApproved,
      smokeTest: false,
      tabSessionStore: store,
    });
    const created = createWindow();
    electronMocks.fromWebContents.mockReturnValue(created.window);
    electronMocks.getFocusedWindow.mockReturnValue(
      created.window as unknown as BrowserWindow,
    );
    electronMocks.getAllWindows.mockReturnValue([
      created.window as unknown as BrowserWindow,
    ]);
    const event = { preventDefault: vi.fn() };

    electronMocks.appHandlers.get('before-quit')?.(event);
    const request = latestRequest(created.webContents);
    expect(request.intent).toBe('quit-application');
    expect(event.preventDefault).toHaveBeenCalledOnce();

    expect(() =>
      invokeResponse(created.webContents, {
        requestId: 'stale-request',
        decision: 'cancel',
      }),
    ).toThrow('no longer active');

    invokeResponse(created.webContents, {
      requestId: request.requestId,
      decision: 'confirm',
      session,
    });
    expect(app.quit).toHaveBeenCalledOnce();
    expect(onShutdownApproved).toHaveBeenCalledOnce();
    expect(onShutdownApproved.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(app.quit).mock.invocationCallOrder[0] ?? Number.MAX_VALUE,
    );
    coordinator.dispose();
  });

  it('restarts only after a trusted request is confirmed and the session is saved', () => {
    const store = createStore();
    const coordinator = new CloseCoordinator({
      isAllowedUrl: (url) => url.startsWith('flyoff://app/'),
      smokeTest: false,
      tabSessionStore: store,
    });
    const created = createWindow();
    electronMocks.fromWebContents.mockReturnValue(created.window);
    electronMocks.getAllWindows.mockReturnValue([
      created.window as unknown as BrowserWindow,
    ]);
    const event = {
      sender: created.webContents,
      senderFrame: created.webContents.mainFrame,
    } as unknown as IpcMainInvokeEvent;

    restartHandler()(event);
    restartHandler()(event);
    const request = latestRequest(created.webContents);
    expect(request.intent).toBe('restart-application');
    expect(created.webContents.send).toHaveBeenCalledTimes(1);

    invokeResponse(created.webContents, {
      requestId: request.requestId,
      decision: 'confirm',
      session,
    });

    expect(store.saveFinal).toHaveBeenCalledWith(session);
    expect(app.relaunch).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
    expect(vi.mocked(app.relaunch).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(app.quit).mock.invocationCallOrder[0] ?? Number.MAX_VALUE,
    );
    coordinator.dispose();
  });

  it('keeps the application open when restart is canceled', () => {
    const coordinator = new CloseCoordinator({
      isAllowedUrl: () => true,
      smokeTest: false,
      tabSessionStore: createStore(),
    });
    const created = createWindow();
    electronMocks.fromWebContents.mockReturnValue(created.window);
    restartHandler()({
      sender: created.webContents,
      senderFrame: created.webContents.mainFrame,
    } as unknown as IpcMainInvokeEvent);
    const request = latestRequest(created.webContents);

    invokeResponse(created.webContents, {
      requestId: request.requestId,
      decision: 'cancel',
    });

    expect(app.relaunch).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('quits after confirmation when the final snapshot cannot be saved', () => {
    const store = createStore();
    vi.mocked(store.saveFinal).mockImplementation(() => {
      throw new Error('disk unavailable');
    });
    const coordinator = new CloseCoordinator({
      isAllowedUrl: () => true,
      smokeTest: false,
      tabSessionStore: store,
    });
    const created = createWindow();
    electronMocks.fromWebContents.mockReturnValue(created.window);
    electronMocks.getFocusedWindow.mockReturnValue(
      created.window as unknown as BrowserWindow,
    );
    electronMocks.getAllWindows.mockReturnValue([
      created.window as unknown as BrowserWindow,
    ]);

    electronMocks.appHandlers.get('before-quit')?.({
      preventDefault: vi.fn(),
    });
    const request = latestRequest(created.webContents);

    expect(() =>
      invokeResponse(created.webContents, {
        requestId: request.requestId,
        decision: 'confirm',
        session,
      }),
    ).not.toThrow();
    expect(app.quit).toHaveBeenCalledOnce();
    coordinator.dispose();
  });

  it('rejects untrusted response frames', () => {
    const coordinator = new CloseCoordinator({
      isAllowedUrl: (url) => url.startsWith('flyoff://app/'),
      smokeTest: false,
      tabSessionStore: createStore(),
    });
    const created = createWindow();
    coordinator.attachWindow(created.window as unknown as BrowserWindow);
    created.window.emit('close', { preventDefault: vi.fn() });
    const request = latestRequest(created.webContents);
    created.webContents.mainFrame.url = 'https://attacker.example/';

    expect(() =>
      invokeResponse(created.webContents, {
        requestId: request.requestId,
        decision: 'cancel',
      }),
    ).toThrow('untrusted origin');
    coordinator.dispose();
  });

  it('detaches listeners without reading webContents after the window is destroyed', () => {
    const coordinator = new CloseCoordinator({
      isAllowedUrl: () => true,
      smokeTest: false,
      tabSessionStore: createStore(),
    });
    const created = createWindow();
    let destroyed = false;

    Object.defineProperty(created.window, 'webContents', {
      configurable: true,
      get() {
        if (destroyed) {
          throw new Error('Object has been destroyed');
        }

        return created.webContents;
      },
    });

    coordinator.attachWindow(created.window as unknown as BrowserWindow);
    destroyed = true;

    expect(() => created.window.emit('closed')).not.toThrow();
    expect(created.webContents.off).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });
});
