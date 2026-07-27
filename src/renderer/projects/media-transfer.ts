export const MEDIA_ENTRY_TRANSFER = 'application/x-flyoff-media-entry+json';
export const MEDIA_ASSET_TRANSFER = 'application/x-flyoff-media-asset+json';
export const IMAGE_INSTANCE_TRANSFER =
  'application/x-flyoff-image-instance+json';
export const MEDIA_LIBRARY_CHANGED_EVENT = 'flyoff:media-library-changed';

export function removedMediaAssetIds(event: Event): ReadonlySet<string> {
  if (!(event instanceof CustomEvent)) {
    return new Set();
  }
  const detail = event.detail as { removedAssetIds?: unknown } | undefined;
  return new Set(
    Array.isArray(detail?.removedAssetIds)
      ? detail.removedAssetIds.filter(
          (assetId): assetId is string => typeof assetId === 'string',
        )
      : [],
  );
}
