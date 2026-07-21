// @vitest-environment jsdom

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TooltipHost,
  calculateTooltipPosition,
  getTooltipTargetProps,
} from '../../src/renderer/components/tooltip';
import {
  AddInstancePopover,
  type AddInstancePopoverCloseReason,
} from '../../src/renderer/projects/AddInstancePopover';
import { MarkdownToolbar } from '../../src/renderer/projects/MarkdownToolbar';

function AddInstanceFixture({
  onClose = vi.fn(),
  onSelect = vi.fn(),
}: {
  onClose?: (reason: AddInstancePopoverCloseReason) => void;
  onSelect?: (choice: { kind: 'folder' | 'page'; pageType?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [restoreFocus, setRestoreFocus] = useState<HTMLElement | null>(null);

  return (
    <>
      <button
        onClick={(event) => {
          setRestoreFocus(event.currentTarget);
          setOpen(true);
        }}
        type="button"
        {...getTooltipTargetProps('Add instance')}
      >
        Add
      </button>
      {open ? (
        <AddInstancePopover
          onClose={(reason) => {
            onClose(reason);
            setOpen(false);
          }}
          onSelect={onSelect}
          parentId={null}
          position={{ x: 0, y: 0 }}
          restoreFocus={restoreFocus}
          translate={(key) => key}
        />
      ) : null}
      <TooltipHost />
    </>
  );
}

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
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Flyoff tooltip', () => {
  it('waits 800 ms on hover and switches an already visible target immediately', () => {
    vi.useFakeTimers();
    render(
      <>
        <button type="button" {...getTooltipTargetProps('First')}>
          One
        </button>
        <button type="button" {...getTooltipTargetProps('Second')}>
          Two
        </button>
        <TooltipHost />
      </>,
    );
    const first = screen.getByRole('button', { name: 'One' });
    const second = screen.getByRole('button', { name: 'Two' });

    fireEvent.pointerOver(first);
    act(() => vi.advanceTimersByTime(799));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('tooltip').textContent).toBe('First');

    fireEvent.pointerOut(first, { relatedTarget: second });
    fireEvent.pointerOver(second, { relatedTarget: first });
    expect(screen.getByRole('tooltip').textContent).toBe('Second');
  });

  it('opens on focus, closes with Escape and stays open across pointer transfer', () => {
    vi.useFakeTimers();
    render(
      <>
        <button type="button" {...getTooltipTargetProps('Action')}>
          Action
        </button>
        <TooltipHost />
      </>,
    );
    const button = screen.getByRole('button', { name: 'Action' });

    fireEvent.focusIn(button);
    let tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe('Action');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focusOut(button);
    fireEvent.pointerOver(button);
    act(() => vi.advanceTimersByTime(800));
    tooltip = screen.getByRole('tooltip');
    fireEvent.pointerOut(button, { relatedTarget: tooltip });
    fireEvent.pointerEnter(tooltip);
    act(() => vi.advanceTimersByTime(120));
    expect(screen.getByRole('tooltip')).toBe(tooltip);

    fireEvent.pointerLeave(tooltip);
    act(() => vi.advanceTimersByTime(120));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('dismisses on pointer action and suppresses the clicked target until it is left', () => {
    vi.useFakeTimers();
    render(
      <>
        <button
          aria-describedby="existing-description"
          type="button"
          {...getTooltipTargetProps('Add instance')}
        >
          Add
        </button>
        <TooltipHost />
      </>,
    );
    const button = screen.getByRole('button', { name: 'Add' });

    fireEvent.pointerOver(button);
    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByRole('tooltip').textContent).toBe('Add instance');
    expect(button.getAttribute('aria-describedby')).toContain('existing-description');
    expect(button.getAttribute('aria-describedby')).toContain('flyoff-tooltip-');

    fireEvent.pointerDown(button);
    fireEvent.focusIn(button);
    act(() => vi.advanceTimersByTime(800));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBe('existing-description');

    fireEvent.pointerOut(button);
    fireEvent.focusOut(button);
    fireEvent.pointerOver(button);
    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByRole('tooltip').textContent).toBe('Add instance');

    fireEvent.scroll(document);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBe('existing-description');
  });

  it('does not restore the add-instance trigger after an outside pointer close', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<AddInstanceFixture onClose={onClose} />);
    const trigger = screen.getByRole('button', { name: 'Add' });

    fireEvent.pointerOver(trigger);
    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByRole('tooltip').textContent).toBe('Add instance');

    fireEvent.pointerDown(trigger);
    fireEvent.focusIn(trigger);
    fireEvent.click(trigger);
    const search = screen.getByRole('searchbox', {
      name: 'projects.searchInstances',
    });
    expect(document.activeElement).toBe(search);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.pointerOut(trigger, { relatedTarget: search });
    fireEvent.pointerDown(document.body);
    expect(
      screen.queryByRole('dialog', { name: 'projects.addInstance' }),
    ).toBeNull();
    expect(onClose).toHaveBeenCalledWith('outside-pointer');
    act(() => vi.advanceTimersByTime(1_000));

    expect(document.activeElement).not.toBe(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('restores focus only for Escape and not for a selection', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(<AddInstanceFixture onClose={onClose} onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: 'Add' });

    fireEvent.click(trigger);
    fireEvent.keyDown(
      screen.getByRole('dialog', { name: 'projects.addInstance' }),
      { key: 'Escape' },
    );
    act(() => vi.runAllTimers());
    expect(onClose).toHaveBeenNthCalledWith(1, 'escape');
    expect(document.activeElement).toBe(trigger);

    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    const markdownOption = screen.getByRole('option', {
      name: /projects.instanceNote/,
    });
    fireEvent.pointerDown(markdownOption);
    fireEvent.click(markdownOption);
    act(() => vi.runAllTimers());

    expect(onSelect).toHaveBeenCalledWith({
      kind: 'page',
      pageType: 'markdown',
    });
    expect(onClose).toHaveBeenNthCalledWith(2, 'selection');
    expect(document.activeElement).not.toBe(trigger);
  });

  it('does not focus a disconnected add-instance trigger', () => {
    vi.useFakeTimers();
    const trigger = document.createElement('button');
    const focus = vi.spyOn(trigger, 'focus');
    render(
      <AddInstancePopover
        onClose={vi.fn()}
        onSelect={vi.fn()}
        parentId={null}
        position={{ x: 0, y: 0 }}
        restoreFocus={trigger}
        translate={(key) => key}
      />,
    );

    fireEvent.keyDown(
      screen.getByRole('dialog', { name: 'projects.addInstance' }),
      { key: 'Escape' },
    );
    act(() => vi.runAllTimers());

    expect(focus).not.toHaveBeenCalled();
  });

  it('closes for viewport, visibility and disconnected-anchor changes', async () => {
    function Fixture({ showTarget = true }: { showTarget?: boolean }) {
      return (
        <>
          {showTarget ? (
            <button type="button" {...getTooltipTargetProps('Action')}>
              Action
            </button>
          ) : null}
          <TooltipHost />
        </>
      );
    }

    const { rerender } = render(<Fixture />);
    const button = screen.getByRole('button', { name: 'Action' });

    fireEvent.focusIn(button);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focusOut(button);
    fireEvent.focusIn(button);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.queryByRole('tooltip')).toBeNull();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    fireEvent.focusOut(button);
    fireEvent.focusIn(button);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    rerender(<Fixture showTarget={false} />);
    await vi.waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('closes on window blur and drag without leaving ARIA behind', () => {
    render(
      <>
        <button
          aria-describedby="persistent-description"
          type="button"
          {...getTooltipTargetProps('Action')}
        >
          Action
        </button>
        <TooltipHost />
      </>,
    );
    const button = screen.getByRole('button', { name: 'Action' });

    fireEvent.focusIn(button);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent(window, new Event('blur'));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBe(
      'persistent-description',
    );

    fireEvent.focusOut(button);
    fireEvent.focusIn(button);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.dragStart(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBe(
      'persistent-description',
    );
  });

  it('cleans pending timers and descriptions when the host unmounts', () => {
    vi.useFakeTimers();
    const view = render(
      <>
        <button type="button" {...getTooltipTargetProps('Action')}>
          Action
        </button>
        <TooltipHost />
      </>,
    );
    const button = screen.getByRole('button', { name: 'Action' });

    fireEvent.focusIn(button);
    expect(button.getAttribute('aria-describedby')).toContain(
      'flyoff-tooltip-',
    );
    view.unmount();

    expect(button.hasAttribute('aria-describedby')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flips and clamps placement at viewport edges', () => {
    expect(
      calculateTooltipPosition(
        rect(280, 10, 20, 20),
        rect(0, 0, 100, 40),
        { width: 300, height: 200 },
        'right',
      ),
    ).toEqual({ left: 172, placement: 'left', top: 8 });

    expect(
      calculateTooltipPosition(
        rect(0, 2, 10, 10),
        rect(0, 0, 100, 30),
        { width: 300, height: 200 },
        'top',
      ),
    ).toEqual({ left: 8, placement: 'bottom', top: 20 });
  });

  it('keeps the Markdown toolbar icon-only and accessible', () => {
    render(
      <MarkdownToolbar
        onAction={vi.fn()}
        onEmoji={vi.fn()}
        onEmojiPickerClose={vi.fn()}
        translate={(key) => key}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(12);
    for (const button of buttons) {
      expect(button.textContent).toBe('');
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.getAttribute('data-flyoff-tooltip')).toBe(
        button.getAttribute('aria-label'),
      );
      expect(button.hasAttribute('title')).toBe(false);
    }
  });

  it('searches and inserts offline emoji without closing the picker', () => {
    const onEmoji = vi.fn();
    render(
      <MarkdownToolbar
        onAction={vi.fn()}
        onEmoji={onEmoji}
        onEmojiPickerClose={vi.fn()}
        translate={(key) => key}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'toolbar.emoji' }));
    const dialog = screen.getByRole('dialog', {
      name: 'toolbar.emojiPicker',
    });
    const grid = screen.getByRole('grid');
    const mountedAtOpen = screen.getAllByRole('gridcell').length;
    expect(
      Number(grid.getAttribute('aria-rowcount')) *
        Number(grid.getAttribute('aria-colcount')),
    ).toBeGreaterThan(mountedAtOpen);
    expect(mountedAtOpen).toBeLessThan(100);
    fireEvent.click(
      screen.getByRole('tab', { name: /people|pessoas/i }),
    );
    expect(screen.getAllByRole('gridcell').length).toBeLessThan(100);
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'toolbar.emojiSearch' }),
      { target: { value: 'rocket' } },
    );
    fireEvent.click(screen.getByRole('gridcell', { name: /rocket/i }));

    expect(onEmoji).toHaveBeenCalledWith('🚀');
    expect(dialog.isConnected).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog.isConnected).toBe(false);
  });
});
