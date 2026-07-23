import { createHash } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  DIAGRAM_DOCUMENT_MAX_BYTES,
  parseDiagramDocument,
  serializeDiagramDocument,
  type DiagramDocument,
} from '../../shared/diagram';
import type { DiagramDocumentEnvelope } from '../../shared/contracts/diagrams';
import { ProjectOperationError, normalizeProjectError } from './errors';
import {
  readBoundedFile,
  syncParentDirectoryBestEffort,
} from './persistence';

export function diagramRevisionFor(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function readDiagramBytes(
  absolutePath: string,
  containmentRoot: string,
): Promise<Buffer> {
  return readBoundedFile(absolutePath, DIAGRAM_DOCUMENT_MAX_BYTES, {
    containmentRoot,
    invalidTypeMessage: 'The diagram document is not a regular file.',
    sizeExceededMessage: 'The diagram document exceeds the supported size limit.',
    unsafePathMessage:
      'The diagram document changed or resolves through an unsafe path.',
  });
}

function decodeDiagram(bytes: Buffer): DiagramDocument {
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ProjectOperationError(
      'invalid-format',
      'The diagram document is not valid UTF-8.',
      { cause: error },
    );
  }
  const parsed = parseDiagramDocument(content);
  if (!parsed.ok) {
    throw new ProjectOperationError(
      'invalid-format',
      parsed.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'),
    );
  }
  return parsed.document;
}

export async function readDiagramDocumentFile(
  nodeId: string,
  absolutePath: string,
  containmentRoot: string,
): Promise<DiagramDocumentEnvelope> {
  try {
    const bytes = await readDiagramBytes(absolutePath, containmentRoot);
    try {
      return {
        nodeId,
        document: decodeDiagram(bytes),
        revision: diagramRevisionFor(bytes),
      };
    } finally {
      bytes.fill(0);
    }
  } catch (error) {
    throw normalizeProjectError(error, 'The diagram document could not be read.');
  }
}

interface SaveDiagramDocumentFileOptions {
  nodeId: string;
  document: DiagramDocument;
  expectedRevision: string;
  force: boolean;
  absolutePath: string;
  containmentRoot: string;
  createId: () => string;
  resolveCurrentPath: () => Promise<string>;
}

export async function saveDiagramDocumentFile({
  nodeId,
  document,
  expectedRevision,
  force,
  absolutePath,
  containmentRoot,
  createId,
  resolveCurrentPath,
}: SaveDiagramDocumentFileOptions): Promise<DiagramDocumentEnvelope> {
  const content = serializeDiagramDocument(document);
  const nextBytes = Buffer.from(content, 'utf8');
  const currentBytes = await readDiagramBytes(absolutePath, containmentRoot);
  const baselineRevision = diagramRevisionFor(currentBytes);
  currentBytes.fill(0);
  if (!force && baselineRevision !== expectedRevision) {
    throw new ProjectOperationError(
      'conflict',
      'The diagram document changed on disk after it was opened.',
      { currentRevision: baselineRevision },
    );
  }

  const temporaryPath = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${process.pid}.${createId()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const verifiedPath = await resolveCurrentPath();
    if (path.relative(absolutePath, verifiedPath) !== '') {
      throw new ProjectOperationError(
        'unsafe-path',
        'The diagram document moved before it could be saved.',
      );
    }
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(nextBytes);
    await handle.sync();
    await handle.close();
    handle = undefined;

    const latestBytes = await readDiagramBytes(absolutePath, containmentRoot);
    const latestRevision = diagramRevisionFor(latestBytes);
    latestBytes.fill(0);
    if (latestRevision !== baselineRevision) {
      throw new ProjectOperationError(
        'conflict',
        'The diagram document changed on disk while it was being saved.',
        { currentRevision: latestRevision },
      );
    }
    await rename(temporaryPath, absolutePath);
    await syncParentDirectoryBestEffort(path.dirname(absolutePath));
    return {
      nodeId,
      document,
      revision: diagramRevisionFor(nextBytes),
    };
  } catch (error) {
    throw normalizeProjectError(error, 'The diagram document could not be saved.');
  } finally {
    nextBytes.fill(0);
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
