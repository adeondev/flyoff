import {
  getTabTargetKey,
  isProjectTarget,
  WORKSPACE_SESSION_VERSION,
  type ProjectWorkspaceSnapshot,
  type TabDescriptor,
  type TabTarget,
  type WorkspaceSessionSnapshot,
} from '../../../shared/contracts';
import { getTabTargetPageDefinition } from '../../pages/page-registry';
import {
  createDescriptor,
  createInitialTabState,
  hasNonHomeTabs,
  normalizeRendererTabSession,
  tabReducer,
  type TabAction,
  type TabState,
} from './tab-state';

export type WorkspaceContext = 'home' | 'project';

export interface ProjectWorkspaceState {
  projectId: string;
  tabs: readonly TabDescriptor[];
  activeTabId: string | null;
}

export interface WorkspaceState {
  home: TabState;
  project: ProjectWorkspaceState | null;
}

export type WorkspaceAction =
  | TabAction
  | { type: 'open-project-workspace'; projectId: string }
  | { type: 'close-project-workspace' }
  | { type: 'restore-workspace'; snapshot: WorkspaceSessionSnapshot };

export interface ActiveTabsView {
  tabs: readonly TabDescriptor[];
  activeTabId: string | null;
}

export function createInitialWorkspaceState(): WorkspaceState {
  return { home: createInitialTabState(), project: null };
}

export function selectActiveContext(state: WorkspaceState): WorkspaceContext {
  return state.project ? 'project' : 'home';
}

export function selectActiveTabs(state: WorkspaceState): ActiveTabsView {
  return state.project
    ? { tabs: state.project.tabs, activeTabId: state.project.activeTabId }
    : { tabs: state.home.tabs, activeTabId: state.home.activeTabId };
}

export function hasRestorableWorkspace(state: WorkspaceState): boolean {
  return state.project !== null || hasNonHomeTabs(state.home);
}

function projectOpenTarget(
  state: ProjectWorkspaceState,
  target: TabTarget,
): ProjectWorkspaceState {
  if (!isProjectTarget(target) || target.projectId !== state.projectId) {
    return state;
  }

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

function projectCloseTab(
  state: ProjectWorkspaceState,
  tabId: string,
): ProjectWorkspaceState {
  const index = state.tabs.findIndex((tab) => tab.tabId === tabId);

  if (index < 0) {
    return state;
  }

  const tabs = state.tabs.filter((tab) => tab.tabId !== tabId);

  if (tabs.length === 0) {
    return { ...state, tabs, activeTabId: null };
  }

  if (state.activeTabId !== tabId) {
    return { ...state, tabs };
  }

  const neighbor = tabs[Math.min(index, tabs.length - 1)];

  return { ...state, tabs, activeTabId: neighbor?.tabId ?? tabs[0]?.tabId ?? null };
}

function projectMoveTab(
  state: ProjectWorkspaceState,
  tabId: string,
  toIndex: number,
): ProjectWorkspaceState {
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

function updateProjectTab(
  state: ProjectWorkspaceState,
  tabId: string,
  update: (tab: TabDescriptor) => TabDescriptor,
): ProjectWorkspaceState {
  const index = state.tabs.findIndex((tab) => tab.tabId === tabId);
  const current = index < 0 ? undefined : state.tabs[index];

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

function projectTabReducer(
  state: ProjectWorkspaceState,
  action: TabAction,
): ProjectWorkspaceState {
  switch (action.type) {
    case 'open-page':
      return state;
    case 'open-target':
      return projectOpenTarget(state, action.target);
    case 'select-tab':
      return state.tabs.some(({ tabId }) => tabId === action.tabId) &&
        action.tabId !== state.activeTabId
        ? { ...state, activeTabId: action.tabId }
        : state;
    case 'close-tab':
      return projectCloseTab(state, action.tabId);
    case 'move-tab':
      return projectMoveTab(state, action.tabId, action.toIndex);
    case 'update-scroll': {
      if (!Number.isFinite(action.scrollTop)) {
        return state;
      }

      const scrollTop = Math.min(10_000_000, Math.max(0, action.scrollTop));
      return updateProjectTab(state, action.tabId, (tab) =>
        tab.scrollTop === scrollTop ? tab : { ...tab, scrollTop },
      );
    }
    case 'update-page-state':
      return updateProjectTab(state, action.tabId, (tab) => ({
        ...tab,
        pageState: getTabTargetPageDefinition(tab.target).migrateState(
          action.pageState,
        ),
      }));
    case 'restore-session':
      return state;
  }
}

function adoptProjectWorkspace(
  snapshot: ProjectWorkspaceSnapshot,
): ProjectWorkspaceState {
  const seen = new Set<string>();
  const tabs: TabDescriptor[] = [];

  for (const tab of snapshot.tabs) {
    const targetKey = getTabTargetKey(tab.target);

    if (seen.has(targetKey)) {
      continue;
    }

    seen.add(targetKey);
    tabs.push({
      ...tab,
      pageState: getTabTargetPageDefinition(tab.target).migrateState(
        tab.pageState,
      ),
    });
  }

  const activeTabId =
    tabs.length === 0
      ? null
      : tabs.some(({ tabId }) => tabId === snapshot.activeTabId)
        ? snapshot.activeTabId
        : (tabs[0]?.tabId ?? null);

  return { projectId: snapshot.projectId, tabs, activeTabId };
}

export function adoptWorkspaceSnapshot(
  snapshot: WorkspaceSessionSnapshot,
): WorkspaceState {
  return {
    home: normalizeRendererTabSession(snapshot.home),
    project: snapshot.project
      ? adoptProjectWorkspace(snapshot.project)
      : null,
  };
}

export function serializeWorkspace(
  state: WorkspaceState,
): WorkspaceSessionSnapshot {
  return {
    version: WORKSPACE_SESSION_VERSION,
    home: state.home,
    project: state.project
      ? {
          projectId: state.project.projectId,
          tabs: state.project.tabs,
          activeTabId: state.project.activeTabId,
        }
      : null,
  };
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case 'open-project-workspace': {
      const overview = createDescriptor({
        type: 'project-overview',
        projectId: action.projectId,
      });

      return {
        ...state,
        project: {
          projectId: action.projectId,
          tabs: [overview],
          activeTabId: overview.tabId,
        },
      };
    }
    case 'close-project-workspace':
      return state.project ? { ...state, project: null } : state;
    case 'restore-workspace':
      return adoptWorkspaceSnapshot(action.snapshot);
    default: {
      if (state.project) {
        const nextProject = projectTabReducer(state.project, action);
        return nextProject === state.project
          ? state
          : { ...state, project: nextProject };
      }

      const nextHome = tabReducer(state.home, action);
      return nextHome === state.home ? state : { ...state, home: nextHome };
    }
  }
}
