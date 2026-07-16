import { describe, expect, it } from 'vitest';

import {
  createEditorModeState,
  isEditorMode,
  readEditorMode,
} from '../../src/renderer/projects/editor-mode';

describe('note editor mode state', () => {
  it('accepts only the known modes', () => {
    expect(isEditorMode('edit')).toBe(true);
    expect(isEditorMode('reading')).toBe(true);
    expect(isEditorMode('split')).toBe(true);
    expect(isEditorMode('wysiwyg')).toBe(false);
    expect(isEditorMode(2)).toBe(false);
  });

  it('round-trips a mode through page session state', () => {
    expect(readEditorMode(createEditorModeState('split'))).toBe('split');
    expect(createEditorModeState('reading')).toEqual({
      version: 1,
      data: { mode: 'reading' },
    });
  });

  it('falls back to edit for missing or invalid state', () => {
    expect(readEditorMode(undefined)).toBe('edit');
    expect(readEditorMode({ version: 1, data: null })).toBe('edit');
    expect(readEditorMode({ version: 1, data: { mode: 'nope' } })).toBe('edit');
    expect(readEditorMode({ version: 1, data: [] })).toBe('edit');
  });
});
