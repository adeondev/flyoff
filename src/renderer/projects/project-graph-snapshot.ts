import type {
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectGraphSnapshot,
} from '../../shared/contracts';

function graphNodesEqual(a: ProjectGraphNode, b: ProjectGraphNode): boolean {
  return (
    a.nodeId === b.nodeId &&
    a.name === b.name &&
    a.path === b.path &&
    a.connectionCount === b.connectionCount
  );
}

function graphEdgesEqual(a: ProjectGraphEdge, b: ProjectGraphEdge): boolean {
  return (
    a.sourceNodeId === b.sourceNodeId &&
    a.targetNodeId === b.targetNodeId &&
    a.weight === b.weight
  );
}

// The graph query is deterministic, so a positional comparison is enough: a
// reordered-but-equivalent snapshot at worst falls back to a rebuild, never a
// wrong match. Used to keep graph/layout object identity stable across reloads
// that produce no real change, so downstream effects don't rebuild the runtime.
export function projectGraphSnapshotEqual(
  a: ProjectGraphSnapshot,
  b: ProjectGraphSnapshot,
): boolean {
  if (a === b) {
    return true;
  }
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) {
    return false;
  }
  for (let index = 0; index < a.nodes.length; index += 1) {
    if (!graphNodesEqual(a.nodes[index]!, b.nodes[index]!)) {
      return false;
    }
  }
  for (let index = 0; index < a.edges.length; index += 1) {
    if (!graphEdgesEqual(a.edges[index]!, b.edges[index]!)) {
      return false;
    }
  }
  return true;
}
