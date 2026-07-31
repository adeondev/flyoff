import { beforeEach, describe, expect, it } from 'vitest';

import {
  createSourceDocumentModel,
  sourceTextReader,
} from '../../src/renderer/projects/source-document-model';
import {
  editedCharCodeAt,
  editedLength,
  resetSourceDocumentText,
  sliceEditedDocument,
  sourceDocumentTextDiagnostics,
  spliceSourceDocument,
} from '../../src/renderer/projects/source-engine/source-document-text';

function document(lines = 200): string {
  return Array.from(
    { length: lines },
    (_, index) => `Linha ${index}: acentuação, emoji 🙂 e texto corrido.`,
  ).join('\n');
}

describe('source document text', () => {
  beforeEach(() => {
    resetSourceDocumentText();
  });

  it('produces the same text a slice and concatenation would', () => {
    let text = document();
    let source = text;
    const random = (() => {
      let seed = 99;
      return () => {
        seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
        return seed / 0x1_0000_0000;
      };
    })();

    for (let step = 0; step < 400; step += 1) {
      const from = Math.floor(random() * text.length);
      const to = Math.min(text.length, from + Math.floor(random() * 4));
      const insert = random() < 0.3 ? '' : ['a', 'çã', '🙂', ' x'][step % 4]!;
      const expected = text.slice(0, from) + insert + text.slice(to);
      source = spliceSourceDocument(source, from, to, insert);
      expect(source).toBe(expected);
      text = expected;
    }
  });

  it('rebuilds only the edited region while typing stays on one line', () => {
    const text = document();
    const caret = text.indexOf('Linha 100');
    let source = spliceSourceDocument(text, caret + 3, caret + 3, 'x');
    const rebasesAfterFirst = sourceDocumentTextDiagnostics.rebases;

    for (let step = 0; step < 200; step += 1) {
      source = spliceSourceDocument(source, caret + 3, caret + 3, 'y');
    }

    // The first call has to establish the pieces; nothing after it may.
    expect(sourceDocumentTextDiagnostics.rebases).toBe(rebasesAfterFirst);
    expect(sourceDocumentTextDiagnostics.splices).toBe(201);
    expect(source.slice(caret, caret + 210)).toBe(
      `Lin${'y'.repeat(200)}xha 100`,
    );
  });

  it('re-bases when the edit leaves the region it was holding', () => {
    const text = document();
    let source = spliceSourceDocument(text, 10, 10, 'a');
    const first = sourceDocumentTextDiagnostics.rebases;
    const expected =
      `${text.slice(0, 10)}a${text.slice(10)}`.slice(0, text.length - 4) +
      'b' +
      text.slice(text.length - 5);
    source = spliceSourceDocument(
      source,
      source.length - 5,
      source.length - 5,
      'b',
    );
    expect(sourceDocumentTextDiagnostics.rebases).toBe(first + 1);
    expect(source).toBe(expected);
  });

  it('reads the edited document without building it', () => {
    const text = 'alfa\nbeta\ngama';
    const from = 5;
    const to = 9;
    const insert = 'X🙂';
    const expected = text.slice(0, from) + insert + text.slice(to);

    expect(editedLength(text, from, to, insert)).toBe(expected.length);
    for (let offset = 0; offset < expected.length; offset += 1) {
      expect(editedCharCodeAt(text, from, to, insert, offset)).toBe(
        expected.charCodeAt(offset),
      );
    }
    for (let start = 0; start <= expected.length; start += 1) {
      for (let end = start; end <= expected.length; end += 1) {
        expect(
          sliceEditedDocument(text, from, to, insert, start, end),
        ).toBe(expected.slice(start, end));
      }
    }
  });
});

describe('source text reader', () => {
  it('answers characters and windows exactly as the document string does', () => {
    for (const text of [
      'alfa\nbeta\ngama',
      'só uma linha',
      '',
      'linha\n\nvazia no meio\n',
      document(60),
    ]) {
      const model = createSourceDocumentModel(text);
      const reader = sourceTextReader(model);

      expect(reader.length).toBe(text.length);
      for (let offset = 0; offset < text.length; offset += 1) {
        expect(reader.charCodeAt(offset)).toBe(text.charCodeAt(offset));
      }
      const probes = [0, 1, 5, 13, 40, text.length - 1, text.length];
      for (const start of probes) {
        for (const end of probes) {
          expect(reader.slice(start, end)).toBe(
            text.slice(Math.max(0, start), Math.max(0, end)),
          );
        }
      }
    }
  });
});
