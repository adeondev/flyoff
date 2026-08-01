// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  calculateMenuPosition,
  DropdownMenu,
  MenuBar,
  type MenuItem,
} from '../../src/renderer/components/menu';
import {
  getTooltipTargetProps,
  TooltipHost,
} from '../../src/renderer/components/tooltip';

const menuItems: readonly MenuItem[] = [
  {
    id: 'open',
    kind: 'action',
    label: 'Open',
    shortcut: 'Ctrl+O',
    icon: '/open.svg',
  },
  { id: 'disabled', kind: 'action', label: 'Disabled', disabled: true },
  {
    id: 'checked',
    kind: 'action',
    label: 'Checked',
    checked: true,
    icon: '/checked.svg',
  },
  { id: 'divider', kind: 'separator' },
  { id: 'heading', kind: 'label', label: 'Current note' },
  {
    id: 'nested',
    kind: 'submenu',
    label: 'Nested',
    children: [{ id: 'nested.action', kind: 'action', label: 'Nested action' }],
  },
];

afterEach(() => {
  cleanup();
});

describe('menu positioning', () => {
  it('flips vertical and horizontal placement before leaving the viewport', () => {
    const anchor = {
      bottom: 190,
      left: 150,
      right: 170,
      top: 170,
    } as DOMRect;
    const menu = { height: 80, width: 100 } as DOMRect;

    expect(
      calculateMenuPosition(anchor, menu, { width: 300, height: 220 }, 'bottom-start'),
    ).toMatchObject({ left: 150, top: 90 });
    expect(
      calculateMenuPosition(anchor, menu, { width: 220, height: 300 }, 'side-start'),
    ).toMatchObject({ left: 50, top: 170 });
  });
});

describe('reusable dropdown menu', () => {
  it('supports disabled actions, nested menus, activation and focus restoration', async () => {
    const onAction = vi.fn();
    render(
      <DropdownMenu
        items={menuItems}
        onAction={onAction}
        trigger={(props) => <button {...props}>Open menu</button>}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);

    const menu = await screen.findByRole('menu');
    expect(menu).toBeTruthy();
    expect(screen.getByText('Ctrl+O')).toBeTruthy();
    expect(
      screen.getByRole('menuitem', { name: 'Open' }).getAttribute(
        'aria-keyshortcuts',
      ),
    ).toBe('Ctrl+O');
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(screen.getByText('Current note')).toBeTruthy();
    expect(
      screen.queryByRole('menuitem', { name: 'Current note' }),
    ).toBeNull();
    expect(
      screen
        .getByRole('menuitem', { name: 'Open' })
        .querySelector('.flyoff-menu__item-icon'),
    ).not.toBeNull();
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Checked' }).getAttribute(
        'aria-checked',
      ),
    ).toBe('true');
    expect(
      screen
        .getByRole('menuitemcheckbox', { name: 'Checked' })
        .querySelector('.flyoff-menu__item-icon'),
    ).not.toBeNull();
    expect(
      screen
        .getByRole('menuitemcheckbox', { name: 'Checked' })
        .querySelector('.flyoff-menu__check'),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Disabled' }));
    expect(onAction).not.toHaveBeenCalled();

    const nested = screen.getByRole('menuitem', { name: 'Nested' });
    fireEvent.keyDown(nested, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(2));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Nested action' }));
    expect(onAction).toHaveBeenCalledWith('nested.action');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('restores trigger focus without reopening its tooltip', async () => {
    render(
      <>
        <DropdownMenu
          items={menuItems}
          onAction={() => undefined}
          trigger={(props) => (
            <button {...props} {...getTooltipTargetProps('Menu options')}>
              Open menu
            </button>
          )}
        />
        <TooltipHost />
      </>,
    );

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open' }));

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focusOut(trigger);
    fireEvent.focusIn(trigger);
    expect(screen.getByRole('tooltip').textContent).toBe('Menu options');
  });

  it('positions an upward menu by its right edge', () => {
    const anchor = {
      bottom: 210,
      left: 220,
      right: 280,
      top: 180,
    } as DOMRect;
    const menu = { height: 100, width: 120 } as DOMRect;

    expect(
      calculateMenuPosition(
        anchor,
        menu,
        { width: 320, height: 240 },
        'top-end',
      ),
    ).toMatchObject({ left: 160, top: 80 });
  });

  it('closes when clicking outside and keeps the trigger state synchronized', async () => {
    render(
      <DropdownMenu
        items={menuItems}
        onAction={() => undefined}
        trigger={(props) => <button {...props}>Open menu</button>}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    await screen.findByRole('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape even when focus has left the menu items', async () => {
    render(
      <DropdownMenu
        items={menuItems}
        onAction={() => undefined}
        trigger={(props) => <button {...props}>Open menu</button>}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    await screen.findByRole('menu');

    // Simulate focus leaving the menu so no menu item can handle the key.
    (document.activeElement as HTMLElement | null)?.blur();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('handles Escape on its trigger without dismissing a parent surface', async () => {
    const onParentKeyDown = vi.fn();
    render(
      <div onKeyDown={onParentKeyDown}>
        <DropdownMenu
          items={menuItems}
          onAction={() => undefined}
          trigger={(props) => <button {...props}>Open menu</button>}
        />
      </div>,
    );

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    await screen.findByRole('menu');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(onParentKeyDown).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe('Flyoff tooltips', () => {
  it('dismisses and suppresses tooltips on pointer and keyboard activation', () => {
    render(
      <>
        <button {...getTooltipTargetProps('Action details')}>Action</button>
        <button>Other</button>
        <TooltipHost />
      </>,
    );
    const action = screen.getByRole('button', { name: 'Action' });
    const other = screen.getByRole('button', { name: 'Other' });

    fireEvent.focusIn(action);
    expect(screen.getByRole('tooltip').textContent).toBe('Action details');
    fireEvent.click(action);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focusIn(action);
    fireEvent.pointerOver(action);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.pointerOut(action, { relatedTarget: other });
    fireEvent.focusOut(action, { relatedTarget: other });
    fireEvent.focusIn(action, { relatedTarget: other });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(action, { key: 'Enter' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focusOut(action, { relatedTarget: other });
    fireEvent.focusIn(action, { relatedTarget: other });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.click(other);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('menu bar', () => {
  it('changes open sibling menus with the keyboard', async () => {
    render(
      <MenuBar
        ariaLabel="Application"
        menus={[
          { id: 'file', label: 'File', items: menuItems },
          {
            id: 'edit',
            label: 'Edit',
            items: [{ id: 'copy', kind: 'action', label: 'Copy' }],
          },
        ]}
        onAction={() => undefined}
      />,
    );

    const file = screen.getByRole('menuitem', { name: 'File' });
    fireEvent.keyDown(file, { key: 'ArrowDown' });
    await screen.findByRole('menu');
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Open' }), {
      key: 'ArrowRight',
    });

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeTruthy();
      expect(
        screen.getByRole('menuitem', { name: 'Edit' }).getAttribute(
          'aria-expanded',
        ),
      ).toBe('true');
    });
  });
});
