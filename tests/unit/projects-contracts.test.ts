import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  MARKDOWN_DOCUMENT_MAX_BYTES,
  PROJECT_FORMAT_LEGACY_VERSION,
  PROJECT_FORMAT_VERSION,
  PROJECT_PASSWORD_MAX_BYTES,
  PROJECT_PASSWORD_MIN_LENGTH,
  isChangeProjectPagePasswordRequest,
  isCreateProjectNodeRequest,
  isCreateProjectRequest,
  isGetProjectPagePropertiesRequest,
  isLockProjectPageRequest,
  isMarkdownDocument,
  isMoveProjectNodeRequest,
  isNewProjectPassword,
  isProjectBacklinksOutcome,
  isProjectGraphSnapshot,
  isProjectInternalLinkRequest,
  isProjectInternalLinkResolution,
  isProjectNodeMutationOutcome,
  isProjectPageProperties,
  isProjectPassword,
  isProjectPathRequest,
  isProtectProjectPageRequest,
  isRemoveProjectPagePasswordRequest,
  isProjectResult,
  isProjectSearchOutcome,
  isProjectSearchRequest,
  isSetProjectPageReadOnlyRequest,
  isProjectSummary,
  isSaveMarkdownDocumentRequest,
  isTrashProjectNodeOutcome,
  isUnlockProjectPageRequest,
  projectFailure,
  projectSuccess,
} from '../../src/shared/contracts/projects';

describe('project contracts', () => {
  it('validates summaries and discriminated operation results', () => {
    const summary = {
      projectId: randomUUID(),
      name: 'Flyoff',
      location: 'D:\\Projects\\Flyoff',
      formatVersion: PROJECT_FORMAT_LEGACY_VERSION,
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
    expect(
      isProjectSummary({ ...summary, formatVersion: PROJECT_FORMAT_VERSION }),
    ).toBe(true);
    expect(isProjectSummary({ ...summary, formatVersion: 3 })).toBe(false);
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
    ).toBe(true);
    expect(
      isCreateProjectNodeRequest({
        parentId: null,
        name: 'Mapa',
        kind: 'page',
        pageType: 'example-plugin:mind-map',
      }),
    ).toBe(true);
    expect(
      isCreateProjectNodeRequest({
        parentId: null,
        name: 'Desconhecido',
        kind: 'page',
        pageType: 'custom-without-plugin',
      }),
    ).toBe(false);
    expect(
      isMoveProjectNodeRequest({
        nodeId,
        parentId: null,
        beforeNodeId: null,
      }),
    ).toBe(true);
    expect(
      isMoveProjectNodeRequest({
        nodeId,
        parentId: null,
        beforeNodeId: 'invalid',
      }),
    ).toBe(false);
    expect(isProjectPathRequest({ nodeId: null })).toBe(true);
    expect(isProjectPathRequest({ nodeId })).toBe(true);
    expect(isProjectPathRequest({ nodeId: 'invalid' })).toBe(false);
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
        readOnly: false,
      }),
    ).toBe(false);
  });

  it('validates bounded project search requests and outcomes', () => {
    const nodeId = randomUUID();
    expect(isProjectSearchRequest({ query: 'tag:work' })).toBe(true);
    expect(isProjectSearchRequest({ query: '   ' })).toBe(false);
    expect(isProjectSearchRequest({ query: 'x'.repeat(2_049) })).toBe(false);
    expect(
      isProjectSearchOutcome({
        nodeIds: [nodeId],
        previews: [
          {
            excerpt: 'Teste 1234',
            line: 1,
            nodeId,
          },
        ],
        skippedLockedNodeIds: [],
      }),
    ).toBe(true);
    expect(
      isProjectSearchOutcome({
        nodeIds: [nodeId, nodeId],
        previews: [],
        skippedLockedNodeIds: [],
      }),
    ).toBe(false);
  });

  it('validates link navigation and mutation outcomes exactly', () => {
    const sourceNodeId = randomUUID();
    const targetNodeId = randomUUID();
    const node = {
      kind: 'page' as const,
      name: 'Nota',
      nodeId: targetNodeId,
      pageType: 'markdown',
      parentId: null,
    };

    expect(
      isProjectInternalLinkRequest({
        headingPath: ['Pai', 'Filho'],
        path: 'Pasta/Nota',
        sourceNodeId,
        syntax: 'wikilink',
      }),
    ).toBe(true);
    expect(
      isProjectInternalLinkResolution({
        status: 'resolved',
        target: {
          heading: { line: 3, offset: 15, path: ['Pai', 'Filho'] },
          locked: false,
          name: 'Nota',
          nodeId: targetNodeId,
          path: 'Pasta/Nota',
        },
      }),
    ).toBe(true);
    expect(
      isProjectBacklinksOutcome({
        references: [
          {
            column: 1,
            end: 20,
            excerpt: '[[Nota]]',
            line: 2,
            sourceName: 'Origem',
            sourceNodeId,
            sourcePath: 'Origem',
            start: 10,
          },
        ],
        skippedLockedNodeIds: [],
      }),
    ).toBe(true);
    expect(
      isProjectNodeMutationOutcome({
        node,
        skippedLockedNodeIds: [],
        updatedDocumentNodeIds: [sourceNodeId],
      }),
    ).toBe(true);
    expect(
      isProjectNodeMutationOutcome({
        extra: true,
        node,
        skippedLockedNodeIds: [],
        updatedDocumentNodeIds: [],
      }),
    ).toBe(false);
  });

  it('validates graph snapshots and rejects dangling edges', () => {
    const sourceNodeId = randomUUID();
    const targetNodeId = randomUUID();
    const nodes = [
      {
        connectionCount: 2,
        name: 'Origem',
        nodeId: sourceNodeId,
        path: 'Origem',
      },
      {
        connectionCount: 2,
        name: 'Destino',
        nodeId: targetNodeId,
        path: 'Destino',
      },
    ];
    expect(
      isProjectGraphSnapshot({
        nodes,
        edges: [{ sourceNodeId, targetNodeId, weight: 2 }],
      }),
    ).toBe(true);
    expect(
      isProjectGraphSnapshot({
        nodes,
        edges: [
          {
            sourceNodeId,
            targetNodeId: randomUUID(),
            weight: 1,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isProjectGraphSnapshot({
        nodes: [...nodes, nodes[0]],
        edges: [],
      }),
    ).toBe(false);
  });

  it('validates page properties as a complete, consistent value', () => {
    const properties = {
      nodeId: randomUUID(),
      pageType: 'markdown' as const,
      contentSizeBytes: 120,
      diskSizeBytes: 340,
      createdAt: '2026-07-15T12:00:00.000Z',
      modifiedAt: '2026-07-16T12:00:00.000Z',
      revision: 'a'.repeat(64),
      readOnly: false,
      passwordProtected: true,
      locked: true,
    };

    expect(isProjectPageProperties(properties)).toBe(true);
    expect(isProjectPageProperties({ ...properties, createdAt: null })).toBe(true);
    expect(
      isProjectPageProperties({ ...properties, pageType: 'checklist' }),
    ).toBe(false);
    expect(
      isProjectPageProperties({ ...properties, diskSizeBytes: 119 }),
    ).toBe(false);
    expect(
      isProjectPageProperties({
        ...properties,
        passwordProtected: false,
        locked: true,
      }),
    ).toBe(false);
    expect(
      isProjectPageProperties({ ...properties, modifiedAt: '2026-07-16' }),
    ).toBe(false);
    expect(isProjectPageProperties({ ...properties, extra: true })).toBe(false);
  });

  it('enforces exact password bounds without normalizing user input', () => {
    expect(PROJECT_PASSWORD_MIN_LENGTH).toBe(1);
    expect(isNewProjectPassword('a')).toBe(true);
    expect(isNewProjectPassword(' ')).toBe(true);
    expect(isNewProjectPassword('\ud83d\udc9c')).toBe(true);
    expect(
      isNewProjectPassword('a'.repeat(PROJECT_PASSWORD_MIN_LENGTH - 1)),
    ).toBe(false);
    expect(isNewProjectPassword('é'.repeat(PROJECT_PASSWORD_MIN_LENGTH))).toBe(
      true,
    );
    expect(isProjectPassword('é'.repeat(PROJECT_PASSWORD_MAX_BYTES / 2))).toBe(
      true,
    );
    expect(
      isProjectPassword('é'.repeat(PROJECT_PASSWORD_MAX_BYTES / 2 + 1)),
    ).toBe(false);
    expect(isProjectPassword('')).toBe(false);
    expect(isNewProjectPassword('e\u0301')).toBe(true);
    expect(isNewProjectPassword('\u00e9'.repeat(11))).toBe(true);
    expect(isNewProjectPassword(`a\ud800`)).toBe(false);
    expect(isNewProjectPassword(`a\udc00`)).toBe(false);
    expect(isProjectPassword(`senha segura\ud801`)).toBe(false);
    expect(isNewProjectPassword(`a\ud83d\udc9c`)).toBe(true);
  });

  it('rejects extra or malformed fields in page-security requests', () => {
    const nodeId = randomUUID();
    const expectedRevision = 'b'.repeat(64);
    const password = 'correct horse battery staple';
    const cases = [
      [isGetProjectPagePropertiesRequest, { nodeId }],
      [
        isSetProjectPageReadOnlyRequest,
        { nodeId, expectedRevision, readOnly: true },
      ],
      [isProtectProjectPageRequest, { nodeId, expectedRevision, password }],
      [
        isChangeProjectPagePasswordRequest,
        {
          nodeId,
          expectedRevision,
          currentPassword: 'old password',
          newPassword: password,
        },
      ],
      [
        isRemoveProjectPagePasswordRequest,
        { nodeId, expectedRevision, password: 'old password' },
      ],
      [isUnlockProjectPageRequest, { nodeId, password: 'old password' }],
      [isLockProjectPageRequest, { nodeId }],
    ] as const;

    for (const [validator, request] of cases) {
      expect(validator(request)).toBe(true);
      expect(validator({ ...request, extra: true })).toBe(false);
      expect(validator({ ...request, nodeId: 'invalid' })).toBe(false);
    }

    expect(
      isSetProjectPageReadOnlyRequest({
        nodeId,
        expectedRevision: 'invalid',
        readOnly: true,
      }),
    ).toBe(false);
    expect(
      isProtectProjectPageRequest({
        nodeId,
        expectedRevision,
        password: '',
      }),
    ).toBe(false);
    expect(
      isChangeProjectPagePasswordRequest({
        nodeId,
        expectedRevision,
        currentPassword: '',
        newPassword: password,
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
