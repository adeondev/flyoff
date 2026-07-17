import { describe, expect, it } from 'vitest';

import { expandDoubleClickSelection } from '../../src/renderer/projects/source-word-selection';

function selection(start: number, end = start) {
  return { start, end, direction: start === end ? 'none' as const : 'forward' as const };
}

describe('source word selection', () => {
  it('selects a complete Unicode word from a partial native range', () => {
    const source = 'Antes informação42 depois';
    const start = source.indexOf('mação');

    expect(expandDoubleClickSelection(source, selection(start, start + 3))).toEqual({
      start: source.indexOf('informação42'),
      end: source.indexOf('informação42') + 'informação42'.length,
      direction: 'forward',
    });
  });

  it('keeps identifiers and joined words together', () => {
    for (const source of ['minha_variavel42', 'guarda-chuva', 'd’água']) {
      expect(
        source.slice(
          expandDoubleClickSelection(source, selection(2, 4)).start,
          expandDoubleClickSelection(source, selection(2, 4)).end,
        ),
      ).toBe(source);
    }
  });

  it('selects complete numeric clusters used by dates and decimals', () => {
    for (const source of ['2026-07-16', '1.234,56', '10:42:09', '127.0.0.1']) {
      const joiner = source.search(/[.,:/-]/u);
      const resolved = expandDoubleClickSelection(
        source,
        selection(joiner, joiner + 1),
      );
      expect(source.slice(resolved.start, resolved.end)).toBe(source);
    }
  });

  it('does not absorb surrounding Markdown punctuation or whitespace', () => {
    const source = '**palavra** (2026-07-16).';
    const word = expandDoubleClickSelection(source, selection(4, 6));
    const numberStart = source.indexOf('2026');
    const number = expandDoubleClickSelection(
      source,
      selection(numberStart + 1, numberStart + 2),
    );

    expect(source.slice(word.start, word.end)).toBe('palavra');
    expect(source.slice(number.start, number.end)).toBe('2026-07-16');
  });

  it('preserves a native punctuation selection', () => {
    expect(expandDoubleClickSelection('a ** b', selection(2, 4))).toEqual(
      selection(2, 4),
    );
  });
});
