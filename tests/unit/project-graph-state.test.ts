import { describe, expect, it } from 'vitest';

import {
  createProjectGraphPageState,
  migrateProjectGraphPageState,
  readProjectGraphViewState,
} from '../../src/renderer/projects/project-graph-state';
import {
  DEFAULT_PROJECT_GRAPH_SETTINGS,
  PROJECT_GRAPH_SETTING_LIMITS,
} from '../../src/renderer/projects/project-graph-settings';

describe('project graph page state', () => {
  it('migrates version 1 camera and selection with default settings', () => {
    const state = migrateProjectGraphPageState({
      version: 1,
      data: {
        camera: { x: 18, y: -9, zoom: 2.4 },
        selectedNodeId: 'note-1',
      },
    });

    expect(state.version).toBe(2);
    expect(readProjectGraphViewState(state)).toEqual({
      camera: { x: 18, y: -9, zoom: 2.4 },
      layoutMode: 'orbit',
      selectedNodeId: 'note-1',
      settings: DEFAULT_PROJECT_GRAPH_SETTINGS,
    });
  });

  it('normalizes unsafe settings and zoom while preserving valid values', () => {
    const view = readProjectGraphViewState({
      version: 2,
      data: {
        camera: { x: 0, y: 0, zoom: 99 },
        selectedNodeId: null,
        settings: {
          nodeDistance: 180,
          repulsion: -50,
          springStrength: 'invalid',
        },
      },
    });

    expect(view?.camera.zoom).toBe(6);
    expect(view?.settings.nodeDistance).toBe(180);
    expect(view?.settings.repulsion).toBe(
      PROJECT_GRAPH_SETTING_LIMITS.repulsion.minimum,
    );
    expect(view?.settings.springStrength).toBe(
      DEFAULT_PROJECT_GRAPH_SETTINGS.springStrength,
    );
  });

  it('creates a complete version 2 state for a new graph page', () => {
    const state = createProjectGraphPageState();
    expect(state.version).toBe(2);
    expect(readProjectGraphViewState(state)).toEqual({
      camera: { x: 0, y: 0, zoom: 1 },
      layoutMode: 'orbit',
      selectedNodeId: null,
      settings: DEFAULT_PROJECT_GRAPH_SETTINGS,
    });
  });

  it('preserves an explicit force layout mode through a round trip', () => {
    const state = createProjectGraphPageState({
      camera: { x: 0, y: 0, zoom: 1 },
      layoutMode: 'force',
      selectedNodeId: null,
      settings: { ...DEFAULT_PROJECT_GRAPH_SETTINGS },
    });
    expect(readProjectGraphViewState(state)?.layoutMode).toBe('force');
  });
});
