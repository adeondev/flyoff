import {
  createDiagramDocument,
  type DiagramDiagnostic,
  type DiagramElement,
  type DiagramRelationship,
  type DiagramType,
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

function mapDiagramType(value: string): DiagramType | undefined {
  const normalized = normalizedExternalType(value);
  if (normalized.includes('usecase')) return 'use-case';
  if (normalized.includes('sequence')) return 'sequence';
  if (normalized.includes('activity')) return 'activity';
  if (normalized.includes('class')) return 'class';
  return undefined;
}

export function importAstahBridge(
  value: unknown,
  createId: ImportIdFactory,
): DiagramImportResult {
  if (
    !isRecord(value) ||
    value.protocolVersion !== '1.0' ||
    !Array.isArray(value.modelElements) ||
    !Array.isArray(value.relationships) ||
    !Array.isArray(value.diagrams)
  ) {
    throw new Error('The Astah Bridge export has an invalid or unsupported structure.');
  }
  const elementsByExternalId = new Map<string, DiagramElement>();
  const relationshipsByExternalId = new Map<string, DiagramRelationship>();
  const diagnostics: DiagramDiagnostic[] = Array.isArray(value.diagnostics)
    ? value.diagnostics.flatMap((candidate) =>
        isRecord(candidate) &&
        (candidate.severity === 'info' ||
          candidate.severity === 'warning' ||
          candidate.severity === 'error') &&
        typeof candidate.code === 'string' &&
        typeof candidate.message === 'string'
          ? [
              {
                code: candidate.code.slice(0, 256),
                severity: candidate.severity,
                message: candidate.message.slice(0, 4_096),
              },
            ]
          : [],
      )
    : [];

  for (const candidate of value.modelElements) {
    if (!isRecord(candidate)) {
      continue;
    }
    const externalId = stringValue(candidate.id);
    const kind = externalElementKinds[normalizedExternalType(stringValue(candidate.type))];
    if (!externalId || !kind) {
      diagnostics.push({
        code: 'astah.element-unsupported',
        severity: 'warning',
        message: `Unsupported Astah element: ${stringValue(candidate.type, 'unknown')}.`,
      });
      continue;
    }
    const base = importedElement(
      kind,
      externalId,
      stringValue(candidate.name, kind),
      'astah-bridge',
      createId,
    );
    elementsByExternalId.set(externalId, {
      ...base,
      documentation: stringValue(candidate.documentation) || undefined,
      stereotypes: Array.isArray(candidate.stereotypes)
        ? candidate.stereotypes.filter((item): item is string => typeof item === 'string')
        : [],
      taggedValues: isRecord(candidate.taggedValues)
        ? Object.entries(candidate.taggedValues).flatMap(([key, item]) =>
            typeof item === 'string' ? [{ key, value: item }] : [],
          )
        : [],
    });
  }

  let order = 0;
  for (const candidate of value.relationships) {
    if (!isRecord(candidate)) {
      continue;
    }
    const externalId = stringValue(candidate.id);
    const source = elementsByExternalId.get(stringValue(candidate.sourceId));
    const target = elementsByExternalId.get(stringValue(candidate.targetId));
    const kind = externalRelationshipKinds[
      normalizedExternalType(stringValue(candidate.type))
    ];
    if (!externalId || !source || !target || !kind) {
      diagnostics.push({
        code: 'astah.relationship-unsupported',
        severity: 'warning',
        message: `Unsupported Astah relationship: ${stringValue(candidate.type, 'unknown')}.`,
      });
      continue;
    }
    let relationship = importedRelationship(
      kind,
      externalId,
      source.id,
      target.id,
      'astah-bridge',
      createId,
    );
    relationship = { ...relationship, name: stringValue(candidate.name) };
    if ('order' in relationship) {
      order += 1;
      relationship = { ...relationship, order };
    }
    relationshipsByExternalId.set(externalId, relationship);
  }

  const imported = value.diagrams.flatMap((candidate) => {
    if (!isRecord(candidate) || !Array.isArray(candidate.nodes)) {
      return [];
    }
    const type = mapDiagramType(stringValue(candidate.type));
    const externalDiagramId = stringValue(candidate.id);
    if (!type || !externalDiagramId) {
      diagnostics.push({
        code: 'astah.diagram-unsupported',
        severity: 'warning',
        message: `Unsupported Astah diagram: ${stringValue(candidate.type, 'unknown')}.`,
      });
      return [];
    }
    const selectedElements: DiagramElement[] = [];
    const nodes = candidate.nodes.flatMap((node, index) => {
      if (!isRecord(node) || !isRecord(node.bounds)) {
        return [];
      }
      const element = elementsByExternalId.get(stringValue(node.elementId));
      const bounds = node.bounds;
      if (
        !element ||
        !Number.isFinite(Number(bounds.x)) ||
        !Number.isFinite(Number(bounds.y)) ||
        !Number.isFinite(Number(bounds.width)) ||
        !Number.isFinite(Number(bounds.height)) ||
        Number(bounds.width) <= 0 ||
        Number(bounds.height) <= 0
      ) {
        return [];
      }
      selectedElements.push(element);
      return [
        {
          id: createId(),
          elementId: element.id,
          bounds: {
            x: Number(bounds.x),
            y: Number(bounds.y),
            width: Number(bounds.width),
            height: Number(bounds.height),
          },
          zIndex: index,
        },
      ];
    });
    const nodeByElement = new Map(nodes.map((node) => [node.elementId, node]));
    const selectedIds = new Set(selectedElements.map(({ id }) => id));
    const selectedRelationships = [...relationshipsByExternalId.entries()].filter(
      ([, relationship]) =>
        selectedIds.has(relationship.sourceId) && selectedIds.has(relationship.targetId),
    );
    const sourceEdges = Array.isArray(candidate.edges) ? candidate.edges : [];
    const sourceEdgeByRelationship = new Map(
      sourceEdges.flatMap((edge) =>
        isRecord(edge) ? [[stringValue(edge.relationshipId), edge] as const] : [],
      ),
    );
    const edges = selectedRelationships.flatMap(([externalId, relationship]) => {
      const sourceNode = nodeByElement.get(relationship.sourceId);
      const targetNode = nodeByElement.get(relationship.targetId);
      if (!sourceNode || !targetNode) {
        return [];
      }
      const sourceEdge = sourceEdgeByRelationship.get(externalId);
      const points =
        sourceEdge && Array.isArray(sourceEdge.points)
          ? sourceEdge.points.flatMap((point) =>
              isRecord(point) && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
                ? [{ x: Number(point.x), y: Number(point.y) }]
                : [],
            )
          : [];
      return [
        {
          id: createId(),
          relationshipId: relationship.id,
          sourcePresentationId: sourceNode.id,
          targetPresentationId: targetNode.id,
          points,
        },
      ];
    });
    const document = {
      ...createDiagramDocument(type, createId),
      elements: selectedElements,
      relationships: selectedRelationships.map(([, relationship]) => relationship),
      presentations: { nodes, edges },
      sourceRef: sourceRef('astah-bridge', externalDiagramId),
    };
    return [
      {
        importId: createId(),
        name: stringValue(candidate.name, 'Astah diagram'),
        document,
        fidelity: diagnostics.length > 0 ? ('partial' as const) : ('high' as const),
        diagnostics: [...diagnostics],
      },
    ];
  });
  if (imported.length === 0) {
    throw new Error('The Astah Bridge export contains no supported diagrams.');
  }
  return { sourceFormat: 'astah-bridge', diagrams: imported };
}
