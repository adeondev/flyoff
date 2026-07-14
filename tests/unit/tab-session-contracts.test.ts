import { describe, expect, it } from 'vitest';

import {
  hasRestorablePages,
  isCloseRequest,
  isCloseResponse,
  isRendererMenuCommand,
  isTabSessionSnapshot,
  normalizeTabSessionSnapshot,
  TAB_SESSION_VERSION,
  type TabSessionSnapshot,
} from '../../src/shared/contracts';

function createSnapshot(
  pageIds: readonly ('home' | 'settings')[] = ['home'],
): TabSessionSnapshot {
  const tabs = pageIds.map((pageId) => ({
    tabId: `page:${pageId}`,
    pageId,
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
  it('accepts a valid session and detects whether it is useful to restore', () => {
    const home = createSnapshot();
    const useful = createSnapshot(['home', 'settings']);

    expect(isTabSessionSnapshot(home)).toBe(true);
    expect(hasRestorablePages(home)).toBe(false);
    expect(hasRestorablePages(useful)).toBe(true);
  });

  it('filters page types removed by a newer application version', () => {
    const normalized = normalizeTabSessionSnapshot({
      version: 1,
      tabs: [
        createSnapshot().tabs[0],
        {
          tabId: 'page:removed',
          pageId: 'removed-page',
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

  it('rejects malformed data and duplicate tab identifiers', () => {
    const tab = createSnapshot().tabs[0];

    expect(
      normalizeTabSessionSnapshot({
        version: 1,
        tabs: [tab, tab],
        activeTabId: tab?.tabId,
      }),
    ).toBeUndefined();
    expect(
      normalizeTabSessionSnapshot({
        version: 1,
        tabs: [{ ...tab, scrollTop: -1 }],
        activeTabId: tab?.tabId,
      }),
    ).toBeUndefined();
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
