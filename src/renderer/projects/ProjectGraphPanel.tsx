import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';

import openInTabIcon from '../../../newicons/nova aba.svg';
import refreshIcon from '../../../public/images/icons/actions/refresh.svg';
import settingsIcon from '../../../public/images/icons/actions/settings-outline.svg';
import folderIcon from '../../../public/images/icons/instances/folder.svg';
import noteIcon from '../../../public/images/icons/instances/note.svg';
import type {
  ProjectGraphNode,
  ProjectGraphSnapshot,
  ProjectResult,
} from '../../shared/contracts';
import { TwemojiText } from '../components/twemoji';
import type { Translate } from '../pages/page-types';
import { MaskedIcon } from '../components/MaskedIcon';
import { ContextMenu, type MenuItem } from '../components/menu';
import { getTooltipTargetProps } from '../components/tooltip';
import { useFlyoffPreferences } from '../preferences';
import type { ProjectGraphController } from './project-graph-controller';
import { ProjectGraphSettingsPanel } from './ProjectGraphSettingsPanel';
import {
  clampProjectGraphZoom,
  fitProjectGraphCamera,
  projectGraphScreenToWorld,
  projectGraphWorldToScreen,
  stepProjectGraphLayout,
  type ProjectGraphCamera,
  type ProjectGraphLayout,
  type ProjectGraphLayoutNode,
} from './project-graph-layout';
import {
  buildProjectGraphOrbit,
  positionProjectGraphOrbit,
  type ProjectGraphOrbitBody,
  type ProjectGraphOrbitLayout,
} from './project-graph-orbit';
import {
  beginProjectGraphOrbitDrag,
  createProjectGraphOrbitMotion,
  endProjectGraphOrbitDrag,
  getProjectGraphOrbitPosition,
  hasProjectGraphOrbitMotion,
  moveProjectGraphOrbitBody,
  stepProjectGraphOrbitMotion,
  updateProjectGraphOrbitPositions,
  type ProjectGraphOrbitMotion,
} from './project-graph-orbit-motion';
import {
  resetProjectGraphModeSettings,
  type ProjectGraphForceSettings,
  type ProjectGraphSettings,
} from './project-graph-settings';
import type {
  ProjectGraphLayoutMode,
  ProjectGraphViewState,
} from './project-graph-state';

interface ProjectGraphPanelProps {
  controller: ProjectGraphController;
  initialViewState?: ProjectGraphViewState;
  loadGraph: () => Promise<ProjectResult<ProjectGraphSnapshot>>;
  onError: (message: string) => void;
  onOpenInTab?: () => void;
  onOpenNode: (node: ProjectGraphNode) => void;
  onViewStateChange?: (state: ProjectGraphViewState) => void;
  refreshSignal?: unknown;
  rootName?: string;
  translate: Translate;
  variant?: 'page' | 'sidebar';
}

interface OrbitHit {
  body: ProjectGraphOrbitBody;
  kind: 'note' | 'sun';
}

interface PointerSession {
  lastTime: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  node?: ProjectGraphLayoutNode;
  orbitHit?: OrbitHit;
  pointerId: number;
  startX: number;
  startY: number;
}

interface GraphPalette {
  accent: string;
  edge: string;
  label: string;
  node: string;
  nodeMuted: string;
  surface: string;
}

interface GraphRuntime {
  camera: ProjectGraphCamera;
  dirty: boolean;
  height: number;
  hovered?: ProjectGraphLayoutNode;
  hoveredOrbit?: ProjectGraphOrbitBody;
  layout: ProjectGraphLayout;
  lastFrame: number;
  layoutFrames: number;
  labels: ReadonlyMap<string, HTMLElement>;
  mode: ProjectGraphLayoutMode;
  orbit: ProjectGraphOrbitLayout;
  orbitFloatFrame: number;
  orbitMotion: ProjectGraphOrbitMotion;
  palette: GraphPalette;
  particlePhase: number;
  particlesActive: boolean;
  pointer?: PointerSession;
  raf?: number;
  selected?: ProjectGraphLayoutNode;
  selectedId: string | null;
  settings: ProjectGraphSettings;
  intersecting: boolean;
  visible: boolean;
  wake?: () => void;
  width: number;
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const ORBIT_FLOAT_FRAME_INTERVAL = 1_000 / 30;

function graphPalette(): GraphPalette {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    accent: color('--color-accent-bright', '#bd6cff'),
    edge: color('--color-border-strong', '#4c4452'),
    label: color('--color-text', '#e8e2ee'),
    node: color('--color-accent', '#9c43d7'),
    nodeMuted: color('--color-text-muted', '#a39aa8'),
    surface: color('--color-surface', '#29292e'),
  };
}

function nodeRadius(
  node: ProjectGraphNode,
  settings: ProjectGraphForceSettings,
): number {
  return (
    (4.6 + Math.min(4.8, Math.sqrt(node.connectionCount) * 1.1)) *
    settings.nodeScale
  );
}

function fitCamera(runtime: GraphRuntime, immediate = false): void {
  let points: readonly { x: number; y: number }[];
  if (runtime.mode === 'orbit') {
    positionProjectGraphOrbit(runtime.orbit);
    updateProjectGraphOrbitPositions(
      runtime.orbitMotion,
      0,
      runtime.settings.orbit,
      false,
      runtime.camera.zoom,
    );
    points = runtime.orbit.bodies.flatMap((body) => {
      const position = orbitBodyPosition(runtime, body);
      const radius = body.radius * runtime.settings.orbit.bodyScale;
      return [
        { x: position.x - radius, y: position.y - radius },
        { x: position.x + radius, y: position.y + radius },
      ];
    });
  } else {
    points = runtime.layout.nodes;
  }
  const target = fitProjectGraphCamera(points, runtime.width, runtime.height);
  Object.assign(runtime.camera, target);
  if (immediate || reducedMotion()) {
    runtime.camera.x = target.targetX;
    runtime.camera.y = target.targetY;
    runtime.camera.zoom = target.targetZoom;
  }
  runtime.camera.vx = 0;
  runtime.camera.vy = 0;
  runtime.dirty = true;
}

function pointInCanvas(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const bounds = canvas.getBoundingClientRect();
  return { x: clientX - bounds.left, y: clientY - bounds.top };
}

function hitGraphNode(
  runtime: GraphRuntime,
  point: { x: number; y: number },
): ProjectGraphLayoutNode | undefined {
  for (let index = runtime.layout.nodes.length - 1; index >= 0; index -= 1) {
    const node = runtime.layout.nodes[index]!;
    const screen = projectGraphWorldToScreen(
      node,
      runtime.camera,
      runtime.width,
      runtime.height,
    );
    const radius = Math.max(
      10,
      nodeRadius(node, runtime.settings.force) * runtime.camera.zoom + 5,
    );
    if (Math.hypot(point.x - screen.x, point.y - screen.y) <= radius) {
      return node;
    }
  }
  return undefined;
}

// Laps per second a particle travels from an edge's source to its target.
const PARTICLE_SPEED = 0.34;
// Irrational stride so consecutive edges start their particles out of phase.
const PARTICLE_STRIDE = 0.618_033_988_749_895;
// Upper bound on particles drawn per frame; edges are already viewport-culled,
// but very dense graphs still need a ceiling to stay cheap.
const PARTICLE_BUDGET = 520;

// Draws the animated dot(s) flowing along a single (already visible) edge and
// returns how many were painted. The caller sets the fill colour once so this
// only touches globalAlpha. Assumes source/target are screen-space points.
function drawEdgeParticles(
  context: CanvasRenderingContext2D,
  source: { x: number; y: number },
  target: { x: number; y: number },
  phase: number,
  index: number,
  density: number,
  edgeScale: number,
): number {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (length < 26) {
    return 0;
  }
  const lanes = density > 1 ? 2 : 1;
  const radius = 1.4 + 0.9 * edgeScale;
  const baseOffset = (index * PARTICLE_STRIDE) % 1;
  let drawn = 0;
  for (let lane = 0; lane < lanes; lane += 1) {
    const laneStrength =
      lane === 0 ? Math.min(1, density) : Math.min(1, density - 1);
    if (laneStrength <= 0.02) {
      continue;
    }
    const travel = (phase * PARTICLE_SPEED + baseOffset + lane * 0.5) % 1;
    // Fade in near the source and out near the target so dots never pop.
    const envelope = Math.sin(Math.PI * travel);
    const alpha = 0.82 * envelope * laneStrength;
    if (alpha <= 0.02) {
      continue;
    }
    const x = source.x + dx * travel;
    const y = source.y + dy * travel;
    context.globalAlpha = alpha;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    drawn += 1;
  }
  context.globalAlpha = 1;
  return drawn;
}

function drawGraph(
  canvas: HTMLCanvasElement,
  runtime: GraphRuntime,
): void {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(runtime.width * ratio));
  const pixelHeight = Math.max(1, Math.round(runtime.height * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, runtime.width, runtime.height);
  context.lineCap = 'round';
  context.strokeStyle = runtime.palette.edge;
  const settings = runtime.settings.force;

  const particleDensity = settings.linkParticles;
  const drawParticles = runtime.particlesActive && particleDensity > 0;
  let particlesDrawn = 0;
  let edgeIndex = 0;

  for (const edge of runtime.layout.edges) {
    const index = edgeIndex;
    edgeIndex += 1;
    const source = projectGraphWorldToScreen(
      edge.source,
      runtime.camera,
      runtime.width,
      runtime.height,
    );
    const target = projectGraphWorldToScreen(
      edge.target,
      runtime.camera,
      runtime.width,
      runtime.height,
    );
    if (
      Math.max(source.x, target.x) < -20 ||
      Math.min(source.x, target.x) > runtime.width + 20 ||
      Math.max(source.y, target.y) < -20 ||
      Math.min(source.y, target.y) > runtime.height + 20
    ) {
      continue;
    }
    context.globalAlpha = Math.min(0.72, 0.26 + edge.weight * 0.08);
    context.lineWidth =
      Math.min(2.4, 0.75 + Math.log2(edge.weight + 1) * 0.45) *
      settings.edgeScale;
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.stroke();

    if (drawParticles && particlesDrawn < PARTICLE_BUDGET) {
      context.fillStyle = runtime.palette.accent;
      particlesDrawn += drawEdgeParticles(
        context,
        source,
        target,
        runtime.particlePhase,
        index,
        particleDensity,
        settings.edgeScale,
      );
    }
  }
  context.globalAlpha = 1;

  for (const node of runtime.layout.nodes) {
    const label = runtime.labels.get(node.nodeId);
    const screen = projectGraphWorldToScreen(
      node,
      runtime.camera,
      runtime.width,
      runtime.height,
    );
    const radius = Math.max(
      3.2,
      Math.min(
        11.5 * settings.nodeScale,
        nodeRadius(node, settings) * runtime.camera.zoom,
      ),
    );
    if (
      screen.x < -radius - 80 ||
      screen.x > runtime.width + radius + 80 ||
      screen.y < -radius - 20 ||
      screen.y > runtime.height + radius + 20
    ) {
      if (label) {
        label.hidden = true;
      }
      continue;
    }
    const highlighted =
      runtime.hovered === node || runtime.selected === node;
    context.fillStyle = highlighted
      ? runtime.palette.accent
      : node.connectionCount > 0
        ? runtime.palette.node
        : runtime.palette.nodeMuted;
    context.beginPath();
    context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    context.fill();

    if (highlighted || runtime.camera.zoom >= settings.labelZoom) {
      if (label) {
        label.hidden = false;
        label.dataset.highlighted = highlighted ? 'true' : 'false';
        label.style.transform =
          `translate3d(${screen.x}px, ${screen.y + radius + 6}px, 0) ` +
          'translateX(-50%)';
      }
    } else if (label) {
      label.hidden = true;
    }
  }
}

// ---- Orbit (solar system) mode ----

function setupCanvas(
  canvas: HTMLCanvasElement,
  runtime: GraphRuntime,
): CanvasRenderingContext2D | null {
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(runtime.width * ratio));
  const pixelHeight = Math.max(1, Math.round(runtime.height * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, runtime.width, runtime.height);
  return context;
}

function orbitBodyToGraphNode(body: ProjectGraphOrbitBody): ProjectGraphNode {
  return {
    connectionCount: body.connectionCount,
    name: body.name,
    nodeId: body.id,
    path: body.path,
  };
}

function orbitBodyPosition(
  runtime: GraphRuntime,
  body: ProjectGraphOrbitBody,
): { x: number; y: number } {
  return getProjectGraphOrbitPosition(runtime.orbitMotion, body);
}

function hitOrbitBody(
  runtime: GraphRuntime,
  point: { x: number; y: number },
): OrbitHit | undefined {
  const { camera, width, height, orbit } = runtime;
  const { bodyScale } = runtime.settings.orbit;
  for (let index = orbit.notes.length - 1; index >= 0; index -= 1) {
    const body = orbit.notes[index]!;
    const screen = projectGraphWorldToScreen(
      orbitBodyPosition(runtime, body),
      camera,
      width,
      height,
    );
    const radius = Math.max(9, body.radius * bodyScale * camera.zoom + 4);
    if (Math.hypot(point.x - screen.x, point.y - screen.y) <= radius) {
      return { body, kind: 'note' };
    }
  }
  for (let index = orbit.suns.length - 1; index >= 0; index -= 1) {
    const body = orbit.suns[index]!;
    const screen = projectGraphWorldToScreen(
      orbitBodyPosition(runtime, body),
      camera,
      width,
      height,
    );
    const radius = Math.max(12, body.radius * bodyScale * camera.zoom);
    if (Math.hypot(point.x - screen.x, point.y - screen.y) <= radius) {
      return { body, kind: 'sun' };
    }
  }
  return undefined;
}

function drawOrbit(canvas: HTMLCanvasElement, runtime: GraphRuntime): void {
  const context = setupCanvas(canvas, runtime);
  if (!context) {
    return;
  }
  const { camera, width, height, orbit, palette } = runtime;
  const { zoom } = camera;
  const settings = runtime.settings.orbit;

  // Orbit mode paints its own labels on the canvas; keep the DOM labels hidden.
  for (const label of runtime.labels.values()) {
    label.hidden = true;
  }

  const onScreen = (point: { x: number; y: number }, margin: number) =>
    point.x >= -margin &&
    point.x <= width + margin &&
    point.y >= -margin &&
    point.y <= height + margin;

  context.strokeStyle = palette.edge;
  context.lineWidth = 1;
  context.globalAlpha = 0.24;
  const drawRing = (center: { x: number; y: number }, radius: number) => {
    if (radius < 4 || !onScreen(center, radius)) {
      return;
    }
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.stroke();
  };
  for (const sun of orbit.suns) {
    const center = projectGraphWorldToScreen(
      orbitBodyPosition(runtime, sun),
      camera,
      width,
      height,
    );
    const note = orbit.byId.get(sun.memberNoteIds[0] ?? '');
    const childSun = orbit.byId.get(sun.childSunIds[0] ?? '');
    const noteRadius = (note?.orbitRadius ?? 0) * settings.spacing * zoom;
    const childSunRadius =
      (childSun?.orbitRadius ?? 0) * settings.spacing * zoom;
    drawRing(center, noteRadius);
    if (Math.abs(childSunRadius - noteRadius) >= 0.5) {
      drawRing(center, childSunRadius);
    }
  }
  context.globalAlpha = 1;

  // Connections between notes (faint).
  context.lineCap = 'round';
  context.strokeStyle = palette.edge;
  for (const edge of orbit.edges) {
    if (settings.edgeScale === 0) {
      break;
    }
    const source = projectGraphWorldToScreen(
      orbitBodyPosition(runtime, edge.source),
      camera,
      width,
      height,
    );
    const target = projectGraphWorldToScreen(
      orbitBodyPosition(runtime, edge.target),
      camera,
      width,
      height,
    );
    if (
      Math.max(source.x, target.x) < -20 ||
      Math.min(source.x, target.x) > width + 20 ||
      Math.max(source.y, target.y) < -20 ||
      Math.min(source.y, target.y) > height + 20
    ) {
      continue;
    }
    context.globalAlpha = Math.min(0.34, 0.1 + edge.weight * 0.045);
    context.lineWidth =
      Math.min(2, 0.6 + Math.log2(edge.weight + 1) * 0.35) *
      settings.edgeScale;
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.stroke();
  }
  context.globalAlpha = 1;

  // Suns (folders): core + label.
  context.textAlign = 'center';
  context.textBaseline = 'top';
  for (const sun of orbit.suns) {
    const screen = projectGraphWorldToScreen(
      orbitBodyPosition(runtime, sun),
      camera,
      width,
      height,
    );
    const radius = Math.max(3, sun.radius * settings.bodyScale * zoom);
    if (!onScreen(screen, radius + 120)) {
      continue;
    }
    context.fillStyle = sun.parentId === null ? palette.accent : palette.node;
    context.beginPath();
    context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    context.fill();

    context.font = '600 12px system-ui, -apple-system, sans-serif';
    context.lineJoin = 'round';
    context.strokeStyle = palette.surface;
    context.lineWidth = 3;
    context.strokeText(sun.name, screen.x, screen.y + radius + 5, 180);
    context.fillStyle = palette.label;
    context.fillText(sun.name, screen.x, screen.y + radius + 5, 180);
  }

  // Notes orbiting their sun.
  context.font = '11px system-ui, -apple-system, sans-serif';
  for (const note of orbit.notes) {
    const screen = projectGraphWorldToScreen(
      orbitBodyPosition(runtime, note),
      camera,
      width,
      height,
    );
    const radius = Math.max(
      2.6,
      Math.min(9 * settings.bodyScale, note.radius * settings.bodyScale * zoom),
    );
    if (!onScreen(screen, radius + 90)) {
      continue;
    }
    const highlighted =
      runtime.hoveredOrbit?.id === note.id || runtime.selectedId === note.id;
    context.fillStyle = highlighted
      ? palette.accent
      : note.connectionCount > 0
        ? palette.node
        : palette.nodeMuted;
    context.beginPath();
    context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    context.fill();
    if (highlighted || zoom >= settings.labelZoom) {
      context.lineJoin = 'round';
      context.strokeStyle = palette.surface;
      context.lineWidth = 3;
      context.strokeText(note.name, screen.x, screen.y + radius + 4, 160);
      context.fillStyle = palette.label;
      context.fillText(note.name, screen.x, screen.y + radius + 4, 160);
    }
  }
}

export function ProjectGraphPanel({
  controller,
  initialViewState,
  loadGraph,
  onError,
  onOpenInTab,
  onOpenNode,
  onViewStateChange,
  refreshSignal,
  rootName,
  translate,
  variant = 'sidebar',
}: ProjectGraphPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const labelRefs = useRef(new Map<string, HTMLSpanElement>());
  const runtimeRef = useRef<GraphRuntime | undefined>(undefined);
  const onOpenNodeRef = useRef(onOpenNode);
  const onViewStateChangeRef = useRef(onViewStateChange);
  const wheelSettleTimerRef = useRef<number | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { preferences, update: updatePreferences } = useFlyoffPreferences();
  const settings = preferences.graph;
  const layoutMode = settings.layoutMode;
  const settingsRef = useRef(settings);
  const layoutModeRef = useRef(layoutMode);
  useEffect(() => {
    settingsRef.current = settings;
    layoutModeRef.current = layoutMode;
  }, [layoutMode, settings]);
  const graphState = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const fitRef = useRef<() => void>(() => undefined);
  const onOpenSystemRef = useRef<
    ((sun: ProjectGraphOrbitBody, x: number, y: number) => void) | undefined
  >(undefined);
  const [folderPopup, setFolderPopup] = useState<{
    name: string;
    notes: readonly ProjectGraphNode[];
    subfolders: readonly { id: string; name: string }[];
    x: number;
    y: number;
  } | null>(null);
  const selectedPath = graphState.graph.nodes.find(
    ({ nodeId }) => nodeId === graphState.selectedNodeId,
  )?.path;
  const surfaceName =
    layoutMode === 'orbit'
      ? translate('graph.orbitTitle')
      : translate('rail.graph');
  const openInTabLabel = translate(
    layoutMode === 'orbit'
      ? 'graph.openOrbitInTab'
      : 'graph.openGraphInTab',
  );
  const openSettingsLabel = translate(
    layoutMode === 'orbit'
      ? 'graph.openOrbitSettings'
      : 'graph.openGraphSettings',
  );
  const folderMenuItems = useMemo<readonly MenuItem[]>(() => {
    if (!folderPopup) {
      return [];
    }
    const count = folderPopup.notes.length + folderPopup.subfolders.length;
    const items: MenuItem[] = [
      {
        id: 'folder-summary',
        kind: 'label',
        label: `${folderPopup.name} · ${count}`,
      },
    ];
    folderPopup.subfolders.forEach((folder, index) => {
      items.push({
        id: `folder-${index}`,
        icon: folderIcon,
        kind: 'action',
        label: folder.name,
      });
    });
    folderPopup.notes.forEach((note, index) => {
      items.push({
        id: `note-${index}`,
        icon: noteIcon,
        kind: 'action',
        label: note.name,
      });
    });
    if (count === 0) {
      items.push({
        id: 'folder-empty',
        kind: 'label',
        label: translate('graph.folderEmpty'),
      });
    }
    return items;
  }, [folderPopup, translate]);

  useLayoutEffect(() => {
    controller.restoreView(initialViewState);
  }, [controller, initialViewState]);

  useEffect(() => {
    onOpenSystemRef.current = (sun, x, y) => {
      const orbit = runtimeRef.current?.orbit;
      if (!orbit) {
        return;
      }
      const resolve = (id: string) => orbit.byId.get(id);
      setFolderPopup({
        name: sun.name,
        notes: sun.memberNoteIds
          .map(resolve)
          .filter((body): body is ProjectGraphOrbitBody => Boolean(body))
          .map(orbitBodyToGraphNode),
        subfolders: sun.childSunIds
          .map(resolve)
          .filter((body): body is ProjectGraphOrbitBody => Boolean(body))
          .map((body) => ({ id: body.id, name: body.name })),
        x,
        y,
      });
    };
  }, []);

  const focusOrbitBody = useCallback((bodyId: string) => {
    const runtime = runtimeRef.current;
    const body = runtime?.orbit.byId.get(bodyId);
    if (!runtime || !body) {
      return;
    }
    const position = orbitBodyPosition(runtime, body);
    runtime.camera.targetX = position.x;
    runtime.camera.targetY = position.y;
    runtime.camera.targetZoom = clampProjectGraphZoom(
      Math.max(runtime.camera.targetZoom, 1.1),
    );
    runtime.camera.vx = 0;
    runtime.camera.vy = 0;
    setFolderPopup(null);
    runtime.wake?.();
  }, []);

  const folderPopupOpenRef = useRef(false);
  useEffect(() => {
    folderPopupOpenRef.current = folderPopup !== null;
  }, [folderPopup]);

  // Close the folder popup when the graph reloads (mode changes close it too).
  useEffect(() => {
    if (!folderPopupOpenRef.current) {
      return;
    }
    setFolderPopup(null);
  }, [graphState.graph]);

  useEffect(() => {
    onOpenNodeRef.current = onOpenNode;
  }, [onOpenNode]);

  useEffect(() => {
    onViewStateChangeRef.current = onViewStateChange;
  }, [onViewStateChange]);

  const publishViewState = useCallback(() => {
    onViewStateChangeRef.current?.(controller.viewState());
  }, [controller]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
  }, []);

  const changeSetting = useCallback(
    (nextSettings: ProjectGraphSettings) => {
      updatePreferences((current) => ({
        ...current,
        graph: nextSettings,
      }));
    },
    [updatePreferences],
  );

  const resetSettings = useCallback(() => {
    updatePreferences((current) => ({
      ...current,
      graph: resetProjectGraphModeSettings(
        current.graph,
        current.graph.layoutMode,
      ),
    }));
  }, [updatePreferences]);

  const changeLayoutMode = useCallback(
    (mode: ProjectGraphLayoutMode) => {
      updatePreferences((current) => ({
        ...current,
        graph: { ...current.graph, layoutMode: mode },
      }));
    },
    [updatePreferences],
  );

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }
    runtime.selectedId = graphState.selectedNodeId;
    runtime.selected = runtime.layout.nodes.find(
      ({ nodeId }) => nodeId === graphState.selectedNodeId,
    );
    runtime.dirty = true;
    runtime.wake?.();
  }, [graphState.selectedNodeId]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.mode === layoutMode) {
      return;
    }
    runtime.mode = layoutMode;
    setFolderPopup(null);
    fitRef.current();
    runtime.dirty = true;
    runtime.wake?.();
  }, [layoutMode]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }
    const previous = runtime.settings;
    runtime.settings = settings;
    if (
      previous.force.centerStrength !== settings.force.centerStrength ||
      previous.force.damping !== settings.force.damping ||
      previous.force.nodeDistance !== settings.force.nodeDistance ||
      previous.force.repulsion !== settings.force.repulsion ||
      previous.force.simulationSpeed !== settings.force.simulationSpeed ||
      previous.force.springStrength !== settings.force.springStrength
    ) {
      runtime.layoutFrames = 0;
    }
    runtime.dirty = true;
    runtime.wake?.();
  }, [settings]);

  const refresh = useCallback(async () => {
    await controller.refresh(refreshSignal, loadGraph, onError, true);
  }, [controller, loadGraph, onError, refreshSignal]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void controller.refresh(refreshSignal, loadGraph, onError);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [controller, loadGraph, onError, refreshSignal]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const layout = graphState.layout;
    const orbit = buildProjectGraphOrbit(graphState.graph, { rootName });
    // Orbit is a static layout — place every body once so it has world
    // coordinates even when a saved camera skips the initial fit.
    positionProjectGraphOrbit(orbit);
    const orbitMotion = createProjectGraphOrbitMotion(orbit);
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const runtime: GraphRuntime = {
      camera: controller.camera,
      dirty: true,
      height: canvas.clientHeight,
      intersecting: true,
      layout,
      lastFrame: performance.now(),
      layoutFrames: 0,
      labels: new Map(labelRefs.current),
      mode: layoutModeRef.current,
      orbit,
      orbitFloatFrame: Number.NEGATIVE_INFINITY,
      orbitMotion,
      palette: graphPalette(),
      particlePhase: 0,
      particlesActive: false,
      selectedId: controller.getSelectedNodeId(),
      settings: settingsRef.current,
      visible: true,
      width: canvas.clientWidth,
    };
    runtime.selected =
      layout.nodes.find(
        ({ nodeId }) => nodeId === controller.getSelectedNodeId(),
      );
    runtimeRef.current = runtime;
    if (!controller.hasCamera() && graphState.graph.nodes.length > 0) {
      fitCamera(runtime, true);
      controller.markCameraReady();
      publishViewState();
    }

    const wake = () => {
      runtime.dirty = true;
      if (runtime.visible && runtime.raf === undefined) {
        runtime.raf = window.requestAnimationFrame(frame);
      }
    };
    runtime.wake = wake;

    const frame = (time: number) => {
      runtime.raf = undefined;
      if (!runtime.visible) {
        return;
      }
      const elapsed = Math.min(0.05, Math.max(0.001, (time - runtime.lastFrame) / 1_000));
      runtime.lastFrame = time;
      const reduced = motionQuery.matches;
      let moving = false;
      let shouldDraw = runtime.dirty;

      if (runtime.mode === 'orbit') {
        const hadMotion = hasProjectGraphOrbitMotion(runtime.orbitMotion);
        const motionActive = hadMotion
          ? stepProjectGraphOrbitMotion(
              runtime.orbitMotion,
              elapsed,
              runtime.settings.orbit,
            )
          : false;
        const floating =
          !reduced && runtime.settings.orbit.floatStrength > 0;
        const floatDue =
          floating &&
          time - runtime.orbitFloatFrame >= ORBIT_FLOAT_FRAME_INTERVAL;
        if (floatDue) {
          runtime.orbitFloatFrame = time;
        }
        if (shouldDraw || hadMotion || floatDue) {
          const worldMargin = 180 / runtime.camera.zoom;
          const halfWidth = runtime.width / (runtime.camera.zoom * 2);
          const halfHeight = runtime.height / (runtime.camera.zoom * 2);
          updateProjectGraphOrbitPositions(
            runtime.orbitMotion,
            runtime.orbitFloatFrame / 1_000,
            runtime.settings.orbit,
            floating,
            runtime.camera.zoom,
            {
              maximumX: runtime.camera.x + halfWidth + worldMargin,
              maximumY: runtime.camera.y + halfHeight + worldMargin,
              minimumX: runtime.camera.x - halfWidth - worldMargin,
              minimumY: runtime.camera.y - halfHeight - worldMargin,
            },
          );
          shouldDraw = true;
        }
        moving = motionActive || floating;
      } else if (
        runtime.layoutFrames < 720 &&
        runtime.layout.nodes.length > 1
      ) {
        const energy = stepProjectGraphLayout(
          runtime.layout,
          elapsed,
          runtime.settings.force,
        );
        runtime.layoutFrames += 1;
        moving = energy > 0.025 && runtime.layoutFrames < 720;
        shouldDraw = true;
      }

      if (!runtime.pointer) {
        const friction = Math.exp(-7.2 * elapsed);
        if (Math.abs(runtime.camera.vx) + Math.abs(runtime.camera.vy) > 0.04) {
          runtime.camera.x += runtime.camera.vx * elapsed;
          runtime.camera.y += runtime.camera.vy * elapsed;
          runtime.camera.vx *= friction;
          runtime.camera.vy *= friction;
          runtime.camera.targetX = runtime.camera.x;
          runtime.camera.targetY = runtime.camera.y;
          moving = true;
          shouldDraw = true;
        } else {
          runtime.camera.vx = 0;
          runtime.camera.vy = 0;
        }
      }

      const cameraResponse = reduced ? 1 : 1 - Math.exp(-15.5 * elapsed);
      const camera = runtime.camera;
      camera.x += (camera.targetX - camera.x) * cameraResponse;
      camera.y += (camera.targetY - camera.y) * cameraResponse;
      camera.zoom += (camera.targetZoom - camera.zoom) * cameraResponse;
      const cameraSettled =
        Math.abs(camera.targetX - camera.x) < 0.01 &&
        Math.abs(camera.targetY - camera.y) < 0.01 &&
        Math.abs(camera.targetZoom - camera.zoom) < 0.0001;
      moving ||= !cameraSettled;
      shouldDraw ||= !cameraSettled;

      // Link particles keep the loop alive on their own; when the setting is
      // off (or the user prefers reduced motion) the canvas still sleeps once
      // the layout and camera settle. Orbit mode animates on its own instead.
      runtime.particlesActive =
        runtime.mode === 'force' &&
        runtime.settings.force.linkParticles > 0 &&
        !reduced;
      if (runtime.particlesActive) {
        runtime.particlePhase = (runtime.particlePhase + elapsed) % 1_000;
        moving = true;
        shouldDraw = true;
      }

      if (shouldDraw) {
        if (runtime.mode === 'orbit') {
          drawOrbit(canvas, runtime);
        } else {
          drawGraph(canvas, runtime);
        }
        runtime.dirty = false;
      }
      if (moving) {
        runtime.raf = window.requestAnimationFrame(frame);
      }
    };

    fitRef.current = () => {
      fitCamera(runtime);
      controller.markCameraReady();
      publishViewState();
      wake();
    };

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      if (width <= 0 || height <= 0) {
        return;
      }
      const firstSize = runtime.width <= 0 || runtime.height <= 0;
      runtime.width = width;
      runtime.height = height;
      if (firstSize) {
        fitCamera(runtime, true);
      }
      wake();
    });
    resizeObserver.observe(canvas);

    const syncVisibility = () => {
      runtime.visible = runtime.intersecting && !document.hidden;
      if (runtime.visible) {
        runtime.lastFrame = performance.now();
        wake();
      } else if (runtime.raf !== undefined) {
        window.cancelAnimationFrame(runtime.raf);
        runtime.raf = undefined;
      }
    };
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      runtime.intersecting = Boolean(entry?.isIntersecting);
      syncVisibility();
    });
    intersectionObserver.observe(canvas);
    const handleVisibilityChange = () => syncVisibility();
    const handleMotionPreferenceChange = () => wake();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    motionQuery.addEventListener('change', handleMotionPreferenceChange);

    const themeObserver = new MutationObserver(() => {
      runtime.palette = graphPalette();
      wake();
    });
    themeObserver.observe(document.documentElement, {
      attributeFilter: ['data-theme', 'style'],
      attributes: true,
    });

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const point = pointInCanvas(canvas, event.clientX, event.clientY);
      canvas.setPointerCapture(event.pointerId);
      runtime.camera.vx = 0;
      runtime.camera.vy = 0;

      if (runtime.mode === 'orbit') {
        const orbitHit = hitOrbitBody(runtime, point);
        runtime.pointer = {
          lastTime: performance.now(),
          lastX: point.x,
          lastY: point.y,
          moved: false,
          orbitHit,
          pointerId: event.pointerId,
          startX: point.x,
          startY: point.y,
        };
        if (orbitHit) {
          beginProjectGraphOrbitDrag(runtime.orbitMotion, orbitHit.body.id);
        }
        if (orbitHit?.kind === 'note') {
          runtime.selectedId = orbitHit.body.id;
          controller.setSelectedNodeId(orbitHit.body.id);
        }
        canvas.dataset.dragging = orbitHit ? 'node' : 'camera';
        wake();
        return;
      }

      const node = hitGraphNode(runtime, point);
      runtime.pointer = {
        lastTime: performance.now(),
        lastX: point.x,
        lastY: point.y,
        moved: false,
        node,
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
      };
      if (node) {
        node.pinned = true;
        runtime.selected = node;
        runtime.selectedId = node.nodeId;
        controller.setSelectedNodeId(node.nodeId);
      }
      canvas.dataset.dragging = node ? 'node' : 'camera';
      wake();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const point = pointInCanvas(canvas, event.clientX, event.clientY);
      const pointer = runtime.pointer;
      if (!pointer || pointer.pointerId !== event.pointerId) {
        if (runtime.mode === 'orbit') {
          const orbitHit = hitOrbitBody(runtime, point);
          if (orbitHit?.body !== runtime.hoveredOrbit) {
            runtime.hoveredOrbit = orbitHit?.body;
            canvas.dataset.hovering = orbitHit ? 'true' : 'false';
            wake();
          }
          return;
        }
        const hovered = hitGraphNode(runtime, point);
        if (hovered !== runtime.hovered) {
          runtime.hovered = hovered;
          canvas.dataset.hovering = hovered ? 'true' : 'false';
          wake();
        }
        return;
      }

      const deltaX = point.x - pointer.lastX;
      const deltaY = point.y - pointer.lastY;
      const elapsed = Math.max(
        1 / 240,
        (performance.now() - pointer.lastTime) / 1_000,
      );
      pointer.moved ||=
        Math.hypot(point.x - pointer.startX, point.y - pointer.startY) > 2;
      pointer.lastX = point.x;
      pointer.lastY = point.y;
      pointer.lastTime = performance.now();

      if (pointer.orbitHit) {
        moveProjectGraphOrbitBody(
          runtime.orbitMotion,
          pointer.orbitHit.body.id,
          deltaX / runtime.camera.zoom,
          deltaY / runtime.camera.zoom,
        );
      } else if (pointer.node) {
        const world = projectGraphScreenToWorld(
          point,
          runtime.camera,
          runtime.width,
          runtime.height,
        );
        pointer.node.x = world.x;
        pointer.node.y = world.y;
        runtime.layoutFrames = Math.min(runtime.layoutFrames, 560);
      } else {
        const worldDeltaX = deltaX / runtime.camera.zoom;
        const worldDeltaY = deltaY / runtime.camera.zoom;
        runtime.camera.x -= worldDeltaX;
        runtime.camera.y -= worldDeltaY;
        runtime.camera.targetX = runtime.camera.x;
        runtime.camera.targetY = runtime.camera.y;
        runtime.camera.vx = -worldDeltaX / elapsed;
        runtime.camera.vy = -worldDeltaY / elapsed;
      }
      wake();
    };

    const endPointer = (event: PointerEvent) => {
      const pointer = runtime.pointer;
      if (!pointer || pointer.pointerId !== event.pointerId) {
        return;
      }
      const cancelled = event.type === 'pointercancel';
      if (runtime.mode === 'orbit') {
        if (pointer.orbitHit) {
          const { body, kind } = pointer.orbitHit;
          endProjectGraphOrbitDrag(
            runtime.orbitMotion,
            body.id,
            reducedMotion(),
          );
          if (!cancelled && !pointer.moved) {
            if (kind === 'note') {
              onOpenNodeRef.current(orbitBodyToGraphNode(body));
            } else {
              onOpenSystemRef.current?.(body, event.clientX, event.clientY);
            }
          }
        }
      } else if (pointer.node) {
        pointer.node.pinned = false;
        if (!cancelled && !pointer.moved) {
          onOpenNodeRef.current(pointer.node);
        }
      }
      runtime.pointer = undefined;
      delete canvas.dataset.dragging;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      publishViewState();
      wake();
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = pointInCanvas(canvas, event.clientX, event.clientY);
      const anchor = projectGraphScreenToWorld(
        point,
        {
          x: runtime.camera.targetX,
          y: runtime.camera.targetY,
          zoom: runtime.camera.targetZoom,
        },
        runtime.width,
        runtime.height,
      );
      const zoom = clampProjectGraphZoom(
        runtime.camera.targetZoom *
          Math.exp(
            -event.deltaY *
              0.0015 *
              (runtime.mode === 'orbit'
                ? runtime.settings.orbit.zoomSensitivity
                : runtime.settings.force.zoomSensitivity),
          ),
      );
      runtime.camera.targetZoom = zoom;
      runtime.camera.targetX =
        anchor.x - (point.x - runtime.width / 2) / zoom;
      runtime.camera.targetY =
        anchor.y - (point.y - runtime.height / 2) / zoom;
      runtime.camera.vx = 0;
      runtime.camera.vy = 0;
      if (wheelSettleTimerRef.current !== undefined) {
        window.clearTimeout(wheelSettleTimerRef.current);
      }
      wheelSettleTimerRef.current = window.setTimeout(() => {
        wheelSettleTimerRef.current = undefined;
        publishViewState();
      }, 120);
      wake();
    };

    const handleDoubleClick = (event: MouseEvent) => {
      const point = pointInCanvas(canvas, event.clientX, event.clientY);
      const hit =
        runtime.mode === 'orbit'
          ? hitOrbitBody(runtime, point)
          : hitGraphNode(runtime, point);
      if (!hit) {
        fitRef.current();
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('dblclick', handleDoubleClick);
    wake();

    return () => {
      if (runtime.raf !== undefined) {
        window.cancelAnimationFrame(runtime.raf);
      }
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      motionQuery.removeEventListener('change', handleMotionPreferenceChange);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', endPointer);
      canvas.removeEventListener('pointercancel', endPointer);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      if (wheelSettleTimerRef.current !== undefined) {
        window.clearTimeout(wheelSettleTimerRef.current);
        wheelSettleTimerRef.current = undefined;
        publishViewState();
      }
      if (runtimeRef.current === runtime) {
        runtimeRef.current = undefined;
      }
    };
  }, [controller, graphState.graph, graphState.layout, publishViewState, rootName]);

  function handleKeyboard(event: KeyboardEvent<HTMLCanvasElement>): void {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      fitRef.current();
      return;
    }
    if (runtime.mode === 'orbit') {
      if (event.key === 'Enter' && runtime.selectedId) {
        const note = runtime.orbit.byId.get(runtime.selectedId);
        if (note && note.kind === 'note') {
          event.preventDefault();
          onOpenNode(orbitBodyToGraphNode(note));
        }
      }
      return;
    }
    if (runtime.layout.nodes.length === 0) {
      return;
    }
    if (event.key === 'Enter' && runtime.selected) {
      event.preventDefault();
      onOpenNode(runtime.selected);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = runtime.selected
      ? runtime.layout.nodes.indexOf(runtime.selected)
      : -1;
    const direction =
      event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const nextIndex =
      (currentIndex + direction + runtime.layout.nodes.length) %
      runtime.layout.nodes.length;
    const selected = runtime.layout.nodes[nextIndex]!;
    runtime.selected = selected;
    controller.setSelectedNodeId(selected.nodeId);
    runtime.camera.targetX = selected.x;
    runtime.camera.targetY = selected.y;
    runtime.dirty = true;
    publishViewState();
    runtime.wake?.();
  }

  return (
    <section
      aria-busy={graphState.refreshing}
      aria-label={surfaceName}
      className={`${variant === 'sidebar' ? 'home__sidebar ' : ''}project-graph`}
      data-mode={layoutMode}
      data-variant={variant}
    >
      <header className="project-graph__header">
        <h2>{surfaceName}</h2>
        <div className="project-graph__actions">
          {onOpenInTab ? (
            <button
              aria-label={openInTabLabel}
              className="project-graph__action"
              onClick={onOpenInTab}
              type="button"
              {...getTooltipTargetProps(openInTabLabel, 'bottom')}
            >
              <MaskedIcon icon={openInTabIcon} />
            </button>
          ) : null}
          <button
            aria-label={
              graphState.refreshing
                ? translate('graph.refreshing')
                : translate('graph.refresh')
            }
            className="project-graph__action"
            disabled={graphState.refreshing}
            onClick={() => void refresh()}
            type="button"
            {...getTooltipTargetProps(translate('graph.refresh'), 'bottom')}
          >
            <MaskedIcon icon={refreshIcon} />
          </button>
          {variant === 'page' ? (
            <button
              aria-expanded={settingsOpen}
              aria-label={openSettingsLabel}
              className="project-graph__action"
              onClick={() => setSettingsOpen((open) => !open)}
              ref={settingsButtonRef}
              type="button"
              {...getTooltipTargetProps(
                openSettingsLabel,
                'bottom',
              )}
            >
              <MaskedIcon icon={settingsIcon} />
            </button>
          ) : null}
        </div>
      </header>
      <div className="project-graph__body">
        <div className="project-graph__viewport">
          <canvas
            aria-label={translate('graph.canvas')}
            className="project-graph__canvas"
            onKeyDown={handleKeyboard}
            ref={canvasRef}
            role="img"
            tabIndex={0}
          />
          <div aria-hidden="true" className="project-graph__labels">
            {graphState.graph.nodes.map((node) => (
              <span
                className="project-graph__label"
                hidden
                key={node.nodeId}
                ref={(element) => {
                  if (element) {
                    labelRefs.current.set(node.nodeId, element);
                  } else {
                    labelRefs.current.delete(node.nodeId);
                  }
                }}
              >
                <TwemojiText text={node.name} />
              </span>
            ))}
          </div>
          {!graphState.refreshing && graphState.graph.nodes.length === 0 ? (
            <p className="project-graph__empty">{translate('graph.empty')}</p>
          ) : null}
          {folderPopup ? (
            <ContextMenu
              ariaLabel={folderPopup.name}
              items={folderMenuItems}
              onAction={(actionId) => {
                const [kind, indexValue] = actionId.split('-');
                const index = Number(indexValue);
                if (kind === 'folder') {
                  const folder = folderPopup.subfolders[index];
                  if (folder) {
                    focusOrbitBody(folder.id);
                  }
                  return;
                }
                const note = folderPopup.notes[index];
                if (kind === 'note' && note) {
                  setFolderPopup(null);
                  onOpenNode(note);
                }
              }}
              onClose={() => setFolderPopup(null)}
              x={folderPopup.x}
              y={folderPopup.y}
            />
          ) : null}
        </div>
        {variant === 'page' && settingsOpen ? (
          <ProjectGraphSettingsPanel
            onChange={changeSetting}
            onChangeMode={changeLayoutMode}
            onClose={closeSettings}
            onFit={() => fitRef.current()}
            onReset={resetSettings}
            settings={settings}
            translate={translate}
          />
        ) : null}
      </div>
      <p className="project-graph__selection" aria-live="polite">
        <TwemojiText text={selectedPath ?? '\u00a0'} />
      </p>
    </section>
  );
}
