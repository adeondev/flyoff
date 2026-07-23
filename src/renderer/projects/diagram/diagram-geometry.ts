import {
  createDiagramElement,
  snapDiagramValue,
  type DiagramBounds,
  type DiagramDocument,
  type DiagramElement,
  type DiagramNodePresentation,
  type DiagramPoint,
} from '../../../shared/diagram';

type ClassifierElement = Extract<
  DiagramElement,
  { kind: 'class' | 'interface' | 'enumeration' }
>;

const MEMBER_LINE_HEIGHT = 16;
const MEMBER_BASELINE_OFFSET = 17;
const COMPARTMENT_MIN_HEIGHT = 26;
const COMPARTMENT_BOTTOM_PADDING = 9;

export interface ClassifierLayout {
  attributesStartY: number;
  headerHeight: number;
  minimumHeight: number;
  operationsDividerY?: number;
  operationsStartY?: number;
}

function compartmentHeight(itemCount: number): number {
  return Math.max(
    COMPARTMENT_MIN_HEIGHT,
    itemCount * MEMBER_LINE_HEIGHT + COMPARTMENT_BOTTOM_PADDING,
  );
}

export function getClassifierLayout(element: ClassifierElement): ClassifierLayout {
  const hasStereotype = element.kind !== 'class' || element.stereotypes.length > 0;
  const headerHeight = hasStereotype ? 54 : 42;
  const attributeCount =
    element.kind === 'enumeration'
      ? element.literals.length
      : element.attributes.length;
  const attributesHeight = compartmentHeight(attributeCount);

  if (element.kind === 'enumeration') {
    return {
      attributesStartY: headerHeight + MEMBER_BASELINE_OFFSET,
      headerHeight,
      minimumHeight: headerHeight + attributesHeight,
    };
  }

  const operationsDividerY = headerHeight + attributesHeight;
  return {
    attributesStartY: headerHeight + MEMBER_BASELINE_OFFSET,
    headerHeight,
    minimumHeight:
      operationsDividerY + compartmentHeight(element.operations.length),
    operationsDividerY,
    operationsStartY: operationsDividerY + MEMBER_BASELINE_OFFSET,
  };
}

export function getEffectiveDiagramNodePresentation(
  element: DiagramElement,
  presentation: DiagramNodePresentation,
): DiagramNodePresentation {
  if (
    element.kind !== 'class' &&
    element.kind !== 'interface' &&
    element.kind !== 'enumeration'
  ) {
    return presentation;
  }

  const minimumHeight = getClassifierLayout(element).minimumHeight;
  if (presentation.bounds.height >= minimumHeight) {
    return presentation;
  }

  return {
    ...presentation,
    bounds: { ...presentation.bounds, height: minimumHeight },
  };
}

export type DiagramResizeHandle =
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'nw';

export type DiagramResizeDimension = 'width' | 'height';
export type ActivityPartitionSide = 'left' | 'right';

const ALL_RESIZE_HANDLES: readonly DiagramResizeHandle[] = [
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
  'nw',
];
const PROPORTIONAL_RESIZE_HANDLES: readonly DiagramResizeHandle[] = [
  'ne',
  'se',
  'sw',
  'nw',
];
const PROPORTIONAL_ELEMENTS = new Set<DiagramElement['kind']>([
  'initial-node',
  'activity-final',
  'flow-final',
  'decision',
  'merge',
]);

const MINIMUM_NODE_SIZE: Record<
  DiagramElement['kind'],
  { width: number; height: number }
> = {
  package: { width: 120, height: 80 },
  class: { width: 120, height: 94 },
  interface: { width: 120, height: 106 },
  enumeration: { width: 120, height: 80 },
  actor: { width: 64, height: 96 },
  'use-case': { width: 100, height: 56 },
  'system-boundary': { width: 180, height: 140 },
  lifeline: { width: 80, height: 160 },
  activation: { width: 12, height: 48 },
  'activity-partition': { width: 120, height: 160 },
  action: { width: 96, height: 48 },
  'object-node': { width: 96, height: 44 },
  'initial-node': { width: 24, height: 24 },
  'activity-final': { width: 28, height: 28 },
  'flow-final': { width: 28, height: 28 },
  decision: { width: 36, height: 36 },
  merge: { width: 36, height: 36 },
  fork: { width: 64, height: 12 },
  join: { width: 64, height: 12 },
};

export function getDiagramResizeHandles(
  element: DiagramElement,
): readonly DiagramResizeHandle[] {
  return PROPORTIONAL_ELEMENTS.has(element.kind)
    ? PROPORTIONAL_RESIZE_HANDLES
    : ALL_RESIZE_HANDLES;
}

export function getDiagramMinimumSize(
  element: DiagramElement,
): { width: number; height: number } {
  const minimum = MINIMUM_NODE_SIZE[element.kind];
  if (
    element.kind === 'class' ||
    element.kind === 'interface' ||
    element.kind === 'enumeration'
  ) {
    return {
      width: minimum.width,
      height: Math.max(minimum.height, getClassifierLayout(element).minimumHeight),
    };
  }
  return minimum;
}

function resizeProportionally(
  element: DiagramElement,
  bounds: DiagramBounds,
  handle: DiagramResizeHandle,
  delta: DiagramPoint,
  gridSize?: number,
): DiagramBounds {
  const horizontalSize =
    bounds.width + (handle.includes('e') ? delta.x : -delta.x);
  const verticalSize =
    bounds.height + (handle.includes('s') ? delta.y : -delta.y);
  const proposedSize =
    Math.abs(delta.x) >= Math.abs(delta.y) ? horizontalSize : verticalSize;
  const minimum = getDiagramMinimumSize(element);
  const size = Math.max(
    minimum.width,
    minimum.height,
    gridSize ? snapDiagramValue(proposedSize, gridSize) : proposedSize,
  );
  return {
    x: handle.includes('w') ? bounds.x + bounds.width - size : bounds.x,
    y: handle.includes('n') ? bounds.y + bounds.height - size : bounds.y,
    width: size,
    height: size,
  };
}

export function resizeDiagramNodeBounds(
  element: DiagramElement,
  bounds: DiagramBounds,
  handle: DiagramResizeHandle,
  delta: DiagramPoint,
  gridSize?: number,
): DiagramBounds {
  if (PROPORTIONAL_ELEMENTS.has(element.kind)) {
    return resizeProportionally(element, bounds, handle, delta, gridSize);
  }

  const minimum = getDiagramMinimumSize(element);
  const movesLeft = handle.includes('w');
  const movesRight = handle.includes('e');
  const movesTop = handle.includes('n');
  const movesBottom = handle.includes('s');
  let left = movesLeft ? bounds.x + delta.x : bounds.x;
  let right = movesRight
    ? bounds.x + bounds.width + delta.x
    : bounds.x + bounds.width;
  let top = movesTop ? bounds.y + delta.y : bounds.y;
  let bottom = movesBottom
    ? bounds.y + bounds.height + delta.y
    : bounds.y + bounds.height;

  if (gridSize) {
    if (movesLeft) left = snapDiagramValue(left, gridSize);
    if (movesRight) right = snapDiagramValue(right, gridSize);
    if (movesTop) top = snapDiagramValue(top, gridSize);
    if (movesBottom) bottom = snapDiagramValue(bottom, gridSize);
  }
  if (right - left < minimum.width) {
    if (movesLeft) left = right - minimum.width;
    else right = left + minimum.width;
  }
  if (bottom - top < minimum.height) {
    if (movesTop) top = bottom - minimum.height;
    else bottom = top + minimum.height;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function setDiagramNodeSize(
  element: DiagramElement,
  bounds: DiagramBounds,
  dimension: DiagramResizeDimension,
  value: number,
): DiagramBounds {
  const minimum = getDiagramMinimumSize(element);
  if (PROPORTIONAL_ELEMENTS.has(element.kind)) {
    const size = Math.max(minimum.width, minimum.height, value);
    return { ...bounds, width: size, height: size };
  }
  return dimension === 'width'
    ? { ...bounds, width: Math.max(minimum.width, value) }
    : { ...bounds, height: Math.max(minimum.height, value) };
}

export interface AdjacentActivityPartitionResult {
  document: DiagramDocument;
  elementId: string;
}

export function addAdjacentActivityPartition(
  document: DiagramDocument,
  referenceElementId: string | undefined,
  side: ActivityPartitionSide,
): AdjacentActivityPartitionResult | undefined {
  if (document.diagramType !== 'activity') {
    return undefined;
  }
  const elementsById = new Map(
    document.elements.map((element) => [element.id, element]),
  );
  const partitions = document.presentations.nodes
    .map((presentation) => ({
      element: elementsById.get(presentation.elementId),
      presentation,
    }))
    .filter(
      (entry): entry is {
        element: Extract<DiagramElement, { kind: 'activity-partition' }>;
        presentation: DiagramNodePresentation;
      } => entry.element?.kind === 'activity-partition',
    )
    .sort((left, right) => left.presentation.bounds.x - right.presentation.bounds.x);
  if (partitions.length === 0) {
    return undefined;
  }
  const reference =
    partitions.find(({ element }) => element.id === referenceElementId) ??
    (side === 'left' ? partitions[0] : partitions.at(-1));
  if (!reference) {
    return undefined;
  }

  const referenceBounds = reference.presentation.bounds;
  const insertionX =
    side === 'left'
      ? referenceBounds.x
      : referenceBounds.x + referenceBounds.width;
  const shiftedPartitionIds = new Set(
    partitions
      .filter(({ presentation }) => presentation.bounds.x >= insertionX)
      .map(({ element }) => element.id),
  );
  const shiftedElementIds = new Set<string>(shiftedPartitionIds);
  for (const element of document.elements) {
    if (
      'partitionId' in element &&
      element.partitionId &&
      shiftedPartitionIds.has(element.partitionId)
    ) {
      shiftedElementIds.add(element.id);
    }
  }

  const created = createDiagramElement('activity-partition', {
    x: insertionX,
    y: referenceBounds.y,
  });
  if (created.element.kind !== 'activity-partition') {
    return undefined;
  }
  created.element = {
    ...created.element,
    orientation: reference.element.orientation,
  };
  created.presentation = {
    ...created.presentation,
    bounds: {
      ...referenceBounds,
      x: insertionX,
    },
    zIndex: 0,
  };

  return {
    document: {
      ...document,
      elements: [...document.elements, created.element],
      presentations: {
        ...document.presentations,
        nodes: [
          ...document.presentations.nodes.map((presentation) =>
            shiftedElementIds.has(presentation.elementId)
              ? {
                  ...presentation,
                  bounds: {
                    ...presentation.bounds,
                    x: presentation.bounds.x + referenceBounds.width,
                  },
                }
              : presentation,
          ),
          created.presentation,
        ],
      },
    },
    elementId: created.element.id,
  };
}
