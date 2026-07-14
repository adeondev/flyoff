import type { IpcMainInvokeEvent } from 'electron';
import { app, BrowserWindow, ipcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  executeApplicationMenuCommand,
  registerMenuCommandHandler,
} from '../../src/main/ipc/menu-commands';
import {
  MENU_COMMAND_CHANNEL,
  type ApplicationMenuCommand,
} from '../../src/shared/contracts';

const electronMocks = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  handle: vi.fn(),
  quit: vi.fn(),
  removeHandler: vi.fn(),
  showAboutPanel: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    quit: electronMocks.quit,
    showAboutPanel: electronMocks.showAboutPanel,
  },
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
  const sender = {
    copy: vi.fn(),
    cut: vi.fn(),
    getZoomLevel: vi.fn(() => 1),
    mainFrame,
    paste: vi.fn(),
    redo: vi.fn(),
    selectAll: vi.fn(),
    setZoomLevel: vi.fn(),
    undo: vi.fn(),
  };

  return {
    event: {
      sender,
      senderFrame: mainFrame,
    } as unknown as IpcMainInvokeEvent,
    sender,
  };
}

function registeredHandler() {
  const handler = vi.mocked(ipcMain.handle).mock.calls[0]?.[1];

  if (!handler) {
    throw new Error('Menu command IPC handler was not registered.');
  }

  return handler;
}

describe('menu command IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a validated command endpoint and executes known webContents actions', () => {
    const { event, sender } = createEvent();
    const unregister = registerMenuCommandHandler((url: string) =>
      url.startsWith('flyoff://app/'),
    );

    expect(ipcMain.handle).toHaveBeenCalledWith(
      MENU_COMMAND_CHANNEL,
      expect.any(Function),
    );

    registeredHandler()(event, 'edit.copy');
    registeredHandler()(event, 'view.zoomIn');
    registeredHandler()(event, 'view.resetZoom');

    expect(sender.copy).toHaveBeenCalledOnce();
    expect(sender.setZoomLevel).toHaveBeenNthCalledWith(1, 1.5);
    expect(sender.setZoomLevel).toHaveBeenNthCalledWith(2, 0);

    unregister();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(MENU_COMMAND_CHANNEL);
  });

  it('executes only known window and application actions', () => {
    const window = {
      close: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isFullScreen: vi.fn(() => false),
      setFullScreen: vi.fn(),
    };
    const { event } = createEvent();
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window as never);

    executeApplicationMenuCommand('file.closeWindow', event);
    executeApplicationMenuCommand('view.toggleFullScreen', event);
    executeApplicationMenuCommand('file.quit', event);
    executeApplicationMenuCommand('help.about', event);

    expect(window.close).toHaveBeenCalledOnce();
    expect(window.setFullScreen).toHaveBeenCalledWith(true);
    expect(app.quit).toHaveBeenCalledOnce();
    expect(app.showAboutPanel).toHaveBeenCalledOnce();
  });

  it('rejects untrusted frames and unknown command identifiers', () => {
    const untrusted = createEvent('https://attacker.example/');
    registerMenuCommandHandler((url: string) => url.startsWith('flyoff://app/'));

    expect(() => registeredHandler()(untrusted.event, 'edit.copy')).toThrow(
      'untrusted origin',
    );

    vi.clearAllMocks();
    const trusted = createEvent();
    registerMenuCommandHandler(() => true);

    expect(() => registeredHandler()(trusted.event, 'developer.execute')).toThrow(
      'Invalid application menu command',
    );
  });

  it.each<ApplicationMenuCommand>([
    'edit.undo',
    'edit.redo',
    'edit.cut',
    'edit.paste',
    'edit.selectAll',
    'view.zoomOut',
  ])('keeps %s inside the explicit command allowlist', (command) => {
    const { event } = createEvent();

    expect(() => executeApplicationMenuCommand(command, event)).not.toThrow();
  });
});
