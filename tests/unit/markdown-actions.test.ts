import { describe, expect, it } from 'vitest';

import {
  applyMarkdownAction,
  applyMarkdownInlineColor,
  collectAuthoredColors,
  inlineColorKindAt,
} from '../../src/renderer/projects/markdown-actions';

describe('markdown toolbar actions', () => {
  it('wraps the selection and keeps it selected', () => {
    const edit = applyMarkdownAction('bold', 'say hello now', 4, 9);

    expect(edit.value).toBe('say **hello** now');
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe(
      'hello',
    );
  });

  it('unwraps when the selection is already wrapped', () => {
    const edit = applyMarkdownAction('bold', 'say **hello** now', 6, 11);

    expect(edit.value).toBe('say hello now');
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe(
      'hello',
    );
  });

  it('toggles a line prefix across the selected lines', () => {
    const added = applyMarkdownAction('list', 'one\ntwo', 0, 7);
    expect(added.value).toBe('- one\n- two');

    const removed = applyMarkdownAction('list', '- one\n- two', 0, 11);
    expect(removed.value).toBe('one\ntwo');
  });

  it('inserts a link and selects the url placeholder', () => {
    const edit = applyMarkdownAction('link', 'go here', 3, 7);

    expect(edit.value).toBe('go [here](url)');
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe('url');
  });

  it('inserts a divider on its own line', () => {
    expect(applyMarkdownAction('divider', 'text', 4, 4).value).toBe(
      'text\n---\n',
    );
  });

  it('supports the task and quote prefixes', () => {
    expect(applyMarkdownAction('task', 'buy milk', 0, 0).value).toBe(
      '- [ ] buy milk',
    );
    expect(applyMarkdownAction('quote', 'said it', 0, 0).value).toBe(
      '> said it',
    );
  });

  it('creates exact text and highlight color syntax as one edit', () => {
    const text = applyMarkdownInlineColor(
      'text',
      'John Kennedy',
      0,
      12,
      '#3B82F6',
    );
    expect(text.value).toBe('[John Kennedy]{color=#3B82F6}');
    expect(text.value.slice(text.selectionStart, text.selectionEnd)).toBe(
      'John Kennedy',
    );

    const highlight = applyMarkdownInlineColor(
      'highlight',
      'important',
      0,
      9,
      '#3B82F6',
    );
    expect(highlight.value).toBe('==important=={color=#3B82F6}');
  });

  it('replaces existing colour markup instead of nesting it', () => {
    // Whole run selected, including its delimiters.
    expect(
      applyMarkdownInlineColor('highlight', '==important==', 0, 13, '#F00')
        .value,
    ).toBe('==important=={color=#F00}');
    expect(
      applyMarkdownInlineColor('text', '[x]{color=#111111}', 0, 18, '#F00')
        .value,
    ).toBe('[x]{color=#F00}');

    // Only the inner words selected, delimiters sitting outside.
    expect(
      applyMarkdownInlineColor('highlight', '==important==', 2, 11, '#F00')
        .value,
    ).toBe('==important=={color=#F00}');
    expect(
      applyMarkdownInlineColor('highlight', '==x=={color=#111111}', 2, 3, '#F00')
        .value,
    ).toBe('==x=={color=#F00}');
  });

  it('converts between text colour and highlight without leftovers', () => {
    expect(
      applyMarkdownInlineColor('highlight', '[x]{color=#111111}', 0, 18, '#F00')
        .value,
    ).toBe('==x=={color=#F00}');
    expect(
      applyMarkdownInlineColor('text', '==x=={color=#111111}', 0, 20, '#F00')
        .value,
    ).toBe('[x]{color=#F00}');
  });

  it('keeps the marked words selected and leaves neighbours alone', () => {
    const edit = applyMarkdownInlineColor('highlight', 'a ==b== c', 2, 7, '#F00');

    expect(edit.value).toBe('a ==b=={color=#F00} c');
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe('b');
  });

  it('reports how the selection is already marked', () => {
    expect(inlineColorKindAt('==x=={color=#111111}', 0, 20)).toBe('highlight');
    expect(inlineColorKindAt('==x==', 2, 3)).toBe('highlight');
    expect(inlineColorKindAt('[x]{color=#111111}', 0, 18)).toBe('text');
    expect(inlineColorKindAt('plain words', 0, 5)).toBeNull();
  });

  it('collects each distinct colour already written in the note', () => {
    const source = [
      '[a]{color=#3B82F6}',
      '==b=={color=#2de85b}',
      '[[note]]{color="#3B82F6"}',
      '[c](https://a.dev){color=#FFF}',
      'plain text and {color=red} and {colour=#123456}',
    ].join('\n');

    expect(collectAuthoredColors(source)).toEqual([
      '#3B82F6',
      '#2DE85B',
      '#FFF',
    ]);
    expect(collectAuthoredColors('nothing here')).toEqual([]);
  });
});
