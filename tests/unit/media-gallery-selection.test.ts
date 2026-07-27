import { describe, expect, it } from 'vitest';

import { selectedForClick } from '../../src/renderer/projects/MediaGalleryPanel';

const entries = ['a', 'b', 'c', 'd'].map((id) => ({
  id,
  kind: 'folder' as const,
  folder: {
    folderId: id,
    parentId: null,
    name: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    sortOrder: 0,
  },
}));

describe('media gallery selection', () => {
  it('selects contiguous ranges with Shift', () => {
    const selection = selectedForClick(
      { anchorId: 'b', selectedIds: new Set(['b']) },
      'd',
      entries,
      true,
      false,
    );

    expect([...selection.selectedIds]).toEqual(['b', 'c', 'd']);
    expect(selection.anchorId).toBe('b');
  });

  it('toggles individual entries with Ctrl or Cmd', () => {
    const added = selectedForClick(
      { anchorId: 'a', selectedIds: new Set(['a']) },
      'c',
      entries,
      false,
      true,
    );
    const removed = selectedForClick(added, 'a', entries, false, true);

    expect([...added.selectedIds]).toEqual(['a', 'c']);
    expect([...removed.selectedIds]).toEqual(['c']);
  });

  it('adds a shifted range to the current selection', () => {
    const selection = selectedForClick(
      { anchorId: 'b', selectedIds: new Set(['a', 'b']) },
      'd',
      entries,
      true,
      true,
    );

    expect([...selection.selectedIds]).toEqual(['a', 'b', 'c', 'd']);
  });
});
