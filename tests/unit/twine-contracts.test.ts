import { describe, expect, it } from 'vitest';

import {
  isTwineCredentialStatus,
  isTwineContentActionResult,
  isTwineCopyContentRequest,
  isTwineConversationSnapshot,
  isTwineConversationStoreSnapshot,
  isTwineConversationMutationRequest,
  isTwineConversationQuery,
  isTwineGenerationEvent,
  isTwineGenerationRequest,
  isTwineExportMarkdownRequest,
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

  it('validates bounded copy, export, and result payloads', () => {
    expect(
      isTwineCopyContentRequest({ content: '**Answer**', format: 'markdown' }),
    ).toBe(true);
    expect(
      isTwineCopyContentRequest({ content: 'Answer', format: 'html' }),
    ).toBe(false);
    expect(
      isTwineExportMarkdownRequest({
        content: '# Answer',
        suggestedName: 'Conversation',
      }),
    ).toBe(true);
    expect(
      isTwineExportMarkdownRequest({ content: '', suggestedName: 'Empty' }),
    ).toBe(false);
    expect(isTwineContentActionResult({ status: 'success' })).toBe(true);
    expect(
      isTwineContentActionResult({
        error: 'write-failed',
        status: 'error',
      }),
    ).toBe(true);
    expect(
      isTwineContentActionResult({ error: 'unknown', status: 'error' }),
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
      activityAt: 2,
      archivedAt: null,
      createdAt: 1,
      id: 'twine-conversation-1',
      nextId: 4,
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
                text: '**Oi**',
              },
            ],
          },
        },
      },
      title: 'Oi',
      titleMode: 'automatic',
      version: 2,
    };

    expect(isTwineConversationSnapshot(conversation)).toBe(true);
    expect(
      isTwineConversationStoreSnapshot({
        activeConversationId: 'twine-conversation-1',
        conversations: [
          {
            activityAt: 2,
            archivedAt: null,
            createdAt: 1,
            id: 'twine-conversation-1',
            pinnedAt: null,
            title: 'Oi',
            titleMode: 'automatic',
          },
        ],
        version: 2,
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

  it('validates history queries and metadata mutations', () => {
    expect(
      isTwineConversationQuery({
        filter: 'archived',
        query: 'projeto',
        sort: 'title',
      }),
    ).toBe(true);
    expect(
      isTwineConversationQuery({
        filter: 'missing',
        query: '',
        sort: 'recent',
      }),
    ).toBe(false);
    expect(
      isTwineConversationMutationRequest({
        id: 'twine-conversation-1',
        title: 'Projeto',
        type: 'rename',
      }),
    ).toBe(true);
    expect(
      isTwineConversationMutationRequest({
        id: 'twine-conversation-1',
        title: '',
        type: 'rename',
      }),
    ).toBe(false);
  });
});
