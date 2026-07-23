import path from 'node:path';

import {
  DIAGRAM_JSON_MAX_DEPTH,
  diagramJsonDepth,
} from '../../../shared/diagram';
import { isPortableProjectName } from '../../../shared/contracts';
import { importAstahBridge } from './astah-bridge';
import { importDrawio } from './drawio';
import { importFlyd } from './flyd';
import { importSpinel } from './spinel';
import type { DiagramImportResult, ImportIdFactory } from './types';
import { importXmi } from './xmi';

export * from './types';

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`The selected diagram file is not valid UTF-8: ${String(error)}`, {
      cause: error,
    });
  }
}

function parseBoundedJson(content: string): unknown {
  const value = JSON.parse(content) as unknown;
  if (diagramJsonDepth(value) > DIAGRAM_JSON_MAX_DEPTH) {
    throw new Error('The selected JSON exceeds the supported depth limit.');
  }
  return value;
}

export function portableDiagramName(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/./gu, (character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? '-' : character;
    })
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100);
  if (isPortableProjectName(normalized)) {
    return normalized;
  }
  return 'Imported diagram';
}

export function importDiagramFile(
  fileName: string,
  bytes: Uint8Array,
  createId: ImportIdFactory,
): DiagramImportResult {
  const lower = fileName.toLowerCase();
  const content = decodeUtf8(bytes);
  let result: DiagramImportResult;
  if (lower.endsWith('.flyd')) {
    result = importFlyd(
      content,
      path.basename(fileName, path.extname(fileName)),
      createId,
    );
  } else if (lower.endsWith('.spinel-import.json')) {
    result = importAstahBridge(parseBoundedJson(content), createId);
  } else if (lower.endsWith('.spinel')) {
    result = importSpinel(parseBoundedJson(content), createId);
  } else if (lower.endsWith('.drawio')) {
    result = importDrawio(content, createId);
  } else if (lower.endsWith('.xmi')) {
    result = importXmi(content, createId);
  } else if (lower.endsWith('.xml')) {
    result = /<\s*(?:mxfile|mxGraphModel)\b/i.test(content)
      ? importDrawio(content, createId)
      : importXmi(content, createId);
  } else {
    throw new Error('The selected diagram format is not supported.');
  }
  return {
    ...result,
    diagrams: result.diagrams.map((diagram) => ({
      ...diagram,
      name: portableDiagramName(diagram.name),
    })),
  };
}
