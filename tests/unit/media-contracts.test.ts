import { describe, expect, it } from 'vitest';

import {
  isCancelProjectMediaImportRequest,
  isCreateMediaFolderWithEntriesRequest,
  isMoveMediaEntriesRequest,
  isProjectMediaImportProgress,
  isStartProjectMediaImportOutcome,
  isTrashMediaEntriesRequest,
} from '../../src/shared/contracts';

const operationId = '123e4567-e89b-42d3-a456-426614174000';

describe('media contracts', () => {
  it('validates cancellable import operations and progress', () => {
    expect(isStartProjectMediaImportOutcome({ operationId })).toBe(true);
    expect(isCancelProjectMediaImportRequest({ operationId })).toBe(true);
    expect(
      isProjectMediaImportProgress({
        operationId,
        completed: 1,
        currentName: 'Lua.png',
        failed: 0,
        total: 2,
        status: 'running',
      }),
    ).toBe(true);
    expect(
      isProjectMediaImportProgress({
        operationId,
        completed: -1,
        currentName: '',
        failed: 0,
        total: 2,
        status: 'running',
      }),
    ).toBe(false);
  });

  it('requires explicit boolean confirmation for referenced deletion', () => {
    expect(
      isTrashMediaEntriesRequest({
        entries: [{ entryId: operationId, kind: 'asset' }],
        confirmed: true,
      }),
    ).toBe(true);
    expect(
      isTrashMediaEntriesRequest({
        entries: [{ entryId: operationId, kind: 'asset' }],
        confirmed: 'yes',
      }),
    ).toBe(false);
  });

  it('validates heterogeneous atomic gallery operations', () => {
    const folderId = '223e4567-e89b-42d3-a456-426614174001';
    const entries = [
      { entryId: operationId, kind: 'asset' as const },
      { entryId: folderId, kind: 'folder' as const },
    ];
    expect(
      isMoveMediaEntriesRequest({
        entries,
        expectedRevision: 'a'.repeat(64),
        parentId: null,
      }),
    ).toBe(true);
    expect(
      isCreateMediaFolderWithEntriesRequest({
        entries,
        name: 'Organizadas',
        parentId: null,
      }),
    ).toBe(true);
  });
});
