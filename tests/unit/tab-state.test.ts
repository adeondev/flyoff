import { describe, expect, it } from 'vitest';

import {
  createInitialTabState,
  hasNonHomeTabs,
  normalizeRendererTabSession,
  tabReducer,
} from '../../src/renderer/components/tabs/tab-state';
import { INTERNAL_PAGE_IDS } from '../../src/shared/contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';

describe('renderer tab state', () => {
  it('opens singleton pages once and selects the existing tab', () => {
    const initial = createInitialTabState();
    const opened = tabReducer(initial, {
      type: 'open-page',
      pageId: INTERNAL_PAGE_IDS.settings,
    });
    const selectedHome = tabReducer(opened, {
      type: 'select-tab',
      tabId: 'page:home',
    });
    const reopened = tabReducer(selectedHome, {
      type: 'open-page',
      pageId: INTERNAL_PAGE_IDS.settings,
    });

    expect(reopened.tabs.map(({ tabId }) => tabId)).toEqual([
      'page:home',
      'page:settings',
    ]);
    expect(reopened.activeTabId).toBe('page:settings');
    expect(hasNonHomeTabs(reopened)).toBe(true);
  });

  it('opens Twine once and restores its registered page state', () => {
    const initial = createInitialTabState();
    const opened = tabReducer(initial, {
      type: 'open-page',
      pageId: INTERNAL_PAGE_IDS.twine,
    });
    const selectedHome = tabReducer(opened, {
      type: 'select-tab',
      tabId: 'page:home',
    });
    const reopened = tabReducer(selectedHome, {
      type: 'open-page',
      pageId: INTERNAL_PAGE_IDS.twine,
    });
    const restored = normalizeRendererTabSession(reopened);

    expect(restored.tabs.map(({ tabId }) => tabId)).toEqual([
      'page:home',
      'page:twine',
    ]);
    expect(restored.activeTabId).toBe('page:twine');
    expect(restored.tabs[1]?.pageState).toEqual({
      version: 3,
      data: {
        activeConversationId: null,
        modelId: 'google/gemma-4-31B-it',
        approvalMode: 'request',
        documentContextEnabled: false,
        documentContextScope: 'current',
        researchEnabled: false,
        thinkingLevel: 'high',
      },
    });
  });

  it('opens project targets once by their stable identity', () => {
    const initial = createInitialTabState();
    const overview = tabReducer(initial, {
      type: 'open-target',
      target: { type: 'project-overview', projectId: PROJECT_ID },
    });
    const content = tabReducer(overview, {
      type: 'open-target',
      target: {
        type: 'project-content',
        projectId: PROJECT_ID,
        nodeId: NODE_ID,
        pageType: 'markdown',
      },
    });
    const selectedOverview = tabReducer(content, {
      type: 'open-target',
      target: { type: 'project-overview', projectId: PROJECT_ID },
    });
    const reopenedContent = tabReducer(selectedOverview, {
      type: 'open-target',
      target: {
        type: 'project-content',
        projectId: PROJECT_ID,
        nodeId: NODE_ID,
        pageType: 'markdown',
      },
    });

    expect(reopenedContent.tabs.map(({ tabId }) => tabId)).toEqual([
      'page:home',
      `project:${PROJECT_ID}:overview`,
      `project:${PROJECT_ID}:node:${NODE_ID}`,
    ]);
    expect(reopenedContent.activeTabId).toBe(
      `project:${PROJECT_ID}:node:${NODE_ID}`,
    );
  });

  it('protects a lone Home and recreates it after the final page closes', () => {
    const initial = createInitialTabState();

    expect(
      tabReducer(initial, { type: 'close-tab', tabId: 'page:home' }),
    ).toBe(initial);

    const settings = tabReducer(initial, {
      type: 'open-page',
      pageId: INTERNAL_PAGE_IDS.settings,
    });
    const withoutHome = tabReducer(settings, {
      type: 'close-tab',
      tabId: 'page:home',
    });
    const closedLast = tabReducer(withoutHome, {
      type: 'close-tab',
      tabId: 'page:settings',
    });

    expect(closedLast).toEqual(initial);
  });

  it('selects the right neighbor first and then the left neighbor', () => {
    let state = createInitialTabState();

    for (const pageId of [
      INTERNAL_PAGE_IDS.thisDevice,
      INTERNAL_PAGE_IDS.settings,
    ]) {
      state = tabReducer(state, { type: 'open-page', pageId });
    }

    state = tabReducer(state, {
      type: 'select-tab',
      tabId: 'page:this-device',
    });
    state = tabReducer(state, {
      type: 'close-tab',
      tabId: 'page:this-device',
    });
    expect(state.activeTabId).toBe('page:settings');

    state = tabReducer(state, {
      type: 'close-tab',
      tabId: 'page:settings',
    });
    expect(state.activeTabId).toBe('page:home');
  });

  it('reorders tabs without changing the active tab', () => {
    let state = createInitialTabState();
    state = tabReducer(state, {
      type: 'open-page',
      pageId: INTERNAL_PAGE_IDS.settings,
    });
    state = tabReducer(state, {
      type: 'open-page',
      pageId: INTERNAL_PAGE_IDS.help,
    });
    state = tabReducer(state, {
      type: 'move-tab',
      tabId: 'page:home',
      toIndex: 2,
    });

    expect(state.tabs.map(({ tabId }) => tabId)).toEqual([
      'page:settings',
      'page:help',
      'page:home',
    ]);
    expect(state.activeTabId).toBe('page:help');
  });

  it('keeps scroll and validated page state isolated by tab', () => {
    let state = tabReducer(createInitialTabState(), {
      type: 'open-page',
      pageId: INTERNAL_PAGE_IDS.settings,
    });
    state = tabReducer(state, {
      type: 'update-scroll',
      tabId: 'page:settings',
      scrollTop: 180,
    });
    state = tabReducer(state, {
      type: 'update-page-state',
      tabId: 'page:settings',
      pageState: { version: 1, data: { section: 'general' } },
    });

    expect(state.tabs.find(({ tabId }) => tabId === 'page:settings')).toMatchObject({
      scrollTop: 180,
      pageState: { version: 1, data: { section: 'general' } },
    });
    expect(state.tabs.find(({ tabId }) => tabId === 'page:home')).toMatchObject({
      scrollTop: 0,
      pageState: { version: 1, data: {} },
    });
  });

  it('resets an incompatible page state without discarding other tabs', () => {
    const initial = tabReducer(createInitialTabState(), {
      type: 'open-page',
      pageId: INTERNAL_PAGE_IDS.settings,
    });
    const restored = normalizeRendererTabSession({
      ...initial,
      tabs: initial.tabs.map((tab) =>
        tab.target.type === 'internal' &&
        tab.target.pageId === INTERNAL_PAGE_IDS.settings
          ? { ...tab, pageState: { version: 1, data: null } }
          : tab,
      ),
    });

    expect(restored.tabs).toHaveLength(2);
    expect(
      restored.tabs.find(
        ({ target }) =>
          target.type === 'internal' &&
          target.pageId === INTERNAL_PAGE_IDS.settings,
      )?.pageState,
    ).toEqual({ version: 1, data: {} });
  });
});
