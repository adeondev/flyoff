// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectGraphSettingsPanel } from '../../src/renderer/projects/ProjectGraphSettingsPanel';
import {
  copyProjectGraphSettings,
  DEFAULT_PROJECT_GRAPH_SETTINGS,
} from '../../src/renderer/projects/project-graph-settings';
import type { Translate } from '../../src/renderer/pages/page-types';

const translate: Translate = (key) => key;

afterEach(cleanup);

function renderPanel(layoutMode: 'force' | 'orbit') {
  const callbacks = {
    onChange: vi.fn(),
    onChangeMode: vi.fn(),
    onClose: vi.fn(),
    onFit: vi.fn(),
    onReset: vi.fn(),
  };
  const settings = copyProjectGraphSettings(DEFAULT_PROJECT_GRAPH_SETTINGS);
  settings.layoutMode = layoutMode;
  render(
    <ProjectGraphSettingsPanel
      {...callbacks}
      settings={settings}
      translate={translate}
    />,
  );
  return callbacks;
}

describe('project graph settings panel', () => {
  it('shows and edits only Orbit settings', () => {
    const callbacks = renderPanel('orbit');
    expect(screen.getAllByRole('slider')).toHaveLength(9);
    const spacing = screen.getByRole('slider', {
      name: 'graph.orbitSpacing',
    });
    expect(spacing.style.getPropertyValue('--graph-setting-progress')).not.toBe(
      '',
    );
    expect(
      screen.queryByRole('slider', { name: 'graph.nodeDistance' }),
    ).toBeNull();
    fireEvent.change(spacing, { target: { value: '1.3' } });
    expect(callbacks.onChange).toHaveBeenCalledWith({
      force: DEFAULT_PROJECT_GRAPH_SETTINGS.force,
      layoutMode: 'orbit',
      orbit: {
        ...DEFAULT_PROJECT_GRAPH_SETTINGS.orbit,
        spacing: 1.3,
      },
    });

    const orbitMode = screen.getByRole('radio', { name: 'graph.modeOrbit' });
    expect(orbitMode.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'graph.modeGraph' }));
    expect(callbacks.onChangeMode).toHaveBeenCalledWith('force');

    fireEvent.click(screen.getByRole('button', { name: 'graph.fit' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'graph.resetSettings' }),
    );
    fireEvent.keyDown(
      screen.getByRole('complementary', { name: 'graph.orbitSettings' }),
      { key: 'Escape' },
    );

    expect(callbacks.onFit).toHaveBeenCalledOnce();
    expect(callbacks.onReset).toHaveBeenCalledOnce();
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });

  it('shows force simulation settings only in Graph mode', () => {
    renderPanel('force');
    expect(screen.getAllByRole('slider')).toHaveLength(11);
    expect(
      screen.getByRole('slider', { name: 'graph.nodeDistance' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('slider', { name: 'graph.orbitSpacing' }),
    ).toBeNull();
    expect(
      screen
        .getByRole('radio', { name: 'graph.modeGraph' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });
});
