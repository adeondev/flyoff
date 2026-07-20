// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IconRail } from '../../src/renderer/components/rail/IconRail';
import type { Translate } from '../../src/renderer/pages/page-types';

const translate: Translate = (key) => key;

afterEach(cleanup);

describe('IconRail sidebar control', () => {
  it('uses a distinct action icon for opening and closing the sidebar', () => {
    const onToggleSidebar = vi.fn();
    const { rerender } = render(
      <IconRail
        activeViewId=""
        onSelect={vi.fn()}
        onToggleSidebar={onToggleSidebar}
        sidebarCollapsed={false}
        translate={translate}
        views={[]}
      />,
    );

    const closeButton = screen.getByRole('button', {
      name: 'layout.collapseSidebar',
    });
    const closeMask = closeButton.querySelector('span')?.getAttribute('style');

    rerender(
      <IconRail
        activeViewId=""
        onSelect={vi.fn()}
        onToggleSidebar={onToggleSidebar}
        sidebarCollapsed
        translate={translate}
        views={[]}
      />,
    );

    const openButton = screen.getByRole('button', {
      name: 'layout.expandSidebar',
    });
    const openMask = openButton.querySelector('span')?.getAttribute('style');

    expect(closeMask).toBeTruthy();
    expect(openMask).toBeTruthy();
    expect(openMask).not.toBe(closeMask);
  });
});
