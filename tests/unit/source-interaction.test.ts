import { describe, expect, it } from 'vitest';

import { resolveSourceHorizontalNavigation } from '../../src/renderer/projects/source-interaction';

function caret(offset: number) {
  return {
    direction: 'none' as const,
    end: offset,
    start: offset,
  };
}

describe('source horizontal navigation', () => {
  for (const emoji of ['😀', '👋🏽', '🇧🇷', '1️⃣', '👨‍👩‍👧‍👦']) {
    it(`crosses ${emoji} as one logical character`, () => {
      const content = `a${emoji}b`;
      const before = 1;
      const after = before + emoji.length;

      expect(
        resolveSourceHorizontalNavigation(
          content,
          caret(before),
          1,
          false,
        ),
      ).toEqual(caret(after));
      expect(
        resolveSourceHorizontalNavigation(
          content,
          caret(after),
          -1,
          false,
        ),
      ).toEqual(caret(before));
    });
  }

  it('extends a selection across an entire emoji', () => {
    const emoji = '👨‍👩‍👧‍👦';
    const content = `a${emoji}b`;

    expect(
      resolveSourceHorizontalNavigation(content, caret(1), 1, true),
    ).toEqual({
      direction: 'forward',
      start: 1,
      end: 1 + emoji.length,
    });
  });

  it('escapes a source emoji wrapper without another invisible stop', () => {
    const content = 'a😀b';

    expect(
      resolveSourceHorizontalNavigation(content, caret(3), 1, false, true),
    ).toEqual(caret(4));
    expect(
      resolveSourceHorizontalNavigation(content, caret(1), -1, false, true),
    ).toEqual(caret(0));
  });

  it('leaves ordinary horizontal navigation to the browser', () => {
    expect(
      resolveSourceHorizontalNavigation('abc', caret(1), 1, false),
    ).toBeUndefined();
  });
});
