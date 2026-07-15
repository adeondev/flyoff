import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';

import type {
  CreateProjectNodeRequest,
  ListProjectChildrenRequest,
  MoveProjectNodeRequest,
  ProjectResult,
  ProjectSummary,
  ProjectTreeNode,
  RenameProjectNodeRequest,
  TrashProjectNodeRequest,
  TrashProjectNodeOutcome,
} from '../../shared/contracts';
import { DropdownMenu, type MenuItem } from '../components/menu';
import type { Translate } from '../pages/page-types';
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
): ProjectTreeController {
  void projectId;
  return new ProjectTreeController(loadChildren);
}

const EMPTY_NODE_PATH: readonly string[] = [];

export interface ProjectSidebarProps {
  project: ProjectSummary;
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
  onOpenOverview: () => void;
  onCloseProject?: () => void;
  onOpenNode: (node: ProjectTreeNode) => void;
  onBeforeNodeChange?: (node: ProjectTreeNode) => Promise<boolean>;
  onCreateRequestHandled?: (id: number | string) => void;
  onNodeChanged?: (node: ProjectTreeNode) => void;
  onNodeTrashed?: (node: ProjectTreeNode) => void;
  onError?: (message: string) => void;
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

function createMenuItems(translate: Translate): readonly MenuItem[] {
  return [
    {
      id: 'new-note',
      kind: 'action',
      label: translate('projects.newNote'),
    },
    {
      id: 'new-folder',
      kind: 'action',
      label: translate('projects.newFolder'),
    },
  ];
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
  onCreateRequestHandled,
  onCreateNode,
  onError,
  onMoveNode,
  onNodeChanged,
  onNodeTrashed,
  onCloseProject,
  onOpenNode,
  onOpenOverview,
  onRenameNode,
  onTrashNode,
  overviewActive = false,
  project,
  translate,
}: ProjectSidebarProps, forwardedRef) {
  const controller = useMemo(
    () => createTreeController(project.projectId, loadChildren),
    [loadChildren, project.projectId],
  );
  const [edit, setEdit] = useState<ProjectTreeInlineEdit>();
  const [movingNode, setMovingNode] = useState<ProjectTreeNode>();
  const [trashingNode, setTrashingNode] = useState<ProjectTreeNode>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

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
    setError(message);
    onError?.(message);
  }

  async function allowNodeChange(node: ProjectTreeNode): Promise<boolean> {
    return onBeforeNodeChange ? onBeforeNodeChange(node) : true;
  }

  const startCreate = useCallback(
    async (
      parentId: string | null,
      kind: ProjectTreeNode['kind'],
    ): Promise<void> => {
      setError(undefined);
      if (parentId) {
        await controller.setExpanded(parentId, true);
      }
      setEdit({ mode: 'create', parentId, kind });
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
    setError(undefined);
    try {
      if (edit.mode === 'create') {
        const result = await onCreateNode(
          edit.kind === 'folder'
            ? { kind: 'folder', name: requestName, parentId: edit.parentId }
            : {
                kind: 'page',
                name: requestName,
                pageType: 'markdown',
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
  ): Promise<void> {
    if (pending || !(await allowNodeChange(node))) {
      return;
    }

    setPending(true);
    setError(undefined);
    try {
      const result = await onMoveNode({ nodeId: node.nodeId, parentId });
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

  const addItems = createMenuItems(translate);

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
          title={project.location}
          type="button"
        >
          <span className="project-sidebar__project-mark" aria-hidden="true" />
          <span>{project.name}</span>
        </button>
        <div className="project-sidebar__tools">
          <button
            aria-label={translate('projects.closeProject')}
            className="project-sidebar__tool"
            disabled={!onCloseProject || pending}
            onClick={onCloseProject}
            title={translate('projects.closeProject')}
            type="button"
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            aria-label={translate('projects.refresh')}
            className="project-sidebar__tool"
            disabled={pending}
            onClick={() => void controller.refreshLoaded()}
            title={translate('projects.refresh')}
            type="button"
          >
            <span aria-hidden="true">↻</span>
          </button>
          <DropdownMenu
            items={addItems}
            onAction={(action) => {
              void startCreate(null, action === 'new-folder' ? 'folder' : 'page');
            }}
            trigger={(props) => (
              <button
                {...props}
                aria-label={translate('projects.add')}
                className="project-sidebar__tool"
                disabled={pending}
                title={translate('projects.add')}
                type="button"
              >
                <span aria-hidden="true">+</span>
              </button>
            )}
          />
        </div>
      </header>
      {error ? (
        <div className="project-sidebar__error" role="alert">
          <span>{error}</span>
          <button
            aria-label={translate('projects.cancel')}
            onClick={() => setError(undefined)}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}
      <div className="project-sidebar__tree-scroll">
        <ProjectTree
          activeNodeId={activeNodeId}
          controller={controller}
          edit={edit}
          onCancelEdit={() => setEdit(undefined)}
          onMoveNode={(node, parentId) => void moveByDrop(node, parentId)}
          onOpenNode={onOpenNode}
          onRequestCreate={(parentId, kind) => void startCreate(parentId, kind)}
          onRequestMove={setMovingNode}
          onRequestRename={(node) => setEdit({ mode: 'rename', node })}
          onRequestTrash={setTrashingNode}
          onSubmitEdit={(name) => void submitEdit(name)}
          operationPending={pending}
          translate={translate}
        />
      </div>
      {movingNode ? (
        <MoveProjectNodeDialog
          controller={controller}
          node={movingNode}
          onCancel={() => setMovingNode(undefined)}
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
