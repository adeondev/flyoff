import type { SpellcheckCapabilities } from '../../../shared/contracts';

export type SpellcheckDictionaryEvent =
  | {
      type: 'download-started';
      languageCode: string;
    }
  | {
      type: 'download-succeeded';
      languageCode: string;
    }
  | {
      type: 'download-failed';
      languageCode: string;
    }
  | {
      type: 'dictionary-initialized';
      languageCode: string;
    };

export type SpellcheckDictionaryEventListener = (
  event: SpellcheckDictionaryEvent,
) => void;

export type UnsubscribeSpellcheckDictionaryEvents = () => void;

export interface SpellcheckService {
  getCapabilities(): SpellcheckCapabilities;
  getAvailableLanguages(): readonly string[];
  getActiveLanguages(): readonly string[];
  setActiveLanguages(languages: readonly string[]): void;
  addWordToDictionary(word: string): boolean | Promise<boolean>;
  checkWords(words: readonly string[]): Promise<readonly string[]>;
  getSuggestions(word: string): Promise<readonly string[]>;
  onDictionaryDownload(
    listener: SpellcheckDictionaryEventListener,
  ): UnsubscribeSpellcheckDictionaryEvents;
}

export class SpellcheckLanguageSelectionUnsupportedError extends Error {
  constructor() {
    super('Spellcheck language selection is managed by macOS.');
    this.name = 'SpellcheckLanguageSelectionUnsupportedError';
  }
}

export class UnsupportedSpellcheckLanguagesError extends Error {
  readonly languageCodes: readonly string[];

  constructor(languageCodes: readonly string[]) {
    super(`Unsupported spellcheck languages: ${languageCodes.join(', ')}`);
    this.name = 'UnsupportedSpellcheckLanguagesError';
    this.languageCodes = [...languageCodes];
  }
}
