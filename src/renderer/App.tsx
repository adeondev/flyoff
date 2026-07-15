import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import flyoffLogo from '../../public/images/flyoff/flyoff-logo.svg';
import markdownPageIcon from '../../public/images/icons/homepage/import-project.svg';
import projectOverviewIcon from '../../public/images/icons/homepage/new-project.svg';
import {
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
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  type ApplicationMenuEntryDefinition,
  type CloseRequest,
  type CloseResponse,
  type FlyoffApi,
  type FlyoffPlatform,
  type InternalPageId,
  type MarkdownDocument,
  type ProjectLocationSelection,
  type ProjectResult,
  type ProjectSummary,
  type ProjectTreeNode,
  type RendererMenuCommand,
  type TabDescriptor,
  type TabSessionRestoreDecision,
  type WorkspaceSessionSnapshot,
  type TranslationCatalog,
  type TranslationKey,
  type TrashProjectNodeOutcome,
  type WindowControlAction,
  type WindowState,
} from '../shared';
import { CloseConfirmationDialog } from './components/dialog/CloseConfirmationDialog';
import { SessionRestoreToast } from './components/dialog/SessionRestoreToast';
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
import { PageHost } from './components/tabs/PageHost';
import { TabBar } from './components/tabs/TabBar';
import {
  adoptWorkspaceSnapshot,
  createInitialWorkspaceState,
  hasRestorableWorkspace,
  selectActiveContext,
  selectActiveTabs,
  serializeWorkspace,
  workspaceReducer,
  type WorkspaceAction,
} from './components/tabs/workspace-state';
import {
  WindowControls,
  type WindowControlLabels,
} from './components/WindowControls';
import { initializeRendererI18n } from './i18n';
import { HomePage } from './pages/HomePage';
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
  ProjectOverview,
  ProjectSidebar,
  getProjectPageTypeDefinition,
  type ProjectSidebarHandle,
  projectNodeDisplayName,
} from './projects';

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
  windowControlLabels: WindowControlLabels;
  windowState: WindowState;
  onMenuAction: (id: string) => void;
  onToggleSidebar: () => void;
  onWindowAction: (action: WindowControlAction) => void;
}

function SidebarToggleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75" />
      <line x1="6.25" y1="2.75" x2="6.25" y2="13.25" />
    </svg>
  );
}

function Titlebar({
  menus,
  platform,
  sidebarCollapsed,
  toggleSidebarLabel,
  windowControlLabels,
  windowState,
  onMenuAction,
  onToggleSidebar,
  onWindowAction,
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
        title={toggleSidebarLabel}
        type="button"
      >
        <SidebarToggleIcon />
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
      <WindowControls
        labels={windowControlLabels}
        maximized={windowState.maximized}
        onAction={onWindowAction}
      />
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

function createMarkdownController(): MarkdownDocumentController {
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
  });
}

export function App() {
  const [platform, setPlatform] = useState<FlyoffPlatform>();
  const [translator, setTranslator] = useState<{ translate: Translate }>({
    translate: fallbackTranslate,
  });
  const [windowState, setWindowState] = useState<WindowState>({
    maximized: false,
  });
  const [workspaceState, dispatchWorkspace] = useReducer(
    workspaceReducer,
    undefined,
    createInitialWorkspaceState,
  );
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [projectNodes, setProjectNodes] = useState<
    ReadonlyMap<string, ProjectTreeNode>
  >(() => new Map());
  const [documentController, setDocumentController] = useState(
    createMarkdownController,
  );
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectNotice, setProjectNotice] = useState<string>();
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
  const projectRef = useRef<ProjectSummary | null>(null);
  const projectNodesRef = useRef<ReadonlyMap<string, ProjectTreeNode>>(
    new Map(),
  );
  const documentControllerRef = useRef(documentController);
  const projectSidebarRef = useRef<ProjectSidebarHandle>(null);
  const restoreCandidateRef = useRef<WorkspaceSessionSnapshot | null>(null);
  const restorePendingRef = useRef(false);
  const closeRequestRef = useRef<CloseRequest | null>(null);
  const closeResponsePendingIdRef = useRef<string | null>(null);
  const userInteractedRef = useRef(false);
  const restoreRequestStartedRef = useRef(false);
  const workspaceTransitionRef = useRef<Promise<void>>(Promise.resolve());
  const workspaceRef = useRef<HTMLDivElement>(null);
  const layout = useWorkspaceLayout();
  const translate = translator.translate;

  const menus = useMemo(
    () => createMenuBarItems(translate),
    [translate],
  );
  const windowControlLabels = useMemo<WindowControlLabels>(
    () => ({
      minimize: translate('windowControls.minimize'),
      maximize: translate('windowControls.maximize'),
      restore: translate('windowControls.restore'),
      close: translate('windowControls.close'),
    }),
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
    const next = createMarkdownController();
    documentControllerRef.current = next;
    setDocumentController(next);
  }, []);

  const setActiveProject = useCallback(
    (summary: ProjectSummary | null): void => {
      projectRef.current = summary;
      setProject(summary);
      projectNodesRef.current = new Map();
      setProjectNodes(new Map());
      replaceDocumentController();
    },
    [replaceDocumentController],
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
        workspaceStateRef.current = adoptWorkspaceSnapshot(resolved);
        dispatchWorkspace({ type: 'restore-workspace', snapshot: resolved });
      }

      const api = getApi();
      void api
        .resolveRestorableTabSession?.(decision, resolved)
        .catch(() => undefined);
    },
    [],
  );

  const dispatchUserAction = useCallback(
    (action: WorkspaceAction): void => {
      if (closeRequestRef.current || restorePendingRef.current) {
        return;
      }

      const current = workspaceStateRef.current;
      const next = workspaceReducer(current, action);

      if (next === current) {
        return;
      }

      userInteractedRef.current = true;
      resolveRestoreCandidate('ignore', serializeWorkspace(next));
      workspaceStateRef.current = next;
      dispatchWorkspace(action);
    },
    [resolveRestoreCandidate],
  );

  const flushProjectDocuments = useCallback(async (): Promise<boolean> => {
    try {
      return await documentControllerRef.current.flushAll();
    } catch {
      return false;
    }
  }, []);

  const performGuardedTabAction = useCallback(
    async (action: WorkspaceAction): Promise<boolean> => {
      if (closeRequestRef.current || restorePendingRef.current) {
        return false;
      }

      if (
        action.type === 'open-target' &&
        isProjectTarget(action.target) &&
        projectRef.current?.projectId !== action.target.projectId
      ) {
        return false;
      }

      const initial = workspaceStateRef.current;

      if (workspaceReducer(initial, action) === initial) {
        return true;
      }

      if (projectRef.current) {
        if (!(await flushProjectDocuments())) {
          return false;
        }

        if (closeRequestRef.current || restorePendingRef.current) {
          return false;
        }
      }

      dispatchUserAction(action);
      return true;
    },
    [dispatchUserAction, flushProjectDocuments],
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
    (action: WorkspaceAction): Promise<boolean> =>
      projectRef.current
        ? enqueueWorkspaceTransition(() => performGuardedTabAction(action))
        : performGuardedTabAction(action),
    [enqueueWorkspaceTransition, performGuardedTabAction],
  );

  const activateProject = useCallback(
    (summary: ProjectSummary): Promise<boolean> =>
      enqueueWorkspaceTransition(async () => {
        if (closeRequestRef.current || restorePendingRef.current) {
          return false;
        }

        setActiveProject(summary);
        dispatchUserAction({
          type: 'open-project-workspace',
          projectId: summary.projectId,
        });
        setProjectNotice(undefined);
        return true;
      }),
    [dispatchUserAction, enqueueWorkspaceTransition, setActiveProject],
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
        await getApi().closeProject?.().catch(() => undefined);
        setActiveProject(null);
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

  const projectPageRuntime = useMemo(
    () => ({
      markdown: {
        controller: documentController,
        readDocument: readMarkdownDocument,
      },
    }),
    [documentController, readMarkdownDocument],
  );

  const completeConsumedRestore = useCallback(
    (resolved: WorkspaceSessionSnapshot): void => {
      restorePendingRef.current = false;
      setRestorePending(false);
      workspaceStateRef.current = adoptWorkspaceSnapshot(resolved);
      dispatchWorkspace({ type: 'restore-workspace', snapshot: resolved });
      void getApi()
        .resolveRestorableTabSession?.('restore', resolved)
        .catch(() => undefined);
    },
    [],
  );

  const openCreateProjectDialog = useCallback((): void => {
    resolveRestoreCandidate('ignore', serializeWorkspace(workspaceStateRef.current));
    setCreateProjectOpen(true);
  }, [resolveRestoreCandidate]);

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
    resolveRestoreCandidate('ignore', serializeWorkspace(workspaceStateRef.current));
    if (!(await flushProjectDocuments())) {
      return;
    }

    const operation = getApi().openProject;
    if (!operation) {
      setProjectNotice(translate('projects.operationFailed'));
      return;
    }

    try {
      const result = await operation();
      if (result.ok) {
        if (!(await activateProject(result.value))) {
          await getApi().closeProject?.().catch(() => undefined);
          setProjectNotice(translate('projects.operationFailed'));
        }
      } else if (result.error.code !== 'cancelled') {
        setProjectNotice(result.error.message);
      }
    } catch (error) {
      setProjectNotice(String(error));
    }
  }, [activateProject, flushProjectDocuments, resolveRestoreCandidate, translate]);

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

        if (!(await flushProjectDocuments())) {
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
      flushProjectDocuments,
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

        if (!(await flushProjectDocuments())) {
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
          cacheProjectNodes([result.value]);
        }
        return result;
      }),
    [
      cacheProjectNodes,
      enqueueWorkspaceTransition,
      flushProjectDocuments,
      translate,
    ],
  );

  const moveProjectNode = useCallback(
    (request: Parameters<FlyoffApi['moveProjectNode']>[0]) =>
      enqueueWorkspaceTransition(async () => {
        if (!(await flushProjectDocuments())) {
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
          cacheProjectNodes([result.value]);
        }
        return result;
      }),
    [
      cacheProjectNodes,
      enqueueWorkspaceTransition,
      flushProjectDocuments,
      translate,
    ],
  );

  const commitProjectNodeTrashed = useCallback(
    async (nodeIds: readonly string[]): Promise<void> => {
      const removedIds = new Set(nodeIds);

      const remainingNodes = new Map(projectNodesRef.current);
      for (const nodeId of removedIds) {
        remainingNodes.delete(nodeId);
      }
      projectNodesRef.current = remainingNodes;
      setProjectNodes(remainingNodes);

      const tabsToClose = (
        workspaceStateRef.current.project?.tabs ?? []
      ).filter(
        (tab) =>
          tab.target.type === 'project-content' &&
          removedIds.has(tab.target.nodeId),
      );

      for (const tab of tabsToClose) {
        const action = { type: 'close-tab', tabId: tab.tabId } as const;
        workspaceStateRef.current = workspaceReducer(
          workspaceStateRef.current,
          action,
        );
        dispatchWorkspace(action);
      }
    },
    [],
  );

  const trashProjectNode = useCallback(
    (request: Parameters<FlyoffApi['trashProjectNode']>[0]) =>
      enqueueWorkspaceTransition(async () => {
        if (!(await flushProjectDocuments())) {
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
      flushProjectDocuments,
      translate,
    ],
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

  const closeActiveTab = useCallback((): void => {
    const activeTabId = selectActiveTabs(workspaceStateRef.current).activeTabId;

    if (activeTabId) {
      void dispatchGuardedTabAction({ type: 'close-tab', tabId: activeTabId });
    }
  }, [dispatchGuardedTabAction]);

  const controlWindow = useCallback(
    (action: WindowControlAction): void => {
      void getApi()
        .controlWindow?.(action)
        .then(setWindowState)
        .catch(() => undefined);
    },
    [],
  );

  const executeMenuCommand = useCallback(
    (command: string): void => {
      if (isRendererMenuCommand(command)) {
        if (command === RENDERER_MENU_COMMANDS.closeTab) {
          closeActiveTab();
        }
        return;
      }

      if (isApplicationMenuCommand(command)) {
        void getApi().executeMenuCommand?.(command).catch(() => undefined);
      }
    },
    [closeActiveTab],
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
        session: serializeWorkspace(workspaceStateRef.current),
      });
    });
  }, [flushProjectDocuments, submitCloseResponse, waitForWorkspaceTransitions]);

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
      setProjectNotice(translate('projects.projectUnavailable'));
      completeConsumedRestore({ ...candidate, project: null });
      return;
    }

    let result: Awaited<ReturnType<FlyoffApi['restoreProject']>>;
    try {
      result = await restore({ projectId: projectSnapshot.projectId });
    } catch {
      setProjectNotice(translate('projects.projectUnavailable'));
      completeConsumedRestore({ ...candidate, project: null });
      return;
    }

    if (!result.ok) {
      setProjectNotice(translate('projects.projectUnavailable'));
      completeConsumedRestore({ ...candidate, project: null });
      return;
    }

    setActiveProject(result.value);

    const getNode = getApi().getProjectNode;
    if (getNode) {
      const pendingNodeIds = [
        ...new Set(
          projectSnapshot.tabs.flatMap(({ target }) =>
            target.type === 'project-content' ? [target.nodeId] : [],
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
    setActiveProject,
    translate,
  ]);

  useEffect(() => {
    const removeStateListener = getApi().onWindowStateChanged?.((state) => {
      setWindowState(state);
    });

    void getApi()
      .getWindowState?.()
      .then(setWindowState)
      .catch(() => undefined);

    return () => {
      removeStateListener?.();
    };
  }, []);

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
    if (restoreRequestStartedRef.current) {
      return;
    }

    restoreRequestStartedRef.current = true;
    const api = getApi();

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
              serializeWorkspace(workspaceStateRef.current),
            )
            .catch(() => undefined);
          return;
        }

        restoreCandidateRef.current = candidate;
        setRestoreCandidate(candidate);
      })
      .catch(() => {
        setSessionReady(true);
      });
  }, []);

  useEffect(() => {
    if (!restoreCandidate) {
      return;
    }

    const timeout = window.setTimeout(() => {
      resolveRestoreCandidate('ignore', serializeWorkspace(workspaceStateRef.current));
    }, 8_000);

    return () => window.clearTimeout(timeout);
  }, [resolveRestoreCandidate, restoreCandidate]);

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
    const api = getApi();
    const removeCloseListener = api.onCloseRequested?.((request) => {
      if (restorePendingRef.current) {
        void respondToClose({
          requestId: request.requestId,
          decision: 'cancel',
        }).catch(() => undefined);
        return;
      }

      resolveRestoreCandidate('ignore', serializeWorkspace(workspaceStateRef.current));

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
          session: serializeWorkspace(workspaceStateRef.current),
        });
        return;
      }

      setCloseRequest(request);
    });
    const removeMenuListener = api.onRendererMenuCommand?.(
      (command: RendererMenuCommand) => {
        if (command === RENDERER_MENU_COMMANDS.closeTab) {
          closeActiveTab();
        }
      },
    );

    return () => {
      removeCloseListener?.();
      removeMenuListener?.();
    };
  }, [
    closeActiveTab,
    resolveRestoreCandidate,
    respondToClose,
    submitCloseResponse,
  ]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      const primary = platform === 'darwin' ? event.metaKey : event.ctrlKey;

      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault();
        const state = selectActiveTabs(workspaceStateRef.current);
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
  }, [dispatchGuardedTabAction, platform]);

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

  const renderPage = useCallback(
    (props: PageRenderProps) => {
      const target = props.descriptor.target;

      if (target.type === 'internal') {
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

      return (
        <ProjectContentPage
          node={projectNodes.get(target.nodeId)}
          nodeId={target.nodeId}
          pageType={target.pageType}
          runtime={projectPageRuntime}
          scrollTop={props.descriptor.scrollTop}
          onScrollChange={props.onScrollChange}
          translate={translate}
        />
      );
    },
    [
      openCreateProjectDialog,
      openProject,
      project,
      projectNodes,
      projectPageRuntime,
      requestRootCreation,
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
  const isEmptyProjectWorkspace =
    workspaceContext === 'project' && activeTabs.tabs.length === 0;
  const activeProjectNodePath = useMemo(() => {
    if (activeProjectTarget?.type !== 'project-content') {
      return [];
    }

    const pathIds: string[] = [];
    const visited = new Set<string>();
    let current = projectNodes.get(activeProjectTarget.nodeId);

    while (current?.parentId && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      const parent = projectNodes.get(current.parentId);
      if (!parent || parent.kind !== 'folder') {
        break;
      }
      pathIds.unshift(parent.nodeId);
      current = parent;
    }

    return pathIds;
  }, [activeProjectTarget, projectNodes]);

  return (
    <div className="app-shell">
      <Titlebar
        menus={menus}
        platform={platform}
        sidebarCollapsed={layout.collapsed}
        toggleSidebarLabel={translate(
          layout.collapsed ? 'layout.expandSidebar' : 'layout.collapseSidebar',
        )}
        windowControlLabels={windowControlLabels}
        windowState={windowState}
        onMenuAction={executeMenuCommand}
        onToggleSidebar={layout.toggleCollapsed}
        onWindowAction={controlWindow}
      />
      <div
        className="workspace"
        data-collapsed={layout.collapsed || undefined}
        data-context={workspaceContext}
        ref={workspaceRef}
        style={{ '--sidebar-width': `${layout.sidebarWidth}px` } as CSSProperties}
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
            onSelect={layout.setRailViewId}
            translate={translate}
            views={RAIL_VIEWS}
          />
        )}
        {project ? (
          <ProjectSidebar
            activeNodeId={
              activeProjectTarget?.type === 'project-content'
                ? activeProjectTarget.nodeId
                : undefined
            }
            activeNodePath={activeProjectNodePath}
            hidden={layout.railViewId !== RAIL_VIEW_IDS.project}
            loadChildren={listProjectChildren}
            onBeforeNodeChange={() => flushProjectDocuments()}
            onCreateNode={createProjectNode}
            onError={setProjectNotice}
            onMoveNode={moveProjectNode}
            onNodeChanged={(node) => cacheProjectNodes([node])}
            onCloseProject={() => void closeProjectWorkspace()}
            onOpenNode={openProjectNode}
            onOpenOverview={() =>
              void dispatchGuardedTabAction({
                type: 'open-target',
                target: {
                  type: 'project-overview',
                  projectId: project.projectId,
                },
              })
            }
            onRenameNode={renameProjectNode}
            onTrashNode={trashProjectNode}
            overviewActive={
              activeProjectTarget?.type === 'project-overview'
            }
            project={project}
            ref={projectSidebarRef}
            translate={translate}
          />
        ) : null}
        {workspaceContext === 'project' &&
        layout.railViewId !== RAIL_VIEW_IDS.project ? (
          <PlaceholderPanel
            hint={translate('rail.comingSoon')}
            title={translate(resolveRailView(layout.railViewId).labelKey)}
          />
        ) : null}
        <div className="page-workspace">
          <TabBar
            activeTabId={activeTabs.activeTabId}
            closeLabel={translate('pages.closeTab')}
            getPresentation={getTabPresentation}
            navigationLabel={translate('pages.bar')}
            onClose={(tabId) =>
              void dispatchGuardedTabAction({ type: 'close-tab', tabId })
            }
            onMove={(tabId, toIndex) =>
              dispatchUserAction({ type: 'move-tab', tabId, toIndex })
            }
            onSelect={(tabId) =>
              void dispatchGuardedTabAction({ type: 'select-tab', tabId })
            }
            tabs={activeTabs.tabs}
          />
          <PageHost
            activeTabId={activeTabs.activeTabId}
            emptyState={
              isEmptyProjectWorkspace ? (
                <ProjectEmptyState
                  onCloseProject={() => void closeProjectWorkspace()}
                  translate={translate}
                />
              ) : null
            }
            getPresentation={getTabPresentation}
            onPageStateChange={(tabId, pageState) =>
              dispatchUserAction({
                type: 'update-page-state',
                tabId,
                pageState,
              })
            }
            onScrollChange={(tabId, scrollTop) =>
              dispatchUserAction({
                type: 'update-scroll',
                tabId,
                scrollTop,
              })
            }
            renderPage={renderPage}
            tabs={activeTabs.tabs}
            translate={translate}
          />
        </div>
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
            resolveRestoreCandidate('ignore', serializeWorkspace(workspaceStateRef.current))
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
      {projectNotice ? (
        <div className="project-notice" role="alert">
          <span>{projectNotice}</span>
          <button
            aria-label={translate('projects.cancel')}
            onClick={() => setProjectNotice(undefined)}
            type="button"
          >
            &times;
          </button>
        </div>
      ) : null}
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
  );
}
