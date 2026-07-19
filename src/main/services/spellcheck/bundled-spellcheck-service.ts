import type { SpellcheckCapabilities } from '../../../shared/contracts';
import { PersonalDictionaryStore } from './personal-dictionary-store';
import {
  UnsupportedSpellcheckLanguagesError,
  type SpellcheckDictionaryEventListener,
  type SpellcheckService,
  type UnsubscribeSpellcheckDictionaryEvents,
} from './types';

const AVAILABLE_LANGUAGES = ['pt-BR', 'en-US'] as const;
type BundledLanguage = (typeof AVAILABLE_LANGUAGES)[number];

interface HunspellEngine {
  addWord(word: string): void;
  getSpellingSuggestions(word: string): string[];
  testSpelling(word: string): boolean;
}

interface DictionaryData {
  aff: Uint8Array;
  dic: Uint8Array;
}

const DICTIONARY_LOADERS: Record<
  BundledLanguage,
  () => Promise<DictionaryData>
> = {
  'pt-BR': async () => (await import('dictionary-pt')).default,
  'en-US': async () => (await import('dictionary-en')).default,
};

export class BundledSpellcheckService implements SpellcheckService {
  private activeLanguages: readonly BundledLanguage[] = [];
  private readonly engines = new Map<
    BundledLanguage,
    Promise<HunspellEngine>
  >();
  private readonly personalDictionary: PersonalDictionaryStore;

  constructor(userDataPath: string) {
    this.personalDictionary = new PersonalDictionaryStore(userDataPath);
  }

  getCapabilities(): SpellcheckCapabilities {
    return {
      provider: 'bundled-hunspell',
      canSelectLanguages: true,
      downloadsDictionaries: false,
    };
  }

  getAvailableLanguages(): readonly string[] {
    return [...AVAILABLE_LANGUAGES];
  }

  getActiveLanguages(): readonly string[] {
    return [...this.activeLanguages];
  }

  setActiveLanguages(languages: readonly string[]): void {
    const normalized = [
      ...new Set(
        languages.map((language) => {
          if (typeof language !== 'string' || language.trim().length === 0) {
            throw new TypeError(
              'Spellcheck language codes must be non-empty strings.',
            );
          }
          return language.trim();
        }),
      ),
    ];
    const unsupported = normalized.filter(
      (language) =>
        !(AVAILABLE_LANGUAGES as readonly string[]).includes(language),
    );
    if (unsupported.length > 0) {
      throw new UnsupportedSpellcheckLanguagesError(unsupported);
    }
    this.activeLanguages = normalized as readonly BundledLanguage[];
    for (const language of this.activeLanguages) {
      void this.engine(language).catch(() => undefined);
    }
  }

  async checkWords(words: readonly string[]): Promise<readonly string[]> {
    const engines = await this.activeEngines();
    if (engines.length === 0) {
      return [];
    }
    const personal = new Set(this.personalDictionary.get());

    return [
      ...new Set(
        words.filter(
          (word) =>
            word.length > 1 &&
            !personal.has(word) &&
            engines.every((engine) => !engine.testSpelling(word)),
        ),
      ),
    ];
  }

  async getSuggestions(word: string): Promise<readonly string[]> {
    const engines = await this.activeEngines();
    const suggestions: string[] = [];
    for (const engine of engines) {
      for (const suggestion of engine.getSpellingSuggestions(word)) {
        if (!suggestions.includes(suggestion)) {
          suggestions.push(suggestion);
        }
        if (suggestions.length >= 8) {
          return suggestions;
        }
      }
    }
    return suggestions;
  }

  async addWordToDictionary(word: string): Promise<boolean> {
    const added = this.personalDictionary.add(word);
    if (!added) {
      return false;
    }
    for (const engine of await this.activeEngines()) {
      engine.addWord(word);
    }
    return true;
  }

  onDictionaryDownload(
    _listener: SpellcheckDictionaryEventListener,
  ): UnsubscribeSpellcheckDictionaryEvents {
    return () => undefined;
  }

  private async activeEngines(): Promise<readonly HunspellEngine[]> {
    return Promise.all(
      this.activeLanguages.map((language) => this.engine(language)),
    );
  }

  private engine(language: BundledLanguage): Promise<HunspellEngine> {
    const current = this.engines.get(language);
    if (current) {
      return current;
    }

    const loading = DICTIONARY_LOADERS[language]()
      .then(async (dictionary) => {
        const { createHunspellFromStrings } = await import('hunspell-wasm');
        const decoder = new TextDecoder();
        const engine = await createHunspellFromStrings(
          decoder.decode(dictionary.aff),
          decoder.decode(dictionary.dic),
        );
        for (const word of this.personalDictionary.get()) {
          engine.addWord(word);
        }
        return engine;
      })
      .catch((error: unknown) => {
        this.engines.delete(language);
        throw error;
      });
    this.engines.set(language, loading);
    return loading;
  }
}
