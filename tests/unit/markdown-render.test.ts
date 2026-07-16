// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { renderMarkdownInto } from '../../src/renderer/projects/markdown-render';

function render(source: string): HTMLDivElement {
  const container = document.createElement('div');
  renderMarkdownInto(container, source);
  return container;
}

describe('markdown DOM renderer', () => {
  it('renders headings, emphasis and safe links', () => {
    const container = render('# Hi\n\n**bold** [x](https://a.dev)');

    expect(container.querySelector('h1')?.textContent).toBe('Hi');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://a.dev',
    );
  });

  it('does not emit href for disallowed url schemes', () => {
    const container = render('[x](javascript:alert(1))');

    expect(container.querySelector('a')?.hasAttribute('href')).toBe(false);
  });

  it('applies validated inline colors', () => {
    const container = render('[warn]{color=red}');

    expect(container.querySelector('span')?.style.color).toBe('red');
  });

  it('renders task list items with disabled checkboxes', () => {
    const container = render('- [x] done');
    const checkbox = container.querySelector('input[type="checkbox"]');

    expect(checkbox).toBeTruthy();
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect((checkbox as HTMLInputElement).disabled).toBe(true);
  });

  it('keeps inline code literal', () => {
    const container = render('`**not bold**`');

    expect(container.querySelector('code')?.textContent).toBe('**not bold**');
    expect(container.querySelector('strong')).toBeNull();
  });

  it('renders a simple line ending between highlight and link as br', () => {
    const container = render('==uau==\n[text](https://x.dev)');
    const paragraph = container.querySelector('p')!;

    expect(paragraph.querySelector('mark')?.textContent).toBe('uau');
    expect(paragraph.querySelector('br')).toBeTruthy();
    expect(paragraph.querySelector('a')?.textContent).toBe('text');
    expect([...paragraph.children].map(({ tagName }) => tagName)).toEqual([
      'MARK',
      'BR',
      'A',
    ]);
  });

  it('keeps a blank line as a block boundary', () => {
    const container = render('one\n\ntwo');

    expect([...container.querySelectorAll('p')].map((node) => node.textContent))
      .toEqual(['one', 'two']);
  });
});
