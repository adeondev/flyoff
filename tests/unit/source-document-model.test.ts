import { describe, expect, it, vi } from 'vitest';

import {
  createSourceDocumentModel,
  sourceLineIndexAtOffset,
  updateSourceDocumentModel,
} from '../../src/renderer/projects/source-document-model';

describe('source document model', () => {
  it('updates one of 15,000 lines without splitting the document', () => {
    const lines = Array.from(
      { length: 15_000 },
      (_, index) => `line ${index + 1}`,
    );
    const current = createSourceDocumentModel(lines.join('\n'));
    lines[4_999] = 'changed';
    const split = vi.spyOn(String.prototype, 'split');

    try {
      const next = updateSourceDocumentModel(
        current,
        lines.join('\n'),
      );

      expect(split).not.toHaveBeenCalled();
      expect(next.change).toEqual({
        endLine: 5_000,
        full: false,
        previousEndLine: 5_000,
        startLine: 4_999,
      });
      expect(next.lines[0]).toBe(current.lines[0]);
      expect(next.lines[4_998]).toBe(current.lines[4_998]);
      expect(next.lines[4_999]).not.toBe(current.lines[4_999]);
      expect(next.lines[5_000]).toBe(current.lines[5_000]);
      expect(next.lines.at(-1)).toBe(current.lines.at(-1));
    } finally {
      split.mockRestore();
    }
  });

  it('accepts a trusted local hint in the middle of 15,000 lines', () => {
    const source = Array.from(
      { length: 15_000 },
      (_, index) => `line ${index}`,
    ).join('\n');
    const start = source.indexOf('line 7500') + 5;
    const nextSource =
      source.slice(0, start) + 'X' + source.slice(start);
    const current = createSourceDocumentModel(source);
    const next = updateSourceDocumentModel(current, nextSource, {
      nextSelection: { start: start + 1, end: start + 1 },
      previousSelection: { start, end: start },
    });

    expect(next.source).toBe(nextSource);
    expect(next.change).toEqual({
      endLine: 7_501,
      full: false,
      previousEndLine: 7_501,
      startLine: 7_500,
    });
    expect(next.lines[7_499]).toBe(current.lines[7_499]);
    expect(next.lines[7_500]).not.toBe(current.lines[7_500]);
    expect(next.lines[7_501]).toBe(current.lines[7_501]);
  });

  it('falls back safely when a local hint does not describe the change', () => {
    const current = createSourceDocumentModel('one\ntwo\nthree');
    const next = updateSourceDocumentModel(
      current,
      'changed\ntwo\nthree',
      {
        nextSelection: { start: 13, end: 13 },
        previousSelection: { start: 9, end: 9 },
      },
    );

    const rebuilt = createSourceDocumentModel('changed\ntwo\nthree');
    expect(next.source).toBe(rebuilt.source);
    expect(next.lines).toEqual(rebuilt.lines);
    expect(next.lineStarts).toEqual(rebuilt.lineStarts);
    expect(next.lineGraphemeStarts).toEqual(
      rebuilt.lineGraphemeStarts,
    );
  });

  it('updates source and grapheme indexes after a local emoji edit', () => {
    const current = createSourceDocumentModel('one\n🙂x\nthree');
    const next = updateSourceDocumentModel(
      current,
      'one\n🙂🙂x\nthree',
    );

    expect(next.lineStarts).toEqual(new Int32Array([0, 4, 10]));
    expect(next.lineGraphemeStarts).toEqual(new Int32Array([0, 4, 8]));
    expect(next.lines[0]).toBe(current.lines[0]);
    expect(next.lines[1]).not.toBe(current.lines[1]);
    expect(next.lines[2]).toBe(current.lines[2]);
    expect(next.change).toEqual({
      endLine: 2,
      full: false,
      previousEndLine: 2,
      startLine: 1,
    });
  });

  it('counts CRLF as one grapheme in indexed selections', () => {
    const model = createSourceDocumentModel('one\r\ntwo\r\nthree');

    expect(model.lineStarts).toEqual(new Int32Array([0, 5, 10]));
    expect(model.lineGraphemeStarts).toEqual(new Int32Array([0, 4, 8]));

    const updated = updateSourceDocumentModel(
      model,
      'one\r\ntwice\r\nthree',
    );
    expect(updated.lineStarts).toEqual(new Int32Array([0, 5, 12]));
    expect(updated.lineGraphemeStarts).toEqual(new Int32Array([0, 4, 10]));
  });

  it('propagates changed fence metadata without splitting unchanged lines', () => {
    const current = createSourceDocumentModel(
      'before\nplain\nmiddle\nafter',
    );
    const source = 'before\n```\nmiddle\nafter';
    const next = (() => {
      const split = vi.spyOn(String.prototype, 'split');
      try {
        const updated = updateSourceDocumentModel(current, source);
        expect(split).not.toHaveBeenCalled();
        return updated;
      } finally {
        split.mockRestore();
      }
    })();
    const rebuilt = createSourceDocumentModel(source);

    expect(next.lines).toEqual(rebuilt.lines);
    expect(next.lines[0]).toBe(current.lines[0]);
    expect(next.lines[1]).not.toBe(current.lines[1]);
    expect(next.lines[2]).not.toBe(current.lines[2]);
    expect(next.lines[3]).not.toBe(current.lines[3]);
    expect(next.change).toEqual({
      endLine: 4,
      full: false,
      previousEndLine: 4,
      startLine: 1,
    });
  });

  it('propagates fence state only through the changed interval', () => {
    const current = createSourceDocumentModel(
      ['before', 'plain', 'middle', 'plain', 'after'].join('\n'),
    );
    const next = updateSourceDocumentModel(
      current,
      ['before', '```', 'middle', '```', 'after'].join('\n'),
    );

    expect(next.lines[1]?.code).toBe(true);
    expect(next.lines[2]?.code).toBe(true);
    expect(next.lines[3]?.code).toBe(true);
    expect(next.lines[4]).toBe(current.lines[4]);
    expect(next.change).toEqual({
      endLine: 4,
      full: false,
      previousEndLine: 4,
      startLine: 1,
    });
  });

  it('reports distinct old and new intervals for inserted and deleted lines', () => {
    const current = createSourceDocumentModel('one\nthree');
    const inserted = updateSourceDocumentModel(
      current,
      'one\ntwo\nthree',
    );

    expect(inserted.change).toEqual({
      endLine: 2,
      full: false,
      previousEndLine: 1,
      startLine: 1,
    });
    expect(inserted.lines[2]).toBe(current.lines[1]);

    const deleted = updateSourceDocumentModel(
      inserted,
      'one\nthree',
    );
    expect(deleted.change).toEqual({
      endLine: 1,
      full: false,
      previousEndLine: 2,
      startLine: 1,
    });
    expect(deleted.lines[1]).toBe(current.lines[1]);
  });

  it('maps offsets to lines with indexed lookup', () => {
    const model = createSourceDocumentModel('one\ntwo\nthree');

    expect(sourceLineIndexAtOffset(model, 0)).toBe(0);
    expect(sourceLineIndexAtOffset(model, 3)).toBe(0);
    expect(sourceLineIndexAtOffset(model, 4)).toBe(1);
    expect(sourceLineIndexAtOffset(model, model.source.length)).toBe(2);
  });
});
