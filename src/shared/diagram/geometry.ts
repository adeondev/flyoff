import type {
  DiagramBounds,
  DiagramPoint,
  DiagramViewport,
} from './types';

export const DIAGRAM_MIN_ZOOM = 0.15;
export const DIAGRAM_MAX_ZOOM = 4;

export function clampDiagramZoom(zoom: number): number {
  return Math.min(DIAGRAM_MAX_ZOOM, Math.max(DIAGRAM_MIN_ZOOM, zoom));
}

export function snapDiagramValue(value: number, gridSize: number): number {
  return gridSize > 0 ? Math.round(value / gridSize) * gridSize : value;
}

export function snapDiagramPoint(
  point: DiagramPoint,
  gridSize: number,
): DiagramPoint {
  return {
    x: snapDiagramValue(point.x, gridSize),
    y: snapDiagramValue(point.y, gridSize),
  };
}

export function diagramBoundsUnion(
  bounds: readonly DiagramBounds[],
): DiagramBounds | null {
  if (bounds.length === 0) {
    return null;
  }
  const left = Math.min(...bounds.map(({ x }) => x));
  const top = Math.min(...bounds.map(({ y }) => y));
  const right = Math.max(...bounds.map(({ x, width }) => x + width));
  const bottom = Math.max(...bounds.map(({ y, height }) => y + height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function zoomDiagramAtPoint(
  viewport: DiagramViewport,
  screenPoint: DiagramPoint,
  nextZoom: number,
): DiagramViewport {
  const zoom = clampDiagramZoom(nextZoom);
  const worldX = (screenPoint.x - viewport.x) / viewport.zoom;
  const worldY = (screenPoint.y - viewport.y) / viewport.zoom;
  return {
    x: screenPoint.x - worldX * zoom,
    y: screenPoint.y - worldY * zoom,
    zoom,
  };
}

export function fitDiagramBounds(
  content: DiagramBounds | null,
  viewportSize: { width: number; height: number },
  padding = 48,
): DiagramViewport {
  if (!content || content.width <= 0 || content.height <= 0) {
    return { x: viewportSize.width / 2, y: viewportSize.height / 2, zoom: 1 };
  }
  const availableWidth = Math.max(1, viewportSize.width - padding * 2);
  const availableHeight = Math.max(1, viewportSize.height - padding * 2);
  const zoom = clampDiagramZoom(
    Math.min(availableWidth / content.width, availableHeight / content.height),
  );
  return {
    x: (viewportSize.width - content.width * zoom) / 2 - content.x * zoom,
    y: (viewportSize.height - content.height * zoom) / 2 - content.y * zoom,
    zoom,
  };
}
