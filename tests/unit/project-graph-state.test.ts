import { describe, expect, it } from 'vitest';

import {
  createProjectGraphPageState,
  migrateProjectGraphPageState,
  readProjectGraphViewState,
} from '../../src/renderer/projects/project-graph-state';

describe('project graph page state', () => {
  it.each([1, 2, 3])(
    'migrates version %s camera and selection without legacy preferences',
    (version) => {
      const state = migrateProjectGraphPageState({
        version,
        data: {
          camera: { x: 18, y: -9, zoom: 2.4 },
          layoutMode: 'force',
          selectedNodeId: 'note-1',
          settings: {
            force: { nodeDistance: 180 },
            orbit: { spacing: 1.6 },
          },
        },
      });

      expect(state).toEqual({
        version: 4,
        data: {
          camera: { x: 18, y: -9, zoom: 2.4 },
          selectedNodeId: 'note-1',
        },
      });
      expect(readProjectGraphViewState(state)).toEqual({
        camera: { x: 18, y: -9, zoom: 2.4 },
        selectedNodeId: 'note-1',
      });
    },
  );

  it('normalizes zoom and rejects an oversized selection', () => {
    const view = readProjectGraphViewState({
      version: 4,
      data: {
        camera: { x: 0, y: 0, zoom: 99 },
        selectedNodeId: 'x'.repeat(257),
      },
    });

    expect(view).toEqual({
      camera: { x: 0, y: 0, zoom: 6 },
      selectedNodeId: null,
    });
  });

  it('creates a compact version 4 state for a new graph page', () => {
    const state = createProjectGraphPageState();
    expect(state).toEqual({
      version: 4,
      data: {
        camera: { x: 0, y: 0, zoom: 1 },
        selectedNodeId: null,
      },
    });
  });

  it('preserves camera and selection through a round trip', () => {
    const state = createProjectGraphPageState({
      camera: { x: 24, y: -12, zoom: 1.7 },
      selectedNodeId: 'note-2',
    });

    expect(readProjectGraphViewState(state)).toEqual({
      camera: { x: 24, y: -12, zoom: 1.7 },
      selectedNodeId: 'note-2',
    });
  });
});
