import { describe, expect, it } from 'vitest';

import {
  highlightSource,
  highlightSourceLines,
} from '../../src/renderer/projects/markdown-highlight';
import { serializeImageDirective } from '../../src/shared/markdown';

describe('markdown source highlighter', () => {
  it('shares lazy HTML behavior across source line records', () => {
    const lines = highlightSourceLines('plain\n**bold**');
    const prototype = Object.getPrototypeOf(lines[0]) as object;

    expect(Object.getOwnPropertyDescriptor(lines[0], 'html')).toBeUndefined();
    expect(Object.getPrototypeOf(lines[1])).toBe(prototype);
    expect(Object.getOwnPropertyDescriptor(prototype, 'html')?.get)
      .toBeTypeOf('function');
    expect(lines[1]?.html).toContain('md-tok-strong');
  });

  it('recognizes structural markers after Unicode whitespace', () => {
    const html = highlightSource('\u3000### Heading\n\u2003```js');

    expect(html).toContain('md-line--heading');
    expect(html).toContain('md-line--code-start');
  });

  it('decorates an inline image with its exact source interval', () => {
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
    const html = highlightSource(`antes ${directive} depois`);
    expect(html).toContain('class="md-source-image md-source-image--inline');
    expect(html).toContain('data-image-source-start="6"');
    expect(html).toContain(`data-image-source-end="${6 + directive.length}"`);
    expect(html).toContain('class="md-source-image__syntax"');
  });

  it('escapes html so notes cannot inject markup', () => {
    const html = highlightSource('<img src=x onerror=alert(1)>');

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('marks heading markers separately from the heading text', () => {
    const html = highlightSource('## Title');

    expect(html).toContain('class="md-line md-line--heading"');
    expect(html).toContain('md-tok-mark');
    expect(html).toContain('md-tok-heading');
    expect(html).toContain('Title');
  });

  it('marks custom divided headings without hiding their source marker', () => {
    const html = highlightSource('###-- Divided');

    expect(html).toContain('class="md-line md-line--heading"');
    expect(html).toContain('md-tok-heading--divided');
    expect(html).toContain('###--');
    expect(html).toContain('Divided');
  });

  it('tokenises inline emphasis and code', () => {
    expect(highlightSource('**bold**')).toContain('md-tok-strong');
    expect(highlightSource('*it*')).toContain('md-tok-em');
    expect(highlightSource('~~s~~')).toContain('md-tok-strike');
    expect(highlightSource('==h==')).toContain('md-tok-highlight');
    expect(highlightSource('`code`')).toContain('md-tok-code');
  });

  it('tokenises list markers and task boxes', () => {
    const html = highlightSource('- [x] done');

    expect(html).toContain('md-tok-list');
    expect(html).toContain('md-tok-task');
  });

  it('keeps fenced code content as code until the closing fence', () => {
    const html = highlightSource('```ts\n# **not a heading**\n```');

    expect(html).toContain('md-tok-fence');
    expect(html).not.toContain('md-tok-strong');
    expect(html).not.toContain('md-line--heading');
    expect(html.match(/md-line--code(?=[ "\n])/g)).toHaveLength(3);
    expect(html.match(/md-line--code-start/g)).toHaveLength(1);
    expect(html.match(/md-line--code-end/g)).toHaveLength(1);
    expect(html.match(/md-line--code-fence/g)).toHaveLength(2);
  });

  it('renders Twemoji from the isolated asset protocol without SVG use nodes', () => {
    const html = highlightSource('Hello 👋🏽');

    expect(html).toContain(
      'src="flyoff-asset://app/twemoji/1f44b-1f3fd.svg"',
    );
    expect(html).toContain('class="twemoji__glyph"');
    expect(html).not.toContain('<use');
    expect(html).not.toContain('twemoji-sprite');
  });

  it('tokenises links and the color attribute', () => {
    expect(highlightSource('[x](https://a.dev)')).toContain('md-tok-link');
    const coloredText = highlightSource('[x]{color=#3B82F6}');
    expect(coloredText).toContain('md-tok-attr');
    expect(coloredText).toContain('md-inline-color-trigger');
    expect(coloredText).toContain('style="color:#3B82F6"');
    expect(coloredText).toContain('data-md-color-start="10"');
    expect(coloredText).toContain('data-md-color-end="17"');
  });

  it('tags color attributes apart from ordinary link attributes', () => {
    expect(highlightSource('[x]{color=#3B82F6}')).toContain(
      'md-tok-attr md-tok-color-attr',
    );
    expect(highlightSource('==blue=={color=#3B82F6}')).toContain(
      'md-tok-attr md-tok-color-attr',
    );
    expect(highlightSource('[[note]]{color=#3B82F6}')).toContain(
      'md-tok-attr md-tok-color-attr',
    );
    expect(highlightSource('[x](https://a.dev){color=#3B82F6}')).toContain(
      'md-tok-attr md-tok-color-attr',
    );

    const plainLink = highlightSource('[x](https://a.dev)');
    expect(plainLink).toContain('md-tok-attr');
    expect(plainLink).not.toContain('md-tok-color-attr');
  });

  it('adds editable source swatches for inherited and custom highlights', () => {
    const inherited = highlightSource('prefix ==blue==');
    expect(inherited).toContain('data-md-color-kind="highlight"');
    expect(inherited).toContain('data-md-color-start="15"');
    expect(inherited).toContain('data-md-color-end="15"');

    const custom = highlightSource('==blue=={color=#3B82F6}');
    expect(custom).toContain('background:#3B82F6');
    expect(custom).toContain('data-md-color-start="15"');
    expect(custom).toContain('data-md-color-end="22"');
  });

  it('preserves every character of the source text', () => {
    const source = '# Hi **there**\n\n- [ ] task\n`a < b & c`';
    const text = highlightSource(source)
      .replace(
        /<span aria-hidden="true" class="md-line__gutter" contenteditable="false" data-md-gutter>[^<]*<\/span>/g,
        '',
      )
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

    // Line breaks come from the per-line blocks, not from text nodes.
    expect(text).toBe(source.split('\n').join(''));
  });

  it('emits one numbered line block per source line', () => {
    const source = 'one\n\nthree';
    const html = highlightSource(source);

    expect(html.match(/class="md-line"/g)).toHaveLength(3);
    expect(html).toContain('data-line="1"');
    expect(html).toContain('data-line="3"');
  });
});
