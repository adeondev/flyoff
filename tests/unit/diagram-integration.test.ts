import { describe, expect, it } from 'vitest';

import {
  getProjectPageStorageAdapter,
  projectPageDiskName,
  projectPageStorageMatch,
} from '../../src/main/projects/project-storage-adapters';
import {
  getProjectPageTypeDefinition,
  listProjectPageTypeDefinitions,
} from '../../src/renderer/projects/project-page-type-registry';
import {
  isProjectInstanceTypeId,
  isProjectPageProperties,
} from '../../src/shared/contracts';
import {
  DIAGRAM_FILE_EXTENSION,
  DIAGRAM_MIME_TYPE,
} from '../../src/shared/diagram';
import { TRANSLATION_CATALOGS } from '../../src/shared/i18n';

describe('native diagram page integration', () => {
  it('registers diagram as a native extensible page and .flyd storage adapter', () => {
    expect(isProjectInstanceTypeId('diagram')).toBe(true);
    expect(getProjectPageTypeDefinition('diagram')).toMatchObject({
      availability: 'available',
      pageType: 'diagram',
      titleKey: 'projects.instanceDiagram',
      Page: expect.any(Function),
    });
    expect(listProjectPageTypeDefinitions().filter(({ pageType }) => pageType === 'diagram')).toHaveLength(1);
    expect(getProjectPageStorageAdapter('diagram')).toMatchObject({
      extensions: [DIAGRAM_FILE_EXTENSION],
      operations: expect.arrayContaining(['read', 'write']),
    });
    expect(projectPageDiskName('Architecture', 'diagram')).toBe('Architecture.flyd');
    expect(projectPageStorageMatch('ARCHITECTURE.FLYD')).toEqual({
      extension: '.flyd',
      pageType: 'diagram',
    });
    expect(DIAGRAM_MIME_TYPE).toBe('application/vnd.flyoff.diagram');
  });

  it('validates discriminated diagram properties without Markdown security fields', () => {
    expect(
      isProjectPageProperties({
        nodeId: '11111111-1111-4111-8111-111111111111',
        pageType: 'diagram',
        contentSizeBytes: 1024,
        diskSizeBytes: 1024,
        createdAt: null,
        modifiedAt: '2026-07-22T12:00:00.000Z',
        revision: 'a'.repeat(64),
        readOnly: false,
        passwordProtected: false,
        locked: false,
        diagramType: 'activity',
        elementCount: 12,
        relationshipCount: 9,
      }),
    ).toBe(true);
  });

  it('ships complete professional labels in pt-BR and en-US', () => {
    const portuguese = TRANSLATION_CATALOGS['pt-BR'];
    const english = TRANSLATION_CATALOGS['en-US'];
    expect(portuguese.projects.instanceDiagram).toBe('Diagrama UML');
    expect(english.projects.instanceDiagram).toBe('UML diagram');
    expect(portuguese.diagram.relationComposition).toBe('Composição');
    expect(english.diagram.relationMessageAsynchronous).toBe('Asynchronous message');
    expect(portuguese.diagram.astahBridgeExplanation).toContain('não interpreta .asta diretamente');
    expect(english.diagram.astahBridgeExplanation).toContain('does not interpret .asta directly');
  });
});
