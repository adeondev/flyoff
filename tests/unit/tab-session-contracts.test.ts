import { describe, expect, it } from 'vitest';

import {
  hasRestorablePages,
  hasRestorableWorkspaceSnapshot,
  isCloseRequest,
  isCloseResponse,
  isRendererMenuCommand,
  isTabSessionSnapshot,
  isWorkspaceSessionSnapshot,
  normalizeTabSessionSnapshot,
  normalizeWorkspaceSessionSnapshot,
  TAB_SESSION_VERSION,
  WORKSPACE_SESSION_VERSION,
  type InternalPageId,
  type TabDescriptor,
  type TabSessionSnapshot,
} from '../../src/shared/contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';

function createProjectTab(nodeId: string): TabDescriptor {
  return {
    tabId: `project:${PROJECT_ID}:node:${nodeId}`,
    target: {
      type: 'project-content',
      projectId: PROJECT_ID,
      nodeId,
      pageType: 'markdown',
    },
    scrollTop: 0,
    pageState: { version: 1, data: {} },
  };
}

function createSnapshot(
  pageIds: readonly InternalPageId[] = ['home'],
): TabSessionSnapshot {
  const tabs = pageIds.map((pageId) => ({
    tabId: `page:${pageId}`,
    target: { type: 'internal' as const, pageId },
    scrollTop: 0,
    pageState: { version: 1, data: {} },
  }));

  return {
    version: TAB_SESSION_VERSION,
    tabs,
    activeTabId: tabs[0]?.tabId ?? 'page:home',
  };
}

describe('tab session contracts', () => {
  it('accepts valid internal and project targets', () => {
    const home = createSnapshot();
    const project: TabSessionSnapshot = {
      version: TAB_SESSION_VERSION,
      tabs: [
        ...home.tabs,
        {
          tabId: `project:${PROJECT_ID}:node:${NODE_ID}`,
          target: {
            type: 'project-content',
            projectId: PROJECT_ID,
            nodeId: NODE_ID,
            pageType: 'markdown',
          },
          scrollTop: 48,
          pageState: { version: 1, data: { mode: 'source' } },
        },
        {
          tabId: `project:${PROJECT_ID}:graph`,
          target: {
            type: 'project-graph',
            projectId: PROJECT_ID,
          },
          scrollTop: 0,
          pageState: {
            version: 1,
            data: {
              camera: { x: 12, y: -8, zoom: 1.25 },
              selectedNodeId: NODE_ID,
            },
          },
        },
      ],
      activeTabId: `project:${PROJECT_ID}:graph`,
    };

    expect(isTabSessionSnapshot(home)).toBe(true);
    expect(hasRestorablePages(home)).toBe(false);
    expect(isTabSessionSnapshot(project)).toBe(true);
    expect(hasRestorablePages(project)).toBe(true);
  });

  it('migrates a version 1 snapshot without persisting legacy fields', () => {
    const normalized = normalizeTabSessionSnapshot({
      version: 1,
      tabs: [
        {
          tabId: 'page:home',
          pageId: 'home',
          scrollTop: 12,
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
    });

    expect(normalized).toEqual({
      version: TAB_SESSION_VERSION,
      tabs: [
        {
          tabId: 'page:home',
          target: { type: 'internal', pageId: 'home' },
          scrollTop: 12,
          pageState: { version: 1, data: {} },
        },
        {
          tabId: 'page:settings',
          target: { type: 'internal', pageId: 'settings' },
          scrollTop: 0,
          pageState: { version: 1, data: {} },
        },
      ],
      activeTabId: 'page:settings',
    });
  });

  it('filters target types removed by a newer application version', () => {
    const normalized = normalizeTabSessionSnapshot({
      version: TAB_SESSION_VERSION,
      tabs: [
        createSnapshot().tabs[0],
        {
          tabId: 'page:removed',
          target: { type: 'internal', pageId: 'removed-page' },
          scrollTop: 12,
          pageState: { version: 1, data: {} },
        },
      ],
      activeTabId: 'page:removed',
    });

    expect(normalized).toEqual(createSnapshot());
  });

  it('recovers only the page state that cannot be migrated safely', () => {
    const snapshot = createSnapshot(['home', 'settings']);
    const malformed = {
      ...snapshot,
      tabs: [
        snapshot.tabs[0],
        {
          ...snapshot.tabs[1],
          pageState: { version: 0, data: undefined },
        },
      ],
    };

    expect(isTabSessionSnapshot(malformed)).toBe(false);
    expect(normalizeTabSessionSnapshot(malformed)).toEqual({
      ...snapshot,
      tabs: [
        snapshot.tabs[0],
        {
          ...snapshot.tabs[1],
          pageState: { version: 1, data: null },
        },
      ],
    });
  });

  it('rejects malformed data, duplicate identifiers and duplicate targets', () => {
    const tab = createSnapshot().tabs[0];

    expect(
      normalizeTabSessionSnapshot({
        version: TAB_SESSION_VERSION,
        tabs: [tab, tab],
        activeTabId: tab?.tabId,
      }),
    ).toBeUndefined();
    expect(
      normalizeTabSessionSnapshot({
        version: TAB_SESSION_VERSION,
        tabs: [tab, { ...tab, tabId: 'page:another-home' }],
        activeTabId: tab?.tabId,
      }),
    ).toBeUndefined();
    expect(
      normalizeTabSessionSnapshot({
        version: TAB_SESSION_VERSION,
        tabs: [{ ...tab, scrollTop: -1 }],
        activeTabId: tab?.tabId,
      }),
    ).toBeUndefined();
    expect(
      normalizeTabSessionSnapshot({
        version: TAB_SESSION_VERSION,
        tabs: [
          {
            ...tab,
            target: {
              type: 'project-overview',
              projectId: 'renderer-controlled-path',
            },
          },
        ],
        activeTabId: tab?.tabId,
      }),
    ).toBeUndefined();
    expect(
      isTabSessionSnapshot({
        ...createSnapshot(),
        tabs: [
          {
            ...tab,
            target: {
              type: 'internal',
              pageId: 'home',
              path: 'private/path.md',
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isTabSessionSnapshot({
        ...createSnapshot(),
        activeTabId: 'page:missing',
      }),
    ).toBe(false);
  });

  it('validates close handshakes and renderer-owned commands', () => {
    const session = {
      version: WORKSPACE_SESSION_VERSION,
      home: paneWorkspace(
        createSnapshot(['home', 'settings']).tabs,
        'page:home',
        'home-pane-1',
      ),
      project: null,
    };

    expect(
      isCloseRequest({ requestId: 'close:1', intent: 'close-window' }),
    ).toBe(true);
    expect(
      isCloseResponse({
        requestId: 'close:1',
        decision: 'confirm',
        session,
      }),
    ).toBe(true);
    expect(
      isCloseResponse({ requestId: 'close:1', decision: 'confirm' }),
    ).toBe(false);
    expect(isRendererMenuCommand('file.closeTab')).toBe(true);
    expect(isRendererMenuCommand('file.closeWindow')).toBe(false);
  });
});

function paneWorkspace(
  tabs: readonly TabDescriptor[],
  activeTabId: string | null,
  paneId: string,
) {
  return {
    root: { kind: 'pane' as const, paneId, tabs, activeTabId },
    activePaneId: paneId,
  };
}

describe('workspace session contracts', () => {
  it('round-trips a version 4 pane workspace snapshot', () => {
    const home = createSnapshot(['home', 'settings']);
    const projectTab = createProjectTab(NODE_ID);
    const snapshot = {
      version: WORKSPACE_SESSION_VERSION,
      home: paneWorkspace(home.tabs, home.activeTabId, 'home-pane-1'),
      project: {
        projectId: PROJECT_ID,
        ...paneWorkspace(
          [projectTab],
          projectTab.tabId,
          'project-pane-1',
        ),
      },
    };

    expect(isWorkspaceSessionSnapshot(snapshot)).toBe(true);
    expect(normalizeWorkspaceSessionSnapshot(snapshot)).toEqual(snapshot);
    expect(hasRestorableWorkspaceSnapshot(snapshot)).toBe(true);
  });

  it('persists application settings inside a project pane', () => {
    const home = createSnapshot(['home']);
    const settings = createSnapshot(['settings']).tabs[0]!;
    const snapshot = {
      version: WORKSPACE_SESSION_VERSION,
      home: paneWorkspace(home.tabs, home.activeTabId, 'home-pane-1'),
      project: {
        projectId: PROJECT_ID,
        ...paneWorkspace([settings], settings.tabId, 'project-pane-1'),
      },
    };

    expect(isWorkspaceSessionSnapshot(snapshot)).toBe(true);
    expect(normalizeWorkspaceSessionSnapshot(snapshot)).toEqual(snapshot);
  });

  it('migrates a version 3 workspace without losing tabs', () => {
    const home = createSnapshot(['home', 'settings']);
    const projectTab = createProjectTab(NODE_ID);
    const migrated = normalizeWorkspaceSessionSnapshot({
      version: 3,
      home,
      project: {
        projectId: PROJECT_ID,
        tabs: [projectTab],
        activeTabId: projectTab.tabId,
      },
    });

    expect(migrated?.version).toBe(WORKSPACE_SESSION_VERSION);
    expect(migrated?.home.root).toMatchObject({
      kind: 'pane',
      tabs: home.tabs,
      activeTabId: home.activeTabId,
    });
    expect(migrated?.project?.root).toMatchObject({
      kind: 'pane',
      tabs: [projectTab],
      activeTabId: projectTab.tabId,
    });
  });

  it('accepts a split workspace and clamps recoverable ratios', () => {
    const home = createSnapshot();
    const settings = createSnapshot(['settings']).tabs[0]!;
    const normalized = normalizeWorkspaceSessionSnapshot({
      version: WORKSPACE_SESSION_VERSION,
      home: {
        activePaneId: 'left',
        root: {
          kind: 'split',
          splitId: 'split-1',
          direction: 'row',
          ratio: 2,
          first: {
            kind: 'pane',
            paneId: 'left',
            tabs: home.tabs,
            activeTabId: home.activeTabId,
          },
          second: {
            kind: 'pane',
            paneId: 'right',
            tabs: [settings],
            activeTabId: settings.tabId,
          },
        },
      },
      project: null,
    });

    expect(normalized?.home.root).toMatchObject({
      kind: 'split',
      ratio: 0.9,
    });
    expect(isWorkspaceSessionSnapshot(normalized)).toBe(true);
  });

  it('migrates a flat snapshot by splitting contexts into single panes', () => {
    const home = createSnapshot(['home', 'settings']);
    const projectTab = createProjectTab(NODE_ID);
    const migrated = normalizeWorkspaceSessionSnapshot({
      version: TAB_SESSION_VERSION,
      tabs: [...home.tabs, projectTab],
      activeTabId: projectTab.tabId,
    });

    expect(migrated?.home.root).toMatchObject({
      kind: 'pane',
      tabs: home.tabs,
    });
    expect(migrated?.project?.root).toMatchObject({
      kind: 'pane',
      tabs: [projectTab],
      activeTabId: projectTab.tabId,
    });
  });

  it('rejects duplicate pane and tab identifiers', () => {
    const home = createSnapshot();
    expect(
      isWorkspaceSessionSnapshot({
        version: WORKSPACE_SESSION_VERSION,
        home: {
          activePaneId: 'same',
          root: {
            kind: 'split',
            splitId: 'split-1',
            direction: 'row',
            ratio: 0.5,
            first: {
              kind: 'pane',
              paneId: 'same',
              tabs: home.tabs,
              activeTabId: home.activeTabId,
            },
            second: {
              kind: 'pane',
              paneId: 'same',
              tabs: home.tabs,
              activeTabId: home.activeTabId,
            },
          },
        },
        project: null,
      }),
    ).toBe(false);
  });
});
