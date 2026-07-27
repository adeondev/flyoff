import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

import {
  projectMediaDefinition,
  type ProjectMediaKind,
} from '../../shared/contracts/media';
import { ProjectOperationError, normalizeProjectError } from './errors';

const HEADER_LIMIT = 1024 * 1024;

export interface MediaFileMetadata {
  extension: string;
  kind: ProjectMediaKind;
  mimeType: string;
  pixelHeight: number | null;
  pixelWidth: number | null;
  revision: string;
  sizeBytes: number;
}

function dimensions(
  pixelWidth: number,
  pixelHeight: number,
): Pick<MediaFileMetadata, 'pixelHeight' | 'pixelWidth'> | undefined {
  return Number.isSafeInteger(pixelWidth) &&
    Number.isSafeInteger(pixelHeight) &&
    pixelWidth > 0 &&
    pixelHeight > 0 &&
    pixelWidth <= 1_000_000 &&
    pixelHeight <= 1_000_000
    ? { pixelWidth, pixelHeight }
    : undefined;
}

function pngDimensions(bytes: Buffer) {
  return bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
    ? dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
    : undefined;
}

function gifDimensions(bytes: Buffer) {
  const signature = bytes.subarray(0, 6).toString('ascii');
  return bytes.length >= 10 &&
    (signature === 'GIF87a' || signature === 'GIF89a')
    ? dimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8))
    : undefined;
}

function jpegDimensions(bytes: Buffer) {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff
  ) {
    return undefined;
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      continue;
    }
    if (offset + 2 > bytes.length) {
      break;
    }
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) {
      break;
    }
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return dimensions(
        bytes.readUInt16BE(offset + 5),
        bytes.readUInt16BE(offset + 3),
      );
    }
    offset += length;
  }
  return undefined;
}

function webpDimensions(bytes: Buffer) {
  if (
    bytes.length < 30 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return undefined;
  }
  const type = bytes.subarray(12, 16).toString('ascii');
  if (type === 'VP8X') {
    return dimensions(
      1 + bytes.readUIntLE(24, 3),
      1 + bytes.readUIntLE(27, 3),
    );
  }
  if (type === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return dimensions((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (
    type === 'VP8 ' &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return dimensions(
      bytes.readUInt16LE(26) & 0x3fff,
      bytes.readUInt16LE(28) & 0x3fff,
    );
  }
  return undefined;
}

function avifDimensions(bytes: Buffer) {
  if (
    bytes.length < 16 ||
    bytes.subarray(4, 8).toString('ascii') !== 'ftyp' ||
    !bytes.subarray(8, Math.min(bytes.length, 64)).toString('ascii').includes('avif')
  ) {
    return undefined;
  }
  for (let offset = 0; offset + 20 <= bytes.length; offset += 1) {
    if (bytes.subarray(offset, offset + 4).toString('ascii') !== 'ispe') {
      continue;
    }
    return dimensions(
      bytes.readUInt32BE(offset + 8),
      bytes.readUInt32BE(offset + 12),
    );
  }
  return undefined;
}

function imageDimensions(extension: string, bytes: Buffer) {
  switch (extension) {
    case '.png':
      return pngDimensions(bytes);
    case '.jpg':
    case '.jpeg':
      return jpegDimensions(bytes);
    case '.gif':
      return gifDimensions(bytes);
    case '.webp':
      return webpDimensions(bytes);
    case '.avif':
      return avifDimensions(bytes);
    default:
      return undefined;
  }
}

async function hashFile(absolutePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(absolutePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

export async function inspectMediaFile(
  absolutePath: string,
): Promise<MediaFileMetadata> {
  if (!path.isAbsolute(absolutePath)) {
    throw new ProjectOperationError(
      'unsafe-path',
      'The selected media path must be absolute.',
    );
  }
  const stats = await lstat(absolutePath).catch((error: unknown) => {
    throw normalizeProjectError(error);
  });
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new ProjectOperationError(
      'invalid-operation',
      'The selected media must be a regular file.',
    );
  }
  if (!Number.isSafeInteger(stats.size)) {
    throw new ProjectOperationError(
      'size-exceeded',
      'The selected media is too large for this filesystem.',
    );
  }
  const extension = path.extname(absolutePath).toLowerCase();
  const definition = projectMediaDefinition(extension);
  if (!definition) {
    throw new ProjectOperationError(
      'invalid-format',
      'This media format is not supported.',
    );
  }
  const handle = await open(absolutePath, 'r');
  const bytes = Buffer.alloc(Math.min(HEADER_LIMIT, Math.max(64, stats.size)));
  try {
    const result = await handle.read(bytes, 0, bytes.length, 0);
    const header = bytes.subarray(0, result.bytesRead);
    const measured =
      definition.kind === 'image'
        ? imageDimensions(extension, header)
        : { pixelWidth: null, pixelHeight: null };
    if (
      definition.kind === 'image' &&
      !measured
    ) {
      throw new ProjectOperationError(
        'invalid-format',
        'The selected image does not match its extension or has invalid dimensions.',
      );
    }
    return {
      extension,
      kind: definition.kind,
      mimeType: definition.mimeType,
      pixelHeight: measured?.pixelHeight ?? null,
      pixelWidth: measured?.pixelWidth ?? null,
      revision: await hashFile(absolutePath),
      sizeBytes: stats.size,
    };
  } finally {
    bytes.fill(0);
    await handle.close();
  }
}
