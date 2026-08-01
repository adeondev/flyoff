import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import {
  createDefaultFlyoffPreferences,
  APPLY_WINDOW_THEME_CHANNEL,
  ADD_SPELLCHECK_WORD_CHANNEL,
  CHECK_SPELLCHECK_WORDS_CHANNEL,
  GET_PREFERENCES_CHANNEL,
  GET_SPELLCHECK_SUGGESTIONS_CHANNEL,
  isFlyoffPreferences,
  isFlyoffTheme,
  RESET_PREFERENCES_CHANNEL,
  SAVE_PREFERENCES_CHANNEL,
  type FlyoffPreferences,
  type PreferencesSnapshot,
  isSpellcheckWordRequest,
  isSpellcheckWordsRequest,
} from '../../shared/contracts';
import type { PreferencesStore } from '../preferences';
import type { SpellcheckService } from '../services/spellcheck/types';
import { validateTrustedMainFrame } from './trusted-sender';

interface PreferencesHandlerOptions {
  defaultSpellcheckLanguages: readonly string[];
  isAllowedUrl: (url: string) => boolean;
  onThemeChanged?: (
    theme: FlyoffPreferences['appearance']['theme'],
    event: IpcMainInvokeEvent,
  ) => void;
  spellcheck: SpellcheckService;
  store: PreferencesStore;
  runtime: PreferencesSnapshot['runtime'];
}

function automaticLanguages(
  spellcheck: SpellcheckService,
  defaults: readonly string[],
): readonly string[] {
  const available = new Set(spellcheck.getAvailableLanguages());
  return defaults.filter((language) => available.has(language));
}

export function applySpellcheckPreferences(
  spellcheck: SpellcheckService,
  preferences: FlyoffPreferences,
  defaultLanguages: readonly string[],
): void {
  if (!spellcheck.getCapabilities().canSelectLanguages) {
    return;
  }

  const available = new Set(spellcheck.getAvailableLanguages());
  const selected = preferences.spellcheck.languages.filter((language) =>
    available.has(language),
  );
  const languages =
    selected.length > 0
      ? selected
      : automaticLanguages(spellcheck, defaultLanguages);
  spellcheck.setActiveLanguages(languages);
}

function createSnapshot(
  store: PreferencesStore,
  spellcheck: SpellcheckService,
  runtime: PreferencesSnapshot['runtime'],
): PreferencesSnapshot {
  return {
    preferences: store.get(),
    runtime: { ...runtime },
    spellcheck: {
      ...spellcheck.getCapabilities(),
      availableLanguages: [...spellcheck.getAvailableLanguages()].sort(
        (left, right) => left.localeCompare(right),
      ),
      activeLanguages: [...spellcheck.getActiveLanguages()],
    },
  };
}

function persistAndApply(
  store: PreferencesStore,
  spellcheck: SpellcheckService,
  preferences: FlyoffPreferences,
  defaultSpellcheckLanguages: readonly string[],
): void {
  const previous = store.get();
  store.save(preferences);
  try {
    applySpellcheckPreferences(
      spellcheck,
      preferences,
      defaultSpellcheckLanguages,
    );
  } catch (error) {
    store.save(previous);
    throw error;
  }
}

export function registerPreferencesHandlers({
  defaultSpellcheckLanguages,
  isAllowedUrl,
  onThemeChanged,
  spellcheck,
  store,
  runtime,
}: PreferencesHandlerOptions): () => void {
  ipcMain.handle(GET_PREFERENCES_CHANNEL, (event) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Preferences');
    return createSnapshot(
      store,
      spellcheck,
      runtime,
    );
  });

  ipcMain.handle(SAVE_PREFERENCES_CHANNEL, (event, value: unknown) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Preferences');
    if (!isFlyoffPreferences(value)) {
      throw new TypeError('Invalid Flyoff preferences.');
    }

    persistAndApply(
      store,
      spellcheck,
      value,
      defaultSpellcheckLanguages,
    );
    onThemeChanged?.(value.appearance.theme, event);
    return createSnapshot(
      store,
      spellcheck,
      runtime,
    );
  });

  ipcMain.handle(RESET_PREFERENCES_CHANNEL, (event) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Preferences');
    const preferences = createDefaultFlyoffPreferences();
    persistAndApply(
      store,
      spellcheck,
      preferences,
      defaultSpellcheckLanguages,
    );
    onThemeChanged?.(preferences.appearance.theme, event);
    return createSnapshot(
      store,
      spellcheck,
      runtime,
    );
  });

  ipcMain.handle(ADD_SPELLCHECK_WORD_CHANNEL, (event, request: unknown) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Spellcheck dictionary');
    if (!isSpellcheckWordRequest(request)) {
      throw new TypeError('Invalid spellcheck word request.');
    }
    return spellcheck.addWordToDictionary(request.word);
  });

  ipcMain.handle(
    CHECK_SPELLCHECK_WORDS_CHANNEL,
    async (event, request: unknown) => {
      validateTrustedMainFrame(event, isAllowedUrl, 'Spellcheck');
      if (!isSpellcheckWordsRequest(request)) {
        throw new TypeError('Invalid spellcheck words request.');
      }
      return spellcheck.checkWords(request.words);
    },
  );

  ipcMain.handle(
    GET_SPELLCHECK_SUGGESTIONS_CHANNEL,
    async (event, request: unknown) => {
      validateTrustedMainFrame(event, isAllowedUrl, 'Spellcheck suggestions');
      if (!isSpellcheckWordRequest(request)) {
        throw new TypeError('Invalid spellcheck word request.');
      }
      return spellcheck.getSuggestions(request.word);
    },
  );

  ipcMain.handle(APPLY_WINDOW_THEME_CHANNEL, (event, theme: unknown) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Window theme');
    if (!isFlyoffTheme(theme)) {
      throw new TypeError('Invalid Flyoff theme.');
    }
    onThemeChanged?.(theme, event);
  });

  return () => {
    ipcMain.removeHandler(GET_PREFERENCES_CHANNEL);
    ipcMain.removeHandler(SAVE_PREFERENCES_CHANNEL);
    ipcMain.removeHandler(RESET_PREFERENCES_CHANNEL);
    ipcMain.removeHandler(ADD_SPELLCHECK_WORD_CHANNEL);
    ipcMain.removeHandler(CHECK_SPELLCHECK_WORDS_CHANNEL);
    ipcMain.removeHandler(GET_SPELLCHECK_SUGGESTIONS_CHANNEL);
    ipcMain.removeHandler(APPLY_WINDOW_THEME_CHANNEL);
  };
}
