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

  it('updates a localized edit without rebuilding offsets for every line', () => {
    const lines = Array.from(
      { length: 20_000 },
      (_, index) => `line ${String(index).padStart(5, '0')}`,
    );
    const source = lines.join('\n');
    const current = createSourceDocumentModel(source);
    const line = 10_000;
    const from = current.lineStarts[line]! + 5;
    const insert = ' extended';
    const nextSource =
      source.slice(0, from) + insert + source.slice(from);

    const next = updateSourceDocumentModel(current, nextSource, {
      from,
      insert,
      to: from,
    });

    expect(next.change).toEqual({
      endLine: line + 1,
      full: false,
      startLine: line,
    });
    expect(next.lines[line]?.source).toBe(`line  extended10000`);
    expect(next.lines[line - 1]).toBe(current.lines[line - 1]);
    expect(next.lines[line + 1]).toBe(current.lines[line + 1]);
    expect(next.lineStarts[line]).toBe(current.lineStarts[line]);
    expect(next.lineStarts[line + 1]).toBe(
      current.lineStarts[line + 1]! + insert.length,
    );
    expect(current.lineStarts[line + 1]).toBe(
      current.lineStarts[line]! + current.lines[line]!.source.length + 1,
    );
    expect(sourceLineIndexAtOffset(next, next.lineStarts[line + 1]!)).toBe(
      line + 1,
    );
    expect(Array.isArray(next.lineStarts)).toBe(true);
    expect(next.lineStarts.slice(line, line + 2)).toEqual([
      next.lineStarts[line],
      next.lineStarts[line + 1],
    ]);
  });

  it('splices localized line offsets when newlines are inserted and removed', () => {
    const current = createSourceDocumentModel('zero\none\ntwo\nthree');
    const from = current.lineStarts[1]! + 1;
    const inserted = 'A\nB';
    const withNewline =
      current.source.slice(0, from) +
      inserted +
      current.source.slice(from + 2);
    const expanded = updateSourceDocumentModel(current, withNewline, {
      from,
      insert: inserted,
      to: from + 2,
    });

    expect(expanded.lines.map((line) => line.source)).toEqual([
      'zero',
      'oA',
      'B',
      'two',
      'three',
    ]);
    expect([...expanded.lineStarts]).toEqual([0, 5, 8, 10, 14]);

    const joinFrom = expanded.lineStarts[1]! + 2;
    const collapsedSource =
      expanded.source.slice(0, joinFrom) +
      expanded.source.slice(joinFrom + 1);
    const collapsed = updateSourceDocumentModel(
      expanded,
      collapsedSource,
      { from: joinFrom, insert: '', to: joinFrom + 1 },
    );

    expect(collapsed.lines.map((line) => line.source)).toEqual([
      'zero',
      'oAB',
      'two',
      'three',
    ]);
    expect([...collapsed.lineStarts]).toEqual([0, 5, 9, 13]);
  });

  it('falls back safely when a localized change does not describe the result', () => {
    const current = createSourceDocumentModel('one\ntwo\nthree');
    const next = updateSourceDocumentModel(
      current,
      'one\nchanged\nthree',
      { from: 4, insert: 'incorrect', to: 7 },
    );

    expect(next.lines.map((line) => line.source)).toEqual([
      'one',
      'changed',
      'three',
    ]);
    expect([...next.lineStarts]).toEqual([0, 4, 12]);
  });

  it('falls back when an otherwise valid splice omits a distant edit', () => {
    const lines = Array.from(
      { length: 200 },
      (_, index) => `line ${String(index).padStart(3, '0')}`,
    );
    const current = createSourceDocumentModel(lines.join('\n'));
    const from = current.lineStarts[10]! + 5;
    lines[10] = 'line X10';
    lines[150] = 'line Y50';
    const source = lines.join('\n');
    const next = updateSourceDocumentModel(current, source, {
      from,
      insert: 'X',
      to: from + 1,
    });
    const rebuilt = createSourceDocumentModel(source);

    expect(next.lines).toEqual(rebuilt.lines);
    expect([...next.lineStarts]).toEqual([...rebuilt.lineStarts]);
    expect(next.lines[150]?.source).toBe('line Y50');
  });

  it('matches a full rebuild across mixed localized edits', () => {
    let seed = 0x51f15e;
    const random = (maximum: number): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return maximum === 0 ? 0 : seed % maximum;
    };
    const inserts = ['x', '\n', '**bold**', '', '```\ncode\n```'] as const;
    let source = 'alpha\nbeta\n```\ncode\n```\nomega';
    let localized = createSourceDocumentModel(source);

    for (let edit = 0; edit < 200; edit += 1) {
      const from = random(source.length + 1);
      const to = from + random(Math.min(8, source.length - from) + 1);
      const insert = inserts[random(inserts.length)]!;
      const nextSource =
        source.slice(0, from) + insert + source.slice(to);
      localized = updateSourceDocumentModel(localized, nextSource, {
        from,
        insert,
        to,
      });
      const rebuilt = createSourceDocumentModel(nextSource);

      expect(localized.lines).toEqual(rebuilt.lines);
      expect([...localized.lineStarts]).toEqual([...rebuilt.lineStarts]);
      for (let sample = 0; sample < 5; sample += 1) {
        const offset = random(nextSource.length + 1);
        expect(sourceLineIndexAtOffset(localized, offset)).toBe(
          sourceLineIndexAtOffset(rebuilt, offset),
        );
      }
      source = nextSource;
    }
  });

  it('matches a rebuild through CRLF, Unicode and fence fuzz', () => {
    let seed = 0xa11ce5ed;
    const random = (maximum: number): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return maximum === 0 ? 0 : seed % maximum;
    };
    const inserts = [
      '',
      '\n',
      '\r\n',
      'β',
      '👩‍💻',
      '```\nconst π = 3;\n```',
      '~~~ts\r\nsatélite 🛰️\r\n~~~',
      '**forte**',
    ] as const;
    let source =
      'alpha\r\nβeta\n```\r\nconst π = 1;\n```\nomega 👩‍💻';
    let localized = createSourceDocumentModel(source);

    for (let edit = 0; edit < 1_500; edit += 1) {
      const from = random(source.length + 1);
      const to =
        from + random(Math.min(16, source.length - from) + 1);
      const insert = inserts[random(inserts.length)]!;
      const nextSource =
        source.slice(0, from) + insert + source.slice(to);
      localized = updateSourceDocumentModel(localized, nextSource, {
        from,
        insert,
        to,
      });
      const rebuilt = createSourceDocumentModel(nextSource);

      expect(localized.lines).toEqual(rebuilt.lines);
      expect([...localized.lineStarts]).toEqual([
        ...rebuilt.lineStarts,
      ]);
      for (let sample = 0; sample < 4; sample += 1) {
        const offset = random(nextSource.length + 1);
        expect(sourceLineIndexAtOffset(localized, offset)).toBe(
          sourceLineIndexAtOffset(rebuilt, offset),
        );
      }
      source = nextSource;
    }
  });
});
