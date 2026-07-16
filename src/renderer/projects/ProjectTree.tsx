import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';

import type { ProjectTreeNode } from '../../shared/contracts';
import { ContextMenu, DropdownMenu, type MenuItem } from '../components/menu';
import type { Translate } from '../pages/page-types';
import { projectNodeDisplayName } from './project-node-name';
import type { ProjectTreeController } from './project-tree-controller';

export type ProjectTreeInlineEdit =
  | {
      mode: 'create';
      parentId: string | null;
      kind: ProjectTreeNode['kind'];
      pageType?: string;
    }
  | { mode: 'rename'; node: ProjectTreeNode };

export interface ProjectTreeProps {
  controller: ProjectTreeController;
  translate: Translate;
  activeNodeId?: string;
  edit?: ProjectTreeInlineEdit;
  operationPending?: boolean;
  onCancelEdit: () => void;
  onOpenNode: (node: ProjectTreeNode) => void;
  onRequestAddInstance: (
    parentId: string | null,
    position: { x: number; y: number },
    restoreFocus?: HTMLElement | null,
  ) => void;
  onRequestMove: (node: ProjectTreeNode) => void;
  onRequestRename: (node: ProjectTreeNode) => void;
  onRequestTrash: (node: ProjectTreeNode) => void;
  onSubmitEdit: (name: string) => void;
  onMoveNode: (
    node: ProjectTreeNode,
    parentId: string | null,
    beforeNodeId?: string | null,
  ) => void;
}

interface ProjectTreeDropTarget {
  nodeId: string | null;
  edge: 'before' | 'inside' | 'after';
}

interface VisibleNode {
  node: ProjectTreeNode;
  depth: number;
  parentId: string | null;
}

function collectVisibleNodes(
  controller: ProjectTreeController,
  parentId: string | null = null,
  depth = 1,
  result: VisibleNode[] = [],
): VisibleNode[] {
  for (const node of controller.getBranch(parentId).nodes) {
    result.push({ node, depth, parentId });
    if (node.kind === 'folder' && controller.isExpanded(node.nodeId)) {
      collectVisibleNodes(controller, node.nodeId, depth + 1, result);
    }
  }
  return result;
}

function nodeMenuItems(
  node: ProjectTreeNode,
  translate: Translate,
): readonly MenuItem[] {
  return [
    ...(node.kind === 'folder'
      ? ([
          {
            id: 'add-instance',
            kind: 'action',
            label: translate('projects.addInstance'),
          },
          { id: 'create-separator', kind: 'separator' },
        ] satisfies MenuItem[])
      : []),
    {
      id: 'rename',
      kind: 'action',
      label: translate('projects.rename'),
    },
    {
      id: 'move',
      kind: 'action',
      label: translate('projects.moveTo'),
    },
    { id: 'trash-separator', kind: 'separator' },
    {
      id: 'trash',
      kind: 'action',
      label: translate('projects.trash'),
      tone: 'danger',
    },
  ];
}

function ProjectTreeChevron({
  expanded,
  kind,
}: {
  expanded?: boolean;
  kind: ProjectTreeNode['kind'];
}) {
  return (
    <span
      aria-hidden="true"
      className={`project-tree__chevron${
        kind === 'folder' ? '' : ' project-tree__chevron--empty'
      }${expanded ? ' project-tree__chevron--expanded' : ''}`}
    >
      {'›'}
    </span>
  );
}

interface InlineEditorProps {
  kind: ProjectTreeNode['kind'];
  initialValue?: string;
  pending: boolean;
  translate: Translate;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

function InlineEditor({
  initialValue = '',
  kind,
  onCancel,
  onSubmit,
  pending,
  translate,
}: InlineEditorProps) {
  const [value, setValue] = useState(initialValue);
  const submittingRef = useRef(false);
  const observedPendingRef = useRef(false);

  useEffect(() => {
    if (pending && submittingRef.current) {
      observedPendingRef.current = true;
    } else if (!pending && observedPendingRef.current) {
      submittingRef.current = false;
      observedPendingRef.current = false;
    }
  }, [pending]);

  return (
    <form
      className="project-tree__inline-editor"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (
          !submittingRef.current &&
          (!(next instanceof Node) || !event.currentTarget.contains(next))
        ) {
          onCancel();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) {
          submittingRef.current = true;
          onSubmit(value);
        }
      }}
    >
      <input
        aria-label={translate('projects.name')}
        autoFocus
        disabled={pending}
        maxLength={100}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        value={value}
      />
      {kind === 'page' ? (
        <span aria-label={translate('projects.markdownExtension')}>.md</span>
      ) : null}
    </form>
  );
}

export function ProjectTree({
  activeNodeId,
  controller,
  edit,
  onCancelEdit,
  onMoveNode,
  onOpenNode,
  onRequestAddInstance,
  onRequestMove,
  onRequestRename,
  onRequestTrash,
  onSubmitEdit,
  operationPending = false,
  translate,
}: ProjectTreeProps) {
  const [, renderVersion] = useReducer((version: number) => version + 1, 0);
  const [focusedNodeId, setFocusedNodeId] = useState<string>();
  const [draggedNodeId, setDraggedNodeId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<ProjectTreeDropTarget>();
  const [contextMenu, setContextMenu] = useState<{
    node: ProjectTreeNode;
    x: number;
    y: number;
  } | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const menuRefs = useRef(new Map<string, HTMLButtonElement>());
  const expandTimerRef = useRef<number | undefined>(undefined);
  const dropTargetRef = useRef<ProjectTreeDropTarget | undefined>(undefined);

  useEffect(() => controller.subscribe(renderVersion), [controller]);
  useEffect(() => {
    void controller.load(null);
  }, [controller]);
  useEffect(
    () => () => {
      if (expandTimerRef.current !== undefined) {
        window.clearTimeout(expandTimerRef.current);
      }
    },
    [],
  );

  const visibleNodes = collectVisibleNodes(controller);
  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map(({ node }) => node.nodeId)),
    [visibleNodes],
  );
  const effectiveFocusId =
    (focusedNodeId && visibleNodeIds.has(focusedNodeId)
      ? focusedNodeId
      : activeNodeId && visibleNodeIds.has(activeNodeId)
        ? activeNodeId
        : visibleNodes[0]?.node.nodeId) ?? undefined;

  function focusNode(nodeId: string | undefined): void {
    if (!nodeId) {
      return;
    }
    setFocusedNodeId(nodeId);
    requestAnimationFrame(() => itemRefs.current.get(nodeId)?.focus());
  }

  function handleNodeKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    visible: VisibleNode,
  ): void {
    if (event.defaultPrevented) {
      return;
    }

    const index = visibleNodes.findIndex(
      ({ node }) => node.nodeId === visible.node.nodeId,
    );

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const siblings = controller.getBranch(visible.parentId).nodes;
      const siblingIndex = siblings.findIndex(
        ({ nodeId }) => nodeId === visible.node.nodeId,
      );
      const beforeNodeId =
        event.key === 'ArrowUp'
          ? siblings[siblingIndex - 1]?.nodeId
          : siblings[siblingIndex + 2]?.nodeId ?? null;
      if (
        siblingIndex >= 0 &&
        ((event.key === 'ArrowUp' && siblingIndex > 0) ||
          (event.key === 'ArrowDown' && siblingIndex < siblings.length - 1))
      ) {
        event.preventDefault();
        onMoveNode(visible.node, visible.parentId, beforeNodeId);
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusNode(visibleNodes[index + 1]?.node.nodeId);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusNode(visibleNodes[index - 1]?.node.nodeId);
        return;
      case 'Home':
        event.preventDefault();
        focusNode(visibleNodes[0]?.node.nodeId);
        return;
      case 'End':
        event.preventDefault();
        focusNode(visibleNodes.at(-1)?.node.nodeId);
        return;
      case 'ArrowRight':
        if (visible.node.kind !== 'folder') {
          return;
        }
        event.preventDefault();
        if (!controller.isExpanded(visible.node.nodeId)) {
          void controller.setExpanded(visible.node.nodeId, true);
        } else {
          focusNode(visibleNodes[index + 1]?.node.nodeId);
        }
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (
          visible.node.kind === 'folder' &&
          controller.isExpanded(visible.node.nodeId)
        ) {
          void controller.setExpanded(visible.node.nodeId, false);
        } else {
          focusNode(visible.parentId ?? undefined);
        }
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (visible.node.kind === 'folder') {
          void controller.toggle(visible.node.nodeId);
        } else {
          onOpenNode(visible.node);
        }
        return;
      case 'F2':
        event.preventDefault();
        onRequestRename(visible.node);
        return;
      case 'Delete':
        event.preventDefault();
        onRequestTrash(visible.node);
        return;
      case 'F10':
        if (event.shiftKey) {
          event.preventDefault();
          const menu = menuRefs.current.get(visible.node.nodeId);
          menu?.focus();
          menu?.dispatchEvent(
            new window.KeyboardEvent('keydown', {
              bubbles: true,
              key: 'Enter',
            }),
          );
        }
        return;
      default:
        return;
    }
  }

  function handleMenuAction(
    node: ProjectTreeNode,
    action: string,
    position?: { x: number; y: number },
  ): void {
    switch (action) {
      case 'add-instance': {
        const trigger = menuRefs.current.get(node.nodeId);
        const bounds = trigger?.getBoundingClientRect();
        onRequestAddInstance(
          node.nodeId,
          position ?? (bounds
            ? { x: bounds.left, y: bounds.bottom + 4 }
            : { x: 16, y: 16 }),
          trigger,
        );
        return;
      }
      case 'rename':
        onRequestRename(node);
        return;
      case 'move':
        onRequestMove(node);
        return;
      case 'trash':
        onRequestTrash(node);
        return;
      default:
        return;
    }
  }

  function finishDrag(event?: DragEvent<HTMLElement>): void {
    event?.preventDefault();
    if (expandTimerRef.current !== undefined) {
      window.clearTimeout(expandTimerRef.current);
      expandTimerRef.current = undefined;
    }
    setDraggedNodeId(undefined);
    dropTargetRef.current = undefined;
    setDropTarget(undefined);
  }

  function dropOn(
    parentId: string | null,
    beforeNodeId?: string | null,
  ): void {
    const dragged = draggedNodeId
      ? controller.findNode(draggedNodeId)
      : undefined;
    if (dragged && dragged.nodeId !== parentId) {
      onMoveNode(dragged, parentId, beforeNodeId);
    }
    finishDrag();
  }

  function updateDropTarget(
    next: ProjectTreeDropTarget,
    folder?: ProjectTreeNode,
  ): void {
    if (
      dropTargetRef.current?.nodeId === next.nodeId &&
      dropTargetRef.current.edge === next.edge
    ) {
      return;
    }
    dropTargetRef.current = next;
    setDropTarget(next);
    if (expandTimerRef.current !== undefined) {
      window.clearTimeout(expandTimerRef.current);
      expandTimerRef.current = undefined;
    }
    if (
      next.edge === 'inside' &&
      folder?.kind === 'folder' &&
      !controller.isExpanded(folder.nodeId)
    ) {
      expandTimerRef.current = window.setTimeout(() => {
        expandTimerRef.current = undefined;
        void controller.setExpanded(folder.nodeId, true);
      }, 600);
    }
  }

  function renderBranch(parentId: string | null, depth: number): React.ReactNode {
    const branch = controller.getBranch(parentId);
    const createEdit =
      edit?.mode === 'create' && edit.parentId === parentId ? edit : undefined;

    return (
      <>
        {branch.nodes.map((node, siblingIndex) => {
          const expanded =
            node.kind === 'folder' ? controller.isExpanded(node.nodeId) : undefined;
          const renameEdit =
            edit?.mode === 'rename' && edit.node.nodeId === node.nodeId
              ? edit
              : undefined;

          return (
            <div key={node.nodeId}>
              <div
                aria-expanded={expanded}
                aria-level={depth}
                aria-posinset={siblingIndex + 1}
                aria-selected={activeNodeId === node.nodeId}
                aria-setsize={branch.nodes.length}
                className={`project-tree__item${
                  activeNodeId === node.nodeId ? ' project-tree__item--active' : ''
                }${
                  contextMenu?.node.nodeId === node.nodeId
                    ? ' project-tree__item--context'
                    : ''
                }${
                  dropTarget?.nodeId === node.nodeId
                    ? ` project-tree__item--drop-${dropTarget.edge}`
                    : ''
                }`}
                draggable={!renameEdit && !operationPending}
                onDoubleClick={() => onRequestRename(node)}
                onDragEnd={() => finishDrag()}
                onDragOver={(event) => {
                  if (!draggedNodeId || draggedNodeId === node.nodeId) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = 'move';
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const ratio = bounds.height > 0
                    ? (event.clientY - bounds.top) / bounds.height
                    : 0.5;
                  const edge =
                    node.kind === 'folder' && ratio >= 0.28 && ratio <= 0.72
                      ? 'inside'
                      : ratio < 0.5
                        ? 'before'
                        : 'after';
                  updateDropTarget({ nodeId: node.nodeId, edge }, node);
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', node.nodeId);
                  setDraggedNodeId(node.nodeId);
                }}
                onDrop={(event) => {
                  if (!dropTarget || dropTarget.nodeId !== node.nodeId) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  if (dropTarget.edge === 'inside' && node.kind === 'folder') {
                    dropOn(node.nodeId);
                    return;
                  }
                  const siblings = controller
                    .getBranch(parentId)
                    .nodes.filter(({ nodeId }) => nodeId !== draggedNodeId);
                  const siblingIndex = siblings.findIndex(
                    ({ nodeId }) => nodeId === node.nodeId,
                  );
                  const beforeNodeId =
                    dropTarget.edge === 'before'
                      ? node.nodeId
                      : siblings[siblingIndex + 1]?.nodeId ?? null;
                  dropOn(parentId, beforeNodeId);
                }}
                onContextMenu={(event) => {
                  if (renameEdit) {
                    return;
                  }
                  event.preventDefault();
                  setFocusedNodeId(node.nodeId);
                  setContextMenu({
                    node,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onFocus={() => setFocusedNodeId(node.nodeId)}
                onKeyDown={(event) =>
                  handleNodeKeyDown(event, { node, depth, parentId })
                }
                ref={(element) => {
                  if (element) {
                    itemRefs.current.set(node.nodeId, element);
                  } else {
                    itemRefs.current.delete(node.nodeId);
                  }
                }}
                role="treeitem"
                style={{ '--project-tree-depth': depth } as React.CSSProperties}
                tabIndex={effectiveFocusId === node.nodeId ? 0 : -1}
              >
                {renameEdit ? (
                  <div className="project-tree__node">
                    <ProjectTreeChevron expanded={expanded} kind={node.kind} />
                    <span
                      aria-hidden="true"
                      className={`project-tree__kind project-tree__kind--${node.kind}`}
                    />
                    <InlineEditor
                      initialValue={projectNodeDisplayName(node)}
                      kind={node.kind}
                      onCancel={onCancelEdit}
                      onSubmit={onSubmitEdit}
                      pending={operationPending}
                      translate={translate}
                    />
                  </div>
                ) : (
                  <button
                    aria-label={projectNodeDisplayName(node)}
                    className="project-tree__node"
                    onClick={() => {
                      if (node.kind === 'folder') {
                        void controller.toggle(node.nodeId);
                      } else {
                        onOpenNode(node);
                      }
                    }}
                    tabIndex={-1}
                    type="button"
                  >
                  <ProjectTreeChevron expanded={expanded} kind={node.kind} />
                  <span
                    aria-hidden="true"
                    className={`project-tree__kind project-tree__kind--${node.kind}`}
                  />
                    <span className="project-tree__label">
                      {projectNodeDisplayName(node)}
                    </span>
                  </button>
                )}
                {!renameEdit ? (
                  <DropdownMenu
                    items={nodeMenuItems(node, translate)}
                    onAction={(action) => handleMenuAction(node, action)}
                    trigger={(props) => (
                      <button
                        {...props}
                        aria-label={`${translate('projects.moreActions')}: ${projectNodeDisplayName(node)}`}
                        className="project-tree__menu-trigger"
                        ref={(element) => {
                          props.ref(element);
                          if (element) {
                            menuRefs.current.set(node.nodeId, element as HTMLButtonElement);
                          } else {
                            menuRefs.current.delete(node.nodeId);
                          }
                        }}
                        tabIndex={-1}
                        type="button"
                      >
                        <span aria-hidden="true">•••</span>
                      </button>
                    )}
                  />
                ) : null}
              </div>
              {node.kind === 'folder' && expanded ? (
                <div
                  data-project-parent-id={node.nodeId}
                  onDragOver={(event) => {
                    if (event.target === event.currentTarget && draggedNodeId) {
                      event.preventDefault();
                      event.stopPropagation();
                      updateDropTarget({ nodeId: node.nodeId, edge: 'inside' }, node);
                    }
                  }}
                  onDrop={(event) => {
                    if (event.target === event.currentTarget && draggedNodeId) {
                      event.preventDefault();
                      event.stopPropagation();
                      dropOn(node.nodeId, null);
                    }
                  }}
                  role="group"
                >
                  {renderBranch(node.nodeId, depth + 1)}
                </div>
              ) : null}
            </div>
          );
        })}
        {createEdit ? (
          <div
            className="project-tree__item project-tree__item--editing"
            role="treeitem"
            style={{ '--project-tree-depth': depth } as React.CSSProperties}
          >
            <span aria-hidden="true" className="project-tree__chevron project-tree__chevron--empty" />
            <span
              aria-hidden="true"
              className={`project-tree__kind project-tree__kind--${createEdit.kind}`}
            />
            <InlineEditor
              kind={createEdit.kind}
              onCancel={onCancelEdit}
              onSubmit={onSubmitEdit}
              pending={operationPending}
              translate={translate}
            />
          </div>
        ) : null}
        {branch.status === 'loading' && branch.nodes.length === 0 ? (
          <div className="project-tree__message" role="status">
            {translate('projects.loading')}
          </div>
        ) : null}
        {branch.status === 'error' ? (
          <button
            className="project-tree__message project-tree__retry"
            onClick={() => void controller.load(parentId, true)}
            type="button"
          >
            {translate('projects.loadFailed')}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div
      aria-label={translate('projects.navigation')}
      className={`project-tree${dropTarget?.nodeId === null ? ' project-tree--drop-root' : ''}`}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropTarget(undefined);
          dropTargetRef.current = undefined;
        }
      }}
      onDragOver={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          updateDropTarget({ nodeId: null, edge: 'inside' });
        }
      }}
      onDrop={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          dropOn(null, null);
        }
      }}
      onContextMenu={(event) => {
        if ((event.target as Element).closest('.project-tree__item')) {
          return;
        }
        event.preventDefault();
        const branch = (event.target as Element).closest<HTMLElement>(
          '[data-project-parent-id]',
        );
        onRequestAddInstance(
          branch?.dataset.projectParentId || null,
          { x: event.clientX, y: event.clientY },
          event.currentTarget,
        );
      }}
      data-project-parent-id=""
      role="tree"
    >
      {renderBranch(null, 1)}
      {contextMenu ? (
        <ContextMenu
          ariaLabel={`${translate('projects.moreActions')}: ${projectNodeDisplayName(
            contextMenu.node,
          )}`}
          items={nodeMenuItems(contextMenu.node, translate)}
          onAction={(action) => {
            handleMenuAction(contextMenu.node, action, {
              x: contextMenu.x,
              y: contextMenu.y,
            });
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      ) : null}
    </div>
  );
}
