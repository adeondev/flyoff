import { describe, expect, it } from 'vitest';

import { applyMarkdownAction } from '../../src/renderer/projects/markdown-actions';

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
});
