import { describe, expect, it } from 'vitest';

import {
  highlightSourceLine,
  highlightSourceLines,
  resetSourceLineHighlightCache,
  sourceLineHasImageDirective,
} from '../../src/renderer/projects/markdown-highlight';

function uniqueDocument(lineCount: number): string {
  const lines: string[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    lines.push(`Registro ${index}: texto único com **ênfase** e detalhe.`);
  }
  return lines.join('\n');
}

describe('lazy source line highlighting', () => {
  it('classifies a line without producing its markup', () => {
    const line = highlightSourceLine('## Título', false);

    expect(line.heading).toBe(true);
    expect(line.code).toBe(false);
    expect(line.source).toBe('## Título');
    // Reading html is what commits to the expensive work.
    expect(line.html).toContain('md-tok');
  });

  it('returns the same markup on every read', () => {
    const line = highlightSourceLine('texto **forte**', false);

    expect(line.html).toBe(line.html);
  });

  it('tracks fence state across lines eagerly', () => {
    const lines = highlightSourceLines(
      ['antes', '```ts', 'const a = 1;', '```', 'depois'].join('\n'),
    );

    expect(lines.map((line) => line.code)).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(lines[1]!.codeStart).toBe(true);
    expect(lines[3]!.codeEnd).toBe(true);
  });

  it('answers the image question from the source, not the markup', () => {
    expect(sourceLineHasImageDirective('texto comum')).toBe(false);
    expect(
      sourceLineHasImageDirective('::image[alt]{v=2 asset=x}'),
    ).toBe(true);
    expect(sourceLineHasImageDirective('::media[alt]{v=1 id=x}')).toBe(true);
  });

  it('counts graphemes on the line itself and reuses the count', () => {
    const line = highlightSourceLine('café', false);

    expect(line.graphemeCount).toBe(4);
    expect(line.graphemeCount).toBe(4);
  });

  it('stays linear past the highlight cache limit', () => {
    // The cache once evicted by reading the first key out of a Map that had
    // already had entries deleted, which is proportional to those deletions.
    // Every unique line past the limit paid it, turning a full-document
    // highlight quadratic. Both documents here are far past the limit, so a
    // return of that behaviour shows up as a superlinear ratio.
    const small = uniqueDocument(20_000);
    const large = uniqueDocument(40_000);

    resetSourceLineHighlightCache();
    const smallStarted = performance.now();
    for (const line of highlightSourceLines(small)) {
      void line.html;
    }
    const smallElapsed = performance.now() - smallStarted;

    resetSourceLineHighlightCache();
    const largeStarted = performance.now();
    for (const line of highlightSourceLines(large)) {
      void line.html;
    }
    const largeElapsed = performance.now() - largeStarted;

    // Twice the document should cost roughly twice the time. The bound is
    // loose because this runs on shared CI-style machines; the quadratic
    // version exceeded it by an order of magnitude.
    expect(largeElapsed).toBeLessThan(Math.max(50, smallElapsed * 6));
  });

  it('keeps serving lines after the cache rotates a generation', () => {
    resetSourceLineHighlightCache();
    const lines = highlightSourceLines(uniqueDocument(20_000));

    expect(lines[0]!.html).toContain('Registro 0');
    expect(lines[19_999]!.html).toContain('Registro 19999');
    // Re-reading an early line after the rotation must still be correct.
    expect(lines[0]!.html).toContain('Registro 0');
  });
});
