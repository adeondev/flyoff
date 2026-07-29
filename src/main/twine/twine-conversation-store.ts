import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  isTwineConversationSnapshot,
  type TwineConversationSnapshot,
  type TwineConversationStoreSnapshot,
  type TwineConversationSummary,
} from '../../shared/contracts';

const TWINE_CONVERSATIONS_FILENAME = 'twine-conversations.json';
const TWINE_CONVERSATIONS_VERSION = 1;
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

function isStoredTwineConversations(
  value: unknown,
): value is StoredTwineConversations {
  return (
    isRecord(value) &&
    value.version === TWINE_CONVERSATIONS_VERSION &&
    (value.activeConversationId === null ||
      typeof value.activeConversationId === 'string') &&
    Array.isArray(value.conversations) &&
    value.conversations.length <= TWINE_CONVERSATIONS_MAX_ITEMS &&
    value.conversations.every(isTwineConversationSnapshot)
  );
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
    createdAt: conversation.createdAt,
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
  };
}

function summarize(
  store: StoredTwineConversations,
): TwineConversationStoreSnapshot {
  const conversations = [...store.conversations]
    .sort((first, second) => second.updatedAt - first.updatedAt)
    .map(summary);
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
  const activeConversationId =
    value.activeConversationId && knownIds.has(value.activeConversationId)
      ? value.activeConversationId
      : conversations[0]?.id ?? null;
  return {
    activeConversationId,
    conversations,
    version: TWINE_CONVERSATIONS_VERSION,
  };
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

  load(id: string): TwineConversationSnapshot | null {
    return this.read().conversations.find((entry) => entry.id === id) ?? null;
  }

  create(): TwineConversationSnapshot {
    const store = this.read();
    const timestamp = this.now().getTime();
    const conversation: TwineConversationSnapshot = {
      createdAt: timestamp,
      draft: '',
      id: `twine-conversation-${randomUUID()}`,
      nextId: 1,
      state: createRootConversationState(),
      title: 'New conversation',
      updatedAt: timestamp,
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
    const timestamp = this.now().getTime();
    const nextConversation: TwineConversationSnapshot = {
      ...conversation,
      title: conversation.title.trim() || 'New conversation',
      updatedAt: timestamp,
    };
    const conversations = [
      nextConversation,
      ...store.conversations.filter(({ id }) => id !== conversation.id),
    ].slice(0, TWINE_CONVERSATIONS_MAX_ITEMS);
    const nextStore = {
      activeConversationId: conversation.id,
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
        ? conversations[0]?.id ?? null
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
      return isStoredTwineConversations(value)
        ? normalizedStore(value)
        : this.emptyStore();
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
