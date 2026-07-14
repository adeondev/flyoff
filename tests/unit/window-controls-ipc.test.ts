import type { IpcMainInvokeEvent } from 'electron';
import { BrowserWindow, ipcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerWindowControlHandlers } from '../../src/main/ipc';
import {
  WINDOW_CONTROL_CHANNEL,
  WINDOW_STATE_CHANNEL,
} from '../../src/shared/contracts';

const electronMocks = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: electronMocks.fromWebContents,
  },
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
}));

function createEvent(url = 'flyoff://app/index.html') {
  const mainFrame = { url };
  const sender = { mainFrame };

  return {
    sender,
    senderFrame: mainFrame,
  } as unknown as IpcMainInvokeEvent;
}

function handlerFor(channel: string) {
  const handler = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([registeredChannel]) => registeredChannel === channel)?.[1];

  if (!handler) {
    throw new Error(`IPC handler was not registered for ${channel}.`);
  }

  return handler;
}

function createWindow() {
  let maximized = false;

  return {
    close: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMaximized: vi.fn(() => maximized),
    maximize: vi.fn(() => {
      maximized = true;
    }),
    minimize: vi.fn(),
    unmaximize: vi.fn(() => {
      maximized = false;
    }),
  };
}

describe('custom window control IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads state and performs only the three supported actions', () => {
    const window = createWindow();
    const event = createEvent();
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window as never);

    const unregister = registerWindowControlHandlers((url) =>
      url.startsWith('flyoff://app/'),
    );

    expect(handlerFor(WINDOW_STATE_CHANNEL)(event)).toEqual({
      maximized: false,
    });
    expect(handlerFor(WINDOW_CONTROL_CHANNEL)(event, 'minimize')).toEqual({
      maximized: false,
    });
    expect(window.minimize).toHaveBeenCalledOnce();

    expect(
      handlerFor(WINDOW_CONTROL_CHANNEL)(event, 'toggle-maximize'),
    ).toEqual({ maximized: true });
    expect(window.maximize).toHaveBeenCalledOnce();

    expect(
      handlerFor(WINDOW_CONTROL_CHANNEL)(event, 'toggle-maximize'),
    ).toEqual({ maximized: false });
    expect(window.unmaximize).toHaveBeenCalledOnce();

    expect(handlerFor(WINDOW_CONTROL_CHANNEL)(event, 'close')).toEqual({
      maximized: false,
    });
    expect(window.close).toHaveBeenCalledOnce();

    unregister();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(WINDOW_STATE_CHANNEL);
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(
      WINDOW_CONTROL_CHANNEL,
    );
  });

  it('rejects unknown actions, untrusted senders and missing windows', () => {
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(
      createWindow() as never,
    );
    registerWindowControlHandlers((url) =>
      url.startsWith('flyoff://app/'),
    );

    expect(() =>
      handlerFor(WINDOW_CONTROL_CHANNEL)(createEvent(), 'move'),
    ).toThrow('Invalid window control action');
    expect(() =>
      handlerFor(WINDOW_CONTROL_CHANNEL)(
        createEvent('https://attacker.example/'),
        'close',
      ),
    ).toThrow('untrusted origin');

    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null);
    expect(() => handlerFor(WINDOW_STATE_CHANNEL)(createEvent())).toThrow(
      'active Flyoff window',
    );
  });
});
