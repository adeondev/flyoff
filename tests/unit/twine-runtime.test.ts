// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getTwineRuntime,
  resetTwineRuntimeForTests,
} from '../../src/renderer/twine/twine-runtime';
import type {
  FlyoffApi,
  TwineConversationSnapshot,
  TwineConversationStoreSnapshot,
} from '../../src/shared/contracts';

function conversation(id = 'twine-conversation-1'): TwineConversationSnapshot {
  return {
    activityAt: 1,
    archivedAt: null,
    createdAt: 1,
    draft: '',
    id,
    nextId: 2,
    pinnedAt: null,
    state: {
      activeBranchId: 'twine-root',
      branches: {
        'twine-root': {
          id: 'twine-root',
          messages: [
            {
              attachments: [],
              id: 'message-1',
              kind: 'user',
              status: 'complete',
              text: 'Conversation',
            },
          ],
        },
      },
    },
    title: 'Conversation',
    titleMode: 'automatic',
    version: 2,
  };
}

function summary(): TwineConversationStoreSnapshot {
  return {
    activeConversationId: 'twine-conversation-1',
    conversations: [
      {
        activityAt: 1,
        archivedAt: null,
        createdAt: 1,
        id: 'twine-conversation-1',
        pinnedAt: null,
        title: 'Conversation',
        titleMode: 'automatic',
      },
    ],
    version: 2,
  };
}

afterEach(() => {
  resetTwineRuntimeForTests();
});

describe('Twine runtime', () => {
  it('serializes saves so an older snapshot cannot overwrite a newer one', async () => {
    const resolvers: Array<() => void> = [];
    const savedDrafts: string[] = [];
    const saveTwineConversation = vi.fn(
      (snapshot: TwineConversationSnapshot) =>
        new Promise<TwineConversationStoreSnapshot>((resolve) => {
          savedDrafts.push(snapshot.draft ?? '');
          resolvers.push(() => resolve(summary()));
        }),
    );
    const api: Partial<FlyoffApi> = {
      createTwineConversation: vi.fn().mockResolvedValue(conversation()),
      listTwineConversations: vi.fn().mockResolvedValue(summary()),
      loadTwineConversation: vi.fn().mockResolvedValue(conversation()),
      saveTwineConversation,
    };
    const runtime = getTwineRuntime();
    runtime.connect(api);
    await runtime.loadHistory('twine-conversation-1', 'New conversation');

    runtime.setDraft('first');
    const firstSave = runtime.flushSave();
    await vi.waitFor(() => expect(saveTwineConversation).toHaveBeenCalledTimes(1));
    runtime.setDraft('latest');
    const latestSave = runtime.flushSave();

    expect(saveTwineConversation).toHaveBeenCalledTimes(1);
    resolvers.shift()?.();
    await vi.waitFor(() => expect(saveTwineConversation).toHaveBeenCalledTimes(2));
    resolvers.shift()?.();
    await Promise.all([firstSave, latestSave]);

    expect(savedDrafts).toEqual(['first', 'latest']);
  });

  it('keeps the active conversation, draft, and scroll outside React mounts', async () => {
    const runtime = getTwineRuntime();
    runtime.connect({
      createTwineConversation: vi.fn().mockResolvedValue(conversation()),
      listTwineConversations: vi.fn().mockResolvedValue(summary()),
      loadTwineConversation: vi.fn().mockResolvedValue(conversation()),
    });
    await runtime.loadHistory('twine-conversation-1', 'New conversation');
    runtime.setDraft('survives the pane move');
    runtime.setScrollState('twine-conversation-1', {
      follow: false,
      scrollTop: 320,
    });

    expect(getTwineRuntime().getSnapshot()).toMatchObject({
      conversationId: 'twine-conversation-1',
      draft: 'survives the pane move',
    });
    expect(
      getTwineRuntime().getScrollState('twine-conversation-1'),
    ).toEqual({ follow: false, scrollTop: 320 });
  });

  it('keeps a new empty conversation out of history until the first message', async () => {
    const runtime = getTwineRuntime();
    runtime.connect({
      createTwineConversation: vi.fn().mockResolvedValue(conversation()),
      listTwineConversations: vi.fn().mockResolvedValue({
        activeConversationId: null,
        conversations: [],
        version: 2,
      }),
      loadTwineConversation: vi.fn(),
    });

    await runtime.loadHistory(null, 'New conversation');

    expect(runtime.getSnapshot().conversationSummaries).toEqual([]);
  });

  it('settles a canceled response and ignores its late events', async () => {
    let generationListener:
      | Parameters<NonNullable<FlyoffApi['onTwineGenerationEvent']>>[0]
      | undefined;
    const cancelTwineGeneration = vi.fn().mockResolvedValue(undefined);
    const runtime = getTwineRuntime();
    runtime.connect({
      cancelTwineGeneration,
      createTwineConversation: vi.fn().mockResolvedValue(conversation()),
      listTwineConversations: vi.fn().mockResolvedValue(summary()),
      loadTwineConversation: vi.fn().mockResolvedValue(conversation()),
      onTwineGenerationEvent: (listener) => {
        generationListener = listener;
        return vi.fn();
      },
    });
    await runtime.loadHistory('twine-conversation-1', 'New conversation');
    runtime.setConversation((current) => ({
      ...current,
      branches: {
        ...current.branches,
        [current.activeBranchId]: {
          ...current.branches[current.activeBranchId]!,
          messages: [
            {
              attachments: [],
              id: 'message-1',
              kind: 'assistant',
              status: 'streaming',
              streamRequestId: 'request-1',
              text: 'Partial response',
              thinkingStartedAt: Date.now() - 10,
            },
          ],
        },
      },
    }));
    runtime.beginGeneration('request-1');

    runtime.cancelGeneration();

    expect(cancelTwineGeneration).toHaveBeenCalledWith('request-1');
    expect(runtime.getSnapshot().isGenerating).toBe(false);
    expect(
      runtime.getSnapshot().conversation.branches['twine-root']?.messages[0],
    ).toMatchObject({
      status: 'complete',
      streamRequestId: undefined,
      text: 'Partial response',
    });

    generationListener?.({
      requestId: 'request-1',
      text: ' late text',
      type: 'text-delta',
    });
    expect(
      runtime.getSnapshot().conversation.branches['twine-root']?.messages[0]
        ?.text,
    ).toBe('Partial response');
  });

  it('does not resurrect a deleted conversation through a pending autosave', async () => {
    const saveTwineConversation = vi.fn().mockResolvedValue(summary());
    const runtime = getTwineRuntime();
    runtime.connect({
      createTwineConversation: vi.fn().mockResolvedValue(conversation()),
      deleteTwineConversation: vi.fn().mockResolvedValue({
        activeConversationId: 'twine-conversation-2',
        conversations: [
          {
            activityAt: 2,
            archivedAt: null,
            createdAt: 2,
            id: 'twine-conversation-2',
            pinnedAt: null,
            title: 'Second',
            titleMode: 'automatic',
          },
        ],
        version: 2,
      }),
      listTwineConversations: vi.fn().mockResolvedValue(summary()),
      loadTwineConversation: vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(conversation(id)),
        ),
      saveTwineConversation,
    });
    await runtime.loadHistory('twine-conversation-1', 'New conversation');
    runtime.setDraft('pending autosave');

    await runtime.deleteConversation('twine-conversation-1');

    expect(saveTwineConversation).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().conversationId).toBe('twine-conversation-2');
  });
});
