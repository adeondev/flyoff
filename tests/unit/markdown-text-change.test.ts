import { describe, expect, it } from 'vitest';

import {
  commonPrefixLength,
  commonSuffixLength,
  markdownTextChange,
} from '../../src/renderer/projects/markdown-text-change';

function characterChange(previous: string, next: string) {
  let start = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  ) {
    start += 1;
  }
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  return { nextEnd, previousEnd, start };
}

describe('markdown text change', () => {
  it('reports the inserted range for a local edit', () => {
    expect(markdownTextChange('one two three', 'one dois two three')).toEqual({
      nextEnd: 9,
      previousEnd: 4,
      start: 4,
    });
  });

  it('reports an empty range for identical documents', () => {
    const change = markdownTextChange('same', 'same');

    expect(change.start).toBe(4);
    expect(change.previousEnd).toBe(4);
    expect(change.nextEnd).toBe(4);
  });

  it('never lets an end fall before the common prefix', () => {
    const change = markdownTextChange('aaaa', 'aa');

    expect(change.previousEnd).toBeGreaterThanOrEqual(change.start);
    expect(change.nextEnd).toBeGreaterThanOrEqual(change.start);
  });

  it('agrees with a per-character scan across a chunk boundary', () => {
    // The chunked comparison must land on the same offsets as the naive scan
    // it replaced, including when the edit sits exactly on a block edge.
    const filler = 'x'.repeat(2_048);
    for (const offset of [0, 2_047, 2_048, 2_049, 4_096]) {
      const previous = `${filler}${filler}${filler}`;
      const next = `${previous.slice(0, offset)}Z${previous.slice(offset)}`;

      expect(markdownTextChange(previous, next)).toEqual(
        characterChange(previous, next),
      );
    }
  });

  it('agrees with a per-character scan when a deletion spans chunks', () => {
    const previous = `head${'ab'.repeat(3_000)}tail`;
    const next = `head${'ab'.repeat(1_000)}tail`;

    expect(markdownTextChange(previous, next)).toEqual(
      characterChange(previous, next),
    );
  });

  it('measures prefixes and suffixes independently', () => {
    expect(commonPrefixLength('abcdef', 'abcxyz')).toBe(3);
    expect(commonSuffixLength('abcdef', 'xyzdef', 3)).toBe(3);
  });

  it('honours the suffix bound so ranges cannot overlap', () => {
    expect(commonSuffixLength('aaaa', 'aaaa', 2)).toBe(2);
    expect(commonSuffixLength('aaaa', 'aaaa', -5)).toBe(0);
  });

  it('finds a change at the very end without scanning from the front', () => {
    const previous = `${'linha\n'.repeat(5_000)}fim`;
    const next = `${'linha\n'.repeat(5_000)}fim!`;

    expect(markdownTextChange(previous, next)).toEqual(
      characterChange(previous, next),
    );
  });
});
