import { describe, expect, it } from 'vitest';

import { createSourceDocumentModel } from '../../src/renderer/projects/source-document-model';
import {
  shouldVirtualizeSource,
  sourceLineColumn,
  sourceOffsetInLine,
  sourceViewportRange,
  VIRTUAL_SOURCE_CHARACTER_THRESHOLD,
} from '../../src/renderer/projects/source-viewport';

describe('source viewport', () => {
  it('activates only beyond the large-document thresholds', () => {
    expect(shouldVirtualizeSource('x'.repeat(
      VIRTUAL_SOURCE_CHARACTER_THRESHOLD,
    ))).toBe(true);
    expect(
      shouldVirtualizeSource(
        Array.from({ length: 5_000 }, () => 'line').join('\n'),
      ),
    ).toBe(true);
    expect(
      shouldVirtualizeSource(
        Array.from({ length: 4_999 }, () => 'line').join('\n'),
      ),
    ).toBe(false);
  });

  it('bounds the mounted window around the visible rows', () => {
    expect(sourceViewportRange(10_000, 660, 22, 20_000, 24)).toEqual({
      startLine: 430,
      endLine: 508,
    });
    expect(sourceViewportRange(0, 660, 22, 20_000, 24)).toEqual({
      startLine: 0,
      endLine: 54,
    });
  });

  it('maps offsets and columns through the indexed document', () => {
    const model = createSourceDocumentModel('first\n😀 second\nlast');
    const offset = sourceOffsetInLine(model, 1, 4);
    expect(offset).toBe(10);
    expect(sourceLineColumn(model, offset)).toEqual({
      column: 4,
      lineIndex: 1,
    });
  });
});
