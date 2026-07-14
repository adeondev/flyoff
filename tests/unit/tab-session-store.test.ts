import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TabSessionStore } from '../../src/main/session';
import {
  TAB_SESSION_VERSION,
  type InternalPageId,
  type TabSessionSnapshot,
} from '../../src/shared/contracts';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-tabs-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createSnapshot(
  pageIds: readonly InternalPageId[],
  activeTabId = `page:${pageIds[0] ?? 'home'}`,
): TabSessionSnapshot {
  return {
    version: TAB_SESSION_VERSION,
    tabs: pageIds.map((pageId) => ({
      tabId: `page:${pageId}`,
      pageId,
      scrollTop: 0,
      pageState: { version: 1, data: {} },
    })),
    activeTabId,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('TabSessionStore', () => {
  it('persists the latest session and does not offer Home alone', () => {
    const directory = createTemporaryDirectory();
    const home = createSnapshot(['home']);
    const store = new TabSessionStore(directory);

    expect(store.getRestorableSession()).toBeNull();
    store.save(home);
    store.flush();

    expect(JSON.parse(readFileSync(store.filePath, 'utf8'))).toEqual(home);
    expect(new TabSessionStore(directory).getRestorableSession()).toBeNull();
  });

  it('protects a previous useful session until restore is resolved', () => {
    const directory = createTemporaryDirectory();
    const previous = createSnapshot(
      ['home', 'settings'],
      'page:settings',
    );
    const firstRun = new TabSessionStore(directory);
    firstRun.save(previous);
    firstRun.flush();

    const nextRun = new TabSessionStore(directory);
    expect(nextRun.getRestorableSession()).toEqual(previous);
    expect(() => nextRun.save(createSnapshot(['home']))).toThrow(
      'must be resolved',
    );
  });

  it('atomically replaces the previous snapshot when ignored or restored', () => {
    const directory = createTemporaryDirectory();
    const previous = createSnapshot(['home', 'help'], 'page:help');
    const home = createSnapshot(['home']);
    const firstRun = new TabSessionStore(directory);
    firstRun.save(previous);
    firstRun.flush();

    const nextRun = new TabSessionStore(directory);
    nextRun.resolveRestorableSession(home);

    expect(new TabSessionStore(directory).getRestorableSession()).toBeNull();
    expect(JSON.parse(readFileSync(nextRun.filePath, 'utf8'))).toEqual(home);
  });
});
