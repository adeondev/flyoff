import { describe, expect, it } from 'vitest';

import {
  emptyProjectTreeSelection,
  normalizeProjectTreeSelectionRoots,
  PROJECT_TREE_SELECTION_LIMIT,
  pruneProjectTreeSelection,
  selectAllVisibleProjectTreeNodes,
  selectProjectTreeMarquee,
  selectProjectTreeNode,
  selectProjectTreeRange,
  toggleProjectTreeNode,
} from '../../src/renderer/projects/project-tree-selection';

describe('project tree selection', () => {
  it('selects and toggles notes and folders independently', () => {
    const selected = selectProjectTreeNode('folder-a');
    const added = toggleProjectTreeNode(selected, 'note-c');
    const removed = toggleProjectTreeNode(added, 'folder-a');

    expect([...added.selectedIds]).toEqual(['folder-a', 'note-c']);
    expect([...removed.selectedIds]).toEqual(['note-c']);
    expect(removed.anchorId).toBe('folder-a');
  });

  it('replaces or adds a visible range from the stable anchor', () => {
    const visible = ['a', 'b', 'c', 'd', 'e'];
    const selection = selectProjectTreeNode('b');
    const replaced = selectProjectTreeRange(selection, visible, 'd', false);
    const additive = selectProjectTreeRange(
      { anchorId: 'd', selectedIds: new Set(['a']) },
      visible,
      'b',
      true,
    );

    expect([...replaced.selectedIds]).toEqual(['b', 'c', 'd']);
    expect([...additive.selectedIds]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('limits select all to 500 visible items', () => {
    const visible = Array.from(
      { length: PROJECT_TREE_SELECTION_LIMIT + 2 },
      (_, index) => `node-${index}`,
    );
    const selection = selectAllVisibleProjectTreeNodes(visible);

    expect(selection.selectedIds.size).toBe(PROJECT_TREE_SELECTION_LIMIT);
    expect(selection.truncated).toBe(true);
  });

  it('replaces, adds, and toggles nodes selected by a marquee', () => {
    const visible = ['a', 'b', 'c', 'd'];
    const base = { anchorId: 'a', selectedIds: new Set(['a', 'c']) };

    const replaced = selectProjectTreeMarquee(
      base,
      visible,
      new Set(['b', 'c']),
      'replace',
    );
    const added = selectProjectTreeMarquee(
      base,
      visible,
      new Set(['b', 'd']),
      'add',
    );
    const toggled = selectProjectTreeMarquee(
      base,
      visible,
      new Set(['a', 'b']),
      'toggle',
    );

    expect([...replaced.selectedIds]).toEqual(['b', 'c']);
    expect(replaced.anchorId).toBe('b');
    expect([...added.selectedIds]).toEqual(['a', 'c', 'b', 'd']);
    expect(added.anchorId).toBe('a');
    expect([...toggled.selectedIds]).toEqual(['c', 'b']);
    expect(toggled.anchorId).toBe('b');
  });

  it('applies the selection limit to a marquee once', () => {
    const visible = Array.from(
      { length: PROJECT_TREE_SELECTION_LIMIT + 2 },
      (_, index) => `node-${index}`,
    );
    const result = selectProjectTreeMarquee(
      emptyProjectTreeSelection(),
      visible,
      new Set(visible),
      'replace',
    );

    expect(result.selectedIds.size).toBe(PROJECT_TREE_SELECTION_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it('clears hidden selections and repairs the anchor', () => {
    const selection = pruneProjectTreeSelection(
      { anchorId: 'a', selectedIds: new Set(['a', 'b', 'c']) },
      new Set(['b', 'c']),
    );

    expect([...selection.selectedIds]).toEqual(['b', 'c']);
    expect(selection.anchorId).toBe('b');
    expect(
      pruneProjectTreeSelection(
        emptyProjectTreeSelection(),
        new Set(['a']),
      ).selectedIds.size,
    ).toBe(0);
  });

  it('removes descendants when their selected ancestor is already a root', () => {
    const parents = new Map<string, string | null>([
      ['folder', null],
      ['child-folder', 'folder'],
      ['note', 'child-folder'],
      ['other', null],
    ]);

    expect(
      normalizeProjectTreeSelectionRoots(
        ['note', 'folder', 'child-folder', 'other'],
        parents,
      ),
    ).toEqual(['folder', 'other']);
  });
});
