// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { renderMarkdownInto } from '../../src/renderer/projects/markdown-render';
import {
  WindowedMarkdownView,
  windowedMarkdownViewFor,
} from '../../src/renderer/projects/source-engine/windowed-markdown-view';

function readingContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'markdown-view';
  document.body.appendChild(container);
  return container;
}

function largeSource(sections = 200): string {
  const lines: string[] = [];
  for (let index = 0; index < sections; index += 1) {
    lines.push(`## Seção ${index}`);
    lines.push('');
    lines.push(`Parágrafo ${index} com **ênfase** e texto corrido.`);
    lines.push('');
  }
  return lines.join('\n');
}

describe('windowed markdown view', () => {
  it('mounts a window of blocks instead of the whole document', () => {
    const container = readingContainer();
    const view = new WindowedMarkdownView(container);

    view.setSource(largeSource());
    view.flush();

    expect(view.blockCount).toBe(400);
    expect(view.mountedBlockCount).toBeGreaterThan(0);
    expect(view.mountedBlockCount).toBeLessThan(view.blockCount);
    expect(container.querySelectorAll('h2').length).toBeLessThan(400);

    view.destroy();
  });

  it('keeps the canvas at the full estimated document height', () => {
    const container = readingContainer();
    const view = new WindowedMarkdownView(container);

    view.setSource(largeSource());
    view.flush();

    const canvas = container.querySelector<HTMLElement>(
      '.markdown-view__canvas',
    );
    expect(canvas).not.toBeNull();
    expect(Number.parseFloat(canvas!.style.height)).toBeGreaterThan(1_000);

    view.destroy();
  });

  it('gives a mounted heading the id a full render would have given it', () => {
    const source = [
      '# Título',
      '',
      '## Repetido',
      '',
      'Texto.',
      '',
      '## Repetido',
      '',
      'Mais texto.',
    ].join('\n');

    const reference = document.createElement('div');
    renderMarkdownInto(reference, source);
    const expected = [...reference.querySelectorAll('h1, h2')].map(
      (heading) => heading.id,
    );

    const container = readingContainer();
    const view = new WindowedMarkdownView(container);
    view.setSource(source);
    view.flush();

    expect(
      [...container.querySelectorAll('h1, h2')].map((heading) => heading.id),
    ).toEqual(expected);
    // The second occurrence has to keep the de-duplicating suffix, which only
    // a document-wide pass can know about.
    expect(expected).toEqual(['título', 'repetido', 'repetido-2']);

    view.destroy();
  });

  it('resolves a heading path that is not mounted and scrolls it in', () => {
    const container = readingContainer();
    const view = new WindowedMarkdownView(container);
    view.setSource(largeSource());
    view.flush();

    expect(view.scrollToHeadingPath(['Seção 180'])).toBe(true);
    expect(container.scrollTop).toBeGreaterThan(0);
    expect(view.scrollToHeadingPath(['Seção inexistente'])).toBe(false);

    view.destroy();
  });

  it('absorbs an edit inside one block without losing the others', () => {
    const container = readingContainer();
    const view = new WindowedMarkdownView(container);
    const source = largeSource();
    view.setSource(source);
    view.flush();

    const edited = source.replace('Parágrafo 0 com', 'Parágrafo 0 alterado com');
    view.setSource(edited);
    view.flush();

    expect(view.blockCount).toBe(400);
    expect(view.documentSource).toBe(edited);
    expect(container.textContent).toContain('Parágrafo 0 alterado com');

    view.destroy();
  });

  it('rebuilds when an edit adds a block boundary', () => {
    const container = readingContainer();
    const view = new WindowedMarkdownView(container);
    const source = largeSource();
    view.setSource(source);
    view.flush();

    view.setSource(`${source}\n\nBloco novo no fim.`);
    view.flush();

    expect(view.blockCount).toBe(401);
    expect(view.documentSource.endsWith('Bloco novo no fim.')).toBe(true);

    view.destroy();
  });

  it('copies the whole note after select all, not just the mounted blocks', () => {
    const container = readingContainer();
    const view = new WindowedMarkdownView(container);
    const source = largeSource();
    view.setSource(source);
    view.flush();

    view.selectAll();

    let copied: string | undefined;
    const event = new Event('copy', {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: {
        setData: (format: string, data: string) => {
          if (format === 'text/plain') {
            copied = data;
          }
        },
      },
    });
    container.dispatchEvent(event);

    expect(copied).toBe(source);
    expect(event.defaultPrevented).toBe(true);

    view.destroy();
  });

  it('leaves a plain copy to the browser when nothing was selected', () => {
    const container = readingContainer();
    const view = new WindowedMarkdownView(container);
    view.setSource(largeSource());
    view.flush();

    let copied: string | undefined;
    const event = new Event('copy', {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: {
        setData: (_: string, data: string) => {
          copied = data;
        },
      },
    });
    container.dispatchEvent(event);

    expect(copied).toBeUndefined();
    expect(event.defaultPrevented).toBe(false);

    view.destroy();
  });

  it('registers and releases the container it owns', () => {
    const container = readingContainer();
    const view = new WindowedMarkdownView(container);
    view.setSource(largeSource());
    view.flush();

    expect(windowedMarkdownViewFor(container)).toBe(view);

    view.destroy();

    expect(windowedMarkdownViewFor(container)).toBeUndefined();
    expect(container.childNodes.length).toBe(0);
  });
});
