import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';

import arrowLeftIcon from '../../../public/images/icons/actions/arrow-left.svg';
import plusIcon from '../../../public/images/icons/actions/plus.svg';
import refreshIcon from '../../../public/images/icons/actions/refresh.svg';
import projectIcon from '../../../public/images/icons/instances/project.svg';
import type {
  CreateProjectNodeRequest,
  FlyoffPlatform,
  ListProjectChildrenRequest,
  MoveProjectNodeRequest,
  ProjectResult,
  ProjectSummary,
  ProjectTreeNode,
  ProjectPathRequest,
  ProjectPageNode,
  RenameProjectNodeRequest,
  TrashProjectNodeRequest,
  TrashProjectNodeOutcome,
} from '../../shared/contracts';
import { MaskedIcon } from '../components/MaskedIcon';
import { ContextMenu, type MenuItem } from '../components/menu';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import {
  AddInstancePopover,
  type AddInstanceChoice,
} from './AddInstancePopover';
import { MoveProjectNodeDialog } from './MoveProjectNodeDialog';
import { projectNodeInputName } from './project-node-name';
import { ProjectTree, type ProjectTreeInlineEdit } from './ProjectTree';
import {
  ProjectTreeController,
  type ProjectChildrenLoader,
} from './project-tree-controller';
import { TrashProjectNodeDialog } from './TrashProjectNodeDialog';

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

export interface ProjectSidebarProps {
  project: ProjectSummary;
  platform?: FlyoffPlatform;
  hidden?: boolean;
  translate: Translate;
  activeNodeId?: string;
  activeNodePath?: readonly string[];
  overviewActive?: boolean;
  createRequest?: ProjectSidebarCreateRequest;
  loadChildren: (
    request: ListProjectChildrenRequest,
  ) => Promise<ProjectResult<readonly ProjectTreeNode[]>>;
  onCreateNode: (
    request: CreateProjectNodeRequest,
  ) => Promise<ProjectResult<ProjectTreeNode>>;
  onRenameNode: (
    request: RenameProjectNodeRequest,
  ) => Promise<ProjectResult<ProjectTreeNode>>;
  onMoveNode: (
    request: MoveProjectNodeRequest,
  ) => Promise<ProjectResult<ProjectTreeNode>>;
  onTrashNode: (
    request: TrashProjectNodeRequest,
  ) => Promise<ProjectResult<TrashProjectNodeOutcome>>;
  onCopyPath?: (
    request: ProjectPathRequest,
  ) => Promise<ProjectResult<null>>;
  onRevealPath?: (
    request: ProjectPathRequest,
  ) => Promise<ProjectResult<null>>;
  onOpenOverview: () => void;
  onCloseProject?: () => void;
  onOpenNode: (node: ProjectTreeNode) => void;
  onRequestProperties?: (node: ProjectPageNode) => void;
  onBeforeNodeChange?: (node: ProjectTreeNode) => Promise<boolean>;
  onCreateRequestHandled?: (id: number | string) => void;
  onNodeChanged?: (node: ProjectTreeNode) => void;
  onNodeTrashed?: (node: ProjectTreeNode) => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
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
  loadChildren,
  onBeforeNodeChange,
  onCopyPath,
  onCreateRequestHandled,
  onCreateNode,
  onError,
  onMoveNode,
  onNodeChanged,
  onNodeTrashed,
  onCloseProject,
  onOpenNode,
  onOpenOverview,
  onRequestProperties,
  onRevealPath,
  onRenameNode,
  onTrashNode,
  onNotice,
  overviewActive = false,
  platform,
  project,
  translate,
}: ProjectSidebarProps, forwardedRef) {
  const controller = useMemo(
    () => createTreeController(project.projectId, loadChildren, onError),
    [loadChildren, onError, project.projectId],
  );
  const [edit, setEdit] = useState<ProjectTreeInlineEdit>();
  const [movingNode, setMovingNode] = useState<ProjectTreeNode>();
  const [trashingNode, setTrashingNode] = useState<ProjectTreeNode>();
  const [pending, setPending] = useState(false);
  const [instancePicker, setInstancePicker] = useState<{
    parentId: string | null;
    position: { x: number; y: number };
    restoreFocus?: HTMLElement | null;
  }>();
  const [branchMenu, setBranchMenu] = useState<{
    parentId: string | null;
    position: { x: number; y: number };
    restoreFocus?: HTMLElement | null;
  }>();

  useEffect(() => () => controller.dispose(), [controller]);
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

  const startCreate = useCallback(
    async (
      parentId: string | null,
      kind: ProjectTreeNode['kind'],
      pageType?: string,
    ): Promise<void> => {
      if (parentId) {
        await controller.setExpanded(parentId, true);
      }
      setEdit({ mode: 'create', parentId, kind, pageType });
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
        const result = await onCreateNode(
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
        await controller.refreshParents([edit.parentId]);
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
      await controller.refreshParents([edit.node.parentId]);
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
      await controller.refreshParents([node.parentId, parentId]);
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
      {
        id: 'new-instance',
        kind: 'action',
        label: translate('projects.newInstance'),
        disabled: pending,
      },
      {
        id: 'new-folder',
        kind: 'action',
        label: translate('projects.newFolder'),
        disabled: pending,
      },
      { id: 'create-separator', kind: 'separator' },
      {
        id: 'expand-all',
        kind: 'action',
        label: translate('projects.expandAll'),
        disabled: pending || !controller.canExpandBranch(parentId),
      },
      {
        id: 'collapse-all',
        kind: 'action',
        label: translate('projects.collapseAll'),
        disabled: pending || !controller.canCollapseBranch(parentId),
      },
      { id: 'path-separator', kind: 'separator' },
      {
        id: 'reveal-path',
        kind: 'action',
        label: fileManagerLabel(platform, translate),
        disabled: !onRevealPath,
      },
      {
        id: 'copy-path',
        kind: 'action',
        label: translate('projects.copyPath'),
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
      <header className="project-sidebar__header">
        <button
          aria-current={overviewActive ? 'page' : undefined}
          className="project-sidebar__project"
          onClick={onOpenOverview}
          type="button"
          {...getTooltipTargetProps(project.location, 'right')}
        >
          <MaskedIcon
            className="project-sidebar__project-mark"
            icon={projectIcon}
          />
          <span>{project.name}</span>
        </button>
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
            aria-expanded={Boolean(instancePicker)}
            aria-haspopup="dialog"
            aria-label={translate('projects.addInstance')}
            className="project-sidebar__tool"
            disabled={pending}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              openInstancePicker(
                null,
                { x: bounds.left, y: bounds.bottom + 4 },
                event.currentTarget,
              );
            }}
            type="button"
            {...getTooltipTargetProps(
              translate('projects.addInstance'),
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
      <div
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
          onOpenNode={onOpenNode}
          onRequestAddInstance={openInstancePicker}
          onRequestBranchMenu={openBranchMenu}
          onRequestMove={setMovingNode}
          onRequestProperties={onRequestProperties}
          onRequestRename={(node) => setEdit({ mode: 'rename', node })}
          onRequestTrash={setTrashingNode}
          onSubmitEdit={(name) => void submitEdit(name)}
          operationPending={pending}
          translate={translate}
        />
      </div>
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
      {movingNode ? (
        <MoveProjectNodeDialog
          controller={controller}
          node={movingNode}
          onCancel={() => setMovingNode(undefined)}
          onError={reportError}
          onMove={moveFromDialog}
          onMoved={(node) => {
            setMovingNode(undefined);
            onNodeChanged?.(node);
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
            void controller.refreshParents([node.parentId]);
            onNodeTrashed?.(node);
          }}
          translate={translate}
        />
      ) : null}
    </aside>
  );
});
