import { describe, expect, it } from 'vitest';

import {
  createSourceLineIndex,
  replaceSourceLineIndex,
  sourceLineIndexAtIndexedOffset,
} from '../../src/renderer/projects/source-line-index';

describe('source line index', () => {
  it('keeps native readonly-array behavior across multiple blocks', () => {
    const starts = Array.from({ length: 1_000 }, (_, index) => index * 10);
    const indexed = createSourceLineIndex(starts);

    expect(Array.isArray(indexed)).toBe(true);
    expect(indexed).toHaveLength(starts.length);
    expect(indexed[511]).toBe(starts[511]);
    expect(indexed.at(-1)).toBe(starts.at(-1));
    expect(indexed.slice(252, 260)).toEqual(starts.slice(252, 260));
    expect([...indexed]).toEqual(starts);
  });

  it('replaces boundary ranges and shifts only the preserved suffix', () => {
    const starts = Array.from({ length: 1_000 }, (_, index) => index * 10);
    const indexed = createSourceLineIndex(starts);
    const inserted = [2_550, 2_555, 2_560];
    const next = replaceSourceLineIndex(
      indexed,
      255,
      3,
      inserted,
      5,
    );
    const expected = [
      ...starts.slice(0, 255),
      ...inserted,
      ...starts.slice(258).map((value) => value + 5),
    ];

    expect(next).toBeDefined();
    expect([...(next ?? [])]).toEqual(expected);
    expect(sourceLineIndexAtIndexedOffset(next!, 2_554)).toBe(255);
    expect(sourceLineIndexAtIndexedOffset(next!, 2_555)).toBe(256);
    expect(sourceLineIndexAtIndexedOffset(next!, 9_995)).toBe(999);
  });

  it('stays exact across repeated growth, shrink and cross-block edits', () => {
    let seed = 0x31f4a7c1;
    const random = (maximum: number): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return maximum === 0 ? 0 : seed % maximum;
    };
    let expected = Array.from({ length: 800 }, (_, index) => index * 7);
    let indexed = createSourceLineIndex(expected);

    for (let edit = 0; edit < 1_000; edit += 1) {
      const start = random(expected.length + 1);
      const removed = random(
        Math.min(12, expected.length - start) + 1,
      );
      const inserted = Array.from(
        { length: random(8) },
        () => random(100_000) - 50_000,
      );
      const delta = random(31) - 15;
      expected = [
        ...expected.slice(0, start),
        ...inserted,
        ...expected
          .slice(start + removed)
          .map((value) => value + delta),
      ];
      indexed = replaceSourceLineIndex(
        indexed,
        start,
        removed,
        inserted,
        delta,
      )!;
    }

    expect([...indexed]).toEqual(expected);
  });

  it('keeps offset lookup exact through three thousand document splices', () => {
    let seed = 0xc001d00d;
    const random = (maximum: number): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return maximum === 0 ? 0 : seed % maximum;
    };
    const widths = Array.from(
      { length: 10_000 },
      () => random(48) + 1,
    );
    let documentLength = widths.reduce(
      (total, width) => total + width,
      0,
    );
    let expected: number[] = [];
    let offset = 0;
    for (const width of widths) {
      expected.push(offset);
      offset += width;
    }
    let indexed = createSourceLineIndex(expected);

    for (let edit = 0; edit < 3_000; edit += 1) {
      const start = random(expected.length);
      const removed =
        random(Math.min(12, expected.length - start)) + 1;
      const insertedWidths = Array.from(
        { length: random(8) + 1 },
        () => random(48) + 1,
      );
      const regionStart = expected[start]!;
      const regionEnd =
        expected[start + removed] ?? documentLength;
      const inserted: number[] = [];
      let nextOffset = regionStart;
      for (const width of insertedWidths) {
        inserted.push(nextOffset);
        nextOffset += width;
      }
      const delta = nextOffset - regionEnd;
      expected = [
        ...expected.slice(0, start),
        ...inserted,
        ...expected
          .slice(start + removed)
          .map((value) => value + delta),
      ];
      documentLength += delta;
      indexed = replaceSourceLineIndex(
        indexed,
        start,
        removed,
        inserted,
        delta,
      )!;

      for (let sample = 0; sample < 8; sample += 1) {
        const target = random(documentLength + 1);
        let low = 0;
        let high = expected.length - 1;
        while (low <= high) {
          const middle = (low + high) >>> 1;
          if (expected[middle]! <= target) {
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }
        expect(
          sourceLineIndexAtIndexedOffset(indexed, target),
        ).toBe(Math.max(0, high));
      }
      if (edit % 100 === 0) {
        expect([...indexed]).toEqual(expected);
      }
    }

    expect([...indexed]).toEqual(expected);
  });

  it('rejects replacements for unindexed or invalid arrays', () => {
    const indexed = createSourceLineIndex([0, 4, 8]);

    expect(
      replaceSourceLineIndex([0, 4, 8], 1, 1, [5], 1),
    ).toBeUndefined();
    expect(
      replaceSourceLineIndex(indexed, 2, 2, [5], 1),
    ).toBeUndefined();
  });
});
