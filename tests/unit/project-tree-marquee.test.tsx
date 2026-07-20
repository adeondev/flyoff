// @vitest-environment jsdom

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  emptyProjectTreeSelection,
  type ProjectTreeSelection,
} from '../../src/renderer/projects/project-tree-selection';
import { useProjectTreeMarquee } from '../../src/renderer/projects/use-project-tree-marquee';

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => undefined,
  };
}

function MarqueeHarness({
  onSelectionChange,
}: {
  onSelectionChange: (selection: ProjectTreeSelection) => void;
}) {
  const [selection, setSelection] = useState(emptyProjectTreeSelection);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const marquee = useProjectTreeMarquee({
    itemRefs,
    onSelectionChange: (next) => {
      setSelection(next);
      onSelectionChange(next);
    },
    selection,
    visibleNodeIds: ['a', 'b'],
  });

  return (
    <div
      className="project-sidebar__tree-scroll"
      data-testid="scroll"
    >
      <div
        className={marquee.selecting ? 'selecting' : ''}
        data-testid="tree"
        onLostPointerCapture={marquee.handleLostPointerCapture}
        onPointerCancel={marquee.handlePointerCancel}
        onPointerDown={marquee.handlePointerDown}
        onPointerMove={marquee.handlePointerMove}
        onPointerUp={marquee.handlePointerUp}
      >
        {['a', 'b'].map((nodeId) => (
          <div
            className="project-tree__item"
            data-testid={`item-${nodeId}`}
            key={nodeId}
            ref={(element) => {
              if (element) {
                itemRefs.current.set(nodeId, element);
              }
            }}
          />
        ))}
        {marquee.boxStyle ? (
          <div data-testid="marquee" style={marquee.boxStyle} />
        ) : null}
        {createPortal(
          <button data-testid="portal-action" type="button">
            Action
          </button>,
          document.body,
        )}
      </div>
    </div>
  );
}

describe('project tree marquee', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('selects intersected rows after the pointer crosses the threshold', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestAnimationFrame',
      (callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (handle: number) =>
      window.clearTimeout(handle),
    );
    const onSelectionChange = vi.fn();
    const { getByTestId } = render(
      <MarqueeHarness onSelectionChange={onSelectionChange} />,
    );
    const scroll = getByTestId('scroll');
    const tree = getByTestId('tree');
    const captures = new Set<number>();
    tree.setPointerCapture = (pointerId) => captures.add(pointerId);
    tree.releasePointerCapture = (pointerId) => captures.delete(pointerId);
    tree.hasPointerCapture = (pointerId) => captures.has(pointerId);
    scroll.getBoundingClientRect = () => rect(0, 0, 140, 100);
    getByTestId('item-a').getBoundingClientRect = () =>
      rect(20, 10, 100, 30);
    getByTestId('item-b').getBoundingClientRect = () =>
      rect(20, 44, 100, 30);

    fireEvent.pointerDown(tree, {
      button: 0,
      clientX: 5,
      clientY: 5,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse',
    });
    fireEvent.pointerMove(tree, {
      clientX: 125,
      clientY: 55,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse',
    });
    act(() => vi.advanceTimersByTime(16));

    expect(getByTestId('marquee')).toBeTruthy();
    expect(
      [...onSelectionChange.mock.lastCall![0].selectedIds],
    ).toEqual(['a', 'b']);
  });

  it('does not start a marquee from a tree item', () => {
    const onSelectionChange = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <MarqueeHarness onSelectionChange={onSelectionChange} />,
    );
    const tree = getByTestId('tree');
    const item = getByTestId('item-a');

    fireEvent.pointerDown(item, {
      button: 0,
      clientX: 20,
      clientY: 20,
      isPrimary: true,
      pointerId: 2,
      pointerType: 'mouse',
    });
    fireEvent.pointerMove(tree, {
      clientX: 100,
      clientY: 80,
      isPrimary: true,
      pointerId: 2,
      pointerType: 'mouse',
    });

    expect(queryByTestId('marquee')).toBeNull();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('ignores pointer events from a portal owned by the tree', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestAnimationFrame',
      (callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (handle: number) =>
      window.clearTimeout(handle),
    );
    const onSelectionChange = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <MarqueeHarness onSelectionChange={onSelectionChange} />,
    );
    const tree = getByTestId('tree');

    fireEvent.pointerDown(getByTestId('portal-action'), {
      button: 0,
      clientX: 20,
      clientY: 20,
      isPrimary: true,
      pointerId: 3,
      pointerType: 'mouse',
    });
    fireEvent.pointerMove(tree, {
      clientX: 100,
      clientY: 80,
      isPrimary: true,
      pointerId: 3,
      pointerType: 'mouse',
    });
    act(() => vi.advanceTimersByTime(16));

    expect(queryByTestId('marquee')).toBeNull();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});
