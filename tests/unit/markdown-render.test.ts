// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  renderMarkdownInto,
  renderMarkdownIntoCooperatively,
} from '../../src/renderer/projects/markdown-render';
import {
  serializeImageDirective,
  serializeMediaDirective,
} from '../../src/shared/markdown';

function render(source: string): HTMLDivElement {
  const container = document.createElement('div');
  renderMarkdownInto(container, source);
  return container;
}

describe('markdown DOM renderer', () => {
  it('builds a large preview cooperatively and publishes it once complete', async () => {
    const source = Array.from(
      { length: 500 },
      (_, index) => `## Section ${index}\n\nParagraph **${index}**`,
    ).join('\n\n');
    const container = render('stable');
    const completed = await renderMarkdownIntoCooperatively(container, source, {
      sliceMs: 2,
    });

    expect(completed).toBe(true);
    expect(container.querySelectorAll('h2')).toHaveLength(500);
    expect(container.textContent).toContain('Paragraph 499');
  });

  it('repairs externally changed children even when the source is unchanged', async () => {
    const container = render('# Stable');
    container.replaceChildren(document.createTextNode('external mutation'));

    const completed = await renderMarkdownIntoCooperatively(
      container,
      '# Stable',
    );

    expect(completed).toBe(true);
    expect(container.querySelector('h1')?.textContent).toBe('Stable');
  });

  it('keeps the published preview stable when cooperative work is cancelled', async () => {
    const container = render('stable');
    const completed = await renderMarkdownIntoCooperatively(
      container,
      'replacement',
      { cancelled: () => true },
    );

    expect(completed).toBe(false);
    expect(container.textContent).toBe('stable');
  });

  it('does not mutate the published preview when work is cancelled after a yield', async () => {
    const frames: FrameRequestCallback[] = [];
    let now = 0;
    let cancelled = false;
    const nowSpy = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => (now += 3));
    const frameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const container = render('stable');

    try {
      const completion = renderMarkdownIntoCooperatively(
        container,
        Array.from(
          { length: 100 },
          (_, index) => `## Section ${index}\n\nParagraph ${index}`,
        ).join('\n\n'),
        {
          cancelled: () => cancelled,
          sliceMs: 2,
        },
      );

      expect(frames).toHaveLength(1);
      expect(container.textContent).toBe('stable');
      cancelled = true;
      frames.shift()!(now);

      await expect(completion).resolves.toBe(false);
      expect(container.textContent).toBe('stable');
    } finally {
      frameSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it('reuses unchanged DOM around a cooperative block update', async () => {
    const media = serializeMediaDirective({
      version: 1,
      id: '323e4567-e89b-42d3-a456-426614174002',
      path: 'Media/clip.mp4',
      description: 'Clipe',
      placement: 'block',
      span: 8,
      offset: 2,
      fit: 'contain',
      ratio: 16 / 9,
      lock: false,
      caption: true,
    });
    const prefixSource = '😀 [Link](https://example.com)';
    const imageSource = '![Cover](https://example.com/cover.png)';
    const container = render(
      [prefixSource, 'before', imageSource, media].join('\n\n'),
    );
    container.scrollLeft = 7;
    container.scrollTop = 180;
    const [prefix, changed, imageBlock, mediaBlock] = [...container.children];
    const link = prefix!.querySelector('a');
    const twemoji = prefix!.querySelector('.twemoji');
    const image = imageBlock!.querySelector('img');
    const mediaElement = mediaBlock!.querySelector('.markdown-media__content');

    const completed = await renderMarkdownIntoCooperatively(
      container,
      [prefixSource, 'after', imageSource, media].join('\n\n'),
      { sliceMs: 2 },
    );

    expect(completed).toBe(true);
    expect(container.children[0]).toBe(prefix);
    expect(container.children[1]).not.toBe(changed);
    expect(container.children[2]).toBe(imageBlock);
    expect(container.children[3]).toBe(mediaBlock);
    expect(container.querySelector('a')).toBe(link);
    expect(container.querySelector('.twemoji')).toBe(twemoji);
    expect(container.querySelector('img[alt="Cover"]')).toBe(image);
    expect(container.querySelector('.markdown-media__content')).toBe(
      mediaElement,
    );
    expect(container.scrollLeft).toBe(7);
    expect(container.scrollTop).toBe(180);
    expect(container.children[1]?.textContent).toBe('after');
  });

  it('updates reused heading metadata after a cooperative heading edit', async () => {
    const container = render('# Same\n\n## Child\n\n# Same');
    const child = container.children[1] as HTMLElement;
    const repeated = container.children[2] as HTMLElement;

    await renderMarkdownIntoCooperatively(
      container,
      '# Other\n\n## Child\n\n# Same',
      { sliceMs: 2 },
    );

    expect(container.children[1]).toBe(child);
    expect(container.children[2]).toBe(repeated);
    expect(child.dataset.markdownHeadingPath).toBe('["Other","Child"]');
    expect(repeated.id).toBe('same');
  });

  it('does not change reused heading metadata if reconciliation is cancelled', async () => {
    const frames: FrameRequestCallback[] = [];
    let cancelled = false;
    let nowCalls = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
      nowCalls += 1;
      return nowCalls <= 5 ? 0 : 3;
    });
    const frameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const container = render('# Same\n\n# Same\n\nTail');
    const children = [...container.children];
    const repeated = children[1] as HTMLElement;

    try {
      const completion = renderMarkdownIntoCooperatively(
        container,
        '# Other\n\n# Same\n\nTail',
        {
          cancelled: () => cancelled,
          sliceMs: 2,
        },
      );

      for (let index = 0; index < 8 && frames.length === 0; index += 1) {
        await Promise.resolve();
      }
      expect(frames).toHaveLength(1);
      expect([...container.children]).toEqual(children);
      expect(repeated.id).toBe('same-2');

      cancelled = true;
      frames.shift()!(3);

      await expect(completion).resolves.toBe(false);
      expect([...container.children]).toEqual(children);
      expect(repeated.id).toBe('same-2');
      expect(repeated.dataset.markdownHeadingPath).toBe('["Same"]');
    } finally {
      frameSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it('renders one giant paragraph cooperatively with identical inline markup', async () => {
    const source = Array.from(
      { length: 1_000 },
      (_, index) =>
        `line ${index} **bold** [link](https://example.com/${index}) ${'x'.repeat(48)}`,
    ).join('\n');
    const synchronous = document.createElement('div');
    const cooperative = document.createElement('div');
    const frameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) =>
        window.setTimeout(() => callback(performance.now()), 0),
      );

    try {
      renderMarkdownInto(synchronous, source);
      await expect(
        renderMarkdownIntoCooperatively(cooperative, source, {
          sliceMs: 2,
        }),
      ).resolves.toBe(true);

      expect(cooperative.innerHTML).toBe(synchronous.innerHTML);
      expect(cooperative.children).toHaveLength(1);
      expect(cooperative.querySelectorAll('br')).toHaveLength(999);
      expect(frameSpy).toHaveBeenCalled();
    } finally {
      frameSpy.mockRestore();
    }
  });

  it('preserves complete emoji sequences in one giant inline text node', async () => {
    const source = `${'👨‍👩‍👧‍👦'.repeat(120)}${'a'.repeat(65_000)}`;
    const synchronous = document.createElement('div');
    const cooperative = document.createElement('div');
    const frameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) =>
        window.setTimeout(() => callback(performance.now()), 0),
      );

    try {
      renderMarkdownInto(synchronous, source);
      await expect(
        renderMarkdownIntoCooperatively(cooperative, source, {
          sliceMs: 2,
        }),
      ).resolves.toBe(true);

      expect(cooperative.innerHTML).toBe(synchronous.innerHTML);
      expect(cooperative.querySelectorAll('.twemoji')).toHaveLength(120);
    } finally {
      frameSpy.mockRestore();
    }
  });

  it('cancels a giant single-list build without publishing partial items', async () => {
    const source = Array.from(
      { length: 600 },
      (_, index) => `- item ${index} ${'x'.repeat(112)}`,
    ).join('\n');
    const container = render('stable');
    const published = container.firstChild;
    const createElementSpy = vi.spyOn(document, 'createElement');
    const frameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) =>
        window.setTimeout(() => callback(performance.now()), 0),
      );

    try {
      const completed = await renderMarkdownIntoCooperatively(
        container,
        source,
        {
          cancelled: () =>
            createElementSpy.mock.calls.filter(
              ([tagName]) => String(tagName) === 'li',
            ).length >= 50,
          sliceMs: 2,
        },
      );

      expect(completed).toBe(false);
      expect(container.firstChild).toBe(published);
      expect(container.textContent).toBe('stable');
      expect(container.querySelector('li')).toBeNull();
    } finally {
      frameSpy.mockRestore();
      createElementSpy.mockRestore();
    }
  });

  it('publishes a cooperative render as one child-list mutation', async () => {
    const container = render('stable');
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => {
      mutations.push(...records);
    });
    observer.observe(container, { childList: true });

    await renderMarkdownIntoCooperatively(
      container,
      '# Replacement\n\nFirst\n\nSecond',
    );
    await Promise.resolve();
    observer.disconnect();

    expect(
      mutations.filter((mutation) => mutation.type === 'childList'),
    ).toHaveLength(1);
    expect(container.textContent).toContain('Replacement');
  });

  it('matches the synchronous renderer for headings, links and project media', async () => {
    const projectId = 'cdb39a1a-0339-4c75-91ea-78fbbcb2f97a';
    const image = serializeImageDirective({
      version: 2,
      instanceId: '223e4567-e89b-42d3-a456-426614174001',
      assetId: '123e4567-e89b-42d3-a456-426614174000',
      path: 'Media/Lua.png',
      alt: 'Lua',
      mode: 'block',
      align: 'center',
      width: 640,
      height: 360,
      minWidth: 96,
      maxWidth: 1200,
      margin: 8,
      ratioLock: true,
      positionLock: false,
      caption: 'Legenda 😀',
    });
    const media = serializeMediaDirective({
      version: 1,
      id: '323e4567-e89b-42d3-a456-426614174002',
      path: 'Media/clip.mp4',
      description: 'Clipe',
      placement: 'block',
      span: 8,
      offset: 2,
      fit: 'contain',
      ratio: 16 / 9,
      lock: false,
      caption: true,
    });
    const source = [
      '# Repeated',
      '## Child',
      '# Repeated',
      '[External](https://example.com) [Internal](Folder/Note.md#Parent#Child)',
      image,
      media,
    ].join('\n\n');
    const synchronous = document.createElement('div');
    const cooperative = document.createElement('div');

    renderMarkdownInto(synchronous, source, { projectId });
    await renderMarkdownIntoCooperatively(cooperative, source, {
      projectId,
      sliceMs: 2,
    });

    expect(cooperative.innerHTML).toBe(synchronous.innerHTML);
    expect(
      [...cooperative.querySelectorAll('h1')].map((heading) => heading.id),
    ).toEqual(['repeated', 'repeated-2']);
    expect(
      cooperative.querySelector<HTMLAnchorElement>(
        '[data-markdown-internal-path]',
      )?.dataset.markdownInternalHeadings,
    ).toBe(JSON.stringify(['Parent', 'Child']));
    expect(
      cooperative.querySelector<HTMLMediaElement>('.markdown-media__content')
        ?.src,
    ).toContain(`${projectId}/323e4567-e89b-42d3-a456-426614174002`);
  });

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
    expect(
      paragraph
        .querySelector('.markdown-image--inline img')
        ?.getAttribute('alt'),
    ).toBe('Lua');
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

  describe('incremental reconciliation', () => {
    it('preserves untouched blocks around an edited one', () => {
      const container = render('one\n\ntwo\n\nthree');
      const [first, middle, last] = [...container.children];

      renderMarkdownInto(container, 'one\n\nchanged\n\nthree');

      expect(container.children[0]).toBe(first);
      expect(container.children[1]).not.toBe(middle);
      expect(container.children[2]).toBe(last);
      expect(
        [...container.querySelectorAll('p')].map((node) => node.textContent),
      ).toEqual(['one', 'changed', 'three']);
    });

    it('keeps every node when the source is unchanged', () => {
      const container = render('one\n\ntwo');
      const before = [...container.children];

      renderMarkdownInto(container, 'one\n\ntwo');

      expect([...container.children]).toEqual(before);
    });

    it('reuses shared blocks when appending, as streaming does', () => {
      const container = render('one\n\ntwo');
      const [first, second] = [...container.children];

      renderMarkdownInto(container, 'one\n\ntwo\n\nthree');

      expect(container.children[0]).toBe(first);
      expect(container.children[1]).toBe(second);
      expect(container.children).toHaveLength(3);
      expect(container.children[2]?.textContent).toBe('three');
    });

    it('updates metadata on a reused heading after an earlier heading changes', () => {
      const container = render('# Same\n\ntext\n\n# Same');
      const reusedHeading = container.children[2] as HTMLElement;
      expect(reusedHeading.id).toBe('same-2');

      renderMarkdownInto(container, '# Other\n\ntext\n\n# Same');

      expect(container.children[2]).toBe(reusedHeading);
      expect(reusedHeading.id).toBe('same');
      expect(reusedHeading.dataset.markdownHeadingPath).toBe('["Same"]');
    });

    it('updates the path on a reused child heading', () => {
      const container = render('# Parent\n\n## Child');
      const reusedHeading = container.children[1] as HTMLElement;

      renderMarkdownInto(container, '# Changed\n\n## Child');

      expect(container.children[1]).toBe(reusedHeading);
      expect(reusedHeading.dataset.markdownHeadingPath).toBe(
        '["Changed","Child"]',
      );
    });

    it('rebuilds asset URLs when the project context changes', () => {
      const source =
        '::image[Lua]{v=2 instance=223e4567-e89b-42d3-a456-426614174001 asset=123e4567-e89b-42d3-a456-426614174000 path="Media/Lua.png" mode=block align=left width=320 height=180 min=96 max=1200 margin=12 ratioLock=true positionLock=false caption=""}';
      const container = document.createElement('div');
      renderMarkdownInto(container, source, {
        projectId: '323e4567-e89b-42d3-a456-426614174001',
      });
      const first = container.firstElementChild;

      renderMarkdownInto(container, source, {
        projectId: '323e4567-e89b-42d3-a456-426614174002',
      });

      expect(container.firstElementChild).not.toBe(first);
      expect(container.querySelector('img')?.src).toContain(
        'flyoff-media://asset/323e4567-e89b-42d3-a456-426614174002/',
      );
    });

    it('invalidates merged paragraphs when a blank boundary is removed', () => {
      const container = render('one\n\ntwo\n\nthree');
      const before = [...container.children];

      renderMarkdownInto(container, 'one\ntwo\n\nthree');

      expect(container.children).toHaveLength(2);
      expect(container.children[0]).not.toBe(before[0]);
      expect(container.children[1]).toBe(before[2]);
      expect(container.children[0]?.textContent).toBe('onetwo');
      expect(container.children[0]?.querySelector('br')).not.toBeNull();
    });

    it('drops removed trailing blocks', () => {
      const container = render('one\n\ntwo\n\nthree');
      const [first] = [...container.children];

      renderMarkdownInto(container, 'one');

      expect(container.children[0]).toBe(first);
      expect(container.children).toHaveLength(1);
    });

    it('rebuilds when the live DOM no longer matches the last render', () => {
      const container = render('one\n\ntwo');
      container.replaceChildren();

      renderMarkdownInto(container, 'one\n\ntwo');

      expect(
        [...container.querySelectorAll('p')].map((node) => node.textContent),
      ).toEqual(['one', 'two']);
    });

    it('replaces every block when the document changes wholesale', () => {
      const container = render('one\n\ntwo');
      const before = [...container.children];

      renderMarkdownInto(container, '# alpha\n\n- beta');

      for (const node of before) {
        expect(container.contains(node)).toBe(false);
      }
      expect(container.querySelector('h1')?.textContent).toBe('alpha');
      expect(container.querySelector('li')?.textContent).toBe('beta');
    });
  });
});
