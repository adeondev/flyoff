import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  MARKDOWN_DOCUMENT_MAX_BYTES,
  isCreateProjectNodeRequest,
  isCreateProjectRequest,
  isMarkdownDocument,
  isProjectResult,
  isProjectSummary,
  isSaveMarkdownDocumentRequest,
  isTrashProjectNodeOutcome,
  projectFailure,
  projectSuccess,
} from '../../src/shared/contracts/projects';

describe('project contracts', () => {
  it('validates summaries and discriminated operation results', () => {
    const summary = {
      projectId: randomUUID(),
      name: 'Flyoff',
      location: 'D:\\Projects\\Flyoff',
      formatVersion: 1 as const,
    };

    expect(isProjectSummary(summary)).toBe(true);
    expect(isProjectResult(projectSuccess(summary), isProjectSummary)).toBe(true);
    expect(
      isProjectResult(
        projectFailure('conflict', 'Changed on disk.', 'a'.repeat(64)),
        isProjectSummary,
      ),
    ).toBe(true);
    expect(
      isProjectResult(
        projectFailure('conflict', 'Changed on disk.', 'invalid'),
        isProjectSummary,
      ),
    ).toBe(false);
  });

  it('validates bounded requests without accepting malformed identifiers', () => {
    const nodeId = randomUUID();

    expect(
      isCreateProjectRequest({ selectionToken: randomUUID(), name: 'Projeto' }),
    ).toBe(true);
    expect(
      isCreateProjectRequest({ selectionToken: randomUUID(), name: 'CON' }),
    ).toBe(false);
    expect(
      isCreateProjectRequest({
        selectionToken: randomUUID(),
        name: 'x'.repeat(101),
      }),
    ).toBe(false);
    expect(
      isCreateProjectNodeRequest({
        parentId: null,
        name: 'Nota',
        kind: 'page',
        pageType: 'markdown',
      }),
    ).toBe(true);
    expect(
      isCreateProjectNodeRequest({
        parentId: null,
        name: 'Quadro',
        kind: 'page',
        pageType: 'kanban',
      }),
    ).toBe(false);
    expect(
      isSaveMarkdownDocumentRequest({
        nodeId,
        content: 'conteúdo',
        expectedRevision: '0'.repeat(64),
      }),
    ).toBe(true);
    expect(
      isSaveMarkdownDocumentRequest({
        nodeId,
        content: 'x'.repeat(MARKDOWN_DOCUMENT_MAX_BYTES + 1),
        expectedRevision: '0'.repeat(64),
      }),
    ).toBe(false);
  });

  it('rejects oversized Markdown documents at the process boundary', () => {
    expect(
      isMarkdownDocument({
        nodeId: randomUUID(),
        content: 'é'.repeat(MARKDOWN_DOCUMENT_MAX_BYTES),
        revision: 'f'.repeat(64),
      }),
    ).toBe(false);
  });

  it('validates the complete set of node identities returned by trash', () => {
    const nodeIds = [randomUUID(), randomUUID()];

    expect(isTrashProjectNodeOutcome({ nodeIds })).toBe(true);
    expect(isTrashProjectNodeOutcome({ nodeIds: [nodeIds[0], nodeIds[0]] })).toBe(
      false,
    );
    expect(isTrashProjectNodeOutcome({ nodeIds: [] })).toBe(false);
  });
});
