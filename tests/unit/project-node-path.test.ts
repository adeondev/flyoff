import { describe, expect, it } from 'vitest';

import {
  projectNodeLogicalPath,
  resolveProjectNodeLineage,
} from '../../src/renderer/projects/project-node-path';
import type { ProjectTreeNode } from '../../src/shared/contracts';

function nodeMap(
  nodes: readonly ProjectTreeNode[],
): ReadonlyMap<string, ProjectTreeNode> {
  return new Map(nodes.map((node) => [node.nodeId, node]));
}

const baby: ProjectTreeNode = {
  canContainChildren: true,
  hasChildren: true,
  kind: 'folder',
  name: 'baby',
  nodeId: 'baby',
  parentId: null,
};
const notes: ProjectTreeNode = {
  canContainChildren: true,
  hasChildren: true,
  kind: 'folder',
  name: 'Notas',
  nodeId: 'notes',
  parentId: baby.nodeId,
};
const doll: ProjectTreeNode = {
  canContainChildren: true,
  hasChildren: false,
  kind: 'page',
  name: 'doll',
  nodeId: 'doll',
  pageType: 'markdown',
  parentId: notes.nodeId,
};

describe('project node logical paths', () => {
  it('formats a complete logical lineage with portable separators', () => {
    const nodes = nodeMap([baby, notes, doll]);

    expect(projectNodeLogicalPath(nodes, doll.nodeId)).toBe(
      '/baby/Notas/doll',
    );
    expect(resolveProjectNodeLineage(nodes, doll.nodeId)).toEqual([
      baby,
      notes,
      doll,
    ]);
  });

  it('falls back to the node name instead of exposing a partial lineage', () => {
    const nodes = nodeMap([notes, doll]);

    expect(resolveProjectNodeLineage(nodes, doll.nodeId)).toBeUndefined();
    expect(projectNodeLogicalPath(nodes, doll.nodeId)).toBe('/doll');
  });

  it('detects lineage cycles and uses the same safe fallback', () => {
    const cycleRoot = { ...baby, parentId: notes.nodeId };
    const nodes = nodeMap([cycleRoot, notes, doll]);

    expect(resolveProjectNodeLineage(nodes, doll.nodeId)).toBeUndefined();
    expect(projectNodeLogicalPath(nodes, doll.nodeId)).toBe('/doll');
  });

  it('reflects rename and move updates from a new cache snapshot', () => {
    const renamedNotes = { ...notes, name: 'Arquivo' };
    const movedDoll = { ...doll, parentId: baby.nodeId };

    expect(
      projectNodeLogicalPath(
        nodeMap([baby, renamedNotes, doll]),
        doll.nodeId,
      ),
    ).toBe('/baby/Arquivo/doll');
    expect(
      projectNodeLogicalPath(
        nodeMap([baby, renamedNotes, movedDoll]),
        doll.nodeId,
      ),
    ).toBe('/baby/doll');
  });

  it('returns no path when the target is not cached', () => {
    expect(projectNodeLogicalPath(nodeMap([baby]), doll.nodeId)).toBeUndefined();
  });
});
