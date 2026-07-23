import {
  serializeDiagramDocument,
  type DiagramDocument,
  type DiagramElement,
  type DiagramRelationship,
} from '../../shared/diagram';
import type { DiagramExportFormat } from '../../shared/contracts';

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function elementStyle(element: DiagramElement): string {
  switch (element.kind) {
    case 'actor':
      return 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;';
    case 'use-case':
      return 'ellipse;whiteSpace=wrap;html=1;';
    case 'system-boundary':
      return 'swimlane;html=1;rounded=0;';
    case 'lifeline':
      return 'shape=umlLifeline;perimeter=lifelinePerimeter;html=1;';
    case 'activation':
      return 'shape=activation;html=1;';
    case 'activity-partition':
      return `swimlane;horizontal=${element.orientation === 'vertical' ? '1' : '0'};html=1;`;
    case 'action':
      return 'rounded=1;whiteSpace=wrap;html=1;';
    case 'object-node':
      return 'shape=object;whiteSpace=wrap;html=1;';
    case 'initial-node':
      return 'ellipse;fillColor=#000000;html=1;';
    case 'activity-final':
      return 'ellipse;shape=doubleEllipse;html=1;';
    case 'flow-final':
      return 'ellipse;shape=flowFinal;html=1;';
    case 'decision':
    case 'merge':
      return 'rhombus;whiteSpace=wrap;html=1;';
    case 'fork':
    case 'join':
      return 'shape=line;strokeWidth=6;html=1;';
    case 'package':
      return 'shape=folder;tabWidth=60;html=1;';
    case 'interface':
      return 'swimlane;childLayout=stackLayout;html=1;startSize=32;';
    case 'enumeration':
      return 'swimlane;childLayout=stackLayout;html=1;startSize=32;';
    default:
      return 'swimlane;childLayout=stackLayout;html=1;startSize=32;';
  }
}

function relationshipStyle(relationship: DiagramRelationship): string {
  switch (relationship.kind) {
    case 'association':
      return 'endArrow=none;html=1;';
    case 'directed-association':
      return 'endArrow=open;html=1;';
    case 'aggregation':
      return 'startArrow=diamond;startFill=0;endArrow=none;html=1;';
    case 'composition':
      return 'startArrow=diamond;startFill=1;endArrow=none;html=1;';
    case 'generalization':
      return 'endArrow=block;endFill=0;html=1;';
    case 'realization':
      return 'endArrow=block;endFill=0;dashed=1;html=1;';
    case 'dependency':
    case 'include':
    case 'extend':
      return 'endArrow=open;dashed=1;html=1;';
    case 'message-return':
      return 'endArrow=open;dashed=1;html=1;';
    case 'message-asynchronous':
      return 'endArrow=open;endFill=0;html=1;';
    case 'message-synchronous':
    case 'self-message':
      return 'endArrow=block;endFill=1;html=1;';
    case 'control-flow':
    case 'object-flow':
      return 'endArrow=block;endFill=1;html=1;';
  }
}

export function exportDrawio(document: DiagramDocument): string {
  const nodes = new Map(
    document.presentations.nodes.map((presentation) => [
      presentation.elementId,
      presentation,
    ]),
  );
  const cells = document.elements.flatMap((element) => {
    const presentation = nodes.get(element.id);
    if (!presentation) {
      return [];
    }
    const bounds = presentation.bounds;
    return [
      `        <mxCell id="${presentation.id}" value="${xml(element.name)}" style="${elementStyle(element)}" vertex="1" parent="1" flyoffElementId="${element.id}">`,
      `          <mxGeometry x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" as="geometry"/>`,
      '        </mxCell>',
    ];
  });
  const edges = document.relationships.flatMap((relationship) => {
    const source = nodes.get(relationship.sourceId);
    const target = nodes.get(relationship.targetId);
    if (!source || !target) {
      return [];
    }
    const stereotype =
      relationship.kind === 'include' || relationship.kind === 'extend'
        ? `«${relationship.kind}» `
        : '';
    const guard = 'guard' in relationship && relationship.guard
      ? ` [${relationship.guard}]`
      : '';
    return [
      `        <mxCell id="${relationship.id}" value="${xml(`${stereotype}${relationship.name}${guard}`)}" style="${relationshipStyle(relationship)}" edge="1" parent="1" source="${source.id}" target="${target.id}" flyoffRelationshipId="${relationship.id}">`,
      '          <mxGeometry relative="1" as="geometry"/>',
      '        </mxCell>',
    ];
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mxfile host="Flyoff" agent="Flyoff Diagram File">',
    `  <diagram id="${document.documentId}" name="${xml(document.diagramType)}">`,
    '    <mxGraphModel>',
    '      <root>',
    '        <mxCell id="0"/>',
    '        <mxCell id="1" parent="0"/>',
    ...cells,
    ...edges,
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
    '',
  ].join('\n');
}

export function serializeDiagramExport(
  document: DiagramDocument,
  format: DiagramExportFormat,
): string {
  return format === 'flyd'
    ? serializeDiagramDocument(document)
    : exportDrawio(document);
}
