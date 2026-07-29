import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSourceDocumentModel } from '../../src/renderer/projects/source-document-model';
import { sourcePositionStatus } from '../../src/renderer/projects/source-status';

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('preserves grapheme boundaries across CRLF line units', () => {
    const content = 'a\r\n😀e\u0301\r\nz';
    const expected = [
      ...new Intl.Segmenter(undefined, {
        granularity: 'grapheme',
      }).segment(content),
    ].length;

    expect(
      sourcePositionStatus(content, {
        start: 0,
        end: content.length,
        direction: 'forward',
      }).selected,
    ).toBe(expected);
  });

  it('counts a 20-thousand-line simple selection without segmenting it', () => {
    const content = Array.from(
      { length: 20_000 },
      (_, index) => `linha ${index} com **markdown** e informação`,
    ).join('\r\n');
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');

    expect(
      sourcePositionStatus(content, {
        start: 0,
        end: content.length,
        direction: 'forward',
      }).selected,
    ).toBe(content.length - 19_999);
    expect(segment).not.toHaveBeenCalled();
  });

  it('reuses cached grapheme blocks for repeated large Unicode selections', () => {
    const line = '😀 combined e\u0301';
    const lines = 512;
    const content = Array.from({ length: lines }, () => line).join('\n');
    const expectedPerLine = [
      ...new Intl.Segmenter(undefined, {
        granularity: 'grapheme',
      }).segment(line),
    ].length;
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
    const selection = {
      start: 0,
      end: content.length,
      direction: 'forward',
    } as const;

    expect(sourcePositionStatus(content, selection).selected).toBe(
      expectedPerLine * lines + lines - 1,
    );
    const callsAfterFirstSelection = segment.mock.calls.length;
    expect(callsAfterFirstSelection).toBeGreaterThan(500);

    expect(sourcePositionStatus(content, selection).selected).toBe(
      expectedPerLine * lines + lines - 1,
    );
    expect(segment.mock.calls.length - callsAfterFirstSelection).toBeLessThanOrEqual(
      3,
    );
  });

  it('reuses a bounded line index without slicing or splitting the prefix', () => {
    const content = Array.from(
      { length: 20_000 },
      (_, index) => `line ${index} with markdown`,
    ).join('\n');
    const focus = content.length - 4;
    sourcePositionStatus(content, {
      start: focus,
      end: focus,
      direction: 'none',
    });
    const split = vi.spyOn(String.prototype, 'split');
    const slice = vi.spyOn(String.prototype, 'slice');

    for (let index = 0; index < 100; index += 1) {
      expect(
        sourcePositionStatus(content, {
          start: focus - index % 8,
          end: focus - index % 8,
          direction: 'none',
        }).line,
      ).toBe(20_000);
    }

    expect(split).not.toHaveBeenCalled();
    expect(
      slice.mock.calls.every(([start, end]) => {
        const from = Number(start ?? 0);
        const to = Number(end ?? content.length);
        return to - from < 64;
      }),
    ).toBe(true);
  });

  it('uses the persistent document line index for cursor lookup', () => {
    const content = Array.from(
      { length: 20_000 },
      (_, index) => `line ${index}`,
    ).join('\n');
    const model = createSourceDocumentModel(content);
    const focus = model.lineStarts[15_000]! + 4;

    expect(
      sourcePositionStatus(
        content,
        { start: focus, end: focus, direction: 'none' },
        model.lineStarts,
      ),
    ).toEqual({ line: 15_001, column: 5, selected: 0 });
  });

  it('evicts old indexes instead of retaining every edited document', () => {
    const indexOf = vi.spyOn(String.prototype, 'indexOf');
    const contents = Array.from(
      { length: 5 },
      (_, index) => `cache-${index}\nline`,
    );
    for (const content of contents) {
      sourcePositionStatus(content, {
        start: content.length,
        end: content.length,
        direction: 'none',
      });
    }
    const callsAfterFill = indexOf.mock.calls.length;

    sourcePositionStatus(contents[0]!, {
      start: contents[0]!.length,
      end: contents[0]!.length,
      direction: 'none',
    });

    expect(indexOf.mock.calls.length).toBeGreaterThan(callsAfterFill);
  });
});
