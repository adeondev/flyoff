import type {
  DiagramDiagnostic,
  DiagramDocument,
} from '../../../shared/diagram';
import type {
  DiagramImportFidelity,
  DiagramImportFormat,
} from '../../../shared/contracts';

export interface ImportedDiagram {
  importId: string;
  name: string;
  document: DiagramDocument;
  fidelity: DiagramImportFidelity;
  diagnostics: readonly DiagramDiagnostic[];
}

export interface DiagramImportResult {
  sourceFormat: DiagramImportFormat;
  diagrams: readonly ImportedDiagram[];
}

export type ImportIdFactory = () => string;
