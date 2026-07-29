import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DiagramImportCoordinator } from '../../src/main/diagrams/diagram-import-coordinator';
import { exportDrawio } from '../../src/main/diagrams/diagram-exporter';
import { importDiagramFile } from '../../src/main/diagrams/importers';
import type { ProjectService } from '../../src/main/projects';
import {
  createDiagramDocument,
  createDiagramElement,
  DIAGRAM_IMPORT_MAX_BYTES,
  validateDiagramDocument,
  validateUmlSemantics,
} from '../../src/shared/diagram';

const temporaryDirectories: string[] = [];

function ids() {
  let next = 1;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('diagram importers', () => {
  it('imports Astah Bridge geometry, relationships, tags and source references', () => {
    const bridge = {
      protocolVersion: '1.0',
      modelElements: [
        { id: 'class-a', type: 'Class', name: 'Account', taggedValues: { owner: 'Core' } },
        { id: 'class-b', type: 'Class', name: 'Ledger' },
        { id: 'unsupported', type: 'Component', name: 'Legacy' },
      ],
      relationships: [
        { id: 'association-a', type: 'Association', sourceId: 'class-a', targetId: 'class-b' },
      ],
      diagrams: [
        {
          id: 'diagram-a',
          type: 'ClassDiagram',
          name: 'Domain',
          nodes: [
            { elementId: 'class-a', bounds: { x: 10, y: 20, width: 220, height: 140 } },
            { elementId: 'class-b', bounds: { x: 320, y: 20, width: 220, height: 140 } },
          ],
          edges: [{ relationshipId: 'association-a', points: [{ x: 230, y: 90 }] }],
        },
      ],
      diagnostics: [],
    };

    const result = importDiagramFile(
      'model.spinel-import.json',
      new TextEncoder().encode(JSON.stringify(bridge)),
      ids(),
    );
    const imported = result.diagrams[0]!;

    expect(result.sourceFormat).toBe('astah-bridge');
    expect(imported.document).toMatchObject({
      diagramType: 'class',
      sourceRef: { system: 'astah-bridge', externalId: 'diagram-a' },
    });
    expect(imported.document.elements).toHaveLength(2);
    expect(imported.document.relationships).toHaveLength(1);
    expect(imported.document.presentations.edges[0]?.points).toEqual([{ x: 230, y: 90 }]);
    expect(imported.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'astah.element-unsupported' })]),
    );
    expect(validateDiagramDocument(imported.document).ok).toBe(true);
  });

  it('imports portable XMI models and reports regenerated presentation fidelity', () => {
    const xmi = `<?xml version="1.0"?>
      <xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001">
        <uml:Model xmi:id="model" name="Billing">
          <packagedElement xmi:type="uml:Class" xmi:id="class-a" name="Invoice">
            <ownedAttribute xmi:id="attribute-a" name="total" type="Money" visibility="private"/>
          </packagedElement>
          <packagedElement xmi:type="uml:Class" xmi:id="class-b" name="Customer"/>
          <packagedElement xmi:type="uml:Association" xmi:id="association-a" source="class-a" target="class-b" name="owner"/>
        </uml:Model>
      </xmi:XMI>`;

    const result = importDiagramFile('billing.xmi', new TextEncoder().encode(xmi), ids());
    const imported = result.diagrams.find(({ document }) => document.diagramType === 'class')!;

    expect(imported.document.elements).toHaveLength(2);
    expect(imported.document.relationships).toHaveLength(1);
    expect(imported.document.elements[0]).toMatchObject({
      kind: 'class',
      sourceRef: { system: 'xmi', externalId: 'class-a' },
    });
    expect(imported.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'xmi.layout-regenerated' })]),
    );
    expect(validateDiagramDocument(imported.document).ok).toBe(true);
    expect(() =>
      importDiagramFile(
        'unsafe.xmi',
        new TextEncoder().encode('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><x>&y;</x>'),
        ids(),
      ),
    ).toThrow(/DOCTYPE/);
  });

  it('round-trips supported geometry through uncompressed Draw.io XML', () => {
    const createId = ids();
    const document = createDiagramDocument('use-case', createId);
    const actor = createDiagramElement('actor', { createId, name: 'User', x: 20, y: 40 });
    const useCase = createDiagramElement('use-case', {
      createId,
      name: 'Sign in',
      x: 260,
      y: 60,
    });
    const populated = {
      ...document,
      elements: [actor.element, useCase.element],
      presentations: { nodes: [actor.presentation, useCase.presentation], edges: [] },
    };
    const result = importDiagramFile(
      'auth.drawio',
      new TextEncoder().encode(exportDrawio(populated)),
      ids(),
    );

    expect(result.sourceFormat).toBe('drawio');
    expect(result.diagrams[0]?.document.diagramType).toBe('use-case');
    expect(result.diagrams[0]?.document.elements.map(({ kind }) => kind)).toEqual([
      'actor',
      'use-case',
    ]);
    expect(result.diagrams[0]?.fidelity).toBe('partial');
    expect(validateDiagramDocument(result.diagrams[0]?.document).ok).toBe(true);
  });

  it('reconstructs Draw.io activity lanes, guards, final nodes and indirect connectors', () => {
    const drawio = `<?xml version="1.0"?>
      <mxfile host="app.diagrams.net">
        <diagram id="activity" name="Care flow">
          <mxGraphModel>
            <root>
              <mxCell id="0"/>
              <mxCell id="1" parent="0"/>
              <mxCell id="title" parent="1" value="Activity diagram" style="text;html=1;" vertex="1">
                <mxGeometry x="0" y="0" width="400" height="30" as="geometry"/>
              </mxCell>
              <mxCell id="lane-a" parent="1" value="" style="rounded=0;fillColor=none;strokeColor=#666666;" vertex="1">
                <mxGeometry x="0" y="40" width="200" height="500" as="geometry"/>
              </mxCell>
              <mxCell id="lane-b" parent="1" value="" style="rounded=0;fillColor=none;strokeColor=#666666;" vertex="1">
                <mxGeometry x="200" y="40" width="200" height="500" as="geometry"/>
              </mxCell>
              <mxCell id="header-a" parent="1" value="Patient" style="rounded=0;fillColor=#FFF9C4;strokeColor=#000000;" vertex="1">
                <mxGeometry x="0" y="40" width="200" height="30" as="geometry"/>
              </mxCell>
              <mxCell id="header-b" parent="1" value="Service" style="rounded=0;fillColor=#E1D5E7;strokeColor=#9673A6;" vertex="1">
                <mxGeometry x="200" y="40" width="200" height="30" as="geometry"/>
              </mxCell>
              <mxCell id="start" parent="1" value="" style="ellipse;fillColor=#000000;strokeColor=#000000;" vertex="1">
                <mxGeometry x="88" y="90" width="24" height="24" as="geometry"/>
              </mxCell>
              <mxCell id="action" parent="1" value="Request care" style="rounded=1;fillColor=#FFF9C4;strokeColor=#000000;" vertex="1">
                <mxGeometry x="40" y="150" width="120" height="40" as="geometry"/>
              </mxCell>
              <mxCell id="guard-label" parent="1" value="[Approved]" style="text;strokeColor=none;fillColor=none;" vertex="1">
                <mxGeometry x="160" y="220" width="70" height="24" as="geometry"/>
              </mxCell>
              <mxCell id="merge" parent="1" value="" style="rhombus;fillColor=#FFF9C4;strokeColor=#000000;" vertex="1">
                <mxGeometry x="260" y="210" width="70" height="70" as="geometry"/>
              </mxCell>
              <mxCell id="merge-label" parent="1" value="merge" style="text;strokeColor=none;fillColor=none;" vertex="1">
                <mxGeometry x="320" y="235" width="60" height="20" as="geometry"/>
              </mxCell>
              <mxCell id="connector" parent="1" value="1" style="ellipse;fillColor=#E1D5E7;strokeColor=#9673A6;" vertex="1">
                <mxGeometry x="280" y="330" width="28" height="28" as="geometry"/>
              </mxCell>
              <mxCell id="final" parent="1" value="" style="ellipse;fillColor=#000000;strokeColor=#FF0000;strokeWidth=3;" vertex="1">
                <mxGeometry x="280" y="420" width="30" height="30" as="geometry"/>
              </mxCell>
              <mxCell id="e1" parent="1" source="start" target="action" edge="1">
                <mxGeometry relative="1" as="geometry">
                  <mxPoint x="0" y="0" as="offset"/>
                  <Array as="points"><mxPoint x="100" y="130"/></Array>
                </mxGeometry>
              </mxCell>
              <mxCell id="e2" parent="1" source="action" target="guard-label" edge="1">
                <mxGeometry relative="1" as="geometry"/>
              </mxCell>
              <mxCell id="e3" parent="1" source="guard-label" target="merge" edge="1">
                <mxGeometry relative="1" as="geometry"/>
              </mxCell>
              <mxCell id="e4" parent="1" source="merge" edge="1">
                <mxGeometry relative="1" as="geometry">
                  <mxPoint x="294" y="344" as="targetPoint"/>
                </mxGeometry>
              </mxCell>
              <mxCell id="e5" parent="1" source="connector" target="final" edge="1">
                <mxGeometry relative="1" as="geometry"/>
              </mxCell>
            </root>
          </mxGraphModel>
        </diagram>
      </mxfile>`;

    const imported = importDiagramFile(
      'activity.drawio',
      new TextEncoder().encode(drawio),
      ids(),
    ).diagrams[0]!;
    const kinds = imported.document.elements.map(({ kind }) => kind);
    const assignedElements = imported.document.elements.filter(
      (element) => 'partitionId' in element && element.partitionId,
    );

    expect(kinds).toEqual([
      'activity-partition',
      'activity-partition',
      'initial-node',
      'action',
      'merge',
      'activity-final',
    ]);
    expect(assignedElements).toHaveLength(4);
    expect(imported.document.relationships).toHaveLength(3);
    expect(imported.document.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'control-flow', guard: 'Approved' }),
      ]),
    );
    expect(imported.document.presentations.edges[0]?.points).toEqual([
      { x: 100, y: 130 },
    ]);
    expect(imported.document.presentations.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          appearance: { color: '#FFF9C4' },
        }),
      ]),
    );
    expect(imported.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'drawio.topology-recovered' }),
      ]),
    );
    expect(validateDiagramDocument(imported.document).ok).toBe(true);
    expect(validateUmlSemantics(imported.document)).toEqual([]);
  });

  it('never parses proprietary Astah files and returns Bridge guidance', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-astah-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'model.asta');
    writeFileSync(filePath, 'proprietary', 'utf8');
    const coordinator = new DiagramImportCoordinator({} as ProjectService, ids());

    await expect(coordinator.select(7, filePath)).resolves.toEqual({
      ok: true,
      value: {
        status: 'astah-bridge-required',
        fileName: 'model.asta',
        acceptedBridgeExtension: '.spinel-import.json',
        alternatives: ['.xmi', '.xml'],
      },
    });
  });

  it('rejects imports larger than the bounded main-process limit before reading them', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-import-limit-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'oversized.flyd');
    writeFileSync(filePath, '', 'utf8');
    truncateSync(filePath, DIAGRAM_IMPORT_MAX_BYTES + 1);
    const coordinator = new DiagramImportCoordinator({} as ProjectService, ids());

    await expect(coordinator.select(8, filePath)).resolves.toMatchObject({
      ok: false,
      error: { code: 'size-exceeded' },
    });
  });
});
