import type {
  TwineConversationSnapshot,
  TwineConversationMessageSnapshot,
} from '../../shared/contracts';
import {
  activeTwineBranch,
  createTwineConversationState,
  TWINE_ROOT_BRANCH_ID,
} from './twine-conversation-state';
import type {
  TwineConversationState,
  TwineMessage,
  TwineMessageAttachment,
} from './twine-types';

const SNAPSHOT_VERSION = 1;

let rememberedSnapshot: TwineConversationSnapshot | undefined;

export function clearRememberedTwineConversationSnapshot(): void {
  rememberedSnapshot = undefined;
}

export function rememberTwineConversationSnapshot(
  snapshot: TwineConversationSnapshot,
): void {
  rememberedSnapshot = snapshot;
}

export function rememberedTwineConversationSnapshot(
  id?: string | null,
): TwineConversationSnapshot | undefined {
  if (!rememberedSnapshot || !id) {
    return undefined;
  }
  return rememberedSnapshot.id === id ? rememberedSnapshot : undefined;
}

function messageTitle(text: string, fallback: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 80) : fallback;
}

export function twineConversationTitle(
  state: TwineConversationState,
  fallback: string,
): string {
  const firstUserMessage = activeTwineBranch(state).messages.find(
    ({ kind, text }) => kind === 'user' && text.trim(),
  );
  return firstUserMessage ? messageTitle(firstUserMessage.text, fallback) : fallback;
}

function persistedAttachments(
  attachments: readonly TwineMessageAttachment[],
): TwineConversationMessageSnapshot['attachments'] {
  return attachments.map(({ id, name, size }) => ({ id, name, size }));
}

function persistedMessage(
  message: TwineMessage,
): TwineConversationMessageSnapshot {
  return {
    attachments: persistedAttachments(message.attachments),
    id: message.id,
    kind: message.kind,
    ...(message.sources ? { sources: message.sources } : {}),
    status: message.status === 'error' ? 'error' : 'complete',
    text: message.text,
    ...(message.thinkingDurationMs !== undefined
      ? { thinkingDurationMs: message.thinkingDurationMs }
      : {}),
    ...(message.thought ? { thought: message.thought } : {}),
    ...(message.tools ? { tools: message.tools } : {}),
    ...(message.usage ? { usage: message.usage } : {}),
  };
}

export function createTwineConversationSnapshot(
  options: {
    createdAt: number;
    draft: string;
    fallbackTitle: string;
    id: string;
    nextId: number;
    state: TwineConversationState;
  },
): TwineConversationSnapshot {
  const title = twineConversationTitle(options.state, options.fallbackTitle);
  return {
    createdAt: options.createdAt,
    draft: options.draft,
    id: options.id,
    nextId: options.nextId,
    state: {
      activeBranchId: options.state.activeBranchId,
      branches: Object.fromEntries(
        Object.entries(options.state.branches).map(([id, branch]) => [
          id,
          {
            ...branch,
            messages: branch.messages.map(persistedMessage),
          },
        ]),
      ),
      ...(options.state.navigationParentId
        ? { navigationParentId: options.state.navigationParentId }
        : {}),
    },
    title,
    updatedAt: Date.now(),
    version: SNAPSHOT_VERSION,
  };
}

export function restoreTwineConversationSnapshot(
  snapshot: TwineConversationSnapshot,
): TwineConversationState {
  if (
    !snapshot.state.branches[snapshot.state.activeBranchId] ||
    Object.keys(snapshot.state.branches).length === 0
  ) {
    return createTwineConversationState();
  }

  return {
    activeBranchId: snapshot.state.activeBranchId,
    branches: Object.fromEntries(
      Object.entries(snapshot.state.branches).map(([id, branch]) => [
        id,
        {
          ...branch,
          messages: branch.messages.map((message) => ({
            ...message,
            attachments: message.attachments.map(({ id, name, size }) => ({
              id,
              name,
              size,
            })),
          })),
        },
      ]),
    ),
    ...(snapshot.state.navigationParentId
      ? { navigationParentId: snapshot.state.navigationParentId }
      : {}),
  };
}

export function createEmptyTwineConversationSnapshot(
  fallbackTitle: string,
): TwineConversationSnapshot {
  const timestamp = Date.now();
  return {
    createdAt: timestamp,
    draft: '',
    id: `twine-conversation-${crypto.randomUUID()}`,
    nextId: 1,
    state: {
      activeBranchId: TWINE_ROOT_BRANCH_ID,
      branches: {
        [TWINE_ROOT_BRANCH_ID]: {
          id: TWINE_ROOT_BRANCH_ID,
          messages: [],
        },
      },
    },
    title: fallbackTitle,
    updatedAt: timestamp,
    version: SNAPSHOT_VERSION,
  };
}
