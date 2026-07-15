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
  onRequestCreate: (
    parentId: string | null,
    kind: ProjectTreeNode['kind'],
  ) => void;
  onRequestMove: (node: ProjectTreeNode) => void;
  onRequestRename: (node: ProjectTreeNode) => void;
  onRequestTrash: (node: ProjectTreeNode) => void;
  onSubmitEdit: (name: string) => void;
  onMoveNode: (node: ProjectTreeNode, parentId: string | null) => void;
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
            id: 'new-note',
            kind: 'action',
            label: translate('projects.newNote'),
          },
          {
            id: 'new-folder',
            kind: 'action',
            label: translate('projects.newFolder'),
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

  return (
    <form
      className="project-tree__inline-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) {
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
  onRequestCreate,
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
  const [dropTargetId, setDropTargetId] = useState<string | null>();
  const [contextMenu, setContextMenu] = useState<{
    node: ProjectTreeNode;
    x: number;
    y: number;
  } | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const menuRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => controller.subscribe(renderVersion), [controller]);
  useEffect(() => {
    void controller.load(null);
  }, [controller]);

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

  function handleMenuAction(node: ProjectTreeNode, action: string): void {
    switch (action) {
      case 'new-note':
        onRequestCreate(node.nodeId, 'page');
        return;
      case 'new-folder':
        onRequestCreate(node.nodeId, 'folder');
        return;
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
    setDraggedNodeId(undefined);
    setDropTargetId(undefined);
  }

  function dropOn(parentId: string | null): void {
    const dragged = draggedNodeId
      ? controller.findNode(draggedNodeId)
      : undefined;
    if (dragged && dragged.nodeId !== parentId && dragged.parentId !== parentId) {
      onMoveNode(dragged, parentId);
    }
    finishDrag();
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
                  dropTargetId === node.nodeId ? ' project-tree__item--drop' : ''
                }`}
                draggable={!renameEdit && !operationPending}
                onDoubleClick={() => onRequestRename(node)}
                onDragEnd={() => finishDrag()}
                onDragOver={(event) => {
                  if (node.kind === 'folder' && draggedNodeId !== node.nodeId) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropTargetId(node.nodeId);
                  }
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', node.nodeId);
                  setDraggedNodeId(node.nodeId);
                }}
                onDrop={(event) => {
                  if (node.kind === 'folder') {
                    event.preventDefault();
                    event.stopPropagation();
                    dropOn(node.nodeId);
                  }
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
                <div role="group">
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
        {branch.status === 'loaded' &&
        branch.nodes.length === 0 &&
        !createEdit ? (
          <div className="project-tree__message">{translate('projects.empty')}</div>
        ) : null}
      </>
    );
  }

  return (
    <div
      aria-label={translate('projects.navigation')}
      className={`project-tree${dropTargetId === null ? ' project-tree--drop-root' : ''}`}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropTargetId(undefined);
        }
      }}
      onDragOver={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          setDropTargetId(null);
        }
      }}
      onDrop={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          dropOn(null);
        }
      }}
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
            handleMenuAction(contextMenu.node, action);
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
