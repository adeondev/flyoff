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
    expect(normalized.version).toBe(8);
    expect(normalized.editor.emojiRecent).toEqual([]);
    expect(normalized.editor.emojiSkinTone).toBe(0);
    expect(normalized.appearance.accentColor).toBeNull();
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
        accentColor: undefined,
        activePaneIndicator: undefined,
      },
      editor: {
        ...createDefaultFlyoffPreferences().editor,
        highlightActiveLine: undefined,
        fontLigatures: undefined,
      },
    };

    const migrated = normalizeFlyoffPreferences(previous);

    expect(migrated.version).toBe(8);
    expect(migrated.editor.emojiRecent).toEqual([]);
    expect(migrated.editor.emojiSkinTone).toBe(0);
    expect(migrated.appearance.accentColor).toBeNull();
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

  it('normalizes bounded per-project media gallery view state', () => {
    const projectId = '123e4567-e89b-42d3-a456-426614174000';
    const folderId = '123e4567-e89b-42d3-a456-426614174001';
    const normalized = normalizeFlyoffPreferences({
      workspace: {
        mediaGalleryProjects: {
          invalid: { folderId },
          [projectId]: {
            version: 99,
            viewMode: 'details',
            density: 'compact',
            searchScope: 'folder',
            sort: 'date-newest',
            folderId,
            history: [null, 'invalid', folderId],
          },
        },
      },
    });

    expect(normalized.workspace.mediaGalleryProjects).toEqual({
      [projectId]: {
        version: 1,
        viewMode: 'details',
        density: 'compact',
        searchScope: 'folder',
        sort: 'date-newest',
        folderId,
        history: [null, folderId],
      },
    });
  });

  it('canonicalizes valid accent colors and rejects unsafe values', () => {
    expect(
      normalizeFlyoffPreferences({
        appearance: { accentColor: '#8f4fc4' },
      }).appearance.accentColor,
    ).toBe('#8F4FC4');
    expect(
      normalizeFlyoffPreferences({
        appearance: { accentColor: '#3faB8c' },
      }).appearance.accentColor,
    ).toBeNull();
    expect(
      normalizeFlyoffPreferences({
        appearance: { accentColor: '#1234' },
      }).appearance.accentColor,
    ).toBeNull();
    expect(
      normalizeFlyoffPreferences({
        appearance: { accentColor: 'rgb(1 2 3)' },
      }).appearance.accentColor,
    ).toBeNull();
  });

  it('normalizes the offline emoji picker state', () => {
    const recent = Array.from({ length: 30 }, (_, index) =>
      index % 2 === 0 ? '🚀' : '👋🏽',
    );
    const normalized = normalizeFlyoffPreferences({
      editor: {
        emojiRecent: ['texto', '', ...recent, '👨‍👩‍👧‍👦'],
        emojiSkinTone: 9,
      },
    });

    expect(normalized.editor.emojiRecent).toEqual([
      '🚀',
      '👋🏽',
      '👨‍👩‍👧‍👦',
    ]);
    expect(normalized.editor.emojiSkinTone).toBe(0);
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
