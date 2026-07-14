// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  calculateMenuPosition,
  DropdownMenu,
  MenuBar,
  type MenuItem,
} from '../../src/renderer/components/menu';

const menuItems: readonly MenuItem[] = [
  { id: 'open', kind: 'action', label: 'Open', shortcut: 'Ctrl+O' },
  { id: 'disabled', kind: 'action', label: 'Disabled', disabled: true },
  { id: 'divider', kind: 'separator' },
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
    expect(screen.getByRole('separator')).toBeTruthy();

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
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'OpenCtrl+O' }), {
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
