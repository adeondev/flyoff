import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlyoffApi } from '../../src/shared/contracts';
import {
  TWINE_DOCUMENT_TOOL_RESULT_CHANNEL,
  TWINE_GENERATION_EVENT_CHANNEL,
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

describe('Twine diagram preload bridge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts only bounded typed tool results', async () => {
    electronMocks.invoke.mockResolvedValue(undefined);
    await flyoffApi.submitTwineDocumentToolResult({
      requestId: 'request-1',
      callId: 'call-1',
      result: { ok: true, text: '{"status":"applied"}' },
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      TWINE_DOCUMENT_TOOL_RESULT_CHANNEL,
      expect.objectContaining({ callId: 'call-1' }),
    );

    await expect(
      flyoffApi.submitTwineDocumentToolResult({
        requestId: 'request-1',
        callId: 'call-1',
        result: { ok: true, text: 'x'.repeat(600_000) },
      }),
    ).rejects.toThrow('Invalid Twine document tool result');
  });

  it('drops malformed diagram tool events from main', () => {
    const listener = vi.fn();
    flyoffApi.onTwineGenerationEvent(listener);
    const handler = electronMocks.on.mock.calls.find(
      ([channel]) => channel === TWINE_GENERATION_EVENT_CHANNEL,
    )?.[1];

    handler?.({}, {
      requestId: 'request-1',
      type: 'document-tool-call',
      call: {
        id: 'call-1',
        name: 'read_diagram',
        args: { nodeId: 'diagram-1' },
      },
    });
    handler?.({}, {
      requestId: 'request-1',
      type: 'document-tool-call',
      call: {
        id: 'call-2',
        name: 'read_diagram',
        args: { path: 'C:\\secret' },
      },
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
