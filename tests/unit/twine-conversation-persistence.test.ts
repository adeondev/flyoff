import { describe, expect, it } from 'vitest';

import { createTwineConversationSnapshot } from '../../src/renderer/twine/twine-conversation-persistence';

describe('Twine conversation persistence', () => {
  it('keeps generation activity out of persisted history', () => {
    const snapshot = createTwineConversationSnapshot({
      activityAt: 2,
      archivedAt: null,
      createdAt: 1,
      draft: '',
      fallbackTitle: 'New conversation',
      id: 'twine-conversation-1',
      nextId: 2,
      pinnedAt: null,
      state: {
        activeBranchId: 'twine-root',
        branches: {
          'twine-root': {
            id: 'twine-root',
            messages: [
              {
                activity: 'searching',
                answerRevealed: true,
                attachments: [],
                id: 'assistant-1',
                kind: 'assistant',
                status: 'streaming',
                streamRequestId: 'request-1',
                text: '',
              },
            ],
          },
        },
      },
      title: 'New conversation',
      titleMode: 'automatic',
    });

    expect(snapshot.state.branches['twine-root']?.messages[0]).toEqual({
      attachments: [],
      id: 'assistant-1',
      kind: 'assistant',
      status: 'complete',
      text: '',
    });
  });

  it('persists compacted memory without removing visible messages', () => {
    const snapshot = createTwineConversationSnapshot({
      activityAt: 2,
      archivedAt: null,
      createdAt: 1,
      draft: '',
      fallbackTitle: 'New conversation',
      id: 'twine-conversation-1',
      nextId: 3,
      pinnedAt: null,
      state: {
        activeBranchId: 'twine-root',
        branches: {
          'twine-root': {
            id: 'twine-root',
            memory: {
              summary: 'Compacted memory',
              throughMessageId: 'message-2',
              tokenCount: 25_000,
              version: 1,
            },
            messages: [
              {
                attachments: [],
                id: 'message-1',
                kind: 'user',
                status: 'complete',
                text: 'Original question',
              },
              {
                attachments: [],
                id: 'message-2',
                kind: 'assistant',
                status: 'complete',
                text: 'Original answer',
              },
            ],
          },
        },
      },
      title: 'New conversation',
      titleMode: 'automatic',
    });

    expect(snapshot.state.branches['twine-root']).toMatchObject({
      memory: {
        summary: 'Compacted memory',
        throughMessageId: 'message-2',
        tokenCount: 25_000,
        version: 1,
      },
      messages: [
        { id: 'message-1', text: 'Original question' },
        { id: 'message-2', text: 'Original answer' },
      ],
    });
  });
});
