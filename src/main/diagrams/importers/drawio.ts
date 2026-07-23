import { inflateRawSync } from 'node:zlib';

import { SaxesParser } from 'saxes';

import {
  DIAGRAM_IMPORT_MAX_BYTES,
  createDiagramDocument,
  type DiagramDiagnostic,
  type DiagramElement,
  type DiagramRelationship,
} from '../../../shared/diagram';
import {
  importedElement,
  importedRelationship,
  inferDiagramType,
  sourceRef,
} from './shared';
import type { DiagramImportResult, ImportIdFactory } from './types';

type XmlAttributes = Record<string, string | { value: string }>;

interface DrawioCell {
  id: string;
  value: string;
  style: string;
  parent: string;
  source: string;
  target: string;
  vertex: boolean;
  edge: boolean;
  geometry?: { x: number; y: number; width: number; height: number };
  points: Array<{ x: number; y: number }>;
}

function attribute(attributes: XmlAttributes, name: string): string {
  const value = attributes[name];
  return typeof value === 'string' ? value : value?.value ?? '';
}

function rejectUnsafeXml(xml: string): void {
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

function drawioPages(xml: string): readonly { id: string; name: string; model: string }[] {
  rejectUnsafeXml(xml);
  if (/^\s*<mxGraphModel\b/i.test(xml)) {
    return [{ id: 'mxGraphModel', name: 'Draw.io diagram', model: xml }];
  }
  const pages: Array<{ id: string; name: string; model: string }> = [];
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

function parseCells(xml: string): readonly DrawioCell[] {
  rejectUnsafeXml(xml);
  const cells = new Map<string, DrawioCell>();
  const cellStack: Array<string | undefined> = [];
  const parser = new SaxesParser({ xmlns: false });
  let parseError: Error | undefined;
  parser.on('opentag', (tag) => {
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
          points: [],
        });
      }
      cellStack.push(id || undefined);
      return;
    }
    const cellId = [...cellStack].reverse().find(Boolean);
    const cell = cellId ? cells.get(cellId) : undefined;
    if (cell && tag.name === 'mxGeometry') {
      const width = Number(attribute(attributes, 'width'));
      const height = Number(attribute(attributes, 'height'));
      cell.geometry = {
        x: Number(attribute(attributes, 'x')) || 0,
        y: Number(attribute(attributes, 'y')) || 0,
        width: Number.isFinite(width) && width > 0 ? width : 160,
        height: Number.isFinite(height) && height > 0 ? height : 80,
      };
    } else if (cell && tag.name === 'mxPoint') {
      const x = Number(attribute(attributes, 'x'));
      const y = Number(attribute(attributes, 'y'));
      if (Number.isFinite(x) && Number.isFinite(y)) {
        cell.points.push({ x, y });
      }
    }
  });
  parser.on('closetag', (tag) => {
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

function styleMap(style: string): ReadonlyMap<string, string> {
  return new Map(
    style
      .split(';')
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=');
        return separator < 0
          ? [part, '1'] as const
          : [part.slice(0, separator), part.slice(separator + 1)] as const;
      }),
  );
}

function plainText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replaceAll('&nbsp;', ' ')
    .trim()
    .slice(0, 2_048);
}

function cellKind(cell: DrawioCell): DiagramElement['kind'] | undefined {
  const style = styleMap(cell.style);
  const shape = (style.get('shape') ?? '').toLowerCase();
  const width = cell.geometry?.width ?? 160;
  const height = cell.geometry?.height ?? 80;
  if (shape.includes('actor')) return 'actor';
  if (shape.includes('lifeline')) return 'lifeline';
  if (shape.includes('activation')) return 'activation';
  if (shape.includes('package') || shape.includes('folder')) return 'package';
  if (shape.includes('interface')) return 'interface';
  if (shape.includes('enumeration') || /«enumeration»/i.test(cell.value)) return 'enumeration';
  if (shape.includes('object')) return 'object-node';
  if (shape.includes('swimlane') && style.get('horizontal') === '0') return 'activity-partition';
  if (shape.includes('rhombus') || style.has('rhombus')) return 'decision';
  if (shape.includes('doubleellipse') || style.has('doubleEllipse')) return 'activity-final';
  if ((shape.includes('ellipse') || style.has('ellipse')) && width <= 48 && height <= 48) {
    return style.get('fillColor') === 'none' ? 'flow-final' : 'initial-node';
  }
  if (shape.includes('ellipse') || style.has('ellipse')) return 'use-case';
  if (shape.includes('line') && (width <= 24 || height <= 24)) return 'fork';
  if (style.get('rounded') === '1') return 'action';
  if (shape.includes('boundary')) return 'system-boundary';
  if (style.has('swimlane') || style.get('childLayout') === 'stackLayout') return 'class';
  return cell.vertex && cell.geometry ? 'class' : undefined;
}

function drawioRelationshipKind(
  cell: DrawioCell,
  diagramType: ReturnType<typeof inferDiagramType>,
): DiagramRelationship['kind'] {
  const style = styleMap(cell.style);
  const label = plainText(cell.value).toLowerCase();
  const dashed = style.get('dashed') === '1';
  if (label.includes('include')) return 'include';
  if (label.includes('extend')) return 'extend';
  if (diagramType === 'sequence') {
    if (cell.source === cell.target) return 'self-message';
    if (dashed) return 'message-return';
    return style.get('endFill') === '0'
      ? 'message-asynchronous'
      : 'message-synchronous';
  }
  if (diagramType === 'activity') {
    return label.includes('object') ? 'object-flow' : 'control-flow';
  }
  const startArrow = (style.get('startArrow') ?? '').toLowerCase();
  const endArrow = (style.get('endArrow') ?? '').toLowerCase();
  if (startArrow.includes('diamond')) {
    return style.get('startFill') === '0' ? 'aggregation' : 'composition';
  }
  if (endArrow.includes('block')) {
    return dashed ? 'realization' : 'generalization';
  }
  if (dashed) return 'dependency';
  return endArrow && endArrow !== 'none' ? 'directed-association' : 'association';
}

export function importDrawio(
  xml: string,
  createId: ImportIdFactory,
): DiagramImportResult {
  const diagrams = drawioPages(xml).map((page) => {
    const cells = parseCells(page.model);
    const diagnostics: DiagramDiagnostic[] = [];
    const idMap = new Map<string, string>();
    const sourceCellByElement = new Map<string, DrawioCell>();
    const elements: DiagramElement[] = [];
    for (const cell of cells.filter(({ vertex }) => vertex)) {
      const kind = cellKind(cell);
      if (!kind) {
        diagnostics.push({
          code: 'drawio.shape-unsupported',
          severity: 'warning',
          message: `A Draw.io shape (${cell.id}) was not recognized as UML.`,
        });
        continue;
      }
      let element = importedElement(
        kind,
        cell.id,
        plainText(cell.value) || kind,
        'drawio',
        createId,
      );
      if (element.kind === 'class') {
        const childRows = cells.filter(
          (candidate) => candidate.vertex && candidate.parent === cell.id,
        );
        element = {
          ...element,
          attributes: childRows.map((row) => ({
            id: createId(),
            name: plainText(row.value) || 'attribute',
            type: '',
            visibility: 'package',
            isStatic: false,
            isReadOnly: false,
            taggedValues: [],
          })),
        };
      }
      idMap.set(cell.id, element.id);
      sourceCellByElement.set(element.id, cell);
      elements.push(element);
    }
    const diagramType = inferDiagramType(elements);
    let order = 0;
    const relationships = cells
      .filter(({ edge }) => edge)
      .flatMap((cell) => {
        const sourceId = idMap.get(cell.source);
        const targetId = idMap.get(cell.target);
        if (!sourceId || !targetId) {
          diagnostics.push({
            code: 'drawio.edge-unsupported',
            severity: 'warning',
            message: `A Draw.io connector (${cell.id}) has unsupported endpoints.`,
          });
          return [];
        }
        const kind = drawioRelationshipKind(cell, diagramType);
        let relationship = importedRelationship(
          kind,
          cell.id,
          sourceId,
          targetId,
          'drawio',
          createId,
        );
        relationship = { ...relationship, name: plainText(cell.value) };
        if ('order' in relationship) {
          order += 1;
          relationship = { ...relationship, order };
        } else if ('wholeEnd' in relationship &&
          (relationship.kind === 'aggregation' || relationship.kind === 'composition')) {
          relationship = { ...relationship, wholeEnd: 'source' };
        }
        return [relationship];
      });
    const nodes = elements.map((element, index) => {
      const cell = sourceCellByElement.get(element.id)!;
      const geometry = cell.geometry ?? { x: 80, y: 80, width: 180, height: 100 };
      return {
        id: createId(),
        elementId: element.id,
        bounds: geometry,
        zIndex: index,
      };
    });
    const nodeByElement = new Map(nodes.map((node) => [node.elementId, node]));
    const relationshipByExternalId = new Map(
      relationships.map((relationship) => [relationship.sourceRef!.externalId, relationship]),
    );
    const edges = cells.filter(({ edge }) => edge).flatMap((cell) => {
      const relationship = relationshipByExternalId.get(cell.id);
      const source = relationship ? nodeByElement.get(relationship.sourceId) : undefined;
      const target = relationship ? nodeByElement.get(relationship.targetId) : undefined;
      return relationship && source && target
        ? [
            {
              id: createId(),
              relationshipId: relationship.id,
              sourcePresentationId: source.id,
              targetPresentationId: target.id,
              points: cell.points,
            },
          ]
        : [];
    });
    diagnostics.push({
      code: 'drawio.fidelity-partial',
      severity: 'info',
      message: 'Draw.io styles were mapped heuristically to UML notation.',
    });
    return {
      importId: createId(),
      name: page.name,
      document: {
        ...createDiagramDocument(diagramType, createId),
        elements,
        relationships,
        presentations: { nodes, edges },
        sourceRef: sourceRef('drawio', page.id),
      },
      fidelity: 'partial' as const,
      diagnostics,
    };
  });
  return { sourceFormat: 'drawio', diagrams };
}
