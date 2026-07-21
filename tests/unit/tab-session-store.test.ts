import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TabSessionStore } from '../../src/main/session';
import {
  WORKSPACE_SESSION_VERSION,
  type InternalPageId,
  type WorkspaceSessionSnapshot,
} from '../../src/shared/contracts';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-tabs-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createWorkspaceSnapshot(
  pageIds: readonly InternalPageId[],
  activeTabId = `page:${pageIds[0] ?? 'home'}`,
): WorkspaceSessionSnapshot {
  return {
    version: WORKSPACE_SESSION_VERSION,
    home: {
      root: {
        kind: 'pane',
        paneId: 'home-pane-1',
        tabs: pageIds.map((pageId) => ({
          tabId: `page:${pageId}`,
          target: { type: 'internal', pageId },
          scrollTop: 0,
          pageState: { version: 1, data: {} },
        })),
        activeTabId,
      },
      activePaneId: 'home-pane-1',
    },
    project: null,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('TabSessionStore', () => {
  it('migrates a legacy flat session into a workspace snapshot', () => {
    const directory = createTemporaryDirectory();
    writeFileSync(
      path.join(directory, 'tab-session.json'),
      JSON.stringify({
        version: 1,
        tabs: [
          {
            tabId: 'page:home',
            pageId: 'home',
            scrollTop: 0,
            pageState: { version: 1, data: {} },
          },
          {
            tabId: 'page:settings',
            pageId: 'settings',
            scrollTop: 0,
            pageState: { version: 1, data: {} },
          },
        ],
        activeTabId: 'page:settings',
      }),
      'utf8',
    );

    expect(new TabSessionStore(directory).getRestorableSession()).toEqual(
      createWorkspaceSnapshot(['home', 'settings'], 'page:settings'),
    );
  });

  it('persists the latest session and does not offer Home alone', () => {
    const directory = createTemporaryDirectory();
    const home = createWorkspaceSnapshot(['home']);
    const store = new TabSessionStore(directory);

    expect(store.getRestorableSession()).toBeNull();
    store.save(home);
    store.flush();

    expect(JSON.parse(readFileSync(store.filePath, 'utf8'))).toEqual(home);
    expect(new TabSessionStore(directory).getRestorableSession()).toBeNull();
  });

  it('protects a previous useful session until restore is resolved', () => {
    const directory = createTemporaryDirectory();
    const previous = createWorkspaceSnapshot(
      ['home', 'settings'],
      'page:settings',
    );
    const firstRun = new TabSessionStore(directory);
    firstRun.save(previous);
    firstRun.flush();

    const nextRun = new TabSessionStore(directory);
    expect(nextRun.getRestorableSession()).toEqual(previous);
    expect(() => nextRun.save(createWorkspaceSnapshot(['home']))).toThrow(
      'must be resolved',
    );
  });

  it('atomically replaces the previous snapshot when ignored or restored', () => {
    const directory = createTemporaryDirectory();
    const previous = createWorkspaceSnapshot(['home', 'help'], 'page:help');
    const home = createWorkspaceSnapshot(['home']);
    const firstRun = new TabSessionStore(directory);
    firstRun.save(previous);
    firstRun.flush();

    const nextRun = new TabSessionStore(directory);
    nextRun.resolveRestorableSession(home);

    expect(new TabSessionStore(directory).getRestorableSession()).toBeNull();
    expect(JSON.parse(readFileSync(nextRun.filePath, 'utf8'))).toEqual(home);
  });
});
