// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { readSource } from '../../src/renderer/projects/source-caret';
import {
  reconcileSource,
  updateActiveSourceLine,
} from '../../src/renderer/projects/source-renderer';

describe('incremental source renderer', () => {
  it('creates canonical gutter and content cells for every line', () => {
    const root = document.createElement('div');

    reconcileSource(root, '# one\n\nthree');

    expect(root.querySelectorAll(':scope > .md-line')).toHaveLength(3);
    expect(root.querySelectorAll('.md-line__gutter')).toHaveLength(3);
    expect(root.querySelectorAll('.md-line__content')).toHaveLength(3);
    expect(root.querySelectorAll('[data-md-placeholder]')).toHaveLength(1);
    expect(root.children[2]?.getAttribute('data-line')).toBe('3');
    expect(readSource(root)).toBe('# one\n\nthree');
  });

  it('keeps gutters and empty-line placeholders out of the source', () => {
    const root = document.createElement('div');
    reconcileSource(root, 'a\n');

    expect(
      [...root.querySelectorAll('.md-line__gutter')].map(
        (gutter) => gutter.textContent,
      ),
    ).toEqual(['1', '2']);
    expect(readSource(root)).toBe('a\n');
    expect(root.style.getPropertyValue('--md-line-number-digits')).toBe('3');
  });

  it('preserves unchanged prefix and suffix line nodes', () => {
    const root = document.createElement('div');
    reconcileSource(root, 'one\ntwo\nthree');
    const first = root.children[0];
    const middle = root.children[1];
    const last = root.children[2];

    reconcileSource(root, 'one\nchanged\nthree');

    expect(root.children[0]).toBe(first);
    expect(root.children[1]).not.toBe(middle);
    expect(root.children[2]).toBe(last);
    expect(readSource(root)).toBe('one\nchanged\nthree');
  });

  it('renumbers preserved suffix lines after insertion and deletion', () => {
    const root = document.createElement('div');
    reconcileSource(root, 'one\nthree');
    const last = root.children[1];

    reconcileSource(root, 'one\ntwo\nthree');
    expect(root.children[2]).toBe(last);
    expect(last?.getAttribute('data-line')).toBe('3');

    reconcileSource(root, 'one\nthree');
    expect(root.children[1]).toBe(last);
    expect(last?.getAttribute('data-line')).toBe('2');
  });

  it('replaces noncanonical browser DOM before highlighting', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div>one</div><div>two</div>';

    reconcileSource(root, 'one\ntwo');

    expect(root.querySelectorAll(':scope > .md-line')).toHaveLength(2);
    expect(readSource(root)).toBe('one\ntwo');
  });

  it('keeps code blocks out of spellcheck unless explicitly enabled', () => {
    const root = document.createElement('div');
    root.dataset.spellcheckEnabled = 'true';
    root.dataset.spellcheckCodeBlocks = 'false';
    reconcileSource(root, 'text\n```\ncodee\n```');

    expect(
      root.querySelector<HTMLElement>(
        '.md-line--code > .md-line__content',
      )?.spellcheck,
    ).toBe(false);

    const enabledRoot = document.createElement('div');
    enabledRoot.dataset.spellcheckEnabled = 'true';
    enabledRoot.dataset.spellcheckCodeBlocks = 'true';
    reconcileSource(enabledRoot, '```\ncodee\n```');
    expect(
      enabledRoot.querySelector<HTMLElement>(
        '.md-line--code > .md-line__content',
      )?.spellcheck,
    ).toBe(true);
  });

  it('respects the global spellcheck switch and marks the active line', () => {
    const root = document.createElement('div');
    root.dataset.spellcheckEnabled = 'false';
    reconcileSource(root, 'one\ntwo');

    expect(
      root.querySelector<HTMLElement>('.md-line__content')?.spellcheck,
    ).toBe(false);

    updateActiveSourceLine(root, 'one\ntwo', 5);
    expect(root.children[0]?.classList.contains('md-line--active')).toBe(false);
    expect(root.children[1]?.classList.contains('md-line--active')).toBe(true);

    updateActiveSourceLine(root, 'one\ntwo', 0);
    expect(root.children[0]?.classList.contains('md-line--active')).toBe(true);
    expect(root.children[1]?.classList.contains('md-line--active')).toBe(false);
  });
});
