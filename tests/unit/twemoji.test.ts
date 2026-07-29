import { describe, expect, it } from 'vitest';

import {
  twemojiAssetUrl,
  twemojiSegments,
} from '../../src/renderer/components/twemoji';

describe('Twemoji segmentation', () => {
  it('preserves UTF-16 text while identifying complete emoji sequences', () => {
    const value = 'A 👨‍👩‍👧‍👦 🇧🇷 1️⃣ 👋🏽 Z';
    const segments = twemojiSegments(value);

    expect(segments.map(({ text }) => text).join('')).toBe(value);
    expect(
      segments.flatMap(({ emoji }) => (emoji ? [emoji] : [])),
    ).toEqual(['👨‍👩‍👧‍👦', '🇧🇷', '1️⃣', '👋🏽']);
    expect(
      segments
        .filter(({ codepoint }) => codepoint)
        .every(({ codepoint }) =>
          twemojiAssetUrl(codepoint!)?.endsWith(`${codepoint}.svg`),
        ),
    ).toBe(true);
  });

  it('rejects asset names that are not canonical Twemoji code points', () => {
    expect(twemojiAssetUrl('../1f600')).toBeNull();
    expect(twemojiAssetUrl('1F600')).toBeNull();
    expect(twemojiAssetUrl('1f600.svg')).toBeNull();
  });

  it('leaves unsupported code points as native Unicode text', () => {
    const unsupported = '\u{10FFFF}';

    expect(twemojiSegments(unsupported)).toEqual([{ text: unsupported }]);
  });

  it('does not retain multi-megabyte text in the segment cache', () => {
    const value = 'a'.repeat(4 * 1024 * 1024 + 1);

    expect(twemojiSegments(value)).not.toBe(twemojiSegments(value));
  });
});
