import { describe, expect, it } from 'vitest';

import {
  collapsedWorkspaceRatios,
  flattenWorkspaceLayout,
  resolveWorkspaceLength,
  workspaceBoxStyle,
  workspaceLengthCss,
} from '../../src/renderer/components/tabs/workspace-layout';
import type {
  TabDescriptor,
  WorkspaceLayoutSnapshot,
} from '../../src/shared/contracts';

const tab: TabDescriptor = {
  tabId: 'page:home',
  target: { type: 'internal', pageId: 'home' },
  scrollTop: 0,
  pageState: { version: 1, data: null },
};

function pane(paneId: string): WorkspaceLayoutSnapshot {
  return { kind: 'pane', paneId, tabs: [tab], activeTabId: tab.tabId };
}

function split(
  splitId: string,
  direction: 'row' | 'column',
  first: WorkspaceLayoutSnapshot,
  second: WorkspaceLayoutSnapshot,
  ratio = 0.5,
): WorkspaceLayoutSnapshot {
  return { kind: 'split', splitId, direction, ratio, first, second };
}

function styleOf(
  entries: ReturnType<typeof flattenWorkspaceLayout>,
  id: string,
) {
  const entry = entries.find((candidate) =>
    candidate.kind === 'pane'
      ? candidate.node.paneId === id
      : candidate.node.splitId === id,
  );
  if (!entry) {
    throw new Error(`missing layout entry ${id}`);
  }
  return workspaceBoxStyle(entry.box);
}

describe('workspace layout flattening', () => {
  it('gives a lone pane the whole host', () => {
    const entries = flattenWorkspaceLayout(pane('pane-1'));

    expect(entries).toHaveLength(1);
    expect(styleOf(entries, 'pane-1')).toEqual({
      height: '100%',
      left: '0px',
      top: '0px',
      width: '100%',
    });
  });

  it('lays a row split out as pane, divider, pane in reading order', () => {
    const entries = flattenWorkspaceLayout(
      split('split-1', 'row', pane('pane-1'), pane('pane-2')),
    );

    expect(
      entries.map((entry) =>
        entry.kind === 'pane' ? entry.node.paneId : entry.node.splitId,
      ),
    ).toEqual(['pane-1', 'split-1', 'pane-2']);
    expect(styleOf(entries, 'pane-1')).toEqual({
      height: '100%',
      left: '0px',
      top: '0px',
      width: '50%',
    });
    expect(styleOf(entries, 'split-1')).toEqual({
      height: '100%',
      left: '50%',
      top: '0px',
      width: '5px',
    });
    expect(styleOf(entries, 'pane-2')).toEqual({
      height: '100%',
      left: 'calc(50% + 5px)',
      top: '0px',
      width: 'calc(50% - 5px)',
    });
  });

  it('stacks a column split without touching the horizontal axis', () => {
    const entries = flattenWorkspaceLayout(
      split('split-1', 'column', pane('pane-1'), pane('pane-2'), 0.25),
    );

    expect(styleOf(entries, 'pane-1')).toMatchObject({
      height: '25%',
      top: '0px',
      width: '100%',
    });
    expect(styleOf(entries, 'split-1')).toMatchObject({
      height: '5px',
      top: '25%',
    });
    expect(styleOf(entries, 'pane-2')).toMatchObject({
      height: 'calc(75% - 5px)',
      top: 'calc(25% + 5px)',
      width: '100%',
    });
  });

  it('keeps nested panes edge to edge', () => {
    const entries = flattenWorkspaceLayout(
      split(
        'split-1',
        'row',
        pane('pane-1'),
        split('split-2', 'row', pane('pane-2'), pane('pane-3')),
      ),
    );
    const host = 1000;
    const spans = entries.map((entry) => ({
      left: resolveWorkspaceLength(entry.box.left, host),
      width: resolveWorkspaceLength(entry.box.width, host),
    }));

    for (const [index, span] of spans.entries()) {
      const next = spans[index + 1];
      if (next) {
        expect(span.left + span.width).toBeCloseTo(next.left, 6);
      }
    }
    const last = spans.at(-1)!;
    expect(last.left + last.width).toBeCloseTo(host, 6);
    expect(spans.every(({ width }) => width > 0)).toBe(true);
  });

  it('marks only the outermost edges of the workspace', () => {
    const entries = flattenWorkspaceLayout(
      split(
        'split-1',
        'row',
        pane('pane-1'),
        split('split-2', 'column', pane('pane-2'), pane('pane-3')),
      ),
    );
    const edges = Object.fromEntries(
      entries.flatMap((entry) =>
        entry.kind === 'pane'
          ? [[entry.node.paneId, [entry.top, entry.left, entry.right]]]
          : [],
      ),
    );

    expect(edges).toEqual({
      'pane-1': [true, true, false],
      'pane-2': [true, false, true],
      'pane-3': [false, false, true],
    });
  });

  it('collapses the branch that holds only the named panes', () => {
    const root = split(
      'split-1',
      'row',
      pane('pane-1'),
      split('split-2', 'row', pane('pane-2'), pane('pane-3')),
    );

    expect([...collapsedWorkspaceRatios(root, new Set(['pane-1']))]).toEqual([
      ['split-1', 0],
    ]);
    expect([...collapsedWorkspaceRatios(root, new Set(['pane-3']))]).toEqual([
      ['split-2', 1],
    ]);
    expect([
      ...collapsedWorkspaceRatios(root, new Set(['pane-2', 'pane-3'])),
    ]).toEqual([['split-1', 1]]);
    expect([...collapsedWorkspaceRatios(root, new Set())]).toEqual([]);
  });

  it('parks a collapsed pane at zero size on its own edge', () => {
    const root = split('split-1', 'row', pane('pane-1'), pane('pane-2'));
    const collapsed = flattenWorkspaceLayout(
      root,
      collapsedWorkspaceRatios(root, new Set(['pane-2'])),
    );

    expect(styleOf(collapsed, 'pane-1')).toMatchObject({
      left: '0px',
      width: '100%',
    });
    expect(styleOf(collapsed, 'pane-2')).toMatchObject({ width: '0px' });
  });

  it('never emits a negative length', () => {
    expect(workspaceLengthCss({ fraction: 0, px: -5 })).toBe('0px');
    expect(workspaceLengthCss({ fraction: 0.5, px: -5 })).toBe(
      'calc(50% - 5px)',
    );
    expect(resolveWorkspaceLength({ fraction: 0.25, px: -5 }, 400)).toBe(95);
  });
});
