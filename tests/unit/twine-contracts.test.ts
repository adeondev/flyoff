import { describe, expect, it } from 'vitest';

import {
  isTwineCredentialStatus,
  isTwineConversationSnapshot,
  isTwineConversationStoreSnapshot,
  isTwineGenerationEvent,
  isTwineGenerationRequest,
} from '../../src/shared/contracts';

describe('Twine IPC contracts', () => {
  it('validates credential status snapshots', () => {
    expect(
      isTwineCredentialStatus({
        encryptionAvailable: true,
        hasApiKey: false,
      }),
    ).toBe(true);
    expect(isTwineCredentialStatus({ hasApiKey: false })).toBe(false);
  });

  it('validates generation requests and rejects unsupported models', () => {
    expect(
      isTwineGenerationRequest({
        approvalMode: 'request',
        messages: [{ role: 'user', text: 'Oi' }],
        modelId: 'google/gemma-4-31B-it',
        requestId: 'twine-request-1',
        researchEnabled: true,
        thinkingLevel: 'high',
      }),
    ).toBe(true);
    expect(
      isTwineGenerationRequest({
        approvalMode: 'request',
        messages: [{ role: 'user', text: 'Oi' }],
        modelId: 'gemma-4-31b-it',
        requestId: 'twine-request-1',
        researchEnabled: true,
        thinkingLevel: 'high',
      }),
    ).toBe(false);
  });

  it('validates stream events', () => {
    expect(
      isTwineGenerationEvent({
        requestId: 'twine-request-1',
        text: 'Olá',
        type: 'text-delta',
      }),
    ).toBe(true);
    expect(
      isTwineGenerationEvent({
        requestId: 'twine-request-1',
        phase: 'result',
        text: 'x',
        tool: 'unknown',
        type: 'tool',
      }),
    ).toBe(false);
  });

  it('validates persisted conversation snapshots', () => {
    const conversation = {
      createdAt: 1,
      id: 'twine-conversation-1',
      nextId: 4,
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
                text: '**Oi**',
              },
            ],
          },
        },
      },
      title: 'Oi',
      updatedAt: 2,
      version: 1,
    };

    expect(isTwineConversationSnapshot(conversation)).toBe(true);
    expect(
      isTwineConversationStoreSnapshot({
        activeConversationId: 'twine-conversation-1',
        conversations: [
          {
            createdAt: 1,
            id: 'twine-conversation-1',
            title: 'Oi',
            updatedAt: 2,
          },
        ],
        version: 1,
      }),
    ).toBe(true);
    expect(
      isTwineConversationSnapshot({
        ...conversation,
        state: {
          activeBranchId: 'missing',
          branches: conversation.state.branches,
        },
      }),
    ).toBe(false);
  });
});
