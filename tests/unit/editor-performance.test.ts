import { describe, expect, it } from 'vitest';

import {
  isLargeMarkdownDocument,
  LARGE_MARKDOWN_DOCUMENT_CHARACTERS,
  LARGE_MARKDOWN_DOCUMENT_LINES,
} from '../../src/renderer/projects/editor-performance';

describe('large markdown classification', () => {
  it('classifies by either source size or structural line count', () => {
    expect(
      isLargeMarkdownDocument(
        'x'.repeat(LARGE_MARKDOWN_DOCUMENT_CHARACTERS),
      ),
    ).toBe(true);
    expect(
      isLargeMarkdownDocument(
        Array.from(
          { length: LARGE_MARKDOWN_DOCUMENT_LINES },
          () => 'short',
        ).join('\n'),
      ),
    ).toBe(true);
  });

  it('keeps ordinary notes on the immediate path', () => {
    expect(isLargeMarkdownDocument('# Note\n\nA short paragraph.')).toBe(
      false,
    );
  });
});
