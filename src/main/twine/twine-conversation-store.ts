import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  isTwineConversationMutationRequest,
  isTwineConversationQuery,
  isTwineConversationSnapshot,
  type TwineConversationMutationRequest,
  type TwineConversationQuery,
  type TwineConversationQueryResult,
  type TwineConversationSearchResult,
  type TwineConversationSnapshot,
  type TwineConversationStoreSnapshot,
  type TwineConversationSummary,
} from '../../shared/contracts';

const TWINE_CONVERSATIONS_FILENAME = 'twine-conversations.json';
const TWINE_CONVERSATIONS_VERSION = 2;
const TWINE_CONVERSATIONS_MAX_BYTES = 8 * 1_024 * 1_024;
const TWINE_CONVERSATIONS_MAX_ITEMS = 64;

interface StoredTwineConversations {
  activeConversationId: string | null;
  conversations: readonly TwineConversationSnapshot[];
  version: typeof TWINE_CONVERSATIONS_VERSION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function migrateLegacyConversation(
  value: unknown,
): TwineConversationSnapshot | null {
  if (!isRecord(value) || value.version !== 1) {
    return null;
  }
  const candidate: unknown = {
    activityAt: value.updatedAt,
    archivedAt: null,
    createdAt: value.createdAt,
    ...(value.draft !== undefined ? { draft: value.draft } : {}),
    id: value.id,
    nextId: value.nextId,
    pinnedAt: null,
    state: value.state,
    title: value.title,
    titleMode: 'automatic',
    version: TWINE_CONVERSATIONS_VERSION,
  };
  return isTwineConversationSnapshot(candidate) ? candidate : null;
}

function parseStoredConversations(value: unknown): StoredTwineConversations | null {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== TWINE_CONVERSATIONS_VERSION) ||
    (value.activeConversationId !== null &&
      typeof value.activeConversationId !== 'string') ||
    !Array.isArray(value.conversations) ||
    value.conversations.length > TWINE_CONVERSATIONS_MAX_ITEMS
  ) {
    return null;
  }
  const conversations = value.conversations.map((conversation) =>
    value.version === 1
      ? migrateLegacyConversation(conversation)
      : isTwineConversationSnapshot(conversation)
        ? conversation
        : null,
  );
  if (conversations.some((conversation) => conversation === null)) {
    return null;
  }
  return {
    activeConversationId: value.activeConversationId,
    conversations: conversations as TwineConversationSnapshot[],
    version: TWINE_CONVERSATIONS_VERSION,
  };
}

function createRootConversationState(): TwineConversationSnapshot['state'] {
  return {
    activeBranchId: 'twine-root',
    branches: {
      'twine-root': {
        id: 'twine-root',
        messages: [],
      },
    },
  };
}

function summary(
  conversation: TwineConversationSnapshot,
): TwineConversationSummary {
  return {
    activityAt: conversation.activityAt,
    archivedAt: conversation.archivedAt,
    createdAt: conversation.createdAt,
    id: conversation.id,
    pinnedAt: conversation.pinnedAt,
    title: conversation.title,
    titleMode: conversation.titleMode,
  };
}

function hasUserMessage(conversation: TwineConversationSnapshot): boolean {
  return Object.values(conversation.state.branches).some((branch) =>
    branch.messages.some(
      (message) => message.kind === 'user' && message.text.trim().length > 0,
    ),
  );
}

function pinnedFirst(
  first: TwineConversationSnapshot,
  second: TwineConversationSnapshot,
): number {
  if (first.pinnedAt !== null || second.pinnedAt !== null) {
    if (first.pinnedAt === null) return 1;
    if (second.pinnedAt === null) return -1;
    return second.pinnedAt - first.pinnedAt;
  }
  return second.activityAt - first.activityAt;
}

function activeConversations(
  conversations: readonly TwineConversationSnapshot[],
): TwineConversationSnapshot[] {
  return conversations
    .filter((conversation) =>
      conversation.archivedAt === null && hasUserMessage(conversation),
    )
    .sort(pinnedFirst);
}

function summarize(
  store: StoredTwineConversations,
): TwineConversationStoreSnapshot {
  const conversations = activeConversations(store.conversations).map(summary);
  const activeConversationId =
    store.activeConversationId &&
    conversations.some(({ id }) => id === store.activeConversationId)
      ? store.activeConversationId
      : conversations[0]?.id ?? null;
  return {
    activeConversationId,
    conversations,
    version: TWINE_CONVERSATIONS_VERSION,
  };
}

function normalizedStore(
  value: StoredTwineConversations,
): StoredTwineConversations {
  const knownIds = new Set<string>();
  const conversations: TwineConversationSnapshot[] = [];
  for (const conversation of value.conversations) {
    if (!knownIds.has(conversation.id)) {
      knownIds.add(conversation.id);
      conversations.push(conversation);
    }
  }
  return {
    activeConversationId:
      value.activeConversationId && knownIds.has(value.activeConversationId)
        ? value.activeConversationId
        : activeConversations(conversations)[0]?.id ?? null,
    conversations,
    version: TWINE_CONVERSATIONS_VERSION,
  };
}

function normalizedSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}

function matchingSnippet(
  conversation: TwineConversationSnapshot,
  normalizedQuery: string,
): string | undefined {
  if (!normalizedQuery) {
    return undefined;
  }
  for (const branch of Object.values(conversation.state.branches)) {
    for (const message of branch.messages) {
      const text = message.text.replace(/\s+/g, ' ').trim();
      if (text && normalizedSearchText(text).includes(normalizedQuery)) {
        return text.length > 180 ? `${text.slice(0, 177)}...` : text;
      }
    }
  }
  return undefined;
}

function queryMatches(
  conversation: TwineConversationSnapshot,
  request: TwineConversationQuery,
): TwineConversationSearchResult | null {
  if (!hasUserMessage(conversation)) {
    return null;
  }
  if (
    (request.filter === 'active' && conversation.archivedAt !== null) ||
    (request.filter === 'archived' && conversation.archivedAt === null) ||
    (request.filter === 'pinned' &&
      (conversation.pinnedAt === null || conversation.archivedAt !== null))
  ) {
    return null;
  }
  const normalizedQuery = normalizedSearchText(request.query.trim());
  const titleMatches = normalizedSearchText(conversation.title).includes(
    normalizedQuery,
  );
  const matchSnippet = matchingSnippet(conversation, normalizedQuery);
  if (normalizedQuery && !titleMatches && !matchSnippet) {
    return null;
  }
  return {
    ...summary(conversation),
    ...(matchSnippet ? { matchSnippet } : {}),
  };
}

function sortQueryResults(
  conversations: TwineConversationSearchResult[],
  sort: TwineConversationQuery['sort'],
): TwineConversationSearchResult[] {
  return conversations.sort((first, second) => {
    if (first.pinnedAt !== null || second.pinnedAt !== null) {
      if (first.pinnedAt === null) return 1;
      if (second.pinnedAt === null) return -1;
      if (first.pinnedAt !== second.pinnedAt) {
        return second.pinnedAt - first.pinnedAt;
      }
    }
    if (sort === 'oldest') {
      return first.createdAt - second.createdAt;
    }
    if (sort === 'title') {
      return first.title.localeCompare(second.title, undefined, {
        sensitivity: 'base',
      });
    }
    return second.activityAt - first.activityAt;
  });
}

export class TwineConversationStore {
  readonly filePath: string;

  constructor(
    userDataPath: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.filePath = path.join(userDataPath, TWINE_CONVERSATIONS_FILENAME);
  }

  list(): TwineConversationStoreSnapshot {
    return summarize(this.read());
  }

  query(request: TwineConversationQuery): TwineConversationQueryResult {
    if (!isTwineConversationQuery(request)) {
      throw new TypeError('Invalid Twine conversation query.');
    }
    const conversations = this.read().conversations.flatMap((conversation) => {
      const result = queryMatches(conversation, request);
      return result ? [result] : [];
    });
    return {
      conversations: sortQueryResults(conversations, request.sort),
      version: TWINE_CONVERSATIONS_VERSION,
    };
  }

  load(id: string): TwineConversationSnapshot | null {
    return this.read().conversations.find((entry) => entry.id === id) ?? null;
  }

  create(): TwineConversationSnapshot {
    const store = this.read();
    const timestamp = this.now().getTime();
    const conversation: TwineConversationSnapshot = {
      activityAt: timestamp,
      archivedAt: null,
      createdAt: timestamp,
      draft: '',
      id: `twine-conversation-${randomUUID()}`,
      nextId: 1,
      pinnedAt: null,
      state: createRootConversationState(),
      title: 'New conversation',
      titleMode: 'automatic',
      version: TWINE_CONVERSATIONS_VERSION,
    };
    this.write({
      activeConversationId: conversation.id,
      conversations: [conversation, ...store.conversations].slice(
        0,
        TWINE_CONVERSATIONS_MAX_ITEMS,
      ),
      version: TWINE_CONVERSATIONS_VERSION,
    });
    return conversation;
  }

  save(conversation: TwineConversationSnapshot): TwineConversationStoreSnapshot {
    const store = this.read();
    const current = store.conversations.find(({ id }) => id === conversation.id);
    const nextConversation: TwineConversationSnapshot = {
      ...conversation,
      activityAt: Math.max(
        conversation.activityAt,
        current?.activityAt ?? conversation.activityAt,
      ),
      archivedAt: conversation.archivedAt,
      pinnedAt: conversation.archivedAt === null ? conversation.pinnedAt : null,
      title: conversation.title.trim() || 'New conversation',
    };
    const conversations = [
      nextConversation,
      ...store.conversations.filter(({ id }) => id !== conversation.id),
    ].slice(0, TWINE_CONVERSATIONS_MAX_ITEMS);
    const nextStore = {
      activeConversationId:
        nextConversation.archivedAt === null
          ? conversation.id
          : store.activeConversationId,
      conversations,
      version: TWINE_CONVERSATIONS_VERSION,
    } satisfies StoredTwineConversations;
    this.write(nextStore);
    return summarize(nextStore);
  }

  update(
    request: TwineConversationMutationRequest,
  ): TwineConversationStoreSnapshot {
    if (!isTwineConversationMutationRequest(request)) {
      throw new TypeError('Invalid Twine conversation update.');
    }
    const store = this.read();
    const timestamp = this.now().getTime();
    const conversations = store.conversations.map((conversation) => {
      if (conversation.id !== request.id) {
        return conversation;
      }
      switch (request.type) {
        case 'rename':
          return {
            ...conversation,
            title: request.title.trim(),
            titleMode: 'custom' as const,
          };
        case 'pin':
          return {
            ...conversation,
            pinnedAt: request.pinned ? timestamp : null,
          };
        case 'archive':
          return {
            ...conversation,
            archivedAt: request.archived ? timestamp : null,
            pinnedAt: request.archived ? null : conversation.pinnedAt,
          };
      }
    });
    const activeConversationId =
      request.type === 'archive' &&
      request.archived &&
      store.activeConversationId === request.id
        ? activeConversations(conversations)[0]?.id ?? null
        : store.activeConversationId;
    const nextStore = {
      activeConversationId,
      conversations,
      version: TWINE_CONVERSATIONS_VERSION,
    } satisfies StoredTwineConversations;
    this.write(nextStore);
    return summarize(nextStore);
  }

  delete(id: string): TwineConversationStoreSnapshot {
    const store = this.read();
    const conversations = store.conversations.filter(
      (conversation) => conversation.id !== id,
    );
    const activeConversationId =
      store.activeConversationId === id
        ? activeConversations(conversations)[0]?.id ?? null
        : store.activeConversationId;
    const nextStore = {
      activeConversationId,
      conversations,
      version: TWINE_CONVERSATIONS_VERSION,
    } satisfies StoredTwineConversations;
    this.write(nextStore);
    return summarize(nextStore);
  }

  private read(): StoredTwineConversations {
    try {
      if (statSync(this.filePath).size > TWINE_CONVERSATIONS_MAX_BYTES) {
        return this.emptyStore();
      }
      const value: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      const parsed = parseStoredConversations(value);
      return parsed ? normalizedStore(parsed) : this.emptyStore();
    } catch {
      return this.emptyStore();
    }
  }

  private emptyStore(): StoredTwineConversations {
    return {
      activeConversationId: null,
      conversations: [],
      version: TWINE_CONVERSATIONS_VERSION,
    };
  }

  private write(store: StoredTwineConversations): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const serialized = `${JSON.stringify(store, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > TWINE_CONVERSATIONS_MAX_BYTES) {
      throw new RangeError('The Twine conversation history is too large.');
    }
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, serialized, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      renameSync(temporaryPath, this.filePath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
}
