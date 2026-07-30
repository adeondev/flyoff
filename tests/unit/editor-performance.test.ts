import { describe, expect, it } from 'vitest';

import {
  isLargeMarkdownDocument,
  LARGE_MARKDOWN_DOCUMENT_CHARACTERS,
  LARGE_MARKDOWN_DOCUMENT_LINES,
  shouldWindowMarkdownSource,
  WINDOWED_MARKDOWN_DOCUMENT_CHARACTERS,
  WINDOWED_MARKDOWN_DOCUMENT_LINES,
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

  it('only switches to the windowed source view for genuinely large notes', () => {
    expect(
      shouldWindowMarkdownSource(
        'x'.repeat(WINDOWED_MARKDOWN_DOCUMENT_CHARACTERS),
      ),
    ).toBe(true);
    expect(
      shouldWindowMarkdownSource(
        Array.from(
          { length: WINDOWED_MARKDOWN_DOCUMENT_LINES },
          () => 'short',
        ).join('\n'),
      ),
    ).toBe(true);
    expect(
      shouldWindowMarkdownSource(
        Array.from(
          { length: WINDOWED_MARKDOWN_DOCUMENT_LINES - 1 },
          () => 'short',
        ).join('\n'),
      ),
    ).toBe(false);
  });
});
