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
import type { DiagramType } from '../../shared/diagram';
import {
  normalizeProjectSearchText,
  parseProjectSearchQuery,
} from '../../shared/project-search';
import { MaskedIcon } from '../components/MaskedIcon';
import { ContextMenu, DropdownMenu, type MenuItem } from '../components/menu';
import { TwemojiText } from '../components/twemoji';
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
import { useProjectTreeMarquee } from './use-project-tree-marquee';
import {
  emptyProjectTreeSelection,
  normalizeProjectTreeSelectionRoots,
  pruneProjectTreeSelection,
  selectAllVisibleProjectTreeNodes,
  selectProjectTreeNode,
  selectProjectTreeRange,
  toggleProjectTreeNode,
  type ProjectTreeSelection,
} from './project-tree-selection';

const PROJECT_TREE_NODE_DRAG_TYPE =
  'application/x-flyoff-project-tree-node';

export type ProjectTreeInlineEdit =
  | {
      mode: 'create';
      parentId: string | null;
      kind: ProjectTreeNode['kind'];
      pageType?: string;
      diagramType?: DiagramType;
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
  onOpenNodes: (nodes: readonly ProjectPageNode[]) => void;
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
  onRequestCopySelection: (nodes: readonly ProjectTreeNode[]) => void;
  onRequestMove: (node: ProjectTreeNode) => void;
  onRequestMoveSelection: (nodes: readonly ProjectTreeNode[]) => void;
  onRequestProperties?: (node: ProjectPageNode) => void;
  onRequestRename: (node: ProjectTreeNode) => void;
  onRequestTrash: (node: ProjectTreeNode) => void;
  onRequestTrashSelection: (nodes: readonly ProjectTreeNode[]) => void;
  onSelectionChange: (selection: ProjectTreeSelection) => void;
  onSelectionLimitReached?: () => void;
  onSubmitEdit: (name: string) => void;
  onMoveNode: (
    node: ProjectTreeNode,
    parentId: string | null,
    beforeNodeId?: string | null,
  ) => void;
  onMoveNodes: (
    nodes: readonly ProjectTreeNode[],
    parentId: string | null,
    beforeNodeId?: string | null,
  ) => void;
  selection: ProjectTreeSelection;
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
      node.canContainChildren && node.hasChildren
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
      node.canContainChildren &&
      node.hasChildren &&
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
    return <TwemojiText text={excerpt} />;
  }

  const parts: React.ReactNode[] = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start > offset) {
      parts.push(
        <TwemojiText
          key={`plain-${offset}`}
          text={excerpt.slice(offset, range.start)}
        />,
      );
    }
    parts.push(
      <mark className="project-tree__preview-match" key={range.start}>
        <TwemojiText text={excerpt.slice(range.start, range.end)} />
      </mark>,
    );
    offset = range.end;
  }
  if (offset < excerpt.length) {
    parts.push(
      <TwemojiText key={`plain-${offset}`} text={excerpt.slice(offset)} />,
    );
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
      node.canContainChildren && node.hasChildren
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
    ...(node.canContainChildren
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

function selectionMenuItems(
  translate: Translate,
  hasPages: boolean,
): readonly MenuItem[] {
  return [
    {
      id: 'open-selected',
      kind: 'action',
      label: translate('projects.openSelected'),
      disabled: !hasPages,
    },
    {
      id: 'move-selected',
      kind: 'action',
      label: translate('projects.moveSelected'),
    },
    {
      id: 'copy-selected-paths',
      kind: 'action',
      label: translate('projects.copySelectedPaths'),
    },
    { id: 'selection-separator', kind: 'separator' },
    {
      id: 'trash-selected',
      kind: 'action',
      label: translate('projects.trashSelected'),
      tone: 'danger',
    },
  ];
}

function ProjectTreeChevron({
  expanded,
  label,
  onToggle,
  visible,
}: {
  expanded?: boolean;
  label?: string;
  onToggle?: () => void;
  visible: boolean;
}) {
  const icon = (
    <MaskedIcon
      className={`project-tree__chevron${
        visible ? '' : ' project-tree__chevron--empty'
      }${expanded ? ' project-tree__chevron--expanded' : ''}`}
      icon={chevronRightIcon}
    />
  );
  if (!visible || !onToggle) {
    return icon;
  }
  return (
    <button
      aria-label={label}
      className="project-tree__chevron-button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      tabIndex={-1}
      type="button"
    >
      {icon}
    </button>
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
  onMoveNodes,
  onOpenNode,
  onOpenNodes,
  onRequestAddInstance,
  onRequestBranchMenu,
  onRequestCopySelection,
  onRequestMove,
  onRequestMoveSelection,
  onRequestProperties,
  onRequestRename,
  onRequestTrash,
  onRequestTrashSelection,
  onSelectionChange,
  onSelectionLimitReached,
  onSubmitEdit,
  operationPending = false,
  projectId,
  searchNodeIds,
  searchPreviews,
  searchQuery = '',
  selection,
  translate,
}: ProjectTreeProps) {
  const { preferences } = useFlyoffPreferences();
  const [, renderVersion] = useReducer((version: number) => version + 1, 0);
  const [focusedNodeId, setFocusedNodeId] = useState<string>();
  const [draggedNodeIds, setDraggedNodeIds] =
    useState<readonly string[]>([]);
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
  const visibleNodeIdList = visibleNodes.map(({ node }) => node.nodeId);
  const visibleNodeIdsKey = visibleNodeIdList.join('\u0000');
  const visibleNodeIds = new Set(visibleNodeIdList);
  const visiblePages = visibleNodes.flatMap(({ node }) =>
    node.kind === 'page' ? [node] : [],
  );
  const selectedVisibleNodes = visibleNodes.flatMap(({ node }) =>
    selection.selectedIds.has(node.nodeId) ? [node] : [],
  );
  const selectedVisiblePages = visiblePages.filter(({ nodeId }) =>
    selection.selectedIds.has(nodeId),
  );
  const parentByNodeId = new Map(
    visibleNodes.map(({ node, parentId }) => [node.nodeId, parentId] as const),
  );
  const selectedRootIds = normalizeProjectTreeSelectionRoots(
    selectedVisibleNodes.map(({ nodeId }) => nodeId),
    parentByNodeId,
  );
  const selectedRootNodes = selectedRootIds.flatMap((nodeId) => {
    const node = controller.findNode(nodeId);
    return node ? [node] : [];
  });
  const effectiveFocusId =
    (focusedNodeId && visibleNodeIds.has(focusedNodeId)
      ? focusedNodeId
      : activeNodeId && visibleNodeIds.has(activeNodeId)
        ? activeNodeId
        : visibleNodes[0]?.node.nodeId) ?? undefined;
  const marquee = useProjectTreeMarquee({
    disabled: operationPending || Boolean(edit),
    itemRefs,
    onSelectionChange,
    onSelectionLimitReached,
    selection,
    visibleNodeIds: visibleNodeIdList,
  });

  function focusNode(nodeId: string | undefined): void {
    if (!nodeId) {
      return;
    }
    setFocusedNodeId(nodeId);
    requestAnimationFrame(() => itemRefs.current.get(nodeId)?.focus());
  }

  useEffect(() => {
    const next = pruneProjectTreeSelection(
      selection,
      new Set(visibleNodeIdsKey ? visibleNodeIdsKey.split('\u0000') : []),
    );
    if (
      next.anchorId !== selection.anchorId ||
      next.selectedIds.size !== selection.selectedIds.size
    ) {
      onSelectionChange(next);
    }
  }, [
    onSelectionChange,
    selection,
    visibleNodeIdsKey,
  ]);

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
    const primaryModifier = event.ctrlKey || event.metaKey;

    if (primaryModifier && event.key.toLocaleLowerCase() === 'a') {
      event.preventDefault();
      const next = selectAllVisibleProjectTreeNodes(visibleNodeIdList);
      onSelectionChange(next);
      if (next.truncated) {
        onSelectionLimitReached?.();
      }
      return;
    }

    if (
      primaryModifier &&
      event.key === ' '
    ) {
      event.preventDefault();
      onSelectionChange(toggleProjectTreeNode(selection, visible.node.nodeId));
      return;
    }

    if (
      event.key === 'Escape' &&
      selection.selectedIds.size > 0
    ) {
      event.preventDefault();
      onSelectionChange(emptyProjectTreeSelection());
      return;
    }

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const siblings = controller.getBranch(visible.parentId).nodes;
      const siblingIndex = siblings.findIndex(
        ({ nodeId }) => nodeId === visible.node.nodeId,
      );
      const movableSelection =
        selection.selectedIds.has(visible.node.nodeId) &&
        selectedRootNodes.length > 1 &&
        selectedRootNodes.every((node) => node.parentId === visible.parentId)
          ? selectedRootNodes
          : [visible.node];
      const movableIds = new Set(movableSelection.map(({ nodeId }) => nodeId));
      const selectedSiblingIndexes = siblings.flatMap((node, currentIndex) =>
        movableIds.has(node.nodeId) ? [currentIndex] : [],
      );
      const firstIndex = selectedSiblingIndexes[0] ?? siblingIndex;
      const lastIndex = selectedSiblingIndexes.at(-1) ?? siblingIndex;
      const beforeNodeId =
        event.key === 'ArrowUp'
          ? siblings[firstIndex - 1]?.nodeId
          : siblings[lastIndex + 2]?.nodeId ?? null;
      if (
        siblingIndex >= 0 &&
        ((event.key === 'ArrowUp' && firstIndex > 0) ||
          (event.key === 'ArrowDown' && lastIndex < siblings.length - 1))
      ) {
        event.preventDefault();
        if (movableSelection.length > 1) {
          onMoveNodes(movableSelection, visible.parentId, beforeNodeId);
        } else {
          onMoveNode(visible.node, visible.parentId, beforeNodeId);
        }
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
        {
          const next = visibleNodes[index + 1]?.node;
          focusNode(next?.nodeId);
          if (event.shiftKey && next) {
            const result = selectProjectTreeRange(
              selection.selectedIds.size > 0
                ? selection
                : selectProjectTreeNode(visible.node.nodeId),
              visibleNodeIdList,
              next.nodeId,
              false,
            );
            onSelectionChange(result);
            if (result.truncated) {
              onSelectionLimitReached?.();
            }
          }
        }
        return;
      case 'ArrowUp':
        event.preventDefault();
        {
          const next = visibleNodes[index - 1]?.node;
          focusNode(next?.nodeId);
          if (event.shiftKey && next) {
            const result = selectProjectTreeRange(
              selection.selectedIds.size > 0
                ? selection
                : selectProjectTreeNode(visible.node.nodeId),
              visibleNodeIdList,
              next.nodeId,
              false,
            );
            onSelectionChange(result);
            if (result.truncated) {
              onSelectionLimitReached?.();
            }
          }
        }
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
        if (!visible.node.canContainChildren || !visible.node.hasChildren) {
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
          visible.node.canContainChildren &&
          visible.node.hasChildren &&
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
          if (
            event.key === 'Enter' &&
            selection.selectedIds.has(visible.node.nodeId) &&
            selectedVisiblePages.length > 0
          ) {
            onOpenNodes(selectedVisiblePages);
          } else {
            onSelectionChange(selectProjectTreeNode(visible.node.nodeId));
            onOpenNode(visible.node);
          }
        }
        return;
      case 'F2':
        event.preventDefault();
        if (
          selection.selectedIds.size === 1 &&
          selection.selectedIds.has(visible.node.nodeId)
        ) {
          onRequestRename(visible.node);
        }
        return;
      case 'Delete':
        event.preventDefault();
        if (
          selection.selectedIds.has(visible.node.nodeId) &&
          selectedRootNodes.length > 0
        ) {
          onRequestTrashSelection(selectedRootNodes);
        } else {
          onRequestTrash(visible.node);
        }
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

  function handleSelectionMenuAction(action: string): void {
    switch (action) {
      case 'open-selected':
        onOpenNodes(selectedVisiblePages);
        return;
      case 'move-selected':
        onRequestMoveSelection(selectedRootNodes);
        return;
      case 'copy-selected-paths':
        onRequestCopySelection(selectedRootNodes);
        return;
      case 'trash-selected':
        onRequestTrashSelection(selectedRootNodes);
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
    setDraggedNodeIds([]);
    dropTargetRef.current = undefined;
    setDropTarget(undefined);
  }

  function dropOn(
    parentId: string | null,
    beforeNodeId?: string | null,
  ): void {
    const dragged = draggedNodeIds.flatMap((nodeId) => {
      const node = controller.findNode(nodeId);
      return node ? [node] : [];
    });
    if (dragged.length > 1) {
      onMoveNodes(dragged, parentId, beforeNodeId);
    } else if (dragged[0] && dragged[0].nodeId !== parentId) {
      onMoveNode(dragged[0], parentId, beforeNodeId);
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
      folder?.canContainChildren &&
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
            node.canContainChildren && node.hasChildren
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
                aria-selected={selection.selectedIds.has(node.nodeId)}
                aria-setsize={renderedNodes.length}
                className={`project-tree__item${
                  activeNodeId === node.nodeId ? ' project-tree__item--active' : ''
                }${
                  selection.selectedIds.has(node.nodeId)
                    ? ' project-tree__item--selected'
                    : ''
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
                  if (
                    draggedNodeIds.length === 0 ||
                    draggedNodeIds.includes(node.nodeId)
                  ) {
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
                    node.canContainChildren && ratio >= 0.28 && ratio <= 0.72
                      ? 'inside'
                      : ratio < 0.5
                        ? 'before'
                        : 'after';
                  updateDropTarget({ nodeId: node.nodeId, edge }, node);
                }}
                onDragStart={(event) => {
                  const dragNodes =
                    selection.selectedIds.has(node.nodeId) &&
                    selectedRootNodes.length > 1
                      ? selectedRootNodes
                      : [node];
                  const dragTargets = dragNodes.flatMap((dragNode) =>
                    dragNode.kind === 'page' && projectId
                      ? [{
                          type: 'project-content' as const,
                          projectId,
                          nodeId: dragNode.nodeId,
                          pageType: dragNode.pageType,
                        }]
                      : [],
                  );
                  event.dataTransfer.effectAllowed =
                    dragTargets.length > 0 ? 'copyMove' : 'move';
                  event.dataTransfer.setData(
                    PROJECT_TREE_NODE_DRAG_TYPE,
                    JSON.stringify(dragNodes.map(({ nodeId }) => nodeId)),
                  );
                  if (dragTargets.length > 0) {
                    writeWorkspaceProjectNodeDrag(
                      event.dataTransfer,
                      dragTargets,
                    );
                  }
                  setWorkspaceDragActive(true);
                  setDraggedNodeIds(
                    dragNodes.map(({ nodeId }) => nodeId),
                  );
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
                      event.target.closest(
                        '.project-tree__menu-trigger, .project-tree__chevron-button',
                      ))
                  ) {
                    return;
                  }
                  const dragNodes =
                    selection.selectedIds.has(node.nodeId) &&
                    selectedRootNodes.length > 1
                      ? selectedRootNodes.filter(
                          (dragNode): dragNode is ProjectPageNode =>
                            dragNode.kind === 'page',
                        )
                      : [node];
                  if (dragNodes.length === 0) {
                    return;
                  }
                  beginWorkspaceProjectNodePointerDrag(
                    dragNodes.map((dragNode) => ({
                      type: 'project-content',
                      projectId,
                      nodeId: dragNode.nodeId,
                      pageType: dragNode.pageType,
                    })),
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
                  if (dropTarget.edge === 'inside' && node.canContainChildren) {
                    dropOn(node.nodeId);
                    return;
                  }
                  const siblings = controller
                    .getBranch(parentId)
                    .nodes.filter(
                      ({ nodeId }) => !draggedNodeIds.includes(nodeId),
                    );
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
                  if (
                    !selection.selectedIds.has(node.nodeId)
                  ) {
                    onSelectionChange(selectProjectTreeNode(node.nodeId));
                  }
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
                    <ProjectTreeChevron expanded={expanded} visible={false} />
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
                  <>
                  <ProjectTreeChevron
                    expanded={expanded}
                    label={translate(
                      expanded
                        ? 'projects.collapseItem'
                        : 'projects.expandItem',
                    )}
                    onToggle={() => {
                      if (!normalizedSearchQuery) {
                        void controller.toggle(node.nodeId);
                      }
                    }}
                    visible={node.canContainChildren && node.hasChildren}
                  />
                  <button
                    aria-describedby={
                      preview
                        ? `project-tree-preview-${node.nodeId}`
                        : undefined
                    }
                    aria-label={displayNodeName(node)}
                    className="project-tree__node"
                    onClick={(event) => {
                      if (event.shiftKey) {
                        const result = selectProjectTreeRange(
                          selection,
                          visibleNodeIdList,
                          node.nodeId,
                          event.ctrlKey || event.metaKey,
                        );
                        onSelectionChange(result);
                        if (result.truncated) {
                          onSelectionLimitReached?.();
                        }
                        return;
                      }
                      if (event.ctrlKey || event.metaKey) {
                        onSelectionChange(
                          toggleProjectTreeNode(selection, node.nodeId),
                        );
                        return;
                      }
                      onSelectionChange(selectProjectTreeNode(node.nodeId));
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
                  <ProjectTreeKindIcon
                    expanded={expanded}
                    kind={node.kind}
                    pageType={node.kind === 'page' ? node.pageType : undefined}
                  />
                    <span className="project-tree__text">
                      <span className="project-tree__label">
                        <TwemojiText text={displayNodeName(node)} />
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
                  </>
                )}
                {!renameEdit ? (
                  <DropdownMenu
                    items={
                      selection.selectedIds.has(node.nodeId) &&
                      selection.selectedIds.size > 1
                        ? selectionMenuItems(
                            translate,
                            selectedVisiblePages.length > 0,
                          )
                        : nodeMenuItems(
                            node,
                            translate,
                            Boolean(onRequestProperties),
                          )
                    }
                    onAction={(action) => {
                      if (
                        selection.selectedIds.has(node.nodeId) &&
                        selection.selectedIds.size > 1
                      ) {
                        handleSelectionMenuAction(action);
                      } else {
                        handleMenuAction(node, action);
                      }
                    }}
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
              {node.canContainChildren && node.hasChildren && expanded ? (
                <div
                  aria-busy={
                    controller.getBranch(node.nodeId).status === 'loading'
                      ? true
                      : undefined
                  }
                  data-project-parent-id={node.nodeId}
                  onDragOver={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      draggedNodeIds.length > 0
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      updateDropTarget({ nodeId: node.nodeId, edge: 'inside' }, node);
                    }
                  }}
                  onDrop={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      draggedNodeIds.length > 0
                    ) {
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
            <ProjectTreeChevron visible={false} />
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
      className={`project-tree${dropTarget?.nodeId === null ? ' project-tree--drop-root' : ''}${
        marquee.selecting ? ' project-tree--marquee-selecting' : ''
      }`}
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
      onLostPointerCapture={marquee.handleLostPointerCapture}
      onPointerCancel={marquee.handlePointerCancel}
      onPointerDown={marquee.handlePointerDown}
      onPointerMove={marquee.handlePointerMove}
      onPointerUp={marquee.handlePointerUp}
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
      tabIndex={-1}
    >
      {renderBranch(null, 1)}
      {marquee.boxStyle ? (
        <div
          aria-hidden="true"
          className="project-tree__marquee"
          style={marquee.boxStyle}
        />
      ) : null}
      {contextMenu ? (
        <ContextMenu
          ariaLabel={`${translate('projects.moreActions')}: ${displayNodeName(
            contextMenu.node,
          )}`}
          items={
            selection.selectedIds.has(contextMenu.node.nodeId) &&
            selection.selectedIds.size > 1
              ? selectionMenuItems(
                  translate,
                  selectedVisiblePages.length > 0,
                )
              : nodeMenuItems(
                  contextMenu.node,
                  translate,
                  Boolean(onRequestProperties),
                )
          }
          onAction={(action) => {
            if (
              selection.selectedIds.has(contextMenu.node.nodeId) &&
              selection.selectedIds.size > 1
            ) {
              handleSelectionMenuAction(action);
            } else {
              handleMenuAction(contextMenu.node, action, {
                x: contextMenu.x,
                y: contextMenu.y,
              });
            }
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
