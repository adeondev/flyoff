export const SPELLCHECK_PROVIDERS = [
  'bundled-hunspell',
  'chromium-hunspell',
  'macos-native',
] as const;

export const ADD_SPELLCHECK_WORD_CHANNEL =
  'flyoff:spellcheck:add-word' as const;
export const CHECK_SPELLCHECK_WORDS_CHANNEL =
  'flyoff:spellcheck:check-words' as const;
export const GET_SPELLCHECK_SUGGESTIONS_CHANNEL =
  'flyoff:spellcheck:get-suggestions' as const;
export const SPELLCHECK_WORD_MAX_LENGTH = 128;
export const SPELLCHECK_WORD_BATCH_LIMIT = 1_024;

export type SpellcheckProvider = (typeof SPELLCHECK_PROVIDERS)[number];

export interface SpellcheckCapabilities {
  provider: SpellcheckProvider;
  canSelectLanguages: boolean;
  downloadsDictionaries: boolean;
}

export interface SpellcheckWordRequest {
  word: string;
}

export interface SpellcheckWordsRequest {
  words: readonly string[];
}

export function isSpellcheckWordRequest(
  value: unknown,
): value is SpellcheckWordRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const word = (value as Record<string, unknown>).word;
  return (
    typeof word === 'string' &&
    word === word.trim() &&
    word.length > 0 &&
    word.length <= SPELLCHECK_WORD_MAX_LENGTH &&
    !/\s/u.test(word)
  );
}

export function isSpellcheckWordsRequest(
  value: unknown,
): value is SpellcheckWordsRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const words = (value as Record<string, unknown>).words;
  return (
    Array.isArray(words) &&
    words.length <= SPELLCHECK_WORD_BATCH_LIMIT &&
    words.every((word) => isSpellcheckWordRequest({ word }))
  );
}

export function isSpellcheckWordList(
  value: unknown,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= SPELLCHECK_WORD_BATCH_LIMIT &&
    value.every(
      (word) =>
        typeof word === 'string' &&
        word.length > 0 &&
        word.length <= SPELLCHECK_WORD_MAX_LENGTH,
    )
  );
}

export function isSpellcheckCapabilities(
  value: unknown,
): value is SpellcheckCapabilities {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const capabilities = value as Record<string, unknown>;

  return (
    typeof capabilities.provider === 'string' &&
    (SPELLCHECK_PROVIDERS as readonly string[]).includes(
      capabilities.provider,
    ) &&
    typeof capabilities.canSelectLanguages === 'boolean' &&
    typeof capabilities.downloadsDictionaries === 'boolean'
  );
}
