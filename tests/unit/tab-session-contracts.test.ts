import { describe, expect, it } from 'vitest';

import {
  hasRestorablePages,
  isCloseRequest,
  isCloseResponse,
  isRendererMenuCommand,
  isTabSessionSnapshot,
  normalizeTabSessionSnapshot,
  TAB_SESSION_VERSION,
  type InternalPageId,
  type TabSessionSnapshot,
} from '../../src/shared/contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';

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
      ],
      activeTabId: `project:${PROJECT_ID}:node:${NODE_ID}`,
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
    const session = createSnapshot(['home', 'settings']);

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
