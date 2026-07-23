import { parseDiagramDocument } from '../../../shared/diagram';
import type { ImportIdFactory, DiagramImportResult } from './types';

export function importFlyd(
  content: string,
  name: string,
  createId: ImportIdFactory,
): DiagramImportResult {
  const parsed = parseDiagramDocument(content);
  if (!parsed.ok) {
    throw new Error(parsed.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  }
  return {
    sourceFormat: 'flyd',
    diagrams: [
      {
        importId: createId(),
        name,
        document: parsed.document,
        fidelity: 'exact',
        diagnostics: parsed.migrated
          ? [
              {
                code: 'flyd.migrated',
                severity: 'info',
                message: 'The diagram was migrated to the current Flyoff format.',
              },
            ]
          : [],
      },
    ],
  };
}
