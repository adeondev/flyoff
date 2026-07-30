import { describe, expect, it, vi } from 'vitest';

import { serializeImageDirective } from '../../src/shared/markdown';
import {
  resolveImageSourceByInstance,
  rewriteImageSource,
} from '../../src/renderer/projects/image-source-edit';

const image = {
  version: 2 as const,
  instanceId: '223e4567-e89b-42d3-a456-426614174001',
  assetId: '123e4567-e89b-42d3-a456-426614174000',
  path: 'Media/Lua.png',
  alt: 'Lua',
  mode: 'inline' as const,
  align: 'left' as const,
  width: 160,
  height: 90,
  minWidth: 96,
  maxWidth: 1200,
  margin: 8,
  ratioLock: true,
  positionLock: false,
  caption: '',
};

describe('image source editing', () => {
  it('moves an inline image between words without losing surrounding text', () => {
    const token = serializeImageDirective(image);
    const source = `um ${token} dois tres`;
    const start = source.indexOf(token);
    const target = source.indexOf('tres');
    const result = rewriteImageSource(source, {
      type: 'move',
      sourceRange: { start, end: start + token.length },
      intent: { kind: 'inline-offset', offset: target },
      directive: image,
    });
    expect(result?.content).toBe(`um dois ${token} tres`);
  });

  it('extracts an inline image to a block without dropping sentence text', () => {
    const token = serializeImageDirective(image);
    const source = `antes ${token} depois`;
    const start = source.indexOf(token);
    const result = rewriteImageSource(source, {
      type: 'change',
      sourceRange: { start, end: start + token.length },
      directive: { ...image, mode: 'block', align: 'center' },
    });
    expect(result?.content).toContain('antes \n::image[');
    expect(result?.content).toContain('\n depois');
  });

  it('duplicates with a fresh instance id while retaining the asset', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '323e4567-e89b-42d3-a456-426614174002',
    );
    const token = serializeImageDirective(image);
    const result = rewriteImageSource(token, {
      type: 'duplicate',
      sourceRange: { start: 0, end: token.length },
      directive: image,
    });
    expect(result?.content).toContain(image.instanceId);
    expect(result?.content).toContain(
      '323e4567-e89b-42d3-a456-426614174002',
    );
    expect(result?.content.match(new RegExp(image.assetId, 'g'))).toHaveLength(2);
  });

  it('rejects every operation when the cached range belongs to another image', () => {
    const replacement = {
      ...image,
      instanceId: '423e4567-e89b-42d3-a456-426614174003',
    };
    const source = serializeImageDirective(replacement);
    const sourceRange = { start: 0, end: source.length };

    expect(
      rewriteImageSource(source, {
        type: 'change',
        sourceRange,
        directive: { ...image, width: 240 },
      }),
    ).toBeNull();
    expect(
      rewriteImageSource(source, {
        type: 'move',
        sourceRange,
        intent: { kind: 'block-boundary', align: 'left', boundaryIndex: 0 },
        directive: image,
      }),
    ).toBeNull();
    expect(
      rewriteImageSource(source, {
        type: 'delete',
        instanceId: image.instanceId,
        sourceRange,
      }),
    ).toBeNull();
    expect(
      rewriteImageSource(source, {
        type: 'duplicate',
        sourceRange,
        directive: image,
      }),
    ).toBeNull();
  });

  it('rejects a cached range that no longer contains an image directive', () => {
    expect(
      rewriteImageSource('plain text', {
        type: 'delete',
        instanceId: image.instanceId,
        sourceRange: { start: 0, end: 10 },
      }),
    ).toBeNull();
  });

  it('deletes only a matching image instance', () => {
    const block = { ...image, mode: 'block' as const, align: 'center' as const };
    const token = serializeImageDirective(block);
    const result = rewriteImageSource(`before\n${token}\nafter`, {
      type: 'delete',
      instanceId: block.instanceId,
      sourceRange: { start: 7, end: 7 + token.length },
    });

    expect(result?.content).toBe('before\nafter');
  });

  it('relocates an image by instance id when text shifts before it', () => {
    const token = serializeImageDirective(image);
    const source = `new prefix\nbefore\n${token}\nafter`;
    const start = source.indexOf(token);
    const resolved = resolveImageSourceByInstance(
      source,
      image.instanceId,
      { start: 7, end: 7 + token.length },
    );

    expect(resolved).toEqual({
      directive: image,
      range: { start, end: start + token.length },
    });
  });
});
