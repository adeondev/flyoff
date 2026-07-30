import { describe, expect, it } from 'vitest';

import { createSourceDocumentModel } from '../../src/renderer/projects/source-document-model';
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

  it('uses the document index without losing grapheme accuracy', () => {
    const content = 'first\nA 👨‍👩‍👧‍👦 B\nlast';
    const model = createSourceDocumentModel(content);
    const start = content.indexOf('A');
    const end = content.indexOf('\nlast');

    expect(
      sourcePositionStatus(
        content,
        { start, end, direction: 'none' },
        model,
      ),
    ).toEqual({ line: 2, column: 6, selected: 5 });
  });

  it('matches full grapheme counting across CRLF line breaks', () => {
    const content = 'one\r\ntwo\r\nthree';
    const model = createSourceDocumentModel(content);
    const selection = {
      direction: 'forward' as const,
      start: 0,
      end: content.indexOf('three'),
    };

    expect(sourcePositionStatus(content, selection, model)).toEqual(
      sourcePositionStatus(content, selection),
    );
    expect(sourcePositionStatus(content, selection, model).selected).toBe(8);
  });
});
