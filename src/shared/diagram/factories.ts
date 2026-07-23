import type {
  DiagramBounds,
  DiagramDocument,
  DiagramElement,
  DiagramNodePresentation,
  DiagramRelationship,
  DiagramType,
} from './types';

export type DiagramIdFactory = () => string;

const DEFAULT_BOUNDS: Record<DiagramElement['kind'], DiagramBounds> = {
  package: { x: 0, y: 0, width: 260, height: 180 },
  class: { x: 0, y: 0, width: 220, height: 140 },
  interface: { x: 0, y: 0, width: 220, height: 120 },
  enumeration: { x: 0, y: 0, width: 200, height: 120 },
  actor: { x: 0, y: 0, width: 96, height: 128 },
  'use-case': { x: 0, y: 0, width: 180, height: 88 },
  'system-boundary': { x: 0, y: 0, width: 420, height: 280 },
  lifeline: { x: 0, y: 0, width: 120, height: 360 },
  activation: { x: 0, y: 0, width: 16, height: 96 },
  'activity-partition': { x: 0, y: 0, width: 260, height: 440 },
  action: { x: 0, y: 0, width: 160, height: 72 },
  'object-node': { x: 0, y: 0, width: 150, height: 64 },
  'initial-node': { x: 0, y: 0, width: 32, height: 32 },
  'activity-final': { x: 0, y: 0, width: 36, height: 36 },
  'flow-final': { x: 0, y: 0, width: 36, height: 36 },
  decision: { x: 0, y: 0, width: 52, height: 52 },
  merge: { x: 0, y: 0, width: 52, height: 52 },
  fork: { x: 0, y: 0, width: 140, height: 16 },
  join: { x: 0, y: 0, width: 140, height: 16 },
};

export function createDiagramDocument(
  diagramType: DiagramType,
  createId: DiagramIdFactory = () => crypto.randomUUID(),
): DiagramDocument {
  return {
    format: 'flyoff-diagram',
    formatVersion: 2,
    documentId: createId(),
    diagramType,
    elements: [],
    relationships: [],
    presentations: { nodes: [], edges: [] },
    settings: { showGrid: true, snapToGrid: true, gridSize: 16 },
  };
}

interface CreateElementOptions {
  name?: string;
  x?: number;
  y?: number;
  lifelineId?: string;
  createId?: DiagramIdFactory;
}

export function createDiagramElement(
  kind: DiagramElement['kind'],
  options: CreateElementOptions = {},
): { element: DiagramElement; presentation: DiagramNodePresentation } {
  const createId = options.createId ?? (() => crypto.randomUUID());
  const common = {
    id: createId(),
    name: options.name ?? defaultElementName(kind),
    stereotypes: [],
    taggedValues: [],
  };
  let element: DiagramElement;

  switch (kind) {
    case 'class':
      element = { ...common, kind, isAbstract: false, attributes: [], operations: [] };
      break;
    case 'interface':
      element = { ...common, kind, attributes: [], operations: [] };
      break;
    case 'enumeration':
      element = { ...common, kind, literals: [] };
      break;
    case 'lifeline':
      element = { ...common, kind };
      break;
    case 'activation':
      element = { ...common, kind, lifelineId: options.lifelineId ?? createId() };
      break;
    case 'activity-partition':
      element = { ...common, kind, orientation: 'vertical' };
      break;
    default:
      element = { ...common, kind } as DiagramElement;
  }

  const bounds = DEFAULT_BOUNDS[kind];
  return {
    element,
    presentation: {
      id: createId(),
      elementId: element.id,
      bounds: {
        ...bounds,
        x: options.x ?? bounds.x,
        y: options.y ?? bounds.y,
      },
      zIndex: 0,
    },
  };
}

export function createDiagramRelationship(
  kind: DiagramRelationship['kind'],
  sourceId: string,
  targetId: string,
  createId: DiagramIdFactory = () => crypto.randomUUID(),
): DiagramRelationship {
  const common = {
    id: createId(),
    sourceId,
    targetId,
    name: '',
    stereotypes: [],
    taggedValues: [],
  };
  if (
    kind === 'message-synchronous' ||
    kind === 'message-asynchronous' ||
    kind === 'message-return' ||
    kind === 'self-message'
  ) {
    return { ...common, kind, order: 1 };
  }
  return { ...common, kind } as DiagramRelationship;
}

function defaultElementName(kind: DiagramElement['kind']): string {
  const names: Record<DiagramElement['kind'], string> = {
    package: 'Package',
    class: 'Class',
    interface: 'Interface',
    enumeration: 'Enumeration',
    actor: 'Actor',
    'use-case': 'Use case',
    'system-boundary': 'System',
    lifeline: 'Lifeline',
    activation: 'Activation',
    'activity-partition': 'Partition',
    action: 'Action',
    'object-node': 'Object',
    'initial-node': '',
    'activity-final': '',
    'flow-final': '',
    decision: '',
    merge: '',
    fork: '',
    join: '',
  };
  return names[kind];
}
