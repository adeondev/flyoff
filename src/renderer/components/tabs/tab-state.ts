import {
  INTERNAL_PAGE_IDS,
  TAB_SESSION_VERSION,
  normalizeTabSessionSnapshot,
  type InternalPageId,
  type PageSessionState,
  type TabDescriptor,
  type TabSessionSnapshot,
} from '../../../shared/contracts';
import { getPageDefinition } from '../../pages/page-registry';

export type TabState = TabSessionSnapshot;

export type TabAction =
  | { type: 'open-page'; pageId: InternalPageId }
  | {
      type: 'open-instance';
      pageId: InternalPageId;
      tabId: string;
      instanceKey: string;
    }
  | { type: 'select-tab'; tabId: string }
  | { type: 'close-tab'; tabId: string }
  | { type: 'move-tab'; tabId: string; toIndex: number }
  | { type: 'update-scroll'; tabId: string; scrollTop: number }
  | {
      type: 'update-page-state';
      tabId: string;
      pageState: PageSessionState;
    }
  | { type: 'restore-session'; session: TabSessionSnapshot };

function createDescriptor(
  pageId: InternalPageId,
  tabId: string,
  instanceKey?: string,
): TabDescriptor {
  const definition = getPageDefinition(pageId);

  return {
    tabId,
    pageId,
    ...(instanceKey ? { instanceKey } : {}),
    scrollTop: 0,
    pageState: definition.createInitialState(),
  };
}

export function createInitialTabState(): TabState {
  const home = createDescriptor(
    INTERNAL_PAGE_IDS.home,
    `page:${INTERNAL_PAGE_IDS.home}`,
  );

  return {
    version: TAB_SESSION_VERSION,
    tabs: [home],
    activeTabId: home.tabId,
  };
}

export function normalizeRendererTabSession(
  session: unknown,
): TabSessionSnapshot {
  const normalized = normalizeTabSessionSnapshot(session);

  if (!normalized) {
    return createInitialTabState();
  }

  const singletonPages = new Set<InternalPageId>();
  const tabs: TabDescriptor[] = [];

  for (const tab of normalized.tabs) {
    const definition = getPageDefinition(tab.pageId);

    if (definition.singleton && singletonPages.has(tab.pageId)) {
      continue;
    }

    if (definition.singleton) {
      singletonPages.add(tab.pageId);
    }

    tabs.push({
      ...tab,
      pageState: definition.migrateState(tab.pageState),
    });
  }

  if (tabs.length === 0) {
    return createInitialTabState();
  }

  const firstTab = tabs[0];

  if (!firstTab) {
    return createInitialTabState();
  }

  return {
    version: TAB_SESSION_VERSION,
    tabs,
    activeTabId: tabs.some(({ tabId }) => tabId === normalized.activeTabId)
      ? normalized.activeTabId
      : firstTab.tabId,
  };
}

function openPage(
  state: TabState,
  pageId: InternalPageId,
): TabState {
  const existing = state.tabs.find((tab) => tab.pageId === pageId);

  if (existing) {
    return existing.tabId === state.activeTabId
      ? state
      : { ...state, activeTabId: existing.tabId };
  }

  const definition = getPageDefinition(pageId);

  if (!definition.singleton) {
    return state;
  }

  const tab = createDescriptor(pageId, `page:${pageId}`);

  return {
    ...state,
    tabs: [...state.tabs, tab],
    activeTabId: tab.tabId,
  };
}

function closeTab(state: TabState, tabId: string): TabState {
  const closingIndex = state.tabs.findIndex((tab) => tab.tabId === tabId);

  if (closingIndex < 0) {
    return state;
  }

  const closingTab = state.tabs[closingIndex];

  if (
    state.tabs.length === 1 &&
    closingTab?.pageId === INTERNAL_PAGE_IDS.home
  ) {
    return state;
  }

  const tabs = state.tabs.filter((tab) => tab.tabId !== tabId);

  if (tabs.length === 0) {
    return createInitialTabState();
  }

  const firstTab = tabs[0];

  if (!firstTab) {
    return createInitialTabState();
  }

  if (state.activeTabId !== tabId) {
    return { ...state, tabs };
  }

  const neighbor = tabs[Math.min(closingIndex, tabs.length - 1)];

  return {
    ...state,
    tabs,
    activeTabId: neighbor?.tabId ?? firstTab.tabId,
  };
}

function moveTab(
  state: TabState,
  tabId: string,
  toIndex: number,
): TabState {
  const fromIndex = state.tabs.findIndex((tab) => tab.tabId === tabId);
  const boundedIndex = Math.max(
    0,
    Math.min(Math.trunc(toIndex), state.tabs.length - 1),
  );

  if (fromIndex < 0 || fromIndex === boundedIndex) {
    return state;
  }

  const tabs = [...state.tabs];
  const [tab] = tabs.splice(fromIndex, 1);

  if (!tab) {
    return state;
  }

  tabs.splice(boundedIndex, 0, tab);

  return { ...state, tabs };
}

function updateTab(
  state: TabState,
  tabId: string,
  update: (tab: TabDescriptor) => TabDescriptor,
): TabState {
  const index = state.tabs.findIndex((tab) => tab.tabId === tabId);

  if (index < 0) {
    return state;
  }

  const current = state.tabs[index];

  if (!current) {
    return state;
  }

  const next = update(current);

  if (next === current) {
    return state;
  }

  const tabs = [...state.tabs];
  tabs[index] = next;
  return { ...state, tabs };
}

export function tabReducer(state: TabState, action: TabAction): TabState {
  switch (action.type) {
    case 'open-page':
      return openPage(state, action.pageId);
    case 'open-instance': {
      if (state.tabs.some(({ tabId }) => tabId === action.tabId)) {
        return { ...state, activeTabId: action.tabId };
      }

      const definition = getPageDefinition(action.pageId);

      if (definition.singleton) {
        return openPage(state, action.pageId);
      }

      const tab = createDescriptor(
        action.pageId,
        action.tabId,
        action.instanceKey,
      );
      return {
        ...state,
        tabs: [...state.tabs, tab],
        activeTabId: tab.tabId,
      };
    }
    case 'select-tab':
      return state.tabs.some(({ tabId }) => tabId === action.tabId) &&
        action.tabId !== state.activeTabId
        ? { ...state, activeTabId: action.tabId }
        : state;
    case 'close-tab':
      return closeTab(state, action.tabId);
    case 'move-tab':
      return moveTab(state, action.tabId, action.toIndex);
    case 'update-scroll': {
      if (!Number.isFinite(action.scrollTop)) {
        return state;
      }

      const scrollTop = Math.min(
        10_000_000,
        Math.max(0, action.scrollTop),
      );
      return updateTab(state, action.tabId, (tab) =>
        tab.scrollTop === scrollTop ? tab : { ...tab, scrollTop },
      );
    }
    case 'update-page-state':
      return updateTab(state, action.tabId, (tab) => ({
        ...tab,
        pageState: getPageDefinition(tab.pageId).migrateState(
          action.pageState,
        ),
      }));
    case 'restore-session':
      return normalizeRendererTabSession(action.session);
  }
}

export function hasNonHomeTabs(state: TabState): boolean {
  return state.tabs.some(
    ({ pageId }) => pageId !== INTERNAL_PAGE_IDS.home,
  );
}
