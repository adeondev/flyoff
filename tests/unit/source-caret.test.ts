// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { highlightSource } from '../../src/renderer/projects/markdown-highlight';
import {
  readSelection,
  readSource,
  replaceRange,
  writeSelection,
} from '../../src/renderer/projects/source-caret';

function mount(source: string): HTMLDivElement {
  const root = document.createElement('div');
  root.innerHTML = highlightSource(source);
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('rich source caret mapping', () => {
  it('reads back the exact source from the rendered lines', () => {
    const source = '# Hi there\n\n- [ ] task\n**bold** and `code`';

    expect(readSource(mount(source))).toBe(source);
  });

  it('round-trips a caret offset across lines', () => {
    const root = mount('one\ntwo\nthree');

    writeSelection(root, 5);
    expect(readSelection(root)).toEqual({ start: 5, end: 5 });

    writeSelection(root, 0);
    expect(readSelection(root)).toEqual({ start: 0, end: 0 });
  });

  it('round-trips a selection that spans token elements', () => {
    const root = mount('say **hello** now');

    writeSelection(root, 4, 13);
    expect(readSelection(root)).toEqual({ start: 4, end: 13 });
  });

  it('places the caret at the end when the offset runs past the source', () => {
    const root = mount('abc');

    writeSelection(root, 99);
    expect(readSelection(root)).toEqual({ start: 3, end: 3 });
  });

  it('keeps blank lines addressable', () => {
    const source = 'a\n\nb';
    const root = mount(source);

    expect(readSource(root)).toBe(source);
    writeSelection(root, 2);
    expect(readSelection(root)).toEqual({ start: 2, end: 2 });
  });

  it('replaces a source range', () => {
    expect(replaceRange('one two', 4, 7, 'three')).toBe('one three');
    expect(replaceRange('ab', 1, 1, '\n')).toBe('a\nb');
  });
});
