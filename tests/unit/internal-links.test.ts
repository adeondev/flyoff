import { describe, expect, it } from 'vitest';

import {
  extractMarkdownStructure,
  parseInternalLinkDestination,
} from '../../src/shared/markdown';

describe('internal Markdown links', () => {
  it('decodes paths and hierarchical headings in both supported syntaxes', () => {
    expect(
      parseInternalLinkDestination(
        '../Notas/Vis%C3%A3o%20geral.md#Pai#Filho%20um',
        'markdown',
      ),
    ).toEqual({
      headingPath: ['Pai', 'Filho um'],
      path: '../Notas/Visão geral.md',
    });
    expect(
      parseInternalLinkDestination(
        'Notas/Vis%C3%A3o%20geral#Pai#Filho%20um',
        'wikilink',
      ),
    ).toEqual({
      headingPath: ['Pai', 'Filho um'],
      path: 'Notas/Visão geral',
    });
  });

  it('rejects external schemes, malformed encoding and empty destinations', () => {
    expect(
      parseInternalLinkDestination('https://example.com', 'markdown'),
    ).toBeNull();
    expect(parseInternalLinkDestination('Nota%ZZ.md', 'markdown')).toBeNull();
    expect(parseInternalLinkDestination('', 'wikilink')).toBeNull();
  });

  it('returns exact offsets and ignores links inside code and embeds', () => {
    const source = [
      'before [label](<Folder/Long Note.md#Parent#Child> "title") after',
      '[[Folder/Wiki#Heading|shown]]',
      '`[inline](Ignored.md)` and ![image](Ignored.md)',
      '![[Embedded]]',
      '```md',
      '[fenced](Ignored.md)',
      '```',
    ].join('\n');
    const { links } = extractMarkdownStructure(source);

    expect(links).toHaveLength(2);
    expect(links.map(({ destination, label, syntax }) => ({
      destination,
      label,
      syntax,
    }))).toEqual([
      {
        destination: 'Folder/Long Note.md#Parent#Child',
        label: 'label',
        syntax: 'markdown',
      },
      {
        destination: 'Folder/Wiki#Heading',
        label: 'shown',
        syntax: 'wikilink',
      },
    ]);
    for (const link of links) {
      expect(source.slice(link.destinationStart, link.destinationEnd)).toBe(
        link.destination,
      );
      expect(source.slice(link.start, link.end)).toContain(link.destination);
    }
    expect(links[0]).toMatchObject({
      column: 8,
      headingPath: ['Parent', 'Child'],
      line: 1,
      path: 'Folder/Long Note.md',
    });
  });

  it('extracts heading hierarchy and source offsets', () => {
    const source = [
      '# Parent',
      'text',
      '## Child',
      '### Grandchild',
      '## Sibling',
    ].join('\n');
    const { headings } = extractMarkdownStructure(source);

    expect(
      headings.map(({ depth, line, path, text }) => ({
        depth,
        line,
        path,
        text,
      })),
    ).toEqual([
      { depth: 1, line: 1, path: ['Parent'], text: 'Parent' },
      {
        depth: 2,
        line: 3,
        path: ['Parent', 'Child'],
        text: 'Child',
      },
      {
        depth: 3,
        line: 4,
        path: ['Parent', 'Child', 'Grandchild'],
        text: 'Grandchild',
      },
      {
        depth: 2,
        line: 5,
        path: ['Parent', 'Sibling'],
        text: 'Sibling',
      },
    ]);
    for (const heading of headings) {
      expect(source.slice(heading.offset, heading.offset + heading.depth)).toBe(
        '#'.repeat(heading.depth),
      );
    }
  });
});
