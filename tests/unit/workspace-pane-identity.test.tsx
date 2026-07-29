// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspacePaneHost,
  type WorkspacePaneHostHandle,
} from '../../src/renderer/components/tabs/WorkspacePaneHost';
import {
  collectPanes,
  splitPane,
} from '../../src/renderer/components/tabs/pane-state';
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
    const originalContent = paneElement('pane-1').querySelector<HTMLElement>(
      ':scope > .workspace-pane__content',
    )!;
    vi.spyOn(originalContent, 'getBoundingClientRect').mockReturnValue({
      bottom: 644,
      height: 600,
      left: 0,
      right: 1000,
      top: 44,
      width: 1000,
      x: 0,
      y: 44,
      toJSON: () => ({}),
    });
    const split = splitPane(singlePane, 'pane-1', 'row');
    const [newPaneId] = [split.activePaneId];
    const newTabId = collectPanes(split.root).find(
      ({ paneId }) => paneId === newPaneId,
    )?.activeTabId;

    view.rerender(renderHost(split.root, split.activePaneId));

    // The first frame paints the new pane collapsed against the split edge,
    // with transitions still off, so nothing animates backwards into place.
    const host = document.querySelector<HTMLElement>('.workspace-pane-host')!;
    expect(host.dataset.workspaceMotion).toBeUndefined();
    expect(paneElement(newPaneId).style.width).toBe('0px');
    expect(paneElement('pane-1').style.width).toBe('100%');
    expect(
      paneElement(newPaneId).querySelector('.page-host'),
    ).toBeNull();
    expect(mounts).toEqual([noteTab.tabId]);

    // Frame two arms the transitions without moving anything…
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(host.dataset.workspaceMotion).toBe('entry');
    expect(host.style.getPropertyValue('--workspace-pane-motion-duration'))
      .toBe('120ms');
    expect(paneElement(newPaneId).dataset.paneEntry).toBe('row-end');
    expect(paneElement(newPaneId).style.width).toBe('0px');
    expect(originalContent.dataset.motionLocked).toBe('');
    expect(originalContent.style.width).toBe('1000px');
    expect(originalContent.style.height).toBe('600px');

    // …and frame three lets the layout settle, which is the travel itself.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(paneElement('pane-1').style.width).toBe('50%');
    expect(paneElement(newPaneId).style.width).toBe('calc(50% - 5px)');
    expect(
      paneElement(newPaneId).querySelector('.page-host'),
    ).toBeNull();

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });

    expect(originalContent.dataset.motionLocked).toBeUndefined();
    expect(originalContent.style.width).toBe('');
    expect(
      paneElement(newPaneId).querySelector('.page-host'),
    ).not.toBeNull();
    expect(mounts).toEqual([noteTab.tabId, newTabId]);
  });

  it('mounts the entering page immediately when motion is reduced', async () => {
    document.documentElement.dataset.motion = 'reduced';
    const view = render(
      renderHost(singlePane.root, singlePane.activePaneId),
    );
    const split = splitPane(singlePane, 'pane-1', 'row');

    view.rerender(renderHost(split.root, split.activePaneId));
    await act(async () => Promise.resolve());

    expect(
      paneElement(split.activePaneId).querySelector('.page-host'),
    ).not.toBeNull();
    expect(
      document.querySelector('.workspace-pane-host')?.getAttribute(
        'data-workspace-motion',
      ),
    ).toBeNull();
    delete document.documentElement.dataset.motion;
  });

  it('settles every pane when reduced motion supersedes an entry', async () => {
    vi.useFakeTimers();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        const frameId = nextFrameId++;
        frames.set(frameId, callback);
        return frameId;
      });
    const cancelFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((frameId) => {
        frames.delete(frameId);
      });
    const runNextFrame = (): void => {
      const frame = frames.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      expect(frame).toBeDefined();
      frames.delete(frame![0]);
      act(() => frame![1](performance.now()));
    };
    mounts.length = 0;
    const view = render(
      renderHost(singlePane.root, singlePane.activePaneId),
    );

    try {
      const firstSplit = splitPane(singlePane, 'pane-1', 'row');
      view.rerender(
        renderHost(firstSplit.root, firstSplit.activePaneId),
      );
      runNextFrame();
      runNextFrame();

      document.documentElement.dataset.motion = 'reduced';
      const secondSplit = splitPane(
        firstSplit,
        firstSplit.activePaneId,
        'column',
      );
      view.rerender(
        renderHost(secondSplit.root, secondSplit.activePaneId),
      );
      await act(async () => Promise.resolve());

      expect(
        document.querySelector('.workspace-pane-host')?.getAttribute(
          'data-workspace-motion',
        ),
      ).toBeNull();
      for (const pane of collectPanes(secondSplit.root)) {
        expect(
          paneElement(pane.paneId).querySelector('.page-host'),
        ).not.toBeNull();
      }
      expect(mounts).toHaveLength(3);
    } finally {
      delete document.documentElement.dataset.motion;
      view.unmount();
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.useRealTimers();
    }
  });

  it('defers a canceled entering page mount until an abandoned exit releases', async () => {
    vi.useFakeTimers();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        const frameId = nextFrameId++;
        frames.set(frameId, callback);
        return frameId;
      });
    const cancelFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((frameId) => {
        frames.delete(frameId);
      });
    const runNextFrame = (): void => {
      const frame = frames.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      expect(frame).toBeDefined();
      frames.delete(frame![0]);
      act(() => frame![1](performance.now()));
    };
    const ref = createRef<WorkspacePaneHostHandle>();
    mounts.length = 0;
    const view = render(
      renderHost(singlePane.root, singlePane.activePaneId, ref),
    );

    try {
      const split = splitPane(singlePane, 'pane-1', 'row');
      const enteringPaneId = split.activePaneId;
      view.rerender(renderHost(split.root, enteringPaneId, ref));

      runNextFrame();
      runNextFrame();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(152);
      });

      const [pendingMountFrameId] = frames.keys();
      expect(pendingMountFrameId).toBeDefined();
      expect(
        paneElement(enteringPaneId).querySelector('.page-host'),
      ).toBeNull();

      act(() => {
        void ref.current!.animatePaneExit(enteringPaneId, 80);
      });

      expect(cancelFrame).toHaveBeenCalledWith(pendingMountFrameId);
      expect(frames.has(pendingMountFrameId!)).toBe(false);
      while (frames.size > 0) {
        runNextFrame();
      }
      expect(
        paneElement(enteringPaneId).querySelector('.page-host'),
      ).toBeNull();
      expect(mounts).toEqual([noteTab.tabId]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      runNextFrame();
      expect(
        paneElement(enteringPaneId).querySelector('.page-host'),
      ).not.toBeNull();
      expect(mounts).toEqual([
        noteTab.tabId,
        collectPanes(split.root).find(
          ({ paneId }) => paneId === enteringPaneId,
        )?.activeTabId,
      ]);
    } finally {
      view.unmount();
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.useRealTimers();
    }
  });

  it('keeps a pending page mount deferred through a following split', async () => {
    vi.useFakeTimers();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        const frameId = nextFrameId++;
        frames.set(frameId, callback);
        return frameId;
      });
    const cancelFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((frameId) => {
        frames.delete(frameId);
      });
    const runNextFrame = (): void => {
      const frame = frames.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      expect(frame).toBeDefined();
      frames.delete(frame![0]);
      act(() => frame![1](performance.now()));
    };
    mounts.length = 0;
    const view = render(
      renderHost(singlePane.root, singlePane.activePaneId),
    );

    try {
      const firstSplit = splitPane(singlePane, 'pane-1', 'row');
      const firstEnteringPaneId = firstSplit.activePaneId;
      view.rerender(renderHost(firstSplit.root, firstEnteringPaneId));
      runNextFrame();
      runNextFrame();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(152);
      });

      const [pendingMountFrameId] = frames.keys();
      expect(pendingMountFrameId).toBeDefined();
      expect(
        paneElement(firstEnteringPaneId).querySelector('.page-host'),
      ).toBeNull();

      const secondSplit = splitPane(
        firstSplit,
        firstEnteringPaneId,
        'column',
      );
      view.rerender(
        renderHost(secondSplit.root, secondSplit.activePaneId),
      );

      expect(cancelFrame).toHaveBeenCalledWith(pendingMountFrameId);
      expect(frames.has(pendingMountFrameId!)).toBe(false);
      expect(
        paneElement(firstEnteringPaneId).querySelector('.page-host'),
      ).toBeNull();

      runNextFrame();
      runNextFrame();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(152);
      });
      while (frames.size > 0) {
        runNextFrame();
      }

      expect(
        paneElement(firstEnteringPaneId).querySelector('.page-host'),
      ).not.toBeNull();
      expect(
        paneElement(secondSplit.activePaneId).querySelector('.page-host'),
      ).not.toBeNull();
      expect(mounts).toHaveLength(3);
    } finally {
      view.unmount();
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.useRealTimers();
    }
  });

  it('settles an exit promise when a newer pane motion supersedes it', async () => {
    vi.useFakeTimers();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        const frameId = nextFrameId++;
        frames.set(frameId, callback);
        return frameId;
      });
    const cancelFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((frameId) => {
        frames.delete(frameId);
      });
    const ref = createRef<WorkspacePaneHostHandle>();
    const split = splitPane(singlePane, 'pane-1', 'row');
    const view = render(renderHost(split.root, split.activePaneId, ref));

    try {
      let firstSettled = false;
      let first!: Promise<void>;
      let second!: Promise<void>;
      act(() => {
        first = ref.current!.animatePaneExit(split.activePaneId, 80);
      });
      void first.then(() => {
        firstSettled = true;
      });

      act(() => {
        second = ref.current!.animatePaneExit(split.activePaneId, 80);
      });
      await act(async () => Promise.resolve());

      expect(firstSettled).toBe(true);
      expect(cancelFrame).toHaveBeenCalled();
      expect(frames.size).toBe(1);

      const frame = frames.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      expect(frame).toBeDefined();
      frames.delete(frame![0]);
      act(() => frame![1](performance.now()));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(112);
      });
      await second;
    } finally {
      view.unmount();
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.useRealTimers();
    }
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
    const survivingContent = paneElement('pane-1').querySelector<HTMLElement>(
      ':scope > .workspace-pane__content',
    )!;
    vi.spyOn(survivingContent, 'getBoundingClientRect').mockReturnValue({
      bottom: 644,
      height: 600,
      left: 0,
      right: 500,
      top: 44,
      width: 500,
      x: 0,
      y: 44,
      toJSON: () => ({}),
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
    expect(survivingContent.dataset.motionLocked).toBe('');
    expect(survivingContent.style.width).toBe('500px');
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
