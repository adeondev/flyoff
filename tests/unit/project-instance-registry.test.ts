import { describe, expect, it } from 'vitest';

import {
  projectPageDiskName,
  projectPageStorageMatch,
  registerProjectPageStorageAdapter,
} from '../../src/main/projects/project-storage-adapters';
import {
  getProjectPageTypeDefinition,
  registerProjectPageTypeDefinition,
} from '../../src/renderer/projects/project-page-type-registry';

describe('project instance registries', () => {
  it('registers and cleanly unloads a custom storage adapter', () => {
    const unregister = registerProjectPageStorageAdapter({
      pageType: 'example-plugin:canvas',
      extensions: ['.canvas'],
      initialContent: '{}',
      operations: ['create', 'rename', 'move', 'trash', 'read', 'write'],
    });
    try {
      expect(projectPageDiskName('Mapa', 'example-plugin:canvas')).toBe(
        'Mapa.canvas',
      );
      expect(projectPageStorageMatch('Mapa.CANVAS')).toEqual({
        pageType: 'example-plugin:canvas',
        extension: '.canvas',
      });
    } finally {
      unregister();
    }
    expect(projectPageStorageMatch('Mapa.canvas')).toBeUndefined();
  });

  it('registers renderer metadata and a component for a custom type', () => {
    const Page = () => null;
    const unregister = registerProjectPageTypeDefinition({
      pageType: 'example-plugin:canvas',
      icon: 'canvas.svg',
      title: 'Canvas',
      description: 'Freeform canvas',
      availability: 'available',
      Page,
    });
    try {
      expect(getProjectPageTypeDefinition('example-plugin:canvas')).toMatchObject({
        title: 'Canvas',
        Page,
      });
    } finally {
      unregister();
    }
    expect(getProjectPageTypeDefinition('example-plugin:canvas')).toBeUndefined();
  });
});
