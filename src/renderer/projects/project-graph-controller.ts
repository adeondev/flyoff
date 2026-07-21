import type {
  ProjectGraphSnapshot,
  ProjectResult,
} from '../../shared/contracts';
import {
  createProjectGraphLayout,
  type ProjectGraphCamera,
  type ProjectGraphLayout,
} from './project-graph-layout';
import {
  DEFAULT_PROJECT_GRAPH_SETTINGS,
  normalizeProjectGraphSettings,
  projectGraphSettingsEqual,
  type ProjectGraphSettings,
} from './project-graph-settings';
import {
  DEFAULT_PROJECT_GRAPH_LAYOUT_MODE,
  type ProjectGraphLayoutMode,
  type ProjectGraphViewState,
} from './project-graph-state';

export interface ProjectGraphControllerSnapshot {
  graph: ProjectGraphSnapshot;
  layout: ProjectGraphLayout;
  layoutMode: ProjectGraphLayoutMode;
  refreshing: boolean;
  selectedNodeId: string | null;
  settings: ProjectGraphSettings;
}

const EMPTY_GRAPH: ProjectGraphSnapshot = { edges: [], nodes: [] };

function createCamera(): ProjectGraphCamera {
  return {
    targetX: 0,
    targetY: 0,
    targetZoom: 1,
    vx: 0,
    vy: 0,
    x: 0,
    y: 0,
    zoom: 1,
  };
}

export class ProjectGraphController {
  readonly camera = createCamera();

  private cameraReady = false;
  private lastRefreshSignal: unknown;
  private listeners = new Set<() => void>();
  private refreshSequence = 0;
  private snapshot: ProjectGraphControllerSnapshot = {
    graph: EMPTY_GRAPH,
    layout: createProjectGraphLayout(EMPTY_GRAPH),
    layoutMode: DEFAULT_PROJECT_GRAPH_LAYOUT_MODE,
    refreshing: false,
    selectedNodeId: null,
    settings: { ...DEFAULT_PROJECT_GRAPH_SETTINGS },
  };

  constructor(readonly projectId?: string) {}

  getSnapshot = (): ProjectGraphControllerSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  hasCamera(): boolean {
    return this.cameraReady;
  }

  markCameraReady(): void {
    this.cameraReady = true;
  }

  getSelectedNodeId(): string | null {
    return this.snapshot.selectedNodeId;
  }

  setSelectedNodeId(nodeId: string | null): void {
    if (nodeId !== this.snapshot.selectedNodeId) {
      this.publish({ ...this.snapshot, selectedNodeId: nodeId });
    }
  }

  setSettings(settings: ProjectGraphSettings): void {
    const normalized = normalizeProjectGraphSettings(settings);
    if (!projectGraphSettingsEqual(normalized, this.snapshot.settings)) {
      this.publish({ ...this.snapshot, settings: normalized });
    }
  }

  getLayoutMode(): ProjectGraphLayoutMode {
    return this.snapshot.layoutMode;
  }

  setLayoutMode(layoutMode: ProjectGraphLayoutMode): void {
    if (layoutMode !== this.snapshot.layoutMode) {
      this.publish({ ...this.snapshot, layoutMode });
    }
  }

  restoreView(view: ProjectGraphViewState | undefined): void {
    if (!view || this.cameraReady) {
      return;
    }
    Object.assign(this.camera, {
      targetX: view.camera.x,
      targetY: view.camera.y,
      targetZoom: view.camera.zoom,
      vx: 0,
      vy: 0,
      x: view.camera.x,
      y: view.camera.y,
      zoom: view.camera.zoom,
    });
    this.cameraReady = true;
    this.publish({
      ...this.snapshot,
      layoutMode: view.layoutMode,
      selectedNodeId: view.selectedNodeId,
      settings: normalizeProjectGraphSettings(view.settings),
    });
  }

  viewState(): ProjectGraphViewState {
    return {
      camera: {
        x: this.camera.targetX,
        y: this.camera.targetY,
        zoom: this.camera.targetZoom,
      },
      layoutMode: this.snapshot.layoutMode,
      selectedNodeId: this.snapshot.selectedNodeId,
      settings: { ...this.snapshot.settings },
    };
  }

  async refresh(
    refreshSignal: unknown,
    loadGraph: () => Promise<ProjectResult<ProjectGraphSnapshot>>,
    onError: (message: string) => void,
    force = false,
  ): Promise<void> {
    if (
      this.lastRefreshSignal === refreshSignal &&
      (this.snapshot.refreshing ||
        (!force && this.snapshot.graph !== EMPTY_GRAPH))
    ) {
      return;
    }
    this.lastRefreshSignal = refreshSignal;
    const sequence = ++this.refreshSequence;
    this.publish({ ...this.snapshot, refreshing: true });
    try {
      const result = await loadGraph();
      if (sequence !== this.refreshSequence) {
        return;
      }
      if (!result.ok) {
        onError(result.error.message);
        return;
      }
      const layout = createProjectGraphLayout(
        result.value,
        this.snapshot.layout.nodes,
      );
      const selectedNodeId =
        this.snapshot.selectedNodeId &&
        result.value.nodes.some(
          ({ nodeId }) => nodeId === this.snapshot.selectedNodeId,
        )
          ? this.snapshot.selectedNodeId
          : null;
      this.publish({
        graph: result.value,
        layout,
        layoutMode: this.snapshot.layoutMode,
        refreshing: false,
        selectedNodeId,
        settings: this.snapshot.settings,
      });
    } catch (error) {
      if (sequence === this.refreshSequence) {
        onError(String(error));
      }
    } finally {
      if (sequence === this.refreshSequence && this.snapshot.refreshing) {
        this.publish({ ...this.snapshot, refreshing: false });
      }
    }
  }

  private publish(snapshot: ProjectGraphControllerSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
