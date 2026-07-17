import type { ProjectTreeNode } from '../../shared/contracts';

export function resolveProjectNodeLineage(
  nodes: ReadonlyMap<string, ProjectTreeNode>,
  nodeId: string,
): readonly ProjectTreeNode[] | undefined {
  const lineage: ProjectTreeNode[] = [];
  const visited = new Set<string>();
  let current = nodes.get(nodeId);

  while (current) {
    if (visited.has(current.nodeId)) {
      return undefined;
    }

    visited.add(current.nodeId);
    lineage.unshift(current);

    if (current.parentId === null) {
      return lineage;
    }

    current = nodes.get(current.parentId);
  }

  return undefined;
}

export function projectNodeLogicalPath(
  nodes: ReadonlyMap<string, ProjectTreeNode>,
  nodeId: string,
): string | undefined {
  const node = nodes.get(nodeId);
  if (!node) {
    return undefined;
  }

  const lineage = resolveProjectNodeLineage(nodes, nodeId) ?? [node];
  return `/${lineage.map(({ name }) => name).join('/')}`;
}
