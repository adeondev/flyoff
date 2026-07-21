import { describe, expect, it } from 'vitest';

import type { ProjectTreeNode } from '../../src/shared/contracts';
import { projectTreeNodeEqual } from '../../src/renderer/projects/project-node-equality';

function page(overrides: Partial<ProjectTreeNode> = {}): ProjectTreeNode {
  return {
    canContainChildren: false,
    hasChildren: false,
    kind: 'page',
    name: 'Nota',
    nodeId: 'a',
    parentId: null,
    pageType: 'markdown',
    ...overrides,
  } as ProjectTreeNode;
}

describe('projectTreeNodeEqual', () => {
  it('treats distinct but structurally identical nodes as equal', () => {
    expect(projectTreeNodeEqual(page(), page())).toBe(true);
  });

  it('detects a rename', () => {
    expect(projectTreeNodeEqual(page(), page({ name: 'Outra' }))).toBe(false);
  });

  it('detects a move (parent change)', () => {
    expect(projectTreeNodeEqual(page(), page({ parentId: 'x' }))).toBe(false);
  });

  it('detects a changed page type', () => {
    expect(projectTreeNodeEqual(page(), page({ pageType: 'canvas' }))).toBe(
      false,
    );
  });

  it('detects a changed hasChildren flag', () => {
    expect(projectTreeNodeEqual(page(), page({ hasChildren: true }))).toBe(
      false,
    );
  });

  it('distinguishes folders from pages', () => {
    const folder: ProjectTreeNode = {
      canContainChildren: true,
      hasChildren: false,
      kind: 'folder',
      name: 'Nota',
      nodeId: 'a',
      parentId: null,
    };
    expect(projectTreeNodeEqual(folder, page())).toBe(false);
  });
});
