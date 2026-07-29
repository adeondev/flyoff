import { describe, expect, it } from 'vitest';

import {
  nextGraphemeBoundary,
  previousGraphemeBoundary,
} from '../../src/renderer/projects/source-grapheme';

describe('source grapheme boundaries', () => {
  it('keeps complex Unicode clusters intact inside a line', () => {
    const clusters = ['e\u0301', '👨‍👩‍👧‍👦', '👍🏽', '🇧🇷', 'क्‍ष'];
    const value = `before\n${clusters.join('')} \nafter`;
    let offset = 'before\n'.length;

    for (const cluster of clusters) {
      expect(nextGraphemeBoundary(value, offset)).toBe(
        offset + cluster.length,
      );
      expect(previousGraphemeBoundary(value, offset + cluster.length)).toBe(
        offset,
      );
      offset += cluster.length;
    }
  });

  it('treats normalized line breaks and CRLF as safe boundaries', () => {
    expect(previousGraphemeBoundary('one\ntwo', 4)).toBe(3);
    expect(nextGraphemeBoundary('one\ntwo', 3)).toBe(4);
    expect(previousGraphemeBoundary('one\r\ntwo', 5)).toBe(3);
    expect(nextGraphemeBoundary('one\r\ntwo', 3)).toBe(5);
  });
});
