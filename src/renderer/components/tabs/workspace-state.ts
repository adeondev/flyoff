import {
  INTERNAL_PAGE_IDS,
  WORKSPACE_SESSION_VERSION,
  isProjectTarget,
  type InternalPageId,
  type PageSessionState,
  type ProjectWorkspaceSnapshot,
  type TabDescriptor,
  type TabTarget,
  type WorkspaceSessionSnapshot,
  type WorkspaceSplitDirection,
} from '../../../shared/contracts';
import { getPageDefinition } from '../../pages/page-registry';
import { createDescriptor } from './tab-state';
import {
  acceptsProjectTarget,
  closeAllPaneTabs,
  closePaneTab,
  closeWorkspacePane,
  collectPanes,
  createPaneWorkspace,
  findPane,
  migratePaneWorkspace,
  movePaneTab,
  moveOrOpenPaneTarget,
  moveOrOpenPaneTargetReusingNewTab,
  moveTabBetweenPanes,
  openPaneTarget,
  openPaneTargetReusingNewTab,
  resizeWorkspaceSplit,
  selectPane,
  selectPaneTab,
  splitPane,
  splitPaneWithTab,
  splitPaneWithTarget,
  splitPaneWithTargets,
  updatePageState,
  updateScroll,
  type PaneWorkspaceState,
} from './pane-state';

export type WorkspaceContext = 'home' | 'project';

export interface ProjectWorkspaceState extends PaneWorkspaceState {
  projectId: string;
}

export interface WorkspaceState {
  home: PaneWorkspaceState;
  project: ProjectWorkspaceState | null;
}

interface PaneActionTarget {
  paneId?: string;
}

export type WorkspaceAction =
  | ({ type: 'open-page'; pageId: InternalPageId } & PaneActionTarget)
  | ({
      type: 'open-target';
      target: TabTarget;
      initialPageState?: PageSessionState;
    } & PaneActionTarget)
  | ({
      type: 'open-target-reusing-new-tab';
      target: TabTarget;
      initialPageState?: PageSessionState;
    } & PaneActionTarget)
  | {
      type: 'move-or-open-target';
      target: TabTarget;
      paneId: string;
      initialPageState?: PageSessionState;
    }
  | {
      type: 'move-or-open-target-reusing-new-tab';
      target: TabTarget;
      paneId: string;
      initialPageState?: PageSessionState;
    }
  | ({ type: 'select-tab'; tabId: string } & PaneActionTarget)
  | ({ type: 'close-tab'; tabId: string } & PaneActionTarget)
  | ({
      type: 'move-tab';
      tabId: string;
      toIndex: number;
    } & PaneActionTarget)
  | ({
      type: 'update-scroll';
      tabId: string;
      scrollTop: number;
    } & PaneActionTarget)
  | ({
      type: 'update-page-state';
      tabId: string;
      pageState: PageSessionState;
    } & PaneActionTarget)
  | { type: 'select-pane'; paneId: string }
  | {
      type: 'split-pane';
      paneId: string;
      direction: WorkspaceSplitDirection;
    }
  | {
      type: 'move-tab-between-panes';
      fromPaneId: string;
      toPaneId: string;
      tabId: string;
    }
  | {
      type: 'split-pane-with-tab';
      fromPaneId: string;
      targetPaneId: string;
      tabId: string;
      direction: WorkspaceSplitDirection;
      before: boolean;
    }
  | {
      type: 'split-pane-with-target';
      targetPaneId: string;
      target: TabTarget;
      direction: WorkspaceSplitDirection;
      before: boolean;
      initialPageState?: PageSessionState;
    }
  | {
      type: 'split-pane-with-targets';
      targetPaneId: string;
      targets: readonly TabTarget[];
      direction: WorkspaceSplitDirection;
      before: boolean;
    }
  | { type: 'close-pane'; paneId: string }
  | { type: 'close-all-project-tabs' }
  | { type: 'resize-split'; splitId: string; ratio: number }
  | { type: 'open-project-workspace'; projectId: string }
  | { type: 'close-project-workspace' }
  | { type: 'restore-workspace'; snapshot: WorkspaceSessionSnapshot };

export interface ActiveTabsView {
  paneId: string;
  tabs: readonly TabDescriptor[];
  activeTabId: string | null;
}

export function createInitialWorkspaceState(): WorkspaceState {
  const home = createDescriptor({
    type: 'internal',
    pageId: INTERNAL_PAGE_IDS.home,
  });
  return { home: createPaneWorkspace([home], 'home-pane-1'), project: null };
}

export function selectActiveContext(state: WorkspaceState): WorkspaceContext {
  return state.project ? 'project' : 'home';
}

export function selectActivePaneWorkspace(
  state: WorkspaceState,
): PaneWorkspaceState {
  return state.project ?? state.home;
}

export function selectActiveTabs(state: WorkspaceState): ActiveTabsView {
  const workspace = selectActivePaneWorkspace(state);
  const pane =
    findPane(workspace.root, workspace.activePaneId) ??
    collectPanes(workspace.root)[0];
  return {
    paneId: pane?.paneId ?? workspace.activePaneId,
    tabs: pane?.tabs ?? [],
    activeTabId: pane?.activeTabId ?? null,
  };
}

export function selectAllActiveContextPanes(
  state: WorkspaceState,
): readonly ActiveTabsView[] {
  const workspace = selectActivePaneWorkspace(state);
  return collectPanes(workspace.root).map((pane) => ({
    paneId: pane.paneId,
    tabs: pane.tabs,
    activeTabId: pane.activeTabId,
  }));
}

export function hasRestorableWorkspace(state: WorkspaceState): boolean {
  if (state.project) {
    return true;
  }
  return collectPanes(state.home.root).some((pane) =>
    pane.tabs.some(
      ({ target }) =>
        target.type !== 'internal' ||
        target.pageId !== INTERNAL_PAGE_IDS.home,
    ),
  );
}

function reducePaneWorkspace(
  workspace: PaneWorkspaceState,
  context: WorkspaceContext,
  action: Exclude<
    WorkspaceAction,
    | { type: 'open-project-workspace' }
    | { type: 'close-project-workspace' }
    | { type: 'close-all-project-tabs' }
    | { type: 'restore-workspace' }
  >,
): PaneWorkspaceState {
  const paneId =
    'paneId' in action && action.paneId
      ? action.paneId
      : workspace.activePaneId;

  switch (action.type) {
    case 'open-page':
      return openPaneTarget(
        workspace,
        { type: 'internal', pageId: action.pageId },
        paneId,
      );
    case 'open-target':
      return openPaneTarget(
        workspace,
        action.target,
        paneId,
        action.initialPageState,
      );
    case 'open-target-reusing-new-tab':
      return openPaneTargetReusingNewTab(
        workspace,
        action.target,
        paneId,
        action.initialPageState,
      );
    case 'move-or-open-target':
      return moveOrOpenPaneTarget(
        workspace,
        action.target,
        action.paneId,
        action.initialPageState,
      );
    case 'move-or-open-target-reusing-new-tab':
      return moveOrOpenPaneTargetReusingNewTab(
        workspace,
        action.target,
        action.paneId,
        action.initialPageState,
      );
    case 'select-pane':
      return selectPane(workspace, action.paneId);
    case 'select-tab':
      return selectPaneTab(workspace, paneId, action.tabId);
    case 'close-tab':
      return closePaneTab(
        workspace,
        paneId,
        action.tabId,
        false,
        context === 'home'
          ? { type: 'internal', pageId: INTERNAL_PAGE_IDS.home }
          : undefined,
      );
    case 'move-tab':
      return movePaneTab(workspace, paneId, action.tabId, action.toIndex);
    case 'update-scroll':
      return updateScroll(
        workspace,
        paneId,
        action.tabId,
        action.scrollTop,
      );
    case 'update-page-state':
      return updatePageState(
        workspace,
        paneId,
        action.tabId,
        action.pageState,
      );
    case 'split-pane':
      return splitPane(workspace, action.paneId, action.direction);
    case 'move-tab-between-panes':
      return moveTabBetweenPanes(
        workspace,
        action.fromPaneId,
        action.toPaneId,
        action.tabId,
      );
    case 'split-pane-with-tab':
      return splitPaneWithTab(
        workspace,
        action.fromPaneId,
        action.targetPaneId,
        action.tabId,
        action.direction,
        action.before,
      );
    case 'split-pane-with-target':
      return splitPaneWithTarget(
        workspace,
        action.targetPaneId,
        action.target,
        action.direction,
        action.before,
        action.initialPageState,
      );
    case 'split-pane-with-targets':
      return splitPaneWithTargets(
        workspace,
        action.targetPaneId,
        action.targets,
        action.direction,
        action.before,
      );
    case 'close-pane':
      return closeWorkspacePane(workspace, action.paneId);
    case 'resize-split':
      return resizeWorkspaceSplit(workspace, action.splitId, action.ratio);
  }
}

function adoptProjectWorkspace(
  snapshot: ProjectWorkspaceSnapshot,
): ProjectWorkspaceState {
  return {
    projectId: snapshot.projectId,
    ...migratePaneWorkspace(snapshot),
  };
}

export function adoptWorkspaceSnapshot(
  snapshot: WorkspaceSessionSnapshot,
): WorkspaceState {
  return {
    home: migratePaneWorkspace(snapshot.home, {
      type: 'internal',
      pageId: INTERNAL_PAGE_IDS.home,
    }),
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
          root: state.project.root,
          activePaneId: state.project.activePaneId,
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
          ...createPaneWorkspace([overview], 'project-pane-1'),
        },
      };
    }
    case 'close-project-workspace':
      return state.project ? { ...state, project: null } : state;
    case 'close-all-project-tabs': {
      if (!state.project) {
        return state;
      }
      const project = closeAllPaneTabs(state.project);
      return project === state.project
        ? state
        : { ...state, project: { ...state.project, ...project } };
    }
    case 'restore-workspace':
      return adoptWorkspaceSnapshot(action.snapshot);
    default: {
      if (state.project) {
        if (
          (action.type === 'open-page' &&
            !getPageDefinition(action.pageId).availableInProject) ||
          ((action.type === 'open-target' ||
            action.type === 'move-or-open-target' ||
            action.type === 'open-target-reusing-new-tab' ||
            action.type === 'move-or-open-target-reusing-new-tab' ||
            action.type === 'split-pane-with-target') &&
            !acceptsProjectTarget(state.project.projectId, action.target)) ||
          (action.type === 'split-pane-with-targets' &&
            action.targets.some(
              (target) =>
                !acceptsProjectTarget(state.project!.projectId, target),
            ))
        ) {
          return state;
        }
        const project = reducePaneWorkspace(state.project, 'project', action);
        return project === state.project
          ? state
          : { ...state, project: { ...state.project, ...project } };
      }

      if (
        (action.type === 'open-target' ||
          action.type === 'move-or-open-target' ||
          action.type === 'open-target-reusing-new-tab' ||
          action.type === 'move-or-open-target-reusing-new-tab' ||
          action.type === 'split-pane-with-target') &&
        isProjectTarget(action.target)
      ) {
        return state;
      }
      if (
        action.type === 'split-pane-with-targets' &&
        action.targets.some(isProjectTarget)
      ) {
        return state;
      }
      const home = reducePaneWorkspace(state.home, 'home', action);
      return home === state.home ? state : { ...state, home };
    }
  }
}
