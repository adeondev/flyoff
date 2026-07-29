import { describe, expect, it } from 'vitest';

import {
  isTwineCredentialStatus,
  isTwineConversationSnapshot,
  isTwineConversationStoreSnapshot,
  isTwineGenerationEvent,
  isTwineGenerationRequest,
  isTwineDocumentToolResultSubmission,
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
    expect(
      isTwineGenerationEvent({
        requestId: 'twine-request-1',
        type: 'document-tool-call',
        call: {
          id: 'call-1',
          name: 'read_diagram',
          args: { nodeId: 'diagram-1' },
        },
      }),
    ).toBe(true);
    expect(
      isTwineGenerationEvent({
        requestId: 'twine-request-1',
        type: 'document-tool-call',
        call: {
          id: 'call-note',
          name: 'read_note',
          args: { nodeId: 'note-1' },
        },
      }),
    ).toBe(true);
  });

  it('validates document consent and bounded tool results', () => {
    expect(
      isTwineGenerationRequest({
        approvalMode: 'request',
        documentAgent: {
          enabled: true,
          scope: 'project',
        },
        messages: [{ role: 'user', text: 'Corrija o UML' }],
        modelId: 'google/gemma-4-31B-it',
        requestId: 'twine-request-1',
        researchEnabled: false,
        thinkingLevel: 'high',
      }),
    ).toBe(true);
    expect(
      isTwineDocumentToolResultSubmission({
        requestId: 'twine-request-1',
        callId: 'call-1',
        result: { ok: true, text: '{"status":"applied"}' },
      }),
    ).toBe(true);
    expect(
      isTwineDocumentToolResultSubmission({
        requestId: 'twine-request-1',
        callId: 'call-1',
        result: { ok: true, text: 'x'.repeat(600_000) },
      }),
    ).toBe(false);
    expect(
      isTwineDocumentToolResultSubmission({
        requestId: 'twine-request-1',
        callId: 'call-1',
        result: { ok: true, text: '🟣'.repeat(140_000) },
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
