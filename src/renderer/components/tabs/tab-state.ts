import {
  INTERNAL_PAGE_IDS,
  TAB_SESSION_VERSION,
  createTabIdForTarget,
  getTabTargetKey,
  isHomeTarget,
  normalizeTabSessionSnapshot,
  type InternalPageId,
  type PageSessionState,
  type TabDescriptor,
  type TabSessionSnapshot,
  type TabTarget,
} from '../../../shared/contracts';
import { getTabTargetPageDefinition } from '../../pages/page-registry';

export type TabState = TabSessionSnapshot;

export type TabAction =
  | { type: 'open-page'; pageId: InternalPageId }
  | { type: 'open-target'; target: TabTarget }
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

export function createDescriptor(target: TabTarget): TabDescriptor {
  const definition = getTabTargetPageDefinition(target);

  return {
    tabId: createTabIdForTarget(target),
    target,
    scrollTop: 0,
    pageState: definition.createInitialState(),
  };
}

export function createInitialTabState(): TabState {
  const home = createDescriptor({
    type: 'internal',
    pageId: INTERNAL_PAGE_IDS.home,
  });

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

  const targetKeys = new Set<string>();
  const tabs: TabDescriptor[] = [];

  for (const tab of normalized.tabs) {
    const targetKey = getTabTargetKey(tab.target);

    if (targetKeys.has(targetKey)) {
      continue;
    }

    targetKeys.add(targetKey);
    const definition = getTabTargetPageDefinition(tab.target);
    tabs.push({
      ...tab,
      pageState: definition.migrateState(tab.pageState),
    });
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

function openTarget(state: TabState, target: TabTarget): TabState {
  const targetKey = getTabTargetKey(target);
  const existing = state.tabs.find(
    (tab) => getTabTargetKey(tab.target) === targetKey,
  );

  if (existing) {
    return existing.tabId === state.activeTabId
      ? state
      : { ...state, activeTabId: existing.tabId };
  }

  const tab = createDescriptor(target);

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
    closingTab &&
    isHomeTarget(closingTab.target)
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
      return openTarget(state, {
        type: 'internal',
        pageId: action.pageId,
      });
    case 'open-target':
      return openTarget(state, action.target);
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
        pageState: getTabTargetPageDefinition(tab.target).migrateState(
          action.pageState,
        ),
      }));
    case 'restore-session':
      return normalizeRendererTabSession(action.session);
  }
}

export function hasNonHomeTabs(state: TabState): boolean {
  return state.tabs.some(({ target }) => !isHomeTarget(target));
}
