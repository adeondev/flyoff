import {
  DIAGRAM_FORMAT,
  DIAGRAM_FORMAT_VERSION,
  type DiagramDocument,
  type DiagramElement,
  type DiagramNodeAppearance,
  type DiagramRelationship,
  type DiagramSourceRef,
  type UmlAttribute,
  type UmlOperation,
  type UmlParameter,
  type UmlTaggedValue,
} from './types';

export const DIAGRAM_DOCUMENT_MAX_BYTES = 16 * 1024 * 1024;
export const DIAGRAM_IMPORT_MAX_BYTES = 32 * 1024 * 1024;
export const DIAGRAM_JSON_MAX_DEPTH = 32;
export const DIAGRAM_MAX_ELEMENTS = 10_000;
export const DIAGRAM_MAX_RELATIONSHIPS = 20_000;
export const DIAGRAM_MAX_POINTS_PER_EDGE = 256;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const colorPattern = /^#[0-9a-f]{6}$/i;
const diagramTypes = new Set(['class', 'use-case', 'sequence', 'activity']);
const elementKinds = new Set([
  'package',
  'class',
  'interface',
  'enumeration',
  'actor',
  'use-case',
  'system-boundary',
  'lifeline',
  'activation',
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
const relationshipKinds = new Set([
  'association',
  'directed-association',
  'aggregation',
  'composition',
  'generalization',
  'realization',
  'dependency',
  'include',
  'extend',
  'message-synchronous',
  'message-asynchronous',
  'message-return',
  'self-message',
  'control-flow',
  'object-flow',
]);
const visibilities = new Set(['public', 'private', 'protected', 'package']);
const parameterDirections = new Set(['in', 'out', 'inout', 'return']);
const sourceSystems = new Set([
  'flyd',
  'spinel',
  'astah-bridge',
  'xmi',
  'drawio',
]);

export interface DiagramStructuralIssue {
  path: string;
  message: string;
}

export type DiagramValidationResult =
  | { ok: true; value: DiagramDocument }
  | { ok: false; issues: readonly DiagramStructuralIssue[] };

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

function isString(value: unknown, maxLength = 16_384): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNodeAppearance(value: unknown): value is DiagramNodeAppearance {
  return (
    isRecord(value) &&
    typeof value.color === 'string' &&
    colorPattern.test(value.color)
  );
}

function optionalString(value: unknown, maxLength = 16_384): boolean {
  return value === undefined || isString(value, maxLength);
}

function isSourceRef(value: unknown): value is DiagramSourceRef {
  return (
    isRecord(value) &&
    sourceSystems.has(String(value.system)) &&
    isString(value.externalId, 4_096) &&
    value.externalId.length > 0 &&
    optionalString(value.externalDiagramId, 4_096)
  );
}

function isTaggedValue(value: unknown): value is UmlTaggedValue {
  return (
    isRecord(value) &&
    isString(value.key, 512) &&
    value.key.length > 0 &&
    isString(value.value, 8_192)
  );
}

function isStringList(value: unknown, maxItems = 128): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => isString(item, 512))
  );
}

function isTaggedValues(value: unknown): value is readonly UmlTaggedValue[] {
  return (
    Array.isArray(value) &&
    value.length <= 256 &&
    value.every(isTaggedValue)
  );
}

function hasCommonModelFields(value: RecordValue): boolean {
  return (
    isId(value.id) &&
    isString(value.name, 2_048) &&
    optionalString(value.documentation, 65_536) &&
    isStringList(value.stereotypes) &&
    isTaggedValues(value.taggedValues) &&
    (value.sourceRef === undefined || isSourceRef(value.sourceRef))
  );
}

function isParameter(value: unknown): value is UmlParameter {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isString(value.name, 2_048) &&
    isString(value.type, 2_048) &&
    parameterDirections.has(String(value.direction)) &&
    optionalString(value.multiplicity, 256) &&
    optionalString(value.defaultValue, 8_192)
  );
}

function isAttribute(value: unknown): value is UmlAttribute {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isString(value.name, 2_048) &&
    isString(value.type, 2_048) &&
    visibilities.has(String(value.visibility)) &&
    typeof value.isStatic === 'boolean' &&
    typeof value.isReadOnly === 'boolean' &&
    optionalString(value.multiplicity, 256) &&
    optionalString(value.defaultValue, 8_192) &&
    optionalString(value.documentation, 65_536) &&
    isTaggedValues(value.taggedValues)
  );
}

function isOperation(value: unknown): value is UmlOperation {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isString(value.name, 2_048) &&
    isString(value.returnType, 2_048) &&
    visibilities.has(String(value.visibility)) &&
    typeof value.isAbstract === 'boolean' &&
    typeof value.isStatic === 'boolean' &&
    Array.isArray(value.parameters) &&
    value.parameters.length <= 1_024 &&
    value.parameters.every(isParameter) &&
    optionalString(value.documentation, 65_536) &&
    isTaggedValues(value.taggedValues)
  );
}

function isElement(value: unknown): value is DiagramElement {
  if (
    !isRecord(value) ||
    !elementKinds.has(String(value.kind)) ||
    !hasCommonModelFields(value)
  ) {
    return false;
  }
  switch (value.kind) {
    case 'class':
      return (
        typeof value.isAbstract === 'boolean' &&
        Array.isArray(value.attributes) &&
        value.attributes.length <= 2_048 &&
        value.attributes.every(isAttribute) &&
        Array.isArray(value.operations) &&
        value.operations.length <= 2_048 &&
        value.operations.every(isOperation)
      );
    case 'interface':
      return (
        Array.isArray(value.attributes) &&
        value.attributes.length <= 2_048 &&
        value.attributes.every(isAttribute) &&
        Array.isArray(value.operations) &&
        value.operations.length <= 2_048 &&
        value.operations.every(isOperation)
      );
    case 'enumeration':
      return isStringList(value.literals, 4_096);
    case 'lifeline':
      return value.classifierRef === undefined || isId(value.classifierRef);
    case 'activation':
      return isId(value.lifelineId);
    case 'activity-partition':
      return value.orientation === 'vertical' || value.orientation === 'horizontal';
    case 'action':
    case 'object-node':
    case 'initial-node':
    case 'activity-final':
    case 'flow-final':
    case 'decision':
    case 'merge':
    case 'fork':
    case 'join':
      return (
        (value.partitionId === undefined || isId(value.partitionId)) &&
        (value.kind !== 'object-node' || optionalString(value.objectType, 2_048))
      );
    default:
      return true;
  }
}

function isRelationship(value: unknown): value is DiagramRelationship {
  if (
    !isRecord(value) ||
    !relationshipKinds.has(String(value.kind)) ||
    !hasCommonModelFields(value) ||
    !isId(value.sourceId) ||
    !isId(value.targetId)
  ) {
    return false;
  }
  if (
    value.kind === 'message-synchronous' ||
    value.kind === 'message-asynchronous' ||
    value.kind === 'message-return' ||
    value.kind === 'self-message'
  ) {
    return (
      Number.isSafeInteger(value.order) &&
      Number(value.order) >= 0 &&
      optionalString(value.guard, 2_048)
    );
  }
  if (value.kind === 'control-flow' || value.kind === 'object-flow') {
    return optionalString(value.guard, 2_048);
  }
  if (
    value.kind === 'association' ||
    value.kind === 'directed-association' ||
    value.kind === 'aggregation' ||
    value.kind === 'composition' ||
    value.kind === 'generalization' ||
    value.kind === 'realization' ||
    value.kind === 'dependency'
  ) {
    return (
      optionalString(value.sourceMultiplicity, 256) &&
      optionalString(value.targetMultiplicity, 256) &&
      (value.wholeEnd === undefined ||
        value.wholeEnd === 'source' ||
        value.wholeEnd === 'target')
    );
  }
  return true;
}

function isPoint(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isBounds(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0
  );
}

export function diagramJsonDepth(value: unknown): number {
  if (!value || typeof value !== 'object') {
    return 0;
  }
  let maxDepth = 0;
  const pending: { depth: number; value: object }[] = [{ depth: 1, value }];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current.value)) {
      continue;
    }
    seen.add(current.value);
    maxDepth = Math.max(maxDepth, current.depth);
    if (maxDepth > DIAGRAM_JSON_MAX_DEPTH) {
      return maxDepth;
    }
    for (const child of Object.values(current.value)) {
      if (child && typeof child === 'object') {
        pending.push({ depth: current.depth + 1, value: child });
      }
    }
  }
  return maxDepth;
}

export function validateDiagramDocument(value: unknown): DiagramValidationResult {
  const issues: DiagramStructuralIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: '$', message: 'Expected an object.' }] };
  }
  if (diagramJsonDepth(value) > DIAGRAM_JSON_MAX_DEPTH) {
    issues.push({ path: '$', message: 'The document exceeds the JSON depth limit.' });
  }
  if (value.format !== DIAGRAM_FORMAT) {
    issues.push({ path: 'format', message: 'Unsupported diagram format.' });
  }
  if (value.formatVersion !== DIAGRAM_FORMAT_VERSION) {
    issues.push({ path: 'formatVersion', message: 'Unsupported diagram version.' });
  }
  if (!isId(value.documentId)) {
    issues.push({ path: 'documentId', message: 'Expected a UUID.' });
  }
  if (!diagramTypes.has(String(value.diagramType))) {
    issues.push({ path: 'diagramType', message: 'Unknown diagram type.' });
  }
  if (
    !Array.isArray(value.elements) ||
    value.elements.length > DIAGRAM_MAX_ELEMENTS ||
    !value.elements.every(isElement)
  ) {
    issues.push({ path: 'elements', message: 'Invalid diagram elements.' });
  }
  if (
    !Array.isArray(value.relationships) ||
    value.relationships.length > DIAGRAM_MAX_RELATIONSHIPS ||
    !value.relationships.every(isRelationship)
  ) {
    issues.push({ path: 'relationships', message: 'Invalid diagram relationships.' });
  }
  if (!isRecord(value.presentations)) {
    issues.push({ path: 'presentations', message: 'Invalid presentations.' });
  } else {
    const nodes = value.presentations.nodes;
    const edges = value.presentations.edges;
    if (
      !Array.isArray(nodes) ||
      nodes.length > DIAGRAM_MAX_ELEMENTS ||
      !nodes.every(
        (node) =>
          isRecord(node) &&
          isId(node.id) &&
          isId(node.elementId) &&
          isBounds(node.bounds) &&
          Number.isSafeInteger(node.zIndex) &&
          (node.parentPresentationId === undefined ||
            isId(node.parentPresentationId)) &&
          (node.appearance === undefined || isNodeAppearance(node.appearance)),
      )
    ) {
      issues.push({ path: 'presentations.nodes', message: 'Invalid node presentations.' });
    }
    if (
      !Array.isArray(edges) ||
      edges.length > DIAGRAM_MAX_RELATIONSHIPS ||
      !edges.every(
        (edge) =>
          isRecord(edge) &&
          isId(edge.id) &&
          isId(edge.relationshipId) &&
          isId(edge.sourcePresentationId) &&
          isId(edge.targetPresentationId) &&
          Array.isArray(edge.points) &&
          edge.points.length <= DIAGRAM_MAX_POINTS_PER_EDGE &&
          edge.points.every(isPoint) &&
          (edge.labelPosition === undefined || isPoint(edge.labelPosition)),
      )
    ) {
      issues.push({ path: 'presentations.edges', message: 'Invalid edge presentations.' });
    }
  }
  if (
    !isRecord(value.settings) ||
    typeof value.settings.showGrid !== 'boolean' ||
    typeof value.settings.snapToGrid !== 'boolean' ||
    !Number.isSafeInteger(value.settings.gridSize) ||
    Number(value.settings.gridSize) < 2 ||
    Number(value.settings.gridSize) > 256
  ) {
    issues.push({ path: 'settings', message: 'Invalid diagram settings.' });
  }
  if (value.sourceRef !== undefined && !isSourceRef(value.sourceRef)) {
    issues.push({ path: 'sourceRef', message: 'Invalid source reference.' });
  }

  if (issues.length === 0) {
    const document = value as unknown as DiagramDocument;
    const ids = [
      document.documentId,
      ...document.elements.flatMap((element) => [
        element.id,
        ...(element.kind === 'class' || element.kind === 'interface'
          ? element.attributes.flatMap((attribute) => [attribute.id])
          : []),
        ...(element.kind === 'class' || element.kind === 'interface'
          ? element.operations.flatMap((operation) => [
              operation.id,
              ...operation.parameters.map(({ id }) => id),
            ])
          : []),
      ]),
      ...document.relationships.map(({ id }) => id),
      ...document.presentations.nodes.map(({ id }) => id),
      ...document.presentations.edges.map(({ id }) => id),
    ];
    if (new Set(ids).size !== ids.length) {
      issues.push({ path: '$', message: 'Model and presentation IDs must be unique.' });
    }
  }
  return issues.length === 0
    ? { ok: true, value: value as unknown as DiagramDocument }
    : { ok: false, issues };
}

export function isDiagramDocument(value: unknown): value is DiagramDocument {
  return validateDiagramDocument(value).ok;
}
