import { afterEach, describe, expect, it } from 'vitest';

import {
  createSourceDocumentModel,
  setLocalSourceChangePathEnabled,
  sourceDocumentModelDiagnostics,
  updateSourceDocumentModel,
  type SourceDocumentModel,
} from '../../src/renderer/projects/source-document-model';

/**
 * The line-local edit path exists so a keystroke never reads the whole
 * document. It must produce exactly what the path that derives the change from
 * the text produces, so the same randomized edits run through both and every
 * observable is compared after each one.
 */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const ALPHABETS = [
  'abcdefghijklmnopqrstuvwxyz ',
  'áéíóúãõçÀÉ ',
  '😀😁🙂👍🏽',
  'áêõ',
  '*_`#>-[]()|~=',
];

function fixture(lineCount: number): string {
  const lines: string[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    if (index % 11 === 0) {
      lines.push(`${'#'.repeat((index % 4) + 1)} Seção ${index} — título`);
    } else if (index % 17 === 0) {
      lines.push('```ts');
    } else if (index % 17 === 8) {
      lines.push('```');
    } else if (index % 5 === 0) {
      lines.push(`- item ${index} com **negrito** e \`código\` 😀`);
    } else if (index % 7 === 0) {
      lines.push(`| a ${index} | b | c |`);
    } else {
      lines.push(`Linha ${index}: registro comum com acentuação e emoji 🙂.`);
    }
  }
  return lines.join('\n');
}

interface Snapshot {
  change: SourceDocumentModel['change'];
  graphemeStarts: number[];
  lineFences: [boolean, boolean][];
  lineStarts: number[];
  lines: string[];
  source: string;
}

function snapshot(model: SourceDocumentModel): Snapshot {
  return {
    change: model.change,
    graphemeStarts: Array.from(model.lineGraphemeStarts),
    lineFences: model.lines.map((line) => [line.fenceBefore, line.fenceAfter]),
    lineStarts: Array.from(model.lineStarts),
    lines: model.lines.map((line) => line.source),
    source: model.source,
  };
}

interface Edit {
  from: number;
  insert: string;
  to: number;
}

function randomEdit(source: string, random: () => number): Edit {
  const alphabet = ALPHABETS[Math.floor(random() * ALPHABETS.length)]!;
  const insertLength = Math.floor(random() * 4);
  let insert = '';
  for (let index = 0; index < insertLength; index += 1) {
    const characters = [...alphabet];
    insert += characters[Math.floor(random() * characters.length)]!;
  }
  // Land on a code unit boundary that is not inside a surrogate pair, which is
  // what the editor itself guarantees before handing an edit over.
  const clamp = (offset: number): number => {
    let bounded = Math.max(0, Math.min(source.length, offset));
    const code = source.charCodeAt(bounded - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      bounded -= 1;
    }
    return bounded;
  };
  const from = clamp(Math.floor(random() * (source.length + 1)));
  const removal = Math.floor(random() * 4);
  const to = clamp(Math.min(source.length, from + removal));
  return { from, insert, to };
}

describe('source document model differential', () => {
  afterEach(() => {
    setLocalSourceChangePathEnabled(true);
  });

  function run(edits: number, lineCount: number, seed: number): void {
    const initial = fixture(lineCount);
    const random = mulberry32(seed);
    const plan: Edit[] = [];
    let text = initial;
    for (let index = 0; index < edits; index += 1) {
      const edit = randomEdit(text, random);
      plan.push(edit);
      text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
    }

    const replay = (useLocalPath: boolean): Snapshot[] => {
      setLocalSourceChangePathEnabled(useLocalPath);
      let model = createSourceDocumentModel(initial);
      const results: Snapshot[] = [];
      for (const edit of plan) {
        const next =
          model.source.slice(0, edit.from) +
          edit.insert +
          model.source.slice(edit.to);
        const selectionEnd = edit.from + edit.insert.length;
        model = updateSourceDocumentModel(model, next, {
          change: edit,
          nextSelection: { end: selectionEnd, start: selectionEnd },
          previousSelection: { end: edit.to, start: edit.from },
        });
        results.push(snapshot(model));
      }
      return results;
    };

    const before = sourceDocumentModelDiagnostics.localChangeApplied;
    const local = replay(true);
    const applied = sourceDocumentModelDiagnostics.localChangeApplied - before;
    const derived = replay(false);

    expect(local).toEqual(derived);
    // The comparison only means something if the fast path actually ran.
    expect(applied).toBeGreaterThan(edits / 4);
  }

  it('matches the derived path across randomized edits on a small note', () => {
    run(300, 40, 12_345);
  });

  it('matches the derived path across randomized edits on a large note', () => {
    run(200, 2_000, 987_654);
  });

  it('matches the derived path for CRLF documents', () => {
    const initial = 'alfa\r\nbeta\r\ngama\r\ndelta';
    const random = mulberry32(4_242);
    const plan: Edit[] = [];
    let text = initial;
    for (let index = 0; index < 200; index += 1) {
      const edit = randomEdit(text, random);
      plan.push(edit);
      text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
    }

    const replay = (useLocalPath: boolean): Snapshot[] => {
      setLocalSourceChangePathEnabled(useLocalPath);
      let model = createSourceDocumentModel(initial);
      return plan.map((edit) => {
        const next =
          model.source.slice(0, edit.from) +
          edit.insert +
          model.source.slice(edit.to);
        const selectionEnd = edit.from + edit.insert.length;
        model = updateSourceDocumentModel(model, next, {
          change: edit,
          nextSelection: { end: selectionEnd, start: selectionEnd },
          previousSelection: { end: edit.to, start: edit.from },
        });
        return snapshot(model);
      });
    };

    expect(replay(true)).toEqual(replay(false));
  });

  it('falls back to the derived path when the edit crosses a line', () => {
    setLocalSourceChangePathEnabled(true);
    const model = createSourceDocumentModel('alfa\nbeta\ngama');
    const before = sourceDocumentModelDiagnostics.localChangeApplied;
    const next = updateSourceDocumentModel(model, 'alfa\nbeXta\ngama', {
      change: { from: 7, insert: 'X', to: 7 },
      nextSelection: { end: 8, start: 8 },
      previousSelection: { end: 7, start: 7 },
    });
    expect(next.lines.map((line) => line.source)).toEqual([
      'alfa',
      'beXta',
      'gama',
    ]);
    expect(sourceDocumentModelDiagnostics.localChangeApplied).toBe(before + 1);

    const split = updateSourceDocumentModel(next, 'alfa\nbe\nXta\ngama', {
      change: { from: 7, insert: '\n', to: 7 },
      nextSelection: { end: 8, start: 8 },
      previousSelection: { end: 7, start: 7 },
    });
    expect(split.lines.map((line) => line.source)).toEqual([
      'alfa',
      'be',
      'Xta',
      'gama',
    ]);
    // A newline cannot be expressed by replacing one line, so the fast path
    // must decline it rather than produce a wrong model.
    expect(sourceDocumentModelDiagnostics.localChangeApplied).toBe(before + 1);
  });
});
