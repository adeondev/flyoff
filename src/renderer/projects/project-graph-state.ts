import type { PageSessionState } from '../../shared/contracts';
import { clampProjectGraphZoom } from './project-graph-layout';
import {
  DEFAULT_PROJECT_GRAPH_SETTINGS,
  normalizeProjectGraphSettings,
  type ProjectGraphSettings,
} from './project-graph-settings';

export interface ProjectGraphViewState {
  camera: {
    x: number;
    y: number;
    zoom: number;
  };
  selectedNodeId: string | null;
  settings: ProjectGraphSettings;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function readProjectGraphViewState(
  state: PageSessionState,
): ProjectGraphViewState | undefined {
  if (
    (state.version !== 1 && state.version !== 2) ||
    !state.data ||
    typeof state.data !== 'object' ||
    Array.isArray(state.data)
  ) {
    return undefined;
  }
  const data = state.data as Record<string, unknown>;
  const camera = data.camera;
  if (
    !camera ||
    typeof camera !== 'object' ||
    Array.isArray(camera)
  ) {
    return undefined;
  }
  const values = camera as Record<string, unknown>;
  if (
    !finiteNumber(values.x) ||
    !finiteNumber(values.y) ||
    !finiteNumber(values.zoom)
  ) {
    return undefined;
  }
  const selectedNodeId =
    typeof data.selectedNodeId === 'string' && data.selectedNodeId.length <= 256
      ? data.selectedNodeId
      : null;
  return {
    camera: {
      x: values.x,
      y: values.y,
      zoom: clampProjectGraphZoom(values.zoom),
    },
    selectedNodeId,
    settings:
      state.version === 2
        ? normalizeProjectGraphSettings(data.settings)
        : { ...DEFAULT_PROJECT_GRAPH_SETTINGS },
  };
}

export function createProjectGraphPageState(
  view?: ProjectGraphViewState,
): PageSessionState {
  const resolved = view ?? {
    camera: { x: 0, y: 0, zoom: 1 },
    selectedNodeId: null,
    settings: { ...DEFAULT_PROJECT_GRAPH_SETTINGS },
  };
  const settings = normalizeProjectGraphSettings(resolved.settings);
  return {
    version: 2,
    data: {
      camera: {
        x: resolved.camera.x,
        y: resolved.camera.y,
        zoom: clampProjectGraphZoom(resolved.camera.zoom),
      },
      selectedNodeId: resolved.selectedNodeId,
      settings: {
        centerStrength: settings.centerStrength,
        damping: settings.damping,
        edgeScale: settings.edgeScale,
        labelZoom: settings.labelZoom,
        nodeDistance: settings.nodeDistance,
        nodeScale: settings.nodeScale,
        repulsion: settings.repulsion,
        simulationSpeed: settings.simulationSpeed,
        springStrength: settings.springStrength,
        zoomSensitivity: settings.zoomSensitivity,
      },
    },
  };
}

export function migrateProjectGraphPageState(
  state: PageSessionState,
): PageSessionState {
  const view = readProjectGraphViewState(state);
  return view ? createProjectGraphPageState(view) : createProjectGraphPageState();
}
