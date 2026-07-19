import { describe, expect, it } from 'vitest';

import {
  createSourceDocumentModel,
  sourceLineIndexAtOffset,
  updateSourceDocumentModel,
} from '../../src/renderer/projects/source-document-model';

describe('source document model', () => {
  it('reuses every untouched record in a ten-thousand-line note', () => {
    const lines = Array.from(
      { length: 10_000 },
      (_, index) => `line ${index + 1}`,
    );
    const current = createSourceDocumentModel(lines.join('\n'));
    lines[4_999] = 'changed';

    const next = updateSourceDocumentModel(current, lines.join('\n'));

    expect(next.change).toEqual({
      endLine: 5_000,
      full: false,
      startLine: 4_999,
    });
    expect(next.lines[0]).toBe(current.lines[0]);
    expect(next.lines[4_998]).toBe(current.lines[4_998]);
    expect(next.lines[4_999]).not.toBe(current.lines[4_999]);
    expect(next.lines[5_000]).toBe(current.lines[5_000]);
    expect(next.lines.at(-1)).toBe(current.lines.at(-1));
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
      startLine: 1,
    });
  });

  it('maps offsets to lines with indexed lookup', () => {
    const model = createSourceDocumentModel('one\ntwo\nthree');

    expect(sourceLineIndexAtOffset(model, 0)).toBe(0);
    expect(sourceLineIndexAtOffset(model, 3)).toBe(0);
    expect(sourceLineIndexAtOffset(model, 4)).toBe(1);
    expect(sourceLineIndexAtOffset(model, model.source.length)).toBe(2);
  });
});
