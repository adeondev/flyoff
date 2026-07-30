export interface MarkdownTextChange {
  nextEnd: number;
  previousEnd: number;
  start: number;
}

/**
 * Comparing a block at a time lets the engine settle the bulk of the document
 * with native string equality; only the block that actually differs pays for a
 * character loop. A per-character scan over a 1,2 MB note costs milliseconds on
 * every keystroke, which is the whole budget for an edit.
 */
const COMPARISON_CHUNK = 2_048;

export function commonPrefixLength(previous: string, next: string): number {
  const limit = Math.min(previous.length, next.length);
  let offset = 0;

  while (offset + COMPARISON_CHUNK <= limit) {
    if (
      previous.slice(offset, offset + COMPARISON_CHUNK) !==
      next.slice(offset, offset + COMPARISON_CHUNK)
    ) {
      break;
    }
    offset += COMPARISON_CHUNK;
  }

  while (
    offset < limit &&
    previous.charCodeAt(offset) === next.charCodeAt(offset)
  ) {
    offset += 1;
  }

  return offset;
}

export function commonSuffixLength(
  previous: string,
  next: string,
  limit: number,
): number {
  const bound = Math.max(0, limit);
  let length = 0;

  while (length + COMPARISON_CHUNK <= bound) {
    const previousStart = previous.length - length - COMPARISON_CHUNK;
    const nextStart = next.length - length - COMPARISON_CHUNK;
    if (
      previous.slice(previousStart, previousStart + COMPARISON_CHUNK) !==
      next.slice(nextStart, nextStart + COMPARISON_CHUNK)
    ) {
      break;
    }
    length += COMPARISON_CHUNK;
  }

  while (
    length < bound &&
    previous.charCodeAt(previous.length - length - 1) ===
      next.charCodeAt(next.length - length - 1)
  ) {
    length += 1;
  }

  return length;
}

/** The smallest range that differs between two revisions of a document. */
export function markdownTextChange(
  previous: string,
  next: string,
): MarkdownTextChange {
  const start = commonPrefixLength(previous, next);
  const trailing = commonSuffixLength(
    previous,
    next,
    Math.min(previous.length, next.length) - start,
  );

  return {
    nextEnd: next.length - trailing,
    previousEnd: previous.length - trailing,
    start,
  };
}
