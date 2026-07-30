import { describe, expect, it, vi } from "vitest";

import { resolveSourceKeyboardNavigation } from "../../src/renderer/projects/source-engine/source-keyboard-navigation";

const none = (offset: number) => ({
  direction: "none" as const,
  end: offset,
  start: offset,
});

function previousWordReference(value: string, offset: number): number {
  const prefix = value.slice(0, offset);
  const whitespace = /\s+$/u.exec(prefix);
  if (whitespace) {
    return offset - whitespace[0].length;
  }
  const word = /[\p{L}\p{M}\p{N}_]+$/u.exec(prefix);
  if (word) {
    return offset - word[0].length;
  }
  const segments = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(value);
  return segments.containing(Math.max(0, offset - 1))?.index ?? 0;
}

function nextWordReference(value: string, offset: number): number {
  const suffix = value.slice(offset);
  const whitespace = /^\s+/u.exec(suffix);
  if (whitespace) {
    return offset + whitespace[0].length;
  }
  const word = /^[\p{L}\p{M}\p{N}_]+/u.exec(suffix);
  if (word) {
    return offset + word[0].length;
  }
  const segment = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  })
    .segment(value)
    .containing(offset);
  return segment ? segment.index + segment.segment.length : value.length;
}

describe("source keyboard navigation", () => {
  it("selects the complete model instead of an input mirror", () => {
    expect(
      resolveSourceKeyboardNavigation("one\ntwo", none(4), {
        altKey: false,
        ctrlKey: true,
        key: "a",
        metaKey: false,
        platform: "win32",
        shiftKey: false,
      }),
    ).toEqual({ direction: "forward", end: 7, start: 0 });
  });

  it("moves by grapheme, word and document boundaries", () => {
    const source = "a👨‍👩‍👧‍👦b\nword two";
    expect(
      resolveSourceKeyboardNavigation(source, none(12), {
        altKey: false,
        ctrlKey: false,
        key: "ArrowLeft",
        metaKey: false,
        shiftKey: false,
      }),
    ).toEqual(none(1));
    expect(
      resolveSourceKeyboardNavigation(source, none(source.length), {
        altKey: false,
        ctrlKey: true,
        key: "ArrowLeft",
        metaKey: false,
        platform: "win32",
        shiftKey: false,
      }),
    ).toEqual(none(source.length - 3));
    expect(
      resolveSourceKeyboardNavigation(source, none(3), {
        altKey: false,
        ctrlKey: true,
        key: "End",
        metaKey: false,
        platform: "win32",
        shiftKey: false,
      }),
    ).toEqual(none(source.length));
  });

  it("preserves word-boundary semantics across Unicode and CRLF", () => {
    const sources = [
      "alpha beta",
      "café42_ próximo",
      "a\u0301bc \u0967\u0968\u0969",
      "word\r\n\t\u00a0next",
      "start 👨‍👩‍👧‍👦 middle—fim",
      "_under_score_ ! punctuation",
    ];
    const base = {
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      platform: "win32",
      shiftKey: false,
    };

    for (const source of sources) {
      for (let offset = 0; offset <= source.length; offset += 1) {
        expect(
          resolveSourceKeyboardNavigation(source, none(offset), {
            ...base,
            key: "ArrowLeft",
          }),
        ).toEqual(none(previousWordReference(source, offset)));
        expect(
          resolveSourceKeyboardNavigation(source, none(offset), {
            ...base,
            key: "ArrowRight",
          }),
        ).toEqual(none(nextWordReference(source, offset)));
      }
    }
  });

  it("navigates a 15,000-line document without slicing the full model", () => {
    const source = Array.from(
      { length: 15_000 },
      (_, index) => `line_${index} conteúdo markdown`,
    ).join("\n");
    const slice = vi.spyOn(String.prototype, "slice");

    const previous = resolveSourceKeyboardNavigation(
      source,
      none(source.length),
      {
        altKey: false,
        ctrlKey: true,
        key: "ArrowLeft",
        metaKey: false,
        platform: "win32",
        shiftKey: false,
      },
    );
    const next = resolveSourceKeyboardNavigation(
      source,
      none(source.lastIndexOf("conteúdo")),
      {
        altKey: false,
        ctrlKey: true,
        key: "ArrowRight",
        metaKey: false,
        platform: "win32",
        shiftKey: false,
      },
    );
    const sliceCalls = slice.mock.calls.length;
    slice.mockRestore();

    expect(previous).toEqual(none(source.length - "markdown".length));
    expect(next).toEqual(
      none(source.lastIndexOf("conteúdo") + "conteúdo".length),
    );
    expect(sliceCalls).toBe(0);
  });

  it("preserves an anchor while moving vertically and by page", () => {
    const source = "abcd\nx\n12345\nlast";
    expect(
      resolveSourceKeyboardNavigation(source, none(3), {
        altKey: false,
        ctrlKey: false,
        key: "ArrowDown",
        metaKey: false,
        shiftKey: true,
      }),
    ).toEqual({ direction: "forward", end: 6, start: 3 });
    expect(
      resolveSourceKeyboardNavigation(source, none(1), {
        altKey: false,
        ctrlKey: false,
        key: "PageDown",
        metaKey: false,
        pageLineCount: 2,
        shiftKey: false,
      }),
    ).toEqual(none(8));
  });

  it("never lands between carriage return and line feed", () => {
    const source = "abcd\r\nxy\r\nlast";
    const base = {
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      platform: "win32",
      shiftKey: false,
    };

    expect(
      resolveSourceKeyboardNavigation(source, none(2), {
        ...base,
        key: "End",
      }),
    ).toEqual(none(4));
    expect(
      resolveSourceKeyboardNavigation(source, none(3), {
        ...base,
        key: "ArrowDown",
      }),
    ).toEqual(none(8));
    expect(
      resolveSourceKeyboardNavigation(source, none(8), {
        ...base,
        key: "ArrowDown",
      }),
    ).toEqual(none(12));
  });

  it("collapses an existing selection toward the requested direction", () => {
    const selection = {
      direction: "forward" as const,
      end: 8,
      start: 2,
    };
    const base = {
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    };
    expect(
      resolveSourceKeyboardNavigation("0123456789", selection, {
        ...base,
        key: "ArrowLeft",
      }),
    ).toEqual(none(2));
    expect(
      resolveSourceKeyboardNavigation("0123456789", selection, {
        ...base,
        key: "ArrowRight",
      }),
    ).toEqual(none(8));
  });
});
