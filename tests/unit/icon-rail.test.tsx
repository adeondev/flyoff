// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IconRail } from '../../src/renderer/components/rail/IconRail';
import { createRailViews } from '../../src/renderer/components/rail/rail-views';
import type { Translate } from '../../src/renderer/pages/page-types';

const translate: Translate = (key) => key;

afterEach(cleanup);

describe('IconRail sidebar control', () => {
  it('uses the requested navigation order and replaces graph in orbit mode', () => {
    const graphViews = createRailViews('force');
    const orbitViews = createRailViews('orbit');

    expect(graphViews.map(({ labelKey }) => labelKey)).toEqual([
      'rail.project',
      'rail.graph',
      'rail.canvas',
      'rail.media',
      'rail.calendar',
      'rail.models',
      'rail.spreadsheet',
      'rail.properties',
    ]);
    expect(orbitViews[1]?.labelKey).toBe('rail.orbit');
    expect(orbitViews[1]?.icon).not.toBe(graphViews[1]?.icon);
  });

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
