import type { CSSProperties } from 'react';

export interface NoteAccentProps {
  'data-note-accent'?: '';
  style?: CSSProperties;
}

export function accentSeedStyle(
  seed: string | null | undefined,
): CSSProperties {
  return seed ? ({ '--note-seed': seed } as CSSProperties) : {};
}

export function noteAccentProps(seed: string | null | undefined): NoteAccentProps {
  if (!seed) {
    return {};
  }
  return {
    'data-note-accent': '',
    style: accentSeedStyle(seed),
  };
}
