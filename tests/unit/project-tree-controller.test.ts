import { describe, expect, it, vi } from 'vitest';

import { ProjectTreeController } from '../../src/renderer/projects/project-tree-controller';
import type { ProjectTreeNode } from '../../src/shared/contracts';

function folder(nodeId: string, parentId: string | null): ProjectTreeNode {
  return { kind: 'folder', name: nodeId, nodeId, parentId };
}

describe('ProjectTreeController branch operations', () => {
  it('expands breadth-first with bounded concurrency and collapses one branch', async () => {
    const branches = new Map<string | null, readonly ProjectTreeNode[]>([
      [null, [folder('a', null), folder('b', null)]],
      ['a', [folder('c', 'a'), folder('d', 'a')]],
      ['b', [folder('e', 'b')]],
      ['c', [folder('f', 'c')]],
      ['d', []],
      ['e', []],
      ['f', []],
    ]);
    let activeLoads = 0;
    let maximumActiveLoads = 0;
    const loadChildren = vi.fn(async ({ parentId }: { parentId: string | null }) => {
      activeLoads += 1;
      maximumActiveLoads = Math.max(maximumActiveLoads, activeLoads);
      await Promise.resolve();
      activeLoads -= 1;
      return { ok: true as const, value: branches.get(parentId) ?? [] };
    });
    const controller = new ProjectTreeController(loadChildren);

    const result = await controller.expandBranch(null);

    expect(result).toEqual({
      expandedCount: 6,
      processedCount: 6,
      truncated: false,
    });
    expect(maximumActiveLoads).toBeLessThanOrEqual(4);
    expect(['a', 'b', 'c', 'd', 'e', 'f'].every((id) => controller.isExpanded(id)))
      .toBe(true);
    expect(controller.canExpandBranch(null)).toBe(false);

    expect(controller.collapseBranch('a')).toBe(4);
    expect(['a', 'c', 'd', 'f'].some((id) => controller.isExpanded(id)))
      .toBe(false);
    expect(controller.isExpanded('b')).toBe(true);
    expect(controller.isExpanded('e')).toBe(true);
    expect(controller.canCollapseBranch('a')).toBe(false);
    expect(controller.canCollapseBranch(null)).toBe(true);
  });

  it('stops recursive expansion at the supplied safety limit', async () => {
    const branches = new Map<string | null, readonly ProjectTreeNode[]>([
      [null, [folder('a', null)]],
      ['a', [folder('b', 'a')]],
      ['b', [folder('c', 'b')]],
      ['c', [folder('d', 'c')]],
      ['d', []],
    ]);
    const controller = new ProjectTreeController(
      vi.fn(async ({ parentId }) => ({
        ok: true as const,
        value: branches.get(parentId) ?? [],
      })),
    );

    await expect(controller.expandBranch(null, 3)).resolves.toEqual({
      expandedCount: 3,
      processedCount: 3,
      truncated: true,
    });
    expect(controller.isExpanded('a')).toBe(true);
    expect(controller.isExpanded('b')).toBe(true);
    expect(controller.isExpanded('c')).toBe(true);
    expect(controller.isExpanded('d')).toBe(false);
  });
});
