import type {
  DiagramDiagnostic,
  DiagramDocument,
  DiagramElement,
  DiagramRelationship,
} from './types';

const allowedElements: Record<DiagramDocument['diagramType'], ReadonlySet<DiagramElement['kind']>> = {
  class: new Set(['package', 'class', 'interface', 'enumeration']),
  'use-case': new Set(['actor', 'use-case', 'system-boundary']),
  sequence: new Set(['actor', 'lifeline', 'activation']),
  activity: new Set([
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
  ]),
};

const allowedRelationships: Record<
  DiagramDocument['diagramType'],
  ReadonlySet<DiagramRelationship['kind']>
> = {
  class: new Set([
    'association',
    'directed-association',
    'aggregation',
    'composition',
    'generalization',
    'realization',
    'dependency',
  ]),
  'use-case': new Set(['association', 'include', 'extend', 'generalization']),
  sequence: new Set([
    'message-synchronous',
    'message-asynchronous',
    'message-return',
    'self-message',
  ]),
  activity: new Set(['control-flow', 'object-flow']),
};

function diagnostic(
  code: string,
  message: string,
  targetId?: string,
  severity: DiagramDiagnostic['severity'] = 'warning',
): DiagramDiagnostic {
  return { code, message, severity, ...(targetId ? { targetId } : {}) };
}

export function validateUmlSemantics(
  document: DiagramDocument,
): readonly DiagramDiagnostic[] {
  const diagnostics: DiagramDiagnostic[] = [];
  const elements = new Map(document.elements.map((element) => [element.id, element]));
  const nodePresentations = new Map(
    document.presentations.nodes.map((presentation) => [presentation.id, presentation]),
  );
  const relationshipIds = new Set(document.relationships.map(({ id }) => id));

  for (const element of document.elements) {
    if (!allowedElements[document.diagramType].has(element.kind)) {
      diagnostics.push(
        diagnostic(
          'element.incompatible',
          `The ${element.kind} element is not valid in a ${document.diagramType} diagram.`,
          element.id,
        ),
      );
    }
    if (element.kind === 'activation') {
      const lifeline = elements.get(element.lifelineId);
      if (!lifeline || lifeline.kind !== 'lifeline') {
        diagnostics.push(
          diagnostic(
            'activation.lifeline-missing',
            'The activation must reference a lifeline in this diagram.',
            element.id,
          ),
        );
      }
    }
    if ('partitionId' in element && element.partitionId) {
      const partition = elements.get(element.partitionId);
      if (!partition || partition.kind !== 'activity-partition') {
        diagnostics.push(
          diagnostic(
            'activity.partition-missing',
            'The activity node references a partition that is not in this diagram.',
            element.id,
          ),
        );
      }
    }
  }

  for (const relationship of document.relationships) {
    const source = elements.get(relationship.sourceId);
    const target = elements.get(relationship.targetId);
    if (!source || !target) {
      diagnostics.push(
        diagnostic(
          'relationship.endpoint-missing',
          'The relationship has an endpoint that is not in this diagram.',
          relationship.id,
          'error',
        ),
      );
      continue;
    }
    if (!allowedRelationships[document.diagramType].has(relationship.kind)) {
      diagnostics.push(
        diagnostic(
          'relationship.incompatible',
          `The ${relationship.kind} relationship is not valid in a ${document.diagramType} diagram.`,
          relationship.id,
        ),
      );
    }
    if (relationship.kind === 'include' || relationship.kind === 'extend') {
      if (source.kind !== 'use-case' || target.kind !== 'use-case') {
        diagnostics.push(
          diagnostic(
            'use-case.endpoint-invalid',
            `${relationship.kind} must connect two use cases.`,
            relationship.id,
          ),
        );
      }
    }
    if (
      relationship.kind === 'message-synchronous' ||
      relationship.kind === 'message-asynchronous' ||
      relationship.kind === 'message-return' ||
      relationship.kind === 'self-message'
    ) {
      const validEndpoint = (element: DiagramElement) =>
        element.kind === 'actor' || element.kind === 'lifeline';
      if (!validEndpoint(source) || !validEndpoint(target)) {
        diagnostics.push(
          diagnostic(
            'sequence.endpoint-invalid',
            'Messages can connect only actors or lifelines.',
            relationship.id,
          ),
        );
      }
      if (
        (relationship.kind === 'self-message') !==
        (relationship.sourceId === relationship.targetId)
      ) {
        diagnostics.push(
          diagnostic(
            'sequence.self-message-invalid',
            'A self message must start and end at the same participant.',
            relationship.id,
          ),
        );
      }
    }
    if (
      relationship.kind === 'object-flow' &&
      source.kind !== 'object-node' &&
      target.kind !== 'object-node'
    ) {
      diagnostics.push(
        diagnostic(
          'activity.object-flow-invalid',
          'An object flow must touch an object node.',
          relationship.id,
        ),
      );
    }
    if (
      (relationship.kind === 'aggregation' || relationship.kind === 'composition') &&
      !relationship.wholeEnd
    ) {
      diagnostics.push(
        diagnostic(
          'class.whole-end-missing',
          'Aggregation and composition require the whole end to be identified.',
          relationship.id,
        ),
      );
    }
  }

  for (const presentation of document.presentations.nodes) {
    if (!elements.has(presentation.elementId)) {
      diagnostics.push(
        diagnostic(
          'presentation.element-missing',
          'A node presentation references an element that is not in this diagram.',
          presentation.id,
        ),
      );
    }
    if (
      presentation.parentPresentationId &&
      !nodePresentations.has(presentation.parentPresentationId)
    ) {
      diagnostics.push(
        diagnostic(
          'presentation.parent-missing',
          'A node presentation references a missing parent presentation.',
          presentation.id,
        ),
      );
    }
  }
  for (const presentation of document.presentations.edges) {
    if (!relationshipIds.has(presentation.relationshipId)) {
      diagnostics.push(
        diagnostic(
          'presentation.relationship-missing',
          'An edge presentation references a relationship that is not in this diagram.',
          presentation.id,
        ),
      );
    }
    if (
      !nodePresentations.has(presentation.sourcePresentationId) ||
      !nodePresentations.has(presentation.targetPresentationId)
    ) {
      diagnostics.push(
        diagnostic(
          'presentation.endpoint-missing',
          'An edge presentation references a missing node presentation.',
          presentation.id,
        ),
      );
    }
  }

  const sequenceOrders = document.relationships.flatMap((relationship) =>
    relationship.kind === 'message-synchronous' ||
    relationship.kind === 'message-asynchronous' ||
    relationship.kind === 'message-return' ||
    relationship.kind === 'self-message'
      ? [relationship.order]
      : [],
  );
  if (new Set(sequenceOrders).size !== sequenceOrders.length) {
    diagnostics.push(
      diagnostic(
        'sequence.order-duplicate',
        'Sequence message order values should be unique.',
      ),
    );
  }
  return diagnostics;
}
