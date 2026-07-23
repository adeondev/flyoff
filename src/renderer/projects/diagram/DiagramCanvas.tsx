import { useEffect, useMemo, useRef, useState } from 'react';

import {
  diagramBoundsUnion,
  snapDiagramValue,
  zoomDiagramAtPoint,
  type DiagramBounds,
  type DiagramDocument,
  type DiagramNodePresentation,
  type DiagramPoint,
  type DiagramViewport,
} from '../../../shared/diagram';
import {
  DiagramEdgeRenderer,
  DiagramMarkerDefinitions,
  DiagramNodeRenderer,
} from './diagram-renderers';
import {
  getEffectiveDiagramNodePresentation,
  resizeDiagramNodeBounds,
  type DiagramResizeHandle,
} from './diagram-geometry';

export type DiagramSelection =
  | { kind: 'element'; id: string }
  | { kind: 'relationship'; id: string };

export type DiagramEditorTool =
  | { kind: 'select' }
  | { kind: 'connect'; relationshipKind: DiagramDocument['relationships'][number]['kind'] }
  | { kind: 'create'; elementKind: DiagramDocument['elements'][number]['kind'] };

interface DiagramCanvasProps {
  document: DiagramDocument;
  viewport: DiagramViewport;
  selection?: DiagramSelection;
  tool: DiagramEditorTool;
  connectionSourceId?: string;
  ariaLabel: string;
  minimapLabel: string;
  onConnectionNode: (elementId: string) => void;
  onCreateElement: (kind: DiagramDocument['elements'][number]['kind'], point: DiagramPoint) => void;
  onMoveElement: (elementId: string, x: number, y: number) => void;
  onResizeElement: (elementId: string, bounds: DiagramBounds) => void;
  onSelectionChange: (selection?: DiagramSelection) => void;
  onViewportChange: (viewport: DiagramViewport) => void;
  onKeyDown: (event: React.KeyboardEvent<SVGSVGElement>) => void;
}

type PointerGesture =
  | {
      mode: 'pan';
      pointerId: number;
      start: DiagramPoint;
      viewport: DiagramViewport;
    }
  | {
      mode: 'move';
      pointerId: number;
      start: DiagramPoint;
      elementId: string;
      origin: DiagramPoint;
    }
  | {
      mode: 'resize';
      pointerId: number;
      start: DiagramPoint;
      elementId: string;
      handle: DiagramResizeHandle;
      origin: DiagramBounds;
    };

function localPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): DiagramPoint {
  const rect = svg.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function worldPoint(point: DiagramPoint, viewport: DiagramViewport): DiagramPoint {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
}

export function DiagramCanvas({
  ariaLabel,
  connectionSourceId,
  document,
  minimapLabel,
  onConnectionNode,
  onCreateElement,
  onKeyDown,
  onMoveElement,
  onResizeElement,
  onSelectionChange,
  onViewportChange,
  selection,
  tool,
  viewport,
}: DiagramCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<PointerGesture | undefined>(undefined);
  const [size, setSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const update = () => {
      const rect = svg.getBoundingClientRect();
      setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const elements = useMemo(
    () => new Map(document.elements.map((element) => [element.id, element])),
    [document.elements],
  );
  const effectiveNodes = useMemo(
    () => document.presentations.nodes.map((node) => {
      const element = elements.get(node.elementId);
      return element ? getEffectiveDiagramNodePresentation(element, node) : node;
    }),
    [document.presentations.nodes, elements],
  );
  const nodes = useMemo(
    () => new Map(effectiveNodes.map((node) => [node.elementId, node])),
    [effectiveNodes],
  );
  const edgePresentations = useMemo(
    () => new Map(document.presentations.edges.map((edge) => [edge.relationshipId, edge])),
    [document.presentations.edges],
  );

  function beginBackgroundGesture(event: React.PointerEvent<SVGSVGElement>): void {
    if (event.target !== event.currentTarget || event.button !== 0) {
      return;
    }
    event.currentTarget.focus({ preventScroll: true });
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    if (tool.kind === 'create') {
      onCreateElement(tool.elementKind, worldPoint(point, viewport));
      return;
    }
    onSelectionChange(undefined);
    gestureRef.current = {
      mode: 'pan',
      pointerId: event.pointerId,
      start: point,
      viewport,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function beginNodeGesture(
    event: React.PointerEvent<SVGGElement>,
    elementId: string,
  ): void {
    event.stopPropagation();
    const svg = svgRef.current;
    const presentation = nodes.get(elementId);
    if (!svg || !presentation || event.button !== 0) {
      return;
    }
    svg.focus({ preventScroll: true });
    if (tool.kind === 'connect') {
      onConnectionNode(elementId);
      return;
    }
    onSelectionChange({ kind: 'element', id: elementId });
    const point = localPoint(svg, event.clientX, event.clientY);
    gestureRef.current = {
      mode: 'move',
      pointerId: event.pointerId,
      start: point,
      elementId,
      origin: { x: presentation.bounds.x, y: presentation.bounds.y },
    };
    svg.setPointerCapture(event.pointerId);
  }

  function beginResizeGesture(
    event: React.PointerEvent<SVGRectElement>,
    elementId: string,
    handle: DiagramResizeHandle,
  ): void {
    event.stopPropagation();
    const svg = svgRef.current;
    const presentation = nodes.get(elementId);
    if (!svg || !presentation || event.button !== 0) {
      return;
    }
    svg.focus({ preventScroll: true });
    onSelectionChange({ kind: 'element', id: elementId });
    gestureRef.current = {
      mode: 'resize',
      pointerId: event.pointerId,
      start: localPoint(svg, event.clientX, event.clientY),
      elementId,
      handle,
      origin: presentation.bounds,
    };
    svg.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>): void {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    if (gesture.mode === 'pan') {
      onViewportChange({
        ...gesture.viewport,
        x: gesture.viewport.x + point.x - gesture.start.x,
        y: gesture.viewport.y + point.y - gesture.start.y,
      });
      return;
    }
    if (gesture.mode === 'resize') {
      const element = elements.get(gesture.elementId);
      if (!element) {
        return;
      }
      onResizeElement(
        gesture.elementId,
        resizeDiagramNodeBounds(
          element,
          gesture.origin,
          gesture.handle,
          {
            x: (point.x - gesture.start.x) / viewport.zoom,
            y: (point.y - gesture.start.y) / viewport.zoom,
          },
          document.settings.snapToGrid ? document.settings.gridSize : undefined,
        ),
      );
      return;
    }
    const x = gesture.origin.x + (point.x - gesture.start.x) / viewport.zoom;
    const y = gesture.origin.y + (point.y - gesture.start.y) / viewport.zoom;
    onMoveElement(
      gesture.elementId,
      document.settings.snapToGrid
        ? snapDiagramValue(x, document.settings.gridSize)
        : x,
      document.settings.snapToGrid
        ? snapDiagramValue(y, document.settings.gridSize)
        : y,
    );
  }

  function endGesture(event: React.PointerEvent<SVGSVGElement>): void {
    if (gestureRef.current?.pointerId === event.pointerId) {
      gestureRef.current = undefined;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>): void {
    event.preventDefault();
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    const factor = Math.exp(-event.deltaY * 0.0015);
    onViewportChange(zoomDiagramAtPoint(viewport, point, viewport.zoom * factor));
  }

  function handleDoubleClick(event: React.MouseEvent<SVGSVGElement>): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    const defaults: Record<DiagramDocument['diagramType'], DiagramDocument['elements'][number]['kind']> = {
      class: 'class',
      'use-case': 'use-case',
      sequence: 'lifeline',
      activity: 'action',
    };
    onCreateElement(
      defaults[document.diagramType],
      worldPoint(localPoint(event.currentTarget, event.clientX, event.clientY), viewport),
    );
  }

  return (
    <div className="diagram-canvas-shell">
      <svg
        aria-label={ariaLabel}
        className={`diagram-canvas diagram-canvas--${tool.kind}`}
        onDoubleClick={handleDoubleClick}
        onKeyDown={onKeyDown}
        onPointerCancel={endGesture}
        onPointerDown={beginBackgroundGesture}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onWheel={handleWheel}
        ref={svgRef}
        role="application"
        tabIndex={0}
      >
        <DiagramMarkerDefinitions />
        {document.settings.showGrid ? (
          <g className="diagram-grid" pointerEvents="none" transform={`translate(${viewport.x % (document.settings.gridSize * viewport.zoom)} ${viewport.y % (document.settings.gridSize * viewport.zoom)})`}>
            <defs>
              <pattern height={document.settings.gridSize * viewport.zoom} id="diagram-grid-pattern" patternUnits="userSpaceOnUse" width={document.settings.gridSize * viewport.zoom}>
                <circle cx="1" cy="1" r="0.75" />
              </pattern>
            </defs>
            <rect fill="url(#diagram-grid-pattern)" height="100%" width="100%" x={-document.settings.gridSize * viewport.zoom} y={-document.settings.gridSize * viewport.zoom} />
          </g>
        ) : null}
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {document.relationships.map((relationship) => {
            const source = nodes.get(relationship.sourceId);
            const target = nodes.get(relationship.targetId);
            return source && target ? (
              <DiagramEdgeRenderer
                key={relationship.id}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelectionChange({ kind: 'relationship', id: relationship.id });
                }}
                presentation={edgePresentations.get(relationship.id)}
                relationship={relationship}
                selected={selection?.kind === 'relationship' && selection.id === relationship.id}
                source={source}
                target={target}
              />
            ) : null;
          })}
          {[...effectiveNodes]
            .sort((left, right) => {
              const leftKind = elements.get(left.elementId)?.kind;
              const rightKind = elements.get(right.elementId)?.kind;
              const leftContainer =
                leftKind === 'activity-partition' || leftKind === 'system-boundary';
              const rightContainer =
                rightKind === 'activity-partition' || rightKind === 'system-boundary';
              return Number(rightContainer) - Number(leftContainer) ||
                left.zIndex - right.zIndex;
            })
            .map((presentation) => {
              const element = elements.get(presentation.elementId);
              return element ? (
                <DiagramNodeRenderer
                  element={element}
                  key={presentation.id}
                  onPointerDown={(event) => beginNodeGesture(event, element.id)}
                  onResizePointerDown={(event, handle) =>
                    beginResizeGesture(event, element.id, handle)
                  }
                  presentation={presentation}
                  selected={
                    (selection?.kind === 'element' && selection.id === element.id) ||
                    connectionSourceId === element.id
                  }
                  showResizeHandles={
                    tool.kind === 'select' &&
                    selection?.kind === 'element' &&
                    selection.id === element.id
                  }
                  viewportZoom={viewport.zoom}
                />
              ) : null;
            })}
        </g>
      </svg>
      <DiagramMinimap
        ariaLabel={minimapLabel}
        nodes={effectiveNodes}
        size={size}
        viewport={viewport}
      />
    </div>
  );
}

function DiagramMinimap({
  ariaLabel,
  nodes,
  size,
  viewport,
}: {
  ariaLabel: string;
  nodes: readonly DiagramNodePresentation[];
  size: { width: number; height: number };
  viewport: DiagramViewport;
}) {
  const bounds = diagramBoundsUnion(nodes.map(({ bounds }) => bounds));
  if (!bounds) {
    return null;
  }
  const padding = 12;
  const width = 180;
  const height = 112;
  const scale = Math.min(
    (width - padding * 2) / Math.max(1, bounds.width),
    (height - padding * 2) / Math.max(1, bounds.height),
  );
  const offsetX = (width - bounds.width * scale) / 2 - bounds.x * scale;
  const offsetY = (height - bounds.height * scale) / 2 - bounds.y * scale;
  const visible = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: size.width / viewport.zoom,
    height: size.height / viewport.zoom,
  };
  return (
    <svg aria-label={ariaLabel} className="diagram-minimap" role="img" viewBox={`0 0 ${width} ${height}`}>
      {nodes.map((node) => (
        <rect
          className="diagram-minimap__node"
          height={Math.max(2, node.bounds.height * scale)}
          key={node.id}
          width={Math.max(2, node.bounds.width * scale)}
          x={node.bounds.x * scale + offsetX}
          y={node.bounds.y * scale + offsetY}
        />
      ))}
      <rect
        className="diagram-minimap__viewport"
        height={visible.height * scale}
        width={visible.width * scale}
        x={visible.x * scale + offsetX}
        y={visible.y * scale + offsetY}
      />
    </svg>
  );
}
