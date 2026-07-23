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
    activityAt: 10,
    archivedAt: null,
    createdAt: 10,
    id,
    nextId: 3,
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
              text,
            },
          ],
        },
      },
    },
    title: text,
    titleMode: 'automatic',
    version: 2,
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
    expect(store.list().activeConversationId).toBeNull();

    now = 200;
    const saved = store.save(snapshot('twine-conversation-custom', 'Hello'));
    expect(saved.conversations[0]).toMatchObject({
      id: 'twine-conversation-custom',
      title: 'Hello',
      activityAt: 10,
    });

    const restored = new TwineConversationStore(directory);
    expect(restored.load('twine-conversation-custom')?.state).toEqual(
      snapshot('twine-conversation-custom', 'Hello').state,
    );

    expect(restored.delete('twine-conversation-custom').conversations).toHaveLength(0);
  });

  it('keeps technical saves from changing activity order', () => {
    const directory = createTemporaryDirectory();
    const store = new TwineConversationStore(directory, () => new Date(500));
    store.save({ ...snapshot('twine-conversation-old', 'Old'), activityAt: 10 });
    store.save({ ...snapshot('twine-conversation-new', 'New'), activityAt: 20 });

    store.save({
      ...snapshot('twine-conversation-old', 'Old'),
      activityAt: 10,
      draft: 'technical save',
    });

    expect(store.list().conversations.map(({ id }) => id)).toEqual([
      'twine-conversation-new',
      'twine-conversation-old',
    ]);
  });

  it('queries content and manages pin, rename, and archive metadata', () => {
    let now = 100;
    const directory = createTemporaryDirectory();
    const store = new TwineConversationStore(directory, () => new Date(now));
    store.save(snapshot('twine-conversation-one', 'Planejamento técnico'));
    store.save({
      ...snapshot('twine-conversation-two', 'Outra conversa'),
      activityAt: 20,
    });

    now = 200;
    store.update({
      id: 'twine-conversation-one',
      pinned: true,
      type: 'pin',
    });
    store.update({
      id: 'twine-conversation-one',
      title: 'Projeto principal',
      type: 'rename',
    });
    expect(store.list().conversations[0]).toMatchObject({
      id: 'twine-conversation-one',
      pinnedAt: 200,
      title: 'Projeto principal',
      titleMode: 'custom',
    });
    expect(
      store.query({ filter: 'all', query: 'tecnico', sort: 'recent' })
        .conversations[0],
    ).toMatchObject({
      id: 'twine-conversation-one',
      matchSnippet: 'Planejamento técnico',
    });

    now = 300;
    store.update({
      archived: true,
      id: 'twine-conversation-one',
      type: 'archive',
    });
    expect(store.list().conversations.map(({ id }) => id)).toEqual([
      'twine-conversation-two',
    ]);
    expect(
      store.query({ filter: 'archived', query: '', sort: 'recent' })
        .conversations[0],
    ).toMatchObject({
      archivedAt: 300,
      id: 'twine-conversation-one',
      pinnedAt: null,
    });
  });

  it('migrates version 1 history without losing messages', () => {
    const directory = createTemporaryDirectory();
    const store = new TwineConversationStore(directory);
    const current = snapshot('twine-conversation-legacy', 'Legacy');
    const { activityAt, archivedAt, pinnedAt, titleMode, ...legacy } = current;
    writeFileSync(
      store.filePath,
      JSON.stringify({
        activeConversationId: current.id,
        conversations: [
          { ...legacy, updatedAt: activityAt, version: 1 },
        ],
        version: 1,
      }),
      'utf8',
    );

    expect(store.list().conversations[0]).toMatchObject({
      activityAt: 10,
      archivedAt: null,
      id: current.id,
      pinnedAt: null,
    });
    expect(store.load(current.id)?.state).toEqual(current.state);
    expect({ archivedAt, pinnedAt, titleMode }).toEqual({
      archivedAt: null,
      pinnedAt: null,
      titleMode: 'automatic',
    });
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
