import { describe, expect, it } from 'vitest';

import {
  normalizeImageDirective,
  normalizeMediaDirective,
  imageDirectivesInSource,
  parseImageDirective,
  parseImageDirectiveAt,
  parseMediaDirective,
  serializeImageDirective,
  serializeMediaDirective,
} from '../../src/shared/markdown';

const directive = {
  version: 1 as const,
  id: '123e4567-e89b-12d3-a456-426614174000',
  path: 'Media/Lua.png',
  description: 'Lua',
  placement: 'block' as const,
  span: 6,
  offset: 2,
  fit: 'contain' as const,
  ratio: 1.5,
  lock: true,
  caption: false,
};

describe('Markdown media directives', () => {
  it('round-trips canonical attributes', () => {
    expect(parseMediaDirective(serializeMediaDirective(directive))).toEqual(
      directive,
    );
  });

  it('rejects traversal, unsupported versions and invalid grids', () => {
    expect(
      parseMediaDirective(
        serializeMediaDirective(directive).replace(
          'path="Media/Lua.png"',
          'path="../Lua.png"',
        ),
      ),
    ).toBeNull();
    expect(
      parseMediaDirective(
        serializeMediaDirective(directive).replace('v=1', 'v=2'),
      ),
    ).toBeNull();
    expect(
      parseMediaDirective(
        serializeMediaDirective(directive).replace(
          'span=6 offset=2',
          'span=12 offset=2',
        ),
      ),
    ).toBeNull();
  });

  it('clamps layout changes to the responsive grid', () => {
    expect(
      normalizeMediaDirective({ ...directive, span: 20, offset: 10 }),
    ).toMatchObject({ span: 12, offset: 0 });
  });
});

describe('Markdown image directives v2', () => {
  const image = {
    version: 2 as const,
    instanceId: '223e4567-e89b-42d3-a456-426614174001',
    assetId: '123e4567-e89b-42d3-a456-426614174000',
    path: 'Media/Fotos/Lua.png',
    alt: 'Lua ] azul',
    mode: 'wrap' as const,
    align: 'right' as const,
    width: 320,
    height: 180,
    minWidth: 96,
    maxWidth: 1200,
    margin: 12,
    ratioLock: true,
    positionLock: false,
    caption: 'Órbita',
  };

  it('round-trips stable asset and instance identifiers', () => {
    expect(parseImageDirective(serializeImageDirective(image))).toEqual(image);
  });

  it('finds a canonical inline directive at an exact source offset', () => {
    const inline = serializeImageDirective({
      ...image,
      mode: 'inline',
      align: 'left',
    });
    const source = `antes ${inline} depois`;
    expect(parseImageDirectiveAt(source, 6)).toEqual({
      directive: { ...image, mode: 'inline', align: 'left' },
      start: 6,
      end: 6 + inline.length,
    });
    expect(parseImageDirectiveAt(source, 5)).toBeNull();
  });

  it('indexes directives in prose but not fenced or inline code', () => {
    const inline = serializeImageDirective({
      ...image,
      mode: 'inline',
      align: 'left',
    });
    const source = `antes ${inline}\n\`${inline}\`\n\`\`\`\n${inline}\n\`\`\``;
    expect(imageDirectivesInSource(source)).toHaveLength(1);
  });

  it('rejects traversal and invalid wrap alignment', () => {
    const source = serializeImageDirective(image);
    expect(
      parseImageDirective(
        source.replace('path="Media/Fotos/Lua.png"', 'path="../Lua.png"'),
      ),
    ).toBeNull();
    expect(
      parseImageDirective(source.replace('align=right', 'align=center')),
    ).toBeNull();
  });

  it('clamps dimensions and normalizes incompatible placement', () => {
    expect(
      normalizeImageDirective({
        ...image,
        mode: 'wrap',
        align: 'center',
        width: 9000,
        minWidth: 120,
        maxWidth: 800,
        margin: 100,
      }),
    ).toMatchObject({
      align: 'left',
      width: 800,
      margin: 64,
    });
  });
});
