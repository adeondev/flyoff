import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import refreshIcon from '../../../public/images/icons/actions/refresh.svg';
import type {
  ProjectGraphNode,
  ProjectGraphSnapshot,
  ProjectResult,
} from '../../shared/contracts';
import type { Translate } from '../pages/page-types';
import { MaskedIcon } from '../components/MaskedIcon';
import { getTooltipTargetProps } from '../components/tooltip';
import {
  clampProjectGraphZoom,
  createProjectGraphLayout,
  fitProjectGraphCamera,
  projectGraphScreenToWorld,
  projectGraphWorldToScreen,
  stepProjectGraphLayout,
  type ProjectGraphCamera,
  type ProjectGraphLayout,
  type ProjectGraphLayoutNode,
} from './project-graph-layout';

interface ProjectGraphPanelProps {
  loadGraph: () => Promise<ProjectResult<ProjectGraphSnapshot>>;
  onError: (message: string) => void;
  onOpenNode: (node: ProjectGraphNode) => void;
  refreshSignal?: unknown;
  translate: Translate;
}

interface PointerSession {
  lastTime: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  node?: ProjectGraphLayoutNode;
  pointerId: number;
}

interface GraphPalette {
  accent: string;
  edge: string;
  label: string;
  node: string;
  nodeMuted: string;
}

interface GraphRuntime {
  camera: ProjectGraphCamera;
  dirty: boolean;
  height: number;
  hovered?: ProjectGraphLayoutNode;
  layout: ProjectGraphLayout;
  lastFrame: number;
  layoutFrames: number;
  palette: GraphPalette;
  pointer?: PointerSession;
  raf?: number;
  selected?: ProjectGraphLayoutNode;
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

function graphPalette(): GraphPalette {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    accent: color('--color-accent-bright', '#bd6cff'),
    edge: color('--color-border-strong', '#4c4452'),
    label: color('--color-text', '#f7f3fa'),
    node: color('--color-accent', '#9c43d7'),
    nodeMuted: color('--color-text-muted', '#a39aa8'),
  };
}

function nodeRadius(node: ProjectGraphNode): number {
  return 4.6 + Math.min(4.8, Math.sqrt(node.connectionCount) * 1.1);
}

function fitCamera(runtime: GraphRuntime, immediate = false): void {
  const target = fitProjectGraphCamera(
    runtime.layout.nodes,
    runtime.width,
    runtime.height,
  );
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
    const radius = Math.max(10, nodeRadius(node) * runtime.camera.zoom + 5);
    if (Math.hypot(point.x - screen.x, point.y - screen.y) <= radius) {
      return node;
    }
  }
  return undefined;
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

  for (const edge of runtime.layout.edges) {
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
    context.lineWidth = Math.min(2.4, 0.75 + Math.log2(edge.weight + 1) * 0.45);
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.stroke();
  }
  context.globalAlpha = 1;

  const fontFamily =
    getComputedStyle(document.body).fontFamily || 'Inter, sans-serif';
  for (const node of runtime.layout.nodes) {
    const screen = projectGraphWorldToScreen(
      node,
      runtime.camera,
      runtime.width,
      runtime.height,
    );
    const radius = Math.max(
      3.2,
      Math.min(11.5, nodeRadius(node) * runtime.camera.zoom),
    );
    if (
      screen.x < -radius - 80 ||
      screen.x > runtime.width + radius + 80 ||
      screen.y < -radius - 20 ||
      screen.y > runtime.height + radius + 20
    ) {
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

    if (highlighted || runtime.camera.zoom >= 0.72) {
      context.fillStyle = runtime.palette.label;
      context.font = `${highlighted ? 600 : 500} 11px ${fontFamily}`;
      context.textAlign = 'center';
      context.textBaseline = 'top';
      const label =
        node.name.length > 26 ? `${node.name.slice(0, 25)}…` : node.name;
      context.fillText(label, screen.x, screen.y + radius + 6, 150);
    }
  }
}

export function ProjectGraphPanel({
  loadGraph,
  onError,
  onOpenNode,
  refreshSignal,
  translate,
}: ProjectGraphPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<GraphRuntime | undefined>(undefined);
  const previousLayoutRef = useRef<ProjectGraphLayout | undefined>(undefined);
  const onOpenNodeRef = useRef(onOpenNode);
  const refreshSequenceRef = useRef(0);
  const [snapshot, setSnapshot] = useState<ProjectGraphSnapshot>({
    edges: [],
    nodes: [],
  });
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>();
  const fitRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    onOpenNodeRef.current = onOpenNode;
  }, [onOpenNode]);

  const refresh = useCallback(async () => {
    const sequence = refreshSequenceRef.current + 1;
    refreshSequenceRef.current = sequence;
    setRefreshing(true);
    try {
      const result = await loadGraph();
      if (refreshSequenceRef.current !== sequence) {
        return;
      }
      if (result.ok) {
        setSnapshot(result.value);
      } else {
        onError(result.error.message);
      }
    } catch (error) {
      onError(String(error));
    } finally {
      if (refreshSequenceRef.current === sequence) {
        setRefreshing(false);
      }
    }
  }, [loadGraph, onError]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void refresh());
    return () => {
      window.cancelAnimationFrame(frame);
      refreshSequenceRef.current += 1;
    };
  }, [refresh, refreshSignal]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const layout = createProjectGraphLayout(
      snapshot,
      previousLayoutRef.current?.nodes,
    );
    previousLayoutRef.current = layout;
    const runtime: GraphRuntime = {
      camera: {
        targetX: 0,
        targetY: 0,
        targetZoom: 1,
        vx: 0,
        vy: 0,
        x: 0,
        y: 0,
        zoom: 1,
      },
      dirty: true,
      height: canvas.clientHeight,
      layout,
      lastFrame: performance.now(),
      layoutFrames: 0,
      palette: graphPalette(),
      visible: true,
      width: canvas.clientWidth,
    };
    runtimeRef.current = runtime;
    fitCamera(runtime, true);

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
      let moving = false;

      if (runtime.layoutFrames < 720 && runtime.layout.nodes.length > 1) {
        const energy = stepProjectGraphLayout(runtime.layout, elapsed);
        runtime.layoutFrames += 1;
        moving = energy > 0.025 && runtime.layoutFrames < 720;
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
        } else {
          runtime.camera.vx = 0;
          runtime.camera.vy = 0;
        }
      }

      const cameraResponse = reducedMotion()
        ? 1
        : 1 - Math.exp(-15.5 * elapsed);
      const camera = runtime.camera;
      camera.x += (camera.targetX - camera.x) * cameraResponse;
      camera.y += (camera.targetY - camera.y) * cameraResponse;
      camera.zoom += (camera.targetZoom - camera.zoom) * cameraResponse;
      const cameraSettled =
        Math.abs(camera.targetX - camera.x) < 0.01 &&
        Math.abs(camera.targetY - camera.y) < 0.01 &&
        Math.abs(camera.targetZoom - camera.zoom) < 0.0001;
      moving ||= !cameraSettled;

      if (runtime.dirty || moving) {
        drawGraph(canvas, runtime);
        runtime.dirty = false;
      }
      if (moving) {
        runtime.raf = window.requestAnimationFrame(frame);
      }
    };

    fitRef.current = () => {
      fitCamera(runtime);
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

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      runtime.visible = Boolean(entry?.isIntersecting);
      if (runtime.visible) {
        runtime.lastFrame = performance.now();
        wake();
      } else if (runtime.raf !== undefined) {
        window.cancelAnimationFrame(runtime.raf);
        runtime.raf = undefined;
      }
    });
    intersectionObserver.observe(canvas);

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
      const node = hitGraphNode(runtime, point);
      canvas.setPointerCapture(event.pointerId);
      runtime.camera.vx = 0;
      runtime.camera.vy = 0;
      runtime.pointer = {
        lastTime: performance.now(),
        lastX: point.x,
        lastY: point.y,
        moved: false,
        node,
        pointerId: event.pointerId,
      };
      if (node) {
        node.pinned = true;
        runtime.selected = node;
        setSelectedPath(node.path);
      }
      canvas.dataset.dragging = node ? 'node' : 'camera';
      wake();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const point = pointInCanvas(canvas, event.clientX, event.clientY);
      const pointer = runtime.pointer;
      if (!pointer || pointer.pointerId !== event.pointerId) {
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
      pointer.moved ||= Math.hypot(deltaX, deltaY) > 2;
      pointer.lastX = point.x;
      pointer.lastY = point.y;
      pointer.lastTime = performance.now();

      if (pointer.node) {
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
      if (pointer.node) {
        pointer.node.pinned = false;
        if (!pointer.moved) {
          onOpenNodeRef.current(pointer.node);
        }
      }
      runtime.pointer = undefined;
      delete canvas.dataset.dragging;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
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
        runtime.camera.targetZoom * Math.exp(-event.deltaY * 0.0015),
      );
      runtime.camera.targetZoom = zoom;
      runtime.camera.targetX =
        anchor.x - (point.x - runtime.width / 2) / zoom;
      runtime.camera.targetY =
        anchor.y - (point.y - runtime.height / 2) / zoom;
      runtime.camera.vx = 0;
      runtime.camera.vy = 0;
      wake();
    };

    const handleDoubleClick = (event: MouseEvent) => {
      const point = pointInCanvas(canvas, event.clientX, event.clientY);
      if (!hitGraphNode(runtime, point)) {
        fitCamera(runtime);
        wake();
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
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', endPointer);
      canvas.removeEventListener('pointercancel', endPointer);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      if (runtimeRef.current === runtime) {
        runtimeRef.current = undefined;
      }
    };
  }, [snapshot]);

  function handleKeyboard(event: KeyboardEvent<HTMLCanvasElement>): void {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.layout.nodes.length === 0) {
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      fitRef.current();
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
    runtime.camera.targetX = selected.x;
    runtime.camera.targetY = selected.y;
    setSelectedPath(selected.path);
    runtime.dirty = true;
    runtime.wake?.();
  }

  return (
    <aside
      aria-busy={refreshing}
      aria-label={translate('rail.graph')}
      className="home__sidebar project-graph"
    >
      <header className="project-graph__header">
        <h2>{translate('rail.graph')}</h2>
        <button
          aria-label={
            refreshing
              ? translate('graph.refreshing')
              : translate('graph.refresh')
          }
          className="project-graph__action"
          disabled={refreshing}
          onClick={() => void refresh()}
          type="button"
          {...getTooltipTargetProps(translate('graph.refresh'), 'bottom')}
        >
          <MaskedIcon icon={refreshIcon} />
        </button>
      </header>
      <div className="project-graph__viewport">
        <canvas
          aria-label={translate('graph.canvas')}
          className="project-graph__canvas"
          onKeyDown={handleKeyboard}
          ref={canvasRef}
          role="img"
          tabIndex={0}
        />
        {!refreshing && snapshot.nodes.length === 0 ? (
          <p className="project-graph__empty">{translate('graph.empty')}</p>
        ) : null}
      </div>
      <p className="project-graph__selection" aria-live="polite">
        {selectedPath ?? '\u00a0'}
      </p>
    </aside>
  );
}
