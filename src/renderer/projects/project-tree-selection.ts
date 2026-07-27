export {
  COLLECTION_SELECTION_LIMIT as PROJECT_TREE_SELECTION_LIMIT,
  emptyCollectionSelection as emptyProjectTreeSelection,
  pruneCollectionSelection as pruneProjectTreeSelection,
  selectAllVisibleCollectionItems as selectAllVisibleProjectTreeNodes,
  selectCollectionItem as selectProjectTreeNode,
  selectCollectionMarquee as selectProjectTreeMarquee,
  selectCollectionRange as selectProjectTreeRange,
  toggleCollectionItem as toggleProjectTreeNode,
} from './collection-selection';
export type {
  CollectionMarqueeMode as ProjectTreeMarqueeMode,
  CollectionSelection as ProjectTreeSelection,
  CollectionSelectionResult as ProjectTreeSelectionResult,
} from './collection-selection';

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
