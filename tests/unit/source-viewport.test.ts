import { describe, expect, it } from 'vitest';

import { SourceHeightMap } from '../../src/renderer/projects/source-engine/source-height-map';
import {
  SOURCE_VIEWPORT_MAX_LINES,
  sourceViewport,
} from '../../src/renderer/projects/source-engine/source-viewport';

describe('source viewport', () => {
  it('maps a pixel viewport with overscan to an exclusive line range', () => {
    const heights = new SourceHeightMap([10, 20, 30, 40, 50]);

    expect(
      sourceViewport(heights, {
        overscan: 10,
        scrollTop: 25,
        viewportHeight: 30,
      }),
    ).toEqual({
      endLine: 4,
      startLine: 1,
      top: 10,
      totalHeight: 150,
    });
  });

  it('does not include the line beginning at an exact bottom boundary', () => {
    const heights = new SourceHeightMap([10, 20, 30]);

    expect(
      sourceViewport(heights, {
        scrollTop: 10,
        viewportHeight: 20,
      }),
    ).toEqual({
      endLine: 2,
      startLine: 1,
      top: 10,
      totalHeight: 60,
    });
  });

  it('clamps viewports before and after the document', () => {
    const heights = new SourceHeightMap([10, 20, 5, 15]);

    expect(
      sourceViewport(heights, {
        overscan: 20,
        scrollTop: -500,
        viewportHeight: 15,
      }),
    ).toEqual({
      endLine: 3,
      startLine: 0,
      top: 0,
      totalHeight: 50,
    });
    expect(
      sourceViewport(heights, {
        scrollTop: 500,
        viewportHeight: 100,
      }),
    ).toEqual({
      endLine: 4,
      startLine: 3,
      top: 35,
      totalHeight: 50,
    });
  });

  it('returns an empty exclusive range for an empty document', () => {
    expect(
      sourceViewport(new SourceHeightMap(), {
        overscan: 100,
        scrollTop: 100,
        viewportHeight: 500,
      }),
    ).toEqual({
      endLine: 0,
      startLine: 0,
      top: 0,
      totalHeight: 0,
    });
  });

  it('returns a bounded initial batch when all heights are zero', () => {
    const heights = new SourceHeightMap(new Array(500).fill(0));

    expect(
      sourceViewport(heights, {
        scrollTop: 100,
        viewportHeight: 500,
      }),
    ).toEqual({
      endLine: SOURCE_VIEWPORT_MAX_LINES,
      startLine: 0,
      top: 0,
      totalHeight: 0,
    });
  });

  it('caps large overscan while retaining the visible range', () => {
    const heights = new SourceHeightMap(new Array(1_000).fill(1));
    const viewport = sourceViewport(heights, {
      maximumLines: 50,
      overscan: 1_000,
      scrollTop: 500,
      viewportHeight: 10,
    });

    expect(viewport.endLine - viewport.startLine).toBe(50);
    expect(viewport.startLine).toBeLessThanOrEqual(500);
    expect(viewport.endLine).toBeGreaterThanOrEqual(510);
    expect(viewport.top).toBe(viewport.startLine);
    expect(viewport.totalHeight).toBe(1_000);
  });

  it('uses a 300-line default ceiling and clamps invalid ceilings', () => {
    const heights = new SourceHeightMap(new Array(1_000).fill(1));

    expect(
      sourceViewport(heights, {
        overscan: 1_000,
        scrollTop: 0,
        viewportHeight: 1_000,
      }).endLine,
    ).toBe(SOURCE_VIEWPORT_MAX_LINES);
    expect(
      sourceViewport(heights, {
        maximumLines: 0,
        overscan: 100,
        scrollTop: 500,
        viewportHeight: 10,
      }),
    ).toMatchObject({
      endLine: 501,
      startLine: 500,
    });
    expect(
      sourceViewport(heights, {
        maximumLines: Number.POSITIVE_INFINITY,
        overscan: 1_000,
        scrollTop: 0,
        viewportHeight: 1_000,
      }).endLine,
    ).toBe(SOURCE_VIEWPORT_MAX_LINES);
  });

  it('normalizes non-finite viewport measurements', () => {
    const heights = new SourceHeightMap([10, 20, 30]);

    expect(
      sourceViewport(heights, {
        overscan: Number.POSITIVE_INFINITY,
        scrollTop: Number.NaN,
        viewportHeight: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({
      endLine: 3,
      startLine: 0,
      top: 0,
      totalHeight: 60,
    });
    expect(
      sourceViewport(heights, {
        overscan: Number.NaN,
        scrollTop: Number.NEGATIVE_INFINITY,
        viewportHeight: Number.NEGATIVE_INFINITY,
      }),
    ).toEqual({
      endLine: 1,
      startLine: 0,
      top: 0,
      totalHeight: 60,
    });
  });

  it('accepts a structural height map and sanitizes malformed results', () => {
    expect(
      sourceViewport(
        {
          indexAtOffset: () => Number.POSITIVE_INFINITY,
          length: 4,
          offsetAtIndex: () => Number.NaN,
          totalHeight: 100,
        },
        {
          scrollTop: 25,
          viewportHeight: 25,
        },
      ),
    ).toEqual({
      endLine: 1,
      startLine: 0,
      top: 0,
      totalHeight: 100,
    });
  });
});
