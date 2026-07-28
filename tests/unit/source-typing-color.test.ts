import { describe, expect, it } from 'vitest';

import type { SourceSelection } from '../../src/renderer/projects/source-caret';
import {
  applyMarkdownTypingComposition,
  applyMarkdownTypingReplacement,
  markdownTypingColorAt,
  resolveMarkdownTypingInput,
  type MarkdownTypingColor,
} from '../../src/renderer/projects/source-typing-color';

const purple: MarkdownTypingColor = { color: '#8F4FC4', kind: 'text' };
const yellow: MarkdownTypingColor = {
  color: '#FACC15',
  kind: 'highlight',
};
const defaultText: MarkdownTypingColor = { color: null, kind: 'text' };

function selection(start: number, end = start): SourceSelection {
  return {
    direction: start === end ? 'none' : 'forward',
    end,
    start,
  };
}

function input(
  content: string,
  offset: number,
  data: string,
  color: MarkdownTypingColor = purple,
) {
  return resolveMarkdownTypingInput(
    { content, selection: selection(offset) },
    'insertText',
    data,
    color,
  )!;
}

describe('markdown typing colour', () => {
  it('starts a coloured run and keeps subsequent typing inside it', () => {
    const first = input('Before ', 7, 'a');
    expect(first).toEqual({
      content: 'Before [a]{color=#8F4FC4}',
      selection: selection(9),
    });

    const second = input(first.content, first.selection.end, 'b');
    expect(second).toEqual({
      content: 'Before [ab]{color=#8F4FC4}',
      selection: selection(10),
    });
  });

  it('splits an existing run when the active colour changes', () => {
    const changed = input(
      '[abcd]{color=#8F4FC4}',
      3,
      'X',
      yellow,
    );

    expect(changed.content).toBe(
      '[ab]{color=#8F4FC4}==X=={color=#FACC15}[cd]{color=#8F4FC4}',
    );
    expect(changed.content[changed.selection.end]).toBe('=');
  });

  it('preserves an authored default highlight around a new colour', () => {
    const changed = input('==abcd==', 4, 'X', purple);

    expect(changed.content).toBe(
      '==ab==[X]{color=#8F4FC4}==cd==',
    );
  });

  it('uses true default text by leaving the inserted source unwrapped', () => {
    const changed = input(
      '[abcd]{color=#8F4FC4}',
      3,
      'X',
      defaultText,
    );

    expect(changed.content).toBe(
      '[ab]{color=#8F4FC4}X[cd]{color=#8F4FC4}',
    );
    expect(changed.selection).toEqual(selection(20));
  });

  it('closes formatting at Enter and applies it to the next typed text', () => {
    const newline = resolveMarkdownTypingInput(
      {
        content: '[word]{color=#8F4FC4}',
        selection: selection(5),
      },
      'insertParagraph',
      null,
      purple,
    )!;

    expect(newline).toEqual({
      content: '[word]{color=#8F4FC4}\n',
      selection: selection(22),
    });
    expect(
      input(newline.content, newline.selection.end, 'n').content,
    ).toBe('[word]{color=#8F4FC4}\n[n]{color=#8F4FC4}');
  });

  it('formats each non-empty pasted line without crossing line breaks', () => {
    const pasted = applyMarkdownTypingReplacement(
      { content: '', selection: selection(0) },
      'one\n\ntwo',
      yellow,
    );

    expect(pasted.content).toBe(
      '==one=={color=#FACC15}\n\n==two=={color=#FACC15}',
    );
    expect(pasted.selection.end).toBe(29);
  });

  it('removes an empty run after deleting its last grapheme', () => {
    const deleted = resolveMarkdownTypingInput(
      {
        content: '[a]{color=#8F4FC4}',
        selection: selection(2),
      },
      'deleteContentBackward',
      null,
      purple,
    );

    expect(deleted).toEqual({ content: '', selection: selection(0) });
  });

  it('post-processes the final IME insertion as a single styled edit', () => {
    const composed = applyMarkdownTypingComposition(
      { content: 'A ', selection: selection(2) },
      { content: 'A 字', selection: selection(3) },
      purple,
    );

    expect(composed).toEqual({
      content: 'A [字]{color=#8F4FC4}',
      selection: selection(4),
    });
  });

  it('reports the authored colour under a collapsed caret', () => {
    expect(markdownTypingColorAt('[word]{color=#8F4FC4}', 3)).toEqual(purple);
    expect(markdownTypingColorAt('==word==', 4)).toEqual({
      color: null,
      kind: 'highlight',
    });
    expect(markdownTypingColorAt('plain', 3)).toBeNull();
  });
});
