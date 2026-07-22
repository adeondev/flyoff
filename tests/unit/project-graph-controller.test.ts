import { describe, expect, it, vi } from 'vitest';

import { ProjectGraphController } from '../../src/renderer/projects/project-graph-controller';

const graph = {
  edges: [],
  nodes: [
    {
      connectionCount: 0,
      name: 'Nota',
      nodeId: '11111111-1111-4111-8111-111111111111',
      path: '/Nota',
    },
  ],
};

describe('project graph controller', () => {
  it('deduplicates the same graph revision and preserves its layout', async () => {
    const controller = new ProjectGraphController();
    const load = vi.fn(async () => ({ ok: true as const, value: graph }));
    const signal = {};

    await controller.refresh(signal, load, vi.fn());
    const layout = controller.getSnapshot().layout;
    await controller.refresh(signal, load, vi.fn());

    expect(load).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().layout).toBe(layout);
  });

  it('restores and exposes a small camera and selection state', () => {
    const controller = new ProjectGraphController();
    controller.restoreView({
      camera: { x: 12, y: -8, zoom: 1.5 },
      selectedNodeId: graph.nodes[0]!.nodeId,
    });

    expect(controller.camera).toMatchObject({
      targetX: 12,
      targetY: -8,
      targetZoom: 1.5,
      x: 12,
      y: -8,
      zoom: 1.5,
    });
    expect(controller.viewState()).toEqual({
      camera: { x: 12, y: -8, zoom: 1.5 },
      selectedNodeId: graph.nodes[0]!.nodeId,
    });
  });
});
