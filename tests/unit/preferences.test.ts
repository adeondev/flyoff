import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PreferencesStore } from '../../src/main/preferences';
import {
  createDefaultFlyoffPreferences,
  isFlyoffPreferences,
  normalizeFlyoffPreferences,
  PREFERENCES_MAX_BYTES,
} from '../../src/shared/contracts';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-preferences-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Flyoff preferences', () => {
  it('normalizes partial and out-of-range values without accepting extras', () => {
    const normalized = normalizeFlyoffPreferences({
      appearance: { theme: 'basalt' },
      editor: { fontSize: 200, lineHeight: 0 },
      spellcheck: {
        languages: ['pt-BR', 'pt-BR', '', 42],
      },
    });

    expect(normalized.appearance.theme).toBe('basalt');
    expect(normalized.editor.fontSize).toBe(24);
    expect(normalized.editor.lineHeight).toBe(1.3);
    expect(normalized.spellcheck.languages).toEqual(['pt-BR']);
    expect(normalized.version).toBe(5);
    expect(normalized.editor.chromeLayout).toBe('focus');
    expect(normalized.editor.toolbarCollapsed).toBe(false);
    expect(normalized.general.hardwareAcceleration).toBe(true);
    expect(normalized.accessibility.focusIndicator).toBe('standard');
    expect(isFlyoffPreferences(normalized)).toBe(true);
    expect(isFlyoffPreferences({ ...normalized, extra: true })).toBe(false);
  });

  it('migrates previous preferences with focus chrome and hardware acceleration enabled', () => {
    const previous = {
      ...createDefaultFlyoffPreferences(),
      version: 2,
      general: {
        ...createDefaultFlyoffPreferences().general,
        hardwareAcceleration: undefined,
      },
      accessibility: undefined,
      appearance: {
        ...createDefaultFlyoffPreferences().appearance,
        activePaneIndicator: undefined,
      },
      editor: {
        ...createDefaultFlyoffPreferences().editor,
        highlightActiveLine: undefined,
        fontLigatures: undefined,
      },
    };

    const migrated = normalizeFlyoffPreferences(previous);

    expect(migrated.version).toBe(5);
    expect(migrated.general.hardwareAcceleration).toBe(true);
    expect(migrated.appearance.activePaneIndicator).toBe('subtle');
    expect(migrated.editor.highlightActiveLine).toBe(true);
    expect(migrated.editor.fontLigatures).toBe(true);
    expect(migrated.editor.chromeLayout).toBe('focus');
    expect(migrated.editor.toolbarCollapsed).toBe(false);
    expect(migrated.accessibility).toEqual({
      focusIndicator: 'standard',
      reduceTransparency: false,
    });
  });

  it('persists atomically and recovers from corrupt or oversized files', () => {
    const directory = temporaryDirectory();
    const store = new PreferencesStore(directory);
    const preferences = createDefaultFlyoffPreferences();
    preferences.appearance.theme = 'basalt';
    preferences.editor.defaultMode = 'split';
    preferences.editor.toolbarCollapsed = true;

    store.save(preferences);
    expect(JSON.parse(readFileSync(store.filePath, 'utf8'))).toEqual(
      preferences,
    );
    expect(new PreferencesStore(directory).get()).toEqual(preferences);

    writeFileSync(store.filePath, '{broken', 'utf8');
    expect(new PreferencesStore(directory).get()).toEqual(
      createDefaultFlyoffPreferences(),
    );

    writeFileSync(store.filePath, 'x'.repeat(PREFERENCES_MAX_BYTES + 1), 'utf8');
    expect(new PreferencesStore(directory).get()).toEqual(
      createDefaultFlyoffPreferences(),
    );
  });
});
