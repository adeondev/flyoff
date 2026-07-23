import { SaxesParser } from 'saxes';

import {
  createDiagramDocument,
  type DiagramDiagnostic,
  type DiagramElement,
  type DiagramRelationship,
  type DiagramType,
  type UmlOperation,
} from '../../../shared/diagram';
import {
  externalElementKinds,
  externalRelationshipKinds,
  importedElement,
  importedRelationship,
  normalizedExternalType,
  sourceRef,
} from './shared';
import type { DiagramImportResult, ImportIdFactory } from './types';

interface RawElement {
  externalId: string;
  kind: DiagramElement['kind'];
  name: string;
  attributes: Array<{ name: string; type: string; visibility: string }>;
  operations: Array<{
    name: string;
    returnType: string;
    visibility: string;
    parameters: Array<{ name: string; type: string; direction: string }>;
  }>;
}

interface RawRelationship {
  externalId: string;
  kind: DiagramRelationship['kind'];
  sourceId: string;
  targetId: string;
  name: string;
}

type XmlAttributes = Record<string, string | { value: string }>;

function attribute(attributes: XmlAttributes, ...names: string[]): string {
  for (const name of names) {
    const direct = attributes[name];
    if (typeof direct === 'string') {
      return direct;
    }
    if (direct && typeof direct.value === 'string') {
      return direct.value;
    }
    const match = Object.entries(attributes).find(([key]) =>
      key === name || key.endsWith(`:${name}`),
    )?.[1];
    if (typeof match === 'string') {
      return match;
    }
    if (match && typeof match.value === 'string') {
      return match.value;
    }
  }
  return '';
}

function visibility(value: string): 'public' | 'private' | 'protected' | 'package' {
  return value === 'public' || value === 'private' || value === 'protected' || value === 'package'
    ? value
    : 'package';
}

function parseXmi(xml: string): {
  name: string;
  elements: readonly RawElement[];
  relationships: readonly RawRelationship[];
  diagnostics: readonly DiagramDiagnostic[];
} {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('DOCTYPE and external entities are not allowed in XMI.');
  }
  const elements = new Map<string, RawElement>();
  const relationships: RawRelationship[] = [];
  const diagnostics: DiagramDiagnostic[] = [];
  const elementStack: Array<string | undefined> = [];
  const operationStack: Array<number | undefined> = [];
  let rootName = 'Imported XMI';
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (tag) => {
    const attributes = tag.attributes as XmlAttributes;
    const rawType = attribute(attributes, 'xmi:type', 'type') || tag.name;
    const normalized = normalizedExternalType(rawType.replace(/^uml:/i, ''));
    const externalId = attribute(attributes, 'xmi:id', 'id');
    const parentId = [...elementStack].reverse().find(Boolean);
    let contextId = parentId;
    let operationIndex: number | undefined;
    const kind = externalElementKinds[normalized];
    if (kind && externalId) {
      contextId = externalId;
      elements.set(externalId, {
        externalId,
        kind,
        name: attribute(attributes, 'name') || kind,
        attributes: [],
        operations: [],
      });
    } else if (/ownedattribute$/i.test(tag.name) && parentId) {
      elements.get(parentId)?.attributes.push({
        name: attribute(attributes, 'name') || 'attribute',
        type: attribute(attributes, 'type'),
        visibility: attribute(attributes, 'visibility'),
      });
    } else if (/ownedoperation$/i.test(tag.name) && parentId) {
      const owner = elements.get(parentId);
      if (owner) {
        operationIndex = owner.operations.push({
          name: attribute(attributes, 'name') || 'operation',
          returnType: '',
          visibility: attribute(attributes, 'visibility'),
          parameters: [],
        }) - 1;
      }
    } else if (/ownedparameter$/i.test(tag.name) && parentId) {
      const index = [...operationStack].reverse().find((item) => item !== undefined);
      const operation = index === undefined ? undefined : elements.get(parentId)?.operations[index];
      if (operation) {
        const direction = attribute(attributes, 'direction') || 'in';
        if (direction === 'return') {
          operation.returnType = attribute(attributes, 'type');
        } else {
          operation.parameters.push({
            name: attribute(attributes, 'name') || 'parameter',
            type: attribute(attributes, 'type'),
            direction,
          });
        }
      }
    }

    const relationshipKind = externalRelationshipKinds[normalized];
    if (relationshipKind && externalId) {
      const sourceId =
        attribute(attributes, 'source', 'client', 'includingCase', 'extension') ||
        (normalized === 'generalization' ||
        normalized === 'include' ||
        normalized === 'extend' ||
        normalized === 'interfacerealization'
          ? parentId ?? ''
          : '');
      const targetId = attribute(
        attributes,
        'target',
        'supplier',
        'general',
        'addition',
        'extendedCase',
        'contract',
      );
      if (sourceId && targetId) {
        relationships.push({
          externalId,
          kind: relationshipKind,
          sourceId: sourceId.split(/\s+/)[0]!,
          targetId: targetId.split(/\s+/)[0]!,
          name: attribute(attributes, 'name'),
        });
      } else {
        diagnostics.push({
          code: 'xmi.relationship-endpoints-unresolved',
          severity: 'warning',
          message: `XMI relationship ${attribute(attributes, 'name') || externalId} has non-portable endpoints.`,
        });
      }
    }
    if (!rootName || rootName === 'Imported XMI') {
      rootName = attribute(attributes, 'name') || rootName;
    }
    elementStack.push(contextId);
    operationStack.push(operationIndex);
  });
  parser.on('closetag', () => {
    elementStack.pop();
    operationStack.pop();
  });
  let parseError: Error | undefined;
  parser.on('error', (error) => {
    parseError = error;
  });
  parser.write(xml).close();
  if (parseError) {
    throw new Error(`The XMI document is invalid XML: ${parseError.message}`);
  }
  return { name: rootName, elements: [...elements.values()], relationships, diagnostics };
}

const elementTypes: Record<DiagramType, ReadonlySet<DiagramElement['kind']>> = {
  class: new Set(['package', 'class', 'interface', 'enumeration']),
  'use-case': new Set(['actor', 'use-case', 'system-boundary']),
  sequence: new Set(['actor', 'lifeline', 'activation']),
  activity: new Set([
    'activity-partition',
    'action',
    'object-node',
    'initial-node',
    'activity-final',
    'flow-final',
    'decision',
    'merge',
    'fork',
    'join',
  ]),
};

export function importXmi(
  xml: string,
  createId: ImportIdFactory,
): DiagramImportResult {
  const parsed = parseXmi(xml);
  const idMap = new Map<string, string>();
  const elements = parsed.elements.map((raw) => {
    let element = importedElement(raw.kind, raw.externalId, raw.name, 'xmi', createId);
    if (element.kind === 'class' || element.kind === 'interface') {
      const operations: UmlOperation[] = raw.operations.map((operation) => ({
        id: createId(),
        name: operation.name,
        returnType: operation.returnType,
        visibility: visibility(operation.visibility),
        isAbstract: false,
        isStatic: false,
        parameters: operation.parameters.map((parameter) => ({
          id: createId(),
          name: parameter.name,
          type: parameter.type,
          direction:
            parameter.direction === 'out' || parameter.direction === 'inout'
              ? parameter.direction
              : 'in',
        })),
        taggedValues: [],
      }));
      element = {
        ...element,
        attributes: raw.attributes.map((attributeItem) => ({
          id: createId(),
          name: attributeItem.name,
          type: attributeItem.type,
          visibility: visibility(attributeItem.visibility),
          isStatic: false,
          isReadOnly: false,
          taggedValues: [],
        })),
        operations,
      };
    }
    idMap.set(raw.externalId, element.id);
    return element;
  });
  let messageOrder = 0;
  const relationships = parsed.relationships.flatMap((raw) => {
    const sourceId = idMap.get(raw.sourceId);
    const targetId = idMap.get(raw.targetId);
    if (!sourceId || !targetId) {
      return [];
    }
    let relationship = importedRelationship(
      raw.kind,
      raw.externalId,
      sourceId,
      targetId,
      'xmi',
      createId,
    );
    relationship = { ...relationship, name: raw.name };
    if ('order' in relationship) {
      messageOrder += 1;
      relationship = { ...relationship, order: messageOrder };
    }
    return [relationship];
  });
  const types = (Object.keys(elementTypes) as DiagramType[]).filter((type) => {
    const relevant = elements.filter((element) => elementTypes[type].has(element.kind));
    if (type === 'use-case') {
      return relevant.some(({ kind }) => kind === 'use-case' || kind === 'system-boundary');
    }
    if (type === 'sequence') {
      return relevant.some(({ kind }) => kind === 'lifeline' || kind === 'activation');
    }
    return relevant.length > 0;
  });
  if (types.length === 0 && elements.some(({ kind }) => kind === 'actor')) {
    types.push('use-case');
  }
  const diagrams = types.map((type) => {
    const selected = elements.filter((element) => elementTypes[type].has(element.kind));
    const selectedIds = new Set(selected.map(({ id }) => id));
    const selectedRelationships = relationships.filter(
      ({ sourceId, targetId }) => selectedIds.has(sourceId) && selectedIds.has(targetId),
    );
    const nodes = selected.map((element, index) => ({
      id: createId(),
      elementId: element.id,
      bounds: {
        x: 80 + (index % 4) * 250,
        y: 80 + Math.floor(index / 4) * 190,
        width:
          element.kind === 'actor' ? 96 : element.kind === 'lifeline' ? 120 : 210,
        height:
          element.kind === 'actor' ? 128 : element.kind === 'lifeline' ? 360 : 130,
      },
      zIndex: index,
    }));
    const nodeByElement = new Map(nodes.map((node) => [node.elementId, node]));
    const edges = selectedRelationships.flatMap((relationship) => {
      const source = nodeByElement.get(relationship.sourceId);
      const target = nodeByElement.get(relationship.targetId);
      return source && target
        ? [
            {
              id: createId(),
              relationshipId: relationship.id,
              sourcePresentationId: source.id,
              targetPresentationId: target.id,
              points: [],
            },
          ]
        : [];
    });
    const diagnostics: DiagramDiagnostic[] = [
      ...parsed.diagnostics,
      {
        code: 'xmi.layout-regenerated',
        severity: 'warning',
        message: 'Portable XMI does not reliably preserve diagram presentation; Flyoff generated a layout.',
      },
    ];
    return {
      importId: createId(),
      name: types.length > 1 ? `${parsed.name} - ${type}` : parsed.name,
      document: {
        ...createDiagramDocument(type, createId),
        elements: selected,
        relationships: selectedRelationships,
        presentations: { nodes, edges },
        sourceRef: sourceRef('xmi', parsed.name),
      },
      fidelity: 'partial' as const,
      diagnostics,
    };
  });
  if (diagrams.length === 0) {
    throw new Error('The XMI document contains no supported UML elements.');
  }
  return { sourceFormat: 'xmi', diagrams };
}
