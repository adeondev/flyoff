import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerBootstrapHandler } from '../../src/main/ipc/bootstrap';
import {
  BOOTSTRAP_STATE_CHANNEL,
  type BootstrapState,
} from '../../src/shared/contracts';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

const state: BootstrapState = {
  platform: 'linux',
  uiLocale: 'pt-BR',
  nativeCore: { coreVersion: '0.1.0', protocolVersion: 1 },
  spellcheck: {
    provider: 'chromium-hunspell',
    canSelectLanguages: true,
    downloadsDictionaries: true,
  },
};

function createEvent(
  senderUrl: string,
  useMainFrame = true,
): IpcMainInvokeEvent {
  const mainFrame = { url: senderUrl };

  return {
    sender: { mainFrame },
    senderFrame: useMainFrame ? mainFrame : { url: senderUrl },
  } as unknown as IpcMainInvokeEvent;
}

function registeredHandler() {
  const handle = vi.mocked(ipcMain.handle);
  const handler = handle.mock.calls[0]?.[1];

  if (!handler) {
    throw new Error('Bootstrap IPC handler was not registered.');
  }

  return handler;
}

describe('bootstrap IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns state only to an allowed main frame', () => {
    const isAllowedUrl = vi.fn(
      (url: string) => url === 'flyoff://app/index.html',
    );
    const unregister = registerBootstrapHandler(state, isAllowedUrl);

    expect(ipcMain.handle).toHaveBeenCalledWith(
      BOOTSTRAP_STATE_CHANNEL,
      expect.any(Function),
    );
    expect(
      registeredHandler()(createEvent('flyoff://app/index.html')),
    ).toBe(state);
    expect(isAllowedUrl).toHaveBeenCalledWith('flyoff://app/index.html');

    unregister();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(
      BOOTSTRAP_STATE_CHANNEL,
    );
  });

  it('rejects subframes even when their URL is allowed', () => {
    registerBootstrapHandler(state, () => true);

    expect(() =>
      registeredHandler()(createEvent('flyoff://app/index.html', false)),
    ).toThrow('only available to the main frame');
  });

  it('rejects main frames outside the renderer URL policy', () => {
    registerBootstrapHandler(
      state,
      (url) => url.startsWith('flyoff://app/'),
    );

    expect(() =>
      registeredHandler()(createEvent('https://attacker.example/')),
    ).toThrow('untrusted origin');
  });
});
