// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectGraphSettingsPanel } from '../../src/renderer/projects/ProjectGraphSettingsPanel';
import { DEFAULT_PROJECT_GRAPH_SETTINGS } from '../../src/renderer/projects/project-graph-settings';
import type { Translate } from '../../src/renderer/pages/page-types';

const translate: Translate = (key) => key;

afterEach(cleanup);

describe('project graph settings panel', () => {
  it('edits live values and exposes fit, reset, close, and Escape actions', () => {
    const onChange = vi.fn();
    const onChangeMode = vi.fn();
    const onClose = vi.fn();
    const onFit = vi.fn();
    const onReset = vi.fn();
    render(
      <ProjectGraphSettingsPanel
        layoutMode="orbit"
        onChange={onChange}
        onChangeMode={onChangeMode}
        onClose={onClose}
        onFit={onFit}
        onReset={onReset}
        settings={{ ...DEFAULT_PROJECT_GRAPH_SETTINGS }}
        translate={translate}
      />,
    );

    fireEvent.change(
      screen.getByRole('slider', { name: 'graph.nodeDistance' }),
      { target: { value: '180' } },
    );
    expect(onChange).toHaveBeenCalledWith('nodeDistance', 180);

    fireEvent.click(screen.getByRole('radio', { name: 'graph.modeGraph' }));
    expect(onChangeMode).toHaveBeenCalledWith('force');

    fireEvent.click(screen.getByRole('button', { name: 'graph.fit' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'graph.resetSettings' }),
    );
    fireEvent.keyDown(
      screen.getByRole('complementary', { name: 'graph.settings' }),
      { key: 'Escape' },
    );

    expect(onFit).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
