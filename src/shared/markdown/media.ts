export const MEDIA_DIRECTIVE_VERSION = 1 as const;
export const MEDIA_GRID_COLUMNS = 12 as const;
export const IMAGE_DIRECTIVE_VERSION = 2 as const;

export type MediaPlacement = 'block' | 'inline' | 'wrap-left' | 'wrap-right';
export type MediaFit = 'contain' | 'cover' | 'fill';

export interface MediaDirective {
  version: typeof MEDIA_DIRECTIVE_VERSION;
  id: string;
  path: string;
  description: string;
  placement: MediaPlacement;
  span: number;
  offset: number;
  fit: MediaFit;
  ratio: number;
  lock: boolean;
  caption: boolean;
}

export type ImageLayoutMode = 'inline' | 'block' | 'wrap';
export type ImageAlignment = 'left' | 'center' | 'right';

export interface ImageDirective {
  version: typeof IMAGE_DIRECTIVE_VERSION;
  instanceId: string;
  assetId: string;
  path: string;
  alt: string;
  mode: ImageLayoutMode;
  align: ImageAlignment;
  width: number;
  height: number;
  minWidth: number;
  maxWidth: number;
  margin: number;
  ratioLock: boolean;
  positionLock: boolean;
  caption: string;
}

const DIRECTIVE =
  /^::media\[([^\]\r\n]*)\]\{([^}\r\n]+)\}$/;
const IMAGE_DIRECTIVE =
  /^::image\[((?:\\[\]\\]|[^\]\r\n])*)\]\{([^}\r\n]+)\}$/;
const IMAGE_DIRECTIVE_AT =
  /^::image\[((?:\\[\]\\]|[^\]\r\n])*)\]\{([^}\r\n]+)\}/;
const ATTRIBUTE =
  /([a-z][a-z0-9-]*)=(?:"((?:\\["\\]|[^"])*)"|([^\s]+))/gi;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unescapeQuoted(value: string): string {
  return value.replace(/\\(["\\])/g, '$1');
}

function escapeQuoted(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function unescapeBracket(value: string): string {
  return value.replace(/\\([\]\\])/g, '$1');
}

function escapeBracket(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(']', '\\]');
}

function integerInRange(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function booleanValue(value: string | undefined): boolean | undefined {
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

export function normalizeMediaDirective(
  directive: MediaDirective,
): MediaDirective {
  const span = Math.min(
    MEDIA_GRID_COLUMNS,
    Math.max(1, Math.round(directive.span)),
  );
  const offset = Math.min(
    MEDIA_GRID_COLUMNS - span,
    Math.max(0, Math.round(directive.offset)),
  );
  const ratio =
    Number.isFinite(directive.ratio) &&
    directive.ratio >= 0.05 &&
    directive.ratio <= 20
      ? directive.ratio
      : 16 / 9;

  return {
    ...directive,
    description: directive.description.slice(0, 512),
    path: directive.path.replaceAll('\\', '/').slice(0, 4_096),
    span,
    offset,
    ratio,
  };
}

export function parseMediaDirective(source: string): MediaDirective | null {
  const match = DIRECTIVE.exec(source.trim());
  if (!match) {
    return null;
  }

  const values = new Map<string, string>();
  let attribute: RegExpExecArray | null;
  ATTRIBUTE.lastIndex = 0;
  while ((attribute = ATTRIBUTE.exec(match[2]!))) {
    const value = attribute[2] !== undefined
      ? unescapeQuoted(attribute[2])
      : attribute[3]!;
    if (values.has(attribute[1]!.toLowerCase())) {
      return null;
    }
    values.set(attribute[1]!.toLowerCase(), value);
  }

  const version = integerInRange(values.get('v'), 1, 1);
  const id = values.get('id');
  const path = values.get('path');
  const placement = values.get('placement');
  const span = integerInRange(values.get('span'), 1, MEDIA_GRID_COLUMNS);
  const offset = integerInRange(values.get('offset'), 0, MEDIA_GRID_COLUMNS - 1);
  const fit = values.get('fit');
  const ratio = Number(values.get('ratio'));
  const lock = booleanValue(values.get('lock'));
  const caption = booleanValue(values.get('caption'));

  if (
    version !== MEDIA_DIRECTIVE_VERSION ||
    !id ||
    !UUID.test(id) ||
    !path ||
    path.length > 4_096 ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[a-z]:/i.test(path) ||
    path.split(/[\\/]/).some((part) => part === '..') ||
    (placement !== 'block' &&
      placement !== 'inline' &&
      placement !== 'wrap-left' &&
      placement !== 'wrap-right') ||
    span === undefined ||
    offset === undefined ||
    offset + span > MEDIA_GRID_COLUMNS ||
    (fit !== 'contain' && fit !== 'cover' && fit !== 'fill') ||
    !Number.isFinite(ratio) ||
    ratio < 0.05 ||
    ratio > 20 ||
    lock === undefined ||
    caption === undefined
  ) {
    return null;
  }

  return {
    version,
    id,
    path: path.replaceAll('\\', '/'),
    description: match[1]!,
    placement,
    span,
    offset,
    fit,
    ratio,
    lock,
    caption,
  };
}

export function serializeMediaDirective(
  value: MediaDirective,
): string {
  const directive = normalizeMediaDirective(value);
  const description = directive.description
    .replaceAll('\\', '\\\\')
    .replaceAll(']', '\\]');
  return `::media[${description}]{v=${directive.version} id=${directive.id} path="${escapeQuoted(directive.path)}" placement=${directive.placement} span=${directive.span} offset=${directive.offset} fit=${directive.fit} ratio=${Number(directive.ratio.toFixed(4))} lock=${directive.lock} caption=${directive.caption}}`;
}

export function normalizeImageDirective(
  value: ImageDirective,
): ImageDirective {
  const minWidth = Math.min(4_096, Math.max(48, Math.round(value.minWidth)));
  const maxWidth = Math.min(
    4_096,
    Math.max(minWidth, Math.round(value.maxWidth)),
  );
  const width = Math.min(
    maxWidth,
    Math.max(minWidth, Math.round(value.width)),
  );
  const height = Math.min(4_096, Math.max(24, Math.round(value.height)));
  const mode = value.mode;
  const align =
    mode === 'inline'
      ? 'left'
      : mode === 'wrap' && value.align === 'center'
        ? 'left'
        : value.align;

  return {
    ...value,
    path: value.path.replaceAll('\\', '/').slice(0, 4_096),
    alt: value.alt.slice(0, 512),
    caption: value.caption.slice(0, 1_024),
    mode,
    align,
    width,
    height,
    minWidth,
    maxWidth,
    margin: Math.min(64, Math.max(0, Math.round(value.margin))),
  };
}

function parseImageDirectiveMatch(
  match: RegExpExecArray,
): ImageDirective | null {
  if (!match) {
    return null;
  }
  const values = new Map<string, string>();
  let attribute: RegExpExecArray | null;
  ATTRIBUTE.lastIndex = 0;
  while ((attribute = ATTRIBUTE.exec(match[2]!))) {
    const key = attribute[1]!.toLowerCase();
    if (values.has(key)) {
      return null;
    }
    values.set(
      key,
      attribute[2] === undefined
        ? attribute[3]!
        : unescapeQuoted(attribute[2]),
    );
  }
  const version = integerInRange(values.get('v'), 2, 2);
  const instanceId = values.get('instance');
  const assetId = values.get('asset');
  const path = values.get('path');
  const mode = values.get('mode');
  const align = values.get('align');
  const width = integerInRange(values.get('width'), 48, 4_096);
  const height = integerInRange(values.get('height'), 24, 4_096);
  const minWidth = integerInRange(values.get('min'), 48, 4_096);
  const maxWidth = integerInRange(values.get('max'), 48, 4_096);
  const margin = integerInRange(values.get('margin'), 0, 64);
  const ratioLock = booleanValue(values.get('ratiolock'));
  const positionLock = booleanValue(values.get('positionlock'));
  const caption = values.get('caption');
  if (
    version !== IMAGE_DIRECTIVE_VERSION ||
    !instanceId ||
    !UUID.test(instanceId) ||
    !assetId ||
    !UUID.test(assetId) ||
    !path ||
    path.length > 4_096 ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[a-z]:/i.test(path) ||
    path.split(/[\\/]/).some((part) => part === '..') ||
    (mode !== 'inline' && mode !== 'block' && mode !== 'wrap') ||
    (align !== 'left' && align !== 'center' && align !== 'right') ||
    (mode === 'wrap' && align === 'center') ||
    width === undefined ||
    height === undefined ||
    minWidth === undefined ||
    maxWidth === undefined ||
    minWidth > width ||
    width > maxWidth ||
    margin === undefined ||
    ratioLock === undefined ||
    positionLock === undefined ||
    caption === undefined
  ) {
    return null;
  }
  return normalizeImageDirective({
    version,
    instanceId,
    assetId,
    path,
    alt: unescapeBracket(match[1]!),
    mode,
    align,
    width,
    height,
    minWidth,
    maxWidth,
    margin,
    ratioLock,
    positionLock,
    caption,
  });
}

export interface ParsedImageDirective {
  directive: ImageDirective;
  end: number;
  start: number;
}

export function parseImageDirectiveAt(
  source: string,
  start: number,
): ParsedImageDirective | null {
  if (
    !Number.isInteger(start) ||
    start < 0 ||
    start >= source.length ||
    !source.startsWith('::image[', start)
  ) {
    return null;
  }
  const match = IMAGE_DIRECTIVE_AT.exec(source.slice(start));
  if (!match) {
    return null;
  }
  const directive = parseImageDirectiveMatch(match);
  return directive
    ? { directive, end: start + match[0].length, start }
    : null;
}

export function parseImageDirective(source: string): ImageDirective | null {
  const match = IMAGE_DIRECTIVE.exec(source.trim());
  return match ? parseImageDirectiveMatch(match) : null;
}

export function imageDirectivesInSource(
  source: string,
): readonly ParsedImageDirective[] {
  const directives: ParsedImageDirective[] = [];
  let lineStart = 0;
  let fenced = false;
  for (const line of source.split('\n')) {
    if (/^ {0,3}(?:`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      lineStart += line.length + 1;
      continue;
    }
    if (!fenced) {
      let local = 0;
      while (local < line.length) {
        const found = line.indexOf('::image[', local);
        if (found === -1) {
          break;
        }
        const prefix = line.slice(0, found);
        const codeFenceCount = prefix.match(/`+/g)?.length ?? 0;
        const parsed =
          codeFenceCount % 2 === 0
            ? parseImageDirectiveAt(source, lineStart + found)
            : null;
        if (parsed && parsed.end <= lineStart + line.length) {
          directives.push(parsed);
          local = parsed.end - lineStart;
        } else {
          local = found + 2;
        }
      }
    }
    lineStart += line.length + 1;
  }
  return directives;
}

export function serializeImageDirective(value: ImageDirective): string {
  const image = normalizeImageDirective(value);
  return `::image[${escapeBracket(image.alt)}]{v=2 instance=${image.instanceId} asset=${image.assetId} path="${escapeQuoted(image.path)}" mode=${image.mode} align=${image.align} width=${image.width} height=${image.height} min=${image.minWidth} max=${image.maxWidth} margin=${image.margin} ratioLock=${image.ratioLock} positionLock=${image.positionLock} caption="${escapeQuoted(image.caption)}"}`;
}

export function mediaAssetUrl(
  assetId: string,
  projectId?: string,
  revision?: string,
): string {
  if (!UUID.test(assetId)) {
    return '';
  }
  const path = projectId && UUID.test(projectId)
    ? `${projectId}/${assetId}`
    : assetId;
  const query =
    revision && /^[0-9a-f]{64}$/i.test(revision)
      ? `?rev=${revision.toLowerCase()}`
      : '';
  return `flyoff-media://asset/${path}${query}`;
}
