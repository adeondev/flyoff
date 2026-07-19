import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';

import chevronRightIcon from '../../../public/images/icons/actions/chevron-right.svg';
import ellipsisIcon from '../../../public/images/icons/actions/ellipsis.svg';
import fileIcon from '../../../public/images/icons/instances/file-solid.svg';
import folderOpenIcon from '../../../public/images/icons/instances/folder-open-solid.svg';
import folderIcon from '../../../public/images/icons/instances/folder-solid.svg';
import plusIcon from '../../../public/images/icons/actions/plus.svg';
import settingsIcon from '../../../public/images/icons/actions/settings-outline.svg';
import type {
  ProjectPageNode,
  ProjectSearchPreview,
  ProjectTreeNode,
} from '../../shared/contracts';
import {
  normalizeProjectSearchText,
  parseProjectSearchQuery,
} from '../../shared/project-search';
import { MaskedIcon } from '../components/MaskedIcon';
import { ContextMenu, DropdownMenu, type MenuItem } from '../components/menu';
import {
  beginWorkspaceProjectNodePointerDrag,
  setWorkspaceDragActive,
  writeWorkspaceProjectNodeDrag,
} from '../components/tabs/workspace-drag';
import type { Translate } from '../pages/page-types';
import { useFlyoffPreferences } from '../preferences';
import { getProjectPageTypeDefinition } from './project-page-type-registry';
import { projectNodeDisplayName } from './project-node-name';
import type { ProjectTreeController } from './project-tree-controller';

const PROJECT_TREE_NODE_DRAG_TYPE =
  'application/x-flyoff-project-tree-node';

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
  projectId?: string;
  translate: Translate;
  searchQuery?: string;
  searchNodeIds?: ReadonlySet<string>;
  searchPreviews?: ReadonlyMap<string, ProjectSearchPreview>;
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
  onRequestBranchMenu: (
    parentId: string | null,
    position: { x: number; y: number },
    restoreFocus?: HTMLElement | null,
  ) => void;
  onRequestMove: (node: ProjectTreeNode) => void;
  onRequestProperties?: (node: ProjectPageNode) => void;
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
  searchQuery = '',
  parentId: string | null = null,
  depth = 1,
  result: VisibleNode[] = [],
  searchMatches?: ReadonlySet<string>,
): VisibleNode[] {
  const normalizedQuery = normalizeSearchQuery(searchQuery);
  for (const node of controller.getBranch(parentId).nodes) {
    const descendantNodes =
      node.kind === 'folder'
        ? collectVisibleNodes(
            controller,
            searchQuery,
            node.nodeId,
            depth + 1,
            [],
            searchMatches,
          )
        : [];
    if (
      normalizedQuery &&
      !(searchMatches
        ? searchMatches.has(node.nodeId)
        : normalizeSearchQuery(projectNodeDisplayName(node)).includes(
            normalizedQuery,
          )) &&
      descendantNodes.length === 0
    ) {
      continue;
    }
    result.push({ node, depth, parentId });
    if (
      node.kind === 'folder' &&
      (normalizedQuery || controller.isExpanded(node.nodeId))
    ) {
      result.push(...descendantNodes);
    }
  }
  return result;
}

function normalizeSearchQuery(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLocaleLowerCase();
}

function contentSearchTerms(query: string): readonly string[] {
  return [
    ...new Set(
      parseProjectSearchQuery(query).flatMap((clause) => {
        if (clause.kind === 'path' || clause.kind === 'file') {
          return [];
        }
        return clause.kind === 'property'
          ? [clause.name, ...clause.terms]
          : clause.terms;
      }),
    ),
  ];
}

interface SearchHighlightRange {
  end: number;
  start: number;
}

function searchHighlightRanges(
  excerpt: string,
  terms: readonly string[],
): readonly SearchHighlightRange[] {
  const offsets: SearchHighlightRange[] = [];
  let normalizedExcerpt = '';
  for (let start = 0; start < excerpt.length;) {
    const character = String.fromCodePoint(excerpt.codePointAt(start)!);
    const end = start + character.length;
    const normalizedCharacter = normalizeProjectSearchText(character);
    normalizedExcerpt += normalizedCharacter;
    for (let index = 0; index < normalizedCharacter.length; index += 1) {
      offsets.push({ end, start });
    }
    start = end;
  }

  const ranges: SearchHighlightRange[] = [];
  for (const term of terms) {
    const normalizedTerm = normalizeProjectSearchText(term);
    if (!normalizedTerm) {
      continue;
    }
    let index = normalizedExcerpt.indexOf(normalizedTerm);
    while (index !== -1) {
      const first = offsets[index];
      const last = offsets[index + normalizedTerm.length - 1];
      if (first && last) {
        ranges.push({ end: last.end, start: first.start });
      }
      index = normalizedExcerpt.indexOf(normalizedTerm, index + normalizedTerm.length);
    }
  }

  return ranges
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .reduce<SearchHighlightRange[]>((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, []);
}

function SearchPreviewExcerpt({
  excerpt,
  terms,
}: {
  excerpt: string;
  terms: readonly string[];
}) {
  const ranges = searchHighlightRanges(excerpt, terms);
  if (ranges.length === 0) {
    return excerpt;
  }

  const parts: React.ReactNode[] = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start > offset) {
      parts.push(excerpt.slice(offset, range.start));
    }
    parts.push(
      <mark className="project-tree__preview-match" key={range.start}>
        {excerpt.slice(range.start, range.end)}
      </mark>,
    );
    offset = range.end;
  }
  if (offset < excerpt.length) {
    parts.push(excerpt.slice(offset));
  }
  return parts;
}

function branchMatches(
  controller: ProjectTreeController,
  parentId: string | null,
  normalizedQuery: string,
  searchNodeIds?: ReadonlySet<string>,
): Set<string> {
  const matches = new Set<string>();
  for (const node of controller.getBranch(parentId).nodes) {
    const descendants =
      node.kind === 'folder'
        ? branchMatches(
            controller,
            node.nodeId,
            normalizedQuery,
            searchNodeIds,
          )
        : new Set<string>();
    if (
      (searchNodeIds
        ? searchNodeIds.has(node.nodeId)
        : normalizeSearchQuery(projectNodeDisplayName(node)).includes(
            normalizedQuery,
          )) ||
      descendants.size > 0
    ) {
      matches.add(node.nodeId);
      for (const nodeId of descendants) {
        matches.add(nodeId);
      }
    }
  }
  return matches;
}

function nodeMenuItems(
  node: ProjectTreeNode,
  translate: Translate,
  propertiesAvailable: boolean,
): readonly MenuItem[] {
  return [
    ...(node.kind === 'folder'
      ? ([
          {
            id: 'add-instance',
            kind: 'action',
            label: translate('projects.addInstance'),
            icon: plusIcon,
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
    ...(node.kind === 'page' && node.pageType === 'markdown'
      ? ([
          { id: 'properties-separator', kind: 'separator' },
          {
            id: 'properties',
            kind: 'action',
            label: translate('projects.properties'),
            icon: settingsIcon,
            shortcut: 'Alt+Enter',
            disabled: !propertiesAvailable,
          },
        ] satisfies MenuItem[])
      : []),
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
    <MaskedIcon
      className={`project-tree__chevron${
        kind === 'folder' ? '' : ' project-tree__chevron--empty'
      }${expanded ? ' project-tree__chevron--expanded' : ''}`}
      icon={chevronRightIcon}
    />
  );
}

function ProjectTreeKindIcon({
  expanded = false,
  kind,
  pageType,
}: {
  expanded?: boolean;
  kind: ProjectTreeNode['kind'];
  pageType?: string;
}) {
  const icon =
    kind === 'folder'
      ? expanded
        ? folderOpenIcon
        : folderIcon
      : (pageType && getProjectPageTypeDefinition(pageType)?.icon) ?? fileIcon;

  return <MaskedIcon className="project-tree__kind" icon={icon} />;
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
  onRequestBranchMenu,
  onRequestMove,
  onRequestProperties,
  onRequestRename,
  onRequestTrash,
  onSubmitEdit,
  operationPending = false,
  projectId,
  searchNodeIds,
  searchPreviews,
  searchQuery = '',
  translate,
}: ProjectTreeProps) {
  const { preferences } = useFlyoffPreferences();
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
  const displayNodeName = (node: ProjectTreeNode): string =>
    `${projectNodeDisplayName(node)}${
      preferences.documents.showFileExtensions && node.kind === 'page'
        ? '.md'
        : ''
    }`;

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

  const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
  const searchTerms = contentSearchTerms(searchQuery);
  const searchMatches = normalizedSearchQuery
    ? branchMatches(
        controller,
        null,
        normalizedSearchQuery,
        searchNodeIds,
      )
    : undefined;
  const visibleNodes = collectVisibleNodes(
    controller,
    searchQuery,
    null,
    1,
    [],
    searchMatches,
  );
  const visibleNodeIds = new Set(
    visibleNodes.map(({ node }) => node.nodeId),
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

    if (
      event.altKey &&
      event.key === 'Enter' &&
      visible.node.kind === 'page' &&
      visible.node.pageType === 'markdown' &&
      onRequestProperties
    ) {
      event.preventDefault();
      onRequestProperties(visible.node);
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
        if (normalizedSearchQuery) {
          focusNode(visibleNodes[index + 1]?.node.nodeId);
          return;
        }
        if (!controller.isExpanded(visible.node.nodeId)) {
          void controller.setExpanded(visible.node.nodeId, true);
        } else {
          focusNode(visibleNodes[index + 1]?.node.nodeId);
        }
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (normalizedSearchQuery) {
          focusNode(visible.parentId ?? undefined);
          return;
        }
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
          if (!normalizedSearchQuery) {
            void controller.toggle(visible.node.nodeId);
          }
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
      case 'properties':
        if (node.kind === 'page' && node.pageType === 'markdown') {
          onRequestProperties?.(node);
        }
        return;
      default:
        return;
    }
  }

  function finishDrag(event?: DragEvent<HTMLElement>): void {
    event?.preventDefault();
    setWorkspaceDragActive(false);
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
    const renderedNodes = searchMatches
      ? branch.nodes.filter((node) => searchMatches.has(node.nodeId))
      : branch.nodes;
    const createEdit =
      edit?.mode === 'create' && edit.parentId === parentId ? edit : undefined;

    return (
      <>
        {renderedNodes.map((node, siblingIndex) => {
          const preview = searchPreviews?.get(node.nodeId);
          const expanded =
            node.kind === 'folder'
              ? Boolean(searchMatches) || controller.isExpanded(node.nodeId)
              : undefined;
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
                aria-setsize={renderedNodes.length}
                className={`project-tree__item${
                  activeNodeId === node.nodeId ? ' project-tree__item--active' : ''
                }${
                  preview ? ' project-tree__item--search-preview' : ''
                }${
                  contextMenu?.node.nodeId === node.nodeId
                    ? ' project-tree__item--context'
                    : ''
                }${
                  dropTarget?.nodeId === node.nodeId
                    ? ` project-tree__item--drop-${dropTarget.edge}`
                    : ''
                }`}
                draggable={
                  !renameEdit && !operationPending && !normalizedSearchQuery
                }
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
                  event.dataTransfer.effectAllowed =
                    node.kind === 'page' && projectId ? 'copyMove' : 'move';
                  event.dataTransfer.setData(
                    PROJECT_TREE_NODE_DRAG_TYPE,
                    node.nodeId,
                  );
                  if (node.kind === 'page' && projectId) {
                    writeWorkspaceProjectNodeDrag(event.dataTransfer, {
                      type: 'project-content',
                      projectId,
                      nodeId: node.nodeId,
                      pageType: node.pageType,
                    });
                  }
                  setWorkspaceDragActive(true);
                  setDraggedNodeId(node.nodeId);
                }}
                onPointerDown={(event) => {
                  if (
                    event.button !== 0 ||
                    node.kind !== 'page' ||
                    !projectId ||
                    renameEdit ||
                    operationPending ||
                    normalizedSearchQuery ||
                    (event.target instanceof Element &&
                      event.target.closest('.project-tree__menu-trigger'))
                  ) {
                    return;
                  }
                  beginWorkspaceProjectNodePointerDrag(
                    {
                      type: 'project-content',
                      projectId,
                      nodeId: node.nodeId,
                      pageType: node.pageType,
                    },
                    event.pointerId,
                    event.clientX,
                    event.clientY,
                  );
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
                    <ProjectTreeKindIcon
                      expanded={expanded}
                      kind={node.kind}
                      pageType={node.kind === 'page' ? node.pageType : undefined}
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
                    aria-describedby={
                      preview
                        ? `project-tree-preview-${node.nodeId}`
                        : undefined
                    }
                    aria-label={displayNodeName(node)}
                    className="project-tree__node"
                    onClick={() => {
                      if (node.kind === 'folder') {
                        if (!normalizedSearchQuery) {
                          void controller.toggle(node.nodeId);
                        }
                      } else {
                        onOpenNode(node);
                      }
                    }}
                    tabIndex={-1}
                    type="button"
                  >
                  <ProjectTreeChevron expanded={expanded} kind={node.kind} />
                  <ProjectTreeKindIcon
                    expanded={expanded}
                    kind={node.kind}
                    pageType={node.kind === 'page' ? node.pageType : undefined}
                  />
                    <span className="project-tree__text">
                      <span className="project-tree__label">
                        {displayNodeName(node)}
                      </span>
                      {preview ? (
                        <span
                          className="project-tree__preview"
                          id={`project-tree-preview-${node.nodeId}`}
                        >
                          <span className="project-tree__preview-line">
                            {preview.line}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="project-tree__preview-excerpt">
                            <SearchPreviewExcerpt
                              excerpt={preview.excerpt}
                              terms={searchTerms}
                            />
                          </span>
                        </span>
                      ) : null}
                    </span>
                  </button>
                )}
                {!renameEdit ? (
                  <DropdownMenu
                    items={nodeMenuItems(
                      node,
                      translate,
                      Boolean(onRequestProperties),
                    )}
                    onAction={(action) => handleMenuAction(node, action)}
                    trigger={(props) => (
                      <button
                        {...props}
                        aria-label={`${translate('projects.moreActions')}: ${displayNodeName(node)}`}
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
                        <MaskedIcon
                          className="project-tree__menu-icon"
                          icon={ellipsisIcon}
                        />
                      </button>
                    )}
                  />
                ) : null}
              </div>
              {node.kind === 'folder' && expanded ? (
                <div
                  aria-busy={
                    controller.getBranch(node.nodeId).status === 'loading'
                      ? true
                      : undefined
                  }
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
            <ProjectTreeChevron kind={createEdit.kind} />
            <ProjectTreeKindIcon
              kind={createEdit.kind}
              pageType={createEdit.pageType}
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
        {parentId === null &&
        searchMatches &&
        branch.status === 'loaded' &&
        renderedNodes.length === 0 ? (
          <div className="project-tree__message" role="status">
            {translate('projects.noSearchResults')}
          </div>
        ) : null}
        {parentId === null &&
        branch.status === 'loading' &&
        branch.nodes.length === 0 ? (
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
      aria-busy={
        controller.getBranch(null).status === 'loading' ? true : undefined
      }
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
        onRequestBranchMenu(
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
          ariaLabel={`${translate('projects.moreActions')}: ${displayNodeName(
            contextMenu.node,
          )}`}
          items={nodeMenuItems(
            contextMenu.node,
            translate,
            Boolean(onRequestProperties),
          )}
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
