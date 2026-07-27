export const COLLECTION_SELECTION_LIMIT = 500;

export interface CollectionSelection {
  anchorId?: string;
  selectedIds: ReadonlySet<string>;
}

export interface CollectionSelectionResult extends CollectionSelection {
  truncated: boolean;
}

export type CollectionMarqueeMode = 'add' | 'replace' | 'toggle';

export function emptyCollectionSelection(): CollectionSelection {
  return { selectedIds: new Set() };
}

export function selectCollectionItem(itemId: string): CollectionSelection {
  return { anchorId: itemId, selectedIds: new Set([itemId]) };
}

export function toggleCollectionItem(
  selection: CollectionSelection,
  itemId: string,
): CollectionSelection {
  const selectedIds = new Set(selection.selectedIds);
  if (selectedIds.has(itemId)) {
    selectedIds.delete(itemId);
  } else if (selectedIds.size < COLLECTION_SELECTION_LIMIT) {
    selectedIds.add(itemId);
  }
  return {
    anchorId: selectedIds.size > 0 ? itemId : undefined,
    selectedIds,
  };
}

export function selectCollectionRange(
  selection: CollectionSelection,
  visibleItemIds: readonly string[],
  targetId: string,
  additive: boolean,
): CollectionSelectionResult {
  const targetIndex = visibleItemIds.indexOf(targetId);
  if (targetIndex === -1) {
    return { ...selection, truncated: false };
  }
  const anchorIndex = selection.anchorId
    ? visibleItemIds.indexOf(selection.anchorId)
    : -1;
  const start = Math.min(
    anchorIndex === -1 ? targetIndex : anchorIndex,
    targetIndex,
  );
  const end = Math.max(
    anchorIndex === -1 ? targetIndex : anchorIndex,
    targetIndex,
  );
  const selectedIds = additive
    ? new Set(selection.selectedIds)
    : new Set<string>();
  let truncated = false;

  for (const itemId of visibleItemIds.slice(start, end + 1)) {
    if (selectedIds.size >= COLLECTION_SELECTION_LIMIT) {
      truncated = true;
      break;
    }
    selectedIds.add(itemId);
  }

  return {
    anchorId: selection.anchorId ?? targetId,
    selectedIds,
    truncated,
  };
}

export function selectAllVisibleCollectionItems(
  visibleItemIds: readonly string[],
): CollectionSelectionResult {
  return {
    anchorId: visibleItemIds[0],
    selectedIds: new Set(
      visibleItemIds.slice(0, COLLECTION_SELECTION_LIMIT),
    ),
    truncated: visibleItemIds.length > COLLECTION_SELECTION_LIMIT,
  };
}

export function selectCollectionMarquee(
  selection: CollectionSelection,
  visibleItemIds: readonly string[],
  intersectedItemIds: ReadonlySet<string>,
  mode: CollectionMarqueeMode,
): CollectionSelectionResult {
  const selectedIds =
    mode === 'replace' ? new Set<string>() : new Set(selection.selectedIds);
  let truncated = false;

  for (const itemId of visibleItemIds) {
    if (!intersectedItemIds.has(itemId)) {
      continue;
    }
    if (mode === 'toggle' && selectedIds.has(itemId)) {
      selectedIds.delete(itemId);
      continue;
    }
    if (selectedIds.size >= COLLECTION_SELECTION_LIMIT) {
      truncated = true;
      continue;
    }
    selectedIds.add(itemId);
  }

  const anchorId =
    mode !== 'replace' &&
    selection.anchorId &&
    selectedIds.has(selection.anchorId)
      ? selection.anchorId
      : visibleItemIds.find((itemId) => selectedIds.has(itemId));

  return { anchorId, selectedIds, truncated };
}

export function pruneCollectionSelection(
  selection: CollectionSelection,
  availableItemIds: ReadonlySet<string>,
): CollectionSelection {
  const selectedIds = new Set(
    [...selection.selectedIds].filter((itemId) =>
      availableItemIds.has(itemId),
    ),
  );
  return {
    anchorId:
      selection.anchorId && availableItemIds.has(selection.anchorId)
        ? selection.anchorId
        : selectedIds.values().next().value,
    selectedIds,
  };
}
