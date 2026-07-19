import type {
  FlyoffPlatform,
  SpellcheckCapabilities,
} from '../../../shared/contracts';

export function getSpellcheckCapabilities(
  platform: FlyoffPlatform,
): SpellcheckCapabilities {
  if (platform === 'darwin') {
    return {
      provider: 'macos-native',
      canSelectLanguages: false,
      downloadsDictionaries: false,
    };
  }

  return {
    provider: 'bundled-hunspell',
    canSelectLanguages: true,
    downloadsDictionaries: false,
  };
}
