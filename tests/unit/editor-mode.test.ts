import { describe, expect, it } from 'vitest';

import {
  createEditorModeState,
  readEditorMode,
  updateEditorModeState,
} from '../../src/renderer/projects/editor-mode';

describe('editor view state', () => {
  it('reads modes from current and legacy editor sessions', () => {
    expect(
      readEditorMode({ version: 1, data: { mode: 'split' } }),
    ).toBe('split');
    expect(
      readEditorMode({
        version: 2,
        data: { mode: 'reading', toolbarCollapsed: true },
      }),
    ).toBe('reading');
  });

  it('stores only the mode and drops legacy per-tab toolbar state', () => {
    const reading = updateEditorModeState(
      {
        version: 2,
        data: { mode: 'edit', toolbarCollapsed: true },
      },
      'reading',
    );

    expect(reading).toEqual({
      version: 3,
      data: { mode: 'reading' },
    });
    expect(createEditorModeState('split')).toEqual({
      version: 3,
      data: { mode: 'split' },
    });
  });
});
