export const LARGE_MARKDOWN_DOCUMENT_CHARACTERS = 64_000;
export const LARGE_MARKDOWN_DOCUMENT_LINES = 1_000;
export const SPLIT_PREVIEW_IDLE_MS = 60;
export const SPLIT_PREVIEW_MAX_LAG_MS = 120;
export const SOURCE_SPELLCHECK_IDLE_MS = 160;
export const SOURCE_SPELLCHECK_SCROLL_IDLE_MS = 100;

export function isLargeMarkdownDocument(source: string): boolean {
  if (source.length >= LARGE_MARKDOWN_DOCUMENT_CHARACTERS) {
    return true;
  }

  let lines = 1;
  let offset = -1;
  while (lines < LARGE_MARKDOWN_DOCUMENT_LINES) {
    offset = source.indexOf('\n', offset + 1);
    if (offset === -1) {
      return false;
    }
    lines += 1;
  }
  return true;
}
