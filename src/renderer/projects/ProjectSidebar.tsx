import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import arrowLeftIcon from '../../../public/images/icons/actions/arrow-left.svg';
import infoIcon from '../../../public/images/icons/actions/info.svg';
import plusIcon from '../../../public/images/icons/actions/plus.svg';
import refreshIcon from '../../../public/images/icons/actions/refresh.svg';
import settingsIcon from '../../../public/images/icons/actions/settings-outline.svg';
import expandIcon from '../../../public/images/icons/actions/expand-outline.svg';
import collapseIcon from '../../../public/images/icons/actions/collapse-outline.svg';
import copyPathIcon from '../../../public/images/icons/actions/copy-path-outline.svg';
import folderOpenIcon from '../../../public/images/icons/instances/folder-open-solid.svg';
import folderIcon from '../../../public/images/icons/instances/folder-solid.svg';
import noteIcon from '../../../public/images/icons/instances/note-solid.svg';
import type {
  CreateProjectNodeRequest,
  CreateDiagramDocumentRequest,
  FlyoffPlatform,
  ListProjectChildrenRequest,
  MoveProjectNodeRequest,
  MoveProjectNodesRequest,
  ProjectResult,
  ProjectSearchOutcome,
  ProjectSearchPreview,
  ProjectSearchRequest,
  ProjectSummary,
  ProjectAppearanceSnapshot,
  ProjectTreeNode,
  ProjectPathRequest,
  ProjectPageNode,
  ProjectMediaUsage,
  ProjectNodesMutationOutcome,
  RenameProjectNodeRequest,
  TrashProjectNodeRequest,
  TrashProjectNodesRequest,
  TrashProjectNodeOutcome,
} from '../../shared/contracts';
import type { DiagramType } from '../../shared/diagram';
import { MaskedIcon } from '../components/MaskedIcon';
import { TwemojiText } from '../components/twemoji';
import { ContextMenu, type MenuItem } from '../components/menu';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import {
  AddInstancePopover,
  type AddInstanceChoice,
} from './AddInstancePopover';
import { MoveProjectNodeDialog } from './MoveProjectNodeDialog';
import { NodeColorPopover } from './NodeColorPopover';
import { MoveProjectNodesDialog } from './MoveProjectNodesDialog';
import { projectNodeInputName } from './project-node-name';
import { ProjectSearchInput } from './ProjectSearchInput';
import { ProjectTree, type ProjectTreeInlineEdit } from './ProjectTree';
import {
  emptyProjectTreeSelection,
  type ProjectTreeSelection,
} from './project-tree-selection';
import {
  ProjectTreeController,
  type ProjectChildrenLoader,
} from './project-tree-controller';
import { TrashProjectNodeDialog } from './TrashProjectNodeDialog';
import { TrashProjectNodesDialog } from './TrashProjectNodesDialog';
import { DiagramTypeDialog } from './diagram/DiagramTypeDialog';

function createTreeController(
  projectId: string,
  loadChildren: ProjectChildrenLoader,
  onError?: (message: string) => void,
): ProjectTreeController {
  void projectId;
  return new ProjectTreeController(loadChildren, onError);
}

const EMPTY_NODE_PATH: readonly string[] = [];

function fileManagerLabel(
  platform: FlyoffPlatform | undefined,
  translate: Translate,
): string {
  if (platform === 'win32') {
    return translate('projects.revealInExplorer');
  }
  if (platform === 'darwin') {
    return translate('projects.revealInFinder');
  }
  return translate('projects.revealInFileManager');
}

export interface ProjectSidebarAppearance {
  snapshot: ProjectAppearanceSnapshot;
  setNoteSeed: (nodeId: string, seed: string | null) => Promise<void>;
  setProjectSeed: (seed: string | null) => Promise<void>;
}

export interface ProjectSidebarProps {
  project: ProjectSummary;
  platform?: FlyoffPlatform;
  hidden?: boolean;
  mediaMode?: boolean;
  appearance?: ProjectSidebarAppearance;
  translate: Translate;
  activeNodeId?: string;
  activeNodePath?: readonly string[];
  overviewActive?: boolean;
  settingsActive?: boolean;
  createRequest?: ProjectSidebarCreateRequest;
  loadChildren: (
    request: ListProjectChildrenRequest,
  ) => Promise<ProjectResult<readonly ProjectTreeNode[]>>;
  onSearch?: (
    request: ProjectSearchRequest,
  ) => Promise<ProjectResult<ProjectSearchOutcome>>;
  onCreateNode: (
    request: CreateProjectNodeRequest,
  ) => Promise<ProjectResult<ProjectTreeNode>>;
  onCreateDiagram: (
    request: CreateDiagramDocumentRequest,
  ) => Promise<ProjectResult<ProjectTreeNode>>;
  onRenameNode: (
    request: RenameProjectNodeRequest,
  ) => Promise<ProjectResult<ProjectTreeNode>>;
  onMoveNode: (
    request: MoveProjectNodeRequest,
  ) => Promise<ProjectResult<ProjectTreeNode>>;
  onMoveNodes: (
    request: MoveProjectNodesRequest,
  ) => Promise<ProjectResult<ProjectNodesMutationOutcome>>;
  onTrashNode: (
    request: TrashProjectNodeRequest,
  ) => Promise<ProjectResult<TrashProjectNodeOutcome>>;
  onTrashNodes: (
    request: TrashProjectNodesRequest,
  ) => Promise<ProjectResult<TrashProjectNodeOutcome>>;
  onCopyPath?: (
    request: ProjectPathRequest,
  ) => Promise<ProjectResult<null>>;
  onCopyPaths?: (
    request: { nodeIds: readonly string[] },
  ) => Promise<ProjectResult<null>>;
  onRevealPath?: (
    request: ProjectPathRequest,
  ) => Promise<ProjectResult<null>>;
  onOpenOverview: () => void;
  onOpenAbout?: () => void;
  onOpenSettings?: () => void;
  onCloseProject?: () => void;
  onOpenNode: (node: ProjectTreeNode) => void;
  onOpenNodes: (nodes: readonly ProjectPageNode[]) => void;
  onRequestProperties?: (node: ProjectPageNode) => void;
  onBeforeNodeChange?: (node: ProjectTreeNode) => Promise<boolean>;
  onBeforeNodesChange?: (
    nodes: readonly ProjectTreeNode[],
  ) => Promise<boolean>;
  onCreateRequestHandled?: (id: number | string) => void;
  onNodeChanged?: (node: ProjectTreeNode) => void;
  onNodeTrashed?: (node: ProjectTreeNode) => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
  onListMediaUsages?: (
    nodeId: string,
  ) => Promise<ProjectResult<readonly ProjectMediaUsage[]>>;
  onImportMedia?: (
    parentId: string | null,
    files?: readonly File[],
  ) => Promise<void>;
  onInsertMedia?: (node: ProjectPageNode) => void;
}

export interface ProjectSidebarCreateRequest {
  id: number | string;
  kind: ProjectTreeNode['kind'];
  parentId?: string | null;
}

export interface ProjectSidebarHandle {
  createMarkdown: (parentId?: string | null) => Promise<void>;
  createFolder: (parentId?: string | null) => Promise<void>;
  refresh: () => Promise<boolean>;
}

export const ProjectSidebar = forwardRef<
  ProjectSidebarHandle,
  ProjectSidebarProps
>(function ProjectSidebar({
  activeNodeId,
  activeNodePath = EMPTY_NODE_PATH,
  createRequest,
  hidden = false,
  mediaMode = false,
  loadChildren,
  onBeforeNodeChange,
  onBeforeNodesChange,
  onCopyPath,
  onCopyPaths,
  onCreateRequestHandled,
  onCreateNode,
  onCreateDiagram,
  onError,
  onMoveNode,
  onMoveNodes,
  onNodeChanged,
  onNodeTrashed,
  onCloseProject,
  onOpenAbout,
  onOpenNode,
  onOpenNodes,
  onOpenOverview,
  onOpenSettings,
  onRequestProperties,
  onRevealPath,
  onRenameNode,
  onSearch,
  onTrashNode,
  onTrashNodes,
  onNotice,
  onListMediaUsages,
  onImportMedia,
  onInsertMedia,
  overviewActive = false,
  platform,
  project,
  settingsActive = false,
  appearance,
  translate,
}: ProjectSidebarProps, forwardedRef) {
  const effectiveLoadChildren = useCallback(
    async (request: ListProjectChildrenRequest) => {
      const result = await loadChildren(request);
      return !mediaMode || !result.ok
        ? result
        : {
            ok: true as const,
            value: result.value.filter(
              (node) =>
                node.kind === 'folder' ||
                node.pageType === 'markdown' ||
                node.pageType.startsWith('media:'),
            ),
          };
    },
    [loadChildren, mediaMode],
  );
  const controller = useMemo(
    () => createTreeController(project.projectId, effectiveLoadChildren, onError),
    [effectiveLoadChildren, onError, project.projectId],
  );
  const [edit, setEdit] = useState<ProjectTreeInlineEdit>();
  const [movingNode, setMovingNode] = useState<ProjectTreeNode>();
  const [movingNodes, setMovingNodes] =
    useState<readonly ProjectTreeNode[]>();
  const [trashingNode, setTrashingNode] = useState<ProjectTreeNode>();
  const [trashWarning, setTrashWarning] = useState<string>();
  const [trashingNodes, setTrashingNodes] =
    useState<readonly ProjectTreeNode[]>();

  async function requestTrash(node: ProjectTreeNode): Promise<void> {
    setTrashWarning(undefined);
    if (
      node.kind === 'page' &&
      node.pageType.startsWith('media:') &&
      onListMediaUsages
    ) {
      const result = await onListMediaUsages(node.nodeId);
      if (!result.ok) {
        reportError(result.error.message);
        return;
      }
      const count = result.value.reduce((total, usage) => total + usage.count, 0);
      if (count > 0) {
        setTrashWarning(
          `Esta mídia é usada ${count} ${count === 1 ? 'vez' : 'vezes'} em ${result.value.length} ${result.value.length === 1 ? 'nota' : 'notas'}. As notas manterão um marcador de mídia ausente.`,
        );
      }
    }
    setTrashingNode(node);
  }
  const [selection, setSelection] = useState<ProjectTreeSelection>(
    emptyProjectTreeSelection,
  );
  const selectionRegionRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearchQuery, setAppliedSearchQuery] = useState('');
  const [searchNodeIds, setSearchNodeIds] = useState<ReadonlySet<string>>();
  const [searchPreviews, setSearchPreviews] =
    useState<ReadonlyMap<string, ProjectSearchPreview>>();
  const [skippedLockedCount, setSkippedLockedCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const [instancePicker, setInstancePicker] = useState<{
    parentId: string | null;
    position: { x: number; y: number };
    restoreFocus?: HTMLElement | null;
  }>();
  const [diagramTypePicker, setDiagramTypePicker] = useState<{
    parentId: string | null;
  }>();
  const [branchMenu, setBranchMenu] = useState<{
    parentId: string | null;
    position: { x: number; y: number };
    restoreFocus?: HTMLElement | null;
  }>();
  const [colorPicker, setColorPicker] = useState<{
    nodeId: string;
    position: { x: number; y: number };
    restoreFocus?: HTMLElement | null;
  }>();
  const [projectColorPicker, setProjectColorPicker] = useState<{
    position: { x: number; y: number };
    restoreFocus: HTMLElement;
  }>();

  async function refreshRelationships(
    parentIds: readonly (string | null)[],
  ): Promise<boolean> {
    const branches = new Set<string | null>(parentIds);
    for (const parentId of parentIds) {
      if (parentId !== null) {
        branches.add(controller.findNode(parentId)?.parentId ?? null);
      }
    }
    return controller.refreshParents([...branches]);
  }

  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setAppliedSearchQuery('');
      setSearchNodeIds(undefined);
      setSearchPreviews(undefined);
      setSkippedLockedCount(0);
      setSearching(false);
      return;
    }

    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void Promise.all([
        controller.loadAll(),
        onSearch?.({ query }),
      ]).then(([, result]) => {
        if (!active) {
          return;
        }
        if (result && !result.ok) {
          onError?.(result.error.message);
          setSearchNodeIds(new Set());
          setSearchPreviews(new Map());
          setSkippedLockedCount(0);
        } else {
          setSearchNodeIds(
            result?.ok ? new Set(result.value.nodeIds) : undefined,
          );
          setSearchPreviews(
            result?.ok
              ? new Map(
                  result.value.previews.map((preview) => [
                    preview.nodeId,
                    preview,
                  ]),
                )
              : undefined,
          );
          setSkippedLockedCount(
            result?.ok ? result.value.skippedLockedNodeIds.length : 0,
          );
        }
        setAppliedSearchQuery(query);
        setSearching(false);
      });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [controller, onError, onSearch, searchQuery]);
  useEffect(() => {
    let active = true;

    void (async () => {
      for (const folderId of activeNodePath) {
        if (!active) {
          return;
        }
        await controller.setExpanded(folderId, true);
      }
    })();

    return () => {
      active = false;
    };
  }, [activeNodePath, controller]);

  function reportError(message: string): void {
    onError?.(message);
  }

  async function allowNodeChange(node: ProjectTreeNode): Promise<boolean> {
    return onBeforeNodeChange ? onBeforeNodeChange(node) : true;
  }

  async function allowNodesChange(
    nodes: readonly ProjectTreeNode[],
  ): Promise<boolean> {
    return onBeforeNodesChange ? onBeforeNodesChange(nodes) : true;
  }

  const startCreate = useCallback(
    async (
      parentId: string | null,
      kind: ProjectTreeNode['kind'],
      pageType?: string,
      diagramType?: DiagramType,
    ): Promise<void> => {
      if (parentId) {
        await controller.setExpanded(parentId, true);
      }
      setEdit({ mode: 'create', parentId, kind, pageType, diagramType });
    },
    [controller],
  );

  useImperativeHandle(
    forwardedRef,
    () => ({
      createMarkdown: (parentId = null) => startCreate(parentId, 'page'),
      createFolder: (parentId = null) => startCreate(parentId, 'folder'),
      refresh: () => controller.refreshLoaded(),
    }),
    [controller, startCreate],
  );

  useEffect(() => {
    if (!createRequest) {
      return;
    }

    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        onCreateRequestHandled?.(createRequest.id);
        return startCreate(createRequest.parentId ?? null, createRequest.kind);
      }
    });
    return () => {
      active = false;
    };
  }, [createRequest, onCreateRequestHandled, startCreate]);

  async function submitEdit(name: string): Promise<void> {
    if (!edit || pending) {
      return;
    }

    const requestName = projectNodeInputName(
      edit.mode === 'rename' ? edit.node.kind : edit.kind,
      name,
    );
    setPending(true);
    try {
      if (edit.mode === 'create') {
        const result =
          edit.kind === 'page' &&
          edit.pageType === 'diagram' &&
          edit.diagramType
            ? await onCreateDiagram({
                name: requestName,
                parentId: edit.parentId,
                diagramType: edit.diagramType,
              })
            : await onCreateNode(
                edit.kind === 'folder'
                  ? { kind: 'folder', name: requestName, parentId: edit.parentId }
                  : {
                      kind: 'page',
                      name: requestName,
                      pageType: edit.pageType ?? 'markdown',
                      parentId: edit.parentId,
                    },
              );
        if (!result.ok) {
          reportError(result.error.message);
          return;
        }
        await refreshRelationships([edit.parentId]);
        setEdit(undefined);
        onNodeChanged?.(result.value);
        if (result.value.kind === 'page') {
          onOpenNode(result.value);
        }
        return;
      }

      if (!(await allowNodeChange(edit.node))) {
        return;
      }
      const result = await onRenameNode({
        nodeId: edit.node.nodeId,
        name: requestName,
      });
      if (!result.ok) {
        reportError(result.error.message);
        return;
      }
      await refreshRelationships([edit.node.parentId]);
      setEdit(undefined);
      onNodeChanged?.(result.value);
    } catch (operationError) {
      reportError(String(operationError));
    } finally {
      setPending(false);
    }
  }

  async function moveByDrop(
    node: ProjectTreeNode,
    parentId: string | null,
    beforeNodeId?: string | null,
  ): Promise<void> {
    if (pending || !(await allowNodeChange(node))) {
      return;
    }

    setPending(true);
    try {
      const result = await onMoveNode({
        nodeId: node.nodeId,
        parentId,
        ...(beforeNodeId === undefined ? {} : { beforeNodeId }),
      });
      if (!result.ok) {
        reportError(result.error.message);
        return;
      }
      await refreshRelationships([node.parentId, parentId]);
      onNodeChanged?.(result.value);
    } catch (operationError) {
      reportError(String(operationError));
    } finally {
      setPending(false);
    }
  }

  async function moveFromDialog(
    request: MoveProjectNodeRequest,
  ): Promise<ProjectResult<ProjectTreeNode>> {
    const node = movingNode;
    if (!node || !(await allowNodeChange(node))) {
      return {
        ok: false,
        error: {
          code: 'invalid-operation',
          message: translate('projects.operationFailed'),
        },
      };
    }
    return onMoveNode(request);
  }

  async function moveSelectionByDrop(
    nodes: readonly ProjectTreeNode[],
    parentId: string | null,
    beforeNodeId?: string | null,
  ): Promise<void> {
    if (pending || !(await allowNodesChange(nodes))) {
      return;
    }
    setPending(true);
    try {
      const result = await onMoveNodes({
        nodeIds: nodes.map(({ nodeId }) => nodeId),
        parentId,
        ...(beforeNodeId === undefined ? {} : { beforeNodeId }),
      });
      if (!result.ok) {
        reportError(result.error.message);
        return;
      }
      await refreshRelationships([
        ...nodes.map((node) => node.parentId),
        parentId,
      ]);
      setSelection(emptyProjectTreeSelection());
      for (const node of result.value.nodes) {
        onNodeChanged?.(node);
      }
    } catch (error) {
      reportError(String(error));
    } finally {
      setPending(false);
    }
  }

  async function moveSelectionFromDialog(
    request: MoveProjectNodesRequest,
  ): Promise<ProjectResult<ProjectNodesMutationOutcome>> {
    if (!movingNodes || !(await allowNodesChange(movingNodes))) {
      return {
        ok: false,
        error: {
          code: 'invalid-operation',
          message: translate('projects.operationFailed'),
        },
      };
    }
    return onMoveNodes(request);
  }

  async function trashFromDialog(
    request: TrashProjectNodeRequest,
  ): Promise<ProjectResult<TrashProjectNodeOutcome>> {
    const node = trashingNode;
    if (!node || !(await allowNodeChange(node))) {
      return {
        ok: false,
        error: {
          code: 'invalid-operation',
          message: translate('projects.operationFailed'),
        },
      };
    }
    return onTrashNode(request);
  }

  async function trashSelectionFromDialog(
    request: TrashProjectNodesRequest,
  ): Promise<ProjectResult<TrashProjectNodeOutcome>> {
    if (!trashingNodes || !(await allowNodesChange(trashingNodes))) {
      return {
        ok: false,
        error: {
          code: 'invalid-operation',
          message: translate('projects.operationFailed'),
        },
      };
    }
    return onTrashNodes(request);
  }

  function openInstancePicker(
    parentId: string | null,
    position: { x: number; y: number },
    restoreFocus?: HTMLElement | null,
  ): void {
    setInstancePicker({ parentId, position, restoreFocus });
  }

  function openBranchMenu(
    parentId: string | null,
    position: { x: number; y: number },
    restoreFocus?: HTMLElement | null,
  ): void {
    setInstancePicker(undefined);
    setBranchMenu({ parentId, position, restoreFocus });
  }

  function chooseInstance(choice: AddInstanceChoice): void {
    const target = instancePicker;
    if (!target) {
      return;
    }
    if (choice.kind === 'page' && choice.pageType === 'diagram') {
      setDiagramTypePicker({ parentId: target.parentId });
      return;
    }
    void startCreate(target.parentId, choice.kind, choice.pageType);
  }

  async function performPathAction(
    operation:
      | ProjectSidebarProps['onCopyPath']
      | ProjectSidebarProps['onRevealPath'],
    parentId: string | null,
  ): Promise<void> {
    if (!operation) {
      return;
    }

    try {
      const result = await operation({ nodeId: parentId });
      if (!result.ok) {
        reportError(result.error.message);
      }
    } catch (error) {
      reportError(String(error));
    }
  }

  function handleBranchMenuAction(
    action: string,
    target: NonNullable<typeof branchMenu>,
  ): void {
    switch (action) {
      case 'import-media':
        void onImportMedia?.(target.parentId);
        return;
      case 'new-instance':
        openInstancePicker(
          target.parentId,
          target.position,
          target.restoreFocus,
        );
        return;
      case 'new-folder':
        void startCreate(target.parentId, 'folder');
        return;
      case 'expand-all':
        void controller.expandBranch(target.parentId).then((result) => {
          if (result.truncated) {
            onNotice?.(translate('projects.expandLimitReached'));
          }
        });
        return;
      case 'collapse-all':
        controller.collapseBranch(target.parentId);
        return;
      case 'reveal-path':
        void performPathAction(onRevealPath, target.parentId);
        return;
      case 'copy-path':
        void performPathAction(onCopyPath, target.parentId);
        return;
      default:
        return;
    }
  }

  function branchMenuItems(parentId: string | null): readonly MenuItem[] {
    return [
      ...(mediaMode
        ? [{
            id: 'import-media',
            kind: 'action' as const,
            label: translate('projects.importMedia'),
            icon: noteIcon,
            disabled: pending || !onImportMedia,
          }]
        : [{
            id: 'new-instance',
            kind: 'action' as const,
            label: translate('projects.newInstance'),
            icon: noteIcon,
            disabled: pending,
          }]),
      ...(!mediaMode && onImportMedia
        ? [{
            id: 'import-media',
            kind: 'action' as const,
            label: translate('projects.importMedia'),
            icon: noteIcon,
            disabled: pending,
          }]
        : []),
      {
        id: 'new-folder',
        kind: 'action',
        label: translate('projects.newFolder'),
        icon: folderIcon,
        disabled: pending,
      },
      { id: 'create-separator', kind: 'separator' },
      {
        id: 'expand-all',
        kind: 'action',
        label: translate('projects.expandAll'),
        icon: expandIcon,
        disabled: pending || !controller.canExpandBranch(parentId),
      },
      {
        id: 'collapse-all',
        kind: 'action',
        label: translate('projects.collapseAll'),
        icon: collapseIcon,
        disabled: pending || !controller.canCollapseBranch(parentId),
      },
      { id: 'path-separator', kind: 'separator' },
      {
        id: 'reveal-path',
        kind: 'action',
        label: fileManagerLabel(platform, translate),
        icon: folderOpenIcon,
        disabled: !onRevealPath,
      },
      {
        id: 'copy-path',
        kind: 'action',
        label: translate('projects.copyPath'),
        icon: copyPathIcon,
        disabled: !onCopyPath,
      },
    ];
  }

  return (
    <aside
      aria-label={translate('projects.navigation')}
      className="home__sidebar project-sidebar"
      hidden={hidden}
    >
      <div
        className="project-sidebar__selection-region"
        onBlurCapture={(event) => {
          const region = event.currentTarget;
          requestAnimationFrame(() => {
            const active = document.activeElement;
            if (
              (active instanceof Node && region.contains(active)) ||
              (active instanceof Element &&
                Boolean(
                  active.closest(
                    '.flyoff-menu, .flyoff-dialog, .add-instance-popover',
                  ),
                )) ||
              movingNode ||
              movingNodes ||
              trashingNode ||
              trashingNodes ||
              instancePicker ||
              branchMenu
            ) {
              return;
            }
            setSelection(emptyProjectTreeSelection());
          });
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Escape' &&
            !event.defaultPrevented &&
            selection.selectedIds.size > 0
          ) {
            event.preventDefault();
            setSelection(emptyProjectTreeSelection());
          }
        }}
        ref={selectionRegionRef}
      >
        <header className="project-sidebar__header">
        <div className="project-sidebar__tools">
          <button
            aria-label={translate('projects.closeProject')}
            className="project-sidebar__tool"
            disabled={!onCloseProject || pending}
            onClick={onCloseProject}
            type="button"
            {...getTooltipTargetProps(
              translate('projects.closeProject'),
              'bottom',
            )}
          >
            <MaskedIcon
              className="project-sidebar__tool-icon"
              icon={arrowLeftIcon}
            />
          </button>
          <button
            aria-label={translate('projects.refresh')}
            className="project-sidebar__tool"
            disabled={pending}
            onClick={() => void controller.refreshLoaded()}
            type="button"
            {...getTooltipTargetProps(translate('projects.refresh'), 'bottom')}
          >
            <MaskedIcon
              className="project-sidebar__tool-icon"
              icon={refreshIcon}
            />
          </button>
          <button
            aria-expanded={mediaMode ? undefined : Boolean(instancePicker)}
            aria-haspopup={mediaMode ? undefined : 'dialog'}
            aria-label={
              mediaMode
                ? translate('projects.importMedia')
                : translate('projects.addInstance')
            }
            className="project-sidebar__tool"
            disabled={pending}
            onClick={(event) => {
              if (mediaMode) {
                void onImportMedia?.(null);
                return;
              }
              const bounds = event.currentTarget.getBoundingClientRect();
              openInstancePicker(
                null,
                { x: bounds.left, y: bounds.bottom + 4 },
                event.currentTarget,
              );
            }}
            type="button"
            {...getTooltipTargetProps(
              mediaMode
                ? translate('projects.importMedia')
                : translate('projects.addInstance'),
              'bottom',
            )}
          >
            <MaskedIcon
              className="project-sidebar__tool-icon"
              icon={plusIcon}
            />
          </button>
        </div>
        </header>
        <ProjectSearchInput
        onChange={(query) => {
          setSearchQuery(query);
          setSelection(emptyProjectTreeSelection());
        }}
        searching={searching}
        skippedLockedCount={skippedLockedCount}
        translate={translate}
        value={searchQuery}
        />
        <div
        aria-busy={searching || undefined}
        className="project-sidebar__tree-scroll"
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          event.preventDefault();
          openBranchMenu(
            null,
            { x: event.clientX, y: event.clientY },
            event.currentTarget,
          );
        }}
        >
          <ProjectTree
          activeNodeId={activeNodeId}
          controller={controller}
          edit={edit}
          onCancelEdit={() => setEdit(undefined)}
          onMoveNode={(node, parentId, beforeNodeId) =>
            void moveByDrop(node, parentId, beforeNodeId)
          }
          onMoveNodes={(nodes, parentId, beforeNodeId) =>
            void moveSelectionByDrop(nodes, parentId, beforeNodeId)
          }
          onOpenNode={onOpenNode}
          onOpenNodes={onOpenNodes}
          onImportFiles={
            onImportMedia
              ? (files, parentId) => void onImportMedia(parentId, files)
              : undefined
          }
          onRequestInsertMedia={onInsertMedia}
          onRequestAddInstance={openInstancePicker}
          onRequestBranchMenu={openBranchMenu}
          {...(appearance
            ? {
                nodeSeeds: appearance.snapshot.noteSeeds,
                onRequestColor: (node, position, restoreFocus) => {
                  setColorPicker({
                    nodeId: node.nodeId,
                    position,
                    restoreFocus,
                  });
                },
              }
            : {})}
          onRequestCopySelection={(nodes) => {
            if (nodes.length === 1) {
              void performPathAction(onCopyPath, nodes[0]!.nodeId);
              return;
            }
            void onCopyPaths?.({
              nodeIds: nodes.map(({ nodeId }) => nodeId),
            }).then((result) => {
              if (result && !result.ok) {
                reportError(result.error.message);
              }
            });
          }}
          onRequestMove={setMovingNode}
          onRequestMoveSelection={setMovingNodes}
          onRequestProperties={onRequestProperties}
          onRequestRename={(node) => setEdit({ mode: 'rename', node })}
          onRequestTrash={(node) => void requestTrash(node)}
          onRequestTrashSelection={setTrashingNodes}
          onSelectionChange={setSelection}
          onSelectionLimitReached={() =>
            onNotice?.(translate('projects.selectionLimitReached'))
          }
          onSubmitEdit={(name) => void submitEdit(name)}
          operationPending={pending}
          projectId={project.projectId}
          searchNodeIds={searchNodeIds}
          searchPreviews={searchPreviews}
          searchQuery={appliedSearchQuery}
          selection={selection}
          translate={translate}
          />
        </div>
      </div>
      <footer className="project-sidebar__footer">
        <button
          aria-current={overviewActive ? 'page' : undefined}
          className="project-sidebar__project"
          onClick={onOpenOverview}
          type="button"
          {...getTooltipTargetProps(project.location, 'top')}
        >
          <TwemojiText text={project.name} />
        </button>
        <div className="project-sidebar__footer-actions">
          {appearance ? (
            <button
              aria-expanded={Boolean(projectColorPicker)}
              aria-haspopup="dialog"
              aria-label={translate('projects.projectColor')}
              className="project-sidebar__tool project-sidebar__color-tool"
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                setProjectColorPicker({
                  position: { x: bounds.left, y: bounds.top - 362 },
                  restoreFocus: event.currentTarget,
                });
              }}
              style={
                {
                  '--project-color':
                    appearance.snapshot.projectSeed ?? 'var(--color-accent)',
                } as CSSProperties
              }
              type="button"
              {...getTooltipTargetProps(
                translate('projects.projectColor'),
                'top',
              )}
            >
              <span aria-hidden="true" />
            </button>
          ) : null}
          <button
            aria-label={translate('menu.about')}
            className="project-sidebar__tool"
            disabled={!onOpenAbout}
            onClick={onOpenAbout}
            type="button"
            {...getTooltipTargetProps(translate('menu.about'), 'top')}
          >
            <MaskedIcon
              className="project-sidebar__tool-icon"
              icon={infoIcon}
            />
          </button>
          <button
            aria-current={settingsActive ? 'page' : undefined}
            aria-label={translate('pages.settings')}
            className="project-sidebar__tool"
            disabled={!onOpenSettings}
            onClick={onOpenSettings}
            type="button"
            {...getTooltipTargetProps(translate('pages.settings'), 'top')}
          >
            <MaskedIcon
              className="project-sidebar__tool-icon"
              icon={settingsIcon}
            />
          </button>
        </div>
      </footer>
      {branchMenu ? (
        <ContextMenu
          ariaLabel={translate('projects.branchActions')}
          items={branchMenuItems(branchMenu.parentId)}
          onAction={(action) => {
            handleBranchMenuAction(action, branchMenu);
            setBranchMenu(undefined);
          }}
          onClose={() => setBranchMenu(undefined)}
          x={branchMenu.position.x}
          y={branchMenu.position.y}
        />
      ) : null}
      {colorPicker && appearance ? (
        <NodeColorPopover
          nodeId={colorPicker.nodeId}
          onClose={() => setColorPicker(undefined)}
          onSelect={(seed) => {
            void appearance.setNoteSeed(colorPicker.nodeId, seed);
          }}
          position={colorPicker.position}
          restoreFocus={colorPicker.restoreFocus}
          seed={appearance.snapshot.noteSeeds[colorPicker.nodeId] ?? null}
          translate={translate}
        />
      ) : null}
      {projectColorPicker && appearance ? (
        <NodeColorPopover
          onClose={() => setProjectColorPicker(undefined)}
          onSelect={(seed) => {
            void appearance.setProjectSeed(seed);
          }}
          position={projectColorPicker.position}
          resetLabel={translate('projects.projectColorGlobal')}
          restoreFocus={projectColorPicker.restoreFocus}
          seed={appearance.snapshot.projectSeed}
          title={translate('projects.projectColor')}
          translate={translate}
        />
      ) : null}
      {instancePicker ? (
        <AddInstancePopover
          onClose={() => setInstancePicker(undefined)}
          onSelect={chooseInstance}
          parentId={instancePicker.parentId}
          position={instancePicker.position}
          restoreFocus={instancePicker.restoreFocus}
          translate={translate}
        />
      ) : null}
      {diagramTypePicker ? (
        <DiagramTypeDialog
          onCancel={() => setDiagramTypePicker(undefined)}
          onSelect={(diagramType) => {
            const parentId = diagramTypePicker.parentId;
            setDiagramTypePicker(undefined);
            void startCreate(parentId, 'page', 'diagram', diagramType);
          }}
          translate={translate}
        />
      ) : null}
      {movingNode ? (
        <MoveProjectNodeDialog
          controller={controller}
          node={movingNode}
          onCancel={() => setMovingNode(undefined)}
          onError={reportError}
          onMove={moveFromDialog}
          onMoved={(node) => {
            void refreshRelationships([movingNode.parentId, node.parentId]);
            setMovingNode(undefined);
            onNodeChanged?.(node);
          }}
          translate={translate}
        />
      ) : null}
      {movingNodes ? (
        <MoveProjectNodesDialog
          controller={controller}
          nodes={movingNodes}
          onCancel={() => setMovingNodes(undefined)}
          onError={reportError}
          onMove={moveSelectionFromDialog}
          onMoved={(nodes) => {
            void refreshRelationships([
              ...movingNodes.map((node) => node.parentId),
              ...nodes.map((node) => node.parentId),
            ]);
            setMovingNodes(undefined);
            setSelection(emptyProjectTreeSelection());
            for (const node of nodes) {
              onNodeChanged?.(node);
            }
          }}
          translate={translate}
        />
      ) : null}
      {trashingNode ? (
        <TrashProjectNodeDialog
          node={trashingNode}
          onCancel={() => setTrashingNode(undefined)}
          onTrash={trashFromDialog}
          onTrashed={(node) => {
            setTrashingNode(undefined);
            void refreshRelationships([node.parentId]);
            onNodeTrashed?.(node);
          }}
          translate={translate}
          warning={trashWarning}
        />
      ) : null}
      {trashingNodes ? (
        <TrashProjectNodesDialog
          nodes={trashingNodes}
          onCancel={() => setTrashingNodes(undefined)}
          onTrash={trashSelectionFromDialog}
          onTrashed={(nodes) => {
            setTrashingNodes(undefined);
            setSelection(emptyProjectTreeSelection());
            void refreshRelationships(
              nodes.map(({ parentId }) => parentId),
            );
            for (const node of nodes) {
              onNodeTrashed?.(node);
            }
          }}
          translate={translate}
        />
      ) : null}
    </aside>
  );
});
