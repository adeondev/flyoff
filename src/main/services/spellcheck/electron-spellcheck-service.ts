import type { Session } from 'electron';
import type { FlyoffPlatform } from '../../../shared/contracts';
import {
  SpellcheckLanguageSelectionUnsupportedError,
  UnsupportedSpellcheckLanguagesError,
  type SpellcheckDictionaryEventListener,
  type SpellcheckService,
  type UnsubscribeSpellcheckDictionaryEvents,
} from './types';

export type ElectronSpellcheckSession = Pick<
  Session,
  | 'availableSpellCheckerLanguages'
  | 'getSpellCheckerLanguages'
  | 'setSpellCheckerLanguages'
  | 'addWordToSpellCheckerDictionary'
  | 'on'
  | 'removeListener'
>;

export class ElectronSpellcheckService implements SpellcheckService {
  constructor(
    private readonly session: ElectronSpellcheckSession,
    private readonly platform: FlyoffPlatform,
  ) {}

  getCapabilities() {
    return this.platform === 'darwin'
      ? {
          provider: 'macos-native' as const,
          canSelectLanguages: false,
          downloadsDictionaries: false,
        }
      : {
          provider: 'chromium-hunspell' as const,
          canSelectLanguages: true,
          downloadsDictionaries: true,
        };
  }

  getAvailableLanguages(): readonly string[] {
    return [...this.session.availableSpellCheckerLanguages];
  }

  getActiveLanguages(): readonly string[] {
    return [...this.session.getSpellCheckerLanguages()];
  }

  setActiveLanguages(languages: readonly string[]): void {
    if (!this.getCapabilities().canSelectLanguages) {
      throw new SpellcheckLanguageSelectionUnsupportedError();
    }

    const normalizedLanguages = [...new Set(languages.map((language) => {
      if (typeof language !== 'string' || language.trim().length === 0) {
        throw new TypeError('Spellcheck language codes must be non-empty strings.');
      }

      return language.trim();
    }))];
    const availableLanguages = new Set(
      this.session.availableSpellCheckerLanguages,
    );
    const unsupportedLanguages = normalizedLanguages.filter(
      (language) => !availableLanguages.has(language),
    );

    if (unsupportedLanguages.length > 0) {
      throw new UnsupportedSpellcheckLanguagesError(unsupportedLanguages);
    }

    this.session.setSpellCheckerLanguages(normalizedLanguages);
  }

  addWordToDictionary(word: string): boolean {
    return this.session.addWordToSpellCheckerDictionary(word);
  }

  async checkWords(): Promise<readonly string[]> {
    return [];
  }

  async getSuggestions(): Promise<readonly string[]> {
    return [];
  }

  onDictionaryDownload(
    listener: SpellcheckDictionaryEventListener,
  ): UnsubscribeSpellcheckDictionaryEvents {
    if (!this.getCapabilities().downloadsDictionaries) {
      return () => undefined;
    }

    const onDownloadStarted = (_event: unknown, languageCode: string) => {
      listener({ type: 'download-started', languageCode });
    };
    const onDownloadSucceeded = (_event: unknown, languageCode: string) => {
      listener({ type: 'download-succeeded', languageCode });
    };
    const onDownloadFailed = (_event: unknown, languageCode: string) => {
      listener({ type: 'download-failed', languageCode });
    };
    const onDictionaryInitialized = (_event: unknown, languageCode: string) => {
      listener({ type: 'dictionary-initialized', languageCode });
    };

    this.session.on(
      'spellcheck-dictionary-download-begin',
      onDownloadStarted,
    );
    this.session.on(
      'spellcheck-dictionary-download-success',
      onDownloadSucceeded,
    );
    this.session.on(
      'spellcheck-dictionary-download-failure',
      onDownloadFailed,
    );
    this.session.on(
      'spellcheck-dictionary-initialized',
      onDictionaryInitialized,
    );

    let isSubscribed = true;

    return () => {
      if (!isSubscribed) {
        return;
      }

      isSubscribed = false;
      this.session.removeListener(
        'spellcheck-dictionary-download-begin',
        onDownloadStarted,
      );
      this.session.removeListener(
        'spellcheck-dictionary-download-success',
        onDownloadSucceeded,
      );
      this.session.removeListener(
        'spellcheck-dictionary-download-failure',
        onDownloadFailed,
      );
      this.session.removeListener(
        'spellcheck-dictionary-initialized',
        onDictionaryInitialized,
      );
    };
  }
}
