export const PROJECT_TREE_SELECTION_LIMIT = 500;

export interface ProjectTreeSelection {
  anchorId?: string;
  selectedIds: ReadonlySet<string>;
}

export interface ProjectTreeSelectionResult extends ProjectTreeSelection {
  truncated: boolean;
}

export type ProjectTreeMarqueeMode = 'add' | 'replace' | 'toggle';

export function emptyProjectTreeSelection(): ProjectTreeSelection {
  return { selectedIds: new Set() };
}

export function selectProjectTreeNode(nodeId: string): ProjectTreeSelection {
  return { anchorId: nodeId, selectedIds: new Set([nodeId]) };
}

export function toggleProjectTreeNode(
  selection: ProjectTreeSelection,
  nodeId: string,
): ProjectTreeSelection {
  const selectedIds = new Set(selection.selectedIds);
  if (selectedIds.has(nodeId)) {
    selectedIds.delete(nodeId);
  } else if (selectedIds.size < PROJECT_TREE_SELECTION_LIMIT) {
    selectedIds.add(nodeId);
  }
  return {
    anchorId: selectedIds.size > 0 ? nodeId : undefined,
    selectedIds,
  };
}

export function selectProjectTreeRange(
  selection: ProjectTreeSelection,
  visibleNodeIds: readonly string[],
  targetId: string,
  additive: boolean,
): ProjectTreeSelectionResult {
  const targetIndex = visibleNodeIds.indexOf(targetId);
  if (targetIndex === -1) {
    return { ...selection, truncated: false };
  }
  const anchorIndex = selection.anchorId
    ? visibleNodeIds.indexOf(selection.anchorId)
    : -1;
  const start = Math.min(anchorIndex === -1 ? targetIndex : anchorIndex, targetIndex);
  const end = Math.max(anchorIndex === -1 ? targetIndex : anchorIndex, targetIndex);
  const selectedIds = additive
    ? new Set(selection.selectedIds)
    : new Set<string>();
  let truncated = false;

  for (const nodeId of visibleNodeIds.slice(start, end + 1)) {
    if (selectedIds.size >= PROJECT_TREE_SELECTION_LIMIT) {
      truncated = true;
      break;
    }
    selectedIds.add(nodeId);
  }

  return {
    anchorId: selection.anchorId ?? targetId,
    selectedIds,
    truncated,
  };
}

export function selectAllVisibleProjectTreeNodes(
  visibleNodeIds: readonly string[],
): ProjectTreeSelectionResult {
  return {
    anchorId: visibleNodeIds[0],
    selectedIds: new Set(
      visibleNodeIds.slice(0, PROJECT_TREE_SELECTION_LIMIT),
    ),
    truncated: visibleNodeIds.length > PROJECT_TREE_SELECTION_LIMIT,
  };
}

export function selectProjectTreeMarquee(
  selection: ProjectTreeSelection,
  visibleNodeIds: readonly string[],
  intersectedNodeIds: ReadonlySet<string>,
  mode: ProjectTreeMarqueeMode,
): ProjectTreeSelectionResult {
  const selectedIds =
    mode === 'replace'
      ? new Set<string>()
      : new Set(selection.selectedIds);
  let truncated = false;

  for (const nodeId of visibleNodeIds) {
    if (!intersectedNodeIds.has(nodeId)) {
      continue;
    }
    if (mode === 'toggle' && selectedIds.has(nodeId)) {
      selectedIds.delete(nodeId);
      continue;
    }
    if (selectedIds.size >= PROJECT_TREE_SELECTION_LIMIT) {
      truncated = true;
      continue;
    }
    selectedIds.add(nodeId);
  }

  const anchorId =
    mode !== 'replace' &&
    selection.anchorId &&
    selectedIds.has(selection.anchorId)
      ? selection.anchorId
      : visibleNodeIds.find((nodeId) => selectedIds.has(nodeId));

  return { anchorId, selectedIds, truncated };
}

export function pruneProjectTreeSelection(
  selection: ProjectTreeSelection,
  visibleNodeIds: ReadonlySet<string>,
): ProjectTreeSelection {
  const selectedIds = new Set(
    [...selection.selectedIds].filter((nodeId) => visibleNodeIds.has(nodeId)),
  );
  return {
    anchorId:
      selection.anchorId && visibleNodeIds.has(selection.anchorId)
        ? selection.anchorId
        : selectedIds.values().next().value,
    selectedIds,
  };
}

export function normalizeProjectTreeSelectionRoots(
  nodeIds: readonly string[],
  parentByNodeId: ReadonlyMap<string, string | null>,
): readonly string[] {
  const selectedIds = new Set(nodeIds);
  return nodeIds.filter((nodeId, index) => {
    if (nodeIds.indexOf(nodeId) !== index) {
      return false;
    }
    const visited = new Set<string>([nodeId]);
    let parentId = parentByNodeId.get(nodeId);
    while (parentId) {
      if (selectedIds.has(parentId)) {
        return false;
      }
      if (visited.has(parentId)) {
        break;
      }
      visited.add(parentId);
      parentId = parentByNodeId.get(parentId);
    }
    return true;
  });
}
