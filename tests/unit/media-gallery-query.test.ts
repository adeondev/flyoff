import { describe, expect, it } from 'vitest';

import { mediaAssetMatchesQuery } from '../../src/renderer/projects/media-gallery-query';
import type { MediaAsset } from '../../src/shared/contracts';

const asset: MediaAsset = {
  assetId: '323e4567-e89b-42d3-a456-426614174000',
  folderId: null,
  name: 'Lua Azul',
  extension: '.png',
  kind: 'image',
  mimeType: 'image/png',
  sizeBytes: 2048,
  pixelWidth: 640,
  pixelHeight: 480,
  createdAt: '2026-07-20T10:00:00.000Z',
  modifiedAt: '2026-07-25T12:30:00.000Z',
  revision: 'a'.repeat(64),
  relativePath: 'Media/Viagem/Lua Azul.png',
};

describe('media gallery query', () => {
  it('matches free text and media-specific fields', () => {
    expect(mediaAssetMatchesQuery(asset, 'lua')).toBe(true);
    expect(mediaAssetMatchesQuery(asset, 'file:"Lua Azul"')).toBe(true);
    expect(mediaAssetMatchesQuery(asset, 'path:viagem type:png')).toBe(true);
    expect(mediaAssetMatchesQuery(asset, 'date:2026-07-25 size:2048')).toBe(
      true,
    );
  });

  it('requires every query term to match', () => {
    expect(mediaAssetMatchesQuery(asset, 'path:viagem type:webp')).toBe(false);
    expect(mediaAssetMatchesQuery(asset, 'file:sol')).toBe(false);
  });
});
