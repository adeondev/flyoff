import { describe, expect, it } from 'vitest';

import {
  activeTwineBranch,
  createTwineConversationState,
  forkTwineConversation,
  selectTwineVariant,
  twineConversationVariants,
  truncateActiveTwineConversation,
  updateTwineBranchMessages,
} from '../../src/renderer/twine/twine-conversation-state';
import type { TwineMessage } from '../../src/renderer/twine/twine-types';

function message(id: string, text: string): TwineMessage {
  return {
    attachments: [],
    id,
    kind: 'user',
    status: 'complete',
    text,
  };
}

function assistant(id: string, text: string): TwineMessage {
  return {
    attachments: [],
    id,
    kind: 'assistant',
    status: 'complete',
    text,
  };
}

describe('Twine conversation variants', () => {
  it('keeps the original branch and navigates edited variants', () => {
    let state = createTwineConversationState();
    state = updateTwineBranchMessages(state, state.activeBranchId, () => [
      message('message-1', 'Original'),
    ]);
    state = forkTwineConversation(state, {
      branchId: 'branch-2',
      forkMessageId: 'message-1',
      messages: [message('message-1', 'Edited')],
    });

    expect(activeTwineBranch(state).messages[0]?.text).toBe('Edited');
    expect(twineConversationVariants(state)).toHaveLength(2);

    state = selectTwineVariant(state, -1);
    expect(activeTwineBranch(state).messages[0]?.text).toBe('Original');
    state = selectTwineVariant(state, 1);
    expect(activeTwineBranch(state).messages[0]?.text).toBe('Edited');
  });

  it('adds repeated regenerations to the same variant family', () => {
    let state = createTwineConversationState();
    state = updateTwineBranchMessages(state, state.activeBranchId, () => [
      message('message-1', 'Original'),
    ]);
    state = forkTwineConversation(state, {
      branchId: 'branch-2',
      forkMessageId: 'message-1',
      messages: [message('message-1', 'Second')],
    });
    state = forkTwineConversation(state, {
      branchId: 'branch-3',
      forkMessageId: 'message-1',
      messages: [message('message-1', 'Third')],
    });

    expect(twineConversationVariants(state).map(({ id }) => id)).toEqual([
      'twine-root',
      'branch-2',
      'branch-3',
    ]);
  });

  it('rewinds and deletes destructively instead of creating a variant', () => {
    let state = createTwineConversationState();
    state = updateTwineBranchMessages(state, state.activeBranchId, () => [
      message('message-1', 'First'),
      assistant('message-2', 'Answer'),
      message('message-3', 'Follow up'),
    ]);
    state = forkTwineConversation(state, {
      branchId: 'branch-2',
      forkMessageId: 'message-2',
      messages: [
        message('message-1', 'First'),
        assistant('message-2', 'Other answer'),
      ],
    });

    const rewound = truncateActiveTwineConversation(state, 'message-1', true);
    expect(activeTwineBranch(rewound).messages.map(({ id }) => id)).toEqual([
      'message-1',
    ]);
    expect(twineConversationVariants(rewound)).toEqual([]);

    const deleted = truncateActiveTwineConversation(
      updateTwineBranchMessages(rewound, rewound.activeBranchId, () => [
        message('message-1', 'First'),
        assistant('message-2', 'Answer'),
      ]),
      'message-1',
      false,
    );
    expect(activeTwineBranch(deleted).messages).toEqual([]);
    expect(twineConversationVariants(deleted)).toEqual([]);
  });
});
