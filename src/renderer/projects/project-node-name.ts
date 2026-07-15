import type { ProjectTreeNode } from '../../shared/contracts';

export function projectNodeDisplayName(node: ProjectTreeNode): string {
  return node.name;
}

export function projectNodeInputName(
  kind: ProjectTreeNode['kind'],
  name: string,
): string {
  void kind;
  return name;
}
