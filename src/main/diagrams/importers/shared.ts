import {
  createDiagramElement,
  createDiagramRelationship,
  type DiagramDocument,
  type DiagramElement,
  type DiagramRelationship,
  type DiagramSourceRef,
} from '../../../shared/diagram';
import type { ImportIdFactory } from './types';

export function normalizedExternalType(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const externalElementKinds: Readonly<Record<string, DiagramElement['kind']>> = {
  package: 'package',
  class: 'class',
  interface: 'interface',
  enumeration: 'enumeration',
  enum: 'enumeration',
  actor: 'actor',
  usecase: 'use-case',
  systemboundary: 'system-boundary',
  boundary: 'system-boundary',
  lifeline: 'lifeline',
  activation: 'activation',
  executionspecification: 'activation',
  action: 'action',
  callbehavioraction: 'action',
  initialnode: 'initial-node',
  initialpseudostate: 'initial-node',
  activityfinalnode: 'activity-final',
  flowfinalnode: 'flow-final',
  decisionnode: 'decision',
  mergenode: 'merge',
  forknode: 'fork',
  joinnode: 'join',
  objectnode: 'object-node',
  activitypartition: 'activity-partition',
  partition: 'activity-partition',
};

export const externalRelationshipKinds: Readonly<
  Record<string, DiagramRelationship['kind']>
> = {
  association: 'association',
  directedassociation: 'directed-association',
  aggregation: 'aggregation',
  composition: 'composition',
  generalization: 'generalization',
  interfacerealization: 'realization',
  realization: 'realization',
  dependency: 'dependency',
  include: 'include',
  extend: 'extend',
  synchronousmessage: 'message-synchronous',
  messagesynchronous: 'message-synchronous',
  asynchronousmessage: 'message-asynchronous',
  messageasynchronous: 'message-asynchronous',
  returnmessage: 'message-return',
  messagereturn: 'message-return',
  selfmessage: 'self-message',
  controlflow: 'control-flow',
  objectflow: 'object-flow',
};

export function sourceRef(
  system: DiagramSourceRef['system'],
  externalId: string,
  externalDiagramId?: string,
): DiagramSourceRef {
  return {
    system,
    externalId: externalId.slice(0, 4_096),
    ...(externalDiagramId ? { externalDiagramId: externalDiagramId.slice(0, 4_096) } : {}),
  };
}

export function importedElement(
  kind: DiagramElement['kind'],
  externalId: string,
  name: string,
  system: DiagramSourceRef['system'],
  createId: ImportIdFactory,
): DiagramElement {
  const created = createDiagramElement(kind, { createId, name }).element;
  return { ...created, sourceRef: sourceRef(system, externalId) };
}

export function importedRelationship(
  kind: DiagramRelationship['kind'],
  externalId: string,
  sourceId: string,
  targetId: string,
  system: DiagramSourceRef['system'],
  createId: ImportIdFactory,
): DiagramRelationship {
  return {
    ...createDiagramRelationship(kind, sourceId, targetId, createId),
    sourceRef: sourceRef(system, externalId),
  };
}

export function inferDiagramType(
  elements: readonly DiagramElement[],
): DiagramDocument['diagramType'] {
  if (elements.some(({ kind }) => kind === 'lifeline' || kind === 'activation')) {
    return 'sequence';
  }
  if (
    elements.some(({ kind }) =>
      [
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
      ].includes(kind),
    )
  ) {
    return 'activity';
  }
  if (
    elements.some(({ kind }) =>
      kind === 'actor' || kind === 'use-case' || kind === 'system-boundary',
    )
  ) {
    return 'use-case';
  }
  return 'class';
}
