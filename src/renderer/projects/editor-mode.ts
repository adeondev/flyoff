import type { PageSessionState } from '../../shared/contracts';

export const EDITOR_MODES = ['edit', 'reading', 'split'] as const;

export type EditorMode = (typeof EDITOR_MODES)[number];

export function isEditorMode(value: unknown): value is EditorMode {
  return (
    typeof value === 'string' &&
    (EDITOR_MODES as readonly string[]).includes(value)
  );
}

export function readEditorMode(
  state: PageSessionState | undefined,
): EditorMode {
  const data = state?.data;

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const mode = (data as Record<string, unknown>).mode;
    if (isEditorMode(mode)) {
      return mode;
    }
  }

  return 'edit';
}

export function createEditorModeState(mode: EditorMode): PageSessionState {
  return {
    version: 3,
    data: { mode },
  };
}

export function updateEditorModeState(
  _state: PageSessionState | undefined,
  mode: EditorMode,
): PageSessionState {
  return createEditorModeState(mode);
}
