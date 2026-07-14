export const SPELLCHECK_PROVIDERS = [
  'chromium-hunspell',
  'macos-native',
] as const;

export type SpellcheckProvider = (typeof SPELLCHECK_PROVIDERS)[number];

export interface SpellcheckCapabilities {
  provider: SpellcheckProvider;
  canSelectLanguages: boolean;
  downloadsDictionaries: boolean;
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
