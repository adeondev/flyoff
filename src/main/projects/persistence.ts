import {
  lstat,
  open,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { ProjectOperationError, normalizeProjectError } from './errors';

const READ_CHUNK_BYTES = 64 * 1_024;
const READ_ONLY_NOFOLLOW_FLAGS =
  constants.O_RDONLY |
  (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0) |
  (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);

export interface BoundedFileReadOptions {
  containmentRoot?: string;
  invalidTypeMessage?: string;
  sizeExceededMessage?: string;
  unsafePathMessage?: string;
}

function isInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function isSameFile(left: BigIntStats, right: BigIntStats): boolean {
  if (left.dev !== 0n || left.ino !== 0n || right.dev !== 0n || right.ino !== 0n) {
    return left.dev === right.dev && left.ino === right.ino;
  }

  return (
    left.birthtimeMs === right.birthtimeMs && left.ctimeMs === right.ctimeMs
  );
}

function unsafeReadError(message: string, cause?: unknown): ProjectOperationError {
  return new ProjectOperationError('unsafe-path', message, { cause });
}

function assertSafeCanonicalPath(
  canonicalPath: string,
  initialCanonicalPath: string | undefined,
  containmentRoot: string | undefined,
  message: string,
): void {
  if (
    (initialCanonicalPath !== undefined &&
      path.relative(initialCanonicalPath, canonicalPath) !== '') ||
    (containmentRoot !== undefined &&
      !isInside(containmentRoot, canonicalPath))
  ) {
    throw unsafeReadError(message);
  }
}

async function readHandleBounded(
  handle: Awaited<ReturnType<typeof open>>,
  maximumBytes: number,
  sizeExceededMessage: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (totalBytes <= maximumBytes) {
      const remaining = maximumBytes + 1 - totalBytes;
      const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);

      if (bytesRead === 0) {
        break;
      }

      chunks.push(
        bytesRead === buffer.byteLength ? buffer : buffer.subarray(0, bytesRead),
      );
      totalBytes += bytesRead;

      if (totalBytes > maximumBytes) {
        throw new ProjectOperationError('size-exceeded', sizeExceededMessage);
      }
    }

    return Buffer.concat(chunks, totalBytes);
  } finally {
    for (const chunk of chunks) {
      chunk.fill(0);
    }
  }
}

export async function readBoundedFile(
  filePath: string,
  maximumBytes: number,
  options: BoundedFileReadOptions = {},
): Promise<Buffer> {
  const invalidTypeMessage =
    options.invalidTypeMessage ?? 'Project data is not a regular file.';
  const sizeExceededMessage =
    options.sizeExceededMessage ??
    'Project data exceeds the supported size limit.';
  const unsafePathMessage =
    options.unsafePathMessage ??
    'Project data changed or resolves through an unsafe path.';
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    const containmentRoot =
      options.containmentRoot === undefined
        ? undefined
        : await realpath(options.containmentRoot);
    const initialStats = await lstat(filePath, { bigint: true });

    if (initialStats.isSymbolicLink()) {
      throw unsafeReadError(unsafePathMessage);
    }

    if (!initialStats.isFile()) {
      throw new ProjectOperationError('invalid-format', invalidTypeMessage);
    }

    if (initialStats.size > BigInt(maximumBytes)) {
      throw new ProjectOperationError('size-exceeded', sizeExceededMessage);
    }

    const initialCanonicalPath = await realpath(filePath);
    assertSafeCanonicalPath(
      initialCanonicalPath,
      undefined,
      containmentRoot,
      unsafePathMessage,
    );

    try {
      handle = await open(filePath, READ_ONLY_NOFOLLOW_FLAGS);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw unsafeReadError(unsafePathMessage, error);
      }
      throw error;
    }

    const handleStats = await handle.stat({ bigint: true });

    if (!handleStats.isFile()) {
      throw new ProjectOperationError('invalid-format', invalidTypeMessage);
    }

    if (!isSameFile(initialStats, handleStats)) {
      throw unsafeReadError(unsafePathMessage);
    }

    if (handleStats.size > BigInt(maximumBytes)) {
      throw new ProjectOperationError('size-exceeded', sizeExceededMessage);
    }

    const currentStats = await lstat(filePath, { bigint: true });
    const currentCanonicalPath = await realpath(filePath);

    if (
      currentStats.isSymbolicLink() ||
      !currentStats.isFile() ||
      !isSameFile(handleStats, currentStats)
    ) {
      throw unsafeReadError(unsafePathMessage);
    }

    assertSafeCanonicalPath(
      currentCanonicalPath,
      initialCanonicalPath,
      containmentRoot,
      unsafePathMessage,
    );

    return await readHandleBounded(handle, maximumBytes, sizeExceededMessage);
  } catch (error) {
    throw normalizeProjectError(error);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function readBoundedJson(
  filePath: string,
  maximumBytes: number,
  options: Pick<BoundedFileReadOptions, 'containmentRoot'> = {},
): Promise<unknown> {
  try {
    const content = await readBoundedFile(filePath, maximumBytes, {
      ...options,
      invalidTypeMessage: 'Project metadata is not a regular file.',
      sizeExceededMessage: 'Project metadata exceeds the supported size limit.',
      unsafePathMessage:
        'Project metadata changed or resolves through an unsafe path.',
    });
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch (error) {
      throw new ProjectOperationError(
        'invalid-format',
        'Project metadata is not valid UTF-8.',
        { cause: error },
      );
    }
    return JSON.parse(decoded) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ProjectOperationError(
        'invalid-format',
        'Project metadata is not valid JSON.',
        { cause: error },
      );
    }

    throw normalizeProjectError(error);
  }
}

export async function writeJsonAtomically(
  filePath: string,
  value: unknown,
  maximumBytes: number,
): Promise<void> {
  const serialized = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

  if (serialized.byteLength > maximumBytes) {
    serialized.fill(0);
    throw new ProjectOperationError(
      'size-exceeded',
      'Project metadata exceeds the supported size limit.',
    );
  }

  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(serialized);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
    await syncParentDirectoryBestEffort(path.dirname(filePath));
  } catch (error) {
    throw normalizeProjectError(error);
  } finally {
    serialized.fill(0);
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function syncParentDirectoryBestEffort(
  directoryPath: string,
): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directoryPath, 'r');
    await handle.sync();
  } catch {
    return;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
