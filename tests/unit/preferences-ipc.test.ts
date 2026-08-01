import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerPreferencesHandlers } from '../../src/main/ipc';
import { PreferencesStore } from '../../src/main/preferences';
import {
  createDefaultFlyoffPreferences,
  APPLY_WINDOW_THEME_CHANNEL,
  ADD_SPELLCHECK_WORD_CHANNEL,
  GET_PREFERENCES_CHANNEL,
  RESET_PREFERENCES_CHANNEL,
  SAVE_PREFERENCES_CHANNEL,
} from '../../src/shared/contracts';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

const temporaryDirectories: string[] = [];

function event(url = 'flyoff://app/index.html'): IpcMainInvokeEvent {
  const mainFrame = { url };
  return {
    sender: { mainFrame },
    senderFrame: mainFrame,
  } as unknown as IpcMainInvokeEvent;
}

function handler(channel: string) {
  const registration = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([registered]) => registered === channel);
  if (!registration) {
    throw new Error(`Missing IPC handler: ${channel}`);
  }
  return registration[1];
}

describe('preferences IPC', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('validates, persists, applies languages and resets preferences', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-pref-ipc-'));
    temporaryDirectories.push(directory);
    const store = new PreferencesStore(directory);
    let activeLanguages = ['en-US'];
    const spellcheck = {
      getCapabilities: () => ({
        provider: 'chromium-hunspell' as const,
        canSelectLanguages: true,
        downloadsDictionaries: true,
      }),
      getAvailableLanguages: () => ['en-US', 'pt-BR'],
      getActiveLanguages: () => activeLanguages,
      setActiveLanguages: vi.fn((languages: readonly string[]) => {
        activeLanguages = [...languages];
      }),
      addWordToDictionary: () => true,
      checkWords: async () => [],
      getSuggestions: async () => [],
      onDictionaryDownload: () => () => undefined,
    };
    const onThemeChanged = vi.fn();
    const unregister = registerPreferencesHandlers({
      defaultSpellcheckLanguages: ['en-US'],
      isAllowedUrl: (url) => url === 'flyoff://app/index.html',
      onThemeChanged,
      spellcheck,
      store,
      runtime: {
        hardwareAccelerationEnabled: false,
        graphicsBackend: 'opengl',
        graphicsBackendSelectionAvailable: true,
      },
    });

    const preferences = createDefaultFlyoffPreferences();
    preferences.appearance.theme = 'basalt';
    preferences.spellcheck.languages = ['pt-BR'];
    const saved = handler(SAVE_PREFERENCES_CHANNEL)(event(), preferences);

    expect(saved.preferences).toEqual(preferences);
    expect(saved.runtime.hardwareAccelerationEnabled).toBe(false);
    expect(saved.runtime.graphicsBackend).toBe('opengl');
    expect(saved.runtime.graphicsBackendSelectionAvailable).toBe(true);
    expect(saved.spellcheck.activeLanguages).toEqual(['pt-BR']);
    expect(spellcheck.setActiveLanguages).toHaveBeenCalledWith(['pt-BR']);
    expect(onThemeChanged).toHaveBeenCalledWith('basalt', expect.anything());
    handler(APPLY_WINDOW_THEME_CHANNEL)(event(), 'flyoff');
    expect(onThemeChanged).toHaveBeenLastCalledWith(
      'flyoff',
      expect.anything(),
    );
    expect(() =>
      handler(APPLY_WINDOW_THEME_CHANNEL)(event(), 'unknown'),
    ).toThrow('Invalid Flyoff theme');
    expect(handler(GET_PREFERENCES_CHANNEL)(event()).preferences).toEqual(
      preferences,
    );

    const reset = handler(RESET_PREFERENCES_CHANNEL)(event());
    expect(reset.preferences).toEqual(createDefaultFlyoffPreferences());
    expect(activeLanguages).toEqual(['en-US']);
    expect(() =>
      handler(SAVE_PREFERENCES_CHANNEL)(event(), {
        ...preferences,
        version: 99,
      }),
    ).toThrow('Invalid Flyoff preferences');
    expect(() =>
      handler(GET_PREFERENCES_CHANNEL)(event('https://example.com')),
    ).toThrow();
    expect(
      handler(ADD_SPELLCHECK_WORD_CHANNEL)(event(), { word: 'Flyoff' }),
    ).toBe(true);

    unregister();
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(7);
  });
});
