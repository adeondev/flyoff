import {
  createDiagramElement,
  createDiagramRelationship,
} from './factories';
import {
  type DiagramAgentApplyOptions,
  type DiagramAgentAttribute,
  type DiagramAgentElementChanges,
  type DiagramAgentOperation,
  type DiagramAgentOperationMember,
  type DiagramAgentOperationSummary,
  type DiagramAgentPlanResult,
  type DiagramAgentRelationshipChanges,
} from './agent-types';
import {
  validateDiagramDocument,
} from './validation';
import { validateUmlSemantics } from './uml-validation';
import type {
  DiagramDocument,
  DiagramElement,
  DiagramRelationship,
  UmlAttribute,
  UmlOperation,
  UmlParameter,
} from './types';

const allowedElementKinds: Record<
  DiagramDocument['diagramType'],
  ReadonlySet<DiagramElement['kind']>
> = {
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

const allowedRelationshipKinds: Record<
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
  'use-case': new Set([
    'association',
    'include',
    'extend',
    'generalization',
  ]),
  sequence: new Set([
    'message-synchronous',
    'message-asynchronous',
    'message-return',
    'self-message',
  ]),
  activity: new Set(['control-flow', 'object-flow']),
};

function resolveRef(
  ref: string,
  temporaryIds: ReadonlyMap<string, string>,
): string {
  return temporaryIds.get(ref) ?? ref;
}

function optionalField<T>(
  value: T | null | undefined,
): T | undefined {
  return value === null ? undefined : value;
}

function updateParameters(
  values: readonly { id?: string }[] & readonly unknown[],
  existing: readonly UmlParameter[],
  createId: () => string,
): readonly UmlParameter[] {
  const known = new Set(existing.map(({ id }) => id));
  return (values as readonly (Omit<UmlParameter, 'id'> & { id?: string })[]).map(
    (value) => ({
      ...value,
      id: value.id && known.has(value.id) ? value.id : createId(),
    }),
  );
}

function updateAttributes(
  values: readonly DiagramAgentAttribute[],
  existing: readonly UmlAttribute[],
  createId: () => string,
): readonly UmlAttribute[] {
  const known = new Set(existing.map(({ id }) => id));
  return values.map((value) => ({
    ...value,
    id: value.id && known.has(value.id) ? value.id : createId(),
  }));
}

function updateOperations(
  values: readonly DiagramAgentOperationMember[],
  existing: readonly UmlOperation[],
  createId: () => string,
): readonly UmlOperation[] {
  const known = new Map(existing.map((operation) => [operation.id, operation]));
  return values.map((value) => {
    const previous = value.id ? known.get(value.id) : undefined;
    return {
      ...value,
      id: previous ? previous.id : createId(),
      parameters: updateParameters(
        value.parameters,
        previous?.parameters ?? [],
        createId,
      ),
    };
  });
}

function commonElementChanges(
  element: DiagramElement,
  changes: DiagramAgentElementChanges,
): DiagramElement {
  return {
    ...element,
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.documentation !== undefined
      ? { documentation: optionalField(changes.documentation) }
      : {}),
    ...(changes.stereotypes !== undefined
      ? { stereotypes: [...changes.stereotypes] }
      : {}),
    ...(changes.taggedValues !== undefined
      ? { taggedValues: [...changes.taggedValues] }
      : {}),
  } as DiagramElement;
}

function applyElementModelChanges(
  element: DiagramElement,
  changes: DiagramAgentElementChanges,
  temporaryIds: ReadonlyMap<string, string>,
  createId: () => string,
): DiagramElement {
  const common = commonElementChanges(element, changes);
  switch (common.kind) {
    case 'class':
      return {
        ...common,
        ...(changes.isAbstract !== undefined
          ? { isAbstract: changes.isAbstract }
          : {}),
        ...(changes.attributes
          ? {
              attributes: updateAttributes(
                changes.attributes,
                common.attributes,
                createId,
              ),
            }
          : {}),
        ...(changes.operations
          ? {
              operations: updateOperations(
                changes.operations,
                common.operations,
                createId,
              ),
            }
          : {}),
      };
    case 'interface':
      return {
        ...common,
        ...(changes.attributes
          ? {
              attributes: updateAttributes(
                changes.attributes,
                common.attributes,
                createId,
              ),
            }
          : {}),
        ...(changes.operations
          ? {
              operations: updateOperations(
                changes.operations,
                common.operations,
                createId,
              ),
            }
          : {}),
      };
    case 'enumeration':
      return {
        ...common,
        ...(changes.literals ? { literals: [...changes.literals] } : {}),
      };
    case 'lifeline':
      return {
        ...common,
        ...(changes.classifierRef !== undefined
          ? {
              classifierRef: optionalField(
                changes.classifierRef === null
                  ? null
                  : resolveRef(changes.classifierRef, temporaryIds),
              ),
            }
          : {}),
      };
    case 'activation':
      return {
        ...common,
        ...(changes.lifelineId
          ? {
              lifelineId: resolveRef(changes.lifelineId, temporaryIds),
            }
          : {}),
      };
    case 'activity-partition':
      return {
        ...common,
        ...(changes.orientation
          ? { orientation: changes.orientation }
          : {}),
      };
    case 'object-node':
      return {
        ...common,
        ...(changes.objectType !== undefined
          ? { objectType: optionalField(changes.objectType) }
          : {}),
        ...(changes.partitionId !== undefined
          ? {
              partitionId: optionalField(
                changes.partitionId === null
                  ? null
                  : resolveRef(changes.partitionId, temporaryIds),
              ),
            }
          : {}),
      };
    case 'action':
    case 'initial-node':
    case 'activity-final':
    case 'flow-final':
    case 'decision':
    case 'merge':
    case 'fork':
    case 'join':
      return {
        ...common,
        ...(changes.partitionId !== undefined
          ? {
              partitionId: optionalField(
                changes.partitionId === null
                  ? null
                  : resolveRef(changes.partitionId, temporaryIds),
              ),
            }
          : {}),
      };
    default:
      return common;
  }
}

function applyPresentationChanges(
  document: DiagramDocument,
  elementId: string,
  changes: DiagramAgentElementChanges,
): DiagramDocument['presentations']['nodes'] {
  return document.presentations.nodes.map((presentation) =>
    presentation.elementId === elementId
      ? {
          ...presentation,
          ...(changes.bounds ? { bounds: { ...changes.bounds } } : {}),
          ...(changes.color !== undefined
            ? {
                appearance:
                  changes.color === null
                    ? undefined
                    : { color: changes.color },
              }
            : {}),
        }
      : presentation,
  );
}

function commonRelationshipChanges(
  relationship: DiagramRelationship,
  changes: DiagramAgentRelationshipChanges,
  temporaryIds: ReadonlyMap<string, string>,
): DiagramRelationship {
  return {
    ...relationship,
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.documentation !== undefined
      ? { documentation: optionalField(changes.documentation) }
      : {}),
    ...(changes.stereotypes !== undefined
      ? { stereotypes: [...changes.stereotypes] }
      : {}),
    ...(changes.taggedValues !== undefined
      ? { taggedValues: [...changes.taggedValues] }
      : {}),
    ...(changes.sourceRef
      ? { sourceId: resolveRef(changes.sourceRef, temporaryIds) }
      : {}),
    ...(changes.targetRef
      ? { targetId: resolveRef(changes.targetRef, temporaryIds) }
      : {}),
  } as DiagramRelationship;
}

function applyRelationshipChanges(
  relationship: DiagramRelationship,
  changes: DiagramAgentRelationshipChanges,
  temporaryIds: ReadonlyMap<string, string>,
): DiagramRelationship {
  const common = commonRelationshipChanges(
    relationship,
    changes,
    temporaryIds,
  );
  if (
    common.kind === 'message-synchronous' ||
    common.kind === 'message-asynchronous' ||
    common.kind === 'message-return' ||
    common.kind === 'self-message'
  ) {
    return {
      ...common,
      ...(changes.order !== undefined ? { order: changes.order } : {}),
      ...(changes.guard !== undefined
        ? { guard: optionalField(changes.guard) }
        : {}),
    };
  }
  if (common.kind === 'control-flow' || common.kind === 'object-flow') {
    return {
      ...common,
      ...(changes.guard !== undefined
        ? { guard: optionalField(changes.guard) }
        : {}),
    };
  }
  if (
    common.kind === 'association' ||
    common.kind === 'directed-association' ||
    common.kind === 'aggregation' ||
    common.kind === 'composition' ||
    common.kind === 'realization' ||
    common.kind === 'dependency'
  ) {
    return {
      ...common,
      ...(changes.sourceMultiplicity !== undefined
        ? {
            sourceMultiplicity: optionalField(
              changes.sourceMultiplicity,
            ),
          }
        : {}),
      ...(changes.targetMultiplicity !== undefined
        ? {
            targetMultiplicity: optionalField(
              changes.targetMultiplicity,
            ),
          }
        : {}),
      ...(changes.wholeEnd !== undefined
        ? { wholeEnd: optionalField(changes.wholeEnd) }
        : {}),
    };
  }
  return common;
}

function emptySummary(): DiagramAgentOperationSummary {
  return {
    addedElements: 0,
    updatedElements: 0,
    removedElements: 0,
    addedRelationships: 0,
    updatedRelationships: 0,
    removedRelationships: 0,
    settingsChanged: false,
    destructive: false,
  };
}

export function applyDiagramAgentOperations(
  source: DiagramDocument,
  operations: readonly DiagramAgentOperation[],
  options: DiagramAgentApplyOptions = {},
): DiagramAgentPlanResult {
  const createId = options.createId ?? (() => crypto.randomUUID());
  const temporaryIds = new Map<string, string>();
  const summary = emptySummary();
  let document = source;

  for (const operation of operations) {
    switch (operation.type) {
      case 'add-element': {
        if (!allowedElementKinds[document.diagramType].has(operation.kind)) {
          throw new TypeError(
            `Element ${operation.kind} is not valid in a ${document.diagramType} diagram.`,
          );
        }
        if (temporaryIds.has(operation.ref)) {
          throw new TypeError(`Duplicate temporary reference ${operation.ref}.`);
        }
        const created = createDiagramElement(operation.kind, { createId });
        temporaryIds.set(operation.ref, created.element.id);
        const changes = operation.changes ?? {};
        const element = applyElementModelChanges(
          created.element,
          changes,
          temporaryIds,
          createId,
        );
        const presentation = {
          ...created.presentation,
          ...(changes.bounds ? { bounds: { ...changes.bounds } } : {}),
          ...(changes.color ? { appearance: { color: changes.color } } : {}),
          zIndex: document.presentations.nodes.length,
        };
        document = {
          ...document,
          elements: [...document.elements, element],
          presentations: {
            ...document.presentations,
            nodes: [...document.presentations.nodes, presentation],
          },
        };
        summary.addedElements += 1;
        break;
      }
      case 'update-element': {
        const elementId = resolveRef(operation.elementRef, temporaryIds);
        const existing = document.elements.find(({ id }) => id === elementId);
        if (!existing) {
          throw new TypeError(`Unknown element reference ${operation.elementRef}.`);
        }
        document = {
          ...document,
          elements: document.elements.map((element) =>
            element.id === elementId
              ? applyElementModelChanges(
                  element,
                  operation.changes,
                  temporaryIds,
                  createId,
                )
              : element,
          ),
          presentations: {
            ...document.presentations,
            nodes: applyPresentationChanges(
              document,
              elementId,
              operation.changes,
            ),
          },
        };
        summary.updatedElements += 1;
        break;
      }
      case 'remove-element': {
        const elementId = resolveRef(operation.elementRef, temporaryIds);
        if (!document.elements.some(({ id }) => id === elementId)) {
          throw new TypeError(`Unknown element reference ${operation.elementRef}.`);
        }
        const removedRelationshipIds = new Set(
          document.relationships
            .filter(
              ({ sourceId, targetId }) =>
                sourceId === elementId || targetId === elementId,
            )
            .map(({ id }) => id),
        );
        const nodePresentationIds = new Set(
          document.presentations.nodes
            .filter(({ elementId: id }) => id === elementId)
            .map(({ id }) => id),
        );
        document = {
          ...document,
          elements: document.elements.filter(({ id }) => id !== elementId),
          relationships: document.relationships.filter(
            ({ id }) => !removedRelationshipIds.has(id),
          ),
          presentations: {
            nodes: document.presentations.nodes.filter(
              ({ elementId: id }) => id !== elementId,
            ),
            edges: document.presentations.edges.filter(
              ({ relationshipId, sourcePresentationId, targetPresentationId }) =>
                !removedRelationshipIds.has(relationshipId) &&
                !nodePresentationIds.has(sourcePresentationId) &&
                !nodePresentationIds.has(targetPresentationId),
            ),
          },
        };
        summary.removedElements += 1;
        summary.removedRelationships += removedRelationshipIds.size;
        summary.destructive = true;
        break;
      }
      case 'add-relationship': {
        if (
          !allowedRelationshipKinds[document.diagramType].has(operation.kind)
        ) {
          throw new TypeError(
            `Relationship ${operation.kind} is not valid in a ${document.diagramType} diagram.`,
          );
        }
        if (temporaryIds.has(operation.ref)) {
          throw new TypeError(`Duplicate temporary reference ${operation.ref}.`);
        }
        const sourceId = resolveRef(operation.sourceRef, temporaryIds);
        const targetId = resolveRef(operation.targetRef, temporaryIds);
        const sourcePresentation = document.presentations.nodes.find(
          ({ elementId }) => elementId === sourceId,
        );
        const targetPresentation = document.presentations.nodes.find(
          ({ elementId }) => elementId === targetId,
        );
        if (!sourcePresentation || !targetPresentation) {
          throw new TypeError(
            `Relationship ${operation.ref} has an unknown endpoint.`,
          );
        }
        const relationshipId = createId();
        const base = createDiagramRelationship(
          operation.kind,
          sourceId,
          targetId,
          () => relationshipId,
        );
        temporaryIds.set(operation.ref, relationshipId);
        const relationship = applyRelationshipChanges(
          base,
          operation.changes ?? {},
          temporaryIds,
        );
        document = {
          ...document,
          relationships: [...document.relationships, relationship],
          presentations: {
            ...document.presentations,
            edges: [
              ...document.presentations.edges,
              {
                id: createId(),
                relationshipId,
                sourcePresentationId: sourcePresentation.id,
                targetPresentationId: targetPresentation.id,
                points: [],
              },
            ],
          },
        };
        summary.addedRelationships += 1;
        break;
      }
      case 'update-relationship': {
        const relationshipId = resolveRef(
          operation.relationshipRef,
          temporaryIds,
        );
        const existing = document.relationships.find(
          ({ id }) => id === relationshipId,
        );
        if (!existing) {
          throw new TypeError(
            `Unknown relationship reference ${operation.relationshipRef}.`,
          );
        }
        const relationship = applyRelationshipChanges(
          existing,
          operation.changes,
          temporaryIds,
        );
        const sourcePresentation = document.presentations.nodes.find(
          ({ elementId }) => elementId === relationship.sourceId,
        );
        const targetPresentation = document.presentations.nodes.find(
          ({ elementId }) => elementId === relationship.targetId,
        );
        if (!sourcePresentation || !targetPresentation) {
          throw new TypeError('Updated relationship has an unknown endpoint.');
        }
        document = {
          ...document,
          relationships: document.relationships.map((entry) =>
            entry.id === relationshipId ? relationship : entry,
          ),
          presentations: {
            ...document.presentations,
            edges: document.presentations.edges.map((edge) =>
              edge.relationshipId === relationshipId
                ? {
                    ...edge,
                    sourcePresentationId: sourcePresentation.id,
                    targetPresentationId: targetPresentation.id,
                  }
                : edge,
            ),
          },
        };
        summary.updatedRelationships += 1;
        break;
      }
      case 'remove-relationship': {
        const relationshipId = resolveRef(
          operation.relationshipRef,
          temporaryIds,
        );
        if (!document.relationships.some(({ id }) => id === relationshipId)) {
          throw new TypeError(
            `Unknown relationship reference ${operation.relationshipRef}.`,
          );
        }
        document = {
          ...document,
          relationships: document.relationships.filter(
            ({ id }) => id !== relationshipId,
          ),
          presentations: {
            ...document.presentations,
            edges: document.presentations.edges.filter(
              ({ relationshipId: id }) => id !== relationshipId,
            ),
          },
        };
        summary.removedRelationships += 1;
        summary.destructive = true;
        break;
      }
      case 'update-settings':
        document = {
          ...document,
          settings: { ...document.settings, ...operation.changes },
        };
        summary.settingsChanged = true;
        break;
    }
  }

  const structural = validateDiagramDocument(document);
  if (!structural.ok) {
    throw new TypeError(
      `The generated diagram is structurally invalid: ${structural.issues[0]?.message ?? 'unknown error'}`,
    );
  }
  return {
    document,
    diagnostics: validateUmlSemantics(document),
    summary,
  };
}
