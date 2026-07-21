import { describe, expect, it, vi } from 'vitest';

import { ProjectGraphController } from '../../src/renderer/projects/project-graph-controller';
import { DEFAULT_PROJECT_GRAPH_SETTINGS } from '../../src/renderer/projects/project-graph-settings';

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
      layoutMode: 'force',
      selectedNodeId: graph.nodes[0]!.nodeId,
      settings: { ...DEFAULT_PROJECT_GRAPH_SETTINGS },
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
      layoutMode: 'force',
      selectedNodeId: graph.nodes[0]!.nodeId,
      settings: DEFAULT_PROJECT_GRAPH_SETTINGS,
    });
  });

  it('defaults to orbit mode and toggles the layout mode', () => {
    const controller = new ProjectGraphController();
    expect(controller.getLayoutMode()).toBe('orbit');
    expect(controller.viewState().layoutMode).toBe('orbit');

    controller.setLayoutMode('force');
    expect(controller.getLayoutMode()).toBe('force');
    expect(controller.viewState().layoutMode).toBe('force');
  });

  it('publishes validated settings without rebuilding the layout', async () => {
    const controller = new ProjectGraphController();
    await controller.refresh({}, async () => ({ ok: true, value: graph }), vi.fn());
    const layout = controller.getSnapshot().layout;

    controller.setSettings({
      ...DEFAULT_PROJECT_GRAPH_SETTINGS,
      nodeDistance: 180,
      repulsion: 999_999,
    });

    expect(controller.getSnapshot().layout).toBe(layout);
    expect(controller.getSnapshot().settings).toMatchObject({
      nodeDistance: 180,
      repulsion: 16_000,
    });
    expect(controller.viewState().settings.nodeDistance).toBe(180);
  });
});
