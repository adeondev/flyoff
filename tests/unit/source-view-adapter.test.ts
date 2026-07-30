// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readSelection,
  readSource,
  sourceCaretRect,
  sourceOffsetAtPoint,
  writeSelection,
} from '../../src/renderer/projects/source-caret';
import { createSourceDocumentModel } from '../../src/renderer/projects/source-document-model';
import {
  getSourceViewAdapter,
  registerSourceViewAdapter,
  type SourceViewAdapter,
  type SourceViewSelection,
  unregisterSourceViewAdapter,
} from '../../src/renderer/projects/source-engine/source-view-adapter';
import {
  getSourceChangeRange,
  getSourceDocumentModel,
  getSourceLineElements,
} from '../../src/renderer/projects/source-renderer';

const registeredRoots = new Set<HTMLElement>();

function register(
  root: HTMLElement,
  adapter: SourceViewAdapter,
): () => void {
  registeredRoots.add(root);
  return registerSourceViewAdapter(root, adapter);
}

afterEach(() => {
  for (const root of registeredRoots) {
    unregisterSourceViewAdapter(root);
  }
  registeredRoots.clear();
  document.body.replaceChildren();
});

describe('source view adapter registry', () => {
  it('keeps replacement adapters registered when stale cleanup runs', () => {
    const root = document.createElement('div');
    const model = createSourceDocumentModel('adapter');
    const first = {
      getModel: () => model,
    } as SourceViewAdapter;
    const second = {
      getModel: () => model,
    } as SourceViewAdapter;

    const unregisterFirst = register(root, first);
    register(root, second);
    unregisterFirst();

    expect(getSourceViewAdapter(root)).toBe(second);

    unregisterSourceViewAdapter(root, second);
    expect(getSourceViewAdapter(root)).toBeUndefined();
  });

  it('delegates source, selection, geometry and renderer metadata', () => {
    const root = document.createElement('div');
    const visibleLine = document.createElement('span');
    const model = createSourceDocumentModel('one\ntwo');
    const change = {
      ...model.change,
      full: false,
      startLine: 1,
    };
    const rect = visibleLine.getBoundingClientRect();
    let selection: SourceViewSelection = {
      start: 1,
      end: 4,
      direction: 'forward',
    };
    const focus = vi.fn();
    const adapter: SourceViewAdapter = {
      focus,
      getChangeRange: () => change,
      getModel: () => model,
      getVisibleLineElements: () => [visibleLine],
      readSelection: () => selection,
      sourceCaretRect: (offset) => (offset === 4 ? rect : undefined),
      sourceOffsetAtPoint: (x, y) => (x === 12 && y === 24 ? 3 : undefined),
      writeSelection: (next) => {
        selection = next;
      },
    };
    register(root, adapter);

    expect(readSource(root)).toBe('one\ntwo');
    const read = readSelection(root);
    expect(read).toEqual(selection);
    read.start = 0;
    expect(selection.start).toBe(1);
    writeSelection(root, 6, 2);
    expect(selection).toEqual({
      start: 2,
      end: 6,
      direction: 'backward',
    });
    expect(sourceOffsetAtPoint(root, 12, 24)).toBe(3);
    expect(sourceOffsetAtPoint(root, 0, 0)).toBeUndefined();
    expect(sourceCaretRect(root, 4)).toBe(rect);
    expect(getSourceDocumentModel(root)).toBe(model);
    expect(getSourceChangeRange(root)).toBe(change);
    expect(getSourceLineElements(root)).toEqual([visibleLine]);

    getSourceViewAdapter(root)?.focus();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('falls back to model change metadata and legacy DOM after unregister', () => {
    const root = document.createElement('div');
    const model = createSourceDocumentModel('virtual');
    const adapter = {
      focus: vi.fn(),
      getModel: () => model,
      readSelection: () => ({
        start: 0,
        end: 0,
        direction: 'none' as const,
      }),
      sourceCaretRect: () => undefined,
      sourceOffsetAtPoint: () => undefined,
      writeSelection: vi.fn(),
    } satisfies SourceViewAdapter;
    const unregister = register(root, adapter);

    expect(getSourceChangeRange(root)).toBe(model.change);
    expect(getSourceLineElements(root)).toBeUndefined();

    unregister();
    root.textContent = 'legacy';

    expect(readSource(root)).toBe('legacy');
    expect(getSourceDocumentModel(root)).toBeUndefined();
  });
});
