import type { MediaAsset, MediaFolder } from '../../shared/contracts';

export type MediaGallerySearchField =
  | 'date'
  | 'file'
  | 'height'
  | 'orientation'
  | 'path'
  | 'size'
  | 'type'
  | 'used'
  | 'width';

interface MediaGallerySearchTerm {
  field?: MediaGallerySearchField;
  value: string;
}

const FIELD_PATTERN =
  /^(date|file|height|orientation|path|size|type|used|width):(.*)$/iu;
const TOKEN_PATTERN = /(?:[^\s"]+:"[^"]*"|"[^"]*"|\S+)/gu;

export function parseMediaGalleryQuery(
  query: string,
): readonly MediaGallerySearchTerm[] {
  return [...query.matchAll(TOKEN_PATTERN)].flatMap(([token]) => {
    const fieldMatch = token.match(FIELD_PATTERN);
    const field = fieldMatch?.[1]?.toLocaleLowerCase() as
      | MediaGallerySearchField
      | undefined;
    const rawValue = fieldMatch ? fieldMatch[2]! : token;
    const value = rawValue.replace(/^"|"$/gu, '').trim().toLocaleLowerCase();
    return value ? [{ field, value }] : [];
  });
}

export function mediaAssetMatchesQuery(
  asset: MediaAsset,
  query: string,
  usageCount?: number,
): boolean {
  const terms = parseMediaGalleryQuery(query);
  if (terms.length === 0) {
    return true;
  }
  const values: Record<MediaGallerySearchField, string> = {
    date: `${asset.createdAt} ${asset.modifiedAt}`.toLocaleLowerCase(),
    file: `${asset.name}${asset.extension}`.toLocaleLowerCase(),
    height: String(asset.pixelHeight ?? ''),
    orientation:
      asset.pixelWidth && asset.pixelHeight
        ? asset.pixelWidth === asset.pixelHeight
          ? 'square quadrada'
          : asset.pixelWidth > asset.pixelHeight
            ? 'landscape horizontal'
            : 'portrait vertical'
        : '',
    path: asset.relativePath.toLocaleLowerCase(),
    size: String(asset.sizeBytes),
    type:
      `${asset.kind} ${asset.mimeType} ${asset.extension.replace(/^\./u, '')}`.toLocaleLowerCase(),
    used:
      usageCount === undefined
        ? ''
        : usageCount > 0
          ? `true yes sim used usada ${usageCount}`
          : 'false no nao não unused sem-uso',
    width: String(asset.pixelWidth ?? ''),
  };
  const all = Object.values(values).join(' ');
  return terms.every(({ field, value }) =>
    (field ? values[field] : all).includes(value),
  );
}

export function mediaFolderMatchesQuery(
  folder: MediaFolder,
  path: string,
  query: string,
): boolean {
  const terms = parseMediaGalleryQuery(query);
  if (terms.length === 0) {
    return true;
  }
  const file = folder.name.toLocaleLowerCase();
  const normalizedPath = path.toLocaleLowerCase();
  return terms.every(({ field, value }) => {
    if (!field || field === 'file') {
      return file.includes(value) || (!field && normalizedPath.includes(value));
    }
    return field === 'path' && normalizedPath.includes(value);
  });
}
