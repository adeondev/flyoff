import type {
  DiagramEdgePresentation,
  DiagramElement,
  DiagramNodePresentation,
  DiagramRelationship,
} from '../../../shared/diagram';
import {
  getClassifierLayout,
  getDiagramResizeHandles,
  type DiagramResizeHandle,
} from './diagram-geometry';

interface DiagramNodeRendererProps {
  element: DiagramElement;
  presentation: DiagramNodePresentation;
  selected: boolean;
  showResizeHandles: boolean;
  viewportZoom: number;
  onPointerDown: (event: React.PointerEvent<SVGGElement>) => void;
  onResizePointerDown: (
    event: React.PointerEvent<SVGRectElement>,
    handle: DiagramResizeHandle,
  ) => void;
}

function visibilitySymbol(visibility: string): string {
  return { public: '+', private: '−', protected: '#', package: '~' }[visibility] ?? '';
}

function commonText(element: DiagramElement, width: number) {
  return (
    <text className="diagram-node__name" textAnchor="middle" x={width / 2} y={28}>
      {element.stereotypes.map((stereotype) => `«${stereotype}»`).join(' ')}
      {element.stereotypes.length > 0 ? <tspan x={width / 2} dy="18">{element.name}</tspan> : element.name}
    </text>
  );
}

function classifierNode(
  element: Extract<DiagramElement, { kind: 'class' | 'interface' | 'enumeration' }>,
  width: number,
  height: number,
) {
  const classifierStereotypes = [
    ...(element.kind === 'interface'
      ? ['interface']
      : element.kind === 'enumeration'
        ? ['enumeration']
        : []),
    ...element.stereotypes,
  ];
  const layout = getClassifierLayout(element);
  const attributes = element.kind === 'enumeration' ? element.literals : element.attributes;
  const operations = element.kind === 'enumeration' ? [] : element.operations;
  return (
    <>
      <rect className="diagram-node__shape" height={height} rx="2" width={width} />
      {classifierStereotypes.length > 0 ? (
        <text className="diagram-node__stereotype" textAnchor="middle" x={width / 2} y="17">
          {classifierStereotypes.map((stereotype) => `«${stereotype}»`).join(' ')}
        </text>
      ) : null}
      <text
        className={element.kind === 'class' && element.isAbstract ? 'diagram-node__name diagram-node__name--abstract' : 'diagram-node__name'}
        textAnchor="middle"
        x={width / 2}
        y={classifierStereotypes.length > 0 ? 36 : 26}
      >
        {element.name}
      </text>
      <line className="diagram-node__divider" x1="0" x2={width} y1={layout.headerHeight} y2={layout.headerHeight} />
      {attributes.map((attribute, index) => (
        <text className="diagram-node__member" key={typeof attribute === 'string' ? `${attribute}:${index}` : attribute.id} x="8" y={layout.attributesStartY + index * 16}>
          {typeof attribute === 'string'
            ? attribute
            : `${visibilitySymbol(attribute.visibility)} ${attribute.name}: ${attribute.type}`}
        </text>
      ))}
      {layout.operationsDividerY !== undefined ? (
        <line className="diagram-node__divider" x1="0" x2={width} y1={layout.operationsDividerY} y2={layout.operationsDividerY} />
      ) : null}
      {operations.map((operation, index) => (
        <text className="diagram-node__member" key={operation.id} x="8" y={layout.operationsStartY! + index * 16}>
          {`${visibilitySymbol(operation.visibility)} ${operation.name}(${operation.parameters
            .map((parameter) => `${parameter.name}: ${parameter.type}`)
            .join(', ')}): ${operation.returnType}`}
        </text>
      ))}
    </>
  );
}

export function DiagramNodeRenderer({
  element,
  presentation,
  selected,
  showResizeHandles,
  viewportZoom,
  onPointerDown,
  onResizePointerDown,
}: DiagramNodeRendererProps) {
  const { height, width, x, y } = presentation.bounds;
  const minimumHitSize = 24 / viewportZoom;
  const isContainer =
    element.kind === 'activity-partition' || element.kind === 'system-boundary';
  const horizontalPartition =
    element.kind === 'activity-partition' && element.orientation === 'horizontal';
  const hitWidth = horizontalPartition
    ? Math.min(width, 72)
    : Math.max(width, minimumHitSize);
  const hitHeight = isContainer && !horizontalPartition
    ? Math.min(height, 38)
    : Math.max(height, minimumHitSize);
  let content: React.ReactNode;
  switch (element.kind) {
    case 'class':
    case 'interface':
    case 'enumeration':
      content = classifierNode(element, width, height);
      break;
    case 'package':
      content = (
        <>
          <path className="diagram-node__shape" d={`M0 20 V${height} H${width} V20 H82 L68 0 H0 Z`} />
          {commonText(element, width)}
        </>
      );
      break;
    case 'actor': {
      const centerX = width / 2;
      const figureBottom = Math.max(50, height - 18);
      const headRadius = Math.max(
        6,
        Math.min(width * 0.15, figureBottom * 0.12),
      );
      const headY = headRadius + 2;
      const bodyTop = headY + headRadius;
      const armsY = bodyTop + (figureBottom - bodyTop) * 0.28;
      const hipY = bodyTop + (figureBottom - bodyTop) * 0.65;
      const armHalfWidth = width * 0.27;
      const legHalfWidth = width * 0.24;
      content = (
        <>
          <circle className="diagram-node__line" cx={centerX} cy={headY} r={headRadius} />
          <path className="diagram-node__line" d={`M${centerX} ${bodyTop} V${hipY} M${centerX - armHalfWidth} ${armsY} H${centerX + armHalfWidth} M${centerX} ${hipY} L${centerX - legHalfWidth} ${figureBottom} M${centerX} ${hipY} L${centerX + legHalfWidth} ${figureBottom}`} />
          <text className="diagram-node__name" textAnchor="middle" x={centerX} y={height - 3}>{element.name}</text>
        </>
      );
      break;
    }
    case 'use-case':
      content = (
        <>
          <ellipse className="diagram-node__shape" cx={width / 2} cy={height / 2} rx={width / 2 - 2} ry={height / 2 - 2} />
          <text className="diagram-node__name" dominantBaseline="middle" textAnchor="middle" x={width / 2} y={height / 2}>{element.name}</text>
        </>
      );
      break;
    case 'system-boundary':
      content = (
        <>
          <rect className="diagram-node__shape diagram-node__shape--container" height={height} width={width} />
          {commonText(element, width)}
        </>
      );
      break;
    case 'lifeline':
      content = (
        <>
          <rect className="diagram-node__shape" height="48" width={width} />
          <text className="diagram-node__name" dominantBaseline="middle" textAnchor="middle" x={width / 2} y="24">{element.name}</text>
          <line className="diagram-node__lifeline" x1={width / 2} x2={width / 2} y1="48" y2={height} />
        </>
      );
      break;
    case 'activation':
      content = <rect className="diagram-node__shape" height={height} width={width} />;
      break;
    case 'activity-partition':
      content = (
        <>
          <rect className="diagram-node__shape diagram-node__shape--container" height={height} width={width} />
          {element.orientation === 'vertical' ? (
            <>
              <line className="diagram-node__divider" x1="0" x2={width} y1="38" y2="38" />
              <text className="diagram-node__name" textAnchor="middle" x={width / 2} y="25">{element.name}</text>
            </>
          ) : (
            <>
              <line className="diagram-node__divider" x1="72" x2="72" y1="0" y2={height} />
              <text className="diagram-node__name" textAnchor="middle" transform={`rotate(-90 34 ${height / 2})`} x="34" y={height / 2}>{element.name}</text>
            </>
          )}
        </>
      );
      break;
    case 'action':
      content = (
        <>
          <rect className="diagram-node__shape" height={height} rx="14" width={width} />
          <text className="diagram-node__name" dominantBaseline="middle" textAnchor="middle" x={width / 2} y={height / 2}>{element.name}</text>
        </>
      );
      break;
    case 'object-node':
      content = (
        <>
          <rect className="diagram-node__shape" height={height} width={width} />
          <text className="diagram-node__name" dominantBaseline="middle" textAnchor="middle" x={width / 2} y={height / 2}>{element.name}{element.objectType ? `: ${element.objectType}` : ''}</text>
        </>
      );
      break;
    case 'initial-node':
      content = <circle className="diagram-node__initial" cx={width / 2} cy={height / 2} r={Math.min(width, height) / 2 - 2} />;
      break;
    case 'activity-final':
      content = (
        <>
          <circle className="diagram-node__line" cx={width / 2} cy={height / 2} r={Math.min(width, height) / 2 - 2} />
          <circle className="diagram-node__initial" cx={width / 2} cy={height / 2} r={Math.min(width, height) / 2 - 8} />
        </>
      );
      break;
    case 'flow-final':
      content = (
        <>
          <circle className="diagram-node__line" cx={width / 2} cy={height / 2} r={Math.min(width, height) / 2 - 2} />
          <path className="diagram-node__line" d={`M8 8 L${width - 8} ${height - 8} M${width - 8} 8 L8 ${height - 8}`} />
        </>
      );
      break;
    case 'decision':
    case 'merge':
      content = <path className="diagram-node__shape" d={`M${width / 2} 1 L${width - 1} ${height / 2} L${width / 2} ${height - 1} L1 ${height / 2} Z`} />;
      break;
    case 'fork':
    case 'join':
      content = <rect className="diagram-node__bar" height={height} rx="2" width={width} />;
      break;
  }
  return (
    <g
      aria-label={`${element.kind}: ${element.name}`}
      className={`diagram-node${selected ? ' diagram-node--selected' : ''}`}
      data-element-id={element.id}
      onPointerDown={onPointerDown}
      role="graphics-symbol"
      transform={`translate(${x} ${y})`}
    >
      <rect
        aria-hidden="true"
        className="diagram-node__hit-area"
        height={hitHeight}
        width={hitWidth}
        x={isContainer ? 0 : (width - hitWidth) / 2}
        y={isContainer ? 0 : (height - hitHeight) / 2}
      />
      {isContainer ? (
        <rect
          aria-hidden="true"
          className="diagram-node__container-outline-hit"
          height={height}
          width={width}
        />
      ) : null}
      {content}
      {selected ? <rect className="diagram-node__selection" height={height + 8} width={width + 8} x="-4" y="-4" /> : null}
      {showResizeHandles ? (
        <DiagramResizeHandles
          element={element}
          height={height}
          onPointerDown={onResizePointerDown}
          viewportZoom={viewportZoom}
          width={width}
        />
      ) : null}
    </g>
  );
}

function DiagramResizeHandles({
  element,
  height,
  onPointerDown,
  viewportZoom,
  width,
}: {
  element: DiagramElement;
  height: number;
  onPointerDown: DiagramNodeRendererProps['onResizePointerDown'];
  viewportZoom: number;
  width: number;
}) {
  const size = 9 / viewportZoom;
  const positions: Record<DiagramResizeHandle, { x: number; y: number }> = {
    n: { x: width / 2, y: 0 },
    ne: { x: width, y: 0 },
    e: { x: width, y: height / 2 },
    se: { x: width, y: height },
    s: { x: width / 2, y: height },
    sw: { x: 0, y: height },
    w: { x: 0, y: height / 2 },
    nw: { x: 0, y: 0 },
  };
  return (
    <g aria-hidden="true" className="diagram-node__resize-handles">
      {getDiagramResizeHandles(element).map((handle) => (
        <rect
          className="diagram-node__resize-handle"
          data-resize-handle={handle}
          height={size}
          key={handle}
          onPointerDown={(event) => onPointerDown(event, handle)}
          width={size}
          x={positions[handle].x - size / 2}
          y={positions[handle].y - size / 2}
        />
      ))}
    </g>
  );
}

interface DiagramEdgeRendererProps {
  relationship: DiagramRelationship;
  presentation?: DiagramEdgePresentation;
  source: DiagramNodePresentation;
  target: DiagramNodePresentation;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent<SVGPathElement>) => void;
}

function markerAttributes(relationship: DiagramRelationship) {
  switch (relationship.kind) {
    case 'generalization':
    case 'realization':
      return { markerEnd: 'url(#diagram-triangle)' };
    case 'aggregation':
      return relationship.wholeEnd === 'target'
        ? { markerEnd: 'url(#diagram-diamond)' }
        : { markerStart: 'url(#diagram-diamond)' };
    case 'composition':
      return relationship.wholeEnd === 'target'
        ? { markerEnd: 'url(#diagram-diamond-filled)' }
        : { markerStart: 'url(#diagram-diamond-filled)' };
    case 'message-synchronous':
      return { markerEnd: 'url(#diagram-arrow-filled)' };
    default:
      return relationship.kind === 'association'
        ? {}
        : { markerEnd: 'url(#diagram-arrow)' };
  }
}

function edgePath(
  relationship: DiagramRelationship,
  source: DiagramNodePresentation,
  target: DiagramNodePresentation,
  presentation?: DiagramEdgePresentation,
): string {
  if (presentation && presentation.points.length >= 2) {
    return presentation.points
      .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`)
      .join(' ');
  }
  const sx = source.bounds.x + source.bounds.width / 2;
  const sy = source.bounds.y + source.bounds.height / 2;
  const tx = target.bounds.x + target.bounds.width / 2;
  const ty = target.bounds.y + target.bounds.height / 2;
  if (
    relationship.kind === 'message-synchronous' ||
    relationship.kind === 'message-asynchronous' ||
    relationship.kind === 'message-return' ||
    relationship.kind === 'self-message'
  ) {
    const messageY = Math.max(source.bounds.y, target.bounds.y) + 62 + relationship.order * 44;
    return relationship.kind === 'self-message' || relationship.sourceId === relationship.targetId
      ? `M${sx} ${messageY} H${sx + 64} V${messageY + 34} H${sx}`
      : `M${sx} ${messageY} H${tx}`;
  }
  if (relationship.sourceId === relationship.targetId) {
    return `M${sx} ${sy} H${sx + 64} V${sy + 42} H${sx}`;
  }
  return `M${sx} ${sy} L${tx} ${ty}`;
}

export function DiagramEdgeRenderer({
  relationship,
  presentation,
  source,
  target,
  selected,
  onPointerDown,
}: DiagramEdgeRendererProps) {
  const path = edgePath(relationship, source, target, presentation);
  const dashed =
    relationship.kind === 'dependency' ||
    relationship.kind === 'realization' ||
    relationship.kind === 'include' ||
    relationship.kind === 'extend' ||
    relationship.kind === 'message-return';
  const labelPoint = presentation?.labelPosition ?? {
    x: (source.bounds.x + source.bounds.width / 2 + target.bounds.x + target.bounds.width / 2) / 2,
    y: (source.bounds.y + source.bounds.height / 2 + target.bounds.y + target.bounds.height / 2) / 2,
  };
  const guard = 'guard' in relationship ? relationship.guard : undefined;
  const stereotype = relationship.kind === 'include' || relationship.kind === 'extend'
    ? `«${relationship.kind}»`
    : '';
  const label = [stereotype, relationship.name, guard ? `[${guard}]` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <g className={`diagram-edge${selected ? ' diagram-edge--selected' : ''}`}>
      <path
        aria-hidden="true"
        className="diagram-edge__hit-area"
        d={path}
        data-relationship-id={relationship.id}
        onPointerDown={onPointerDown}
      />
      <path
        {...markerAttributes(relationship)}
        aria-label={`${relationship.kind}: ${relationship.name}`}
        className={`diagram-edge__line${dashed ? ' diagram-edge__line--dashed' : ''}`}
        d={path}
        data-relationship-id={relationship.id}
        onPointerDown={onPointerDown}
        role="graphics-symbol"
      />
      {label ? <text className="diagram-edge__label" textAnchor="middle" x={labelPoint.x} y={labelPoint.y - 7}>{label}</text> : null}
      {'sourceMultiplicity' in relationship && relationship.sourceMultiplicity ? (
        <text className="diagram-edge__label" x={source.bounds.x + source.bounds.width / 2 + 8} y={source.bounds.y + source.bounds.height / 2 - 8}>{relationship.sourceMultiplicity}</text>
      ) : null}
      {'targetMultiplicity' in relationship && relationship.targetMultiplicity ? (
        <text className="diagram-edge__label" x={target.bounds.x + target.bounds.width / 2 + 8} y={target.bounds.y + target.bounds.height / 2 - 8}>{relationship.targetMultiplicity}</text>
      ) : null}
    </g>
  );
}

export function DiagramMarkerDefinitions() {
  return (
    <defs>
      <marker id="diagram-arrow" markerHeight="8" markerWidth="10" orient="auto-start-reverse" refX="9" refY="4">
        <path className="diagram-marker diagram-marker--open" d="M1 1 L9 4 L1 7" />
      </marker>
      <marker id="diagram-arrow-filled" markerHeight="8" markerWidth="10" orient="auto-start-reverse" refX="9" refY="4">
        <path className="diagram-marker diagram-marker--filled" d="M1 1 L9 4 L1 7 Z" />
      </marker>
      <marker id="diagram-triangle" markerHeight="12" markerWidth="14" orient="auto-start-reverse" refX="13" refY="6">
        <path className="diagram-marker diagram-marker--hollow" d="M1 1 L13 6 L1 11 Z" />
      </marker>
      <marker id="diagram-diamond" markerHeight="12" markerWidth="16" orient="auto-start-reverse" refX="15" refY="6">
        <path className="diagram-marker diagram-marker--hollow" d="M1 6 L8 1 L15 6 L8 11 Z" />
      </marker>
      <marker id="diagram-diamond-filled" markerHeight="12" markerWidth="16" orient="auto-start-reverse" refX="15" refY="6">
        <path className="diagram-marker diagram-marker--filled" d="M1 6 L8 1 L15 6 L8 11 Z" />
      </marker>
    </defs>
  );
}
