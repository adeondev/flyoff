import { describe, expect, it } from 'vitest';

import {
  createProjectGraphLayout,
  fitProjectGraphCamera,
  projectGraphScreenToWorld,
  projectGraphWorldToScreen,
  stepProjectGraphLayout,
} from '../../src/renderer/projects/project-graph-layout';
import type { ProjectGraphSnapshot } from '../../src/shared/contracts';

const snapshot: ProjectGraphSnapshot = {
  nodes: [
    {
      connectionCount: 1,
      name: 'A',
      nodeId: '11111111-1111-4111-8111-111111111111',
      path: 'A',
    },
    {
      connectionCount: 1,
      name: 'B',
      nodeId: '22222222-2222-4222-8222-222222222222',
      path: 'B',
    },
  ],
  edges: [
    {
      sourceNodeId: '11111111-1111-4111-8111-111111111111',
      targetNodeId: '22222222-2222-4222-8222-222222222222',
      weight: 1,
    },
  ],
};

describe('project graph layout', () => {
  it('creates deterministic connected nodes and preserves existing positions', () => {
    const first = createProjectGraphLayout(snapshot);
    const second = createProjectGraphLayout(snapshot);
    expect(
      first.nodes.map(({ x, y }) => ({ x, y })),
    ).toEqual(second.nodes.map(({ x, y }) => ({ x, y })));
    expect(first.edges[0]?.source).toBe(first.nodes[0]);

    first.nodes[0]!.x = 321;
    const refreshed = createProjectGraphLayout(snapshot, first.nodes);
    expect(refreshed.nodes[0]?.x).toBe(321);
  });

  it('advances the force simulation and fits its bounds', () => {
    const layout = createProjectGraphLayout(snapshot);
    const before = layout.nodes.map(({ x, y }) => ({ x, y }));
    const energy = stepProjectGraphLayout(layout, 1 / 60);
    expect(energy).toBeGreaterThan(0);
    expect(layout.nodes.map(({ x, y }) => ({ x, y }))).not.toEqual(before);

    const camera = fitProjectGraphCamera(layout.nodes, 800, 600);
    expect(camera.targetZoom).toBeGreaterThan(0);
    expect(camera.targetZoom).toBeLessThanOrEqual(1.45);
  });

  it('converts screen and world coordinates without drift', () => {
    const camera = { x: 40, y: -20, zoom: 1.75 };
    const world = { x: 120, y: 60 };
    const screen = projectGraphWorldToScreen(world, camera, 900, 700);
    expect(
      projectGraphScreenToWorld(screen, camera, 900, 700),
    ).toEqual(world);
  });
});
