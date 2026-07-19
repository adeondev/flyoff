// @vitest-environment jsdom

import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PanelResizer } from '../../src/renderer/components/layout/PanelResizer';

afterEach(cleanup);

describe('PanelResizer', () => {
  it('marks only the separator currently being dragged', () => {
    const target = createRef<HTMLDivElement>();
    render(
      <div ref={target}>
        <PanelResizer
          ariaLabel="Rail"
          cssVar="--rail-width"
          max={200}
          min={40}
          onCommit={vi.fn()}
          target={target}
          value={64}
        />
        <PanelResizer
          ariaLabel="Sidebar"
          cssVar="--sidebar-width"
          max={500}
          min={160}
          onCommit={vi.fn()}
          target={target}
          value={240}
        />
      </div>,
    );

    const rail = screen.getByRole('separator', { name: 'Rail' });
    const sidebar = screen.getByRole('separator', { name: 'Sidebar' });
    fireEvent.pointerDown(rail, { button: 0, clientX: 20 });

    expect(rail.dataset.resizing).toBe('true');
    expect(sidebar.dataset.resizing).toBeUndefined();
    expect(document.documentElement.classList.contains('flyoff-resizing')).toBe(
      true,
    );

    fireEvent.pointerUp(window, { clientX: 36 });
    expect(rail.dataset.resizing).toBeUndefined();
    expect(document.documentElement.classList.contains('flyoff-resizing')).toBe(
      false,
    );
  });
});
