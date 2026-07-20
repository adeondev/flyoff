import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { flushSync } from 'react-dom';

import flyoffLogo from '../../public/images/flyoff/flyoff-logo.svg';
import sidebarCloseIcon from '../../public/images/icons/actions/sidebar-close.svg';
import sidebarOpenIcon from '../../public/images/icons/actions/sidebar-open.svg';
import closeMenuIcon from '../../public/images/icons/actions/close-pane.svg';
import infoMenuIcon from '../../public/images/icons/actions/info.svg';
import refreshMenuIcon from '../../public/images/icons/actions/refresh.svg';
import markdownPageIcon from '../../public/images/icons/instances/note-solid.svg';
import projectOverviewIcon from '../../public/images/icons/instances/project.svg';
import projectGraphIcon from '../../public/images/icons/navigation/graph.svg';
import {
  APPLICATION_MENU_COMMANDS,
  APPLICATION_MENU_DEFINITIONS,
  INTERNAL_PAGE_IDS,
  RENDERER_MENU_COMMANDS,
  hasRestorableWorkspaceSnapshot,
  isPortableProjectName,
  isProjectTarget,
  isApplicationMenuCommand,
  isRendererMenuCommand,
  ptBR,
  projectFailure,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  type ApplicationMenuEntryDefinition,
  type CloseRequest,
  type CloseResponse,
  type FlyoffApi,
  type FlyoffPlatform,
  type InternalPageId,
  type MarkdownDocument,
  type ProjectBacklinksOutcome,
  type ProjectInternalLinkRequest,
  type ProjectInternalLinkResolution,
  type ProjectInternalLinkTarget,
  type ProjectLinkTarget,
  type ProjectPageNode,
  type ProjectNodesMutationOutcome,
  type ProjectLocationSelection,
  type ProjectNoteActivityEntry,
  type ProjectFailureDetails,
  type ProjectGraphNode,
  type ProjectGraphSnapshot,
  type ProjectResult,
  type ProjectSearchOutcome,
  type ProjectSummary,
  type ProjectTreeNode,
  type RendererMenuCommand,
  type TabDescriptor,
  type TabSessionRestoreDecision,
  type WorkspaceSessionSnapshot,
  type TranslationCatalog,
  type TranslationKey,
  type TrashProjectNodeOutcome,
} from '../shared';
import { CloseConfirmationDialog } from './components/dialog/CloseConfirmationDialog';
import { SessionRestoreToast } from './components/dialog/SessionRestoreToast';
import { ToastHost } from './components/feedback/ToastHost';
import { useToastQueue } from './components/feedback/toast-state';
import { MaskedIcon } from './components/MaskedIcon';
import {
  MenuBar,
  type MenuBarItem,
  type MenuItem,
} from './components/menu';
import { PanelResizer, useWorkspaceLayout } from './components/layout';
import {
  IconRail,
  PlaceholderPanel,
  RAIL_VIEWS,
  RAIL_VIEW_IDS,
  resolveRailView,
} from './components/rail';
import { GlobalSidebar } from './components/Sidebar';
import { collectPanes } from './components/tabs/pane-state';
import {
  WorkspacePaneHost,
  type WorkspacePaneHostHandle,
} from './components/tabs/WorkspacePaneHost';
import { TooltipHost, getTooltipTargetProps } from './components/tooltip';
import {
  adoptWorkspaceSnapshot,
  createInitialWorkspaceState,
  hasRestorableWorkspace,
  selectActiveContext,
  selectActiveTabs,
  serializeWorkspace,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from './components/tabs/workspace-state';
import { initializeRendererI18n } from './i18n';
import {
  FlyoffPreferencesProvider,
  useFlyoffPreferencesController,
} from './preferences';
import { HomePage } from './pages/HomePage';
import {
  NewTabPage,
  type NewTabNoteItem,
  type NewTabSearchOutcome,
} from './pages/NewTabPage';
import {
  getPageDefinition,
  renderRegisteredInternalPage,
} from './pages/page-registry';
import type {
  InternalPageProps,
  PageRenderProps,
  TabPresentation,
  Translate,
} from './pages/page-types';
import {
  CreateProjectDialog,
  MarkdownDocumentController,
  ProjectContentPage,
  ProjectEmptyState,
  ProjectGraphController,
  ProjectGraphPanel,
  ProjectOverview,
  ProjectPagePropertiesDialog,
  ProjectSidebar,
  getProjectPageTypeDefinition,
  type ProjectSidebarHandle,
  type MarkdownLinkNavigation,
  createProjectGraphPageState,
  projectNodeDisplayName,
  projectNodeLogicalPath,
  readProjectGraphViewState,
  resolveProjectNodeLineage,
  useProjectPageProperties,
} from './projects';
import {
  createEditorModeState,
  type EditorMode,
} from './projects/editor-mode';

function translateCatalog(
  catalog: TranslationCatalog,
  key: TranslationKey,
): string {
  const [section, entry] = key.split('.') as [
    keyof TranslationCatalog,
    string,
  ];
  const values = catalog[section] as unknown as Record<string, string>;
  return values[entry] ?? key;
}

const fallbackTranslate: Translate = (key) => translateCatalog(ptBR, key);

const APPLICATION_MENU_ICONS: Readonly<Record<string, string>> = {
  'file.close-tab': closeMenuIcon,
  'window.close': closeMenuIcon,
  'view.reset-zoom': refreshMenuIcon,
  'help.about': infoMenuIcon,
};

function createMenuItems(
  entries: readonly ApplicationMenuEntryDefinition[],
  translate: Translate,
): readonly MenuItem[] {
  return entries.map((entry) => {
    if (entry.kind === 'separator') {
      return { id: entry.id, kind: 'separator' };
    }

    if (entry.kind === 'submenu') {
      return {
        id: entry.id,
        kind: 'submenu',
        label: translate(entry.labelKey),
        children: createMenuItems(entry.children, translate),
        disabled: entry.disabled,
      };
    }

    return {
      id: entry.command,
      kind: 'action',
      label: translate(entry.labelKey),
      shortcut: entry.shortcut?.display,
      icon: APPLICATION_MENU_ICONS[entry.command],
    };
  });
}

function createMenuBarItems(translate: Translate): readonly MenuBarItem[] {
  return APPLICATION_MENU_DEFINITIONS.map((menu) => ({
    id: menu.id,
    label: translate(menu.labelKey),
    items: createMenuItems(menu.children, translate),
  }));
}

interface TitlebarProps {
  menus: readonly MenuBarItem[];
  platform?: FlyoffPlatform;
  sidebarCollapsed: boolean;
  toggleSidebarLabel: string;
  onMenuAction: (id: string) => void;
  onToggleSidebar: () => void;
}

function Titlebar({
  menus,
  platform,
  sidebarCollapsed,
  toggleSidebarLabel,
  onMenuAction,
  onToggleSidebar,
}: TitlebarProps) {
  const isMacOS = platform === 'darwin';

  return (
    <header
      className={`titlebar${isMacOS ? ' titlebar--macos' : ''}`}
      aria-label="Flyoff"
    >
      <div className="titlebar__brand">
        <img src={flyoffLogo} alt="" aria-hidden="true" />
        <span>Flyoff</span>
      </div>
      <button
        aria-label={toggleSidebarLabel}
        aria-pressed={sidebarCollapsed}
        className="titlebar__sidebar-toggle"
        onClick={onToggleSidebar}
        type="button"
        {...getTooltipTargetProps(toggleSidebarLabel, 'bottom')}
      >
        <MaskedIcon
          className="titlebar__sidebar-toggle-icon"
          icon={sidebarCollapsed ? sidebarOpenIcon : sidebarCloseIcon}
        />
      </button>
      {!isMacOS && menus.length > 0 ? (
        <MenuBar
          ariaLabel="Flyoff"
          className="titlebar__menu"
          menus={menus}
          onAction={onMenuAction}
        />
      ) : null}
      <div className="titlebar__drag-space" />
    </header>
  );
}

function getApi(): Partial<FlyoffApi> {
  return window.flyoff as Partial<FlyoffApi>;
}

function unavailableProjectResult<T>(message: string): ProjectResult<T> {
  return {
    ok: false,
    error: { code: 'invalid-operation', message },
  };
}

function applyDefaultProjectPageState(
  action: WorkspaceAction,
  mode: EditorMode,
): WorkspaceAction {
  if (
    (action.type === 'open-target' ||
      action.type === 'move-or-open-target' ||
      action.type === 'open-target-reusing-new-tab' ||
      action.type === 'move-or-open-target-reusing-new-tab' ||
      action.type === 'split-pane-with-target') &&
    action.target.type === 'project-content' &&
    action.initialPageState === undefined
  ) {
    return {
      ...action,
      initialPageState: createEditorModeState(mode),
    };
  }
  return action;
}

function createMarkdownController(
  onSaveError?: (error: ProjectFailureDetails, nodeId: string) => void,
): MarkdownDocumentController {
  return new MarkdownDocumentController({
    reload: (request) => {
      const operation = getApi().readMarkdownDocument;
      return operation
        ? operation(request)
        : Promise.resolve(
            unavailableProjectResult('The project bridge is unavailable.'),
          );
    },
    save: (request) => {
      const operation = getApi().saveMarkdownDocument;
      return operation
        ? operation(request)
        : Promise.resolve(
            unavailableProjectResult('The project bridge is unavailable.'),
          );
    },
    onSaveError,
  });
}

type AppWorkspaceAction =
  | WorkspaceAction
  | { type: 'replace-workspace-state'; state: WorkspaceState };

function appWorkspaceReducer(
  state: WorkspaceState,
  action: AppWorkspaceAction,
): WorkspaceState {
  return action.type === 'replace-workspace-state'
    ? action.state
    : workspaceReducer(state, action);
}

function collapsingPaneId(
  state: WorkspaceState,
  action: WorkspaceAction,
): string | undefined {
  const workspace = state.project ?? state.home;
  const panes = collectPanes(workspace.root);
  if (panes.length <= 1) {
    return undefined;
  }
  if (action.type === 'close-pane') {
    return panes.some(({ paneId }) => paneId === action.paneId)
      ? action.paneId
      : undefined;
  }
  if (action.type !== 'close-tab') {
    return undefined;
  }
  const paneId = action.paneId ?? workspace.activePaneId;
  const pane = panes.find((candidate) => candidate.paneId === paneId);
  return pane?.tabs.length === 1 &&
    pane.tabs[0]?.tabId === action.tabId
    ? paneId
    : undefined;
}

function workspaceExitTarget(
  state: WorkspaceState,
  action: WorkspaceAction,
):
  | { kind: 'pane'; paneId: string }
  | { kind: 'tab-and-pane'; paneId: string; tabId: string }
  | { kind: 'tab'; paneId: string; tabId: string }
  | undefined {
  const paneId = collapsingPaneId(state, action);
  if (paneId) {
    return action.type === 'close-tab'
      ? { kind: 'tab-and-pane', paneId, tabId: action.tabId }
      : { kind: 'pane', paneId };
  }
  if (action.type !== 'close-tab') {
    return undefined;
  }
  const workspace = state.project ?? state.home;
  const resolvedPaneId = action.paneId ?? workspace.activePaneId;
  const pane = collectPanes(workspace.root).find(
    (candidate) => candidate.paneId === resolvedPaneId,
  );
  return pane?.tabs.some(({ tabId }) => tabId === action.tabId)
    ? { kind: 'tab', paneId: resolvedPaneId, tabId: action.tabId }
    : undefined;
}

function activeProjectNodeId(state: WorkspaceState): string | undefined {
  const workspace = state.project;
  if (!workspace) {
    return undefined;
  }
  const pane = collectPanes(workspace.root).find(
    ({ paneId }) => paneId === workspace.activePaneId,
  );
  const activeTab = pane?.tabs.find(
    ({ tabId }) => tabId === pane.activeTabId,
  );
  return activeTab?.target.type === 'project-content' &&
    activeTab.target.pageType === 'markdown'
    ? activeTab.target.nodeId
    : undefined;
}

function projectDocumentNodeIds(state: WorkspaceState): ReadonlySet<string> {
  return new Set(
    state.project
      ? collectPanes(state.project.root).flatMap(({ tabs }) =>
          tabs.flatMap(({ target }) =>
            target.type === 'project-content' &&
            target.pageType === 'markdown'
              ? [target.nodeId]
              : [],
          ),
        )
      : [],
  );
}

function tracksProjectActivation(action: WorkspaceAction): boolean {
  return (
    action.type === 'open-target' ||
    action.type === 'move-or-open-target' ||
    action.type === 'open-target-reusing-new-tab' ||
    action.type === 'move-or-open-target-reusing-new-tab' ||
    action.type === 'split-pane-with-target' ||
    action.type === 'split-pane-with-targets' ||
    action.type === 'select-tab' ||
    action.type === 'select-pane'
  );
}

const WORKSPACE_SCROLL_SETTLE_MS = 120;

export function App() {
  const [platform, setPlatform] = useState<FlyoffPlatform>();
  const [translator, setTranslator] = useState<{ translate: Translate }>({
    translate: fallbackTranslate,
  });
  const [workspaceState, dispatchWorkspace] = useReducer(
    appWorkspaceReducer,
    undefined,
    createInitialWorkspaceState,
  );
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [projectNodes, setProjectNodes] = useState<
    ReadonlyMap<string, ProjectTreeNode>
  >(() => new Map());
  const [projectNoteActivity, setProjectNoteActivity] = useState<
    readonly ProjectNoteActivityEntry[]
  >([]);
  const [activityNoteTargets, setActivityNoteTargets] = useState<
    ReadonlyMap<string, ProjectLinkTarget>
  >(() => new Map());
  const [graphDocumentRevision, setGraphDocumentRevision] = useState(0);
  const { dismissToast, pushToast, toasts } = useToastQueue();
  const notifyProjectError = useCallback(
    (message: string): void => pushToast(message, 'error'),
    [pushToast],
  );
  const notifyProjectInfo = useCallback(
    (message: string): void => pushToast(message, 'info'),
    [pushToast],
  );
  const [documentController, setDocumentController] = useState(() =>
    createMarkdownController(),
  );
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [linkNavigation, setLinkNavigation] =
    useState<MarkdownLinkNavigation>();
  const [restoreCandidate, setRestoreCandidate] =
    useState<WorkspaceSessionSnapshot | null>(null);
  const [restorePending, setRestorePending] = useState(false);
  const [sessionReady, setSessionReady] = useState(
    () => !getApi().getRestorableTabSession,
  );
  const [closeRequest, setCloseRequest] = useState<CloseRequest | null>(null);
  const [closeResponsePendingId, setCloseResponsePendingId] = useState<
    string | null
  >(null);
  const workspaceStateRef = useRef(workspaceState);
  const scrollCommitTimerRef = useRef<number | undefined>(undefined);
  const pendingScrollPositionsRef = useRef(
    new Map<
      string,
      { paneId: string; scrollTop: number; tabId: string }
    >(),
  );
  const projectRef = useRef<ProjectSummary | null>(null);
  const projectNodesRef = useRef<ReadonlyMap<string, ProjectTreeNode>>(
    new Map(),
  );
  const documentControllerRef = useRef(documentController);
  const projectSidebarRef = useRef<ProjectSidebarHandle>(null);
  const workspacePaneHostRef = useRef<WorkspacePaneHostHandle>(null);
  const pendingWorkspaceExitRef = useRef(
    new Map<string, Promise<boolean>>(),
  );
  const restoreCandidateRef = useRef<WorkspaceSessionSnapshot | null>(null);
  const restorePendingRef = useRef(false);
  const closeRequestRef = useRef<CloseRequest | null>(null);
  const closeResponsePendingIdRef = useRef<string | null>(null);
  const userInteractedRef = useRef(false);
  const restoreRequestStartedRef = useRef(false);
  const workspaceTransitionRef = useRef<Promise<void>>(Promise.resolve());
  const linkNavigationSequenceRef = useRef(0);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const lastEditableTargetRef = useRef<
    { kind: 'markdown'; nodeId: string } | { kind: 'native' }
  >(undefined);
  const layout = useWorkspaceLayout();
  const preferencesController = useFlyoffPreferencesController();
  const setRailViewId = layout.setRailViewId;
  const adjustNoteFontScale = layout.adjustNoteFontScale;
  const translate = translator.translate;
  const pageProperties = useProjectPageProperties({
    controller: documentController,
    nodes: projectNodes,
    translate,
  });
  const {
    closeProtectedPage,
    discardRemoved: discardRemovedPageData,
    lockedNodeIds,
    lockProtectedDocument,
    markPasswordRequired,
    open: openPageProperties,
    reset: resetPageProperties,
    unlockDocument,
    unlockedProtectedNodeIds,
  } = pageProperties;
  const handleMarkdownSaveError = useCallback(
    (error: ProjectFailureDetails, nodeId: string): void => {
      notifyProjectError(error.message);
      if (error.code === 'password-required') {
        markPasswordRequired(nodeId);
      }
    },
    [markPasswordRequired, notifyProjectError],
  );

  useEffect(() => {
    documentController.setOnSaveError(handleMarkdownSaveError);
    return () => documentController.setOnSaveError(undefined);
  }, [documentController, handleMarkdownSaveError]);

  useEffect(() => {
    documentController.setOnSaveSuccess(() =>
      setGraphDocumentRevision((current) => current + 1),
    );
    return () => documentController.setOnSaveSuccess(undefined);
  }, [documentController]);

  const graphRefreshSignal = useMemo(
    () => ({ graphDocumentRevision, projectNodes }),
    [graphDocumentRevision, projectNodes],
  );
  const projectGraphController = useMemo(
    () => new ProjectGraphController(project?.projectId),
    [project?.projectId],
  );

  useEffect(() => {
    documentController.setDebounceMs(
      preferencesController.preferences.general.autosaveDelayMs,
    );
  }, [
    documentController,
    preferencesController.preferences.general.autosaveDelayMs,
  ]);

  useEffect(() => {
    if (!preferencesController.preferences.general.saveOnWindowBlur) {
      return;
    }
    const handleWindowBlur = (): void => {
      void documentControllerRef.current.flushAll();
    };
    window.addEventListener('blur', handleWindowBlur);
    return () => window.removeEventListener('blur', handleWindowBlur);
  }, [preferencesController.preferences.general.saveOnWindowBlur]);

  useEffect(() => {
    if (
      !preferencesController.preferences.security.lockProtectedOnWindowBlur
    ) {
      return;
    }
    const handleWindowBlur = (): void => {
      for (const nodeId of unlockedProtectedNodeIds) {
        void lockProtectedDocument(nodeId).then((result) => {
          if (!result.ok) {
            notifyProjectError(result.error.message);
          }
        });
      }
    };
    window.addEventListener('blur', handleWindowBlur);
    return () => window.removeEventListener('blur', handleWindowBlur);
  }, [
    lockProtectedDocument,
    notifyProjectError,
    preferencesController.preferences.security.lockProtectedOnWindowBlur,
    unlockedProtectedNodeIds,
  ]);

  const menus = useMemo(
    () => createMenuBarItems(translate),
    [translate],
  );

  const cacheProjectNodes = useCallback(
    (nodes: readonly ProjectTreeNode[]): void => {
      const next = new Map(projectNodesRef.current);
      for (const node of nodes) {
        next.set(node.nodeId, node);
      }
      projectNodesRef.current = next;
      setProjectNodes(next);
      setActivityNoteTargets((current) => {
        const updated = new Map(current);
        for (const node of nodes) {
          if (node.kind === 'page' && node.pageType === 'markdown') {
            updated.set(node.nodeId, {
              nodeId: node.nodeId,
              name: projectNodeDisplayName(node),
              path:
                projectNodeLogicalPath(next, node.nodeId) ??
                `/${projectNodeDisplayName(node)}`,
            });
          }
        }
        return updated;
      });
    },
    [],
  );

  const replaceProjectBranch = useCallback(
    (parentId: string | null, nodes: readonly ProjectTreeNode[]): void => {
      const next = new Map(projectNodesRef.current);
      const visibleNodeIds = new Set(nodes.map(({ nodeId }) => nodeId));
      const removedNodeIds = new Set(
        [...next.values()]
          .filter(
            (node) =>
              node.parentId === parentId && !visibleNodeIds.has(node.nodeId),
          )
          .map(({ nodeId }) => nodeId),
      );
      let foundDescendant = true;

      while (foundDescendant) {
        foundDescendant = false;
        for (const node of next.values()) {
          if (
            node.parentId &&
            removedNodeIds.has(node.parentId) &&
            !removedNodeIds.has(node.nodeId)
          ) {
            removedNodeIds.add(node.nodeId);
            foundDescendant = true;
          }
        }
      }

      for (const nodeId of removedNodeIds) {
        next.delete(nodeId);
      }
      for (const node of nodes) {
        next.set(node.nodeId, node);
      }
      projectNodesRef.current = next;
      setProjectNodes(next);
    },
    [],
  );

  const replaceDocumentController = useCallback((): void => {
    documentControllerRef.current.dispose();
    const next = createMarkdownController(handleMarkdownSaveError);
    documentControllerRef.current = next;
    setDocumentController(next);
  }, [handleMarkdownSaveError]);

  const setActiveProject = useCallback(
    (summary: ProjectSummary | null): void => {
      projectRef.current = summary;
      setProject(summary);
      projectNodesRef.current = new Map();
      setProjectNodes(new Map());
      setProjectNoteActivity([]);
      setActivityNoteTargets(new Map());
      resetPageProperties();
      replaceDocumentController();
    },
    [replaceDocumentController, resetPageProperties],
  );

  const resolveRestoreCandidate = useCallback(
    (
      decision: TabSessionRestoreDecision,
      current: WorkspaceSessionSnapshot,
    ): void => {
      const candidate = restoreCandidateRef.current;

      if (!candidate) {
        return;
      }

      const resolved = current;
      restoreCandidateRef.current = null;
      setRestoreCandidate(null);

      if (decision === 'restore') {
        const restored = adoptWorkspaceSnapshot(resolved);
        workspaceStateRef.current = restored;
        dispatchWorkspace({
          type: 'replace-workspace-state',
          state: restored,
        });
      }

      const api = getApi();
      void api
        .resolveRestorableTabSession?.(decision, resolved)
        .catch(() => undefined);
    },
    [],
  );

  const recordProjectActivity = useCallback(
    (type: 'activated' | 'closed', nodeId: string): void => {
      const operation = getApi().recordProjectNoteActivity;
      const expectedProjectId = projectRef.current?.projectId;
      if (!operation || !expectedProjectId) {
        return;
      }
      void operation({ type, nodeId })
        .then((result) => {
          if (
            !result.ok ||
            projectRef.current?.projectId !== expectedProjectId ||
            result.value.projectId !== expectedProjectId
          ) {
            return;
          }
          setProjectNoteActivity((current) => {
            const next = current.filter(
              (entry) => entry.nodeId !== result.value.nodeId,
            );
            return [result.value, ...next];
          });
        })
        .catch(() => undefined);
    },
    [],
  );

  const applyPendingWorkspaceScroll = useCallback(
    (state: WorkspaceState): WorkspaceState => {
      let next = state;
      for (const pending of pendingScrollPositionsRef.current.values()) {
        next = workspaceReducer(next, {
          type: 'update-scroll',
          ...pending,
        });
      }
      pendingScrollPositionsRef.current.clear();
      return next;
    },
    [],
  );

  const commitWorkspaceScroll = useCallback((): void => {
    if (scrollCommitTimerRef.current !== undefined) {
      window.clearTimeout(scrollCommitTimerRef.current);
      scrollCommitTimerRef.current = undefined;
    }
    if (pendingScrollPositionsRef.current.size === 0) {
      return;
    }
    const current = applyPendingWorkspaceScroll(workspaceStateRef.current);
    workspaceStateRef.current = current;
    userInteractedRef.current = true;
    resolveRestoreCandidate('ignore', serializeWorkspace(current));
    dispatchWorkspace({ type: 'replace-workspace-state', state: current });
  }, [applyPendingWorkspaceScroll, resolveRestoreCandidate]);

  const serializeCurrentWorkspace = useCallback((): WorkspaceSessionSnapshot => {
    commitWorkspaceScroll();
    return serializeWorkspace(workspaceStateRef.current);
  }, [commitWorkspaceScroll]);

  const recordWorkspaceScroll = useCallback(
    (
      paneId: string,
      tabId: string,
      scrollTop: number,
      settled = false,
    ): void => {
      if (closeRequestRef.current || restorePendingRef.current) {
        return;
      }
      const key = `${paneId}\u0000${tabId}`;
      const previous = pendingScrollPositionsRef.current.get(key);
      if (previous?.scrollTop !== scrollTop) {
        pendingScrollPositionsRef.current.set(key, {
          paneId,
          scrollTop,
          tabId,
        });
      }
      if (settled) {
        commitWorkspaceScroll();
        return;
      }
      if (pendingScrollPositionsRef.current.size === 0) {
        return;
      }
      if (scrollCommitTimerRef.current !== undefined) {
        window.clearTimeout(scrollCommitTimerRef.current);
      }
      scrollCommitTimerRef.current = window.setTimeout(
        commitWorkspaceScroll,
        WORKSPACE_SCROLL_SETTLE_MS,
      );
    },
    [commitWorkspaceScroll],
  );

  useEffect(
    () => () => {
      if (scrollCommitTimerRef.current !== undefined) {
        window.clearTimeout(scrollCommitTimerRef.current);
      }
    },
    [],
  );

  const dispatchUserAction = useCallback(
    (action: WorkspaceAction): void => {
      if (closeRequestRef.current || restorePendingRef.current) {
        return;
      }

      const resolvedAction = applyDefaultProjectPageState(
        action,
        preferencesController.preferences.editor.defaultMode,
      );
      const hadPendingScroll = pendingScrollPositionsRef.current.size > 0;
      if (scrollCommitTimerRef.current !== undefined) {
        window.clearTimeout(scrollCommitTimerRef.current);
        scrollCommitTimerRef.current = undefined;
      }
      const current = applyPendingWorkspaceScroll(workspaceStateRef.current);
      workspaceStateRef.current = current;
      const next = workspaceReducer(current, resolvedAction);

      if (next === current) {
        if (hadPendingScroll) {
          userInteractedRef.current = true;
          resolveRestoreCandidate('ignore', serializeWorkspace(current));
          dispatchWorkspace({
            type: 'replace-workspace-state',
            state: current,
          });
        }
        return;
      }

      userInteractedRef.current = true;
      resolveRestoreCandidate('ignore', serializeWorkspace(next));
      workspaceStateRef.current = next;
      dispatchWorkspace({ type: 'replace-workspace-state', state: next });
      if (tracksProjectActivation(resolvedAction)) {
        const previousNodeId = activeProjectNodeId(current);
        const nextNodeId = activeProjectNodeId(next);
        if (nextNodeId && nextNodeId !== previousNodeId) {
          recordProjectActivity('activated', nextNodeId);
        }
      }
    },
    [
      applyPendingWorkspaceScroll,
      preferencesController.preferences.editor.defaultMode,
      recordProjectActivity,
      resolveRestoreCandidate,
    ],
  );

  const flushProjectDocuments = useCallback(async (): Promise<boolean> => {
    try {
      return await documentControllerRef.current.flushAll();
    } catch {
      return false;
    }
  }, []);

  const flushProjectDocumentsForTreeMutation = useCallback(
    async (): Promise<boolean> => {
      try {
        return await documentControllerRef.current.flushForTreeMutation();
      } catch {
        return false;
      }
    },
    [],
  );

  const performGuardedTabAction = useCallback(
    async (action: WorkspaceAction): Promise<boolean> => {
      if (closeRequestRef.current || restorePendingRef.current) {
        return false;
      }

      if (
        (action.type === 'open-target' ||
          action.type === 'move-or-open-target' ||
          action.type === 'open-target-reusing-new-tab' ||
          action.type === 'move-or-open-target-reusing-new-tab') &&
        isProjectTarget(action.target) &&
        projectRef.current?.projectId !== action.target.projectId
      ) {
        return false;
      }

      const initial = workspaceStateRef.current;
      const reduced = workspaceReducer(initial, action);

      if (reduced === initial) {
        return true;
      }
      const nextProjectNodeIds = projectDocumentNodeIds(reduced);
      const removedProjectNodeIds =
        action.type === 'close-tab' ||
        action.type === 'close-pane' ||
        action.type === 'close-all-project-tabs'
          ? [...projectDocumentNodeIds(initial)].filter(
              (nodeId) => !nextProjectNodeIds.has(nodeId),
            )
          : [];

      if (action.type === 'close-tab') {
        const workspace = initial.project ?? initial.home;
        const pane =
          collectPanes(workspace.root).find(
            ({ paneId }) =>
              paneId === (action.paneId ?? workspace.activePaneId),
          );
        const closingTab = pane?.tabs.find(
          ({ tabId }) => tabId === action.tabId,
        );
        const target = closingTab?.target;
        if (
          target?.type === 'project-content' &&
          target.pageType === 'markdown' &&
          collectPanes(workspace.root).reduce(
            (count, currentPane) =>
              count +
              currentPane.tabs.filter(
                ({ target: currentTarget }) =>
                  currentTarget.type === 'project-content' &&
                  currentTarget.nodeId === target.nodeId,
              ).length,
            0,
          ) === 1
        ) {
          const result = await closeProtectedPage(target.nodeId);
          if (!result.ok) {
            notifyProjectError(result.error.message);
            return false;
          }
        }
      }

      if (action.type === 'close-pane' && initial.project) {
        const closingPane = collectPanes(initial.project.root).find(
          ({ paneId }) => paneId === action.paneId,
        );
        const remainingPanes = collectPanes(initial.project.root).filter(
          ({ paneId }) => paneId !== action.paneId,
        );
        const nodesToClose = new Set(
          closingPane?.tabs.flatMap(({ target }) =>
            target.type === 'project-content' &&
            target.pageType === 'markdown' &&
            !remainingPanes.some(({ tabs }) =>
              tabs.some(
                ({ target: current }) =>
                  current.type === 'project-content' &&
                  current.nodeId === target.nodeId,
              ),
            )
              ? [target.nodeId]
              : [],
          ) ?? [],
        );
        for (const nodeId of nodesToClose) {
          const result = await closeProtectedPage(nodeId);
          if (!result.ok) {
            notifyProjectError(result.error.message);
            return false;
          }
        }
      }

      if (action.type === 'close-all-project-tabs' && initial.project) {
        for (const nodeId of projectDocumentNodeIds(initial)) {
          const result = await closeProtectedPage(nodeId);
          if (!result.ok) {
            notifyProjectError(result.error.message);
            return false;
          }
        }
      }

      const exit = workspaceExitTarget(initial, action);
      if (exit?.kind === 'tab') {
        const motion =
          workspacePaneHostRef.current?.animateTabExit(
            exit.paneId,
            exit.tabId,
          ) ?? Promise.resolve();
        flushSync(() => dispatchUserAction(action));
        for (const nodeId of removedProjectNodeIds) {
          recordProjectActivity('closed', nodeId);
        }
        await motion;
        return true;
      }
      if (action.type === 'close-all-project-tabs') {
        await workspacePaneHostRef.current?.animateAllTabsAndPanesExit();
      } else if (exit?.kind === 'pane') {
        await workspacePaneHostRef.current?.animatePaneExit(exit.paneId);
      } else if (exit?.kind === 'tab-and-pane') {
        await workspacePaneHostRef.current?.animateTabAndPaneExit(
          exit.paneId,
          exit.tabId,
        );
      }
      dispatchUserAction(action);
      for (const nodeId of removedProjectNodeIds) {
        recordProjectActivity('closed', nodeId);
      }
      return true;
    },
    [
      dispatchUserAction,
      notifyProjectError,
      closeProtectedPage,
      recordProjectActivity,
    ],
  );

  const enqueueWorkspaceTransition = useCallback(
    <T,>(operation: () => Promise<T>): Promise<T> => {
      const pending = workspaceTransitionRef.current.then(
        operation,
        operation,
      );
      workspaceTransitionRef.current = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
    [],
  );

  const waitForWorkspaceTransitions = useCallback(async (): Promise<void> => {
    let pending: Promise<void>;

    do {
      pending = workspaceTransitionRef.current;
      await pending;
    } while (workspaceTransitionRef.current !== pending);
  }, []);

  const dispatchGuardedTabAction = useCallback(
    (action: WorkspaceAction): Promise<boolean> => {
      const exit = workspaceExitTarget(workspaceStateRef.current, action);
      if (!exit && action.type !== 'close-all-project-tabs') {
        return performGuardedTabAction(action);
      }
      const key =
        action.type === 'close-all-project-tabs'
          ? 'project:close-all-tabs'
          : exit?.kind === 'pane' || exit?.kind === 'tab-and-pane'
          ? `pane:${exit.paneId}`
          : `tab:${exit!.paneId}:${exit!.tabId}`;
      const pending = pendingWorkspaceExitRef.current.get(key);
      if (pending) {
        return pending;
      }
      const operation = performGuardedTabAction(action).finally(() => {
        if (pendingWorkspaceExitRef.current.get(key) === operation) {
          pendingWorkspaceExitRef.current.delete(key);
        }
      });
      pendingWorkspaceExitRef.current.set(key, operation);
      return operation;
    },
    [performGuardedTabAction],
  );

  // Selecting the graph rail view normally reveals the sidebar graph panel.
  // But if the graph is already open full-screen as a tab, focus that tab
  // instead of duplicating it in the sidebar.
  const selectRailView = useCallback(
    (railViewId: string) => {
      if (railViewId === RAIL_VIEW_IDS.graph) {
        const projectWorkspace = workspaceStateRef.current.project;
        const openGraphTab =
          projectWorkspace &&
          collectPanes(projectWorkspace.root).some((pane) =>
            pane.tabs.some(({ target }) => target.type === 'project-graph'),
          );
        if (projectWorkspace && openGraphTab) {
          void dispatchGuardedTabAction({
            type: 'open-target',
            target: {
              type: 'project-graph',
              projectId: projectWorkspace.projectId,
            },
          });
          return;
        }
      }
      setRailViewId(railViewId);
    },
    [dispatchGuardedTabAction, setRailViewId],
  );

  const activateProject = useCallback(
    (summary: ProjectSummary): Promise<boolean> =>
      enqueueWorkspaceTransition(async () => {
        if (closeRequestRef.current || restorePendingRef.current) {
          return false;
        }

        setRailViewId(RAIL_VIEW_IDS.project);
        setActiveProject(summary);
        dispatchUserAction({
          type: 'open-project-workspace',
          projectId: summary.projectId,
        });
        return true;
      }),
    [
      dispatchUserAction,
      enqueueWorkspaceTransition,
      setRailViewId,
      setActiveProject,
    ],
  );

  const closeProjectWorkspace = useCallback(
    (): Promise<boolean> =>
      enqueueWorkspaceTransition(async () => {
        if (closeRequestRef.current || restorePendingRef.current) {
          return false;
        }

        if (!projectRef.current) {
          return true;
        }

        if (!(await flushProjectDocuments())) {
          return false;
        }

        dispatchUserAction({ type: 'close-project-workspace' });
        setActiveProject(null);
        await getApi().closeProject?.().catch(() => undefined);
        return true;
      }),
    [
      dispatchUserAction,
      enqueueWorkspaceTransition,
      flushProjectDocuments,
      setActiveProject,
    ],
  );

  const readMarkdownDocument = useCallback(
    (nodeId: string) => {
      const operation = getApi().readMarkdownDocument;
      return operation
        ? operation({ nodeId })
        : Promise.resolve(
            unavailableProjectResult<MarkdownDocument>(
              'The project bridge is unavailable.',
            ),
          );
    },
    [],
  );

  const completeConsumedRestore = useCallback(
    (resolved: WorkspaceSessionSnapshot): void => {
      restorePendingRef.current = false;
      setRestorePending(false);
      workspaceStateRef.current = adoptWorkspaceSnapshot(resolved);
      dispatchWorkspace({
        type: 'replace-workspace-state',
        state: workspaceStateRef.current,
      });
      void getApi()
        .resolveRestorableTabSession?.('restore', resolved)
        .catch(() => undefined);
    },
    [],
  );

  const openCreateProjectDialog = useCallback((): void => {
    resolveRestoreCandidate('ignore', serializeCurrentWorkspace());
    setCreateProjectOpen(true);
  }, [resolveRestoreCandidate, serializeCurrentWorkspace]);

  const createProject = useCallback(
    async (request: Parameters<FlyoffApi['createProject']>[0]) => {
      if (!isPortableProjectName(request.name)) {
        return projectFailure(
          'invalid-name',
          translate('projects.invalidName'),
        );
      }

      if (!(await flushProjectDocuments())) {
        return unavailableProjectResult<ProjectSummary>(
          translate('projects.saveFailed'),
        );
      }

      const operation = getApi().createProject;
      if (!operation) {
        return unavailableProjectResult<ProjectSummary>(
          translate('projects.operationFailed'),
        );
      }

      const result = await operation(request);
      if (result.ok) {
        if (!(await activateProject(result.value))) {
          await getApi().closeProject?.().catch(() => undefined);
          return unavailableProjectResult<ProjectSummary>(
            translate('projects.operationFailed'),
          );
        }
      }
      return result;
    },
    [activateProject, flushProjectDocuments, translate],
  );

  const openProject = useCallback(async (): Promise<void> => {
    resolveRestoreCandidate('ignore', serializeCurrentWorkspace());
    if (!(await flushProjectDocuments())) {
      return;
    }

    const operation = getApi().openProject;
    if (!operation) {
      notifyProjectError(translate('projects.operationFailed'));
      return;
    }

    try {
      const result = await operation();
      if (result.ok) {
        if (!(await activateProject(result.value))) {
          await getApi().closeProject?.().catch(() => undefined);
          notifyProjectError(translate('projects.operationFailed'));
        }
      } else if (result.error.code !== 'cancelled') {
        notifyProjectError(result.error.message);
      }
    } catch (error) {
      notifyProjectError(String(error));
    }
  }, [
    activateProject,
    flushProjectDocuments,
    notifyProjectError,
    resolveRestoreCandidate,
    serializeCurrentWorkspace,
    translate,
  ]);

  const listProjectChildren = useCallback(
    async (request: Parameters<FlyoffApi['listProjectChildren']>[0]) => {
      const operation = getApi().listProjectChildren;
      if (!operation) {
        return unavailableProjectResult<readonly ProjectTreeNode[]>(
          translate('projects.operationFailed'),
        );
      }
      const result = await operation(request);
      if (result.ok) {
        replaceProjectBranch(request.parentId, result.value);
      }
      return result;
    },
    [replaceProjectBranch, translate],
  );

  const createProjectNode = useCallback(
    (request: Parameters<FlyoffApi['createProjectNode']>[0]) =>
      enqueueWorkspaceTransition(async () => {
        if (!isPortableProjectName(request.name)) {
          return projectFailure(
            'invalid-name',
            translate('projects.invalidName'),
          );
        }

        if (!(await flushProjectDocumentsForTreeMutation())) {
          return unavailableProjectResult<ProjectTreeNode>(
            translate('projects.saveFailed'),
          );
        }

        const operation = getApi().createProjectNode;
        if (!operation) {
          return unavailableProjectResult<ProjectTreeNode>(
            translate('projects.operationFailed'),
          );
        }
        const result = await operation(request);
        if (result.ok) {
          cacheProjectNodes([result.value]);
        }
        return result;
      }),
    [
      cacheProjectNodes,
      enqueueWorkspaceTransition,
      flushProjectDocumentsForTreeMutation,
      translate,
    ],
  );

  const renameProjectNode = useCallback(
    (request: Parameters<FlyoffApi['renameProjectNode']>[0]) =>
      enqueueWorkspaceTransition(async () => {
        if (!isPortableProjectName(request.name)) {
          return projectFailure(
            'invalid-name',
            translate('projects.invalidName'),
          );
        }

        if (!(await flushProjectDocumentsForTreeMutation())) {
          return unavailableProjectResult<ProjectTreeNode>(
            translate('projects.saveFailed'),
          );
        }

        const operation = getApi().renameProjectNode;
        if (!operation) {
          return unavailableProjectResult<ProjectTreeNode>(
            translate('projects.operationFailed'),
          );
        }
        const result = await operation(request);
        if (result.ok) {
          cacheProjectNodes([result.value.node]);
          await Promise.all(
            result.value.updatedDocumentNodeIds
              .filter((nodeId) => documentController.getSnapshot(nodeId))
              .map((nodeId) => documentController.reload(nodeId)),
          );
          return { ok: true as const, value: result.value.node };
        }
        return result;
      }),
    [
      cacheProjectNodes,
      documentController,
      enqueueWorkspaceTransition,
      flushProjectDocumentsForTreeMutation,
      translate,
    ],
  );

  const moveProjectNode = useCallback(
    (request: Parameters<FlyoffApi['moveProjectNode']>[0]) =>
      enqueueWorkspaceTransition(async () => {
        if (!(await flushProjectDocumentsForTreeMutation())) {
          return unavailableProjectResult<ProjectTreeNode>(
            translate('projects.saveFailed'),
          );
        }

        const operation = getApi().moveProjectNode;
        if (!operation) {
          return unavailableProjectResult<ProjectTreeNode>(
            translate('projects.operationFailed'),
          );
        }
        const result = await operation(request);
        if (result.ok) {
          cacheProjectNodes([result.value.node]);
          await Promise.all(
            result.value.updatedDocumentNodeIds
              .filter((nodeId) => documentController.getSnapshot(nodeId))
              .map((nodeId) => documentController.reload(nodeId)),
          );
          return { ok: true as const, value: result.value.node };
        }
        return result;
      }),
    [
      cacheProjectNodes,
      documentController,
      enqueueWorkspaceTransition,
      flushProjectDocumentsForTreeMutation,
      translate,
    ],
  );

  const commitProjectNodeTrashed = useCallback(
    async (nodeIds: readonly string[]): Promise<void> => {
      const removedIds = new Set(nodeIds);
      discardRemovedPageData(nodeIds);

      const remainingNodes = new Map(projectNodesRef.current);
      for (const nodeId of removedIds) {
        remainingNodes.delete(nodeId);
      }
      projectNodesRef.current = remainingNodes;
      setProjectNodes(remainingNodes);

      const tabsToClose = workspaceStateRef.current.project
        ? collectPanes(workspaceStateRef.current.project.root).flatMap(
            (pane) =>
              pane.tabs.flatMap((tab) =>
                tab.target.type === 'project-content' &&
                removedIds.has(tab.target.nodeId)
                  ? [{ paneId: pane.paneId, tab }]
                  : [],
              ),
          )
        : [];

      for (const { paneId, tab } of tabsToClose) {
        const action = {
          type: 'close-tab',
          paneId,
          tabId: tab.tabId,
        } as const;
        workspaceStateRef.current = workspaceReducer(
          workspaceStateRef.current,
          action,
        );
        dispatchWorkspace({
          type: 'replace-workspace-state',
          state: workspaceStateRef.current,
        });
      }
    },
    [discardRemovedPageData],
  );

  const moveProjectNodes = useCallback(
    (request: Parameters<FlyoffApi['moveProjectNodes']>[0]) =>
      enqueueWorkspaceTransition(async () => {
        if (!(await flushProjectDocumentsForTreeMutation())) {
          return unavailableProjectResult<ProjectNodesMutationOutcome>(
            translate('projects.saveFailed'),
          );
        }

        const operation = getApi().moveProjectNodes;
        if (!operation) {
          return unavailableProjectResult<ProjectNodesMutationOutcome>(
            translate('projects.operationFailed'),
          );
        }
        const result = await operation(request);
        if (result.ok) {
          cacheProjectNodes(result.value.nodes);
          await Promise.all(
            result.value.updatedDocumentNodeIds
              .filter((nodeId) => documentController.getSnapshot(nodeId))
              .map((nodeId) => documentController.reload(nodeId)),
          );
        }
        return result;
      }),
    [
      cacheProjectNodes,
      documentController,
      enqueueWorkspaceTransition,
      flushProjectDocumentsForTreeMutation,
      translate,
    ],
  );

  const searchProject = useCallback(
    (request: Parameters<FlyoffApi['searchProject']>[0]) => {
      const operation = getApi().searchProject;
      return operation
        ? operation(request)
        : Promise.resolve(
            unavailableProjectResult<ProjectSearchOutcome>(
              translate('projects.operationFailed'),
            ),
          );
    },
    [translate],
  );

  const trashProjectNode = useCallback(
    (request: Parameters<FlyoffApi['trashProjectNode']>[0]) =>
      enqueueWorkspaceTransition(async () => {
        if (!(await flushProjectDocumentsForTreeMutation())) {
          return unavailableProjectResult<TrashProjectNodeOutcome>(
            translate('projects.saveFailed'),
          );
        }

        const operation = getApi().trashProjectNode;
        if (!operation) {
          return unavailableProjectResult<TrashProjectNodeOutcome>(
            translate('projects.operationFailed'),
          );
        }

        const result = await operation(request);
        if (result.ok) {
          await commitProjectNodeTrashed(result.value.nodeIds);
        }
        return result;
      }),
    [
      commitProjectNodeTrashed,
      enqueueWorkspaceTransition,
      flushProjectDocumentsForTreeMutation,
      translate,
    ],
  );

  const trashProjectNodes = useCallback(
    (request: Parameters<FlyoffApi['trashProjectNodes']>[0]) =>
      enqueueWorkspaceTransition(async () => {
        if (!(await flushProjectDocumentsForTreeMutation())) {
          return unavailableProjectResult<TrashProjectNodeOutcome>(
            translate('projects.saveFailed'),
          );
        }
        const operation = getApi().trashProjectNodes;
        if (!operation) {
          return unavailableProjectResult<TrashProjectNodeOutcome>(
            translate('projects.operationFailed'),
          );
        }
        const result = await operation(request);
        if (result.ok) {
          await commitProjectNodeTrashed(result.value.nodeIds);
        }
        return result;
      }),
    [
      commitProjectNodeTrashed,
      enqueueWorkspaceTransition,
      flushProjectDocumentsForTreeMutation,
      translate,
    ],
  );

  const revealProjectPath = useCallback(
    (request: Parameters<FlyoffApi['revealProjectPath']>[0]) => {
      const operation = getApi().revealProjectPath;
      return operation
        ? operation(request)
        : Promise.resolve(
            unavailableProjectResult<null>(
              translate('projects.operationFailed'),
            ),
          );
    },
    [translate],
  );

  const copyProjectPath = useCallback(
    (request: Parameters<FlyoffApi['copyProjectPath']>[0]) => {
      const operation = getApi().copyProjectPath;
      return operation
        ? operation(request)
        : Promise.resolve(
            unavailableProjectResult<null>(
              translate('projects.operationFailed'),
            ),
          );
    },
    [translate],
  );

  const copyProjectPaths = useCallback(
    (request: Parameters<FlyoffApi['copyProjectPaths']>[0]) => {
      const operation = getApi().copyProjectPaths;
      return operation
        ? operation(request)
        : Promise.resolve(
            unavailableProjectResult<null>(
              translate('projects.operationFailed'),
            ),
          );
    },
    [translate],
  );

  const openProjectNode = useCallback(
    (node: ProjectTreeNode): void => {
      if (node.kind !== 'page' || !projectRef.current) {
        return;
      }
      cacheProjectNodes([node]);
      void dispatchGuardedTabAction({
        type: 'open-target',
        target: {
          type: 'project-content',
          projectId: projectRef.current.projectId,
          nodeId: node.nodeId,
          pageType: node.pageType,
        },
      });
    },
    [cacheProjectNodes, dispatchGuardedTabAction],
  );

  const openProjectNodes = useCallback(
    (nodes: readonly ProjectPageNode[]): void => {
      const activeProject = projectRef.current;
      if (!activeProject || nodes.length === 0) {
        return;
      }
      cacheProjectNodes(nodes);
      void (async () => {
        for (const node of nodes) {
          await dispatchGuardedTabAction({
            type: 'open-target',
            target: {
              type: 'project-content',
              projectId: activeProject.projectId,
              nodeId: node.nodeId,
              pageType: node.pageType,
            },
          });
        }
      })();
    },
    [cacheProjectNodes, dispatchGuardedTabAction],
  );

  const listProjectLinkTargets = useCallback(() => {
    const operation = getApi().listProjectLinkTargets;
    return operation
      ? operation()
      : Promise.resolve(
          unavailableProjectResult<readonly ProjectLinkTarget[]>(
            translate('projects.operationFailed'),
          ),
        );
  }, [translate]);

  const loadProjectNoteActivity = useCallback(async (): Promise<void> => {
    const expectedProjectId = projectRef.current?.projectId;
    const getActivity = getApi().getProjectNoteActivity;
    if (!expectedProjectId || !getActivity) {
      setProjectNoteActivity([]);
      setActivityNoteTargets(new Map());
      return;
    }
    const [activityResult, targetsResult] = await Promise.all([
      getActivity().catch(() => undefined),
      listProjectLinkTargets().catch(() => undefined),
    ]);
    if (projectRef.current?.projectId !== expectedProjectId) {
      return;
    }
    setProjectNoteActivity(
      activityResult?.ok ? activityResult.value : [],
    );
    setActivityNoteTargets(
      new Map(
        targetsResult?.ok
          ? targetsResult.value.map((target) => [target.nodeId, target])
          : [],
      ),
    );
  }, [listProjectLinkTargets]);

  useEffect(() => {
    if (!project) {
      return;
    }
    void loadProjectNoteActivity();
  }, [loadProjectNoteActivity, project]);

  const loadProjectGraph = useCallback(() => {
    const operation = getApi().getProjectGraph;
    return operation
      ? operation()
      : Promise.resolve(
          unavailableProjectResult<ProjectGraphSnapshot>(
            translate('projects.operationFailed'),
          ),
        );
  }, [translate]);

  const openProjectGraphNode = useCallback(
    async ({ nodeId }: ProjectGraphNode) => {
      const cached = projectNodesRef.current.get(nodeId);
      if (cached) {
        openProjectNode(cached);
        return;
      }
      const operation = getApi().getProjectNode;
      if (!operation) {
        notifyProjectError(translate('projects.operationFailed'));
        return;
      }
      const result = await operation({ nodeId });
      if (result.ok) {
        openProjectNode(result.value);
      } else {
        notifyProjectError(result.error.message);
      }
    },
    [notifyProjectError, openProjectNode, translate],
  );

  const resolveProjectInternalLink = useCallback(
    (request: ProjectInternalLinkRequest) => {
      const operation = getApi().resolveProjectInternalLink;
      return operation
        ? operation(request)
        : Promise.resolve(
            unavailableProjectResult<ProjectInternalLinkResolution>(
              translate('projects.operationFailed'),
            ),
          );
    },
    [translate],
  );

  const listProjectBacklinks = useCallback(
    (targetNodeId: string) => {
      const operation = getApi().listProjectBacklinks;
      return operation
        ? operation({ targetNodeId })
        : Promise.resolve(
            unavailableProjectResult<ProjectBacklinksOutcome>(
              translate('projects.operationFailed'),
            ),
          );
    },
    [translate],
  );

  const openProjectLinkTarget = useCallback(
    async (
      target: ProjectInternalLinkTarget | ProjectLinkTarget,
      navigation?: { headingPath: readonly string[]; offset?: number },
      reuseNewTab = false,
    ): Promise<void> => {
      const currentProject = projectRef.current;
      const getNode = getApi().getProjectNode;
      if (!currentProject || !getNode) {
        notifyProjectError(translate('projects.operationFailed'));
        return;
      }
      const result = await getNode({ nodeId: target.nodeId });
      if (!result.ok) {
        notifyProjectError(result.error.message);
        return;
      }
      const node = result.value;
      if (node.kind !== 'page' || node.pageType !== 'markdown') {
        notifyProjectError(translate('projects.operationFailed'));
        return;
      }

      cacheProjectNodes([node]);
      const contentTarget = {
        type: 'project-content' as const,
        projectId: currentProject.projectId,
        nodeId: node.nodeId,
        pageType: node.pageType,
      };
      await dispatchGuardedTabAction(
        reuseNewTab
          ? {
              type: 'open-target-reusing-new-tab',
              target: contentTarget,
            }
          : {
              type: 'open-target',
              target: contentTarget,
            },
      );
      linkNavigationSequenceRef.current += 1;
      setLinkNavigation({
        headingPath:
          navigation?.headingPath ??
          ('heading' in target && target.heading
            ? target.heading.path
            : []),
        nodeId: node.nodeId,
        offset:
          navigation?.offset ??
          ('heading' in target && target.heading
            ? target.heading.offset
            : undefined),
        requestId: linkNavigationSequenceRef.current,
      });
    },
    [
      cacheProjectNodes,
      dispatchGuardedTabAction,
      notifyProjectError,
      translate,
    ],
  );

  const searchNewTab = useCallback(
    async (query: string): Promise<NewTabSearchOutcome> => {
      const [searchResult, targetsResult] = await Promise.all([
        searchProject({ query }),
        listProjectLinkTargets(),
      ]);
      if (!searchResult.ok || !targetsResult.ok) {
        return { results: [], skippedLockedCount: 0 };
      }
      const targets = new Map(
        targetsResult.value.map((target) => [target.nodeId, target]),
      );
      const previews = new Map(
        searchResult.value.previews.map((preview) => [
          preview.nodeId,
          preview,
        ]),
      );
      const results = searchResult.value.nodeIds.flatMap((nodeId) => {
        const target = targets.get(nodeId);
        if (!target) {
          return [];
        }
        const preview = previews.get(nodeId);
        return [{
          ...target,
          excerpt: preview?.excerpt,
          line: preview?.line,
        } satisfies NewTabNoteItem];
      });
      return {
        results,
        skippedLockedCount:
          searchResult.value.skippedLockedNodeIds.length,
      };
    },
    [listProjectLinkTargets, searchProject],
  );

  const renameProjectLinkTarget = useCallback(
    async (
      nodeId: string,
      name: string,
    ): Promise<ProjectResult<ProjectPageNode>> => {
      const result = await renameProjectNode({ nodeId, name });
      if (!result.ok) {
        return result;
      }
      if (result.value.kind === 'page') {
        return { ok: true, value: result.value };
      }
      return unavailableProjectResult<ProjectPageNode>(
        translate('projects.operationFailed'),
      );
    },
    [renameProjectNode, translate],
  );

  const projectPageRuntime = useMemo(
    () => ({
      markdown: {
        controller: documentController,
        links: {
          listBacklinks: ({ targetNodeId }: { targetNodeId: string }) =>
            listProjectBacklinks(targetNodeId),
          listTargets: listProjectLinkTargets,
          openTarget: openProjectLinkTarget,
          renameTarget: renameProjectLinkTarget,
          resolve: resolveProjectInternalLink,
        },
        lockedNodeIds,
        navigation: linkNavigation,
        onPasswordRequired: markPasswordRequired,
        readDocument: readMarkdownDocument,
        unlockDocument,
      },
      onError: notifyProjectError,
    }),
    [
      documentController,
      linkNavigation,
      listProjectBacklinks,
      listProjectLinkTargets,
      lockedNodeIds,
      markPasswordRequired,
      notifyProjectError,
      openProjectLinkTarget,
      readMarkdownDocument,
      renameProjectLinkTarget,
      resolveProjectInternalLink,
      unlockDocument,
    ],
  );

  const closeActiveTab = useCallback((): void => {
    const activeTabId = selectActiveTabs(workspaceStateRef.current).activeTabId;

    if (activeTabId) {
      void dispatchGuardedTabAction({ type: 'close-tab', tabId: activeTabId });
    }
  }, [dispatchGuardedTabAction]);

  const executeRendererMenuCommand = useCallback(
    (command: RendererMenuCommand): void => {
      if (command === RENDERER_MENU_COMMANDS.closeTab) {
        closeActiveTab();
        return;
      }

      const lastTarget = lastEditableTargetRef.current;
      const activeTabState = selectActiveTabs(workspaceStateRef.current);
      const activeTab = activeTabState.tabs.find(
        ({ tabId }) => tabId === activeTabState.activeTabId,
      );
      const activeNodeId =
        activeTab?.target.type === 'project-content'
          ? activeTab.target.nodeId
          : undefined;

      if (
        lastTarget?.kind === 'markdown' &&
        lastTarget.nodeId === activeNodeId &&
        documentControllerRef.current.getSnapshot(activeNodeId)
      ) {
        if (command === RENDERER_MENU_COMMANDS.undo) {
          documentControllerRef.current.undo(
            activeNodeId,
            activeTab?.tabId,
          );
        } else if (command === RENDERER_MENU_COMMANDS.redo) {
          documentControllerRef.current.redo(
            activeNodeId,
            activeTab?.tabId,
          );
        }
        requestAnimationFrame(() => {
          const editor = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-markdown-node-id]',
            ),
          ].find(
            ({ dataset }) =>
              dataset.markdownNodeId === activeNodeId &&
              dataset.markdownViewId === activeTab?.tabId,
          );
          editor?.focus();
        });
        return;
      }

      const fallback =
        command === RENDERER_MENU_COMMANDS.undo
          ? APPLICATION_MENU_COMMANDS.undo
          : APPLICATION_MENU_COMMANDS.redo;
      void getApi().executeMenuCommand?.(fallback).catch(() => undefined);
    },
    [closeActiveTab],
  );

  const executeMenuCommand = useCallback(
    (command: string): void => {
      if (isRendererMenuCommand(command)) {
        executeRendererMenuCommand(command);
        return;
      }

      if (isApplicationMenuCommand(command)) {
        void getApi().executeMenuCommand?.(command).catch(() => undefined);
      }
    },
    [executeRendererMenuCommand],
  );

  const respondToClose = useCallback(
    async (response: CloseResponse): Promise<void> => {
      const respond = getApi().respondToCloseRequest;

      if (!respond) {
        throw new Error('The close confirmation bridge is unavailable.');
      }

      await respond(response);
    },
    [],
  );

  const submitCloseResponse = useCallback(
    (response: CloseResponse): void => {
      if (closeResponsePendingIdRef.current) {
        return;
      }

      closeResponsePendingIdRef.current = response.requestId;
      setCloseResponsePendingId(response.requestId);

      void respondToClose(response)
        .then(() => {
          if (closeRequestRef.current?.requestId === response.requestId) {
            closeRequestRef.current = null;
            setCloseRequest(null);
          }
        })
        .catch(() => {
          const request = closeRequestRef.current;

          if (request?.requestId === response.requestId) {
            setCloseRequest(request);
          }
        })
        .finally(() => {
          if (closeResponsePendingIdRef.current === response.requestId) {
            closeResponsePendingIdRef.current = null;
            setCloseResponsePendingId(null);
          }
        });
    },
    [respondToClose],
  );

  const cancelClose = useCallback((): void => {
    const request = closeRequestRef.current;

    if (!request) {
      return;
    }

    submitCloseResponse({
      requestId: request.requestId,
      decision: 'cancel',
    });
  }, [submitCloseResponse]);

  const confirmClose = useCallback((): void => {
    const request = closeRequestRef.current;

    if (!request) {
      return;
    }

    void waitForWorkspaceTransitions().then(async () => {
      if (closeRequestRef.current?.requestId !== request.requestId) {
        return;
      }

      const saved = await flushProjectDocuments();

      if (closeRequestRef.current?.requestId !== request.requestId) {
        return;
      }

      if (!saved) {
        submitCloseResponse({
          requestId: request.requestId,
          decision: 'cancel',
        });
        return;
      }

      submitCloseResponse({
        requestId: request.requestId,
        decision: 'confirm',
        session: serializeCurrentWorkspace(),
      });
    });
  }, [
    flushProjectDocuments,
    serializeCurrentWorkspace,
    submitCloseResponse,
    waitForWorkspaceTransitions,
  ]);

  const restorePreviousSession = useCallback(async (): Promise<void> => {
    const candidate = restoreCandidateRef.current;
    if (!candidate || restorePendingRef.current) {
      return;
    }

    restoreCandidateRef.current = null;
    setRestoreCandidate(null);
    restorePendingRef.current = true;
    setRestorePending(true);

    const projectSnapshot = candidate.project;

    if (!projectSnapshot) {
      completeConsumedRestore(candidate);
      return;
    }

    const restore = getApi().restoreProject;
    if (!restore) {
      notifyProjectError(translate('projects.projectUnavailable'));
      completeConsumedRestore({ ...candidate, project: null });
      return;
    }

    let result: Awaited<ReturnType<FlyoffApi['restoreProject']>>;
    try {
      result = await restore({ projectId: projectSnapshot.projectId });
    } catch {
      notifyProjectError(translate('projects.projectUnavailable'));
      completeConsumedRestore({ ...candidate, project: null });
      return;
    }

    if (!result.ok) {
      notifyProjectError(translate('projects.projectUnavailable'));
      completeConsumedRestore({ ...candidate, project: null });
      return;
    }

    setActiveProject(result.value);

    const getNode = getApi().getProjectNode;
    if (getNode) {
      const pendingNodeIds = [
        ...new Set(
          collectPanes(projectSnapshot.root).flatMap(({ tabs }) =>
            tabs.flatMap(({ target }) =>
              target.type === 'project-content' ? [target.nodeId] : [],
            ),
          ),
        ),
      ];
      const requestedNodeIds = new Set<string>();
      const restoredNodes: ProjectTreeNode[] = [];

      while (pendingNodeIds.length > 0) {
        const batch = pendingNodeIds.splice(0).filter((nodeId) => {
          if (requestedNodeIds.has(nodeId)) {
            return false;
          }
          requestedNodeIds.add(nodeId);
          return true;
        });
        const results = await Promise.all(
          batch.map((nodeId) => getNode({ nodeId }).catch(() => undefined)),
        );

        for (const nodeResult of results) {
          if (!nodeResult?.ok) {
            continue;
          }
          restoredNodes.push(nodeResult.value);
          if (nodeResult.value.parentId) {
            pendingNodeIds.push(nodeResult.value.parentId);
          }
        }
      }

      cacheProjectNodes(restoredNodes);
    }

    completeConsumedRestore(candidate);
  }, [
    cacheProjectNodes,
    completeConsumedRestore,
    notifyProjectError,
    setActiveProject,
    translate,
  ]);

  useEffect(() => {
    let active = true;

    void getApi()
      .getBootstrapState?.()
      .then((state) => {
        if (!active) {
          return;
        }

        document.documentElement.lang = state.uiLocale;
        document.documentElement.dataset.platform = state.platform;
        setPlatform(state.platform);
        void initializeRendererI18n(state.uiLocale)
          .then((i18n) => {
            if (active) {
              setTranslator({ translate: (key) => i18n.t(key) });
            }
          })
          .catch(() => undefined);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      !preferencesController.ready ||
      restoreRequestStartedRef.current
    ) {
      return;
    }

    restoreRequestStartedRef.current = true;
    const api = getApi();
    const startupBehavior =
      preferencesController.preferences.general.startupBehavior;

    if (!api.getRestorableTabSession) {
      return;
    }

    void api
      .getRestorableTabSession()
      .then((candidate) => {
        setSessionReady(true);

        if (!candidate || !hasRestorableWorkspaceSnapshot(candidate)) {
          return;
        }

        if (userInteractedRef.current) {
          void api
            .resolveRestorableTabSession?.(
              'ignore',
              serializeCurrentWorkspace(),
            )
            .catch(() => undefined);
          return;
        }

        if (startupBehavior === 'fresh') {
          void api
            .resolveRestorableTabSession?.(
              'ignore',
              serializeCurrentWorkspace(),
            )
            .catch(() => undefined);
          return;
        }

        restoreCandidateRef.current = candidate;
        setRestoreCandidate(candidate);
        if (startupBehavior === 'restore') {
          void restorePreviousSession();
        }
      })
      .catch(() => {
        setSessionReady(true);
      });
  }, [
    preferencesController.preferences.general.startupBehavior,
    preferencesController.ready,
    restorePreviousSession,
    serializeCurrentWorkspace,
  ]);

  useEffect(() => {
    if (!restoreCandidate) {
      return;
    }

    const timeout = window.setTimeout(() => {
      resolveRestoreCandidate('ignore', serializeCurrentWorkspace());
    }, 8_000);

    return () => window.clearTimeout(timeout);
  }, [
    resolveRestoreCandidate,
    restoreCandidate,
    serializeCurrentWorkspace,
  ]);

  useEffect(() => {
    if (
      !sessionReady ||
      restoreCandidateRef.current ||
      restorePendingRef.current
    ) {
      return;
    }

    const api = getApi();

    if (!api.saveTabSession) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void api
        .saveTabSession?.(serializeWorkspace(workspaceState))
        .catch(() => undefined);
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [restorePending, sessionReady, workspaceState]);

  useEffect(() => {
    function handleFocusIn(event: FocusEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const markdownEditor = target.closest<HTMLElement>(
        '[data-markdown-node-id]',
      );
      const nodeId = markdownEditor?.dataset.markdownNodeId;
      if (nodeId) {
        lastEditableTargetRef.current = { kind: 'markdown', nodeId };
        return;
      }

      if (
        target.matches(
          'input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]',
        )
      ) {
        lastEditableTargetRef.current = { kind: 'native' };
      }
    }

    document.addEventListener('focusin', handleFocusIn, true);
    return () => document.removeEventListener('focusin', handleFocusIn, true);
  }, []);

  useEffect(() => {
    const api = getApi();
    const removeCloseListener = api.onCloseRequested?.((request) => {
      if (restorePendingRef.current) {
        void respondToClose({
          requestId: request.requestId,
          decision: 'cancel',
        }).catch(() => undefined);
        return;
      }

      resolveRestoreCandidate('ignore', serializeCurrentWorkspace());

      const previous = closeRequestRef.current;
      if (previous && previous.requestId !== request.requestId) {
        if (closeResponsePendingIdRef.current === previous.requestId) {
          closeResponsePendingIdRef.current = null;
          setCloseResponsePendingId(null);
        }

        void respondToClose({
          requestId: previous.requestId,
          decision: 'cancel',
        }).catch(() => undefined);
      }

      closeRequestRef.current = request;

      if (!hasRestorableWorkspace(workspaceStateRef.current)) {
        submitCloseResponse({
          requestId: request.requestId,
          decision: 'confirm',
          session: serializeCurrentWorkspace(),
        });
        return;
      }

      setCloseRequest(request);
    });
    const removeMenuListener = api.onRendererMenuCommand?.(
      (command: RendererMenuCommand) => {
        executeRendererMenuCommand(command);
      },
    );

    return () => {
      removeCloseListener?.();
      removeMenuListener?.();
    };
  }, [
    executeRendererMenuCommand,
    resolveRestoreCandidate,
    respondToClose,
    serializeCurrentWorkspace,
    submitCloseResponse,
  ]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      const primary = platform === 'darwin' ? event.metaKey : event.ctrlKey;

      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key === 'Enter'
      ) {
        const state = selectActiveTabs(workspaceStateRef.current);
        const activeTab = state.tabs.find(
          ({ tabId }) => tabId === state.activeTabId,
        );
        const target = activeTab?.target;
        const node =
          target?.type === 'project-content'
            ? projectNodesRef.current.get(target.nodeId)
            : undefined;
        if (node?.kind === 'page' && node.pageType === 'markdown') {
          event.preventDefault();
          openPageProperties(node);
        }
        return;
      }

      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault();
        const state = selectActiveTabs(workspaceStateRef.current);
        if (state.tabs.length === 0) {
          return;
        }
        const activeIndex = state.tabs.findIndex(
          ({ tabId }) => tabId === state.activeTabId,
        );
        const offset = event.shiftKey ? -1 : 1;
        const nextIndex =
          (activeIndex + offset + state.tabs.length) % state.tabs.length;
        const nextTab = state.tabs[nextIndex];
        if (nextTab) {
          void dispatchGuardedTabAction({
            type: 'select-tab',
            tabId: nextTab.tabId,
          });
        }
        return;
      }

      if (primary && !event.altKey && /^[1-9]$/.test(event.key)) {
        event.preventDefault();
        const state = selectActiveTabs(workspaceStateRef.current);
        const requestedIndex = Number(event.key) - 1;
        const index =
          requestedIndex === 8
            ? state.tabs.length - 1
            : requestedIndex;
        const requested = state.tabs[index];
        if (requested) {
          void dispatchGuardedTabAction({
            type: 'select-tab',
            tabId: requested.tabId,
          });
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dispatchGuardedTabAction, openPageProperties, platform]);

  useEffect(() => {
    // Ctrl+wheel zooms the whole window, except over a note, where it scales
    // just that surface so long documents can be sized independently.
    function handleWheel(event: WheelEvent): void {
      if (!event.ctrlKey || event.deltaY === 0) {
        return;
      }

      event.preventDefault();
      const zoomIn = event.deltaY < 0;
      const target = event.target;
      const overNote =
        target instanceof Element && target.closest('.markdown-editor');

      if (overNote) {
        adjustNoteFontScale(zoomIn ? 0.1 : -0.1);
        return;
      }

      void getApi()
        .executeMenuCommand?.(
          zoomIn
            ? APPLICATION_MENU_COMMANDS.zoomIn
            : APPLICATION_MENU_COMMANDS.zoomOut,
        )
        .catch(() => undefined);
    }

    document.addEventListener('wheel', handleWheel, { passive: false });
    return () => document.removeEventListener('wheel', handleWheel);
  }, [adjustNoteFontScale]);

  useEffect(
    () => () => {
      documentControllerRef.current.dispose();
    },
    [],
  );

  const selectProjectCreateLocation = useCallback(() => {
    const operation = getApi().selectProjectCreateLocation;
    return operation
      ? operation()
      : Promise.resolve(
          unavailableProjectResult<ProjectLocationSelection>(
            translate('projects.operationFailed'),
          ),
        );
  }, [translate]);

  const requestRootCreation = useCallback(
    (kind: ProjectTreeNode['kind']): void => {
      if (kind === 'folder') {
        void projectSidebarRef.current?.createFolder();
      } else {
        void projectSidebarRef.current?.createMarkdown();
      }
    },
    [],
  );

  const getTabPresentation = useCallback(
    (tab: TabDescriptor): TabPresentation => {
      const target = tab.target;
      if (target.type === 'internal') {
        const definition = getPageDefinition(target.pageId);
        return {
          title: translate(definition.titleKey),
          icon: definition.icon,
        };
      }

      if (target.type === 'project-overview') {
        return {
          title:
            project?.projectId === target.projectId
              ? project.name
              : translate('projects.projectUnavailable'),
          icon: projectOverviewIcon,
        };
      }

      if (target.type === 'project-graph') {
        return {
          title: translate('graph.orbitTitle'),
          icon: projectGraphIcon,
        };
      }

      const node = projectNodes.get(target.nodeId);
      return {
        title: node
          ? projectNodeDisplayName(node)
          : translate('projects.unavailable'),
        icon:
          getProjectPageTypeDefinition(target.pageType)?.icon ??
          markdownPageIcon,
      };
    },
    [project, projectNodes, translate],
  );

  const frequentNewTabNotes = useMemo(() => {
    return [...projectNoteActivity]
      .filter(
        (entry) =>
          entry.activationCount >= 2 &&
          activityNoteTargets.has(entry.nodeId),
      )
      .sort(
        (left, right) =>
          right.activationCount - left.activationCount ||
          Date.parse(right.lastActivatedAt ?? '1970-01-01T00:00:00.000Z') -
            Date.parse(
              left.lastActivatedAt ?? '1970-01-01T00:00:00.000Z',
            ),
      )
      .slice(0, 6)
      .flatMap((entry) => {
        const target = activityNoteTargets.get(entry.nodeId);
        return target ? [target satisfies NewTabNoteItem] : [];
      });
  }, [activityNoteTargets, projectNoteActivity]);

  const recentNewTabNotes = useMemo(() => {
    const openedNodeIds = projectDocumentNodeIds(workspaceState);
    const frequentNodeIds = new Set(
      frequentNewTabNotes.map(({ nodeId }) => nodeId),
    );
    return [...projectNoteActivity]
      .filter(
        (entry) =>
          entry.lastClosedAt &&
          !openedNodeIds.has(entry.nodeId) &&
          !frequentNodeIds.has(entry.nodeId) &&
          activityNoteTargets.has(entry.nodeId),
      )
      .sort(
        (left, right) =>
          Date.parse(right.lastClosedAt ?? '1970-01-01T00:00:00.000Z') -
          Date.parse(left.lastClosedAt ?? '1970-01-01T00:00:00.000Z'),
      )
      .slice(0, 6)
      .flatMap((entry) => {
        const target = activityNoteTargets.get(entry.nodeId);
        return target ? [target satisfies NewTabNoteItem] : [];
      });
  }, [
    activityNoteTargets,
    frequentNewTabNotes,
    projectNoteActivity,
    workspaceState,
  ]);

  const renderPage = useCallback(
    (props: PageRenderProps) => {
      const target = props.descriptor.target;

      if (target.type === 'internal') {
        if (target.pageId === INTERNAL_PAGE_IDS.newTab) {
          return (
            <NewTabPage
              {...(props as InternalPageProps)}
              frequentNotes={frequentNewTabNotes}
              onOpenNote={(note) =>
                void openProjectLinkTarget(note, undefined, true)
              }
              onSearch={project ? searchNewTab : undefined}
              recentNotes={recentNewTabNotes}
            />
          );
        }
        if (target.pageId === INTERNAL_PAGE_IDS.home) {
          return (
            <HomePage
              {...(props as InternalPageProps)}
              onNewProject={openCreateProjectDialog}
              onOpenProject={() => void openProject()}
            />
          );
        }
        return renderRegisteredInternalPage(props);
      }

      if (
        !project ||
        project.projectId !== target.projectId
      ) {
        return (
          <main className="project-content-unavailable" role="alert">
            <p>{translate('projects.projectUnavailable')}</p>
          </main>
        );
      }

      if (target.type === 'project-overview') {
        return (
          <ProjectOverview
            onNewFolder={() => requestRootCreation('folder')}
            onNewMarkdown={() => requestRootCreation('page')}
            project={project}
            translate={translate}
          />
        );
      }

      if (target.type === 'project-graph') {
        return (
          <ProjectGraphPanel
            controller={projectGraphController}
            initialViewState={readProjectGraphViewState(
              props.descriptor.pageState,
            )}
            loadGraph={loadProjectGraph}
            onError={notifyProjectError}
            onOpenNode={(node) => void openProjectGraphNode(node)}
            onViewStateChange={(view) =>
              props.onStateChange(createProjectGraphPageState(view))
            }
            refreshSignal={graphRefreshSignal}
            rootName={project?.name}
            translate={translate}
            variant="page"
          />
        );
      }

      const node = projectNodes.get(target.nodeId);
      return (
        <ProjectContentPage
          active={props.active}
          displayPath={
            preferencesController.preferences.documents.showPath
              ? projectNodeLogicalPath(projectNodes, target.nodeId)
              : undefined
          }
          node={node}
          nodeId={target.nodeId}
          pageState={props.descriptor.pageState}
          pageType={target.pageType}
          runtime={projectPageRuntime}
          scrollTop={props.descriptor.scrollTop}
          onScrollChange={props.onScrollChange}
          onStateChange={props.onStateChange}
          translate={translate}
          viewId={props.descriptor.tabId}
        />
      );
    },
    [
      graphRefreshSignal,
      loadProjectGraph,
      notifyProjectError,
      openCreateProjectDialog,
      openProject,
      openProjectGraphNode,
      openProjectLinkTarget,
      frequentNewTabNotes,
      project,
      projectGraphController,
      projectNodes,
      projectPageRuntime,
      preferencesController.preferences.documents.showPath,
      requestRootCreation,
      recentNewTabNotes,
      searchNewTab,
      translate,
    ],
  );

  const workspaceContext = selectActiveContext(workspaceState);
  const activeTabs = selectActiveTabs(workspaceState);
  const activeTab =
    activeTabs.tabs.find(({ tabId }) => tabId === activeTabs.activeTabId) ??
    activeTabs.tabs[0];
  const activePageId: InternalPageId =
    activeTab?.target.type === 'internal'
      ? activeTab.target.pageId
      : INTERNAL_PAGE_IDS.home;
  const activeProjectTarget =
    activeTab?.target.type !== 'internal' ? activeTab?.target : undefined;
  const activeProjectNodePath = useMemo(() => {
    if (activeProjectTarget?.type !== 'project-content') {
      return [];
    }

    const lineage = resolveProjectNodeLineage(
      projectNodes,
      activeProjectTarget.nodeId,
    );
    return lineage
      ? lineage
          .slice(0, -1)
          .filter(({ kind }) => kind === 'folder')
          .map(({ nodeId }) => nodeId)
      : [];
  }, [activeProjectTarget, projectNodes]);
  return (
    <FlyoffPreferencesProvider value={preferencesController}>
      <div className="app-shell" data-context={workspaceContext}>
      {workspaceContext === 'home' ? (
        <Titlebar
          menus={menus}
          platform={platform}
          sidebarCollapsed={layout.collapsed}
          toggleSidebarLabel={translate(
            layout.collapsed
              ? 'layout.expandSidebar'
              : 'layout.collapseSidebar',
          )}
          onMenuAction={executeMenuCommand}
          onToggleSidebar={layout.toggleCollapsed}
        />
      ) : null}
      <div
        className="workspace"
        data-collapsed={layout.collapsed || undefined}
        data-context={workspaceContext}
        ref={workspaceRef}
        style={
          {
            '--sidebar-width': `${layout.sidebarWidth}px`,
            '--rail-width': `${layout.railWidth}px`,
            '--md-scale': String(layout.noteFontScale),
          } as CSSProperties
        }
      >
        {workspaceContext === 'home' ? (
          <GlobalSidebar
            activePageId={activePageId}
            onOpenPage={(pageId) =>
              void dispatchGuardedTabAction({ type: 'open-page', pageId })
            }
            translate={translate}
          />
        ) : (
          <IconRail
            activeViewId={layout.railViewId}
            onSelect={selectRailView}
            onToggleSidebar={layout.toggleCollapsed}
            sidebarCollapsed={layout.collapsed}
            translate={translate}
            views={RAIL_VIEWS}
          />
        )}
        {project ? (
          <ProjectSidebar
            key={project.projectId}
            activeNodeId={
              activeProjectTarget?.type === 'project-content'
                ? activeProjectTarget.nodeId
                : undefined
            }
            activeNodePath={activeProjectNodePath}
            hidden={layout.railViewId !== RAIL_VIEW_IDS.project}
            loadChildren={listProjectChildren}
            onBeforeNodeChange={() => flushProjectDocumentsForTreeMutation()}
            onBeforeNodesChange={() => flushProjectDocumentsForTreeMutation()}
            onCopyPath={copyProjectPath}
            onCopyPaths={copyProjectPaths}
            onCreateNode={createProjectNode}
            onError={notifyProjectError}
            onMoveNode={moveProjectNode}
            onMoveNodes={moveProjectNodes}
            onNodeChanged={(node) => cacheProjectNodes([node])}
            onNotice={notifyProjectInfo}
            onCloseProject={() => void closeProjectWorkspace()}
            onOpenAbout={() =>
              executeMenuCommand(APPLICATION_MENU_COMMANDS.about)
            }
            onOpenNode={(node) => {
              setRailViewId(RAIL_VIEW_IDS.project);
              openProjectNode(node);
            }}
            onOpenNodes={(nodes) => {
              setRailViewId(RAIL_VIEW_IDS.project);
              openProjectNodes(nodes);
            }}
            onRequestProperties={openPageProperties}
            onOpenOverview={() => {
              setRailViewId(RAIL_VIEW_IDS.project);
              void dispatchGuardedTabAction({
                type: 'open-target',
                target: {
                  type: 'project-overview',
                  projectId: project.projectId,
                },
              })
            }}
            onOpenSettings={() => {
              setRailViewId(RAIL_VIEW_IDS.project);
              void dispatchGuardedTabAction({
                type: 'open-page',
                pageId: INTERNAL_PAGE_IDS.settings,
              });
            }}
            onRevealPath={revealProjectPath}
            onRenameNode={renameProjectNode}
            onSearch={searchProject}
            onTrashNode={trashProjectNode}
            onTrashNodes={trashProjectNodes}
            overviewActive={
              layout.railViewId !== RAIL_VIEW_IDS.settings &&
              activeProjectTarget?.type === 'project-overview'
            }
            project={project}
            platform={platform}
            ref={projectSidebarRef}
            settingsActive={
              activePageId === INTERNAL_PAGE_IDS.settings
            }
            translate={translate}
          />
        ) : null}
        {workspaceContext === 'project' &&
        layout.railViewId === RAIL_VIEW_IDS.graph ? (
          <ProjectGraphPanel
            controller={projectGraphController}
            loadGraph={loadProjectGraph}
            onError={notifyProjectError}
            onOpenInTab={() => {
              setRailViewId(RAIL_VIEW_IDS.project);
              void dispatchGuardedTabAction({
                type: 'open-target',
                initialPageState: createProjectGraphPageState(
                  projectGraphController.viewState(),
                ),
                target: {
                  type: 'project-graph',
                  projectId: project!.projectId,
                },
              });
            }}
            onOpenNode={(node) => void openProjectGraphNode(node)}
            refreshSignal={graphRefreshSignal}
            rootName={project?.name}
            translate={translate}
          />
        ) : null}
        {workspaceContext === 'project' &&
        layout.railViewId !== RAIL_VIEW_IDS.project &&
        layout.railViewId !== RAIL_VIEW_IDS.graph ? (
          <PlaceholderPanel
            hint={translate('rail.comingSoon')}
            icon={resolveRailView(layout.railViewId).icon}
            title={translate(resolveRailView(layout.railViewId).labelKey)}
          />
        ) : null}
        <div className="page-workspace">
          <WorkspacePaneHost
            activePaneId={
              workspaceState.project?.activePaneId ??
              workspaceState.home.activePaneId
            }
            canCloseSoleTab={workspaceContext === 'project'}
            closeLabel={translate('pages.closeTab')}
            emptyState={() =>
              workspaceContext === 'project' ? (
                <ProjectEmptyState
                  onCreateNote={() => requestRootCreation('page')}
                  onSearch={() =>
                    document
                      .querySelector<HTMLInputElement>(
                        '.project-sidebar__search input',
                      )
                      ?.focus()
                  }
                  translate={translate}
                />
              ) : null
            }
            getPresentation={getTabPresentation}
            navigationLabel={translate('pages.bar')}
            ref={workspacePaneHostRef}
            onClosePane={(paneId) =>
              void dispatchGuardedTabAction({ type: 'close-pane', paneId })
            }
            onCloseAllTabs={
              workspaceContext === 'project'
                ? () =>
                    void dispatchGuardedTabAction({
                      type: 'close-all-project-tabs',
                    })
                : undefined
            }
            onCloseTab={(paneId, tabId) =>
              void dispatchGuardedTabAction({
                type: 'close-tab',
                paneId,
                tabId,
              })
            }
            onMoveTab={(paneId, tabId, toIndex) =>
              dispatchUserAction({
                type: 'move-tab',
                paneId,
                tabId,
                toIndex,
              })
            }
            onMoveTabBetweenPanes={(fromPaneId, toPaneId, tabId) =>
              dispatchUserAction({
                type: 'move-tab-between-panes',
                fromPaneId,
                toPaneId,
                tabId,
              })
            }
            onOpenTarget={(paneId, target) =>
              void dispatchGuardedTabAction({
                type: 'move-or-open-target',
                paneId,
                target,
              })
            }
            onOpenTargets={(paneId, targets) => {
              void (async () => {
                for (const target of targets) {
                  await dispatchGuardedTabAction({
                    type: 'move-or-open-target',
                    paneId,
                    target,
                  });
                }
              })();
            }}
            onNewTab={
              workspaceContext === 'project'
                ? (paneId) =>
                    dispatchUserAction({
                      type: 'open-target',
                      paneId,
                      target: {
                        type: 'internal',
                        pageId: INTERNAL_PAGE_IDS.newTab,
                        instanceKey: crypto.randomUUID(),
                      },
                    })
                : undefined
            }
            onPageStateChange={(paneId, tabId, pageState) =>
              dispatchUserAction({
                type: 'update-page-state',
                paneId,
                tabId,
                pageState,
              })
            }
            onResizeSplit={(splitId, ratio) =>
              dispatchUserAction({ type: 'resize-split', splitId, ratio })
            }
            onScrollChange={recordWorkspaceScroll}
            onSelectPane={(paneId) =>
              dispatchUserAction({ type: 'select-pane', paneId })
            }
            onSelectTab={(paneId, tabId) =>
              void dispatchGuardedTabAction({
                type: 'select-tab',
                paneId,
                tabId,
              })
            }
            onSplitPane={(paneId, direction) =>
              dispatchUserAction({ type: 'split-pane', paneId, direction })
            }
            onSplitPaneWithTab={(
              fromPaneId,
              targetPaneId,
              tabId,
              direction,
              before,
            ) =>
              dispatchUserAction({
                type: 'split-pane-with-tab',
                fromPaneId,
                targetPaneId,
                tabId,
                direction,
                before,
              })
            }
            onSplitPaneWithTarget={(
              targetPaneId,
              target,
              direction,
              before,
            ) =>
              dispatchUserAction({
                type: 'split-pane-with-target',
                targetPaneId,
                target,
                direction,
                before,
              })
            }
            onSplitPaneWithTargets={(
              targetPaneId,
              targets,
              direction,
              before,
            ) =>
              dispatchUserAction({
                type: 'split-pane-with-targets',
                targetPaneId,
                targets,
                direction,
                before,
              })
            }
            renderPage={renderPage}
            root={workspaceState.project?.root ?? workspaceState.home.root}
            translate={translate}
          />
        </div>
        {workspaceContext === 'project' ? (
          <PanelResizer
            ariaLabel={translate('layout.resizeRail')}
            className="flyoff-panel-resizer--rail"
            cssVar="--rail-width"
            max={RAIL_WIDTH_MAX}
            min={RAIL_WIDTH_MIN}
            onCommit={layout.setRailWidth}
            onReset={layout.resetRailWidth}
            target={workspaceRef}
            value={layout.railWidth}
          />
        ) : null}
        {layout.collapsed ? null : (
          <PanelResizer
            ariaLabel={translate('layout.resizeSidebar')}
            cssVar="--sidebar-width"
            max={SIDEBAR_WIDTH_MAX}
            min={SIDEBAR_WIDTH_MIN}
            onCommit={layout.setSidebarWidth}
            onReset={layout.resetSidebarWidth}
            target={workspaceRef}
            value={layout.sidebarWidth}
          />
        )}
      </div>
      {restorePending ? (
        <div className="project-restore-blocker">
          <div className="project-restore-status" role="status">
            {translate('projects.loading')}
          </div>
        </div>
      ) : null}
      {restoreCandidate ? (
        <SessionRestoreToast
          onIgnore={() =>
            resolveRestoreCandidate('ignore', serializeCurrentWorkspace())
          }
          onRestore={() =>
            void restorePreviousSession()
          }
          translate={translate}
        />
      ) : null}
      <CreateProjectDialog
        onCancel={() => setCreateProjectOpen(false)}
        onCreate={createProject}
        onCreated={() => setCreateProjectOpen(false)}
        onSelectLocation={selectProjectCreateLocation}
        open={createProjectOpen}
        translate={translate}
      />
      {pageProperties.node && pageProperties.logicalPath ? (
        <ProjectPagePropertiesDialog
          loadError={pageProperties.state.error}
          loading={pageProperties.state.loading}
          logicalPath={pageProperties.logicalPath}
          node={pageProperties.node}
          onChangePassword={pageProperties.changePassword}
          onClose={pageProperties.close}
          onLock={pageProperties.lock}
          onPropertiesChange={pageProperties.acceptProperties}
          onProtect={pageProperties.protect}
          onRemovePassword={pageProperties.removePassword}
          onRetry={() => void pageProperties.load(pageProperties.node!.nodeId)}
          onSetReadOnly={pageProperties.setReadOnly}
          onUnlock={pageProperties.unlock}
          properties={pageProperties.state.properties}
          translate={translate}
        />
      ) : null}
      <ToastHost
        ariaLabel={translate('projects.notifications')}
        closeLabel={translate('projects.dismissNotice')}
        onDismiss={dismissToast}
        toasts={toasts}
      />
      <TooltipHost />
      {closeRequest ? (
        <CloseConfirmationDialog
          intent={closeRequest.intent}
          onCancel={cancelClose}
          onConfirm={confirmClose}
          pending={closeResponsePendingId === closeRequest.requestId}
          translate={translate}
        />
      ) : null}
      </div>
    </FlyoffPreferencesProvider>
  );
}
