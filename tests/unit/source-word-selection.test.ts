import { describe, expect, it } from 'vitest';

import {
  expandDoubleClickSelection,
  expandTripleClickSelection,
} from '../../src/renderer/projects/source-word-selection';

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

  it('selects the complete logical line with Markdown and punctuation', () => {
    const line = '**Informação** em 2026-07-16.';
    const source = `Introdução\n${line}\nFim`;
    const lineStart = source.indexOf(line);
    const resolved = expandTripleClickSelection(
      source,
      selection(lineStart + 4, lineStart + 9),
    );

    expect(source.slice(resolved.start, resolved.end)).toBe(line);
    expect(resolved.direction).toBe('forward');
  });

  it('selects a final line without absorbing CRLF separators', () => {
    const line = '[texto](https://flyoff.dev)';
    const source = `Primeira\r\n\r\n${line}`;
    const lineStart = source.indexOf(line);
    const resolved = expandTripleClickSelection(
      source,
      selection(lineStart + 2),
    );

    expect(source.slice(resolved.start, resolved.end)).toBe(line);
  });

  it('preserves the native range on an empty logical line', () => {
    const source = 'Antes\n\nDepois';
    const lineBreak = source.indexOf('\n') + 1;

    expect(
      expandTripleClickSelection(
        source,
        selection(lineBreak, lineBreak + 1),
      ),
    ).toEqual(selection(lineBreak, lineBreak + 1));
  });
});
