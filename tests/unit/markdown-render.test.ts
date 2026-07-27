// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { renderMarkdownInto } from '../../src/renderer/projects/markdown-render';
import { serializeImageDirective } from '../../src/shared/markdown';

function render(source: string): HTMLDivElement {
  const container = document.createElement('div');
  renderMarkdownInto(container, source);
  return container;
}

describe('markdown DOM renderer', () => {
  it('renders a v2 inline image between visible words', () => {
    const directive = serializeImageDirective({
      version: 2,
      instanceId: '223e4567-e89b-42d3-a456-426614174001',
      assetId: '123e4567-e89b-42d3-a456-426614174000',
      path: 'Media/Lua.png',
      alt: 'Lua',
      mode: 'inline',
      align: 'left',
      width: 160,
      height: 90,
      minWidth: 96,
      maxWidth: 1200,
      margin: 8,
      ratioLock: true,
      positionLock: false,
      caption: '',
    });
    const paragraph = render(`antes ${directive} depois`).querySelector('p')!;
    expect(paragraph.childNodes[0]?.textContent).toBe('antes ');
    expect(paragraph.querySelector('.markdown-image--inline img')?.getAttribute('alt')).toBe(
      'Lua',
    );
    expect(paragraph.lastChild?.textContent).toBe(' depois');
  });

  it('renders headings, emphasis and safe links', () => {
    const container = render('# Hi\n\n**bold** [x](https://a.dev)');

    expect(container.querySelector('h1')?.textContent).toBe('Hi');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('a')?.getAttribute('href')).toBeNull();
    expect(container.querySelector('a')?.dataset.markdownExternalUrl).toBe(
      'https://a.dev',
    );
    expect(
      container
        .querySelector('h1')
        ?.classList.contains('markdown-view__heading--divided'),
    ).toBe(false);
  });

  it('marks only custom divided headings for the reading rule', () => {
    const container = render('#-- Divided\n\n## Plain');

    expect(
      container
        .querySelector('h1')
        ?.classList.contains('markdown-view__heading--divided'),
    ).toBe(true);
    expect(container.querySelector('h1')?.textContent).toBe('Divided');
    expect(
      container
        .querySelector('h2')
        ?.classList.contains('markdown-view__heading--divided'),
    ).toBe(false);
  });

  it('does not emit href for disallowed url schemes', () => {
    const container = render('[x](javascript:alert(1))');

    expect(container.querySelector('a')?.hasAttribute('href')).toBe(false);
  });

  it('moves authored link and image titles to Flyoff tooltips', () => {
    const container = render(
      '[site](https://example.com "Link details") ![cover](https://example.com/cover.png "Image details")',
    );
    const link = container.querySelector('a')!;
    const image = container.querySelector('img')!;

    expect(link.dataset.flyoffTooltip).toBe('Link details');
    expect(image.dataset.flyoffTooltip).toBe('Image details');
    expect(link.hasAttribute('title')).toBe(false);
    expect(image.hasAttribute('title')).toBe(false);
  });

  it.each([
    '[relative](/note)',
    '[relative](not-a-url)',
    '[[Folder/Note#Title|wiki]]',
  ])('marks internal links as keyboard-accessible: %s', (source) => {
    const anchor = render(source).querySelector('a')!;

    expect(anchor.hasAttribute('href')).toBe(false);
    expect(anchor.getAttribute('role')).toBe('link');
    expect(anchor.tabIndex).toBe(0);
    expect(anchor.dataset.markdownInternalPath).toBeTruthy();
  });

  it.each(['[app](flyoff://app/note)', '[bad](javascript:alert(1))'])(
    'keeps unsupported link targets inert: %s',
    (source) => {
      const anchor = render(source).querySelector('a')!;

      expect(anchor.hasAttribute('href')).toBe(false);
      expect(anchor.getAttribute('aria-disabled')).toBe('true');
    },
  );

  it('applies validated inline colors', () => {
    const container = render('[warn]{color=#3B82F6} ==marked=={color=#3B82F6}');

    expect(container.querySelector('span')?.style.color).toBe(
      'rgb(59, 130, 246)',
    );
    const mark = container.querySelector('mark');
    expect(mark?.style.backgroundColor).toBe('rgb(59, 130, 246)');
    expect(mark?.dataset.customColor).toBe('');
  });

  it('renders exact authored link colors in reading mode', () => {
    const container = render(
      '[site](https://example.com){color=#3B82F6} [[Note]]{color=#ef4444}',
    );
    const links = container.querySelectorAll('a');
    expect((links[0] as HTMLElement).style.color).toBe('rgb(59, 130, 246)');
    expect((links[1] as HTMLElement).style.color).toBe('rgb(239, 68, 68)');
    expect((links[0] as HTMLElement).dataset.customColor).toBe('');
  });

  it('renders media directives through the isolated media protocol', () => {
    const container = render(
      '::media[Lua]{v=1 id=123e4567-e89b-12d3-a456-426614174000 path="Media/lua.png" placement=block span=6 offset=1 fit=cover ratio=1.5 lock=true caption=true}',
    );
    const figure = container.querySelector('figure')!;
    const image = figure.querySelector('img')!;
    expect(image.src).toBe(
      'flyoff-media://asset/123e4567-e89b-12d3-a456-426614174000',
    );
    expect(figure.dataset.mediaFit).toBe('cover');
    expect(figure.style.getPropertyValue('--media-span')).toBe('6');
    expect(figure.querySelector('figcaption')?.textContent).toBe('Lua');
  });

  it('renders v2 images with project isolation and responsive layout', () => {
    const container = document.createElement('div');
    renderMarkdownInto(
      container,
      '::image[Lua]{v=2 instance=223e4567-e89b-42d3-a456-426614174001 asset=123e4567-e89b-42d3-a456-426614174000 path="Media/Lua.png" mode=wrap align=right width=320 height=180 min=96 max=1200 margin=12 ratioLock=true positionLock=false caption="Órbita"}',
      { projectId: '323e4567-e89b-42d3-a456-426614174002' },
    );
    const figure = container.querySelector<HTMLElement>('.markdown-image')!;
    const image = figure.querySelector<HTMLImageElement>('img')!;
    expect(image.src).toBe(
      'flyoff-media://asset/323e4567-e89b-42d3-a456-426614174002/123e4567-e89b-42d3-a456-426614174000',
    );
    expect(figure.dataset.imageInstanceId).toBe(
      '223e4567-e89b-42d3-a456-426614174001',
    );
    expect(figure.classList.contains('markdown-image--wrap')).toBe(true);
    expect(figure.style.getPropertyValue('--image-ratio')).toBe(
      String(320 / 180),
    );
    const caption = figure.querySelector<HTMLElement>('figcaption')!;
    expect(caption.textContent).toBe('Órbita');
    expect(caption.getAttribute('aria-expanded')).toBe('false');
    caption.click();
    expect(caption.dataset.expanded).toBe('true');
    expect(caption.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders task list items with disabled checkboxes', () => {
    const container = render('- [x] done');
    const checkbox = container.querySelector('input[type="checkbox"]');

    expect(checkbox).toBeTruthy();
    expect(checkbox?.classList.contains('flyoff-checkbox')).toBe(true);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect((checkbox as HTMLInputElement).disabled).toBe(true);
  });

  it('keeps inline code literal', () => {
    const container = render('`**not bold**`');

    expect(container.querySelector('code')?.textContent).toBe('**not bold**');
    expect(container.querySelector('strong')).toBeNull();
  });

  it('uses an isolated Twemoji image and reveals Unicode if it fails', () => {
    const container = render('Hello 👋🏽');
    const wrapper = container.querySelector('.twemoji')!;
    const image = wrapper.querySelector<HTMLImageElement>('img')!;

    expect(image.src).toBe('flyoff-asset://app/twemoji/1f44b-1f3fd.svg');
    expect(container.querySelector('use')).toBeNull();
    image.dispatchEvent(new Event('error'));
    expect(wrapper.classList.contains('twemoji--fallback')).toBe(true);
    expect(wrapper.querySelector('img')).toBeNull();
    expect(wrapper.textContent).toBe('👋🏽');
  });

  it('renders fenced code as a preformatted block with its language', () => {
    const container = render('```ts\nconst answer = 42;\n```');
    const pre = container.querySelector('pre');
    const code = pre?.querySelector('code');

    expect(pre).toBeTruthy();
    expect(code?.dataset.lang).toBe('ts');
    expect(code?.textContent).toBe('const answer = 42;');
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

    expect(
      [...container.querySelectorAll('p')].map((node) => node.textContent),
    ).toEqual(['one', 'two']);
  });

  it('renders aligned Markdown tables without injecting HTML', () => {
    const container = render(
      '| Name | Value |\n| :--- | ---: |\n| **Twine** | 4 |',
    );

    expect(container.querySelectorAll('th')).toHaveLength(2);
    expect(container.querySelector('th')?.style.textAlign).toBe('left');
    expect(container.querySelectorAll('td')[1]?.style.textAlign).toBe('right');
    expect(container.querySelector('strong')?.textContent).toBe('Twine');
  });
});
