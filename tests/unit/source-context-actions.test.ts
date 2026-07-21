// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { highlightSource } from '../../src/renderer/projects/markdown-highlight';
import {
  applySourceLineAction,
  createSourceMenuRequest,
  sourceSpellingAtOffset,
  toggleSourceTask,
} from '../../src/renderer/projects/source-context-actions';
import { writeSelection } from '../../src/renderer/projects/source-caret';

function mount(source: string): HTMLDivElement {
  const root = document.createElement('div');
  root.innerHTML = highlightSource(source);
  document.body.append(root);
  return root;
}

describe('source context actions', () => {
  it('finds task and link context without changing the Markdown source', () => {
    const source = '- [x] done\n[site](https://example.com)';
    const root = mount(source);
    writeSelection(root, 0);

    const task = createSourceMenuRequest(
      root,
      root.querySelector('.md-tok-task'),
      { x: 10, y: 20 },
    );
    expect(task.content).toBe(source);
    expect(task.task).toEqual({ checked: true, markerOffset: 3 });
    expect(task.position).toEqual({ x: 10, y: 20 });

    const link = createSourceMenuRequest(
      root,
      root.querySelector('.md-source-link'),
      { x: 30, y: 40 },
    );
    expect(link.link).toEqual({
      end: source.indexOf('https://example.com') + 'https://example.com'.length,
      headingPath: [],
      internal: false,
      path: '',
      start: source.indexOf('https://example.com'),
      syntax: 'markdown',
      url: 'https://example.com',
    });
  });

  it('finds Markdown and wikilink destinations as internal links', () => {
    for (const [source, path] of [
      ['[child](Folder/Note.md#Parent#Child)', 'Folder/Note.md'],
      ['[[Folder/Note#Parent#Child|alias]]', 'Folder/Note'],
    ] as const) {
      const root = mount(source);
      const request = createSourceMenuRequest(
        root,
        root.querySelector('.md-source-link'),
        { x: 0, y: 0 },
      );

      expect(request.link).toMatchObject({
        headingPath: ['Parent', 'Child'],
        internal: true,
        path,
      });
      root.remove();
    }
  });

  it('duplicates, deletes and moves the selected logical line', () => {
    const selection = { direction: 'none' as const, start: 5, end: 5 };

    expect(
      applySourceLineAction('duplicate', 'one\ntwo\nthree', selection)?.content,
    ).toBe('one\ntwo\ntwo\nthree');
    expect(
      applySourceLineAction('delete', 'one\ntwo\nthree', selection)?.content,
    ).toBe('one\nthree');
    expect(
      applySourceLineAction('move-up', 'one\ntwo\nthree', selection)?.content,
    ).toBe('two\none\nthree');
    expect(
      applySourceLineAction('move-down', 'one\ntwo\nthree', selection)?.content,
    ).toBe('one\nthree\ntwo');
  });

  it('toggles only the task marker and preserves the selection', () => {
    const selection = { direction: 'none' as const, start: 7, end: 7 };
    const checked = toggleSourceTask('- [ ] task', selection, {
      checked: false,
      markerOffset: 3,
    });

    expect(checked).toEqual({
      content: '- [x] task',
      selection,
    });
    expect(
      toggleSourceTask(checked!.content, selection, {
        checked: true,
        markerOffset: 3,
      })?.content,
    ).toBe('- [ ] task');
  });

  it('finds accented and hyphenated words with exact replacement offsets', () => {
    const source = 'Uma configura\u00e7\u00e3o bem-escrita';

    expect(sourceSpellingAtOffset(source, source.indexOf('config') + 2)).toEqual({
      word: 'configura\u00e7\u00e3o',
      start: 4,
      end: 16,
    });
    expect(
      sourceSpellingAtOffset(source, source.indexOf('bem-escrita') + 5),
    ).toMatchObject({ word: 'bem-escrita' });
  });
});
