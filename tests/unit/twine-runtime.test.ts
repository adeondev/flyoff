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
    createdAt: 1,
    draft: '',
    id,
    nextId: 2,
    state: {
      activeBranchId: 'twine-root',
      branches: {
        'twine-root': {
          id: 'twine-root',
          messages: [],
        },
      },
    },
    title: 'Conversation',
    updatedAt: 1,
    version: 1,
  };
}

function summary(): TwineConversationStoreSnapshot {
  return {
    activeConversationId: 'twine-conversation-1',
    conversations: [
      {
        createdAt: 1,
        id: 'twine-conversation-1',
        title: 'Conversation',
        updatedAt: 1,
      },
    ],
    version: 1,
  };
}

afterEach(() => {
  resetTwineRuntimeForTests();
});

describe('Twine runtime', () => {
  it('executes validated UML tool calls and returns the result through preload', async () => {
    let generationListener:
      | Parameters<NonNullable<FlyoffApi['onTwineGenerationEvent']>>[0]
      | undefined;
    const submitTwineDocumentToolResult = vi.fn().mockResolvedValue(undefined);
    const handler = vi.fn().mockResolvedValue({
      ok: true,
      text: '{"status":"applied"}',
    });
    const runtime = getTwineRuntime();
    runtime.connect({
      onTwineGenerationEvent: (listener) => {
        generationListener = listener;
        return () => undefined;
      },
      submitTwineDocumentToolResult,
    });
    runtime.setDocumentToolHandler(handler);
    runtime.beginGeneration('request-1');

    generationListener?.({
      requestId: 'request-1',
      type: 'document-tool-call',
      call: {
        id: 'call-1',
        name: 'read_diagram',
        args: { nodeId: 'diagram-1' },
      },
    });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    expect(submitTwineDocumentToolResult).toHaveBeenCalledWith({
      requestId: 'request-1',
      callId: 'call-1',
      result: { ok: true, text: '{"status":"applied"}' },
    });
  });

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

  it('does not resurrect a deleted conversation through a pending autosave', async () => {
    const saveTwineConversation = vi.fn().mockResolvedValue(summary());
    const runtime = getTwineRuntime();
    runtime.connect({
      createTwineConversation: vi.fn().mockResolvedValue(conversation()),
      deleteTwineConversation: vi.fn().mockResolvedValue({
        activeConversationId: 'twine-conversation-2',
        conversations: [
          {
            createdAt: 2,
            id: 'twine-conversation-2',
            title: 'Second',
            updatedAt: 2,
          },
        ],
        version: 1,
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
