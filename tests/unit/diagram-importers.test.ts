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
