import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTwineHandlers } from '../../src/main/ipc/twine';
import {
  TWINE_DOCUMENT_TOOL_RESULT_CHANNEL,
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

function event(url = 'flyoff://app/index.html'): IpcMainInvokeEvent {
  const mainFrame = { url };
  return {
    sender: { id: 7, mainFrame },
    senderFrame: mainFrame,
  } as unknown as IpcMainInvokeEvent;
}

function handlerFor(channel: string) {
  const handler = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([registered]) => registered === channel)?.[1];
  if (!handler) {
    throw new Error(`No handler for ${channel}.`);
  }
  return handler;
}

function register(submitDocumentToolResult = vi.fn(() => true)) {
  const generationService = {
    cancel: vi.fn(),
    cancelAll: vi.fn(),
    start: vi.fn(),
    submitDocumentToolResult,
  };
  const unregister = registerTwineHandlers({
    conversationStore: {
      create: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      load: vi.fn(),
      save: vi.fn(),
    } as never,
    credentialStore: {
      getApiKey: vi.fn(),
      getStatus: vi.fn(),
      removeApiKey: vi.fn(),
      saveApiKey: vi.fn(),
    } as never,
    generationService: generationService as never,
    isAllowedUrl: (url) => url.startsWith('flyoff://app/'),
  });
  return { generationService, unregister };
}

describe('Twine diagram IPC', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates the trusted result before resuming generation', async () => {
    const { generationService, unregister } = register();
    const submission = {
      requestId: 'request-1',
      callId: 'call-1',
      result: { ok: true, text: '{"status":"applied"}' },
    };

    await handlerFor(TWINE_DOCUMENT_TOOL_RESULT_CHANNEL)(
      event(),
      submission,
    );
    expect(
      generationService.submitDocumentToolResult,
    ).toHaveBeenCalledWith(submission);
    expect(() =>
      handlerFor(TWINE_DOCUMENT_TOOL_RESULT_CHANNEL)(event(), {
        ...submission,
        result: { ok: true, text: 'x'.repeat(600_000) },
      }),
    ).toThrow(TypeError);
    expect(() =>
      handlerFor(TWINE_DOCUMENT_TOOL_RESULT_CHANNEL)(
        event('https://evil.test'),
        submission,
      ),
    ).toThrow();

    unregister();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(
      TWINE_DOCUMENT_TOOL_RESULT_CHANNEL,
    );
  });

  it('rejects results for tool calls that are no longer active', () => {
    register(vi.fn(() => false));

    expect(() =>
      handlerFor(TWINE_DOCUMENT_TOOL_RESULT_CHANNEL)(event(), {
        requestId: 'request-1',
        callId: 'call-1',
        result: { ok: false, text: 'rejected' },
      }),
    ).toThrow('no longer active');
  });
});
