import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createDiagramDocument,
  createDiagramElement,
  createDiagramRelationship,
  diagramBoundsUnion,
  fitDiagramBounds,
  parseDiagramDocument,
  serializeDiagramDocument,
  snapDiagramPoint,
  validateDiagramDocument,
  validateUmlSemantics,
  zoomDiagramAtPoint,
  type DiagramDocument,
} from '../../src/shared/diagram';
import {
  isCreateDiagramDocumentRequest,
  isSaveDiagramDocumentRequest,
} from '../../src/shared/contracts';

function withElement(
  document: DiagramDocument,
  kind: Parameters<typeof createDiagramElement>[0],
  x = 0,
  y = 0,
): DiagramDocument {
  const created = createDiagramElement(kind, { x, y });
  return {
    ...document,
    elements: [...document.elements, created.element],
    presentations: {
      ...document.presentations,
      nodes: [...document.presentations.nodes, created.presentation],
    },
  };
}

describe('Flyoff diagram domain', () => {
  it('creates strongly typed documents and stable model/presentation identities', () => {
    const document = withElement(createDiagramDocument('class'), 'class', 32, 48);
    const element = document.elements[0]!;
    const presentation = document.presentations.nodes[0]!;

    expect(document).toMatchObject({
      format: 'flyoff-diagram',
      formatVersion: 1,
      diagramType: 'class',
      settings: { showGrid: true, snapToGrid: true, gridSize: 16 },
    });
    expect(element.id).not.toBe(presentation.id);
    expect(presentation).toMatchObject({
      elementId: element.id,
      bounds: { x: 32, y: 48, width: 220, height: 140 },
    });
    expect(validateDiagramDocument(document)).toEqual({ ok: true, value: document });
  });

  it('serializes UTF-8 deterministically and migrates version zero', () => {
    const document = withElement(createDiagramDocument('use-case'), 'actor');
    const serialized = serializeDiagramDocument(document);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(parseDiagramDocument(serialized)).toEqual({
      ok: true,
      document,
      migrated: false,
    });

    const legacy = JSON.stringify({
      ...document,
      formatVersion: 0,
      settings: undefined,
    });
    const parsed = parseDiagramDocument(legacy);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.migrated).toBe(true);
      expect(parsed.document.settings.gridSize).toBe(16);
    }
  });

  it('rejects duplicate IDs and excessive JSON depth structurally', () => {
    const document = withElement(createDiagramDocument('class'), 'class');
    const duplicate = {
      ...document,
      presentations: {
        ...document.presentations,
        nodes: document.presentations.nodes.map((presentation) => ({
          ...presentation,
          id: document.documentId,
        })),
      },
    };
    expect(validateDiagramDocument(duplicate)).toMatchObject({ ok: false });

    let nested: Record<string, unknown> = {};
    const root = nested;
    for (let index = 0; index < 40; index += 1) {
      nested.next = {};
      nested = nested.next as Record<string, unknown>;
    }
    expect(validateDiagramDocument(root)).toMatchObject({ ok: false });
  });

  it('reports UML violations without making a structural document unsavable', () => {
    let document = withElement(createDiagramDocument('sequence'), 'actor');
    document = withElement(document, 'action', 200, 100);
    const source = document.elements[0]!;
    const invalidTarget = document.elements[1]!;
    const relationship = createDiagramRelationship(
      'message-return',
      source.id,
      invalidTarget.id,
    );
    document = { ...document, relationships: [relationship] };

    expect(validateDiagramDocument(document).ok).toBe(true);
    expect(validateUmlSemantics(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'element.incompatible' }),
        expect.objectContaining({ code: 'sequence.endpoint-invalid' }),
      ]),
    );
  });

  it('validates object flow, relationship endpoints, activations and partitions', () => {
    let document = withElement(createDiagramDocument('activity'), 'action');
    document = withElement(document, 'action', 200, 0);
    const source = document.elements[0]!;
    const target = document.elements[1]!;
    const relationship = createDiagramRelationship('object-flow', source.id, target.id);
    document = {
      ...document,
      relationships: [
        relationship,
        createDiagramRelationship('control-flow', source.id, randomUUID()),
      ],
    };
    expect(validateUmlSemantics(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'activity.object-flow-invalid' }),
        expect.objectContaining({ code: 'relationship.endpoint-missing' }),
      ]),
    );
  });

  it('computes snap, pointer-focused zoom, union and fit view geometry', () => {
    expect(snapDiagramPoint({ x: 23, y: 41 }, 16)).toEqual({ x: 16, y: 48 });
    expect(
      zoomDiagramAtPoint({ x: 0, y: 0, zoom: 1 }, { x: 100, y: 80 }, 2),
    ).toEqual({ x: -100, y: -80, zoom: 2 });
    const bounds = diagramBoundsUnion([
      { x: 10, y: 20, width: 50, height: 40 },
      { x: 100, y: 80, width: 20, height: 30 },
    ]);
    expect(bounds).toEqual({ x: 10, y: 20, width: 110, height: 90 });
    expect(fitDiagramBounds(bounds, { width: 400, height: 300 }, 40)).toEqual({
      x: 41.1111111111111,
      y: -8.888888888888907,
      zoom: 2.4444444444444446,
    });
  });

  it('guards create and save requests before IPC', () => {
    const document = createDiagramDocument('class');
    expect(
      isCreateDiagramDocumentRequest({
        parentId: null,
        name: 'Architecture',
        diagramType: 'class',
      }),
    ).toBe(true);
    expect(
      isCreateDiagramDocumentRequest({
        parentId: null,
        name: '../Architecture',
        diagramType: 'class',
      }),
    ).toBe(false);
    expect(
      isSaveDiagramDocumentRequest({
        nodeId: randomUUID(),
        document,
        expectedRevision: 'a'.repeat(64),
      }),
    ).toBe(true);
    expect(
      isSaveDiagramDocumentRequest({
        nodeId: randomUUID(),
        document: { ...document, format: 'unsafe' },
        expectedRevision: 'a'.repeat(64),
      }),
    ).toBe(false);
  });
});
