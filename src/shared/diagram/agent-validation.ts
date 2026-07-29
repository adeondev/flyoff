import {
  DIAGRAM_AGENT_MAX_OPERATIONS,
  DIAGRAM_AGENT_TOOL_NAMES,
  type DiagramAgentChangeRequest,
  type DiagramAgentCreateRequest,
  type DiagramAgentElementChanges,
  type DiagramAgentOperation,
  type DiagramAgentRelationshipChanges,
  type DiagramAgentToolCall,
} from './agent-types';
import type { DiagramElement, DiagramRelationship } from './types';

type RecordValue = Record<string, unknown>;

const elementKinds = new Set<DiagramElement['kind']>([
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
const relationshipKinds = new Set<DiagramRelationship['kind']>([
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
const diagramTypes = new Set(['class', 'use-case', 'sequence', 'activity']);
const visibilities = new Set(['public', 'private', 'protected', 'package']);
const directions = new Set(['in', 'out', 'inout', 'return']);

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  maximum = 16_384,
  allowEmpty = true,
): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maximum &&
    (allowEmpty || value.trim().length > 0)
  );
}

function hasOnlyKeys(value: RecordValue, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isIdentifier(value: unknown): value is string {
  return boundedString(value, 128, false);
}

function isStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    value.every((entry) => boundedString(entry, 512))
  );
}

function isTaggedValues(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        hasOnlyKeys(entry, ['key', 'value']) &&
        boundedString(entry.key, 512, false) &&
        boundedString(entry.value),
    )
  );
}

function isBounds(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['x', 'y', 'width', 'height']) &&
    ['x', 'y', 'width', 'height'].every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
    ) &&
    Number(value.width) >= 8 &&
    Number(value.height) >= 8 &&
    Math.abs(Number(value.x)) <= 1_000_000 &&
    Math.abs(Number(value.y)) <= 1_000_000 &&
    Number(value.width) <= 100_000 &&
    Number(value.height) <= 100_000
  );
}

function isColor(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value))
  );
}

function isParameter(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'id',
      'name',
      'type',
      'direction',
      'multiplicity',
      'defaultValue',
    ]) &&
    (value.id === undefined || isIdentifier(value.id)) &&
    boundedString(value.name, 512) &&
    boundedString(value.type, 512) &&
    directions.has(String(value.direction)) &&
    (value.multiplicity === undefined ||
      boundedString(value.multiplicity, 128)) &&
    (value.defaultValue === undefined ||
      boundedString(value.defaultValue, 2_048))
  );
}

function isAttribute(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'id',
      'name',
      'type',
      'visibility',
      'isStatic',
      'isReadOnly',
      'multiplicity',
      'defaultValue',
      'documentation',
      'taggedValues',
    ]) &&
    (value.id === undefined || isIdentifier(value.id)) &&
    boundedString(value.name, 512) &&
    boundedString(value.type, 512) &&
    visibilities.has(String(value.visibility)) &&
    typeof value.isStatic === 'boolean' &&
    typeof value.isReadOnly === 'boolean' &&
    (value.multiplicity === undefined ||
      boundedString(value.multiplicity, 128)) &&
    (value.defaultValue === undefined ||
      boundedString(value.defaultValue, 2_048)) &&
    (value.documentation === undefined ||
      boundedString(value.documentation)) &&
    isTaggedValues(value.taggedValues)
  );
}

function isOperationMember(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'id',
      'name',
      'returnType',
      'visibility',
      'isAbstract',
      'isStatic',
      'parameters',
      'documentation',
      'taggedValues',
    ]) &&
    (value.id === undefined || isIdentifier(value.id)) &&
    boundedString(value.name, 512) &&
    boundedString(value.returnType, 512) &&
    visibilities.has(String(value.visibility)) &&
    typeof value.isAbstract === 'boolean' &&
    typeof value.isStatic === 'boolean' &&
    Array.isArray(value.parameters) &&
    value.parameters.length <= 128 &&
    value.parameters.every(isParameter) &&
    (value.documentation === undefined ||
      boundedString(value.documentation)) &&
    isTaggedValues(value.taggedValues)
  );
}

export function isDiagramAgentElementChanges(
  value: unknown,
): value is DiagramAgentElementChanges {
  if (!isRecord(value)) {
    return false;
  }
  const keys = [
    'name',
    'documentation',
    'stereotypes',
    'taggedValues',
    'bounds',
    'color',
    'isAbstract',
    'attributes',
    'operations',
    'literals',
    'classifierRef',
    'lifelineId',
    'orientation',
    'partitionId',
    'objectType',
  ];
  return (
    hasOnlyKeys(value, keys) &&
    (value.name === undefined || boundedString(value.name, 512)) &&
    (value.documentation === undefined ||
      value.documentation === null ||
      boundedString(value.documentation)) &&
    (value.stereotypes === undefined || isStringList(value.stereotypes)) &&
    (value.taggedValues === undefined || isTaggedValues(value.taggedValues)) &&
    (value.bounds === undefined || isBounds(value.bounds)) &&
    (value.color === undefined || isColor(value.color)) &&
    (value.isAbstract === undefined ||
      typeof value.isAbstract === 'boolean') &&
    (value.attributes === undefined ||
      (Array.isArray(value.attributes) &&
        value.attributes.length <= 256 &&
        value.attributes.every(isAttribute))) &&
    (value.operations === undefined ||
      (Array.isArray(value.operations) &&
        value.operations.length <= 256 &&
        value.operations.every(isOperationMember))) &&
    (value.literals === undefined || isStringList(value.literals)) &&
    (value.classifierRef === undefined ||
      value.classifierRef === null ||
      isIdentifier(value.classifierRef)) &&
    (value.lifelineId === undefined || isIdentifier(value.lifelineId)) &&
    (value.orientation === undefined ||
      value.orientation === 'vertical' ||
      value.orientation === 'horizontal') &&
    (value.partitionId === undefined ||
      value.partitionId === null ||
      isIdentifier(value.partitionId)) &&
    (value.objectType === undefined ||
      value.objectType === null ||
      boundedString(value.objectType, 512))
  );
}

export function isDiagramAgentRelationshipChanges(
  value: unknown,
): value is DiagramAgentRelationshipChanges {
  if (!isRecord(value)) {
    return false;
  }
  const keys = [
    'name',
    'documentation',
    'stereotypes',
    'taggedValues',
    'sourceRef',
    'targetRef',
    'sourceMultiplicity',
    'targetMultiplicity',
    'wholeEnd',
    'order',
    'guard',
  ];
  return (
    hasOnlyKeys(value, keys) &&
    (value.name === undefined || boundedString(value.name, 512)) &&
    (value.documentation === undefined ||
      value.documentation === null ||
      boundedString(value.documentation)) &&
    (value.stereotypes === undefined || isStringList(value.stereotypes)) &&
    (value.taggedValues === undefined || isTaggedValues(value.taggedValues)) &&
    (value.sourceRef === undefined || isIdentifier(value.sourceRef)) &&
    (value.targetRef === undefined || isIdentifier(value.targetRef)) &&
    (value.sourceMultiplicity === undefined ||
      value.sourceMultiplicity === null ||
      boundedString(value.sourceMultiplicity, 128)) &&
    (value.targetMultiplicity === undefined ||
      value.targetMultiplicity === null ||
      boundedString(value.targetMultiplicity, 128)) &&
    (value.wholeEnd === undefined ||
      value.wholeEnd === null ||
      value.wholeEnd === 'source' ||
      value.wholeEnd === 'target') &&
    (value.order === undefined ||
      (Number.isSafeInteger(value.order) && Number(value.order) >= 1)) &&
    (value.guard === undefined ||
      value.guard === null ||
      boundedString(value.guard, 2_048))
  );
}

export function isDiagramAgentOperation(
  value: unknown,
): value is DiagramAgentOperation {
  if (!isRecord(value) || !boundedString(value.type, 64, false)) {
    return false;
  }
  switch (value.type) {
    case 'add-element':
      return (
        hasOnlyKeys(value, ['type', 'ref', 'kind', 'changes']) &&
        isIdentifier(value.ref) &&
        elementKinds.has(value.kind as DiagramElement['kind']) &&
        (value.changes === undefined ||
          isDiagramAgentElementChanges(value.changes))
      );
    case 'update-element':
      return (
        hasOnlyKeys(value, ['type', 'elementRef', 'changes']) &&
        isIdentifier(value.elementRef) &&
        isDiagramAgentElementChanges(value.changes)
      );
    case 'remove-element':
      return (
        hasOnlyKeys(value, ['type', 'elementRef']) &&
        isIdentifier(value.elementRef)
      );
    case 'add-relationship':
      return (
        hasOnlyKeys(value, [
          'type',
          'ref',
          'kind',
          'sourceRef',
          'targetRef',
          'changes',
        ]) &&
        isIdentifier(value.ref) &&
        relationshipKinds.has(
          value.kind as DiagramRelationship['kind'],
        ) &&
        isIdentifier(value.sourceRef) &&
        isIdentifier(value.targetRef) &&
        (value.changes === undefined ||
          isDiagramAgentRelationshipChanges(value.changes))
      );
    case 'update-relationship':
      return (
        hasOnlyKeys(value, ['type', 'relationshipRef', 'changes']) &&
        isIdentifier(value.relationshipRef) &&
        isDiagramAgentRelationshipChanges(value.changes)
      );
    case 'remove-relationship':
      return (
        hasOnlyKeys(value, ['type', 'relationshipRef']) &&
        isIdentifier(value.relationshipRef)
      );
    case 'update-settings':
      return (
        hasOnlyKeys(value, ['type', 'changes']) &&
        isRecord(value.changes) &&
        hasOnlyKeys(value.changes, ['showGrid', 'snapToGrid', 'gridSize']) &&
        (value.changes.showGrid === undefined ||
          typeof value.changes.showGrid === 'boolean') &&
        (value.changes.snapToGrid === undefined ||
          typeof value.changes.snapToGrid === 'boolean') &&
        (value.changes.gridSize === undefined ||
          (Number.isSafeInteger(value.changes.gridSize) &&
            Number(value.changes.gridSize) >= 4 &&
            Number(value.changes.gridSize) <= 256))
      );
    default:
      return false;
  }
}

function isOperations(value: unknown): value is readonly DiagramAgentOperation[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= DIAGRAM_AGENT_MAX_OPERATIONS &&
    value.every(isDiagramAgentOperation)
  );
}

export function isDiagramAgentChangeRequest(
  value: unknown,
): value is DiagramAgentChangeRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['nodeId', 'summary', 'operations']) &&
    isIdentifier(value.nodeId) &&
    boundedString(value.summary, 2_048, false) &&
    isOperations(value.operations)
  );
}

export function isDiagramAgentCreateRequest(
  value: unknown,
): value is DiagramAgentCreateRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'name',
      'diagramType',
      'parentId',
      'summary',
      'operations',
    ]) &&
    boundedString(value.name, 100, false) &&
    diagramTypes.has(String(value.diagramType)) &&
    (value.parentId === undefined ||
      value.parentId === null ||
      isIdentifier(value.parentId)) &&
    boundedString(value.summary, 2_048, false) &&
    isOperations(value.operations)
  );
}

export function isDiagramAgentToolCall(
  value: unknown,
): value is DiagramAgentToolCall {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['id', 'name', 'args']) ||
    !isIdentifier(value.id) ||
    !DIAGRAM_AGENT_TOOL_NAMES.includes(
      value.name as (typeof DIAGRAM_AGENT_TOOL_NAMES)[number],
    )
  ) {
    return false;
  }
  switch (value.name) {
    case 'list_project_diagrams':
      return (
        isRecord(value.args) &&
        hasOnlyKeys(value.args, ['scope']) &&
        (value.args.scope === 'current' || value.args.scope === 'project')
      );
    case 'read_diagram':
    case 'validate_diagram':
      return (
        isRecord(value.args) &&
        hasOnlyKeys(value.args, ['nodeId']) &&
        isIdentifier(value.args.nodeId)
      );
    case 'propose_diagram_changes':
      return isDiagramAgentChangeRequest(value.args);
    case 'propose_new_diagram':
      return isDiagramAgentCreateRequest(value.args);
    default:
      return false;
  }
}
