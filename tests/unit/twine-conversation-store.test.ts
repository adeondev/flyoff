import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TwineConversationStore } from '../../src/main/twine';
import type { TwineConversationSnapshot } from '../../src/shared/contracts';

const directories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-twine-history-'));
  directories.push(directory);
  return directory;
}

function snapshot(id: string, text: string): TwineConversationSnapshot {
  return {
    createdAt: 10,
    id,
    nextId: 3,
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
              text,
            },
          ],
        },
      },
    },
    title: text,
    updatedAt: 10,
    version: 1,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('TwineConversationStore', () => {
  it('creates, saves, restores, lists, and deletes conversations', () => {
    let now = 100;
    const directory = createTemporaryDirectory();
    const store = new TwineConversationStore(directory, () => new Date(now));

    const created = store.create();
    expect(created.title).toBe('New conversation');
    expect(store.list().activeConversationId).toBe(created.id);

    now = 200;
    const saved = store.save(snapshot('twine-conversation-custom', 'Hello'));
    expect(saved.conversations[0]).toMatchObject({
      id: 'twine-conversation-custom',
      title: 'Hello',
      updatedAt: 200,
    });

    const restored = new TwineConversationStore(directory);
    expect(restored.load('twine-conversation-custom')?.state).toEqual(
      snapshot('twine-conversation-custom', 'Hello').state,
    );

    expect(restored.delete('twine-conversation-custom').conversations).toHaveLength(1);
  });

  it('treats malformed or oversized history as empty', () => {
    const directory = createTemporaryDirectory();
    const store = new TwineConversationStore(directory);
    writeFileSync(store.filePath, '{broken', 'utf8');
    expect(store.list().conversations).toEqual([]);

    writeFileSync(store.filePath, 'x'.repeat(8 * 1_024 * 1_024 + 1), 'utf8');
    expect(store.list().conversations).toEqual([]);
    expect(() => readFileSync(store.filePath, 'utf8')).not.toThrow();
  });
});
