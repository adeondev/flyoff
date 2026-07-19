// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginWorkspaceProjectNodePointerDrag,
  clearWorkspaceDrag,
  consumeWorkspaceDrag,
  hasWorkspaceDrag,
  installWorkspaceDragLifecycle,
  readWorkspaceDrag,
  setWorkspaceDragActive,
  subscribeWorkspaceDragReset,
  writeWorkspaceTabDrag,
} from '../../src/renderer/components/tabs/workspace-drag';
import { resolvePaneDropEdge } from '../../src/renderer/components/tabs/WorkspacePaneHost';

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    get types() {
      return [...values.keys()];
    },
    getData(type: string) {
      return values.get(type) ?? '';
    },
    setData(type: string, value: string) {
      values.set(type, value);
    },
  } as unknown as DataTransfer;
}

afterEach(() => {
  clearWorkspaceDrag();
  vi.restoreAllMocks();
});

describe('workspace drag lifecycle', () => {
  it('does not reuse a payload after its session was cleared', () => {
    const transfer = createDataTransfer();
    writeWorkspaceTabDrag(transfer, 'pane:1', 'tab:1', 'target:1');
    setWorkspaceDragActive(true);

    expect(readWorkspaceDrag(createDataTransfer())).toMatchObject({
      paneId: 'pane:1',
      tabId: 'tab:1',
    });

    clearWorkspaceDrag();

    expect(hasWorkspaceDrag(createDataTransfer())).toBe(false);
    expect(readWorkspaceDrag(createDataTransfer())).toBeUndefined();
  });

  it('consumes a drop payload only once and clears the global drag state', () => {
    const transfer = createDataTransfer();
    writeWorkspaceTabDrag(transfer, 'pane:1', 'tab:1', 'target:1');
    setWorkspaceDragActive(true);

    expect(consumeWorkspaceDrag(transfer)).toMatchObject({
      paneId: 'pane:1',
      tabId: 'tab:1',
    });
    expect(consumeWorkspaceDrag(transfer)).toBeUndefined();
    expect(hasWorkspaceDrag(createDataTransfer())).toBe(false);
    expect(
      document.documentElement.hasAttribute('data-workspace-dragging'),
    ).toBe(false);
  });

  it('clears a session when the source disappears before dragend', () => {
    const removeLifecycle = installWorkspaceDragLifecycle();
    const reset = vi.fn();
    const unsubscribe = subscribeWorkspaceDragReset(reset);
    const transfer = createDataTransfer();
    writeWorkspaceTabDrag(transfer, 'pane:1', 'tab:1', 'target:1');
    setWorkspaceDragActive(true);

    document.dispatchEvent(new Event('dragend', { bubbles: true }));

    expect(
      document.documentElement.hasAttribute('data-workspace-dragging'),
    ).toBe(false);
    expect(readWorkspaceDrag(createDataTransfer())).toBeUndefined();
    expect(reset).toHaveBeenCalledTimes(1);

    unsubscribe();
    removeLifecycle();
  });

  it('clears a stopped drop after the current event finishes', async () => {
    const removeLifecycle = installWorkspaceDragLifecycle();
    const transfer = createDataTransfer();
    writeWorkspaceTabDrag(transfer, 'pane:1', 'tab:1', 'target:1');
    setWorkspaceDragActive(true);

    document.dispatchEvent(new Event('drop', { bubbles: true }));
    expect(hasWorkspaceDrag(createDataTransfer())).toBe(true);

    await Promise.resolve();

    expect(hasWorkspaceDrag(createDataTransfer())).toBe(false);
    removeLifecycle();
  });

  it('primes a sidebar note drag before the native drag session starts', () => {
    const removeLifecycle = installWorkspaceDragLifecycle();
    beginWorkspaceProjectNodePointerDrag(
      {
        type: 'project-content',
        projectId: 'project:1',
        nodeId: 'note:1',
        pageType: 'markdown',
      },
      7,
      12,
      24,
    );

    document.dispatchEvent(new Event('dragstart', { bubbles: true }));
    window.dispatchEvent(new Event('blur'));

    expect(readWorkspaceDrag(createDataTransfer())).toMatchObject({
      kind: 'project-node',
      target: {
        projectId: 'project:1',
        nodeId: 'note:1',
      },
    });
    expect(document.documentElement.dataset.workspaceDragging).toBe('true');

    document.dispatchEvent(new Event('dragend', { bubbles: true }));
    expect(hasWorkspaceDrag(createDataTransfer())).toBe(false);
    removeLifecycle();
  });
});

describe('pane drop geometry', () => {
  const bounds = { left: 0, top: 0, width: 1_000, height: 700 };
  const tabDrag = {
    kind: 'tab' as const,
    paneId: 'pane:1',
    sessionId: 'drag:1',
    tabId: 'tab:1',
    targetKey: 'target:1',
  };

  it('leaves the source tab bar exclusively for tab reordering', () => {
    expect(
      resolvePaneDropEdge(bounds, 500, 24, true, tabDrag, 'pane:1'),
    ).toBeUndefined();
    expect(
      resolvePaneDropEdge(bounds, 500, 24, true, tabDrag, 'pane:2'),
    ).toBe('center');
  });

  it('uses proportional edge zones while preserving a large center target', () => {
    expect(
      resolvePaneDropEdge(bounds, 150, 200, true, tabDrag, 'pane:2'),
    ).toBe('left');
    expect(
      resolvePaneDropEdge(bounds, 500, 180, true, tabDrag, 'pane:2'),
    ).toBe('top');
    expect(
      resolvePaneDropEdge(bounds, 500, 350, true, tabDrag, 'pane:2'),
    ).toBe('center');
  });
});
