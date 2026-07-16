import { describe, expect, it } from 'vitest';

import { highlightSource } from '../../src/renderer/projects/markdown-highlight';

describe('markdown source highlighter', () => {
  it('escapes html so notes cannot inject markup', () => {
    const html = highlightSource('<img src=x onerror=alert(1)>');

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('marks heading markers separately from the heading text', () => {
    const html = highlightSource('## Title');

    expect(html).toContain('md-tok-mark');
    expect(html).toContain('md-tok-heading');
    expect(html).toContain('Title');
  });

  it('marks custom divided headings without hiding their source marker', () => {
    const html = highlightSource('###-- Divided');

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
    const html = highlightSource('```ts\n**not bold**\n```');

    expect(html).toContain('md-tok-fence');
    expect(html).not.toContain('md-tok-strong');
  });

  it('tokenises links and the color attribute', () => {
    expect(highlightSource('[x](https://a.dev)')).toContain('md-tok-link');
    expect(highlightSource('[x]{color=red}')).toContain('md-tok-attr');
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
