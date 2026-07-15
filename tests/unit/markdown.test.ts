import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown } from '../../src/shared/markdown';

describe('markdown block parser', () => {
  it('parses ATX headings with their depth', () => {
    const root = parseMarkdown('# Title\n\n### Sub');

    expect(root.children).toEqual([
      { type: 'heading', depth: 1, children: [{ type: 'text', value: 'Title' }] },
      { type: 'heading', depth: 3, children: [{ type: 'text', value: 'Sub' }] },
    ]);
  });

  it('groups consecutive lines into a paragraph and splits on blank lines', () => {
    const root = parseMarkdown('one\ntwo\n\nthree');

    expect(root.children).toHaveLength(2);
    expect(root.children[0]).toMatchObject({ type: 'paragraph' });
    expect(root.children[1]).toMatchObject({ type: 'paragraph' });
  });

  it('parses fenced code blocks with a language', () => {
    const root = parseMarkdown('```ts\nconst a = 1;\n```');

    expect(root.children).toEqual([
      { type: 'code', lang: 'ts', value: 'const a = 1;' },
    ]);
  });

  it('parses blockquotes recursively', () => {
    const root = parseMarkdown('> quoted\n> text');

    expect(root.children[0]).toMatchObject({
      type: 'blockquote',
      children: [{ type: 'paragraph' }],
    });
  });

  it('parses unordered, ordered and task lists', () => {
    const root = parseMarkdown('- a\n- [x] done\n\n1. first\n2. second');

    expect(root.children[0]).toMatchObject({
      type: 'list',
      ordered: false,
      start: null,
    });
    expect(root.children[0]).toMatchObject({
      children: [{ checked: null }, { checked: true }],
    });
    expect(root.children[1]).toMatchObject({
      type: 'list',
      ordered: true,
      start: 1,
    });
  });

  it('parses thematic breaks', () => {
    expect(parseMarkdown('---').children).toEqual([{ type: 'thematicBreak' }]);
  });
});

describe('markdown inline parser', () => {
  it('parses strong, emphasis, strikethrough and highlight', () => {
    expect(parseInline('**b** *i* ~~s~~ ==h==')).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'b' }] },
      { type: 'text', value: ' ' },
      { type: 'emphasis', children: [{ type: 'text', value: 'i' }] },
      { type: 'text', value: ' ' },
      { type: 'delete', children: [{ type: 'text', value: 's' }] },
      { type: 'text', value: ' ' },
      { type: 'highlight', children: [{ type: 'text', value: 'h' }] },
    ]);
  });

  it('nests inline emphasis inside strong', () => {
    expect(parseInline('**bold *and* more**')).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'text', value: 'bold ' },
          { type: 'emphasis', children: [{ type: 'text', value: 'and' }] },
          { type: 'text', value: ' more' },
        ],
      },
    ]);
  });

  it('parses inline code without formatting inside', () => {
    expect(parseInline('`**not bold**`')).toEqual([
      { type: 'inlineCode', value: '**not bold**' },
    ]);
  });

  it('parses links and images', () => {
    expect(parseInline('[text](https://x.dev "t")')).toEqual([
      {
        type: 'link',
        url: 'https://x.dev',
        title: 't',
        children: [{ type: 'text', value: 'text' }],
      },
    ]);
    expect(parseInline('![alt](/img.png)')).toEqual([
      { type: 'image', url: '/img.png', alt: 'alt', title: null },
    ]);
  });

  it('parses the color attribute and rejects unsafe values', () => {
    expect(parseInline('[warn]{color=#e11}')).toEqual([
      {
        type: 'color',
        color: '#e11',
        children: [{ type: 'text', value: 'warn' }],
      },
    ]);
    expect(parseInline('[warn]{color=red}')).toEqual([
      {
        type: 'color',
        color: 'red',
        children: [{ type: 'text', value: 'warn' }],
      },
    ]);
    expect(parseInline('[x]{color=red;background:url(javascript:1)}')).toEqual([
      { type: 'text', value: '[x]{color=red;background:url(javascript:1)}' },
    ]);
  });

  it('honours backslash escapes', () => {
    expect(parseInline('\\*literal\\*')).toEqual([
      { type: 'text', value: '*literal*' },
    ]);
  });
});
