import { parse } from '@twemoji/parser';

export interface TwemojiSegment {
  codepoint?: string;
  emoji?: string;
  text: string;
}

const CACHE_LIMIT = 2_000;
const CACHE_UNIT_LIMIT = 4 * 1024 * 1024;
const TWEMOJI_ASSET_BASE_URL = 'flyoff-asset://app/twemoji/';
const TWEMOJI_CODEPOINT_PATTERN =
  /^[0-9a-f]{1,6}(?:-[0-9a-f]{1,6})*$/;
const segmentCache = new Map<
  string,
  { segments: readonly TwemojiSegment[]; units: number }
>();
let segmentCacheUnits = 0;

function remember(
  value: string,
  segments: readonly TwemojiSegment[],
): readonly TwemojiSegment[] {
  const units = value.length + segments.length * 4;
  if (units > CACHE_UNIT_LIMIT) {
    return segments;
  }
  segmentCache.set(value, { segments, units });
  segmentCacheUnits += units;
  while (
    segmentCache.size > CACHE_LIMIT ||
    segmentCacheUnits > CACHE_UNIT_LIMIT
  ) {
    const oldest = segmentCache.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    segmentCacheUnits -= segmentCache.get(oldest)?.units ?? 0;
    segmentCache.delete(oldest);
  }
  return segments;
}

export function twemojiSegments(value: string): readonly TwemojiSegment[] {
  const cached = segmentCache.get(value);
  if (cached) {
    segmentCache.delete(value);
    segmentCache.set(value, cached);
    return cached.segments;
  }
  const entities = parse(value, {
    assetType: 'svg',
    buildUrl: (codepoint) => codepoint,
  });
  if (entities.length === 0) {
    return remember(value, value ? [{ text: value }] : []);
  }
  const segments: TwemojiSegment[] = [];
  let offset = 0;
  for (const entity of entities) {
    const [start, end] = entity.indices;
    if (start > offset) {
      segments.push({ text: value.slice(offset, start) });
    }
    segments.push({
      codepoint: entity.url,
      emoji: entity.text,
      text: entity.text,
    });
    offset = end;
  }
  if (offset < value.length) {
    segments.push({ text: value.slice(offset) });
  }
  return remember(value, segments);
}

export function twemojiAssetUrl(codepoint: string): string | null {
  return TWEMOJI_CODEPOINT_PATTERN.test(codepoint)
    ? `${TWEMOJI_ASSET_BASE_URL}${codepoint}.svg`
    : null;
}

export function clearTwemojiSegmentCache(): void {
  segmentCache.clear();
  segmentCacheUnits = 0;
}
