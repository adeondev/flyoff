// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspacePaneHost,
  type WorkspacePaneHostHandle,
} from '../../src/renderer/components/tabs/WorkspacePaneHost';
import { splitPane } from '../../src/renderer/components/tabs/pane-state';
import type {
  TabDescriptor,
  WorkspaceLayoutSnapshot,
} from '../../src/shared/contracts';

afterEach(cleanup);

const noteTab: TabDescriptor = {
  tabId: 'project:p1:node:n1',
  target: {
    type: 'project-content',
    projectId: 'p1',
    nodeId: 'n1',
    pageType: 'markdown',
  },
  scrollTop: 1200,
  pageState: { version: 1, data: null },
};

const singlePane = {
  root: {
    kind: 'pane',
    paneId: 'pane-1',
    tabs: [noteTab],
    activeTabId: noteTab.tabId,
  },
  activePaneId: 'pane-1',
} as const;

const mounts: string[] = [];

function ProbePage({ tabId }: { tabId: string }) {
  useEffect(() => {
    mounts.push(tabId);
  }, [tabId]);
  return <div data-testid={`page-${tabId}`}>page</div>;
}

function renderHost(
  root: WorkspaceLayoutSnapshot,
  activePaneId: string,
  ref?: React.Ref<WorkspacePaneHostHandle>,
) {
  return (
    <WorkspacePaneHost
      activePaneId={activePaneId}
      closeLabel="Close"
      getPresentation={({ tabId }) => ({ title: tabId })}
      navigationLabel="Tabs"
      onClosePane={vi.fn()}
      onCloseTab={vi.fn()}
      onMoveTab={vi.fn()}
      onMoveTabBetweenPanes={vi.fn()}
      onOpenTarget={vi.fn()}
      onOpenTargets={vi.fn()}
      onPageStateChange={vi.fn()}
      onResizeSplit={vi.fn()}
      onScrollChange={vi.fn()}
      onSelectPane={vi.fn()}
      onSelectTab={vi.fn()}
      onSplitPane={vi.fn()}
      onSplitPaneWithTab={vi.fn()}
      onSplitPaneWithTarget={vi.fn()}
      onSplitPaneWithTargets={vi.fn()}
      ref={ref}
      renderPage={({ descriptor }) => (
        <ProbePage tabId={descriptor.tabId} />
      )}
      root={root}
      translate={(key) => key}
    />
  );
}

function paneElement(paneId: string): HTMLElement {
  const pane = document.querySelector<HTMLElement>(
    `.workspace-pane[data-pane-id="${paneId}"]`,
  );
  if (!pane) {
    throw new Error(`missing pane ${paneId}`);
  }
  return pane;
}

describe('workspace pane identity across layout changes', () => {
  it('keeps a pane and its page element mounted when the workspace is split', () => {
    mounts.length = 0;
    const view = render(
      renderHost(singlePane.root, singlePane.activePaneId),
    );
    expect(mounts).toEqual([noteTab.tabId]);
    const pane = paneElement('pane-1');
    const panel = pane.querySelector('.page-panel');
    // Scroll position lives on the DOM node, not in React state, so keeping
    // the node is what keeps the note where the reader left it.
    const page = view.getByTestId(`page-${noteTab.tabId}`);
    page.dataset.nativeState = 'scrolled';

    const split = splitPane(singlePane, 'pane-1', 'row');
    view.rerender(renderHost(split.root, split.activePaneId));

    // A remount would drop the editor's scroll position and selection, and
    // flash while a large note re-renders.
    expect(mounts.filter((id) => id === noteTab.tabId)).toHaveLength(1);
    expect(paneElement('pane-1')).toBe(pane);
    expect(pane.querySelector('.page-panel')).toBe(panel);
    expect(
      view.getByTestId(`page-${noteTab.tabId}`).dataset.nativeState,
    ).toBe('scrolled');
  });

  it('keeps the surviving pane mounted when a split is collapsed', () => {
    mounts.length = 0;
    const split = splitPane(singlePane, 'pane-1', 'row');
    const view = render(renderHost(split.root, split.activePaneId));
    mounts.length = 0;
    const pane = paneElement('pane-1');

    view.rerender(renderHost(singlePane.root, singlePane.activePaneId));

    expect(mounts.filter((id) => id === noteTab.tabId)).toHaveLength(0);
    expect(paneElement('pane-1')).toBe(pane);
  });

  it('grows the new pane out of the split edge instead of snapping it in', async () => {
    const view = render(
      renderHost(singlePane.root, singlePane.activePaneId),
    );
    const split = splitPane(singlePane, 'pane-1', 'row');
    const [newPaneId] = [split.activePaneId];

    view.rerender(renderHost(split.root, split.activePaneId));

    // The first frame paints the new pane collapsed against the split edge,
    // with transitions still off, so nothing animates backwards into place.
    const host = document.querySelector<HTMLElement>('.workspace-pane-host')!;
    expect(host.dataset.workspaceMotion).toBeUndefined();
    expect(paneElement(newPaneId).style.width).toBe('0px');
    expect(paneElement('pane-1').style.width).toBe('100%');

    // Frame two arms the transitions without moving anything…
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(host.dataset.workspaceMotion).toBe('entry');
    expect(host.style.getPropertyValue('--workspace-pane-motion-duration'))
      .toBe('120ms');
    expect(paneElement(newPaneId).dataset.paneEntry).toBe('row-end');
    expect(paneElement(newPaneId).style.width).toBe('0px');

    // …and frame three lets the layout settle, which is the travel itself.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(paneElement('pane-1').style.width).toBe('50%');
    expect(paneElement(newPaneId).style.width).toBe('calc(50% - 5px)');
  });

  it('collapses a closing pane before the close lands', async () => {
    const ref = createRef<WorkspacePaneHostHandle>();
    const split = splitPane(singlePane, 'pane-1', 'row');
    const view = render(
      renderHost(split.root, split.activePaneId, ref),
    );
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    let exit!: Promise<void>;
    act(() => {
      exit = ref.current!.animatePaneExit(split.activePaneId, 80);
    });
    // The first frame only arms the transitions; nothing has moved yet.
    const host = document.querySelector<HTMLElement>('.workspace-pane-host')!;
    expect(host.dataset.workspaceMotion).toBe('exit');
    expect(host.style.getPropertyValue('--workspace-pane-motion-duration'))
      .toBe('80ms');
    expect(paneElement(split.activePaneId).dataset.paneExiting).toBeUndefined();
    expect(paneElement(split.activePaneId).style.width).toBe('calc(50% - 5px)');

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(paneElement(split.activePaneId).dataset.paneExiting).toBe('true');
    expect(paneElement(split.activePaneId).style.width).toBe('0px');
    expect(paneElement('pane-1').style.width).toBe('100%');
    await act(async () => {
      await exit;
    });

    view.rerender(renderHost(singlePane.root, singlePane.activePaneId));
    expect(
      document.querySelector<HTMLElement>('.workspace-pane-host')!.dataset
        .workspaceMotion,
    ).toBeUndefined();
    expect(paneElement('pane-1').style.width).toBe('100%');
  });
});
