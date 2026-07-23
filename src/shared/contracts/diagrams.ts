import {
  DIAGRAM_DOCUMENT_MAX_BYTES,
  DIAGRAM_IMPORT_MAX_BYTES,
  isDiagramDocument,
  type DiagramDiagnostic,
  type DiagramDocument,
  type DiagramType,
} from '../diagram';
import {
  isPortableProjectName,
  isProjectIdentifier,
  isProjectTreeNode,
  type ProjectPageNode,
} from './projects';

export const DIAGRAM_IPC_CHANNELS = {
  create: 'flyoff:diagrams:create',
  read: 'flyoff:diagrams:read',
  save: 'flyoff:diagrams:save',
  selectImport: 'flyoff:diagrams:import:select',
  commitImport: 'flyoff:diagrams:import:commit',
  export: 'flyoff:diagrams:export',
  openPending: 'flyoff:diagrams:open-pending',
  pendingChanged: 'flyoff:diagrams:pending-changed',
} as const;

export const DIAGRAM_IMPORT_SESSION_TTL_MS = 10 * 60 * 1_000;

export type DiagramRevision = string;
export type DiagramImportFormat =
  | 'flyd'
  | 'spinel'
  | 'astah-bridge'
  | 'xmi'
  | 'drawio';
export type DiagramExportFormat = 'flyd' | 'drawio';
export type DiagramImportFidelity = 'exact' | 'high' | 'partial';

export interface CreateDiagramDocumentRequest {
  parentId: string | null;
  name: string;
  diagramType: DiagramType;
}

export interface ReadDiagramDocumentRequest {
  nodeId: string;
}

export interface SaveDiagramDocumentRequest {
  nodeId: string;
  document: DiagramDocument;
  expectedRevision: DiagramRevision;
  force?: boolean;
}

export interface DiagramDocumentEnvelope {
  nodeId: string;
  document: DiagramDocument;
  revision: DiagramRevision;
}

export interface DiagramImportPreview {
  importId: string;
  suggestedName: string;
  diagramType: DiagramType;
  elementCount: number;
  relationshipCount: number;
  fidelity: DiagramImportFidelity;
  diagnostics: readonly DiagramDiagnostic[];
}

export interface DiagramImportSelection {
  status: 'ready';
  token: string;
  fileName: string;
  sourceFormat: DiagramImportFormat;
  expiresAt: string;
  diagrams: readonly DiagramImportPreview[];
}

export interface AstahBridgeRequiredSelection {
  status: 'astah-bridge-required';
  fileName: string;
  acceptedBridgeExtension: '.spinel-import.json';
  alternatives: readonly ['.xmi', '.xml'];
}

export type SelectDiagramImportOutcome =
  | DiagramImportSelection
  | AstahBridgeRequiredSelection;

export interface CommitDiagramImportRequest {
  token: string;
  parentId: string | null;
  importIds: readonly string[];
}

export interface CommitDiagramImportOutcome {
  nodes: readonly ProjectPageNode[];
  diagnostics: readonly DiagramDiagnostic[];
}

export interface ExportDiagramRequest {
  nodeId: string;
  format: DiagramExportFormat;
}

export interface ExportDiagramOutcome {
  fileName: string;
  format: DiagramExportFormat;
}

const revisionPattern = /^[0-9a-f]{64}$/;
const importFormats = new Set(['flyd', 'spinel', 'astah-bridge', 'xmi', 'drawio']);
const diagramTypes = new Set(['class', 'use-case', 'sequence', 'activity']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isDiagramRevision(value: unknown): value is DiagramRevision {
  return typeof value === 'string' && revisionPattern.test(value);
}

export function isCreateDiagramDocumentRequest(
  value: unknown,
): value is CreateDiagramDocumentRequest {
  return (
    isRecord(value) &&
    (value.parentId === null || isProjectIdentifier(value.parentId)) &&
    isPortableProjectName(value.name) &&
    diagramTypes.has(String(value.diagramType))
  );
}

export function isReadDiagramDocumentRequest(
  value: unknown,
): value is ReadDiagramDocumentRequest {
  return isRecord(value) && isProjectIdentifier(value.nodeId);
}

export function isSaveDiagramDocumentRequest(
  value: unknown,
): value is SaveDiagramDocumentRequest {
  if (
    !isRecord(value) ||
    !isProjectIdentifier(value.nodeId) ||
    !isDiagramRevision(value.expectedRevision) ||
    (value.force !== undefined && typeof value.force !== 'boolean') ||
    !isDiagramDocument(value.document)
  ) {
    return false;
  }
  try {
    return (
      new TextEncoder().encode(JSON.stringify(value.document)).byteLength <=
      DIAGRAM_DOCUMENT_MAX_BYTES
    );
  } catch {
    return false;
  }
}

export function isDiagramDocumentEnvelope(
  value: unknown,
): value is DiagramDocumentEnvelope {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.nodeId) &&
    isDiagramDocument(value.document) &&
    isDiagramRevision(value.revision)
  );
}

export function isDiagramDiagnostic(value: unknown): value is DiagramDiagnostic {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    value.code.length > 0 &&
    value.code.length <= 256 &&
    (value.severity === 'error' ||
      value.severity === 'warning' ||
      value.severity === 'info') &&
    typeof value.message === 'string' &&
    value.message.length > 0 &&
    value.message.length <= 4_096 &&
    (value.targetId === undefined || isProjectIdentifier(value.targetId))
  );
}

function isImportPreview(value: unknown): value is DiagramImportPreview {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.importId) &&
    isPortableProjectName(value.suggestedName) &&
    diagramTypes.has(String(value.diagramType)) &&
    Number.isSafeInteger(value.elementCount) &&
    Number(value.elementCount) >= 0 &&
    Number(value.elementCount) <= 10_000 &&
    Number.isSafeInteger(value.relationshipCount) &&
    Number(value.relationshipCount) >= 0 &&
    Number(value.relationshipCount) <= 20_000 &&
    (value.fidelity === 'exact' ||
      value.fidelity === 'high' ||
      value.fidelity === 'partial') &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.length <= 10_000 &&
    value.diagnostics.every(isDiagramDiagnostic)
  );
}

export function isSelectDiagramImportOutcome(
  value: unknown,
): value is SelectDiagramImportOutcome {
  if (!isRecord(value)) {
    return false;
  }
  if (value.status === 'astah-bridge-required') {
    return (
      typeof value.fileName === 'string' &&
      value.fileName.length > 0 &&
      value.fileName.length <= 512 &&
      value.acceptedBridgeExtension === '.spinel-import.json' &&
      Array.isArray(value.alternatives) &&
      value.alternatives.length === 2 &&
      value.alternatives[0] === '.xmi' &&
      value.alternatives[1] === '.xml'
    );
  }
  return (
    value.status === 'ready' &&
    isProjectIdentifier(value.token) &&
    typeof value.fileName === 'string' &&
    value.fileName.length > 0 &&
    value.fileName.length <= 512 &&
    importFormats.has(String(value.sourceFormat)) &&
    typeof value.expiresAt === 'string' &&
    Number.isFinite(Date.parse(value.expiresAt)) &&
    Array.isArray(value.diagrams) &&
    value.diagrams.length > 0 &&
    value.diagrams.length <= 1_000 &&
    value.diagrams.every(isImportPreview)
  );
}

export function isCommitDiagramImportRequest(
  value: unknown,
): value is CommitDiagramImportRequest {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.token) &&
    (value.parentId === null || isProjectIdentifier(value.parentId)) &&
    Array.isArray(value.importIds) &&
    value.importIds.length > 0 &&
    value.importIds.length <= 1_000 &&
    value.importIds.every(isProjectIdentifier) &&
    new Set(value.importIds).size === value.importIds.length
  );
}

export function isCommitDiagramImportOutcome(
  value: unknown,
): value is CommitDiagramImportOutcome {
  return (
    isRecord(value) &&
    Array.isArray(value.nodes) &&
    value.nodes.length <= 1_000 &&
    value.nodes.every(
      (node) =>
        isProjectTreeNode(node) && node.kind === 'page' && node.pageType === 'diagram',
    ) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.length <= 10_000 &&
    value.diagnostics.every(isDiagramDiagnostic)
  );
}

export function isExportDiagramRequest(value: unknown): value is ExportDiagramRequest {
  return (
    isRecord(value) &&
    isProjectIdentifier(value.nodeId) &&
    (value.format === 'flyd' || value.format === 'drawio')
  );
}

export function isExportDiagramOutcome(value: unknown): value is ExportDiagramOutcome {
  return (
    isRecord(value) &&
    typeof value.fileName === 'string' &&
    value.fileName.length > 0 &&
    value.fileName.length <= 512 &&
    (value.format === 'flyd' || value.format === 'drawio')
  );
}

export function isDiagramImportPayloadSize(size: unknown): size is number {
  return (
    typeof size === 'number' &&
    Number.isSafeInteger(size) &&
    size >= 0 &&
    size <= DIAGRAM_IMPORT_MAX_BYTES
  );
}
