import { describe, expect, it } from 'vitest';

import type { ProjectGraphSnapshot } from '../../src/shared/contracts';
import { projectGraphSnapshotEqual } from '../../src/renderer/projects/project-graph-snapshot';

function node(nodeId: string, name: string, connectionCount = 0) {
  return { connectionCount, name, nodeId, path: `/${name}` };
}

function snapshot(): ProjectGraphSnapshot {
  return {
    nodes: [node('a', 'Alpha', 1), node('b', 'Beta', 2)],
    edges: [{ sourceNodeId: 'a', targetNodeId: 'b', weight: 1 }],
  };
}

describe('projectGraphSnapshotEqual', () => {
  it('treats distinct but structurally identical snapshots as equal', () => {
    expect(projectGraphSnapshotEqual(snapshot(), snapshot())).toBe(true);
  });

  it('is reference-short-circuited', () => {
    const value = snapshot();
    expect(projectGraphSnapshotEqual(value, value)).toBe(true);
  });

  it('detects a changed node name', () => {
    const changed = snapshot();
    changed.nodes = [node('a', 'Renamed', 1), node('b', 'Beta', 2)];
    expect(projectGraphSnapshotEqual(snapshot(), changed)).toBe(false);
  });

  it('detects a changed connection count', () => {
    const changed = snapshot();
    changed.nodes = [node('a', 'Alpha', 9), node('b', 'Beta', 2)];
    expect(projectGraphSnapshotEqual(snapshot(), changed)).toBe(false);
  });

  it('detects an added or removed node', () => {
    const changed = snapshot();
    changed.nodes = [node('a', 'Alpha', 1)];
    expect(projectGraphSnapshotEqual(snapshot(), changed)).toBe(false);
  });

  it('detects a changed edge endpoint', () => {
    const changed = snapshot();
    changed.edges = [{ sourceNodeId: 'a', targetNodeId: 'a', weight: 1 }];
    expect(projectGraphSnapshotEqual(snapshot(), changed)).toBe(false);
  });

  it('detects a changed edge weight', () => {
    const changed = snapshot();
    changed.edges = [{ sourceNodeId: 'a', targetNodeId: 'b', weight: 5 }];
    expect(projectGraphSnapshotEqual(snapshot(), changed)).toBe(false);
  });
});
