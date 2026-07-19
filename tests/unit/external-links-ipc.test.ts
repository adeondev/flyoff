import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain, shell } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerExternalLinkHandler,
  validateExternalUrl,
} from '../../src/main/ipc/external-links';
import { OPEN_EXTERNAL_LINK_CHANNEL } from '../../src/shared/contracts';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

function createEvent(url = 'flyoff://app/index.html') {
  const mainFrame = { url };
  return {
    sender: { mainFrame },
    senderFrame: mainFrame,
  } as unknown as IpcMainInvokeEvent;
}

function registeredHandler() {
  const handler = vi.mocked(ipcMain.handle).mock.calls[0]?.[1];
  if (!handler) {
    throw new Error('External link handler was not registered.');
  }
  return handler;
}

describe('external link IPC', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['https://example.com', 'http://example.com', 'mailto:a@example.com'])(
    'opens a validated external URL: %s',
    async (url) => {
      registerExternalLinkHandler((sender) => sender.startsWith('flyoff://app/'));

      expect(ipcMain.handle).toHaveBeenCalledWith(
        OPEN_EXTERNAL_LINK_CHANNEL,
        expect.any(Function),
      );
      await expect(registeredHandler()(createEvent(), { url })).resolves.toEqual({
        ok: true,
      });
      expect(shell.openExternal).toHaveBeenCalledWith(url);
    },
  );

  it.each([
    ['relative/path', 'invalid-url'],
    ['flyoff://app/note', 'unsupported-scheme'],
    ['javascript:alert(1)', 'unsupported-scheme'],
  ])('rejects unsafe or invalid URLs: %s', (url, error) => {
    expect(validateExternalUrl(url)).toEqual({ ok: false, error });
  });

  it('validates the sender and payload again in main', async () => {
    registerExternalLinkHandler((sender) => sender.startsWith('flyoff://app/'));

    await expect(
      registeredHandler()(createEvent(), { url: 3 }),
    ).resolves.toEqual({ ok: false, error: 'invalid-url' });
    await expect(
      registeredHandler()(createEvent('https://attacker.example'), {
        url: 'https://example.com',
      }),
    ).rejects.toThrow('untrusted origin');
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('returns a bounded error when the OS rejects the request', async () => {
    vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('no handler'));
    registerExternalLinkHandler(() => true);

    await expect(
      registeredHandler()(createEvent(), { url: 'https://example.com' }),
    ).resolves.toEqual({ ok: false, error: 'open-failed' });
  });
});
