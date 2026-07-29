// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { highlightSource } from '../../src/renderer/projects/markdown-highlight';
import {
  focusSource,
  readSelection,
  readSource,
  registerSourceCaretAdapter,
  replaceRange,
  sourceCaretRect,
  sourceOffsetAtPoint,
  writeSelection,
} from '../../src/renderer/projects/source-caret';
import { reconcileSource } from '../../src/renderer/projects/source-renderer';

function mount(source: string): HTMLDivElement {
  const root = document.createElement('div');
  root.innerHTML = highlightSource(source);
  document.body.append(root);
  return root;
}

function mountReconciled(source: string): HTMLDivElement {
  const root = document.createElement('div');
  reconcileSource(root, source);
  document.body.append(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('rich source caret mapping', () => {
  it('routes caret operations through an optional surface adapter', () => {
    const root = mount('fallback');
    const write = vi.fn();
    const focus = vi.fn();
    const rect = new DOMRect(1, 2, 3, 4);
    const unregister = registerSourceCaretAdapter(root, {
      focus,
      readSelection: () => ({
        start: 2,
        end: 5,
        direction: 'forward',
      }),
      readSource: () => 'virtual source',
      sourceCaretRect: () => rect,
      sourceOffsetAtPoint: () => 7,
      writeSelection: write,
    });

    expect(readSource(root)).toBe('virtual source');
    expect(readSelection(root)).toEqual({
      start: 2,
      end: 5,
      direction: 'forward',
    });
    expect(sourceOffsetAtPoint(root, 10, 20)).toBe(7);
    expect(sourceCaretRect(root, 3)).toBe(rect);
    writeSelection(root, 5, 2);
    expect(write).toHaveBeenCalledWith({
      start: 2,
      end: 5,
      direction: 'backward',
    });
    focusSource(root, { preventScroll: true });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });

    unregister();
    expect(readSource(root)).toBe('fallback');
  });

  it('reads back the exact source from the rendered lines', () => {
    const source = '# Hi there\n\n- [ ] task\n**bold** and `code`';

    expect(readSource(mount(source))).toBe(source);
  });

  it('round-trips a caret offset across lines', () => {
    const root = mount('one\ntwo\nthree');

    writeSelection(root, 5);
    expect(readSelection(root)).toEqual({
      start: 5,
      end: 5,
      direction: 'none',
    });

    writeSelection(root, 0);
    expect(readSelection(root)).toEqual({
      start: 0,
      end: 0,
      direction: 'none',
    });
  });

  it('round-trips a selection that spans token elements', () => {
    const root = mount('say **hello** now');

    writeSelection(root, 4, 13);
    expect(readSelection(root)).toEqual({
      start: 4,
      end: 13,
      direction: 'forward',
    });
  });

  it('places the caret at the end when the offset runs past the source', () => {
    const root = mount('abc');

    writeSelection(root, 99);
    expect(readSelection(root)).toEqual({
      start: 3,
      end: 3,
      direction: 'none',
    });
  });

  it('keeps blank lines addressable', () => {
    const source = 'a\n\nb';
    const root = mount(source);

    expect(readSource(root)).toBe(source);
    writeSelection(root, 2);
    expect(readSelection(root)).toEqual({
      start: 2,
      end: 2,
      direction: 'none',
    });
  });

  it('ignores real gutter cells and empty-line sentinels', () => {
    const root = mount('a\n');
    const gutter = root.querySelector('.md-line__gutter')!;

    expect(readSource(root)).toBe('a\n');
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(gutter);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(readSelection(root).start).toBe(0);
  });

  it('serializes internal breaks and transient Chromium blocks', () => {
    const root = document.createElement('div');
    root.innerHTML =
      'alpha<div>beta<br>gamma</div><p><strong>delta</strong></p>';

    expect(readSource(root)).toBe('alpha\nbeta\ngamma\ndelta');
  });

  it('counts Chromium empty-block sentinels as empty logical lines', () => {
    const root = document.createElement('div');

    root.innerHTML = 'a<div><br></div>';
    expect(readSource(root)).toBe('a\n');

    root.innerHTML = '<div>a</div><div><br></div><div>b</div>';
    expect(readSource(root)).toBe('a\n\nb');
  });

  it('maps a root-container caret to the source boundary', () => {
    const root = mount('one\ntwo\nthree');
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.setStart(root, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(readSelection(root)).toEqual({
      start: 4,
      end: 4,
      direction: 'none',
    });
  });

  it('preserves backward selections and UTF-16 emoji offsets', () => {
    const root = mount('a😀b\n**bold**');

    writeSelection(root, {
      start: 1,
      end: 10,
      direction: 'backward',
    });
    expect(readSelection(root)).toEqual({
      start: 1,
      end: 10,
      direction: 'backward',
    });

    writeSelection(root, 3);
    expect(readSelection(root)).toEqual({
      start: 3,
      end: 3,
      direction: 'none',
    });
  });

  it('ignores decoration text when writing a modeled selection', () => {
    const root = mountReconciled('abc');
    const content = root.querySelector('.md-line__content')!;
    content.innerHTML =
      'a<span data-md-decoration>transient</span>bc';

    writeSelection(root, 2);

    expect(readSelection(root)).toEqual({
      start: 2,
      end: 2,
      direction: 'none',
    });
    expect(document.getSelection()?.focusNode?.textContent).toBe('bc');
    expect(document.getSelection()?.focusOffset).toBe(1);
  });

  it('maps a modeled multi-thousand-line selection without materializing every row', () => {
    const source = Array.from(
      { length: 2_000 },
      (_, index) => `line ${index}`,
    ).join('\n');
    const root = mountReconciled(source);
    const rootChildNodes = root.childNodes;
    const arrayFrom = vi.spyOn(Array, 'from');
    const target = source.length - 4;

    writeSelection(root, {
      start: target - 3,
      end: target,
      direction: 'backward',
    });
    expect(readSelection(root)).toEqual({
      start: target - 3,
      end: target,
      direction: 'backward',
    });

    expect(
      arrayFrom.mock.calls.some(([value]) => value === rootChildNodes),
    ).toBe(false);
  });

  it('maps a caret after a transient internal br', () => {
    const root = mount('one');
    const content = root.querySelector('.md-line__content')!;
    content.innerHTML = 'one<br>two';
    const text = content.lastChild!;
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(readSource(root)).toBe('one\ntwo');
    expect(readSelection(root)).toEqual({
      start: 5,
      end: 5,
      direction: 'none',
    });
  });

  it('clamps a selection that extends outside the editor', () => {
    const before = document.createElement('span');
    const root = mount('one\ntwo');
    const after = document.createElement('span');
    before.textContent = 'before';
    after.textContent = 'after';
    root.before(before);
    root.after(after);
    const firstText = root.querySelector('.md-line__content')?.firstChild;
    const selection = document.getSelection()!;

    selection.setBaseAndExtent(before.firstChild!, 0, firstText!, 2);
    expect(readSelection(root)).toEqual({
      start: 0,
      end: 2,
      direction: 'forward',
    });

    selection.setBaseAndExtent(firstText!, 1, after.firstChild!, 5);
    expect(readSelection(root)).toEqual({
      start: 1,
      end: 7,
      direction: 'forward',
    });
  });

  it('replaces a source range', () => {
    expect(replaceRange('one two', 4, 7, 'three')).toBe('one three');
    expect(replaceRange('ab', 1, 1, '\n')).toBe('a\nb');
  });
});
