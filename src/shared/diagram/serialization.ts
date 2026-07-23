import { migrateDiagramDocument } from './migrations';
import type { DiagramDocument } from './types';
import {
  DIAGRAM_DOCUMENT_MAX_BYTES,
  type DiagramStructuralIssue,
  validateDiagramDocument,
} from './validation';

export type DiagramParseResult =
  | { ok: true; document: DiagramDocument; migrated: boolean }
  | { ok: false; issues: readonly DiagramStructuralIssue[] };

export function serializeDiagramDocument(document: DiagramDocument): string {
  const validation = validateDiagramDocument(document);
  if (!validation.ok) {
    throw new TypeError(
      validation.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'),
    );
  }
  const content = `${JSON.stringify(validation.value, null, 2)}\n`;
  if (new TextEncoder().encode(content).byteLength > DIAGRAM_DOCUMENT_MAX_BYTES) {
    throw new RangeError('The diagram exceeds the maximum document size.');
  }
  return content;
}

export function parseDiagramDocument(content: string): DiagramParseResult {
  if (new TextEncoder().encode(content).byteLength > DIAGRAM_DOCUMENT_MAX_BYTES) {
    return {
      ok: false,
      issues: [{ path: '$', message: 'The diagram exceeds the maximum document size.' }],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return {
      ok: false,
      issues: [{ path: '$', message: 'The diagram is not valid JSON.' }],
    };
  }
  const migrated = migrateDiagramDocument(parsed);
  const validation = validateDiagramDocument(migrated);
  return validation.ok
    ? {
        ok: true,
        document: validation.value,
        migrated: migrated !== parsed,
      }
    : validation;
}
