import type { DiagramDocument } from './types';

interface LegacyDiagramDocumentV0 {
  format: 'flyoff-diagram';
  formatVersion: 0;
  documentId: string;
  diagramType: DiagramDocument['diagramType'];
  elements: DiagramDocument['elements'];
  relationships: DiagramDocument['relationships'];
  presentations: DiagramDocument['presentations'];
  sourceRef?: DiagramDocument['sourceRef'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function migrateDiagramDocument(value: unknown): unknown {
  if (
    !isRecord(value) ||
    value.format !== 'flyoff-diagram' ||
    value.formatVersion !== 0
  ) {
    return value;
  }
  const legacy = value as unknown as LegacyDiagramDocumentV0;
  return {
    format: legacy.format,
    formatVersion: 1,
    documentId: legacy.documentId,
    diagramType: legacy.diagramType,
    elements: legacy.elements,
    relationships: legacy.relationships,
    presentations: legacy.presentations,
    settings: { showGrid: true, snapToGrid: true, gridSize: 16 },
    ...(legacy.sourceRef ? { sourceRef: legacy.sourceRef } : {}),
  } satisfies DiagramDocument;
}
