import { inflateRawSync } from 'node:zlib';

import { SaxesParser } from 'saxes';

import {
  DIAGRAM_IMPORT_MAX_BYTES,
  type DiagramBounds,
  type DiagramPoint,
} from '../../../shared/diagram';

type XmlAttributes = Record<string, string | { value: string }>;

export interface DrawioCell {
  id: string;
  value: string;
  style: string;
  parent: string;
  source: string;
  target: string;
  vertex: boolean;
  edge: boolean;
  geometry?: DiagramBounds;
  waypoints: DiagramPoint[];
  sourcePoint?: DiagramPoint;
  targetPoint?: DiagramPoint;
}

export interface DrawioPage {
  id: string;
  name: string;
  model: string;
}

function attribute(attributes: XmlAttributes, name: string): string {
  const value = attributes[name];
  return typeof value === 'string' ? value : value?.value ?? '';
}

function finiteCoordinate(attributes: XmlAttributes, name: string): number | undefined {
  const value = Number(attribute(attributes, name));
  return Number.isFinite(value) ? value : undefined;
}

export function rejectUnsafeDrawioXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('DOCTYPE and external entities are not allowed in Draw.io files.');
  }
}

function decodeCompressedDiagram(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('<')) {
    return trimmed;
  }
  if (trimmed.startsWith('%3C')) {
    return decodeURIComponent(trimmed);
  }
  try {
    const inflated = inflateRawSync(Buffer.from(trimmed, 'base64'), {
      maxOutputLength: DIAGRAM_IMPORT_MAX_BYTES,
    });
    return decodeURIComponent(inflated.toString('utf8'));
  } catch (error) {
    throw new Error(`The Draw.io page could not be decompressed: ${String(error)}`, {
      cause: error,
    });
  }
}

export function parseDrawioPages(xml: string): readonly DrawioPage[] {
  rejectUnsafeDrawioXml(xml);
  if (/^\s*<mxGraphModel\b/i.test(xml)) {
    return [{ id: 'mxGraphModel', name: 'Draw.io diagram', model: xml }];
  }
  const pages: DrawioPage[] = [];
  const expression = /<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/gi;
  for (const match of xml.matchAll(expression)) {
    const attributesSource = match[1] ?? '';
    let id = '';
    let name = '';
    const attributeParser = new SaxesParser({ fragment: true, xmlns: false });
    attributeParser.on('opentag', (tag) => {
      const attributes = tag.attributes as XmlAttributes;
      id = attribute(attributes, 'id');
      name = attribute(attributes, 'name');
    });
    attributeParser.write(`<diagram ${attributesSource}></diagram>`).close();
    pages.push({
      id: id || `page-${pages.length + 1}`,
      name: name || `Draw.io ${pages.length + 1}`,
      model: decodeCompressedDiagram(match[2] ?? ''),
    });
  }
  if (pages.length === 0 && xml.includes('<mxGraphModel')) {
    return [{ id: 'mxGraphModel', name: 'Draw.io diagram', model: xml }];
  }
  if (pages.length === 0) {
    throw new Error('The Draw.io file contains no diagram pages.');
  }
  return pages;
}

export function parseDrawioCells(xml: string): readonly DrawioCell[] {
  rejectUnsafeDrawioXml(xml);
  const cells = new Map<string, DrawioCell>();
  const cellStack: Array<string | undefined> = [];
  const tagStack: string[] = [];
  let waypointArrayDepth: number | undefined;
  const parser = new SaxesParser({ xmlns: false });
  let parseError: Error | undefined;

  parser.on('opentag', (tag) => {
    tagStack.push(tag.name);
    const attributes = tag.attributes as XmlAttributes;
    if (tag.name === 'mxCell') {
      const id = attribute(attributes, 'id');
      if (id) {
        cells.set(id, {
          id,
          value: attribute(attributes, 'value'),
          style: attribute(attributes, 'style'),
          parent: attribute(attributes, 'parent'),
          source: attribute(attributes, 'source'),
          target: attribute(attributes, 'target'),
          vertex: attribute(attributes, 'vertex') === '1',
          edge: attribute(attributes, 'edge') === '1',
          waypoints: [],
        });
      }
      cellStack.push(id || undefined);
      return;
    }

    const cellId = [...cellStack].reverse().find(Boolean);
    const cell = cellId ? cells.get(cellId) : undefined;
    if (!cell) {
      return;
    }
    if (tag.name === 'Array' && attribute(attributes, 'as') === 'points') {
      waypointArrayDepth = tagStack.length;
      return;
    }
    if (tag.name === 'mxGeometry') {
      const width = Number(attribute(attributes, 'width'));
      const height = Number(attribute(attributes, 'height'));
      cell.geometry = {
        x: finiteCoordinate(attributes, 'x') ?? 0,
        y: finiteCoordinate(attributes, 'y') ?? 0,
        width: Number.isFinite(width) && width > 0 ? width : 160,
        height: Number.isFinite(height) && height > 0 ? height : 80,
      };
      return;
    }
    if (tag.name !== 'mxPoint') {
      return;
    }
    const x = finiteCoordinate(attributes, 'x');
    const y = finiteCoordinate(attributes, 'y');
    if (x === undefined || y === undefined) {
      return;
    }
    const point = { x, y };
    const role = attribute(attributes, 'as');
    if (role === 'sourcePoint') {
      cell.sourcePoint = point;
    } else if (role === 'targetPoint') {
      cell.targetPoint = point;
    } else if (waypointArrayDepth !== undefined) {
      cell.waypoints.push(point);
    }
  });

  parser.on('closetag', (tag) => {
    if (waypointArrayDepth === tagStack.length) {
      waypointArrayDepth = undefined;
    }
    tagStack.pop();
    if (tag.name === 'mxCell') {
      cellStack.pop();
    }
  });
  parser.on('error', (error) => {
    parseError = error;
  });
  parser.write(xml).close();
  if (parseError) {
    throw new Error(`The Draw.io page is invalid XML: ${parseError.message}`);
  }
  return [...cells.values()];
}

export function drawioStyle(style: string): ReadonlyMap<string, string> {
  return new Map(
    style
      .split(';')
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=');
        return separator < 0
          ? ([part, '1'] as const)
          : ([part.slice(0, separator), part.slice(separator + 1)] as const);
      }),
  );
}

export function drawioText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .trim()
    .slice(0, 2_048);
}
