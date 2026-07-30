import { describe, expect, it } from 'vitest';

import {
  applySourceInputMirrorEdit,
  createSourceInputMirror,
  SOURCE_INPUT_MIRROR_MAX_CODE_UNITS,
  sourceSelectionFromMirror,
} from '../../src/renderer/projects/source-engine/source-input-mirror';

describe('source input mirror', () => {
  it('places carets near the center, start and end of the source', () => {
    const source = '0123456789';

    expect(
      createSourceInputMirror(
        source,
        { direction: 'none', end: 5, start: 5 },
        6,
      ),
    ).toMatchObject({
      end: 8,
      selectionEnd: 3,
      selectionMapped: true,
      selectionStart: 3,
      start: 2,
      value: '234567',
    });
    expect(
      createSourceInputMirror(
        source,
        { direction: 'none', end: 0, start: 0 },
        6,
      ),
    ).toMatchObject({
      end: 6,
      selectionEnd: 0,
      selectionStart: 0,
      start: 0,
      value: '012345',
    });
    expect(
      createSourceInputMirror(
        source,
        { direction: 'none', end: 10, start: 10 },
        6,
      ),
    ).toMatchObject({
      end: 10,
      selectionEnd: 6,
      selectionStart: 6,
      start: 4,
      value: '456789',
    });
  });

  it('maps short selections and preserves their direction', () => {
    const mirror = createSourceInputMirror(
      '01234567890123456789',
      { direction: 'backward', end: 8, start: 5 },
      10,
    );

    expect(mirror).toMatchObject({
      end: 10,
      selectionDirection: 'backward',
      selectionEnd: 8,
      selectionMapped: true,
      selectionStart: 5,
      sourceSelection: {
        direction: 'backward',
        end: 8,
        start: 5,
      },
      start: 0,
    });
    expect(
      sourceSelectionFromMirror(mirror, 2, 7, 'forward'),
    ).toEqual({
      direction: 'forward',
      end: 7,
      start: 2,
    });
  });

  it('bounds Ctrl+A around its focus without losing the global selection', () => {
    const source = 'a'.repeat(20_000);
    const mirror = createSourceInputMirror(source, {
      direction: 'forward',
      end: source.length,
      start: 0,
    });

    expect(mirror.value).toHaveLength(
      SOURCE_INPUT_MIRROR_MAX_CODE_UNITS,
    );
    expect(mirror).toMatchObject({
      end: 20_000,
      selectionDirection: 'none',
      selectionEnd: SOURCE_INPUT_MIRROR_MAX_CODE_UNITS,
      selectionMapped: false,
      selectionStart: SOURCE_INPUT_MIRROR_MAX_CODE_UNITS,
      start: 20_000 - SOURCE_INPUT_MIRROR_MAX_CODE_UNITS,
    });
    expect(
      sourceSelectionFromMirror(
        mirror,
        mirror.selectionStart,
        mirror.selectionEnd,
        mirror.selectionDirection,
      ),
    ).toEqual({
      direction: 'forward',
      end: source.length,
      start: 0,
    });
    expect(
      sourceSelectionFromMirror(
        mirror,
        mirror.selectionStart - 1,
        mirror.selectionEnd - 1,
        'none',
      ),
    ).toEqual({
      direction: 'none',
      end: source.length - 1,
      start: source.length - 1,
    });
  });

  it('places a giant backward selection around its leading focus', () => {
    const source = 'a'.repeat(20_000);
    const mirror = createSourceInputMirror(source, {
      direction: 'backward',
      end: source.length,
      start: 0,
    });

    expect(mirror).toMatchObject({
      end: SOURCE_INPUT_MIRROR_MAX_CODE_UNITS,
      selectionEnd: 0,
      selectionMapped: false,
      selectionStart: 0,
      start: 0,
    });
  });

  it('applies insertion and deletion inside a mapped mirror', () => {
    const insertionMirror = createSourceInputMirror('abcdef', {
      direction: 'none',
      end: 3,
      start: 3,
    });

    expect(
      applySourceInputMirrorEdit(
        'abcdef',
        insertionMirror,
        'abcXdef',
        { direction: 'none', end: 4, start: 4 },
      ),
    ).toEqual({
      content: 'abcXdef',
      inserted: 'X',
      selection: { direction: 'none', end: 4, start: 4 },
    });

    const deletionMirror = createSourceInputMirror('abcdef', {
      direction: 'forward',
      end: 4,
      start: 2,
    });
    expect(
      applySourceInputMirrorEdit(
        'abcdef',
        deletionMirror,
        'abef',
        { direction: 'none', end: 2, start: 2 },
      ),
    ).toEqual({
      content: 'abef',
      inserted: '',
      selection: { direction: 'none', end: 2, start: 2 },
    });
  });

  it('replaces the original giant selection on insertion or deletion', () => {
    const source = 'a'.repeat(20_000);
    const mirror = createSourceInputMirror(source, {
      direction: 'forward',
      end: source.length,
      start: 0,
    });

    expect(
      applySourceInputMirrorEdit(
        source,
        mirror,
        `${mirror.value}X`,
        {
          direction: 'none',
          end: mirror.value.length + 1,
          start: mirror.value.length + 1,
        },
      ),
    ).toEqual({
      content: 'X',
      inserted: 'X',
      selection: { direction: 'none', end: 1, start: 1 },
    });
    expect(
      applySourceInputMirrorEdit(
        source,
        mirror,
        mirror.value.slice(0, -1),
        {
          direction: 'none',
          end: mirror.value.length - 1,
          start: mirror.value.length - 1,
        },
      ),
    ).toEqual({
      content: '',
      inserted: '',
      selection: { direction: 'none', end: 0, start: 0 },
    });
  });

  it('supports composition text and local selection ranges', () => {
    const source = 'antes depois';
    const mirror = createSourceInputMirror(source, {
      direction: 'none',
      end: 6,
      start: 6,
    });
    const composed = '漢😀';
    const nextValue = `${mirror.value.slice(0, 6)}${composed}${mirror.value.slice(6)}`;

    expect(
      applySourceInputMirrorEdit(source, mirror, nextValue, {
        direction: 'backward',
        end: 6 + composed.length,
        start: 6,
      }),
    ).toEqual({
      content: `antes ${composed}depois`,
      inserted: composed,
      selection: {
        direction: 'backward',
        end: 6 + composed.length,
        start: 6,
      },
    });
  });

  it('keeps surrogate pairs and CRLF boundaries intact', () => {
    const emojiMirror = createSourceInputMirror(
      'A😀B',
      { direction: 'none', end: 3, start: 3 },
      4,
    );
    expect(
      applySourceInputMirrorEdit('A😀B', emojiMirror, 'A😁B', {
        direction: 'none',
        end: 3,
        start: 3,
      }),
    ).toEqual({
      content: 'A😁B',
      inserted: '😁',
      selection: { direction: 'none', end: 3, start: 3 },
    });

    const crlfMirror = createSourceInputMirror('a\r\nb', {
      direction: 'forward',
      end: 3,
      start: 1,
    });
    expect(crlfMirror).toMatchObject({
      selectionEnd: 2,
      selectionStart: 1,
      value: 'a\nb',
    });
    expect(
      applySourceInputMirrorEdit('a\r\nb', crlfMirror, 'a\nb', {
        direction: 'none',
        end: 2,
        start: 2,
      }),
    ).toEqual({
      content: 'a\r\nb',
      inserted: '',
      selection: { direction: 'none', end: 3, start: 3 },
    });

    const bounded = createSourceInputMirror(
      `aa\r\n😀zz`,
      { direction: 'none', end: 4, start: 4 },
      3,
    );
    expect(bounded.value.length).toBeLessThanOrEqual(3);
    expect(bounded.value.charCodeAt(0)).not.toBe(0x0a);
    expect(bounded.value.charCodeAt(bounded.value.length - 1)).not.toBe(
      0x0d,
    );
    expect(
      isLowSurrogate(bounded.value.charCodeAt(0)),
    ).toBe(false);
    expect(
      isHighSurrogate(
        bounded.value.charCodeAt(bounded.value.length - 1),
      ),
    ).toBe(false);
  });

  it('maps textarea selections across multiple CRLF sequences', () => {
    const source = 'zero\r\none\r\ntwo\r\nthree';
    const normalized = 'zero\none\ntwo\nthree';
    const two = source.indexOf('two');
    const mirror = createSourceInputMirror(source, {
      direction: 'none',
      end: two,
      start: two,
    });

    expect(mirror.value).toBe(normalized);
    expect(mirror.selectionStart).toBe(normalized.indexOf('two'));
    expect(mirror.selectionEnd).toBe(normalized.indexOf('two'));
    expect(
      sourceSelectionFromMirror(
        mirror,
        normalized.indexOf('one'),
        normalized.indexOf('three'),
        'forward',
      ),
    ).toEqual({
      direction: 'forward',
      end: source.indexOf('three'),
      start: source.indexOf('one'),
    });
  });

  it('preserves untouched CRLF and maps insertion and newline deletion', () => {
    const source = 'a\r\nb\r\nc';
    const caret = source.indexOf('b');
    const insertionMirror = createSourceInputMirror(source, {
      direction: 'none',
      end: caret,
      start: caret,
    });
    const insertedValue =
      insertionMirror.value.slice(0, insertionMirror.selectionStart) +
      '字' +
      insertionMirror.value.slice(insertionMirror.selectionEnd);

    expect(
      applySourceInputMirrorEdit(source, insertionMirror, insertedValue, {
        direction: 'none',
        end: insertionMirror.selectionStart + 1,
        start: insertionMirror.selectionStart + 1,
      }),
    ).toEqual({
      content: 'a\r\n字b\r\nc',
      inserted: '字',
      selection: {
        direction: 'none',
        end: caret + 1,
        start: caret + 1,
      },
    });

    const deletionMirror = createSourceInputMirror(source, {
      direction: 'none',
      end: source.length,
      start: source.length,
    });
    expect(
      applySourceInputMirrorEdit(source, deletionMirror, 'a\nbc', {
        direction: 'none',
        end: 3,
        start: 3,
      }),
    ).toEqual({
      content: 'a\r\nbc',
      inserted: '',
      selection: { direction: 'none', end: 4, start: 4 },
    });
  });

  it('edits the correct global offset in a bounded CRLF window', () => {
    const source = Array.from(
      { length: 3_000 },
      (_, index) => `line ${index}`,
    ).join('\r\n');
    const target = source.indexOf('line 2500');
    const mirror = createSourceInputMirror(source, {
      direction: 'none',
      end: target,
      start: target,
    });
    const nextValue =
      mirror.value.slice(0, mirror.selectionStart) +
      'X' +
      mirror.value.slice(mirror.selectionEnd);

    expect(mirror.start).toBeGreaterThan(0);
    expect(mirror.value).not.toContain('\r');
    expect(
      applySourceInputMirrorEdit(source, mirror, nextValue, {
        direction: 'none',
        end: mirror.selectionStart + 1,
        start: mirror.selectionStart + 1,
      }),
    ).toEqual({
      content: `${source.slice(0, target)}X${source.slice(target)}`,
      inserted: 'X',
      selection: {
        direction: 'none',
        end: target + 1,
        start: target + 1,
      },
    });
  });

  it('keeps Ctrl+A global and replaces it through CRLF composition', () => {
    const source = Array.from(
      { length: 5_000 },
      (_, index) => `line ${index}`,
    ).join('\r\n');
    const mirror = createSourceInputMirror(source, {
      direction: 'forward',
      end: source.length,
      start: 0,
    });

    expect(mirror.selectionMapped).toBe(false);
    expect(mirror.value).not.toContain('\r');
    expect(mirror.value.length).toBeLessThanOrEqual(
      SOURCE_INPUT_MIRROR_MAX_CODE_UNITS,
    );
    expect(
      sourceSelectionFromMirror(
        mirror,
        mirror.selectionStart,
        mirror.selectionEnd,
        mirror.selectionDirection,
      ),
    ).toEqual({
      direction: 'forward',
      end: source.length,
      start: 0,
    });

    const composed =
      mirror.value.slice(0, mirror.selectionStart) +
      '漢字' +
      mirror.value.slice(mirror.selectionEnd);
    expect(
      applySourceInputMirrorEdit(source, mirror, composed, {
        direction: 'none',
        end: mirror.selectionStart + 2,
        start: mirror.selectionStart + 2,
      }),
    ).toEqual({
      content: '漢字',
      inserted: '漢字',
      selection: { direction: 'none', end: 2, start: 2 },
    });
  });

  it('clamps invalid selections and enforces the hard buffer ceiling', () => {
    const source = 'a'.repeat(20_000);
    const mirror = createSourceInputMirror(
      source,
      {
        direction: 'backward',
        end: Number.POSITIVE_INFINITY,
        start: Number.NEGATIVE_INFINITY,
      },
      100_000,
    );

    expect(mirror.value.length).toBe(
      SOURCE_INPUT_MIRROR_MAX_CODE_UNITS,
    );
    expect(mirror.sourceSelection).toEqual({
      direction: 'backward',
      end: source.length,
      start: 0,
    });
  });

  it('does not turn an unchanged giant mirror into a deletion', () => {
    const source = 'a'.repeat(20_000);
    const mirror = createSourceInputMirror(source, {
      direction: 'forward',
      end: source.length,
      start: 0,
    });

    expect(
      applySourceInputMirrorEdit(
        source,
        mirror,
        mirror.value,
        {
          direction: mirror.selectionDirection,
          end: mirror.selectionEnd,
          start: mirror.selectionStart,
        },
      ),
    ).toEqual({
      content: source,
      inserted: '',
      selection: mirror.sourceSelection,
    });
  });
});

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
