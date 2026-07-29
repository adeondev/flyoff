import {
  createDiagramDocument,
  DIAGRAM_MAX_POINTS_PER_EDGE,
  type DiagramDiagnostic,
  type DiagramDocument,
  type DiagramElement,
  type DiagramElementColor,
  type DiagramPoint,
  type DiagramRelationship,
} from '../../../shared/diagram';
import {
  importedElement,
  importedRelationship,
  sourceRef,
} from './shared';
import {
  drawioStyle,
  drawioText,
  parseDrawioCells,
  parseDrawioPages,
  type DrawioCell,
} from './drawio-model';
import type { DiagramImportResult, ImportIdFactory } from './types';

interface ActivityPartitionMatch {
  background: DrawioCell;
  header?: DrawioCell;
}

interface WorkingEdge {
  externalId: string;
  sourceCellId: string;
  targetCellId: string;
  name: string;
  guard?: string;
  style: string;
  points: readonly DiagramPoint[];
}

interface MappedElement {
  cell: DrawioCell;
  element: DiagramElement;
  color?: DiagramElementColor;
  partitionCellId?: string;
}

const activityKinds = new Set<DiagramElement['kind']>([
  'activity-partition',
  'action',
  'object-node',
  'initial-node',
  'activity-final',
  'flow-final',
  'decision',
  'merge',
  'fork',
  'join',
]);

const partitionAssignableKinds = new Set<DiagramElement['kind']>([
  'action',
  'object-node',
  'initial-node',
  'activity-final',
  'flow-final',
  'decision',
  'merge',
  'fork',
  'join',
]);

function normalizedStyleValue(
  style: ReadonlyMap<string, string>,
  name: string,
): string {
  return (style.get(name) ?? '').trim().toLowerCase();
}

function isTextCell(cell: DrawioCell): boolean {
  const style = drawioStyle(cell.style);
  return (
    style.has('text') ||
    (normalizedStyleValue(style, 'strokeColor') === 'none' &&
      normalizedStyleValue(style, 'fillColor') === 'none')
  );
}

function safeColor(cell: DrawioCell): DiagramElementColor | undefined {
  const color = drawioStyle(cell.style).get('fillColor');
  return color && /^#[0-9a-f]{6}$/i.test(color)
    ? (color as DiagramElementColor)
    : undefined;
}

function strongCellKind(cell: DrawioCell): DiagramElement['kind'] | undefined {
  const style = drawioStyle(cell.style);
  const shape = normalizedStyleValue(style, 'shape');
  const width = cell.geometry?.width ?? 160;
  const height = cell.geometry?.height ?? 80;
  const fillColor = normalizedStyleValue(style, 'fillColor');
  const strokeColor = normalizedStyleValue(style, 'strokeColor');
  const strokeWidth = Number(style.get('strokeWidth') ?? 1);
  const text = drawioText(cell.value);

  if (shape.includes('actor')) return 'actor';
  if (shape.includes('lifeline')) return 'lifeline';
  if (shape.includes('activation')) return 'activation';
  if (shape.includes('package') || shape.includes('folder')) return 'package';
  if (shape.includes('interface')) return 'interface';
  if (shape.includes('enumeration') || /«enumeration»/i.test(text)) {
    return 'enumeration';
  }
  if (shape.includes('object')) return 'object-node';
  if (shape.includes('boundary')) return 'system-boundary';
  if (shape.includes('flowfinal')) return 'flow-final';
  if (shape.includes('doubleellipse') || style.has('doubleEllipse')) {
    return 'activity-final';
  }
  if (shape.includes('rhombus') || style.has('rhombus')) return 'decision';
  if (shape.includes('line') && (width <= 32 || height <= 32)) return 'fork';
  if (shape.includes('ellipse') || style.has('ellipse')) {
    if (width <= 48 && height <= 48) {
      if (fillColor === 'none' && /[x×✕]/iu.test(text)) return 'flow-final';
      if (
        fillColor === '#000000' &&
        Number.isFinite(strokeWidth) &&
        strokeWidth >= 2 &&
        strokeColor !== '#000000'
      ) {
        return 'activity-final';
      }
      if (fillColor === '#000000') return 'initial-node';
    }
    return 'use-case';
  }
  if (style.get('rounded') === '1') return 'action';
  if (style.has('childLayout')) return 'class';
  return undefined;
}

function inferDiagramTypeFromCells(
  cells: readonly DrawioCell[],
): DiagramDocument['diagramType'] {
  const kinds = cells
    .filter(({ vertex }) => vertex)
    .map(strongCellKind)
    .filter((kind): kind is DiagramElement['kind'] => kind !== undefined);
  if (kinds.some((kind) => kind === 'lifeline' || kind === 'activation')) {
    return 'sequence';
  }
  if (kinds.some((kind) => activityKinds.has(kind))) {
    return 'activity';
  }
  if (
    kinds.some(
      (kind) =>
        kind === 'actor' ||
        kind === 'use-case' ||
        kind === 'system-boundary',
    )
  ) {
    return 'use-case';
  }
  return 'class';
}

function nearlyEqual(left: number, right: number, tolerance = 2): boolean {
  return Math.abs(left - right) <= tolerance;
}

function activityPartitions(
  cells: readonly DrawioCell[],
): readonly ActivityPartitionMatch[] {
  const vertices = cells.filter(
    (cell): cell is DrawioCell & { geometry: NonNullable<DrawioCell['geometry']> } =>
      cell.vertex && cell.geometry !== undefined,
  );
  const nativePartitions = vertices
    .filter((cell) => {
      const style = drawioStyle(cell.style);
      return style.has('swimlane') && !style.has('childLayout');
    })
    .map((background) => ({ background }));
  const backgrounds = vertices.filter((cell) => {
    const style = drawioStyle(cell.style);
    return (
      !drawioText(cell.value) &&
      style.get('rounded') === '0' &&
      normalizedStyleValue(style, 'fillColor') === 'none' &&
      cell.geometry.height >= 160 &&
      cell.geometry.width >= 80
    );
  });
  const inferredPartitions = backgrounds.flatMap((background) => {
    const header = vertices.find(
      (candidate) =>
        candidate.id !== background.id &&
        Boolean(drawioText(candidate.value)) &&
        !isTextCell(candidate) &&
        candidate.geometry.height <= 72 &&
        nearlyEqual(candidate.geometry.x, background.geometry.x) &&
        nearlyEqual(candidate.geometry.y, background.geometry.y) &&
        nearlyEqual(candidate.geometry.width, background.geometry.width),
    );
    return header ? [{ background, header }] : [];
  });
  const nativeIds = new Set(nativePartitions.map(({ background }) => background.id));
  return [
    ...nativePartitions,
    ...inferredPartitions.filter(({ background }) => !nativeIds.has(background.id)),
  ];
}

function contextualCellKind(
  cell: DrawioCell,
  diagramType: DiagramDocument['diagramType'],
  partitionIds: ReadonlySet<string>,
): DiagramElement['kind'] | undefined {
  if (partitionIds.has(cell.id)) {
    return 'activity-partition';
  }
  const strong = strongCellKind(cell);
  const style = drawioStyle(cell.style);
  if (diagramType === 'activity') {
    if (style.has('swimlane') && !style.has('childLayout')) {
      return 'activity-partition';
    }
    return strong && activityKinds.has(strong) ? strong : undefined;
  }
  if (diagramType === 'use-case' && style.has('swimlane')) {
    return 'system-boundary';
  }
  if (strong) {
    return strong;
  }
  if (
    diagramType === 'class' &&
    cell.vertex &&
    cell.geometry &&
    !isTextCell(cell)
  ) {
    return 'class';
  }
  return undefined;
}

function center(cell: DrawioCell): DiagramPoint | undefined {
  return cell.geometry
    ? {
        x: cell.geometry.x + cell.geometry.width / 2,
        y: cell.geometry.y + cell.geometry.height / 2,
      }
    : undefined;
}

function pointDistanceToCell(point: DiagramPoint, cell: DrawioCell): number {
  if (!cell.geometry) {
    return Number.POSITIVE_INFINITY;
  }
  const bounds = cell.geometry;
  const dx = Math.max(bounds.x - point.x, 0, point.x - bounds.x - bounds.width);
  const dy = Math.max(bounds.y - point.y, 0, point.y - bounds.y - bounds.height);
  return Math.hypot(dx, dy);
}

function nearestEndpoint(
  point: DiagramPoint | undefined,
  candidates: readonly DrawioCell[],
): string | undefined {
  if (!point) {
    return undefined;
  }
  const ranked = candidates
    .map((cell) => ({ cell, distance: pointDistanceToCell(point, cell) }))
    .filter(({ distance }) => distance <= 24)
    .sort((left, right) => left.distance - right.distance);
  if (
    ranked.length === 0 ||
    (ranked[1] && nearlyEqual(ranked[0]!.distance, ranked[1].distance, 0.5))
  ) {
    return undefined;
  }
  return ranked[0]!.cell.id;
}

function bracketGuard(value: string): string | undefined {
  const match = /^\s*\[([^\]]+)]\s*$/.exec(value);
  return match?.[1]?.trim() || undefined;
}

function isConnectorCell(cell: DrawioCell): boolean {
  const style = drawioStyle(cell.style);
  const shape = normalizedStyleValue(style, 'shape');
  const bounds = cell.geometry;
  return Boolean(
    bounds &&
      bounds.width <= 48 &&
      bounds.height <= 48 &&
      (shape.includes('ellipse') || style.has('ellipse')) &&
      /^(?:\d+|[①-⑳])$/u.test(drawioText(cell.value)),
  );
}

function isGuardCell(cell: DrawioCell): boolean {
  return isTextCell(cell) && bracketGuard(drawioText(cell.value)) !== undefined;
}

function concatenatePoints(
  incoming: WorkingEdge,
  intermediate: DrawioCell,
  outgoing: WorkingEdge,
): readonly DiagramPoint[] {
  const intermediatePoint = center(intermediate);
  return [
    ...incoming.points,
    ...(intermediatePoint ? [intermediatePoint] : []),
    ...outgoing.points,
  ].slice(0, DIAGRAM_MAX_POINTS_PER_EDGE);
}

function collapseIntermediates(
  edges: readonly WorkingEdge[],
  intermediates: ReadonlyMap<string, DrawioCell>,
): { edges: readonly WorkingEdge[]; collapsed: number } {
  const remaining = edges.filter(
    (edge) =>
      edge.sourceCellId !== edge.targetCellId ||
      !intermediates.has(edge.sourceCellId),
  );
  let collapsed = edges.length - remaining.length;

  for (const [cellId, cell] of intermediates) {
    const incoming = remaining.filter(
      (edge) => edge.targetCellId === cellId && edge.sourceCellId !== cellId,
    );
    const outgoing = remaining.filter(
      (edge) => edge.sourceCellId === cellId && edge.targetCellId !== cellId,
    );
    if (incoming.length !== 1 || outgoing.length !== 1) {
      continue;
    }
    const before = incoming[0]!;
    const after = outgoing[0]!;
    const guard = bracketGuard(drawioText(cell.value)) ?? before.guard ?? after.guard;
    const replacement: WorkingEdge = {
      externalId: `${before.externalId}|${after.externalId}`,
      sourceCellId: before.sourceCellId,
      targetCellId: after.targetCellId,
      name: before.name || after.name,
      ...(guard ? { guard } : {}),
      style: before.style || after.style,
      points: concatenatePoints(before, cell, after),
    };
    const beforeIndex = remaining.indexOf(before);
    const afterIndex = remaining.indexOf(after);
    remaining.splice(Math.max(beforeIndex, afterIndex), 1);
    remaining.splice(Math.min(beforeIndex, afterIndex), 1);
    remaining.push(replacement);
    collapsed += 1;
  }
  return { edges: remaining, collapsed };
}

function workingEdges(
  cells: readonly DrawioCell[],
  endpointCells: readonly DrawioCell[],
  intermediaryCells: ReadonlyMap<string, DrawioCell>,
): {
  edges: readonly WorkingEdge[];
  recovered: number;
  collapsed: number;
  unresolved: readonly DrawioCell[];
} {
  const endpointIds = new Set([
    ...endpointCells.map(({ id }) => id),
    ...intermediaryCells.keys(),
  ]);
  let recovered = 0;
  const unresolved: DrawioCell[] = [];
  const initial = cells.filter(({ edge }) => edge).flatMap((cell) => {
    let sourceCellId = endpointIds.has(cell.source) ? cell.source : undefined;
    let targetCellId = endpointIds.has(cell.target) ? cell.target : undefined;
    if (!sourceCellId) {
      sourceCellId = nearestEndpoint(cell.sourcePoint, [
        ...endpointCells.filter(
          (candidate) => strongCellKind(candidate) !== 'activity-partition',
        ),
        ...intermediaryCells.values(),
      ]);
      if (sourceCellId) recovered += 1;
    }
    if (!targetCellId) {
      targetCellId = nearestEndpoint(cell.targetPoint, [
        ...endpointCells.filter(
          (candidate) => strongCellKind(candidate) !== 'activity-partition',
        ),
        ...intermediaryCells.values(),
      ]);
      if (targetCellId) recovered += 1;
    }
    if (!sourceCellId || !targetCellId) {
      unresolved.push(cell);
      return [];
    }
    const text = drawioText(cell.value);
    const guard = bracketGuard(text);
    return [
      {
        externalId: cell.id,
        sourceCellId,
        targetCellId,
        name: guard ? '' : text,
        ...(guard ? { guard } : {}),
        style: cell.style,
        points: cell.waypoints.slice(0, DIAGRAM_MAX_POINTS_PER_EDGE),
      },
    ];
  });
  const collapsed = collapseIntermediates(initial, intermediaryCells);
  return {
    edges: collapsed.edges,
    recovered,
    collapsed: collapsed.collapsed,
    unresolved,
  };
}

function isMergeCell(
  cell: DrawioCell,
  cells: readonly DrawioCell[],
  edges: readonly WorkingEdge[],
): boolean {
  if (drawioText(cell.value).toLowerCase().includes('merge')) {
    return true;
  }
  const cellCenter = center(cell);
  const nearbyMergeLabel =
    cellCenter &&
    cells.some((candidate) => {
      const candidateCenter = center(candidate);
      return (
        isTextCell(candidate) &&
        drawioText(candidate.value).toLowerCase().includes('merge') &&
        candidateCenter !== undefined &&
        Math.hypot(
          candidateCenter.x - cellCenter.x,
          candidateCenter.y - cellCenter.y,
        ) <= 110
      );
    });
  if (nearbyMergeLabel) {
    return true;
  }
  const incoming = edges.filter(({ targetCellId }) => targetCellId === cell.id).length;
  const outgoing = edges.filter(({ sourceCellId }) => sourceCellId === cell.id).length;
  return incoming > 1 && outgoing <= 1;
}

function isJoinCell(cell: DrawioCell, edges: readonly WorkingEdge[]): boolean {
  const incoming = edges.filter(({ targetCellId }) => targetCellId === cell.id).length;
  const outgoing = edges.filter(({ sourceCellId }) => sourceCellId === cell.id).length;
  return incoming > 1 && outgoing <= 1;
}

function partitionForCell(
  cell: DrawioCell,
  partitions: readonly ActivityPartitionMatch[],
): ActivityPartitionMatch | undefined {
  const point = center(cell);
  if (!point) {
    return undefined;
  }
  return partitions.find(({ background }) => {
    const bounds = background.geometry!;
    return (
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    );
  });
}

function activityElementName(
  cell: DrawioCell,
  kind: DiagramElement['kind'],
  partitions: readonly ActivityPartitionMatch[],
): string {
  if (kind === 'activity-partition') {
    return (
      partitions.find(({ background }) => background.id === cell.id)?.header
        ? drawioText(
            partitions.find(({ background }) => background.id === cell.id)!
              .header!.value,
          )
        : drawioText(cell.value) || kind
    );
  }
  return drawioText(cell.value) || kind;
}

function relationshipKind(
  edge: WorkingEdge,
  diagramType: DiagramDocument['diagramType'],
  sourceCell: DrawioCell,
  targetCell: DrawioCell,
): DiagramRelationship['kind'] {
  const style = drawioStyle(edge.style);
  const label = `${edge.name} ${edge.guard ?? ''}`.toLowerCase();
  if (label.includes('include')) return 'include';
  if (label.includes('extend')) return 'extend';
  if (diagramType === 'sequence') {
    if (sourceCell.id === targetCell.id) return 'self-message';
    if (style.get('dashed') === '1') return 'message-return';
    return style.get('endFill') === '0'
      ? 'message-asynchronous'
      : 'message-synchronous';
  }
  if (diagramType === 'activity') {
    return label.includes('object') ? 'object-flow' : 'control-flow';
  }
  const dashed = style.get('dashed') === '1';
  const startArrow = normalizedStyleValue(style, 'startArrow');
  const endArrow = normalizedStyleValue(style, 'endArrow');
  if (startArrow.includes('diamond')) {
    return style.get('startFill') === '0'
      ? 'aggregation'
      : 'composition';
  }
  if (endArrow.includes('block')) {
    return dashed ? 'realization' : 'generalization';
  }
  if (dashed) return 'dependency';
  return endArrow && endArrow !== 'none'
    ? 'directed-association'
    : 'association';
}

export function importDrawio(
  xml: string,
  createId: ImportIdFactory,
): DiagramImportResult {
  const diagrams = parseDrawioPages(xml).map((page) => {
    const cells = parseDrawioCells(page.model);
    const diagnostics: DiagramDiagnostic[] = [];
    const diagramType = inferDiagramTypeFromCells(cells);
    const partitions =
      diagramType === 'activity' ? activityPartitions(cells) : [];
    const partitionIds = new Set(
      partitions.map(({ background }) => background.id),
    );
    const ignoredHeaderIds = new Set(
      partitions.flatMap(({ header }) => (header ? [header.id] : [])),
    );
    const intermediaryCells = new Map(
      cells
        .filter(
          (cell) =>
            cell.vertex &&
            (isConnectorCell(cell) ||
              (diagramType === 'activity' && isGuardCell(cell))),
        )
        .map((cell) => [cell.id, cell]),
    );
    const candidateCells = cells
      .filter(
        (cell) =>
          cell.vertex &&
          !ignoredHeaderIds.has(cell.id) &&
          !intermediaryCells.has(cell.id) &&
          contextualCellKind(cell, diagramType, partitionIds) !== undefined,
      )
      .sort(
        (left, right) =>
          Number(partitionIds.has(right.id)) - Number(partitionIds.has(left.id)),
      );
    const edgeResult = workingEdges(
      cells,
      candidateCells.filter((cell) => !partitionIds.has(cell.id)),
      intermediaryCells,
    );

    const mapped: MappedElement[] = [];
    const elementIdByCellId = new Map<string, string>();
    for (const cell of candidateCells) {
      let kind = contextualCellKind(cell, diagramType, partitionIds)!;
      if (kind === 'decision' && isMergeCell(cell, cells, edgeResult.edges)) {
        kind = 'merge';
      } else if (kind === 'fork' && isJoinCell(cell, edgeResult.edges)) {
        kind = 'join';
      }
      let element = importedElement(
        kind,
        cell.id,
        activityElementName(cell, kind, partitions),
        'drawio',
        createId,
      );
      const partition =
        diagramType === 'activity' && kind !== 'activity-partition'
          ? partitionForCell(cell, partitions)
          : undefined;
      const partitionElementId = partition
        ? elementIdByCellId.get(partition.background.id)
        : undefined;
      if (
        partitionElementId &&
        partitionAssignableKinds.has(element.kind)
      ) {
        element = {
          ...element,
          partitionId: partitionElementId,
        } as DiagramElement;
      }
      elementIdByCellId.set(cell.id, element.id);
      mapped.push({
        cell,
        element,
        color:
          kind === 'activity-partition'
            ? safeColor(
                partitions.find(
                  ({ background }) => background.id === cell.id,
                )!.header ?? cell,
              )
            : safeColor(cell),
        ...(partition ? { partitionCellId: partition.background.id } : {}),
      });
    }

    let order = 0;
    const relationships = edgeResult.edges.flatMap((edge) => {
      const sourceId = elementIdByCellId.get(edge.sourceCellId);
      const targetId = elementIdByCellId.get(edge.targetCellId);
      const sourceCell = cells.find(({ id }) => id === edge.sourceCellId);
      const targetCell = cells.find(({ id }) => id === edge.targetCellId);
      if (!sourceId || !targetId || !sourceCell || !targetCell) {
        return [];
      }
      const kind = relationshipKind(
        edge,
        diagramType,
        sourceCell,
        targetCell,
      );
      let relationship = importedRelationship(
        kind,
        edge.externalId,
        sourceId,
        targetId,
        'drawio',
        createId,
      );
      relationship = {
        ...relationship,
        name: edge.name,
        ...((relationship.kind === 'control-flow' ||
          relationship.kind === 'object-flow' ||
          relationship.kind === 'message-synchronous' ||
          relationship.kind === 'message-asynchronous' ||
          relationship.kind === 'message-return' ||
          relationship.kind === 'self-message') &&
        edge.guard
          ? { guard: edge.guard }
          : {}),
      };
      if ('order' in relationship) {
        order += 1;
        relationship = { ...relationship, order };
      } else if (
        relationship.kind === 'aggregation' ||
        relationship.kind === 'composition'
      ) {
        relationship = { ...relationship, wholeEnd: 'source' };
      }
      return [{ edge, relationship }];
    });

    const nodes = mapped.map(({ cell, element, color }, index) => ({
      id: createId(),
      elementId: element.id,
      bounds: cell.geometry ?? {
        x: 80,
        y: 80,
        width: 180,
        height: 100,
      },
      zIndex: index,
      ...(color ? { appearance: { color } } : {}),
    }));
    const nodeByElementId = new Map(
      nodes.map((node) => [node.elementId, node]),
    );
    const partitionPresentationIdByCellId = new Map(
      mapped.flatMap(({ cell, element }) => {
        if (element.kind !== 'activity-partition') {
          return [];
        }
        const node = nodeByElementId.get(element.id);
        return node ? [[cell.id, node.id] as const] : [];
      }),
    );
    const nestedNodes = nodes.map((node) => {
      const item = mapped.find(({ element }) => element.id === node.elementId);
      const parentPresentationId = item?.partitionCellId
        ? partitionPresentationIdByCellId.get(item.partitionCellId)
        : undefined;
      return parentPresentationId
        ? { ...node, parentPresentationId }
        : node;
    });
    const nestedNodeByElementId = new Map(
      nestedNodes.map((node) => [node.elementId, node]),
    );
    const edges = relationships.flatMap(({ edge, relationship }) => {
      const source = nestedNodeByElementId.get(relationship.sourceId);
      const target = nestedNodeByElementId.get(relationship.targetId);
      return source && target
        ? [
            {
              id: createId(),
              relationshipId: relationship.id,
              sourcePresentationId: source.id,
              targetPresentationId: target.id,
              points: edge.points,
            },
          ]
        : [];
    });

    for (const cell of edgeResult.unresolved) {
      diagnostics.push({
        code: 'drawio.edge-unsupported',
        severity: 'warning',
        message: `A Draw.io connector (${cell.id}) has unsupported endpoints.`,
      });
    }
    if (edgeResult.recovered > 0 || edgeResult.collapsed > 0) {
      diagnostics.push({
        code: 'drawio.topology-recovered',
        severity: 'info',
        message: `${edgeResult.recovered} connector endpoints and ${edgeResult.collapsed} intermediate nodes were recovered from Draw.io geometry.`,
      });
    }
    diagnostics.push({
      code: 'drawio.fidelity-partial',
      severity: 'info',
      message: 'Draw.io styles were mapped heuristically to UML notation.',
    });

    return {
      importId: createId(),
      name: page.name,
      document: {
        ...createDiagramDocument(diagramType, createId),
        elements: mapped.map(({ element }) => element),
        relationships: relationships.map(({ relationship }) => relationship),
        presentations: { nodes: nestedNodes, edges },
        sourceRef: sourceRef('drawio', page.id),
      },
      fidelity: 'partial' as const,
      diagnostics,
    };
  });
  return { sourceFormat: 'drawio', diagrams };
}
