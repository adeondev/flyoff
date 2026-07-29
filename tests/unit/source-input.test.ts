import { describe, expect, it } from 'vitest';

import {
  nextSourceWordEndBoundary,
  nextSourceWordStartBoundary,
  previousSourceWordNavigationBoundary,
  resolveSourceInput,
} from '../../src/renderer/projects/source-input';

function state(content: string, start: number, end = start) {
  return {
    content,
    selection: {
      start,
      end,
      direction: start === end ? ('none' as const) : ('forward' as const),
    },
  };
}

describe('deterministic source input', () => {
  it('removes consecutive empty lines one Backspace at a time', () => {
    const first = resolveSourceInput(
      state('a\n\n', 3),
      'deleteContentBackward',
    );
    expect(first).toEqual(state('a\n', 2));
    expect(resolveSourceInput(first!, 'deleteContentBackward')).toEqual(
      state('a', 1),
    );
  });

  it('deletes a complete grapheme instead of splitting emoji', () => {
    expect(
      resolveSourceInput(state('a👨‍👩‍👧‍👦b', 12), 'deleteContentBackward'),
    ).toEqual(state('ab', 1));
  });

  it('replaces selections and supports word and line deletion', () => {
    expect(resolveSourceInput(state('one two', 4, 7), 'insertText', 'x')).toEqual(
      state('one x', 5),
    );
    expect(
      resolveSourceInput(state('one two', 7), 'deleteWordBackward'),
    ).toEqual(state('one ', 4));
    expect(
      resolveSourceInput(state('one\ntwo', 7), 'deleteSoftLineBackward'),
    ).toEqual(state('one\n', 4));
    expect(
      resolveSourceInput(
        state('one\ntwo\nthree', 5),
        'deleteEntireSoftLine',
      ),
    ).toEqual(state('one\nthree', 4));
  });

  it('deletes Unicode words and whitespace runs without splitting code points', () => {
    const word = 'café\u0301_𐐷42';
    const content = `head\n${word} tail`;
    const start = content.indexOf(word);
    const end = start + word.length;

    expect(
      resolveSourceInput(state(content, end), 'deleteWordBackward'),
    ).toEqual(state('head\n tail', start));
    expect(
      resolveSourceInput(state(content, start), 'deleteWordForward'),
    ).toEqual(state('head\n tail', start));
    expect(
      resolveSourceInput(
        state('one \n\t\u00a0two', 'one \n\t\u00a0'.length),
        'deleteWordBackward',
      ),
    ).toEqual(state('onetwo', 3));
  });

  it('keeps word deletion exact in a 20k-line source', () => {
    const lines = Array.from(
      { length: 20_000 },
      (_, index) => `line ${index} conteúdo`,
    );
    const content = lines.join('\n');
    const marker = 'line 10000 conteúdo';
    const end = content.indexOf(marker) + marker.length;
    const resolved = resolveSourceInput(
      state(content, end),
      'deleteWordBackward',
    );
    const caret = end - 'conteúdo'.length;

    expect(resolved?.selection).toEqual(state('', caret).selection);
    expect(resolved?.content.slice(caret - 1, caret + 2)).toBe(' \nl');
    expect(resolved?.content.split('\n')).toHaveLength(20_000);
  });

  it('resolves platform word navigation across Unicode line boundaries', () => {
    const content = 'one café_𐐷42\nthree';
    const secondLine = content.indexOf('three');

    expect(previousSourceWordNavigationBoundary(content, secondLine)).toBe(4);
    expect(nextSourceWordStartBoundary(content, 4)).toBe(secondLine);
    expect(nextSourceWordEndBoundary(content, 4)).toBe(
      4 + 'café_𐐷42'.length,
    );
  });
});
