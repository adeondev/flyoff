import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlyoffApi } from '../../src/shared/contracts';
import {
  TWINE_COPY_CONTENT_CHANNEL,
  TWINE_EXPORT_MARKDOWN_CHANNEL,
  TWINE_QUERY_CONVERSATIONS_CHANNEL,
  TWINE_UPDATE_CONVERSATION_CHANNEL,
} from '../../src/shared/contracts';
import '../../src/preload/index';

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron/renderer', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
  },
  webFrame: { getWordSuggestions: vi.fn() },
}));

const api = mocks.exposeInMainWorld.mock.calls.find(([name]) => name === 'flyoff')
  ?.[1] as FlyoffApi | undefined;
if (!api) {
  throw new Error('Flyoff preload API was not exposed.');
}

describe('Twine content preload bridge', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it('validates and copies Twine content', async () => {
    mocks.invoke.mockResolvedValue({ status: 'success' });

    await expect(
      api.copyTwineContent({ content: '**Answer**', format: 'markdown' }),
    ).resolves.toEqual({ status: 'success' });
    expect(mocks.invoke).toHaveBeenCalledWith(TWINE_COPY_CONTENT_CHANNEL, {
      content: '**Answer**',
      format: 'markdown',
    });
    await expect(
      api.copyTwineContent({ content: '', format: 'text' }),
    ).rejects.toThrow('Invalid Twine copy request.');
  });

  it('validates export requests and results', async () => {
    mocks.invoke.mockResolvedValue({ status: 'canceled' });

    await expect(
      api.exportTwineMarkdown({
        content: '# Answer',
        suggestedName: 'Conversation',
      }),
    ).resolves.toEqual({ status: 'canceled' });
    expect(mocks.invoke).toHaveBeenCalledWith(TWINE_EXPORT_MARKDOWN_CHANNEL, {
      content: '# Answer',
      suggestedName: 'Conversation',
    });

    mocks.invoke.mockResolvedValue({ status: 'unexpected' });
    await expect(
      api.exportTwineMarkdown({
        content: '# Answer',
        suggestedName: 'Conversation',
      }),
    ).rejects.toThrow('invalid Twine export result');
  });

  it('validates history queries and metadata updates', async () => {
    mocks.invoke.mockResolvedValueOnce({ conversations: [], version: 2 });
    await expect(
      api.queryTwineConversations({
        filter: 'all',
        query: 'planejamento',
        sort: 'recent',
      }),
    ).resolves.toEqual({ conversations: [], version: 2 });
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      TWINE_QUERY_CONVERSATIONS_CHANNEL,
      { filter: 'all', query: 'planejamento', sort: 'recent' },
    );

    mocks.invoke.mockResolvedValueOnce({
      activeConversationId: null,
      conversations: [],
      version: 2,
    });
    await expect(
      api.updateTwineConversation({
        id: 'twine-conversation-1',
        pinned: true,
        type: 'pin',
      }),
    ).resolves.toMatchObject({ version: 2 });
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      TWINE_UPDATE_CONVERSATION_CHANNEL,
      {
        id: 'twine-conversation-1',
        pinned: true,
        type: 'pin',
      },
    );
  });
});
