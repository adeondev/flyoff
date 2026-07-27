import { describe, expect, it } from 'vitest';

import {
  buildMediaGalleryEntries,
  canMoveMediaGalleryEntries,
} from '../../src/renderer/projects/media-gallery-model';
import type { MediaGallerySnapshot } from '../../src/shared/contracts';

const snapshot: MediaGallerySnapshot = {
  projectId: '123e4567-e89b-42d3-a456-426614174000',
  revision: 'a'.repeat(64),
  folders: [
    {
      folderId: '223e4567-e89b-42d3-a456-426614174001',
      parentId: null,
      name: 'Álbuns',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      sortOrder: 0,
    },
    {
      folderId: '223e4567-e89b-42d3-a456-426614174002',
      parentId: '223e4567-e89b-42d3-a456-426614174001',
      name: 'Lua',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      sortOrder: 0,
    },
  ],
  assets: [
    {
      assetId: '323e4567-e89b-42d3-a456-426614174000',
      folderId: '223e4567-e89b-42d3-a456-426614174002',
      name: 'Apollo',
      extension: '.png',
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: 2048,
      pixelWidth: 640,
      pixelHeight: 480,
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      revision: 'b'.repeat(64),
      relativePath: 'Media/Álbuns/Lua/Apollo.png',
    },
  ],
};

describe('media gallery model', () => {
  it('searches the whole library and retains readable paths', () => {
    const entries = buildMediaGalleryEntries({
      folderId: null,
      query: 'path:lua',
      scope: 'all',
      snapshot,
      sort: 'name-ascending',
    });

    expect(entries.map(({ id }) => id)).toEqual([
      '223e4567-e89b-42d3-a456-426614174002',
      '323e4567-e89b-42d3-a456-426614174000',
    ]);
    expect(entries[0]?.path).toBe('Media/Álbuns/Lua');
  });

  it('rejects moves into descendants and accepts heterogeneous moves', () => {
    expect(
      canMoveMediaGalleryEntries(
        [
          {
            entryId: '223e4567-e89b-42d3-a456-426614174001',
            kind: 'folder',
          },
        ],
        '223e4567-e89b-42d3-a456-426614174002',
        snapshot,
      ),
    ).toBe(false);
    expect(
      canMoveMediaGalleryEntries(
        [
          {
            entryId: '223e4567-e89b-42d3-a456-426614174002',
            kind: 'folder',
          },
          {
            entryId: '323e4567-e89b-42d3-a456-426614174000',
            kind: 'asset',
          },
        ],
        null,
        snapshot,
      ),
    ).toBe(true);
  });
});
