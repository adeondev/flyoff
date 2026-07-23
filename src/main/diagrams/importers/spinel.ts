import {
  createDiagramDocument,
  type DiagramDiagnostic,
  type DiagramElement,
  type DiagramRelationship,
  type UmlAttribute,
  type UmlOperation,
} from '../../../shared/diagram';
import {
  externalElementKinds,
  externalRelationshipKinds,
  importedElement,
  importedRelationship,
  normalizedExternalType,
  sourceRef,
} from './shared';
import type { DiagramImportResult, ImportIdFactory } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').slice(0, 128)
    : [];
}

function taggedValues(value: unknown): readonly { key: string; value: string }[] {
  return isRecord(value)
    ? Object.entries(value)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .slice(0, 256)
        .map(([key, item]) => ({ key, value: item }))
    : [];
}

function mapAttributes(value: unknown, createId: ImportIdFactory): readonly UmlAttribute[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) {
          return [];
        }
        const visibility = ['public', 'private', 'protected', 'package'].includes(
          String(item.visibility),
        )
          ? (item.visibility as UmlAttribute['visibility'])
          : 'package';
        return [
          {
            id: createId(),
            name: stringValue(item.name, 'attribute'),
            type: stringValue(item.type),
            visibility,
            isStatic: item.isStatic === true,
            isReadOnly: item.isReadOnly === true,
            taggedValues: [],
          },
        ];
      })
    : [];
}

function mapOperations(value: unknown, createId: ImportIdFactory): readonly UmlOperation[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) {
          return [];
        }
        const visibility = ['public', 'private', 'protected', 'package'].includes(
          String(item.visibility),
        )
          ? (item.visibility as UmlOperation['visibility'])
          : 'package';
        return [
          {
            id: createId(),
            name: stringValue(item.name, 'operation'),
            returnType: stringValue(item.returnType),
            visibility,
            isAbstract: item.isAbstract === true,
            isStatic: item.isStatic === true,
            parameters: Array.isArray(item.parameters)
              ? item.parameters.flatMap((parameter) =>
                  isRecord(parameter)
                    ? [
                        {
                          id: createId(),
                          name: stringValue(parameter.name, 'parameter'),
                          type: stringValue(parameter.type),
                          direction: 'in' as const,
                        },
                      ]
                    : [],
                )
              : [],
            taggedValues: [],
          },
        ];
      })
    : [];
}

export function importSpinel(
  value: unknown,
  createId: ImportIdFactory,
): DiagramImportResult {
  if (!isRecord(value) || !isRecord(value.model) || !Array.isArray(value.diagrams)) {
    throw new Error('The Spinel project has an invalid structure.');
  }
  const sourceElements = isRecord(value.model.elements) ? value.model.elements : {};
  const sourceRelationships = isRecord(value.model.relationships)
    ? value.model.relationships
    : {};
  const elementIds = new Map<string, string>();
  const relationshipIds = new Map<string, string>();
  const elements = new Map<string, DiagramElement>();
  const relationships = new Map<string, DiagramRelationship>();
  const sharedDiagnostics: DiagramDiagnostic[] = [];

  for (const [externalId, candidate] of Object.entries(sourceElements)) {
    if (!isRecord(candidate)) {
      continue;
    }
    const kind = externalElementKinds[normalizedExternalType(stringValue(candidate.type))];
    if (!kind) {
      sharedDiagnostics.push({
        code: 'spinel.element-unsupported',
        severity: 'warning',
        message: `Unsupported Spinel element: ${stringValue(candidate.type, 'unknown')}.`,
      });
      continue;
    }
    let element = importedElement(
      kind,
      externalId,
      stringValue(candidate.name, kind),
      'spinel',
      createId,
    );
    element = {
      ...element,
      documentation: stringValue(candidate.documentation) || undefined,
      stereotypes: stringList(candidate.stereotypes),
      taggedValues: taggedValues(candidate.tags),
    };
    if (element.kind === 'class') {
      element = {
        ...element,
        isAbstract: candidate.isAbstract === true,
        attributes: mapAttributes(candidate.attributes, createId),
        operations: mapOperations(candidate.operations, createId),
      };
    } else if (element.kind === 'interface') {
      element = {
        ...element,
        attributes: mapAttributes(candidate.attributes, createId),
        operations: mapOperations(candidate.operations, createId),
      };
    }
    elementIds.set(externalId, element.id);
    elements.set(externalId, element);
  }

  let messageOrder = 0;
  for (const [externalId, candidate] of Object.entries(sourceRelationships)) {
    if (!isRecord(candidate)) {
      continue;
    }
    const kind = externalRelationshipKinds[
      normalizedExternalType(stringValue(candidate.type))
    ];
    const sourceId = elementIds.get(stringValue(candidate.sourceId));
    const targetId = elementIds.get(stringValue(candidate.targetId));
    if (!kind || !sourceId || !targetId) {
      sharedDiagnostics.push({
        code: 'spinel.relationship-unsupported',
        severity: 'warning',
        message: `A Spinel relationship could not be imported.`,
      });
      continue;
    }
    let relationship = importedRelationship(
      kind,
      externalId,
      sourceId,
      targetId,
      'spinel',
      createId,
    );
    const properties = isRecord(candidate.properties) ? candidate.properties : {};
    relationship = { ...relationship, name: stringValue(candidate.name) };
    if ('order' in relationship) {
      messageOrder += 1;
      relationship = {
        ...relationship,
        order: Number.isSafeInteger(properties.order)
          ? Number(properties.order)
          : messageOrder,
      };
    } else if ('guard' in relationship) {
      relationship = {
        ...relationship,
        guard: stringValue(properties.guard) || undefined,
      };
    } else if ('sourceMultiplicity' in relationship) {
      relationship = {
        ...relationship,
        sourceMultiplicity: stringValue(properties.sourceMultiplicity) || undefined,
        targetMultiplicity: stringValue(properties.targetMultiplicity) || undefined,
        wholeEnd:
          properties.wholeEnd === 'source' || properties.wholeEnd === 'target'
            ? properties.wholeEnd
            : undefined,
      };
    }
    relationshipIds.set(externalId, relationship.id);
    relationships.set(externalId, relationship);
  }

  const imported = value.diagrams.flatMap((candidate) => {
    if (!isRecord(candidate)) {
      return [];
    }
    const type = candidate.type;
    if (type !== 'class' && type !== 'use-case' && type !== 'sequence' && type !== 'activity') {
      return [];
    }
    const externalDiagramId = stringValue(candidate.id, createId());
    const sourceElementIds = stringList(candidate.elementIds);
    const selectedElements = sourceElementIds.flatMap((id) => {
      const element = elements.get(id);
      return element ? [element] : [];
    });
    const selectedIds = new Set(selectedElements.map(({ id }) => id));
    const selectedRelationships = [...relationships.entries()].flatMap(
      ([externalId, relationship]) =>
        selectedIds.has(relationship.sourceId) && selectedIds.has(relationship.targetId)
          ? [{ externalId, relationship }]
          : [],
    );
    const presentations = isRecord(candidate.presentations) ? candidate.presentations : {};
    const edgePresentations = isRecord(candidate.edgePresentations)
      ? candidate.edgePresentations
      : {};
    const nodePresentations = sourceElementIds.flatMap((externalId, index) => {
      const elementId = elementIds.get(externalId);
      const source = presentations[externalId];
      if (!elementId || !isRecord(source)) {
        return [];
      }
      const width = Number(source.width);
      const height = Number(source.height);
      return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
        ? [
            {
              id: createId(),
              elementId,
              bounds: {
                x: Number.isFinite(Number(source.x)) ? Number(source.x) : 100,
                y: Number.isFinite(Number(source.y)) ? Number(source.y) : 100,
                width,
                height,
              },
              zIndex: Number.isSafeInteger(source.zIndex) ? Number(source.zIndex) : index,
            },
          ]
        : [];
    });
    const presentationByElement = new Map(
      nodePresentations.map((presentation) => [presentation.elementId, presentation]),
    );
    const edges = selectedRelationships.flatMap(({ externalId, relationship }) => {
      const sourcePresentation = presentationByElement.get(relationship.sourceId);
      const targetPresentation = presentationByElement.get(relationship.targetId);
      if (!sourcePresentation || !targetPresentation) {
        return [];
      }
      const source = edgePresentations[externalId];
      const points =
        isRecord(source) && Array.isArray(source.points)
          ? source.points.flatMap((point) =>
              isRecord(point) && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
                ? [{ x: Number(point.x), y: Number(point.y) }]
                : [],
            )
          : [];
      return [
        {
          id: createId(),
          relationshipId: relationship.id,
          sourcePresentationId: sourcePresentation.id,
          targetPresentationId: targetPresentation.id,
          points,
        },
      ];
    });
    const document = {
      ...createDiagramDocument(type, createId),
      elements: selectedElements,
      relationships: selectedRelationships.map(({ relationship }) => relationship),
      presentations: { nodes: nodePresentations, edges },
      settings: {
        showGrid: true,
        snapToGrid: isRecord(value.settings) ? value.settings.snapToGrid !== false : true,
        gridSize:
          isRecord(value.settings) &&
          Number.isSafeInteger(value.settings.gridSize) &&
          Number(value.settings.gridSize) >= 4 &&
          Number(value.settings.gridSize) <= 100
            ? Number(value.settings.gridSize)
            : 16,
      },
      sourceRef: sourceRef('spinel', externalDiagramId),
    };
    const missing = sourceElementIds.length - selectedElements.length;
    const diagnostics = [
      ...sharedDiagnostics,
      ...(missing > 0
        ? [
            {
              code: 'spinel.elements-missing',
              severity: 'warning' as const,
              message: `${missing} diagram element(s) were not supported.`,
            },
          ]
        : []),
    ];
    return [
      {
        importId: createId(),
        name: stringValue(candidate.name, 'Imported diagram'),
        document,
        fidelity: diagnostics.length > 0 ? ('partial' as const) : ('high' as const),
        diagnostics,
      },
    ];
  });
  if (imported.length === 0) {
    throw new Error('The Spinel project contains no supported diagrams.');
  }
  return { sourceFormat: 'spinel', diagrams: imported };
}
