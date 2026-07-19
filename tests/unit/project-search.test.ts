import { describe, expect, it } from 'vitest';

import { parseProjectSearchQuery } from '../../src/shared/project-search';

describe('project search query', () => {
  it('parses text, path, tags, grouped scopes and properties', () => {
    expect(
      parseProjectSearchQuery(
        'road map path:"Folder One" tag:work line:(same line) section:(same section) [status:done] [owner]:Gabriel',
      ),
    ).toEqual([
      { kind: 'text', terms: ['road', 'map'] },
      { kind: 'path', terms: ['Folder One'] },
      { kind: 'tag', terms: ['work'] },
      { kind: 'line', terms: ['same', 'line'] },
      { kind: 'section', terms: ['same', 'section'] },
      { kind: 'property', name: 'status', terms: ['done'] },
      { kind: 'property', name: 'owner', terms: ['Gabriel'] },
    ]);
  });

  it('accepts property existence and unfinished grouped input', () => {
    expect(parseProjectSearchQuery('[aliases] line:(alpha beta')).toEqual([
      { kind: 'property', name: 'aliases', terms: [] },
      { kind: 'line', terms: ['alpha', 'beta'] },
    ]);
  });
});
