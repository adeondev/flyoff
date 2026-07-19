// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  clearSourceSpellingErrors,
  collectSourceSpellcheckWords,
  renderSourceSpellingErrors,
} from '../../src/renderer/projects/source-spellcheck';
import { reconcileSource } from '../../src/renderer/projects/source-renderer';

describe('source spellcheck', () => {
  it('collects prose while ignoring links and code', () => {
    const source = [
      'Uma caza com [link](https://example.com/caminho)',
      '`const erradu = true`',
      '```ts',
      'palavraa',
      '```',
    ].join('\n');

    expect(collectSourceSpellcheckWords(source, false)).toContain('caza');
    expect(collectSourceSpellcheckWords(source, false)).not.toContain(
      'example',
    );
    expect(collectSourceSpellcheckWords(source, false)).not.toContain(
      'palavraa',
    );
    expect(collectSourceSpellcheckWords(source, true)).toContain('palavraa');
  });

  it('renders and clears spelling markers without changing source text', () => {
    const root = document.createElement('div');
    reconcileSource(root, 'Uma caza bonita');

    renderSourceSpellingErrors(root, ['caza'], false);
    expect(root.querySelector('.md-spelling-error')?.textContent).toBe('caza');
    expect(root.textContent).toContain('Uma caza bonita');

    clearSourceSpellingErrors(root);
    expect(root.querySelector('.md-spelling-error')).toBeNull();
    expect(root.textContent).toContain('Uma caza bonita');
  });

  it('updates changed lines without rebuilding markers elsewhere', () => {
    const root = document.createElement('div');
    reconcileSource(root, 'caza\nerradu');
    renderSourceSpellingErrors(root, ['caza', 'erradu'], false);
    const preserved = root.querySelector('.md-spelling-error');

    reconcileSource(root, 'caza\ncorrijidu');
    renderSourceSpellingErrors(
      root,
      ['corrijidu'],
      false,
      { startLine: 1, endLine: 2 },
    );

    expect(root.querySelector('.md-spelling-error')).toBe(preserved);
    expect(
      root.querySelectorAll('.md-spelling-error')[1]?.textContent,
    ).toBe('corrijidu');
  });
});
