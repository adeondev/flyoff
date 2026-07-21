import { describe, expect, it } from 'vitest';

import { resolveSourceInput } from '../../src/renderer/projects/source-input';

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
});
