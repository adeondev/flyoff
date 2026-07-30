import { describe, expect, it } from 'vitest';

import { SourceHeightMap } from '../../src/renderer/projects/source-engine/source-height-map';

describe('source height map', () => {
  it('maps offsets and indexes across variable heights', () => {
    const heights = new SourceHeightMap([10, 20, 5, 15]);

    expect(heights.length).toBe(4);
    expect(heights.totalHeight).toBe(50);
    expect(heights.heightAt(0)).toBe(10);
    expect(heights.heightAt(2)).toBe(5);
    expect(heights.heightAt(-10)).toBe(10);
    expect(heights.heightAt(100)).toBe(15);

    expect(heights.offsetAtIndex(-10)).toBe(0);
    expect(heights.offsetAtIndex(0)).toBe(0);
    expect(heights.offsetAtIndex(1)).toBe(10);
    expect(heights.offsetAtIndex(2)).toBe(30);
    expect(heights.offsetAtIndex(4)).toBe(50);
    expect(heights.offsetAtIndex(100)).toBe(50);

    expect(heights.indexAtOffset(-10)).toBe(0);
    expect(heights.indexAtOffset(0)).toBe(0);
    expect(heights.indexAtOffset(9.99)).toBe(0);
    expect(heights.indexAtOffset(10)).toBe(1);
    expect(heights.indexAtOffset(29.99)).toBe(1);
    expect(heights.indexAtOffset(30)).toBe(2);
    expect(heights.indexAtOffset(35)).toBe(3);
    expect(heights.indexAtOffset(50)).toBe(3);
    expect(heights.indexAtOffset(500)).toBe(3);
  });

  it('normalizes invalid heights and clamps non-finite queries', () => {
    const heights = new SourceHeightMap([
      Number.NaN,
      -12,
      Number.POSITIVE_INFINITY,
      0,
      7.5,
    ]);

    expect(heights.totalHeight).toBe(7.5);
    expect(heights.heightAt(0)).toBe(0);
    expect(heights.heightAt(4)).toBe(7.5);
    expect(heights.heightAt(Number.NaN)).toBe(0);
    expect(heights.heightAt(Number.POSITIVE_INFINITY)).toBe(7.5);
    expect(heights.offsetAtIndex(Number.NaN)).toBe(0);
    expect(heights.offsetAtIndex(Number.POSITIVE_INFINITY)).toBe(7.5);
    expect(heights.indexAtOffset(Number.NaN)).toBe(4);
    expect(heights.indexAtOffset(Number.NEGATIVE_INFINITY)).toBe(4);
    expect(heights.indexAtOffset(Number.POSITIVE_INFINITY)).toBe(4);

    heights.replace([]);

    expect(heights.length).toBe(0);
    expect(heights.totalHeight).toBe(0);
    expect(heights.heightAt(0)).toBe(0);
    expect(heights.offsetAtIndex(1)).toBe(0);
    expect(heights.indexAtOffset(1)).toBe(0);
  });

  it('updates one height without disturbing neighboring prefixes', () => {
    const heights = new SourceHeightMap([10, 20, 30]);

    heights.update(1, 7.5);

    expect(heights.totalHeight).toBe(47.5);
    expect(heights.heightAt(1)).toBe(7.5);
    expect(heights.offsetAtIndex(1)).toBe(10);
    expect(heights.offsetAtIndex(2)).toBe(17.5);
    expect(heights.offsetAtIndex(3)).toBe(47.5);

    heights.update(1, Number.NaN);

    expect(heights.heightAt(1)).toBe(0);
    expect(heights.totalHeight).toBe(40);

    heights.update(-1, 500);
    heights.update(3, 500);
    heights.update(Number.POSITIVE_INFINITY, 500);

    expect(heights.totalHeight).toBe(40);
  });

  it('splices ranges with array-compatible start and clamped deletion', () => {
    const heights = new SourceHeightMap([10, 20, 30, 40]);

    heights.splice(1, 2, [5, 15, 25]);

    expect(heights.length).toBe(5);
    expect(heights.totalHeight).toBe(95);
    expect(
      Array.from({ length: heights.length }, (_, index) =>
        heights.heightAt(index),
      ),
    ).toEqual([10, 5, 15, 25, 40]);
    expect(heights.offsetAtIndex(4)).toBe(55);

    heights.splice(-2, 1, [7]);
    heights.splice(Number.POSITIVE_INFINITY, 100, [3]);
    heights.splice(Number.NEGATIVE_INFINITY, -10, [2]);

    expect(
      Array.from({ length: heights.length }, (_, index) =>
        heights.heightAt(index),
      ),
    ).toEqual([2, 10, 5, 15, 7, 40, 3]);
    expect(heights.totalHeight).toBe(82);
  });

  it('skips zero-height entries when resolving spatial offsets', () => {
    const heights = new SourceHeightMap([0, 10, 0, 20]);

    expect(heights.indexAtOffset(0)).toBe(1);
    expect(heights.indexAtOffset(9.99)).toBe(1);
    expect(heights.indexAtOffset(10)).toBe(3);
    expect(heights.indexAtOffset(29.99)).toBe(3);
    expect(heights.indexAtOffset(30)).toBe(3);
  });
});
