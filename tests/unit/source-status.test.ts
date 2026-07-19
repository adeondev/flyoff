import { describe, expect, it } from 'vitest';

import { sourcePositionStatus } from '../../src/renderer/projects/source-status';

describe('source position status', () => {
  it('reports one-based line and grapheme column', () => {
    expect(
      sourcePositionStatus('one\n😀x', {
        start: 7,
        end: 7,
        direction: 'none',
      }),
    ).toEqual({ line: 2, column: 3, selected: 0 });
  });

  it('counts multiline selections by grapheme and follows the selection focus', () => {
    expect(
      sourcePositionStatus('a😀\nxy', {
        start: 1,
        end: 6,
        direction: 'backward',
      }),
    ).toEqual({ line: 1, column: 2, selected: 4 });
  });
});
