import { describe, expect, it } from 'vitest';

import { serializeImageDirective } from '../../src/shared/markdown';
import {
  calibrateMarkdownBlockMetrics,
  createMarkdownBlockMetrics,
  estimateMarkdownBlockHeight,
  markdownBlockKind,
  markdownBlockRows,
  markdownImageBlockHeight,
} from '../../src/renderer/projects/source-engine/markdown-block-metrics';

function imageSource(mode: 'block' | 'wrap', height: number): string {
  return serializeImageDirective({
    align: 'left',
    alt: 'Exemplo',
    assetId: '123e4567-e89b-42d3-a456-426614174000',
    caption: '',
    height,
    instanceId: '223e4567-e89b-42d3-a456-426614174001',
    margin: 12,
    maxWidth: 1200,
    minWidth: 96,
    mode,
    path: 'Media/exemplo.png',
    positionLock: false,
    ratioLock: true,
    version: 2,
    width: 320,
  });
}

describe('markdown block metrics', () => {
  it('classifies blocks from their first line', () => {
    expect(markdownBlockKind('# Título')).toBe('heading');
    expect(markdownBlockKind('###### Nível seis')).toBe('heading');
    expect(markdownBlockKind('- item\n- outro')).toBe('list');
    expect(markdownBlockKind('1. primeiro')).toBe('list');
    expect(markdownBlockKind('> citação')).toBe('quote');
    expect(markdownBlockKind('| a | b |')).toBe('table');
    expect(markdownBlockKind('```ts\ncode\n```')).toBe('code');
    expect(markdownBlockKind('---')).toBe('rule');
    expect(markdownBlockKind('Texto comum.')).toBe('paragraph');
    expect(markdownBlockKind(imageSource('block', 180))).toBe('image');
  });

  it('does not mistake a hash inside prose for a heading', () => {
    expect(markdownBlockKind('Custa R$ 10 #promoção')).toBe('paragraph');
  });

  it('counts wrapped rows rather than source lines', () => {
    expect(markdownBlockRows('curto', 80)).toBe(1);
    expect(markdownBlockRows('a'.repeat(160), 80)).toBe(2);
    expect(markdownBlockRows('a'.repeat(161), 80)).toBe(3);
    expect(markdownBlockRows('uma\nduas\ntrês', 80)).toBe(3);
  });

  it('always reports at least one row, even for an empty block', () => {
    expect(markdownBlockRows('', 80)).toBe(1);
    expect(markdownBlockRows('texto', 0)).toBeGreaterThanOrEqual(1);
  });

  it('places a block image at its declared height', () => {
    expect(markdownImageBlockHeight(imageSource('block', 180))).toBe(180);
  });

  it('ignores the declared height of a wrapped image', () => {
    // A wrapped image shares its row with the text beside it, so its own
    // height is not the height of the block.
    expect(markdownImageBlockHeight(imageSource('wrap', 180))).toBeUndefined();
  });

  it('ignores a declared height for anything that is not an image', () => {
    expect(markdownImageBlockHeight('Texto comum.')).toBeUndefined();
  });

  it('estimates a taller box for a heading than for a paragraph', () => {
    const metrics = createMarkdownBlockMetrics(24, 720);

    expect(estimateMarkdownBlockHeight('# Título', metrics)).toBeGreaterThan(
      estimateMarkdownBlockHeight('Título', metrics),
    );
  });

  it('estimates a block image exactly from its directive', () => {
    const metrics = createMarkdownBlockMetrics(24, 720);

    expect(
      estimateMarkdownBlockHeight(imageSource('block', 260), metrics),
    ).toBe(260);
  });

  it('moves the per-kind estimate toward what was measured', () => {
    const metrics = createMarkdownBlockMetrics(24, 720);
    const before = estimateMarkdownBlockHeight('Texto comum.', metrics);

    for (let pass = 0; pass < 20; pass += 1) {
      calibrateMarkdownBlockMetrics(metrics, 'Texto comum.', 90);
    }

    const after = estimateMarkdownBlockHeight('Texto comum.', metrics);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(90, 0);
  });

  it('refuses to calibrate from a height that was never laid out', () => {
    const metrics = createMarkdownBlockMetrics(24, 720);
    const before = metrics.heightPerRow.paragraph;

    calibrateMarkdownBlockMetrics(metrics, 'Texto comum.', 0);
    calibrateMarkdownBlockMetrics(metrics, 'Texto comum.', -12);

    expect(metrics.heightPerRow.paragraph).toBe(before);
  });

  it('does not let a declared image height distort the shared estimate', () => {
    const metrics = createMarkdownBlockMetrics(24, 720);
    const before = metrics.heightPerRow.image;

    calibrateMarkdownBlockMetrics(metrics, imageSource('block', 900), 900);

    expect(metrics.heightPerRow.image).toBe(before);
  });
});
