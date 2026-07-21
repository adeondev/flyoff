import type { ProjectTreeNode } from '../../shared/contracts';

export function projectTreeNodeEqual(
  a: ProjectTreeNode,
  b: ProjectTreeNode,
): boolean {
  return (
    a.nodeId === b.nodeId &&
    a.kind === b.kind &&
    a.name === b.name &&
    a.parentId === b.parentId &&
    a.canContainChildren === b.canContainChildren &&
    a.hasChildren === b.hasChildren &&
    (a.kind !== 'page' || b.kind !== 'page' || a.pageType === b.pageType)
  );
}
