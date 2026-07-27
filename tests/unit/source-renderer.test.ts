// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  readSelection,
  readSource,
  writeSelection,
} from '../../src/renderer/projects/source-caret';
import {
  reconcileSource,
  updateActiveSourceLine,
} from '../../src/renderer/projects/source-renderer';
import { serializeImageDirective } from '../../src/shared/markdown';

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

  it('updates semantic heading rows during incremental reconciliation', () => {
    const root = document.createElement('div');
    reconcileSource(root, 'before\nplain\nafter');

    reconcileSource(root, 'before\n## Heading\nafter');
    expect(root.children[1]?.classList.contains('md-line--heading')).toBe(true);

    reconcileSource(root, 'before\n###-- Divided\nafter');
    expect(root.children[1]?.classList.contains('md-line--heading')).toBe(true);

    reconcileSource(root, 'before\nplain\nafter');
    expect(root.querySelector('.md-line--heading')).toBeNull();
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

  it('keeps emoji Unicode and UTF-16 cursor offsets in the editable source', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const source = 'A 👨‍👩‍👧‍👦 B 👋🏽';
    reconcileSource(root, source);

    expect(root.querySelectorAll('.twemoji--source')).toHaveLength(2);
    expect(readSource(root)).toBe(source);

    const afterFamily = source.indexOf(' B');
    writeSelection(root, afterFamily);
    expect(readSelection(root)).toEqual({
      direction: 'none',
      end: afterFamily,
      start: afterFamily,
    });
    root.remove();
  });

  it('keeps code blocks out of spellcheck unless explicitly enabled', () => {
    const root = document.createElement('div');
    root.dataset.spellcheckEnabled = 'true';
    root.dataset.spellcheckCodeBlocks = 'false';
    reconcileSource(root, 'text\n```\ncodee\n```');

    expect(
      root.querySelector<HTMLElement>('.md-line--code > .md-line__content')
        ?.spellcheck,
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

  it('marks complete, empty and consecutive fenced block boundaries', () => {
    const root = document.createElement('div');
    reconcileSource(root, '```\n```\n~~~\nbody\n~~~');

    expect(root.children[0]?.className).toContain('md-line--code-start');
    expect(root.children[0]?.className).toContain('md-line--code-fence');
    expect(root.children[1]?.className).toContain('md-line--code-end');
    expect(root.children[1]?.className).toContain('md-line--code-fence');
    expect(root.children[2]?.className).toContain('md-line--code-start');
    expect(root.children[3]?.className).toBe('md-line md-line--code');
    expect(root.children[4]?.className).toContain('md-line--code-end');
  });

  it('leaves an unterminated fenced block open through the last line', () => {
    const root = document.createElement('div');
    reconcileSource(root, 'before\n```\nbody');

    expect(root.children[0]?.className).toBe('md-line');
    expect(root.children[1]?.className).toContain('md-line--code-start');
    expect(root.children[2]?.className).toBe('md-line md-line--code');
    expect(root.querySelector('.md-line--code-end')).toBeNull();
    expect(readSource(root)).toBe('before\n```\nbody');
  });

  it('updates fence boundaries incrementally without replacing the suffix', () => {
    const root = document.createElement('div');
    reconcileSource(root, 'before\nplain\nbody\nplain\nafter');
    const suffix = root.children[4];

    reconcileSource(root, 'before\n```\nbody\n```\nafter');

    expect(root.children[1]?.className).toContain('md-line--code-start');
    expect(root.children[2]?.className).toBe('md-line md-line--code');
    expect(root.children[3]?.className).toContain('md-line--code-end');
    expect(root.children[4]).toBe(suffix);

    reconcileSource(root, 'before\nplain\nbody\nplain\nafter');

    expect(root.querySelector('.md-line--code')).toBeNull();
    expect(root.children[4]).toBe(suffix);
  });

  it('shares the longest fenced line width without wrapping each row', () => {
    const root = document.createElement('div');
    reconcileSource(root, 'before\n```\na\nlongest-code-line\n```\nafter');

    const codeLines = [...root.querySelectorAll<HTMLElement>('.md-line--code')];
    expect(
      codeLines.map((line) =>
        line.style.getPropertyValue('--md-code-inline-size'),
      ),
    ).toEqual(Array.from({ length: 4 }, () => 'calc(17ch + 24px)'));

    reconcileSource(root, 'before\n```\na\nshort\n```\nafter');
    expect(
      [...root.querySelectorAll<HTMLElement>('.md-line--code')].map((line) =>
        line.style.getPropertyValue('--md-code-inline-size'),
      ),
    ).toEqual(Array.from({ length: 4 }, () => 'calc(5ch + 24px)'));
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

  it('does not retain a stale active line when preserved rows move', () => {
    const root = document.createElement('div');
    reconcileSource(root, 'one\nthree');
    updateActiveSourceLine(root, 'one\nthree', 4);

    reconcileSource(root, 'one\ntwo\nthree');

    expect(root.querySelectorAll(':scope > .md-line--active')).toHaveLength(1);
    expect(root.children[1]?.classList.contains('md-line--active')).toBe(true);

    updateActiveSourceLine(root, 'one\ntwo\nthree', 0);
    expect(root.querySelectorAll(':scope > .md-line--active')).toHaveLength(1);
    expect(root.children[0]?.classList.contains('md-line--active')).toBe(true);
  });

  describe('offscreen row containment', () => {
    function imageSource(mode: 'wrap' | 'block'): string {
      return serializeImageDirective({
        align: 'left',
        alt: 'Lua',
        assetId: '123e4567-e89b-42d3-a456-426614174000',
        caption: '',
        height: 90,
        instanceId: '223e4567-e89b-42d3-a456-426614174001',
        margin: 8,
        maxWidth: 1200,
        minWidth: 96,
        mode,
        path: 'Media/Lua.png',
        positionLock: false,
        ratioLock: true,
        version: 2,
        width: 160,
      });
    }

    it('leaves a plain document containable', () => {
      const root = document.createElement('div');
      reconcileSource(root, 'one\ntwo\nthree');

      expect(root.hasAttribute('data-floating-media')).toBe(false);
      expect(root.querySelector('.md-line--media')).toBeNull();
    });

    it('opts the document out while a wrapped image floats', () => {
      const root = document.createElement('div');
      reconcileSource(root, `one\n${imageSource('wrap')}\nthree`);

      expect(root.hasAttribute('data-floating-media')).toBe(true);
    });

    it('opts back in once the float is gone', () => {
      const root = document.createElement('div');
      reconcileSource(root, `one\n${imageSource('wrap')}\nthree`);
      expect(root.hasAttribute('data-floating-media')).toBe(true);

      reconcileSource(root, 'one\ntwo\nthree');

      expect(root.hasAttribute('data-floating-media')).toBe(false);
    });

    it('marks rows holding an image so their height is never guessed', () => {
      const root = document.createElement('div');
      reconcileSource(root, `one\n${imageSource('block')}\nthree`);

      // A centered image does not float, so the document stays containable
      // while its own row keeps rendering.
      expect(root.hasAttribute('data-floating-media')).toBe(false);
      expect(root.children[1]?.classList.contains('md-line--media')).toBe(true);
      expect(root.children[0]?.classList.contains('md-line--media')).toBe(false);
    });
  });
});
