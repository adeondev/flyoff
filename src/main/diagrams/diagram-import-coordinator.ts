import path from 'node:path';

import {
  DIAGRAM_IMPORT_MAX_BYTES,
  validateDiagramDocument,
} from '../../shared/diagram';
import {
  DIAGRAM_IMPORT_SESSION_TTL_MS,
  projectSuccess,
  type CommitDiagramImportOutcome,
  type CommitDiagramImportRequest,
  type DiagramImportSelection,
  type ProjectResult,
  type SelectDiagramImportOutcome,
} from '../../shared/contracts';
import {
  ProjectOperationError,
  projectErrorResult,
} from '../projects/errors';
import type { ProjectSenderKey, ProjectService } from '../projects';
import { readBoundedFile } from '../projects/persistence';
import { importDiagramFile, type ImportedDiagram } from './importers';

interface ImportSession {
  senderKey: ProjectSenderKey;
  expiresAt: number;
  diagrams: readonly ImportedDiagram[];
}

export class DiagramImportCoordinator {
  private readonly sessions = new Map<string, ImportSession>();

  constructor(
    private readonly projectService: ProjectService,
    private readonly createId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async select(
    senderKey: ProjectSenderKey,
    filePath: string | null,
  ): Promise<ProjectResult<SelectDiagramImportOutcome>> {
    if (!filePath) {
      return projectErrorResult(
        new ProjectOperationError('cancelled', 'Diagram import was cancelled.'),
      );
    }
    const fileName = path.basename(filePath);
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.asta') || lower.endsWith('.astah')) {
      return projectSuccess({
        status: 'astah-bridge-required',
        fileName,
        acceptedBridgeExtension: '.spinel-import.json',
        alternatives: ['.xmi', '.xml'],
      });
    }
    try {
      const bytes = await readBoundedFile(filePath, DIAGRAM_IMPORT_MAX_BYTES, {
        invalidTypeMessage: 'The selected import is not a regular file.',
        sizeExceededMessage: 'The selected import exceeds the supported size limit.',
        unsafePathMessage: 'The selected import resolves through an unsafe path.',
      });
      let imported;
      try {
        imported = importDiagramFile(fileName, bytes, this.createId);
      } finally {
        bytes.fill(0);
      }
      for (const diagram of imported.diagrams) {
        if (!validateDiagramDocument(diagram.document).ok) {
          throw new ProjectOperationError(
            'invalid-format',
            'An imported diagram failed Flyoff structural validation.',
          );
        }
      }
      const token = this.createId();
      const expiresAt = this.now().getTime() + DIAGRAM_IMPORT_SESSION_TTL_MS;
      this.removeExpired(this.now().getTime());
      this.sessions.set(token, {
        senderKey,
        expiresAt,
        diagrams: imported.diagrams,
      });
      const selection: DiagramImportSelection = {
        status: 'ready',
        token,
        fileName,
        sourceFormat: imported.sourceFormat,
        expiresAt: new Date(expiresAt).toISOString(),
        diagrams: imported.diagrams.map((diagram) => ({
          importId: diagram.importId,
          suggestedName: diagram.name,
          diagramType: diagram.document.diagramType,
          elementCount: diagram.document.elements.length,
          relationshipCount: diagram.document.relationships.length,
          fidelity: diagram.fidelity,
          diagnostics: diagram.diagnostics,
        })),
      };
      return projectSuccess(selection);
    } catch (error) {
      return projectErrorResult(error);
    }
  }

  async commit(
    senderKey: ProjectSenderKey,
    request: CommitDiagramImportRequest,
  ): Promise<ProjectResult<CommitDiagramImportOutcome>> {
    const now = this.now().getTime();
    this.removeExpired(now);
    const session = this.sessions.get(request.token);
    if (!session || session.senderKey !== senderKey || session.expiresAt <= now) {
      return projectErrorResult(
        new ProjectOperationError(
          'invalid-operation',
          'The diagram import selection has expired or belongs to another window.',
        ),
      );
    }
    const selected = request.importIds.flatMap((importId) => {
      const diagram = session.diagrams.find((candidate) => candidate.importId === importId);
      return diagram ? [diagram] : [];
    });
    if (selected.length !== request.importIds.length) {
      return projectErrorResult(
        new ProjectOperationError('invalid-operation', 'The diagram import selection is invalid.'),
      );
    }
    const result = await this.projectService.importDiagrams(
      senderKey,
      request.parentId,
      selected,
    );
    if (result.ok) {
      this.sessions.delete(request.token);
    }
    return result;
  }

  disposeSender(senderKey: ProjectSenderKey): void {
    for (const [token, session] of this.sessions) {
      if (session.senderKey === senderKey) {
        this.sessions.delete(token);
      }
    }
  }

  dispose(): void {
    this.sessions.clear();
  }

  private removeExpired(now: number): void {
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(token);
      }
    }
  }
}
