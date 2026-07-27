import { describe, expect, it } from 'vitest';

import {
  alignmentAtPoint,
  fitImageDragGhost,
  imageBoundaryAtPoint,
  imagePlacementAtPoint,
  inlineImageDropOffset,
  initialImageInteractionState,
  lineBoundaryAtPoint,
  reduceImageInteraction,
  resizeImageDirective,
  sameImageDropIntent,
} from '../../src/renderer/projects/image-interaction';

const image = {
  version: 2 as const,
  instanceId: '223e4567-e89b-42d3-a456-426614174001',
  assetId: '123e4567-e89b-42d3-a456-426614174000',
  path: 'Media/Lua.png',
  alt: 'Lua',
  mode: 'block' as const,
  align: 'center' as const,
  width: 320,
  height: 180,
  minWidth: 96,
  maxWidth: 1200,
  margin: 12,
  ratioLock: true,
  positionLock: false,
  caption: '',
};

describe('image interaction geometry', () => {
  it('bounds large drag ghosts without enlarging smaller images', () => {
    expect(fitImageDragGhost(320, 180)).toEqual({
      height: 180,
      width: 320,
    });
    expect(fitImageDragGhost(1_280, 960)).toEqual({
      height: 480,
      width: 640,
    });
    expect(fitImageDragGhost(600, 1_200)).toEqual({
      height: 480,
      width: 240,
    });
    expect(fitImageDragGhost(2_400, 600)).toEqual({
      height: 160,
      width: 640,
    });
  });

  it('compares only the semantic image drop destination', () => {
    expect(
      sameImageDropIntent(
        { kind: 'block-boundary', align: 'left', boundaryIndex: 3 },
        { kind: 'block-boundary', align: 'left', boundaryIndex: 3 },
      ),
    ).toBe(true);
    expect(
      sameImageDropIntent(
        { kind: 'inline-offset', offset: 12 },
        { kind: 'inline-offset', offset: 13 },
      ),
    ).toBe(false);
  });

  it('supports all eight resize directions with bounded dimensions', () => {
    for (const direction of [
      'north-west',
      'north',
      'north-east',
      'east',
      'south-east',
      'south',
      'south-west',
      'west',
    ] as const) {
      const resized = resizeImageDirective(
        image,
        direction,
        48,
        30,
        false,
        800,
      );
      expect(resized.width).toBeGreaterThanOrEqual(image.minWidth);
      expect(resized.width).toBeLessThanOrEqual(800);
      expect(resized.width / resized.height).toBeCloseTo(16 / 9, 1);
    }
  });

  it('lets Shift invert the ratio lock for the current gesture', () => {
    const resized = resizeImageDirective(
      image,
      'south-east',
      80,
      10,
      true,
      800,
    );
    expect(resized.width / resized.height).not.toBeCloseTo(16 / 9, 1);
  });

  it('projects corner movement continuously instead of switching axes', () => {
    const first = resizeImageDirective(image, 'south-east', 64, 35, false, 800);
    const next = resizeImageDirective(image, 'south-east', 65, 35, false, 800);

    expect(next.width).toBeGreaterThanOrEqual(first.width);
    expect(next.width - first.width).toBeLessThanOrEqual(2);
    expect(next.height - first.height).toBeLessThanOrEqual(2);
  });

  it('uses the actual available width as the gesture ceiling', () => {
    const resized = resizeImageDirective(image, 'east', 1_000, 0, false, 412);
    expect(resized.width).toBe(412);
    expect(resized.height).toBe(232);
  });

  it('calculates deterministic alignment and block boundaries', () => {
    expect(alignmentAtPoint(10, { left: 0, width: 300 })).toBe('left');
    expect(alignmentAtPoint(150, { left: 0, width: 300 })).toBe('center');
    expect(alignmentAtPoint(290, { left: 0, width: 300 })).toBe('right');
    expect(
      lineBoundaryAtPoint(75, [
        { top: 0, bottom: 40 },
        { top: 40, bottom: 80 },
      ]),
    ).toBe(2);
  });

  it('aligns the destination around the dragged image center', () => {
    const lines = [
      { top: 0, bottom: 30 },
      { top: 30, bottom: 60 },
      { top: 60, bottom: 90 },
      { top: 90, bottom: 120 },
      { top: 120, bottom: 150 },
    ];
    expect(imageBoundaryAtPoint(120, 90, lines)).toBe(3);
    expect(
      imagePlacementAtPoint(150, { left: 0, width: 300 }, 'wrap'),
    ).toEqual({ align: 'center', mode: 'block' });
    expect(
      imagePlacementAtPoint(290, { left: 0, width: 300 }, 'wrap'),
    ).toEqual({ align: 'right', mode: 'wrap' });
  });

  it('snaps inline drops to word boundaries and rejects code', () => {
    expect(inlineImageDropOffset('alpha beta', 3)).toBe(5);
    expect(inlineImageDropOffset('alpha `beta gamma` delta', 12)).toBeNull();
    expect(inlineImageDropOffset('```\nalpha beta\n```', 8)).toBeNull();
  });
});

describe('image interaction reducer', () => {
  it('returns to a selected image after canceling a resize', () => {
    const selected = reduceImageInteraction(initialImageInteractionState, {
      type: 'select',
      selection: {
        directive: image,
        lineIndex: 2,
        sourceRange: { start: 10, end: 20 },
      },
    });
    const resizing = reduceImageInteraction(selected, {
      type: 'start-resize',
    });
    expect(resizing.phase).toBe('image-resizing');
    expect(reduceImageInteraction(resizing, { type: 'cancel' }).phase).toBe(
      'image-selected',
    );
  });
});
