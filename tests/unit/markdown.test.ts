import { describe, expect, it } from 'vitest';

import {
  parseInline,
  parseMarkdown,
  serializeImageDirective,
} from '../../src/shared/markdown';

describe('markdown block parser', () => {
  it('parses ATX headings with their depth', () => {
    const root = parseMarkdown('# Title\n\n### Sub');

    expect(root.children).toEqual([
      {
        type: 'heading',
        depth: 1,
        divided: false,
        children: [{ type: 'text', value: 'Title' }],
      },
      {
        type: 'heading',
        depth: 3,
        divided: false,
        children: [{ type: 'text', value: 'Sub' }],
      },
    ]);
  });

  it('only divides headings with the custom dash marker', () => {
    const root = parseMarkdown(
      '# Plain\n\n#-- Divided\n\n######-- Small\n\n#--missing-space',
    );

    expect(root.children.slice(0, 3)).toMatchObject([
      { type: 'heading', depth: 1, divided: false },
      { type: 'heading', depth: 1, divided: true },
      { type: 'heading', depth: 6, divided: true },
    ]);
    expect(root.children[3]).toMatchObject({ type: 'paragraph' });
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
  it('parses an inline image directive between words', () => {
    const directive = {
      version: 2 as const,
      instanceId: '223e4567-e89b-42d3-a456-426614174001',
      assetId: '123e4567-e89b-42d3-a456-426614174000',
      path: 'Media/Lua.png',
      alt: 'Lua',
      mode: 'inline' as const,
      align: 'left' as const,
      width: 160,
      height: 90,
      minWidth: 96,
      maxWidth: 1200,
      margin: 8,
      ratioLock: true,
      positionLock: false,
      caption: '',
    };
    const root = parseMarkdown(
      `antes ${serializeImageDirective(directive)} depois`,
    );
    expect(root.children[0]).toMatchObject({
      type: 'paragraph',
      children: [
        { type: 'text', value: 'antes ' },
        { type: 'inline-image', directive },
        { type: 'text', value: ' depois' },
      ],
    });
  });

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

  it('parses authored colors on Markdown links and wikilinks', () => {
    expect(
      parseInline(
        '[site](https://x.dev){color=#3B82F6} [[Folder/Note|note]]{color=#ef4444}',
      ),
    ).toEqual([
      {
        type: 'link',
        url: 'https://x.dev',
        title: null,
        color: '#3B82F6',
        children: [{ type: 'text', value: 'site' }],
      },
      { type: 'text', value: ' ' },
      {
        type: 'link',
        url: 'Folder/Note',
        title: null,
        color: '#ef4444',
        syntax: 'wikilink',
        children: [{ type: 'text', value: 'note' }],
      },
    ]);
  });

  it('parses a validated media directive as a block', () => {
    const source =
      '::media[Lua]{v=1 id=123e4567-e89b-12d3-a456-426614174000 path="Media/lua.png" placement=block span=6 offset=2 fit=contain ratio=1.5 lock=true caption=false}';
    expect(parseMarkdown(source).children).toEqual([
      {
        type: 'media',
        directive: {
          version: 1,
          id: '123e4567-e89b-12d3-a456-426614174000',
          path: 'Media/lua.png',
          description: 'Lua',
          placement: 'block',
          span: 6,
          offset: 2,
          fit: 'contain',
          ratio: 1.5,
          lock: true,
          caption: false,
        },
      },
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
    expect(parseInline('==blue=={color=#3B82F6}')).toEqual([
      {
        type: 'highlight',
        color: '#3B82F6',
        children: [{ type: 'text', value: 'blue' }],
      },
    ]);
    expect(parseInline('==unsafe=={color=url(javascript:1)}')).toEqual([
      {
        type: 'highlight',
        children: [{ type: 'text', value: 'unsafe' }],
      },
      { type: 'text', value: '{color=url(javascript:1)}' },
    ]);
  });

  it('honours backslash escapes', () => {
    expect(parseInline('\\*literal\\*')).toEqual([
      { type: 'text', value: '*literal*' },
    ]);
  });

  it('keeps every simple line ending as one visible break', () => {
    expect(parseInline('==uau==\n[text](https://x.dev)')).toEqual([
      { type: 'highlight', children: [{ type: 'text', value: 'uau' }] },
      { type: 'break' },
      {
        type: 'link',
        url: 'https://x.dev',
        title: null,
        children: [{ type: 'text', value: 'text' }],
      },
    ]);
  });

  it('normalizes line endings and does not duplicate hard breaks', () => {
    const expected = [
      { type: 'text', value: 'one' },
      { type: 'break' },
      { type: 'text', value: 'two' },
    ];

    expect(parseMarkdown('one\r\ntwo').children[0]).toMatchObject({
      children: expected,
    });
    expect(parseMarkdown('one\rtwo').children[0]).toMatchObject({
      children: expected,
    });
    expect(parseInline('one  \ntwo')).toEqual(expected);
    expect(parseInline('one\\\ntwo')).toEqual(expected);
  });
});
