// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  clearSourceSpellingErrorsOutsideRange,
  clearSourceSpellingErrors,
  collectSourceSpellcheckWords,
  renderSourceSpellingErrors,
  sourceSpellcheckViewportRange,
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

  it('bounds markers to the active viewport window', () => {
    const root = document.createElement('div');
    reconcileSource(
      root,
      Array.from({ length: 500 }, (_, index) => `erradu ${index}`).join(
        '\n',
      ),
    );
    Object.defineProperties(root, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 10_000 },
      scrollTop: { configurable: true, value: 5_000 },
    });
    const range = sourceSpellcheckViewportRange(root, 500, 10);
    expect(range.startLine).toBe(240);
    expect(range.endLine).toBe(270);

    renderSourceSpellingErrors(root, ['erradu'], false, {
      endLine: 1,
      startLine: 0,
    });
    renderSourceSpellingErrors(root, ['erradu'], false, {
      endLine: 251,
      startLine: 250,
    });
    clearSourceSpellingErrorsOutsideRange(root, range);

    expect(
      root.children[0]?.querySelector('[data-spelling-word="erradu"]'),
    ).toBeNull();
    expect(
      root.children[250]?.querySelector('[data-spelling-word="erradu"]'),
    ).not.toBeNull();
  });
});
